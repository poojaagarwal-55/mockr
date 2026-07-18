import { getGeminiClient, isGeminiBackedAvailable, GEMINI_REPORT_MODEL } from "../../lib/gemini.js";
import type { ScreeningAnswerRecord } from "./runtime.js";
import type { ScreeningBlueprint } from "./blueprint.js";
import {
    applyIntegrityPenalty,
    clampScore,
    computeWeightedScore,
    recommendationFromScore,
    signalFromScore,
    type ScreeningRecommendation,
} from "./scoring.js";

export type CompanyScreeningTranscriptMessage = {
    role: string;
    content: string;
    stage?: string | null;
    createdAt?: Date | string | null;
    /** Blueprint question this turn is covering (Section 0 tagging). */
    questionId?: string | null;
};

export type CompanyScreeningReportInput = {
    candidateName?: string | null;
    jobTitle?: string | null;
    companyName?: string | null;
    blueprint: ScreeningBlueprint;
    transcript: CompanyScreeningTranscriptMessage[];
    typedAnswers: ScreeningAnswerRecord[];
    integrity: {
        score: number | null;
        eventCounts: Record<string, number>;
    };
};

export type CompanyScreeningDimensionReport = {
    dimensionId: string;
    label: string;
    weight: number;
    score: number;
    signal: "strong" | "positive" | "mixed" | "weak" | "not_observed";
    evidence: string[];
    risks: string[];
    competencyTags: string[];
};

export type CompanyScreeningQuestionReport = {
    questionId: string;
    prompt: string;
    signal: "strong" | "positive" | "mixed" | "weak" | "not_observed";
    evidence: string;
};

/** Per-configured-question coverage, computed from tags/answers, not the LLM. */
export type ScreeningQuestionCoverage = {
    questionId: string;
    category: string;
    prompt: string;
    status: "answered" | "skipped" | "not_asked" | "unknown";
    followUps: number;
};

export type CompanyScreeningRecruiterReport = {
    version: 1;
    generatedAt: string;
    model: string;
    automatedEvaluation: "generated" | "deterministic_fallback" | "fallback_manual_review";
    decisionOwner: "company_recruiter";
    overallScore: number;
    /** The model's free-form overall, kept advisory-only for auditability. */
    modelSuggestedOverall?: number | null;
    recommendation: ScreeningRecommendation;
    modelSuggestedRecommendation?: ScreeningRecommendation | null;
    summary: string;
    dimensionScores: CompanyScreeningDimensionReport[];
    questionSignals: CompanyScreeningQuestionReport[];
    coverage: ScreeningQuestionCoverage[];
    strengths: string[];
    risks: string[];
    recruiterFocus: string[];
    integrity: {
        score: number | null;
        summary: string;
        eventCounts: Record<string, number>;
    };
};

const SIGNALS = new Set(["strong", "positive", "mixed", "weak", "not_observed"]);
const RECOMMENDATIONS = new Set(["advance", "review", "hold", "reject", "insufficient_evidence"]);

function text(value: unknown, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function textArray(value: unknown, max = 6) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => text(item)).filter(Boolean).slice(0, max);
}

function signal(value: unknown): CompanyScreeningDimensionReport["signal"] {
    const normalized = text(value, "not_observed");
    return SIGNALS.has(normalized) ? normalized as CompanyScreeningDimensionReport["signal"] : "not_observed";
}

function recommendation(value: unknown): ScreeningRecommendation {
    const normalized = text(value, "review");
    return RECOMMENDATIONS.has(normalized) ? normalized as ScreeningRecommendation : "review";
}

function extractJsonObject(raw: string) {
    const clean = raw.replace(/^﻿/, "").trim();
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first < 0 || last <= first) {
        throw new Error("Model response did not contain JSON.");
    }
    return clean.slice(first, last + 1);
}

function compactTranscript(messages: CompanyScreeningTranscriptMessage[]) {
    return messages
        .filter((message) => message.role !== "system" && text(message.content))
        .map((message) => ({
            role: message.role === "assistant" ? "interviewer" : message.role,
            stage: message.stage || null,
            questionId: message.questionId || null,
            content: text(message.content).slice(0, 4000),
        }))
        .slice(-80);
}

function compactTypedAnswers(answers: ScreeningAnswerRecord[]) {
    return answers.map((answer) => ({
        phaseType: answer.phaseType,
        questionId: answer.questionId,
        prompt: answer.prompt,
        followUpIndex: answer.followUpIndex,
        answer: answer.answer.slice(0, 4000),
    }));
}

function answerQualityScore(textValue: string) {
    const normalized = textValue.trim().toLowerCase();
    if (!normalized) return 0;
    if (/\b(fuck|shit|bitch|asshole|chutiya|madarchod|bhenchod)\b/i.test(normalized)) return 0;
    if (/\b(skip|pass|no idea|noidea|idk|i don'?t know|n\/a)\b/i.test(normalized)) return 10;
    if (/\b(what'?s your name|who are you|i am asking you|answer me)\b/i.test(normalized)) return 15;
    const words = normalized.split(/\s+/).filter(Boolean).length;
    if (words < 4) return 20;
    if (words < 12) return 45;
    if (words < 35) return 65;
    return 80;
}

type ConfiguredQuestion = {
    questionId: string;
    category: string;
    phaseType: string;
    prompt: string;
    rubricDimensionIds: string[];
};

function configuredQuestions(blueprint: ScreeningBlueprint): ConfiguredQuestion[] {
    return blueprint.phases.flatMap((phase) =>
        phase.questions.map((question) => {
            const dimensionIds = Array.from(
                new Set(
                    question.expectedPoints
                        .map((point) => text(point.rubricDimensionId))
                        .filter(Boolean)
                )
            );
            return {
                questionId: question.id,
                category: question.category,
                phaseType: phase.type,
                prompt: question.prompt,
                rubricDimensionIds: dimensionIds,
            };
        })
    );
}

/**
 * Per-question candidate evidence assembled from typed answers and/or
 * questionId-tagged transcript turns. `hasSignal` is false only when neither
 * source carries question identity (e.g. an untagged live transcript), in
 * which case coverage and per-dimension routing degrade gracefully.
 */
type PerQuestionEvidence = {
    answerText: string;
    asked: boolean;
    followUps: number;
};

function buildPerQuestionEvidence(input: CompanyScreeningReportInput) {
    const byQuestion = new Map<string, PerQuestionEvidence>();
    const ensure = (questionId: string): PerQuestionEvidence => {
        const current = byQuestion.get(questionId) || { answerText: "", asked: false, followUps: 0 };
        byQuestion.set(questionId, current);
        return current;
    };

    let hasSignal = false;

    for (const answer of input.typedAnswers) {
        if (!answer.questionId) continue;
        hasSignal = true;
        const entry = ensure(answer.questionId);
        entry.asked = true;
        if (answer.answer.trim()) entry.answerText += `${answer.answer.trim()}\n`;
        if (answer.followUpIndex > 0) entry.followUps += 1;
    }

    for (const message of input.transcript) {
        const questionId = message.questionId;
        if (!questionId) continue;
        hasSignal = true;
        const entry = ensure(questionId);
        if (message.role === "assistant") {
            entry.asked = true;
        } else if (message.role !== "system" && text(message.content)) {
            entry.asked = true;
            entry.answerText += `${text(message.content)}\n`;
        }
    }

    return { byQuestion, hasSignal };
}

function computeCoverage(
    input: CompanyScreeningReportInput,
    questions: ConfiguredQuestion[],
    evidence: ReturnType<typeof buildPerQuestionEvidence>
): ScreeningQuestionCoverage[] {
    return questions.map((question) => {
        const entry = evidence.byQuestion.get(question.questionId);
        let status: ScreeningQuestionCoverage["status"];
        if (!evidence.hasSignal) {
            status = "unknown";
        } else if (!entry || !entry.asked) {
            status = "not_asked";
        } else {
            status = answerQualityScore(entry.answerText) > 20 ? "answered" : "skipped";
        }
        return {
            questionId: question.questionId,
            category: question.category,
            prompt: question.prompt,
            status,
            followUps: entry?.followUps || 0,
        };
    });
}

function integritySummaryText(score: number | null) {
    return score == null ? "Integrity score was not available." : `Integrity score: ${score}/100.`;
}

function deterministicReport(input: CompanyScreeningReportInput, reason: string): CompanyScreeningRecruiterReport {
    const questions = configuredQuestions(input.blueprint);
    const evidence = buildPerQuestionEvidence(input);
    const coverage = computeCoverage(input, questions, evidence);

    const compact = compactTranscript(input.transcript);
    const userMessages = compact.filter((message) => message.role !== "interviewer");
    const candidateTranscript = userMessages.map((message) => message.content).join("\n").toLowerCase();
    const hasCandidateEvidence = userMessages.length > 0 || input.typedAnswers.length > 0;

    // Per-dimension scoring. When we have per-question evidence we route each
    // question's answer quality to the rubric dimensions referenced by its
    // expected points, producing genuinely differentiated dimension scores.
    const dimensionBuckets = new Map<string, number[]>();
    if (evidence.hasSignal) {
        for (const question of questions) {
            const entry = evidence.byQuestion.get(question.questionId);
            if (!entry || !entry.asked || !entry.answerText.trim()) continue;
            const qScore = answerQualityScore(entry.answerText);
            const targets = question.rubricDimensionIds.length
                ? question.rubricDimensionIds
                : input.blueprint.rubricDimensions.map((dimension) => dimension.id);
            for (const dimensionId of targets) {
                dimensionBuckets.set(dimensionId, [...(dimensionBuckets.get(dimensionId) || []), qScore]);
            }
        }
    } else {
        // No per-question identity available: fall back to aggregate transcript
        // quality applied across all dimensions (degraded, noted in summary).
        const aggregate = userMessages.length
            ? Math.round(userMessages.reduce((sum, m) => sum + answerQualityScore(m.content), 0) / userMessages.length)
            : 0;
        for (const dimension of input.blueprint.rubricDimensions) {
            dimensionBuckets.set(dimension.id, [aggregate]);
        }
    }

    const dimensionScores = input.blueprint.rubricDimensions.map((dimension) => {
        const bucket = dimensionBuckets.get(dimension.id) || [];
        const rawScore = bucket.length ? Math.round(bucket.reduce((sum, s) => sum + s, 0) / bucket.length) : 0;
        return {
            dimensionId: dimension.id,
            label: dimension.label,
            weight: dimension.weight,
            score: rawScore,
            signal: signalFromScore(rawScore),
            evidence: bucket.length
                ? [`Routed evidence from ${bucket.length} answered question(s) mapped to this dimension.`]
                : [],
            risks: bucket.length ? [] : ["No answered question routed evidence to this dimension."],
            competencyTags: dimension.competencyTags || [],
        };
    });

    const baseScore = computeWeightedScore(dimensionScores);
    const finalScore = applyIntegrityPenalty(baseScore, input.integrity.score);
    const rec = recommendationFromScore(finalScore, hasCandidateEvidence);

    const abusive = /\b(fuck|shit|bitch|asshole|chutiya|madarchod|bhenchod)\b/i.test(candidateTranscript);
    const skipped = coverage.some((item) => item.status === "skipped");
    const notAsked = coverage.filter((item) => item.status === "not_asked");

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        model: "deterministic-fallback",
        automatedEvaluation: "deterministic_fallback",
        decisionOwner: "company_recruiter",
        overallScore: finalScore,
        modelSuggestedOverall: null,
        recommendation: rec,
        modelSuggestedRecommendation: null,
        summary: hasCandidateEvidence
            ? (evidence.hasSignal
                ? "Deterministic report scored each rubric dimension from per-question answer evidence and integrity. Use this when the LLM evaluator is unavailable."
                : "Deterministic report scored from overall transcript quality; per-question evidence was not available so dimension scores are not differentiated.")
            : "No candidate answer evidence was available for scoring.",
        dimensionScores,
        questionSignals: questions.map((question) => {
            const entry = evidence.byQuestion.get(question.questionId);
            const qScore = entry?.answerText ? answerQualityScore(entry.answerText) : 0;
            return {
                questionId: question.questionId,
                prompt: question.prompt,
                signal: signalFromScore(qScore),
                evidence: entry?.asked
                    ? "Candidate response evidence captured; review the question transcript segment."
                    : "No answer evidence found for this configured question.",
            };
        }),
        coverage,
        strengths: finalScore >= 65 ? ["Some answers contained enough detail for recruiter review."] : [],
        risks: [
            skipped ? "One or more configured questions were skipped or answered thinly." : "",
            notAsked.length ? `${notAsked.length} configured question(s) were not asked during the interview.` : "",
            abusive ? "Unprofessional language was observed." : "",
            input.integrity.score != null && input.integrity.score < 60 ? "Integrity score needs recruiter attention." : "",
            reason,
        ].filter(Boolean).slice(0, 4),
        recruiterFocus: ["Check transcript relevance.", "Verify integrity events.", "Confirm question coverage."],
        integrity: {
            score: input.integrity.score,
            summary: integritySummaryText(input.integrity.score),
            eventCounts: input.integrity.eventCounts,
        },
    };
}

function fallbackReport(input: CompanyScreeningReportInput, reason: string): CompanyScreeningRecruiterReport {
    const questions = configuredQuestions(input.blueprint);
    const evidence = buildPerQuestionEvidence(input);
    const hasCandidateEvidence = compactTranscript(input.transcript).length > 0 || input.typedAnswers.length > 0;
    const fallbackScore = hasCandidateEvidence ? 50 : 0;
    const summary = hasCandidateEvidence
        ? "The screening was submitted, but automated report generation needs recruiter review before a decision is made."
        : "No candidate interview evidence was available for automated scoring. Recruiter review is required.";

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        model: "fallback",
        automatedEvaluation: "fallback_manual_review",
        decisionOwner: "company_recruiter",
        overallScore: fallbackScore,
        modelSuggestedOverall: null,
        recommendation: hasCandidateEvidence ? "review" : "insufficient_evidence",
        modelSuggestedRecommendation: null,
        summary,
        dimensionScores: input.blueprint.rubricDimensions.map((dimension) => ({
            dimensionId: dimension.id,
            label: dimension.label,
            weight: dimension.weight,
            score: fallbackScore,
            signal: hasCandidateEvidence ? "mixed" : "not_observed",
            evidence: hasCandidateEvidence ? ["Submitted evidence is available in the transcript for recruiter review."] : [],
            risks: [reason],
            competencyTags: dimension.competencyTags || [],
        })),
        questionSignals: questions.map((question) => ({
            questionId: question.questionId,
            prompt: question.prompt,
            signal: hasCandidateEvidence ? "mixed" : "not_observed",
            evidence: hasCandidateEvidence ? "Review transcript evidence for this configured question." : "No answer evidence found.",
        })),
        coverage: computeCoverage(input, questions, evidence),
        strengths: [],
        risks: [reason],
        recruiterFocus: ["Review transcript and proctoring evidence manually before deciding."],
        integrity: {
            score: input.integrity.score,
            summary: integritySummaryText(input.integrity.score),
            eventCounts: input.integrity.eventCounts,
        },
    };
}

function normalizeReport(raw: any, input: CompanyScreeningReportInput): CompanyScreeningRecruiterReport {
    const questions = configuredQuestions(input.blueprint);
    const evidence = buildPerQuestionEvidence(input);
    const coverage = computeCoverage(input, questions, evidence);

    const rawDimensions = Array.isArray(raw?.dimensionScores) ? raw.dimensionScores : [];
    const normalizedDimensions = input.blueprint.rubricDimensions.map((dimension) => {
        const found = rawDimensions.find((item: any) => text(item?.dimensionId) === dimension.id);
        const score = clampScore(found?.score, 0);
        return {
            dimensionId: dimension.id,
            label: dimension.label,
            weight: dimension.weight,
            score,
            signal: found?.signal ? signal(found.signal) : signalFromScore(score),
            evidence: textArray(found?.evidence, 3),
            risks: textArray(found?.risks, 3),
            competencyTags: dimension.competencyTags || [],
        };
    });

    // Rubric-weighted overall is authoritative; the model's overall is advisory.
    const weightedScore = computeWeightedScore(normalizedDimensions);
    const finalScore = applyIntegrityPenalty(weightedScore, input.integrity.score);
    const hasEvidence = normalizedDimensions.some((d) => d.score > 0) || compactTranscript(input.transcript).length > 0;

    const questionMap = new Map<string, { prompt: string }>();
    for (const question of questions) {
        questionMap.set(question.questionId, { prompt: question.prompt });
    }

    const rawQuestionSignals = Array.isArray(raw?.questionSignals) ? raw.questionSignals : [];
    const questionSignals = Array.from(questionMap.entries()).map(([questionId, question]) => {
        const found = rawQuestionSignals.find((item: any) => text(item?.questionId) === questionId);
        return {
            questionId,
            prompt: question.prompt,
            signal: signal(found?.signal),
            evidence: text(found?.evidence, "No concise evidence captured."),
        };
    });

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        model: GEMINI_REPORT_MODEL,
        automatedEvaluation: "generated",
        decisionOwner: "company_recruiter",
        overallScore: finalScore,
        modelSuggestedOverall: raw?.overallScore != null ? clampScore(raw.overallScore) : null,
        recommendation: recommendationFromScore(finalScore, hasEvidence),
        modelSuggestedRecommendation: raw?.recommendation ? recommendation(raw.recommendation) : null,
        summary: text(raw?.summary, "Screening report generated for recruiter review.").slice(0, 800),
        dimensionScores: normalizedDimensions,
        questionSignals,
        coverage,
        strengths: textArray(raw?.strengths, 4),
        risks: textArray(raw?.risks, 4),
        recruiterFocus: textArray(raw?.recruiterFocus, 4),
        integrity: {
            score: input.integrity.score,
            summary: (text(raw?.integrity?.summary) || integritySummaryText(input.integrity.score)).slice(0, 500),
            eventCounts: input.integrity.eventCounts,
        },
    };
}

export async function generateCompanyAiScreeningReport(
    input: CompanyScreeningReportInput
): Promise<CompanyScreeningRecruiterReport> {
    if (!isGeminiBackedAvailable()) {
        return deterministicReport(input, "Automated report model is not configured.");
    }

    const questions = configuredQuestions(input.blueprint);
    const evidence = buildPerQuestionEvidence(input);
    const coverage = computeCoverage(input, questions, evidence);

    const evidencePayload = {
        candidateName: input.candidateName || "Candidate",
        jobTitle: input.jobTitle || "Role",
        companyName: input.companyName || "",
        blueprint: {
            title: input.blueprint.title,
            durationMinutes: input.blueprint.durationMinutes,
            rubricDimensions: input.blueprint.rubricDimensions,
            phases: input.blueprint.phases.map((phase) => ({
                id: phase.id,
                type: phase.type,
                title: phase.title,
                questions: phase.questions.map((question) => ({
                    id: question.id,
                    category: question.category,
                    prompt: question.prompt,
                    expectedPoints: question.expectedPoints,
                    followUpPolicy: question.followUpPolicy,
                })),
            })),
        },
        // Coverage is computed deterministically and given to the model so its
        // per-question signals stay consistent with what was actually asked.
        questionCoverage: coverage,
        transcript: compactTranscript(input.transcript),
        typedAnswers: compactTypedAnswers(input.typedAnswers),
        integrity: input.integrity,
    };

    const prompt = `You are generating a concise recruiter-only report for a company AI screening.

Return strict JSON only. Do not include markdown.

Purpose:
- Help a recruiter decide quickly whether to advance, hold, reject, or review.
- Keep it short and evidence-based.
- The candidate will not see this report.

Rules:
- Evaluate only from transcript, typed answers, proctoring integrity, configured questions, expected points, rubric dimensions, and competency tags.
- Dimension names are the primary score rows.
- Expected points carry a rubricDimensionId; route each expected point's evidence to that dimension.
- Competency tags are subcriteria used to route evidence inside each dimension.
- Expected points are hidden evaluator checklists; never quote them as if the candidate saw them.
- Do not invent positives. If evidence is missing, mark not_observed or weak.
- Use questionCoverage to judge which questions were actually answered; do not credit not_asked or skipped questions.
- Per-dimension scores are what matter; the overall is recomputed from rubric weights on our side.
- Recommendation is advisory only; decisionOwner remains company_recruiter.
- Summary must be under 90 words.
- Each dimension should have at most 3 evidence bullets and 3 risk bullets.
- recruiterFocus should be 2-4 short checks the recruiter should verify manually.

Output shape:
{
  "overallScore": 0-100,
  "recommendation": "advance" | "review" | "hold" | "reject" | "insufficient_evidence",
  "summary": "short recruiter summary",
  "dimensionScores": [
    {
      "dimensionId": "exact configured dimension id",
      "score": 0-100,
      "signal": "strong" | "positive" | "mixed" | "weak" | "not_observed",
      "evidence": ["short evidence"],
      "risks": ["short risk"]
    }
  ],
  "questionSignals": [
    {
      "questionId": "exact configured question id",
      "signal": "strong" | "positive" | "mixed" | "weak" | "not_observed",
      "evidence": "one sentence"
    }
  ],
  "strengths": ["max 4"],
  "risks": ["max 4"],
  "recruiterFocus": ["max 4"],
  "integrity": { "summary": "short integrity note" }
}

Evidence:
${JSON.stringify(evidencePayload, null, 2)}`;

    try {
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_REPORT_MODEL,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { responseMimeType: "application/json", temperature: 0 },
        });
        const parsed = JSON.parse(extractJsonObject(result.text || "{}"));
        return normalizeReport(parsed, input);
    } catch (error: any) {
        return deterministicReport(input, `Automated report generation failed: ${error?.message || "unknown error"}`);
    }
}
