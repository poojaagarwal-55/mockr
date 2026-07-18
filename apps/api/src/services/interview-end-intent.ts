// Shared interview end-intent detector used by both text and voice flows.
// Keep this conservative so casual politeness (e.g., "thank you") does not end interviews.

const EXPLICIT_END_PHRASE = /\b(end\s+(?:the\s+)?(?:interview|session)|wrap\s+(?:this|it)\s+up|let'?s\s+(?:end|stop)|stop\s+(?:the\s+)?(?:interview|session)|i\s*(?:am|'m)\s+done|done\s+for\s+today|that'?s\s+all(?:\s+for\s+me)?|no\s+questions?|no\s+more\s+questions?|nothing\s+else)\b/i;

const PURE_GOODBYE_UTTERANCE = /^\s*(?:ok(?:ay)?[,\s]+)?(?:bye|bye\s+bye|bye\s+by\s+bye|goodbye|see\s+you|no\s+thanks|no\s+thank\s+you|that'?s\s+all|i\s*(?:am|'m)\s+done|end\s+interview|end\s+session)\s*[.!?]*\s*$/i;

const THANKS_WITH_CLOSURE = /(\bthanks?\b|\bthank\s*you\b).{0,48}\b(bye|goodbye|that'?s\s+all|no\s+questions?|i\s*(?:am|'m)\s+done|end\s+interview|end\s+session|wrap\s+(?:this|it)\s+up|let'?s\s+(?:end|stop))\b|\b(bye|goodbye|that'?s\s+all|no\s+questions?|i\s*(?:am|'m)\s+done|end\s+interview|end\s+session|wrap\s+(?:this|it)\s+up|let'?s\s+(?:end|stop))\b.{0,48}(\bthanks?\b|\bthank\s*you\b)/i;

const HAS_THANKS = /\bthanks?\b|\bthank\s*you\b/i;

const CLOSING_ACKNOWLEDGEMENT = /^\s*(?:ok(?:ay)?|k|no|nope|nah|no\s+questions?|nothing|nothing\s+else|bye|goodbye|thanks?|thank\s*you)\s*[.!?]*\s*$/i;
const QUESTION_OFFER_AFFIRMATION = /^\s*(?:yes|yeah|yep|yup|sure|i\s+do|i\s+have\s+(?:one|a\s+question))\s*[.!?]*\s*$/i;

export function isEndInterviewIntent(text: string): boolean {
    const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalized) return false;

    if (EXPLICIT_END_PHRASE.test(normalized)) return true;
    if (PURE_GOODBYE_UTTERANCE.test(normalized)) return true;

    if (HAS_THANKS.test(normalized)) {
        return THANKS_WITH_CLOSURE.test(normalized);
    }

    return false;
}

export function isClosingAcknowledgement(text: string): boolean {
    return CLOSING_ACKNOWLEDGEMENT.test(text.trim().toLowerCase().replace(/\s+/g, " "));
}

export function isQuestionOfferAffirmation(text: string): boolean {
    return QUESTION_OFFER_AFFIRMATION.test(text.trim().toLowerCase().replace(/\s+/g, " "));
}

export function isCloseoutQuestion(text: string): boolean {
    const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalized || isClosingAcknowledgement(normalized) || isEndInterviewIntent(normalized)) return false;
    return /\?/.test(normalized) ||
        /^(?:can|could|would|what|why|how|when|where|who|should|do|does|did|is|are|am)\b/i.test(normalized);
}
