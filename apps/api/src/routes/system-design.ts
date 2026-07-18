// ============================================
// System Design Routes
// ============================================
// GET  /system-design/questions              → list all questions
// GET  /system-design/question/:id           → fetch a single question (with diagram)
// POST /system-design/submit                 → submit attempt + get Gemini Pro verdict
// GET  /system-design/submissions/:qid       → list past submissions for a question

import { FastifyInstance } from "fastify";
import { z } from "zod";
import mongoose from "mongoose";
import { SystemDesignQuestion } from "../models/system-design-question.js";
import { SystemDesignSubmission } from "../models/system-design-submission.js";
import { getGeminiClient, GEMINI_PRO_MODEL, GEMINI_THINKING_HIGH } from "../lib/gemini.js";
import { cacheDel } from "../lib/redis.js";

// ── Helpers ─────────────────────────────────────────────────────
function extractJsonObject(raw: string): string {
    const cleaned = (raw || "").replace(/^﻿/, "").trim();
    // Strip ```json fences if present
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1].trim() : cleaned;
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first < 0 || last < 0 || last <= first) {
        throw new Error("Model response did not contain a valid JSON object");
    }
    return candidate.slice(first, last + 1);
}

function summariseScratchpad(elements: any[] | null | undefined): string {
    if (!Array.isArray(elements) || elements.length === 0) {
        return "(No diagram drawn — candidate left whiteboard empty.)";
    }

    const counts: Record<string, number> = {};
    const labels: string[] = [];
    for (const el of elements) {
        if (!el || typeof el !== "object") continue;
        const t = String(el.type || "shape");
        counts[t] = (counts[t] || 0) + 1;
        if (typeof el.text === "string" && el.text.trim()) {
            labels.push(el.text.trim());
        }
        if (typeof el.label === "string" && el.label.trim()) {
            labels.push(el.label.trim());
        }
    }

    const shapeSummary = Object.entries(counts)
        .map(([t, n]) => `${n}× ${t}`)
        .join(", ");
    const uniqueLabels = Array.from(new Set(labels)).slice(0, 30);
    const labelSummary = uniqueLabels.length
        ? `Labels on the diagram: ${uniqueLabels.map((l) => JSON.stringify(l)).join(", ")}.`
        : "No textual labels on the diagram.";

    return `Diagram contains ${elements.length} element(s) (${shapeSummary}). ${labelSummary}`;
}

const SUBMIT_SYSTEM_INSTRUCTION = `You are a strict, senior Principal Engineer and hiring committee member at a Tier-1 tech company (Google, Meta, Amazon level).
You are reviewing a candidate's WRITTEN system-design attempt. The candidate has submitted three artefacts:
  1. Functional requirements (free text)
  2. Non-functional requirements (free text)
  3. A whiteboard diagram (described to you in text — you cannot see the image)

You will compare their answer to the reference sample answer and the rubric, and produce a strict verdict.

SCORING GUIDELINES (enforce strictly):
- 0–20: missing or one-line answer; no engagement.
- 21–40: very weak; major requirements/components missing.
- 41–60: average; gets the basics but misses scale, trade-offs, or key components.
- 61–80: good; covers most rubric items, mentions trade-offs, reasonable diagram.
- 81–100: excellent; covers everything, strong trade-off discussion, near-production-quality reasoning.

Output ONLY a single valid JSON object. No prose before or after. No markdown fences.`;

function buildEvaluationPrompt(args: {
    question: any;
    fr: string;
    nfr: string;
    diagramSummary: string;
}): string {
    const { question, fr, nfr, diagramSummary } = args;
    const rubric = question.rubricFull || {};
    const rubricLite = question.rubricLite || {};

    const sampleAnswer = rubric.sampleAnswer || "(no sample answer provided)";
    const dimensions = Array.isArray(rubric.scoringDimensions)
        ? rubric.scoringDimensions
              .map(
                  (d: any) =>
                      `  - ${d.name} (weight ${d.weight}): ${d.criteria}`
              )
              .join("\n")
        : "  (no scoring dimensions provided — score on overall quality)";

    const required = (rubricLite.requiredComponents || []).join("; ");
    const tradeoffs = (rubricLite.keyTradeoffs || []).join("; ");
    const antiPatterns = (rubricLite.antiPatterns || []).join("; ");

    return `# Question
**Title**: ${question.title}
**Difficulty**: ${question.difficulty}
**Problem**:
${question.problemStatement}

# Reference (do NOT show this verbatim to the candidate — use it to evaluate)
**Sample Answer**:
${sampleAnswer}

**Required Components** (must mention at least most of these): ${required || "n/a"}
**Key Trade-offs** (good answers discuss several): ${tradeoffs || "n/a"}
**Anti-Patterns** (penalise if used): ${antiPatterns || "n/a"}

**Scoring Dimensions**:
${dimensions}

# Candidate's Submission

## Functional Requirements
${fr || "(empty)"}

## Non-Functional Requirements
${nfr || "(empty)"}

## Diagram (described in text)
${diagramSummary}

# Your task

Evaluate the candidate's submission strictly against the rubric. Return ONLY a JSON object with this shape:

{
  "overallScore": <integer 0..100>,
  "verdict": "<one of: 'Excellent' | 'Good' | 'Acceptable' | 'Needs Work' | 'Insufficient'>",
  "summary": "<2–4 sentences capturing the overall judgement>",
  "strengths": ["<concrete things the candidate did well>", ...],
  "improvements": ["<concrete, actionable suggestions>", ...],
  "missingComponents": ["<required components the candidate did not mention>", ...],
  "tradeoffsCovered": ["<trade-offs the candidate discussed>", ...],
  "tradeoffsMissed": ["<important trade-offs the candidate did not discuss>", ...],
  "diagramFeedback": "<short feedback on the diagram — completeness, structure, gaps>",
  "dimensionScores": [
    { "name": "<dimension>", "weight": <int>, "score": <0..100>, "feedback": "<one sentence>" }
  ]
}

Do not invent scoring dimensions that are not in the rubric. Be specific, not generic. If the candidate left fields blank, score them low and call that out explicitly in 'improvements'.`;
}

export default async function systemDesignRoutes(fastify: FastifyInstance) {
    fastify.register(async function (authFastify) {
        authFastify.addHook("preHandler", authFastify.authenticate);

        // ── GET /api/system-design/questions ──────────────────────
        authFastify.get("/system-design/questions", async (request, reply) => {
            const querySchema = z.object({
                difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
                search: z.string().optional(),
                page: z.coerce.number().int().positive().default(1),
                limit: z.coerce.number().int().positive().max(100).default(50),
            });

            const parsed = querySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid query parameters",
                    details: parsed.error.flatten(),
                });
            }

            const { difficulty, search, page, limit } = parsed.data;

            try {
                const filter: any = {};
                if (difficulty) filter.difficulty = difficulty;
                if (search && search.trim()) {
                    filter.$or = [
                        { title: { $regex: search.trim(), $options: "i" } },
                        { problemStatement: { $regex: search.trim(), $options: "i" } },
                    ];
                }

                const skip = (page - 1) * limit;

                const [questions, total] = await Promise.all([
                    SystemDesignQuestion.find(filter)
                        .select("_id slug title difficulty problemStatement")
                        .sort({ difficulty: 1, createdAt: 1 })
                        .skip(skip)
                        .limit(limit)
                        .lean(),
                    SystemDesignQuestion.countDocuments(filter),
                ]);

                const difficultyAggregation = await SystemDesignQuestion.aggregate([
                    { $group: { _id: "$difficulty", count: { $sum: 1 } } },
                ]);
                const difficultyCounts = Object.fromEntries(
                    difficultyAggregation.map((d) => [d._id, d.count])
                );

                const formattedQuestions = questions.map((q: any, idx: number) => ({
                    id: q._id.toString(),
                    slug: q.slug,
                    title: q.title,
                    difficulty: q.difficulty,
                    preview: q.problemStatement?.length > 150
                        ? q.problemStatement.substring(0, 150) + "..."
                        : q.problemStatement,
                    number: skip + idx + 1,
                }));

                reply.cacheControl("CATALOG");
                return {
                    success: true,
                    data: {
                        questions: formattedQuestions,
                        pagination: {
                            page,
                            limit,
                            total,
                            totalPages: Math.ceil(total / limit),
                        },
                        filters: { difficulties: difficultyCounts },
                    },
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    success: false,
                    error: "Failed to fetch system design questions",
                });
            }
        });

        // ── GET /api/system-design/question/:id ───────────────────
        authFastify.get("/system-design/question/:id", async (request, reply) => {
            const { id } = request.params as { id: string };

            try {
                const question = mongoose.Types.ObjectId.isValid(id)
                    ? await SystemDesignQuestion.findById(id).lean()
                    : await SystemDesignQuestion.findOne({ slug: id }).lean();
                if (!question) {
                    return reply.status(404).send({ error: "Question not found." });
                }

                reply.cacheControl("QUESTION");
                return {
                    id: question._id.toString(),
                    slug: question.slug,
                    title: question.title,
                    difficulty: question.difficulty,
                    problemStatement: question.problemStatement,
                    hints: question.hints || [],
                    followUpQuestions: question.followUpQuestions || [],
                    rubricLite: question.rubricLite,
                    sampleAnswer: (question as any).rubricFull?.sampleAnswer || null,
                    scoringDimensions:
                        (question as any).rubricFull?.scoringDimensions || [],
                    architectureDiagram: (question as any).architectureDiagram || null,
                    sampleDiagramUrl: (question as any).sampleDiagramUrl || null,
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({ error: "Failed to load question" });
            }
        });

        // ── POST /api/system-design/submit ─────────────────────────
        authFastify.post("/system-design/submit", async (request, reply) => {
            const bodySchema = z.object({
                questionId: z.string().min(1),
                functionalRequirements: z.string().max(8000).default(""),
                nonFunctionalRequirements: z.string().max(8000).default(""),
                scratchpadElements: z.array(z.any()).max(2000).optional(),
                diagramDescription: z.string().max(8000).optional(), // pre-serialized topology from frontend
            });

            const parsed = bodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid submission",
                    details: parsed.error.flatten(),
                });
            }

            const { questionId, functionalRequirements, nonFunctionalRequirements, scratchpadElements, diagramDescription } = parsed.data;

            if (!mongoose.Types.ObjectId.isValid(questionId)) {
                return reply.status(400).send({ error: "Invalid question ID." });
            }

            const userId = request.user!.id;

            try {
                const question = await SystemDesignQuestion.findById(questionId).lean();
                if (!question) {
                    return reply.status(404).send({ error: "Question not found." });
                }

                // Use the rich frontend-serialized description if provided,
                // otherwise fall back to the legacy element summariser
                const diagramSummary = diagramDescription?.trim()
                    ? diagramDescription.trim()
                    : summariseScratchpad(scratchpadElements || null);

                const prompt = buildEvaluationPrompt({
                    question,
                    fr: functionalRequirements,
                    nfr: nonFunctionalRequirements,
                    diagramSummary,
                });

                let verdict: any;
                try {
                    const result = await getGeminiClient().models.generateContent({
                        model: GEMINI_PRO_MODEL,
                        contents: prompt,
                        config: {
                            systemInstruction: SUBMIT_SYSTEM_INSTRUCTION,
                            responseMimeType: "application/json",
                            thinkingConfig: GEMINI_THINKING_HIGH,
                        },
                    });
                    const raw = result.text ?? "";
                    verdict = JSON.parse(extractJsonObject(raw));
                } catch (modelErr: any) {
                    request.log.error({ err: modelErr }, "Gemini eval failed");
                    return reply.status(502).send({
                        error: "AI review failed. Please try again in a moment.",
                    });
                }

                // Persist submission
                const doc = await SystemDesignSubmission.create({
                    userId,
                    questionId,
                    functionalRequirements,
                    nonFunctionalRequirements,
                    scratchpadElements: scratchpadElements || null,
                    verdict,
                });

                // ── Save progress if score >= 60 ──────────────────────────
                const overallScore: number = typeof verdict.overallScore === "number"
                    ? verdict.overallScore
                    : parseInt(verdict.overallScore, 10) || 0;

                if (overallScore >= 60 && request.prisma) {
                    try {
                        const progressKey = `sd-${questionId}`;
                        const existingProgress = await request.prisma.userQuestionProgress.findUnique({
                            where: { userId_questionId: { userId, questionId: progressKey } },
                        });
                        // Only upgrade status, never downgrade (once solved, stays solved)
                        const newStatus = overallScore >= 60 ? "solved" : "attempted";
                        const shouldUpgrade = !existingProgress || existingProgress.status !== "solved";

                        if (shouldUpgrade) {
                            await request.prisma.userQuestionProgress.upsert({
                                where: { userId_questionId: { userId, questionId: progressKey } },
                                update: {
                                    status: newStatus,
                                    lastAttemptedAt: new Date(),
                                    ...(!existingProgress?.solvedAt && newStatus === "solved" && { solvedAt: new Date() }),
                                    attemptCount: { increment: 1 },
                                },
                                create: {
                                    userId,
                                    questionId: progressKey,
                                    status: newStatus,
                                    ...(newStatus === "solved" && { solvedAt: new Date() }),
                                    lastAttemptedAt: new Date(),
                                    attemptCount: 1,
                                    language: "system-design",
                                },
                            });
                            // Bust the progress cache
                            await cacheDel([`ide:progress:${userId}`]);
                        }
                    } catch (progressErr) {
                        request.log.error(progressErr, "[SystemDesign] Failed to save progress");
                    }
                }

                return {
                    success: true,
                    submission: {
                        id: doc._id.toString(),
                        createdAt: doc.createdAt,
                        functionalRequirements,
                        nonFunctionalRequirements,
                        scratchpadElements: scratchpadElements || null,
                        verdict,
                    },
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({ error: "Failed to submit attempt" });
            }
        });

        // ── GET /api/system-design/submissions/:questionId ─────────
        authFastify.get("/system-design/submissions/:questionId", async (request, reply) => {
            const { questionId } = request.params as { questionId: string };
            if (!mongoose.Types.ObjectId.isValid(questionId)) {
                return reply.status(400).send({ error: "Invalid question ID." });
            }

            const userId = request.user!.id;

            try {
                const submissions = await SystemDesignSubmission.find({
                    userId,
                    questionId,
                })
                    .sort({ createdAt: -1 })
                    .limit(50)
                    .lean();

                return {
                    success: true,
                    data: submissions.map((s: any) => ({
                        id: s._id.toString(),
                        createdAt: s.createdAt,
                        functionalRequirements: s.functionalRequirements,
                        nonFunctionalRequirements: s.nonFunctionalRequirements,
                        scratchpadElements: s.scratchpadElements,
                        verdict: s.verdict,
                    })),
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({ error: "Failed to fetch submissions" });
            }
        });
    });
}
