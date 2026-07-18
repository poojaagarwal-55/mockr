/**
 * Single source of truth for company-screening score math. Both the LLM
 * (Gemini) path and the deterministic fallback in report.ts use these helpers
 * so the overall score is always the rubric-weighted combination of the
 * per-dimension scores — never an LLM free-form number that ignores the
 * recruiter's weights.
 */

export type ScreeningRecommendation =
    | "advance"
    | "review"
    | "hold"
    | "reject"
    | "insufficient_evidence";

export type ScoredDimension = {
    weight: number;
    score: number;
};

/** Documented recommendation cut points. Advisory only — recruiter decides. */
export const RECOMMENDATION_THRESHOLDS = {
    advance: 75,
    review: 55,
    hold: 35,
} as const;

/**
 * How heavily proctoring integrity drags the overall score. A perfect 100
 * integrity applies no penalty; an integrity of 0 removes up to 25 points.
 * Applied identically in both the LLM and deterministic paths.
 */
export const INTEGRITY_PENALTY_WEIGHT = 0.25;

export function clampScore(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, Math.round(parsed)));
}

/**
 * Rubric-weighted overall, normalized by the total weight so it is correct
 * even if the weights do not sum to exactly 100. Dimensions with non-positive
 * weight are ignored. Returns 0 when there is no usable weight.
 */
export function computeWeightedScore(dimensions: ScoredDimension[]): number {
    const weightTotal = dimensions.reduce((sum, d) => sum + Math.max(0, Number(d.weight) || 0), 0);
    if (weightTotal <= 0) return 0;
    const weighted = dimensions.reduce(
        (sum, d) => sum + clampScore(d.score) * Math.max(0, Number(d.weight) || 0),
        0
    );
    return clampScore(weighted / weightTotal);
}

/** Points removed from the overall score for proctoring integrity issues. */
export function integrityPenalty(integrityScore: number | null): number {
    if (integrityScore == null) return 0;
    return Math.max(0, (100 - clampScore(integrityScore)) * INTEGRITY_PENALTY_WEIGHT);
}

/** Apply the documented integrity policy to a base (rubric) score. */
export function applyIntegrityPenalty(baseScore: number, integrityScore: number | null): number {
    return clampScore(baseScore - integrityPenalty(integrityScore));
}

export function recommendationFromScore(score: number, hasEvidence: boolean): ScreeningRecommendation {
    if (!hasEvidence) return "insufficient_evidence";
    if (score >= RECOMMENDATION_THRESHOLDS.advance) return "advance";
    if (score >= RECOMMENDATION_THRESHOLDS.review) return "review";
    if (score >= RECOMMENDATION_THRESHOLDS.hold) return "hold";
    return "reject";
}

/** Map a 0-100 dimension score to a coarse signal label for the recruiter UI. */
export function signalFromScore(
    score: number
): "strong" | "positive" | "mixed" | "weak" | "not_observed" {
    if (score >= 80) return "strong";
    if (score >= 65) return "positive";
    if (score >= 45) return "mixed";
    if (score > 0) return "weak";
    return "not_observed";
}
