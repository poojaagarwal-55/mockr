// Shared progression-intent detectors for moving between interview sections.
// Keep these conservative to avoid accidental stage jumps.

function normalizeText(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isDsaAdvanceIntent(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    const explicitMoveOn = /\b(move\s+on|move\s+to|go\s+to|skip|next|proceed|advance|continue|go\s+ahead|switch)\b/i.test(normalized);
    const fundamentalsTarget = /\b(fundamentals?|cs(?:\s+fundamentals?)?|dbms|sql|operating\s+systems?|os|computer\s+networks?|cn|oops|theory(?:\s+round)?|next\s+round|next\s+section)\b/i.test(normalized);
    const skipCurrentProblem = /\b(skip|move\s+on\s+from)\b(?:\s+\w+){0,6}\b(this|the)?\s*(question|problem|dsa|coding|challenge)\b/i.test(normalized);

    const stuckSignal = /\b(i\s*(do\s*not|don't|dont)\s+know|not\s+sure|can't\s+solve|unable\s+to\s+solve|i\s+am\s+stuck|i'm\s+stuck|stuck)\b/i.test(normalized);

    // Reject if "move on" is preceded by future-tense markers — the candidate
    // is explaining their plan, not requesting a stage change.
    // e.g. "I will move on to the next step" or "then I'll move on to hashing"
    const futureTenseContext =
        /\b(i\s+will|i'll|i\s+am\s+going\s+to|i'm\s+going\s+to|i\s+wanna|i\s+want\s+to|gonna|then\s+i|after\s+that\s+i|and\s+then)\b.{0,30}\b(move\s+on|move\s+to|go\s+to|proceed|advance|continue|switch)\b/i.test(normalized);

    // Short direct prompts like "let's move on" should be treated as explicit stage-advance intent.
    // Keep "next" strict to section-level phrasing to avoid false positives like
    // "next I will use a hashmap" while explaining the current solution.
    const shortDirectMoveOn =
        /^(?:please\s+)?(?:(?:can|could)\s+we\s+|let'?s\s+|i(?:'d)?\s+like\s+to\s+|we\s+should\s+)?move\s+on(?:[.!?])?$/i.test(normalized) ||
        /^(?:please\s+)?(?:(?:can|could)\s+we\s+|let'?s\s+|i(?:'d)?\s+like\s+to\s+|we\s+should\s+)?skip(?:\s+(?:it|this|that|this\s+one|this\s+question|the\s+question|this\s+problem|the\s+problem|this\s+round|this\s+section|to\s+the\s+next(?:\s+(?:question|one|topic|section|phase|part))?|ahead))?(?:[.!?])?$/i.test(normalized) ||
        /\bnext\s+(section|round|question|topic|phase|part)\b/i.test(normalized);

    if (futureTenseContext) return false;

    return (
        skipCurrentProblem ||
        (explicitMoveOn && fundamentalsTarget) ||
        (stuckSignal && explicitMoveOn) ||
        shortDirectMoveOn
    );
}
