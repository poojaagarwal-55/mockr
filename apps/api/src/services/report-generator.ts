import { prisma } from "../lib/prisma.js";
import { resolveEffectiveInterviewTypeConfig } from "./agent/interview-module-selection.js";
import { getInterviewTypeConfig } from "./agent/interview-types/index.js";
import type { InterviewType } from "@interviewforge/shared";
import type { Prisma } from "@prisma/client";
import { getGeminiClient, isGeminiBackedAvailable, GEMINI_REPORT_PRO_MODEL, GEMINI_THINKING_HIGH } from "../lib/gemini.js";
import { cacheDel, cacheDelPattern } from "../lib/redis.js";
import { DSAQuestion } from "../models/DSAQuestion.js";
import { CSFundamentalQuestion } from "../models/CSFundamentalQuestion.js";
import { GenAIConceptQuestion } from "../models/GenAIConceptQuestion.js";
import { GenAICodingQuestion } from "../models/GenAICodingQuestion.js";
import { GenAISystemDesignQuestion } from "../models/GenAISystemDesignQuestion.js";
import { DSConceptQuestion } from "../models/DSConceptQuestion.js";
import { DSCodingQuestion } from "../models/DSCodingQuestion.js";
import { PMCaseQuestion } from "../models/PMCaseQuestion.js";
import { PMConceptQuestion } from "../models/PMConceptQuestion.js";
import { PMStrategyQuestion } from "../models/PMStrategyQuestion.js";
import { SQLQuestion } from "../models/SQLQuestion.js";
import { SystemDesignQuestion } from "../models/system-design-question.js";
import { ensureMongoDBConnected } from "../lib/mongoose.js";
import { runPostSessionPipeline } from "./tutor/post-session-pipeline.js";
import { decrypt } from "../lib/encryption.js";
import { recordQuestionExposure, type QuestionSource } from "./question-exposure.js";

type RawEvalData = {
    overallScore?: unknown;
    rubricScores?: Array<{ category?: unknown; score?: unknown; feedback?: unknown }>;
    sectionFeedback?: Array<{ section?: unknown; feedback?: unknown }>;
    strengths?: unknown[];
    improvements?: Array<{ step?: unknown; title?: unknown; desc?: unknown }>;
    competencyScores?: Array<{
        id?: unknown;
        label?: unknown;
        score?: unknown;
        evidence?: unknown;
        analysis?: unknown;
        tip?: unknown;
        strength?: unknown;
    }>;
};

function exposureFromSessionQuestion(sq: any): { source: QuestionSource; questionId: string } | null {
    const category = String(sq.questionCategory || "").toLowerCase();
    if (category === "coding" && sq.questionId) return { source: "dsa", questionId: sq.questionId };
    if (category === "system_design" && sq.questionId) return { source: "system_design", questionId: sq.questionId };
    if ((category === "sql" || category === "cs_sql") && sq.questionSqlId) return { source: "cs_sql", questionId: sq.questionSqlId };
    if (category === "ds_sql" && (sq.questionSqlId || sq.questionFundamentalId)) {
        return { source: "ds_sql", questionId: sq.questionSqlId || sq.questionFundamentalId };
    }
    if (category === "cs_fundamentals" && sq.questionFundamentalId) return { source: "cs_fundamental", questionId: sq.questionFundamentalId };
    if (category === "genai_concepts" && sq.questionFundamentalId) return { source: "genai_concept", questionId: sq.questionFundamentalId };
    if (category === "genai_coding" && sq.questionFundamentalId) return { source: "genai_coding", questionId: sq.questionFundamentalId };
    if (category === "genai_system_design" && sq.questionFundamentalId) return { source: "genai_system_design", questionId: sq.questionFundamentalId };
    if (category === "ds_concepts" && sq.questionFundamentalId) return { source: "ds_concept", questionId: sq.questionFundamentalId };
    if (category === "ds_coding" && sq.questionFundamentalId) return { source: "ds_coding", questionId: sq.questionFundamentalId };
    if (category === "pm_case" && sq.questionFundamentalId) return { source: "pm_case", questionId: sq.questionFundamentalId };
    if (category === "pm_concepts" && sq.questionFundamentalId) return { source: "pm_concept", questionId: sq.questionFundamentalId };
    if (category === "pm_strategy" && sq.questionFundamentalId) return { source: "pm_strategy", questionId: sq.questionFundamentalId };
    if (category === "problem_solving_case" && sq.questionFundamentalId) return { source: "problem_solving_case", questionId: sq.questionFundamentalId };
    return null;
}

export type CompetencyStrength = "top" | "above_avg" | "average" | "below_avg" | "not_observed";

export interface CompetencyScore {
    id: string;
    label: string;
    score: number;           // 0-10
    evidence: string;        // 1-2 sentence transcript observation
    analysis: string;        // 2-3 sentence insight: what does this score reveal about the candidate?
    tip: string;             // one actionable sentence for B2C coaching
    strength: CompetencyStrength;
}

function clampScore(value: unknown, fallback = 50): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function safeText(value: unknown, fallback = ""): string {
    if (typeof value !== "string") return fallback;
    return value.trim();
}

function isNonFindingFeedback(value: string): boolean {
    const text = value.trim().toLowerCase();
    if (!text) return true;
    return (
        /\binsufficient\s+(transcript\s+)?evidence\b/.test(text) ||
        /\bnot enough\s+(information|evidence|data)\b/.test(text) ||
        /\bno\s+(clear|specific|meaningful|substantive)?\s*(strengths?|weakness(?:es)?|improvements?|evidence)\b/.test(text) ||
        /\bunable to (determine|assess|evaluate|identify)\b/.test(text) ||
        /\bcannot (determine|assess|evaluate|identify)\b/.test(text) ||
        /\bcould not (determine|assess|evaluate|identify)\b/.test(text) ||
        /\black of engagement\b/.test(text) ||
        /\bcomplete lack of engagement\b/.test(text) ||
        /\brepeated skipped questions?\b/.test(text) ||
        /\brefusals? to answer\b/.test(text)
    );
}

function normalizeCodeLanguage(language: string | null | undefined): string | null {
    const normalized = (language || "").trim().toLowerCase();
    if (!normalized) return null;
    const aliases: Record<string, string> = {
        "c++": "cpp",
        cpp: "cpp",
        py: "python",
        py3: "python3",
        python: "python",
        python3: "python3",
        js: "javascript",
        javascript: "javascript",
        ts: "typescript",
        typescript: "typescript",
        csharp: "csharp",
        "c#": "csharp",
        golang: "go",
    };
    return aliases[normalized] || normalized;
}

function extractJsonObject(raw: string): string {
    const cleaned = raw.replace(/^\uFEFF/, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first < 0 || last < 0 || last <= first) {
        throw new Error("Model response did not contain a valid JSON object");
    }
    return cleaned.slice(first, last + 1);
}

function normalizeEvalData(parsed: RawEvalData, rubricCategories: string[]) {
    const normalizedRubric = new Map<string, { score: number; feedback: string }>();

    for (const item of parsed.rubricScores || []) {
        const categoryRaw = safeText(item.category, "");
        if (!categoryRaw) continue;
        const category = categoryRaw.toLowerCase();
        if (!rubricCategories.includes(category)) continue;

        normalizedRubric.set(category, {
            score: clampScore(item.score, 50),
            feedback: safeText(item.feedback, "No category-specific feedback provided."),
        });
    }

    const rubricScores = rubricCategories.map((category) => {
        const existing = normalizedRubric.get(category);
        return {
            category,
            score: existing?.score ?? 50,
            feedback: existing?.feedback ?? "No category-specific feedback provided.",
        };
    });

    const sectionFeedback = (parsed.sectionFeedback || [])
        .map((item) => ({
            section: safeText(item.section, "Overall"),
            feedback: safeText(item.feedback, "No section feedback provided."),
        }))
        .filter((item) => item.section || item.feedback);

    const strengths = (parsed.strengths || [])
        .map((x) => safeText(x))
        .filter((text) => text && !isNonFindingFeedback(text))
        .slice(0, 8);

    const improvements = (parsed.improvements || [])
        .map((item, idx) => ({
            step: Number.isFinite(Number(item.step)) ? Number(item.step) : idx + 1,
            title: safeText(item.title, `Improvement ${idx + 1}`),
            desc: safeText(item.desc, "No details provided."),
        }))
        .filter((item) => {
            const combined = `${item.title}\n${item.desc}`;
            return item.desc !== "No details provided." && !isNonFindingFeedback(combined);
        })
        .slice(0, 8);

    const overallScore = clampScore(parsed.overallScore, Math.round(
        rubricScores.reduce((acc, r) => acc + r.score, 0) / Math.max(1, rubricScores.length)
    ));

    return {
        overallScore,
        rubricScores,
        sectionFeedback,
        strengths,
        improvements,
    };
}

const VALID_COMPETENCY_STRENGTHS = new Set<CompetencyStrength>([
    "top", "above_avg", "average", "below_avg", "not_observed",
]);

const VALID_COMPETENCY_IDS = new Set([
    "ownership_initiative", "structured_thinking", "clarifying_before_acting",
    "adaptability", "depth_of_experience", "coachability",
    "claim_ownership", "evidence_strength", "project_depth",
    "ai_ownership_clarity", "professional_framing", "role_fit_signal",
]);

function normalizeCompetencyScores(
    raw: RawEvalData["competencyScores"]
): CompetencyScore[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item) => ({
            id: safeText(item?.id),
            label: safeText(item?.label),
            score: Math.max(0, Math.min(10, Math.round(Number(item?.score) || 0))),
            evidence: safeText(item?.evidence, ""),
            analysis: safeText(item?.analysis, ""),
            tip: safeText(item?.tip, ""),
            strength: VALID_COMPETENCY_STRENGTHS.has(safeText(item?.strength) as CompetencyStrength)
                ? (safeText(item?.strength) as CompetencyStrength)
                : "not_observed",
        }))
        .filter((c) => VALID_COMPETENCY_IDS.has(c.id) && c.label.length > 0);
}

function parseResumeAnalysis(rawAnalysis: unknown): any | null {
    if (!rawAnalysis) return null;
    try {
        if (typeof rawAnalysis === "object") return rawAnalysis;
        if (typeof rawAnalysis !== "string") return null;
        try {
            return JSON.parse(decrypt(rawAnalysis));
        } catch {
            return JSON.parse(rawAnalysis);
        }
    } catch {
        return null;
    }
}

/**
 * Generates an evaluation report by analyzing the entire session transcript
 * and code snapshots using xAI Grok.
 *
 * @param sessionId - The session to evaluate
 * @param emit - Optional WebSocket emit function to notify the client when done
 */
export async function generateReport(
    sessionId: string,
    emit?: (event: string, payload: any) => void
): Promise<{ status: "generated" | "exists" | "failed"; error?: string }> {
    try {
        console.log(`[ReportGenerator] Starting report generation for session ${sessionId}`);

        if (!isGeminiBackedAvailable()) {
            throw new Error("No report model configured: set GOOGLE_GENERATIVE_AI_API_KEY or GROQ_API_KEY");
        }

        // 1. Fetch the full session context
        const session = await prisma.interviewSession.findUnique({
            where: { id: sessionId },
            select: {
                id: true,
                userId: true,
                type: true,
                role: true,
                level: true,
                mode: true,
                stage: true,
                status: true,
                startedAt: true,
                completedAt: true,
                createdAt: true,
                messages: {
                    orderBy: { createdAt: "asc" },
                },
                sessionQuestions: true,
                resume: {
                    select: { analysis: true },
                },
            },
        });

        if (!session) throw new Error(`Session ${sessionId} not found`);

        // Avoid re-generating if report already exists
        const existingReport = await prisma.evaluationReport.findUnique({
            where: { sessionId },
        });

        if (existingReport) {
            console.log(`[ReportGenerator] Session ${sessionId} already has a report, skipping.`);
            return { status: "exists" };
        }

        // 2. Fetch the corresponding type config to get scoring rubrics
        const interviewType = (session.type || "full_interview") as InterviewType;
        const configMessage = session.messages.find((message) => message.role === "system" && message.stage === "CONFIG");
        const config = resolveEffectiveInterviewTypeConfig(interviewType, (configMessage?.metadata as any)?.moduleConfig);
        const baseConfig = getInterviewTypeConfig(interviewType);
        const rubrics = baseConfig.scoringCategories || config.scoringCategories || ["communication", "problem_solving"];
        const resumeRoundReport = interviewType === "resume_round";
        const behaviouralReport = String(interviewType) === "behavioural" || String(interviewType) === "behavioral";

        // 3. Format the transcript for the LLM
        let transcriptString = "";
        for (const msg of session.messages) {
            const roleLabel = msg.role === "assistant" ? "INTERVIEWER" : "CANDIDATE";
            transcriptString += `[${msg.stage}] ${roleLabel}: ${msg.content}\n\n`;
        }

        if (!transcriptString.trim()) {
            transcriptString = "(No transcript recorded)";
        }
        // 4. Format the questions/code for the LLM (including hint usage + candidate transcript per question)
        let questionsString = "";
        let totalHintsUsed = 0;

        // Stages that belong to resume/intro/wrap-up — never part of a question's exchange
        const NON_QUESTION_STAGES = new Set(["INTRO", "CLOSING", "BEHAVIOURAL"]);

        // Compute the earliest askedAt across all questions — used as a global lower bound
        // so Q1 (which may have a null askedAt if set before the first socket ack) doesn't
        // accidentally include the entire INTRO/resume-analysis phase.
        const firstQAskedAt = session.sessionQuestions
            .map((sq) => sq.askedAt ? new Date(sq.askedAt).getTime() : null)
            .filter((t): t is number => t !== null)
            .reduce((min, t) => Math.min(min, t), Infinity);
        const globalLowerBound = Number.isFinite(firstQAskedAt) ? firstQAskedAt : null;

        // Build a map of question title → candidate responses from transcript
        // We extract candidate messages that appear after the interviewer asks each question
        const messages = session.messages;
        for (let i = 0; i < session.sessionQuestions.length; i++) {
            const sq = session.sessionQuestions[i];
            const hintsUsed = sq.hintsUsed ?? 0;
            totalHintsUsed += hintsUsed;
            const qTitle = sq.questionTitle || (sq.questionFundamentalId ? "Question" : "Unknown");
            const qCategory = sq.questionCategory || (
                sq.questionFundamentalId
                    ? (interviewType === "gen_ai_role" ? "genai_concepts" : "cs_fundamentals")
                    : "Unknown"
            );

            questionsString += `### Question ${i + 1}: ${qTitle} (${qCategory})\n`;

            if (hintsUsed > 0) {
                questionsString += `**Hints used: ${hintsUsed}** (each hint should reduce the problem_solving score)\n`;
            }

            // Extract candidate's transcript responses for this question.
            // Lower bound: question's own askedAt OR the global first-question lower bound
            // (prevents INTRO/resume messages from leaking into Q1 when askedAt is null).
            const askedAt = sq.askedAt ? new Date(sq.askedAt).getTime() : globalLowerBound;
            const nextQuestion = session.sessionQuestions[i + 1];
            const nextAskedAt = nextQuestion?.askedAt ? new Date(nextQuestion.askedAt).getTime() : null;

            const candidateResponses = messages
                .filter((m) => {
                    if (m.role !== "user") return false;
                    // Exclude messages from non-question stages (INTRO, CLOSING, etc.)
                    if (m.stage && NON_QUESTION_STAGES.has(m.stage)) return false;
                    const msgTime = new Date(m.createdAt).getTime();
                    if (askedAt && msgTime < askedAt) return false;
                    if (nextAskedAt && msgTime > nextAskedAt) return false;
                    return true;
                })
                .map((m) => m.content.trim())
                .filter(Boolean);

            if (candidateResponses.length > 0) {
                questionsString += `**Candidate's Response:**\n${candidateResponses.join("\n")}\n`;
            } else {
                questionsString += `**Candidate's Response:** (no response recorded)\n`;
            }

            if (sq.finalCode) {
                questionsString += `**Candidate's Code:**\nBEGIN_CANDIDATE_CODE\n${sq.finalCode}\nEND_CANDIDATE_CODE\n`;
            }
            questionsString += "\n";
        }

        // 4b. Load rubricFull from MongoDB for system design interviews
        let rubricFullContext = "";
        if (interviewType === "system_design") {
            try {
                // Dynamic import — only loads mongoose when actually needed
                const { connectMongoDB } = await import("../lib/mongodb.js");
                const { SystemDesignQuestion } = await import("../models/system-design-question.js");
                await connectMongoDB();
                // Find the system design question using the questionId stored in session_questions
                for (const sq of session.sessionQuestions) {
                    const qId = sq.questionId;
                    if (!qId) continue;
                    // Try to find by _id or slug
                    const sdQuestion = await SystemDesignQuestion.findOne({
                        $or: [
                            { slug: qId },
                            ...(qId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: qId }] : []),
                        ],
                    }).lean();
                    if (sdQuestion?.rubricFull) {
                        const rf = sdQuestion.rubricFull as any;
                        rubricFullContext += `\n### Reference Answer for "${sdQuestion.title}":\n${rf.sampleAnswer || "(no sample answer)"}\n`;
                        if (rf.scoringDimensions?.length) {
                            rubricFullContext += `\nScoring dimensions:\n`;
                            for (const dim of rf.scoringDimensions) {
                                rubricFullContext += `- ${dim.name} (weight: ${dim.weight}): ${dim.criteria}\n`;
                            }
                        }
                    }
                }
            } catch (mongoErr) {
                console.error("[ReportGenerator] Failed to load rubricFull from MongoDB:", mongoErr);
            }
        }

        // 5. Build the eval prompt
        const hintPenaltyNote = totalHintsUsed > 0
            ? `\nIMPORTANT HINT PENALTY: The candidate used ${totalHintsUsed} total hint(s) across all questions. Apply a scoring penalty to the "problem_solving" category:\n- 1 hint: deduct ~5-8 points\n- 2 hints: deduct ~10-15 points\n- 3+ hints: deduct ~15-25 points\nThis reflects that the candidate needed assistance to progress.\n`
            : "";

        const prompt = `
You are a realistic senior interviewer evaluating a candidate for an interview-practice platform.
Most users are freshers or early-career candidates, so give fair credit for correct reasoning, honest partial attempts, and recoveries after mistakes. Still be serious: skipped questions, refusals, and empty answers must receive very low scores.
Never invent positive observations to soften the feedback. Repeated skips, refusals, one-word replies, or empty answers are non-engagement, not willingness to engage, coachability, communication strength, or ownership.

Candidate details:
- Role: ${session.role}
- Level: ${session.level}
- Interview Type: ${config.label}

Evaluate on these specific categories:
${rubrics.map(r => `- ${r}`).join("\n")}

IMPORTANT: In rubricScores[].category, return ONLY the exact category tokens listed above (lowercase snake_case).
${hintPenaltyNote}
SCORING REMINDER: Non-answers ("no", "don't know", "don't care", silence) = 0-10. Deflection/skipping = 0-15. Incorrect but genuine attempts = 20-40. Reasonable partial understanding = 45-65. Solid fresher-level answers = 66-80. Give 90+ only when the candidate is bang on: precise, complete, and well-communicated.
HONESTY REMINDER: Strengths must be supported by transcript evidence. If the candidate skipped most questions, refused examples, gave no concrete stories, or gave no substantive answer, return "strengths": []. Do NOT write "insufficient evidence" or any explanation inside strengths.
WEAKNESS DISCIPLINE:
- Never convert a strength into a weakness just because the report needs content.
- A weakness must describe a real gap, error, unsupported claim, missing evidence, refusal, confusion, or low-scoring behavior from the transcript.
- If a category score is 70 or higher, its feedback must not be written as a weakness. It may still include a small refinement, but the main feedback should reflect the strong/adequate performance.
- If there are no genuine weaknesses or no transcript-supported improvement steps, return an empty improvements array. Do not invent filler improvement steps.
- Do NOT put "insufficient evidence", "no clear weakness", "unable to determine", "lack of engagement", skipped-question summaries, or refusal summaries in strengths or improvements. Empty arrays are correct when there is no valid item.
- Do not create weaknesses such as "be broader", "ask more clarifying questions", or "prepare other projects" unless the transcript directly shows that gap.

AI TOOL PROFICIENCY RULES:
- If ai_tool_proficiency is one of the rubric categories, score demonstrated ownership, verification, and responsible AI collaboration; do not rely on self-report alone.
- A denial of AI use is not automatically good or bad. If the candidate cannot explain key code paths, guards, edge cases, or verification after submitting working code, score low because ownership could not be verified.
- In feedback, avoid asserting that the candidate lied or secretly used AI. Say "ownership could not be verified" or "the claim was not supported by follow-up answers" unless the transcript explicitly proves misuse.
- Passing visible/hidden tests alone is not evidence of strong AI tool proficiency; reward the ability to explain, test, debug, and critique the submitted solution.
${resumeRoundReport ? `
For resume_round reports:
- Treat this as a section-based resume screening evaluation, not a question-bank interview.
- In sectionFeedback, include sections named exactly: "Screening Summary", "Strong Evidence", "Weak Claims", "Needs Better Story", "Possible Resume Risk", and "Answer Bank".
- "Screening Summary" must be plain-language and useful: summarize the main verified claims, the main unverified areas, and whether the candidate is currently interview-ready from this resume.
- Do NOT include fraction-style coverage counts like "8/17", "0/1", "6 of 11", or "out of 30". They are not useful to the candidate.
- "Strong Evidence" should list claims supported by transcript specifics.
- "Weak Claims" should list claims that remained vague or unsupported.
- "Possible Resume Risk" must avoid accusations; phrase as "could not be verified" or "needs stronger evidence".
- "Answer Bank" should give 2-4 concise STAR-style answer improvements for the candidate's own projects/work.
- "Answer Bank" must be clean plain text with labels, not markdown. Do NOT use **bold markers**, headings, or markdown bullets.
- Preferred Answer Bank format:
  1. Original answer: quote or paraphrase the candidate's weak answer in one short line.
  2. Stronger answer - Situation and task: show how they could frame context and ownership.
  3. Stronger answer - Action: show a concrete technical/action walkthrough.
  4. Stronger answer - Result: show how to close with evidence, but only use metrics, datasets, users, or outcomes actually present in the transcript. If no metric was given, write "I would add the measured result here once I verify it" instead of inventing one.
- Do not fabricate datasets, scores, company names, model results, user counts, or achievements in the Answer Bank.
` : ""}

====== FULL TRANSCRIPT ======
${transcriptString}
=============================

====== QUESTIONS WITH CANDIDATE RESPONSES ======
${questionsString}
================================================
${rubricFullContext ? `
====== REFERENCE RUBRIC (System Design) ======
${rubricFullContext}
===============================================
` : ""}
Output ONLY valid JSON:
{
  "overallScore": number (0-100, must match weighted average of rubric scores),
  "rubricScores": [
    {
       "category": "string (exact token from list above)",
       "score": number (0-100, apply scoring guidelines strictly),
       "feedback": "string (cite specific transcript evidence for the score)"
    }
  ],
  "sectionFeedback": [
    {
       "section": "string",
       "feedback": "string (reference specific moments from transcript)"
    }
  ],
  "strengths": ["string (only genuine transcript-supported strengths; use [] when no real strength is evidenced; never include insufficient-evidence/no-engagement explanations)"],
  "improvements": [
    {
      "step": number,
      "title": "string",
      "desc": "string (specific, actionable, only for a real transcript-supported gap; use [] if there is no genuine weakness; never include insufficient-evidence/no-engagement explanations)"
    }
  ],
  "competencyScores": [
    {
      "id": "exact_id_from_competency_list",
      "label": "Human Readable Label",
      "score": number (0-10),
      "evidence": "1-2 sentence direct observation from the transcript. What did the candidate actually say or do? Empty string if not_observed.",
      "analysis": "2-3 sentences of insight: what does this score reveal about the candidate's thinking pattern, interview instincts, or professional maturity? Be specific to their actual performance — do not give generic statements. Empty string if not_observed.",
      "tip": "One specific, actionable sentence the candidate can act on before their next mock interview. For not_observed, say what they should try to demonstrate and how.",
      "strength": "top|above_avg|average|below_avg|not_observed"
    }
  ]
}
`;

        const competencyPromptSection = resumeRoundReport ? `
====== RESUME SCREENING SIGNAL SCORING ======
In addition to rubric scores, evaluate the candidate on these 6 resume-specific interview signals.
These replace the generic interview-signal categories for resume_round reports.

Score each signal 0-10 and assign a strength label:
  8-10 -> "top"  |  6-7 -> "above_avg"  |  4-5 -> "average"  |  2-3 -> "below_avg"
  0-1 or insufficient transcript evidence -> "not_observed" (never guess)

For EACH signal, you MUST generate:
- "evidence": 1-2 sentences grounded in transcript specifics.
- "analysis": 2-3 sentences explaining what this reveals about resume readiness.
- "tip": One specific action before the next resume round.

SIGNALS:
- claim_ownership (Claim Ownership): Clearly separates what the candidate personally did from team work, tools, tutorials, or AI assistance.
- evidence_strength (Evidence Strength): Supports resume claims with concrete proof such as implementation details, metrics, users, tests, deployment, or outcomes.
- project_depth (Project Depth): Explains selected projects beyond surface level: what, why, architecture, implementation details, tradeoffs, failures, and rebuild choices.
- ai_ownership_clarity (AI Ownership Clarity): Explains how AI tools were used, what was generated, what was changed or rejected, and how correctness was verified.
- professional_framing (Professional Framing): Describes users, customers, stakeholders, and resume risks with mature, respectful, interview-ready wording.
- role_fit_signal (Role Fit Signal): Connects resume evidence to the target role with credible proof points instead of broad claims.
==========================================
` : behaviouralReport ? `
====== BEHAVIOURAL COMPETENCY SCORING ======
In addition to rubric scores, evaluate the candidate on these 6 student-friendly interview signals.
Give DOUBLE WEIGHT to evidence from [INTRO] stage messages — resume discussion is the
strongest signal of real-world work quality and is currently under-represented.

Score each competency 0-10 and assign a strength label:
  8-10 → "top"  |  6-7 → "above_avg"  |  4-5 → "average"  |  2-3 → "below_avg"
  0-1 or insufficient transcript evidence → "not_observed" (never guess)

For EACH competency, you MUST generate:
- "evidence": 1-2 sentences quoting or paraphrasing what the candidate actually said/did. Empty string if not_observed.
- "analysis": 2-3 sentences of real insight — what does this score reveal about the candidate's thinking style, interview instincts, or professional maturity? Reference specific moments from the transcript. Empty string if not_observed.
- "tip": One specific, actionable sentence they can act on before their next mock. Be concrete — reference the actual gap.
  For "top" strength: a micro-refinement tip (e.g. "You're strong here — try also stating the Big-O tradeoff explicitly before committing.").
  For "not_observed": explain what they should try to actively do next session (e.g. "In your next mock, answer one STAR story with the specific situation, your personal action, the result, and what you learned.").

Use behavioral-native wording in the report: ownership, STAR clarity, impact and reflection, adaptability, specific evidence, and coachability. Do not frame behavioral feedback as code, architecture, or technical implementation feedback unless the interview type was technical.
For behavioral interviews with repeated "skip", "no", refusal, abusive replies, or one-word answers, mark unsupported signals as "not_observed" or very low. Do not write praise such as "willingness to engage" unless the transcript contains actual substantive answers.
For behavioral sectionFeedback, do not call it a question breakdown. Summarize story evidence in sections such as "Story Specificity", "Ownership Evidence", "Impact and Reflection", "Communication Pattern", and "Next Practice Focus".

COMPETENCIES:
- ownership_initiative (Ownership & Initiative): Gives specific examples of taking responsibility, making decisions, and following through under real constraints
- structured_thinking (STAR Structure): Frames answers with clear situation, task, personal action, and result instead of rambling or staying abstract
- clarifying_before_acting (Impact & Reflection): Explains why the situation mattered, what changed because of the candidate's actions, what they learned, and what they would do differently
- adaptability (Pivot Instinct): Instinctively adjusts approach when new constraints, interviewer pushback, or follow-up questions appear
- depth_of_experience (Specific Evidence): Provides concrete personal actions, outcomes, learning, and reflection instead of generic claims
- coachability: Notices interviewer hints or feedback and improves the answer based on them
============================================
` : `
====== INTERVIEW SIGNAL SCORING ======
In addition to rubric scores, evaluate the candidate on these 6 interview-practice signals.

Score each competency 0-10 and assign a strength label:
  8-10 -> "top"  |  6-7 -> "above_avg"  |  4-5 -> "average"  |  2-3 -> "below_avg"
  0-1 or insufficient transcript evidence -> "not_observed" (never guess)

For EACH competency, you MUST generate:
- "evidence": 1-2 sentences quoting or paraphrasing what the candidate actually said/did. Empty string if not_observed.
- "analysis": 2-3 sentences of specific insight about the candidate's technical interview habits. Empty string if not_observed.
- "tip": One specific, actionable sentence they can act on before their next mock.

COMPETENCIES:
- ownership_initiative (Conviction & Drive): Shows conviction, ownership, and decisive action when discussing work, handling pressure, or navigating ambiguity
- structured_thinking (Problem Deconstruction): Breaks complex problems into clear sub-problems, reasons from first principles, and avoids pattern-matching or random guessing
- clarifying_before_acting: Asks clarifying questions before jumping into an answer or solution
- adaptability (Pivot Instinct): Instinctively adjusts approach when new constraints, interviewer pushback, or follow-up questions appear
- depth_of_experience (Applied Knowledge): Demonstrates hands-on depth by explaining resume/projects beyond surface level - the why, how, tradeoffs, and real impact
- coachability: Notices interviewer hints or feedback and improves the answer based on them
============================================
`;

        // 6. Call Gemini Pro with strict scoring
        console.log(`[ReportGenerator] Calling Gemini Pro for session ${sessionId}...`);

        const systemInstruction = `You are a realistic, senior interviewer and hiring-bar evaluator.
Evaluate interview-practice transcripts with firm but fair scoring. Most candidates are freshers or early-career, so do not punish minor wording gaps when the underlying reasoning is correct. However, do not reward skipping, refusal, or empty answers.

SCORING GUIDELINES:
- 0-10: Complete non-engagement. Candidate said "no", "don't know", "don't care", or refused to answer. No attempt made.
- 11-25: Minimal engagement. Candidate gave one-word answers, showed no understanding, or deflected every question.
- 26-40: Poor performance. Candidate made a genuine attempt but showed fundamental misunderstanding or very incomplete answers.
- 41-55: Below average. Candidate showed some knowledge but significant gaps, incomplete solutions, or needed heavy hints.
- 56-70: Fair/average for a fresher. Candidate demonstrated basic competency with some gaps.
- 71-85: Good. Candidate showed solid understanding, mostly correct answers, and clear communication.
- 86-100: Excellent. Candidate was bang on: correct, complete, precise, and communicated tradeoffs clearly.

CRITICAL RULES:
- Do not invent positives. Repeated skips/refusals mean insufficient evidence, not "willingness to engage" or "coachability".
- For top-level strengths, insufficient evidence means return an empty strengths array. Never write insufficient-evidence language as a strength.
- For top-level improvements, only return actionable fixes tied to a real observed gap. If the only observation is that the candidate did not answer, return an empty improvements array.
- If transcript evidence is absent, mark the competency as not_observed or low and state the missing evidence plainly.
- If a candidate answered "no", "don't know", "don't care" to a question → score that category 0-10. No exceptions.
- If a candidate skipped or deflected questions → score 0-15 for those categories.
- Be a little generous for sincere fresher-level partial attempts, but never give participation marks for non-answers.
- The overall score must reflect the weighted average of rubric scores. If rubric scores are 10, 12, 8 — overall should be ~10, NOT 25.
- Full marks require complete correctness, not just effort.

Output ONLY valid JSON matching the requested structure (no markdown fences, no extra text).
In rubricScores[].category, return ONLY exact category tokens provided (lowercase snake_case).`;
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_REPORT_PRO_MODEL,
            contents: prompt + competencyPromptSection,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                thinkingConfig: GEMINI_THINKING_HIGH,
            },
        });
        const rawJson = result.text ?? "";
        const parsed = JSON.parse(extractJsonObject(rawJson)) as RawEvalData;
        const evalData = normalizeEvalData(parsed, rubrics);
        if (resumeRoundReport) {
            evalData.sectionFeedback = evalData.sectionFeedback
                .map((section: any) => {
                    const title = String(section?.section || section?.stage || "");
                    if (title.toLowerCase() === "coverage summary") {
                        return { ...section, section: "Screening Summary" };
                    }
                    return section;
                })
                .filter((section: any) => {
                    const text = `${section?.section || ""}\n${section?.feedback || ""}`;
                    return !/\b\d+\s*\/\s*\d+\b|\b\d+\s+of\s+\d+\b|\bout\s+of\s+\d+\b/i.test(text);
                });
        }
        const competencyScores = normalizeCompetencyScores(parsed.competencyScores);
        console.log(`[ReportGenerator] Competency scores parsed: ${competencyScores.length} competencies for session ${sessionId}`);
        // DSA/coding questions: show finalCode only (no noisy back-and-forth), fetch real
        //   per-language solution code from MongoDB.
        // CS Fundamentals / other: keep full conversation exchange (Q&A is the answer).

        // --- Resolve language per DSA question from session messages ---
        // We capture explicit code-submitted breadcrumbs and persisted code result messages.
        const CODE_RUN_RE = /(?:\[CODE SUBMITTED\].*?\bmy\s+(\w[\w+#.-]*)\s+code|\[Code\s+(?:Run|Submit)\s+Result\s+in\s+(\w[\w+#.-]*))/i;

        // Strip LeetCode compatibility preamble (try/except NameError shims for cache, pairwise, etc.)
        // These appear before "class Solution" in some LeetCode Python entries and are not user-relevant.
        function stripLeetCodePreamble(code: string): string {
            // Find the first occurrence of "class Solution" and return from there onwards
            const classIdx = code.indexOf("class Solution");
            if (classIdx > 0) return code.slice(classIdx);
            // For non-Python languages there's no preamble ? return as-is
            return code;
        }

        const genAICategories = new Set(["genai_concepts", "genai_coding", "genai_system_design"]);
        const dsSolutionCategories = new Set(["ds_concepts", "ds_sql", "ds_coding"]);
        const pmScenarioCategories = new Set(["pm_case", "pm_strategy"]);
        const hasMongoBackedQuestion = session.sessionQuestions.some(
            (sq) => (sq.questionCategory === "coding" && sq.questionId) ||
                sq.questionCategory === "cs_fundamentals" ||
                genAICategories.has(sq.questionCategory || "") ||
                dsSolutionCategories.has(sq.questionCategory || "") ||
                pmScenarioCategories.has(sq.questionCategory || "") ||
                sq.questionCategory === "pm_concepts"
        );
        if (hasMongoBackedQuestion) {
            try { await ensureMongoDBConnected(); } catch { /* non-fatal */ }
        }

        const resolveGenAIReportAnswer = async (sq: any): Promise<string | null> => {
            const mongoId = sq.questionFundamentalId || sq.questionId;
            if (!mongoId) return null;

            try {
                if (sq.questionCategory === "genai_concepts") {
                    const doc = await GenAIConceptQuestion.findById(mongoId)
                        .select("detailedAnswer answer")
                        .lean();
                    return (doc?.detailedAnswer || doc?.answer || null) as string | null;
                }

                if (sq.questionCategory === "genai_coding") {
                    const doc = await GenAICodingQuestion.findById(mongoId)
                        .select("detailedSolution")
                        .lean();
                    return (doc?.detailedSolution || null) as string | null;
                }

                if (sq.questionCategory === "genai_system_design") {
                    const doc = await GenAISystemDesignQuestion.findById(mongoId)
                        .select("rubricFull")
                        .lean();
                    const rubricFull = (doc?.rubricFull || {}) as any;
                    return (rubricFull.detailedAnswer || rubricFull.sampleAnswer || null) as string | null;
                }
            } catch (mongoErr) {
                console.error("[ReportGenerator] Failed to fetch GenAI report answer:", mongoErr);
            }

            return null;
        };

        const resolveDSReportAnswer = async (sq: any): Promise<string | null> => {
            const mongoId = sq.questionCategory === "ds_sql"
                ? (sq.questionSqlId || sq.questionFundamentalId || sq.questionId)
                : (sq.questionFundamentalId || sq.questionId);
            if (!mongoId) return null;

            try {
                if (sq.questionCategory === "ds_concepts") {
                    const doc = await DSConceptQuestion.findById(mongoId)
                        .select("detailedAnswer referenceAnswer")
                        .lean() as any;
                    return (doc?.detailedAnswer || doc?.referenceAnswer || null) as string | null;
                }

                if (sq.questionCategory === "ds_sql") {
                    const doc = await SQLQuestion.findOne({
                        $or: [{ _id: mongoId }, { questionId: mongoId }],
                    }).select("solution").lean() as any;
                    return typeof doc?.solution === "string"
                        ? doc.solution
                        : doc?.solution
                            ? JSON.stringify(doc.solution, null, 2)
                            : null;
                }

                if (sq.questionCategory === "ds_coding") {
                    const doc = await DSCodingQuestion.findOne({
                        $or: [{ _id: mongoId }, { questionId: mongoId }],
                    }).select("solution sampleSolution").lean() as any;
                    const solution = doc?.solution || doc?.sampleSolution;
                    return typeof solution === "string"
                        ? solution
                        : solution
                            ? JSON.stringify(solution, null, 2)
                            : null;
                }
            } catch (mongoErr) {
                console.error("[ReportGenerator] Failed to fetch DS report answer:", mongoErr);
            }

            return null;
        };

        const resolveCSReportAnswer = async (sq: any): Promise<string | null> => {
            const mongoId = sq.questionFundamentalId || sq.questionId;
            if (!mongoId || sq.questionCategory !== "cs_fundamentals") return null;

            try {
                const doc = await CSFundamentalQuestion.findById(mongoId)
                    .select("detailedAnswer answer")
                    .lean() as any;
                return (doc?.detailedAnswer || doc?.answer || null) as string | null;
            } catch (mongoErr) {
                console.error("[ReportGenerator] Failed to fetch CS detailedAnswer:", mongoErr);
            }

            return null;
        };

        const resolvePMScenarioTitle = async (sq: any): Promise<string | null> => {
            const mongoId = sq.questionFundamentalId || sq.questionId;
            if (!mongoId) return null;

            try {
                if (sq.questionCategory === "pm_case") {
                    const doc = await PMCaseQuestion.findById(mongoId)
                        .select("scenario title")
                        .lean() as any;
                    return (doc?.scenario || doc?.title || null) as string | null;
                }

                if (sq.questionCategory === "pm_strategy") {
                    const doc = await PMStrategyQuestion.findById(mongoId)
                        .select("scenario title")
                        .lean() as any;
                    return (doc?.scenario || doc?.title || null) as string | null;
                }
            } catch (mongoErr) {
                console.error("[ReportGenerator] Failed to fetch PM scenario title:", mongoErr);
            }

            return null;
        };

        const resolvePMDetailedAnswer = async (sq: any): Promise<string | null> => {
            const mongoId = sq.questionFundamentalId || sq.questionId;
            if (!mongoId) return null;
            try {
                if (sq.questionCategory === "pm_concepts") {
                    const doc = await PMConceptQuestion.findById(mongoId).select("detailedAnswer").lean() as any;
                    return doc?.detailedAnswer || null;
                }
                if (sq.questionCategory === "pm_case") {
                    const doc = await PMCaseQuestion.findById(mongoId).select("detailedAnswer").lean() as any;
                    return doc?.detailedAnswer || null;
                }
                if (sq.questionCategory === "pm_strategy") {
                    const doc = await PMStrategyQuestion.findById(mongoId).select("detailedAnswer").lean() as any;
                    return doc?.detailedAnswer || null;
                }
            } catch (mongoErr) {
                console.error("[ReportGenerator] Failed to fetch PM detailedAnswer:", mongoErr);
            }
            return null;
        };

        const dedupedSessionQuestions = Array.from(
            session.sessionQuestions.reduce((map, sq) => {
                const key = sq.questionId || sq.questionSqlId || sq.questionFundamentalId || sq.id;
                if (!map.has(key)) {
                    map.set(key, sq);
                }
                return map;
            }, new Map<string, (typeof session.sessionQuestions)[number]>()).values()
        );

        const questionBreakdown = await Promise.all(dedupedSessionQuestions.map(async (sq, i) => {
            const askedAt = sq.askedAt ? new Date(sq.askedAt).getTime() : globalLowerBound;
            const nextSq = dedupedSessionQuestions[i + 1];
            const nextAskedAt = nextSq?.askedAt ? new Date(nextSq.askedAt).getTime() : null;

            const isCodingQuestion = sq.questionCategory === "coding";
            const genAIReportAnswer = await resolveGenAIReportAnswer(sq);
            const dsReportAnswer = await resolveDSReportAnswer(sq);
            const csReportAnswer = await resolveCSReportAnswer(sq);
            const pmScenarioTitle = await resolvePMScenarioTitle(sq);
            const pmDetailedAnswer = await resolvePMDetailedAnswer(sq);

            // DSA / Coding phase
            if (isCodingQuestion) {
                let detectedLanguage: string | null = null;
                for (const m of session.messages) {
                    if (m.role !== "user") continue;
                    if (m.stage && NON_QUESTION_STAGES.has(m.stage)) continue;
                    const t = new Date(m.createdAt).getTime();
                    if (askedAt && t < askedAt) continue;
                    if (nextAskedAt && t > nextAskedAt) continue;
                    const match = CODE_RUN_RE.exec(m.content);
                    if (match) {
                        detectedLanguage = normalizeCodeLanguage(match[1] || match[2]);
                    }
                }

                // Fetch real solution code from MongoDB for the detected language
                let solutionCode: string | null = null;
                if (sq.questionId) {
                    try {
                        const dsaDoc = await DSAQuestion.findById(sq.questionId)
                            .select("solution")
                            .lean();
                        if (dsaDoc?.solution) {
                            // Try optimized first, then brute force
                            for (const approach of ["optimized", "bruteForce"] as const) {
                                const codeMap = (dsaDoc.solution as any)?.[approach]?.code;
                                if (!codeMap) continue;
                                // codeMap is a Mongoose Map → object after .lean()
                                const codeObj: Record<string, string> =
                                    codeMap instanceof Map
                                        ? Object.fromEntries(codeMap)
                                        : (typeof codeMap === "object" ? codeMap : {});
                                if (detectedLanguage && codeObj[detectedLanguage]) {
                                    solutionCode = stripLeetCodePreamble(codeObj[detectedLanguage]);
                                    break;
                                }
                                // Fallback: any available language (prefer python → javascript → cpp)
                                for (const fallback of ["python", "python3", "javascript", "cpp", "java"]) {
                                    if (codeObj[fallback]) {
                                        solutionCode = stripLeetCodePreamble(codeObj[fallback]);
                                        break;
                                    }
                                }
                                if (solutionCode) break;
                            }
                        }
                    } catch (mongoErr) {
                        console.error("[ReportGenerator] Failed to fetch DSA solution code:", mongoErr);
                    }
                }

                return {
                    id: sq.id,
                    questionId: sq.questionId || null,
                    title: sq.questionTitle || "Unknown Question",
                    category: sq.questionCategory || "unknown",
                    difficulty: sq.questionDifficulty || null,
                    finalCode: sq.finalCode || null,
                    codeLanguage: detectedLanguage,
                    score: sq.score ? Number(sq.score) : null,
                    aiNotes: sq.aiNotes || null,
                    timeSpent: sq.timeSpent || null,
                    askedAt: sq.askedAt?.toISOString() || null,
                    // Real solution code instead of text hint
                    sampleAnswer: solutionCode || sq.sampleAnswer || null,
                    // Coding questions: no noisy back-and-forth exchange — finalCode tells the story
                    conversationExchange: null,
                };
            }

            // ── CS Fundamentals / System Design / Other ───────────────────────────────
            // Full conversation exchange preserved (the Q&A dialogue is the answer)
            const exchangeMessages = session.messages
                .filter((m) => {
                    if (m.role !== "user" && m.role !== "assistant") return false;
                    if (m.stage && NON_QUESTION_STAGES.has(m.stage)) return false;
                    const t = new Date(m.createdAt).getTime();
                    if (askedAt && t < askedAt) return false;
                    if (nextAskedAt && t > nextAskedAt) return false;
                    return true;
                })
                .map((m) => ({
                    role: m.role === "assistant" ? "interviewer" : "candidate",
                    content: m.content.trim(),
                }))
                .filter((m) => m.content.length > 0);

            // Fetch sampleDiagramUrl for system design questions
            let sampleDiagramUrl: string | null = null;
            if (sq.questionId && (interviewType === "system_design" || sq.questionCategory === "system_design")) {
                try {
                    const sdDoc = await SystemDesignQuestion.findById(sq.questionId)
                        .select("sampleDiagramUrl")
                        .lean() as any;
                    sampleDiagramUrl = sdDoc?.sampleDiagramUrl || null;
                } catch { /* non-fatal */ }
            }

            return {
                id: sq.id,
                questionId: sq.questionId || sq.questionSqlId || sq.questionFundamentalId || null,
                title: pmScenarioTitle || sq.questionTitle || "Unknown Question",
                category: sq.questionCategory || "unknown",
                difficulty: sq.questionDifficulty || null,
                finalCode: sq.finalCode || null,
                codeLanguage: null,
                score: sq.score ? Number(sq.score) : null,
                aiNotes: sq.aiNotes || null,
                timeSpent: sq.timeSpent || null,
                askedAt: sq.askedAt?.toISOString() || null,
                sampleAnswer: pmDetailedAnswer || dsReportAnswer || genAIReportAnswer || csReportAnswer || (sq as any).sampleAnswer || null,
                sampleDiagramUrl,
                // Full exchange scoped to this question's window only
                conversationExchange: exchangeMessages.length > 0 ? exchangeMessages : null,
            };
        }));

        // 8. Save the report to the database (with denormalized questions)
        let report;
        try {
            report = await prisma.evaluationReport.create({
                data: {
                    sessionId: session.id,
                    userId: session.userId,
                    overallScore: evalData.overallScore,
                    rubricScores: evalData.rubricScores,
                    sectionFeedback: evalData.sectionFeedback,
                    strengths: evalData.strengths,
                    improvements: evalData.improvements,
                    competencyScores: competencyScores.length > 0 ? competencyScores as unknown as Prisma.InputJsonValue : undefined,
                    questions: questionBreakdown,
                },
            });
        } catch (createError: any) {
            // Concurrent report creation race: treat unique sessionId conflict as "exists".
            if (createError?.code === "P2002") {
                const existing = await prisma.evaluationReport.findUnique({ where: { sessionId } });
                if (existing) {
                    return { status: "exists" };
                }
            }
            throw createError;
        }

        // 9. Mark session as completed (if not already)
        await prisma.interviewSession.update({
            where: { id: sessionId },
            data: {
                status: "COMPLETED",
                completedAt: session.completedAt || new Date(),
            },
            select: { id: true },
        });

        // 10. Flush session_questions — data is now denormalized into the report
        // This keeps the session_questions table lean (only active sessions have rows)
        for (const sq of session.sessionQuestions) {
            const exposure = exposureFromSessionQuestion(sq);
            if (!exposure) continue;
            await recordQuestionExposure({
                userId: session.userId,
                questionSource: exposure.source,
                questionId: exposure.questionId,
                sessionId: session.id,
            });
        }

        await prisma.sessionQuestion.deleteMany({
            where: { sessionId: session.id },
        });
        console.log(`[ReportGenerator] Flushed ${session.sessionQuestions.length} session_questions for session ${sessionId}`);

        // 8.5. Invalidate specific Redis Caches
        try {
            await cacheDel([
                `api:users:${session.userId}:profile`,
                `api:users:${session.userId}:stats`,
            ]);
            await cacheDelPattern(`api:users:${session.userId}:reports:*`);
            await cacheDelPattern(`api:users:${session.userId}:activity:*`);
        } catch (err) {
            console.error(`[ReportGenerator] Failed to clear user cache upon report creation:`, err);
        }

        // 9. Notify the client that the report is ready
        if (emit) {
            emit("session:report-ready", {
                reportId: report.id,
                report: {
                    id: report.id,
                    sessionId: report.sessionId,
                    userId: report.userId,
                    overallScore: Number(report.overallScore),
                    rubricScores: report.rubricScores,
                    sectionFeedback: report.sectionFeedback,
                    strengths: report.strengths,
                    improvements: report.improvements,
                    competencyScores: report.competencyScores ?? null,
                    benchmark: report.benchmark ?? null,
                    generatedAt: report.generatedAt.toISOString(),
                },
            });
        }

        console.log(`[ReportGenerator] Successfully generated report for session ${sessionId}`);

        // 11. Fire-and-forget the tutor post-session pipeline.
        // Extracts weak areas + mistakes into the tutor knowledge base. Failures
        // here must never block report delivery — the user already has the report.
        const pipelineReportId = report.id;
        const pipelineUserId = session.userId;
        Promise.resolve()
            .then(() => runPostSessionPipeline(pipelineReportId))
            .then((res) => {
                if (res.errors.length > 0) {
                    console.warn(`[PostSessionPipeline] completed with errors`, {
                        reportId: pipelineReportId,
                        userId: `user-${pipelineUserId.slice(0, 8)}`,
                        weakAreas: res.weakAreasUpserted,
                        mistakes: res.mistakesInserted,
                        errors: res.errors,
                    });
                } else {
                    console.log(
                        `[PostSessionPipeline] ok report=${pipelineReportId} weakAreas=${res.weakAreasUpserted} mistakes=${res.mistakesInserted}`
                    );
                }
            })
            .catch((err) => {
                console.error(`[PostSessionPipeline] unhandled failure`, {
                    reportId: pipelineReportId,
                    error: err?.message ?? err,
                });
            });

        return { status: "generated" };

    } catch (error) {
        console.error(`[ReportGenerator] Failed to generate report for session ${sessionId}`, error);

        return {
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown report generation error",
        };
    }
}
