import type { ScreeningBlueprint } from "./blueprint.js";
import type { ScreeningPhasePrefetch } from "./phase-runtime.js";

/**
 * Server-side output leak-scan for the company AI screening interviewer.
 *
 * The live interviewer is grounded on CONFIDENTIAL evaluator material (expected points,
 * reference solutions/answers, evaluation guides) so it can probe and privately judge.
 * The prompt tells it never to reveal that — but a prompt is a soft guard. This module is
 * the STRUCTURAL backstop: before an interviewer turn reaches the candidate, we scan its
 * text against the reference material and redact any span that reproduces it. Verbatim /
 * near-verbatim reproduction is the damaging leak vector (reading out the answer, the
 * optimal query, the model solution); that is exactly what significant-token n-gram
 * matching catches, while staying clear of coincidental shared domain terms.
 *
 * IMPORTANT — we scan ONLY the ANSWER/reference fields, never the material the interviewer
 * is SUPPOSED to speak (a case scenario, a constraint to introduce, a devil's-advocate
 * probe, a mutation/twist). Those are intended output, not secrets.
 */

// Common words carry no copy-signal; dropping them makes an n-gram match mean "the same
// substantive phrase in the same order", not "two sentences that both used 'the' and 'to'".
const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "if", "then", "else", "of", "to", "in", "on", "for", "with",
    "as", "at", "by", "from", "into", "is", "are", "was", "were", "be", "been", "being", "it", "its",
    "this", "that", "these", "those", "you", "your", "we", "our", "they", "their", "i", "he", "she",
    "do", "does", "did", "can", "could", "should", "would", "will", "may", "might", "must", "have",
    "has", "had", "not", "no", "so", "than", "such", "which", "who", "what", "how", "when", "where",
    "why", "there", "here", "about", "up", "out", "over", "also", "just", "more", "most", "some", "any",
]);

/** The number of consecutive significant tokens that must match to count as a leak. Six
 * substantive words in the same order is a strong copy signal with a very low false rate. */
const SHINGLE_K = 6;

/** Only reference strings with at least this many chars are worth scanning against. */
const MIN_SECRET_CHARS = 24;

function significantTokens(text: unknown): string[] {
    return String(text ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token && !STOPWORDS.has(token));
}

function shingles(tokens: string[], k: number): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i + k <= tokens.length; i++) out.add(tokens.slice(i, i + k).join(" "));
    return out;
}

/**
 * Gather the confidential reference strings the interviewer was grounded on this session,
 * to scan its output against. ANSWER / reference / evaluation-guide fields ONLY — never
 * probes, scenarios, constraints, or twists (which the interviewer is meant to speak).
 */
export function collectScreeningSecrets(
    blueprint: ScreeningBlueprint | null | undefined,
    prefetch?: ScreeningPhasePrefetch | null
): string[] {
    const out: string[] = [];
    const add = (value: unknown) => {
        const s = String(value ?? "").trim();
        if (s.length >= MIN_SECRET_CHARS) out.push(s);
    };

    // Recruiter-authored expected answer points (hidden evaluator checklist), all questions.
    for (const phase of blueprint?.phases ?? []) {
        for (const question of phase.questions ?? []) {
            for (const point of question.expectedPoints ?? []) add(point.text);
        }
    }

    // Prefetched bank reference material (present on the voice path; text path passes none).
    if (prefetch) {
        add(prefetch.prefetchedDSSQLQuestion?.solution);
        add(prefetch.prefetchedDSCodingQuestion?.conciseSolution);
        add(prefetch.prefetchedDSCodingQuestion?.solution);
        add(prefetch.prefetchedGenAICodingQuestion?.conciseSolution);
        add(prefetch.prefetchedGenAICodingQuestion?.evaluationCriteria);
        add(prefetch.prefetchedPMCaseQuestion?.evaluationGuide);
        add(prefetch.prefetchedProblemSolvingCaseQuestion?.referenceSolution);
        add(prefetch.prefetchedProblemSolvingCaseQuestion?.evaluationGuide);
        add(prefetch.prefetchedPMStrategyQuestion?.evaluationGuide);
        const concepts = [
            ...(prefetch.prefetchedDSConceptQuestions ?? []),
            ...(prefetch.prefetchedGenAIConceptQuestions ?? []),
            ...(prefetch.prefetchedPMConceptQuestions ?? []),
            ...(prefetch.csTheoryQuestions ?? []),
        ];
        for (const concept of concepts) {
            add((concept as any)?.referenceAnswer);
            add((concept as any)?.evaluationGuide);
            add((concept as any)?.answer);
        }
    }

    return out;
}

/** Pre-computed secret shingles, so a multi-turn session builds them once. */
export function buildSecretShingles(secrets: string[], k: number = SHINGLE_K): Set<string> {
    const set = new Set<string>();
    for (const secret of secrets) {
        const tokens = significantTokens(secret);
        if (tokens.length >= k) for (const shingle of shingles(tokens, k)) set.add(shingle);
    }
    return set;
}

/** True when `message` reproduces a >= k-significant-token span from the secret shingles. */
export function detectScreeningLeak(message: string, secretShingles: Set<string>, k: number = SHINGLE_K): boolean {
    if (!secretShingles.size) return false;
    const tokens = significantTokens(message);
    if (tokens.length < k) return false;
    for (const shingle of shingles(tokens, k)) {
        if (secretShingles.has(shingle)) return true;
    }
    return false;
}

const SAFE_FALLBACK = "Thanks — let's keep going. Walk me through your reasoning on that.";

/**
 * Redact any sentence of an interviewer turn that reproduces confidential reference
 * material. Sentence-level so an incidental leak drops only the offending sentence, not the
 * whole turn; if nothing survives, returns a neutral fallback so the candidate never sees
 * the leak nor a blank turn.
 */
export function redactScreeningLeak(
    message: string,
    secrets: string[],
    k: number = SHINGLE_K
): { text: string; leaked: boolean; removed: number } {
    if (!message.trim() || !secrets.length) return { text: message, leaked: false, removed: 0 };
    const secretShingles = buildSecretShingles(secrets, k);
    if (!secretShingles.size) return { text: message, leaked: false, removed: 0 };

    const sentences = message.match(/[^.!?\n]+[.!?]*\s*/g) || [message];
    let removed = 0;
    const kept = sentences.filter((sentence) => {
        const tokens = significantTokens(sentence);
        if (tokens.length < k) return true;
        for (const shingle of shingles(tokens, k)) {
            if (secretShingles.has(shingle)) {
                removed += 1;
                return false;
            }
        }
        return true;
    });

    const text = kept.join("").trim();
    if (removed === 0) return { text: message, leaked: false, removed: 0 };
    if (!text) return { text: SAFE_FALLBACK, leaked: true, removed };
    return { text, leaked: true, removed };
}
