import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function normalizeText(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeQuestionFingerprint(text: string): string {
    const normalized = normalizeText(text);
    if (!normalized) return "";

    const firstQuestionMark = normalized.indexOf("?");
    const questionSegment = firstQuestionMark >= 0
        ? normalized.slice(0, firstQuestionMark + 1)
        : normalized;

    return questionSegment
        .replace(/[^a-z0-9?\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function isSqlAdvanceIntent(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    // Require explicit SQL handoff intent to avoid false positives on generic
    // words like "continue" or "proceed" during normal SQL discussion.
    const explicitSqlHandoff =
        /\b(skip|move\s+on(?:\s+from)?|move\s+forward|advance|continue|proceed|go\s+ahead|next)\b(?:\s+\w+){0,6}\b(sql|sql\s+round|dbms|database(?:\s+theory)?|query\s+round)\b/i.test(normalized) ||
        /\b(sql|sql\s+round|dbms|database(?:\s+theory)?|query\s+round)\b(?:\s+\w+){0,6}\b(skip|move\s+on|move\s+forward|advance|continue|proceed|go\s+ahead|next)\b/i.test(normalized);

    const explicitNextTopic =
        /\b(move\s+to|go\s+to|continue\s+to|next)\b(?:\s+\w+){0,6}\b(os|operating\s+systems?|oops|object[- ]oriented|computer\s+networks?|cn)\b/i.test(normalized);

    return explicitSqlHandoff || explicitNextTopic;
}

export function isGenericMoveOnIntent(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    // Start-anchored commands: "let's move on", "can we skip this question", etc.
    // Keep bare "skip" strict so answer content like "skip lunch" or
    // "skip has always..." is not treated as a control command.
    const directCommand =
        /^(?:ok(?:ay)?[,\s]+)?(?:(?:can|could)\s+we\s+)?(?:move\s+on|go\s+next|next\s+(?:question|one|topic|section|phase|part))(?:\b|[.!?]\s*$)/i.test(normalized) ||
        /^(?:ok(?:ay)?[,\s]+)?(?:let'?s|i(?:'d)?\s+like\s+to|please)\s+(?:move\s+on|go\s+next|next\s+(?:question|one|topic|section|phase|part))(?:\b|[.!?]\s*$)/i.test(normalized) ||
        /^(?:ok(?:ay)?[,\s]+)?(?:(?:can|could)\s+we\s+|let'?s\s+|i(?:'d)?\s+like\s+to\s+|please\s+)?skip(?:\s+(?:it|this|that|this\s+one|this\s+question|the\s+question|this\s+problem|the\s+problem|this\s+round|this\s+section|to\s+the\s+next(?:\s+(?:question|one|topic|section|phase|part))?|ahead))?(?:[.!?])?$/i.test(normalized);

    if (directCommand) return true;

    // "move on" / "skip this" anywhere — but reject if preceded by future-tense
    // markers like "I will move on" or "then I'll move on to X", which indicate
    // the candidate is explaining their plan, not asking to change stage.
    const hasMoveOn = /\b(move\s+on|skip\s+(?:this|it|that|this\s+question|the\s+question|this\s+problem|the\s+problem)|go\s+next|next\s+please)\b/i.test(normalized);
    if (!hasMoveOn) return false;

    const futureTenseBeforeMoveOn =
        /\b(i\s+will|i'll|i\s+am\s+going\s+to|i'm\s+going\s+to|i\s+wanna|i\s+want\s+to|gonna|then\s+i|after\s+that\s+i|and\s+then)\b.{0,30}\b(move\s+on)\b/i.test(normalized);

    return !futureTenseBeforeMoveOn;
}

export function isUnknownResponseIntent(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    return /\b(i\s*(don'?t|do\s*not)\s+know|no\s+idea|not\s+sure|i\s*am\s*unsure|i'?m\s+unsure|i\s*am\s+stuck|i'?m\s+stuck|can'?t\s+answer|cannot\s+answer)\b/i.test(normalized);
}

function getRecentAssistantUtterances(history: ChatCompletionMessageParam[], maxCount: number): string[] {
    const utterances: string[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i];
        if (message?.role !== "assistant") continue;
        if (typeof message.content !== "string") continue;

        const content = message.content.trim();
        if (!content) continue;

        utterances.push(content);
        if (utterances.length >= maxCount) break;
    }
    return utterances;
}

export function hasRecentRepeatedAssistantQuestion(history: ChatCompletionMessageParam[]): boolean {
    const recentAssistant = getRecentAssistantUtterances(history, 5);
    if (recentAssistant.length < 2) return false;

    const latest = normalizeQuestionFingerprint(recentAssistant[0] || "");
    if (!latest || latest.length < 15) return false;

    // Check if the latest question appeared ANYWHERE in the recent window,
    // not just the immediately preceding message. This catches loops where a
    // follow-up question sits between two identical main questions.
    for (let i = 1; i < recentAssistant.length; i++) {
        const earlier = normalizeQuestionFingerprint(recentAssistant[i] || "");
        if (!earlier || earlier.length < 15) continue;
        if (latest === earlier) return true;
    }

    return false;
}

/**
 * Detects when the candidate has said "I don't know" (or equivalent) two or more
 * times consecutively. This signals the AI should move on to the next question/topic
 * regardless of whether the question was repeated.
 */
export function hasConsecutiveUnknownResponses(history: ChatCompletionMessageParam[], threshold = 2): boolean {
    let consecutiveCount = 0;
    // Walk backwards through history, counting consecutive user "I don't know" messages.
    // Skip system notifications (injected [SYSTEM ...] messages) as they don't represent
    // real user turns.
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (!msg) continue;
        if (msg.role === "assistant") break; // hit an AI message, stop counting
        if (msg.role !== "user") continue;
        const content = typeof msg.content === "string" ? msg.content : "";
        if (content.startsWith("[SYSTEM")) continue; // skip system notifications
        if (isUnknownResponseIntent(content)) {
            consecutiveCount++;
        } else {
            break; // non-unknown user message, stop
        }
    }
    return consecutiveCount >= threshold;
}

export function hasRecentSqlRoundSignals(history: ChatCompletionMessageParam[]): boolean {
    const recent = history.slice(-12);

    for (const message of recent) {
        if (!message || typeof message.content !== "string") continue;
        const content = normalizeText(message.content);
        if (!content) continue;

        if (content.includes("[sql run result]")) return true;
        if (/\bsql\s+editor\b/.test(content)) return true;
        if (/\b(sql\s+question|sql\s+round|write\s+your\s+sql\s+query)\b/.test(content)) return true;
        if (/\b(select|join|group\s+by|where|order\s+by)\b/.test(content) && /\bsql\b/.test(content)) return true;
    }

    return false;
}

export function isIntroToDsaAdvanceIntent(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    // Deferral phrases — the candidate is asking something BEFORE moving on,
    // not requesting to advance. Treat as not-an-advance.
    const deferralCue = /\b(before\s+(?:we|you|i|moving)\s+(?:move\s+on|go|continue|proceed|start|begin)|before\s+moving\s+on|before\s+we\s+(?:dive|jump|switch|head)|wait\b|hold\s+on|one\s+(?:more|last)\s+(?:thing|question)|quick\s+question|first\s+can\s+i|can\s+i\s+ask|i\s+(?:have|had|wanted\s+to\s+ask)\s+(?:a|one|another)\s+question)\b/i;
    if (deferralCue.test(normalized)) return false;

    // If the message ends as a question to the interviewer (e.g. "what do you think?"),
    // it is not an advance request — even if it mentions "coding" or "move on".
    const endsWithQuestion = /\?\s*$/.test(text.trim());
    const asksInterviewer = /\b(what\s+do\s+you|can\s+you|could\s+you|would\s+you|do\s+you|how\s+do\s+you|why\s+do\s+you|tell\s+me\s+(?:more\s+)?about|what'?s?\s+your)\b/i.test(normalized);
    if (endsWithQuestion && asksInterviewer) return false;

    const explicitMoveSignal = /\b(move\s+on|start|begin|switch|go\s+to|next)\b/i.test(normalized);
    const codingTarget = /\b(coding|dsa|problem\s+solving|algorithm(?:ic)?|coding\s+round|coding\s+problem|technical\s+problem)\b/i.test(normalized);

    return explicitMoveSignal && codingTarget;
}

export function isLikelyCodingRoundPrompt(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    const mentionsCodingRound = /\b(coding\s+(?:round|problem|portion|section|part|exercise|task|question|challenge)|dsa\s+(?:round|problem|portion|section|part|exercise|task|question)|algorithm(?:ic)?\s+(?:problem|challenge|exercise|task|question|round)|problem\s+solving|technical\s+problem|technical\s+coding)\b/i.test(normalized);

    // Strong problem-statement intro cue — an LLM is clearly describing a DSA problem
    // ("I'll describe a problem for you to solve", "here's the problem", etc.)
    const hasProblemIntroCue = /\b(i(?:'ll| will|'d like to)?\s+describe\s+(?:a|the|this|your)?\s*problem|here'?s\s+(?:a|the|your)\s+problem|problem\s+statement|your\s+task\s+is|a\s+problem\s+for\s+you\s+to\s+solve|solve\s+(?:this|the\s+following)\s+problem)\b/i.test(normalized);

    if (!mentionsCodingRound && !hasProblemIntroCue) return false;

    // Guard against agenda-style opening scripts like:
    // "We'll start with introductions, then move to coding, followed by fundamentals."
    const hasAgendaSequencingCue = /\b(start\s+with|to\s+begin|then\s+move\s+on|followed\s+by|after\s+that|wrap\s+up|at\s+the\s+end)\b/i.test(normalized);
    const hasNonCodingStageCue = /\b(background|experience|about\s+yourself|fundamentals?|system\s+design|wrap\s+up|closing)\b/i.test(normalized);
    if (hasAgendaSequencingCue && hasNonCodingStageCue && !hasProblemIntroCue) {
        return false;
    }

    // Transition verbs that cleanly introduce a coding-round handoff.
    const transitionVerb = "(?:move\\s+on\\s+to|move\\s+to|shift\\s+to|switch\\s+to|turn\\s+to|jump\\s+into|dive\\s+into|transition\\s+to|pivot\\s+to|go\\s+to|proceed\\s+to|head\\s+to|start|begin)";
    const codingTarget = "(?:a\\s+|an\\s+|the\\s+|our\\s+|some\\s+|this\\s+)?(?:coding|dsa|algorithm(?:ic)?|problem\\s+solving|technical\\s+(?:coding|problem))(?:\\s+(?:round|problem|portion|section|part|exercise|task|question|challenge))?";

    const hasImmediateRoundStartCue =
        new RegExp(`\\b(?:let'?s|we(?:'ll| will)?|i(?:'ll| will)?|now\\s+let'?s|we\\s+can|time\\s+for)\\s+(?:now\\s+|just\\s+|then\\s+)?${transitionVerb}\\s+${codingTarget}\\b`, "i").test(normalized) ||
        /\b(coding|dsa|algorithm(?:ic)?|problem\s+solving)\b(?:\s+\w+){0,6}\s+(starts?\s+now|begins?\s+now|now)\b/i.test(normalized);

    // Signals that the assistant is reading out a DSA problem statement.
    const hasSolveDirective = /\b(please\s+solve|solve\s+(?:the\s+following|this)|given\s+(?:a|an|two|three|four|five|some|the|multiple|several|a\s+pair\s+of|a\s+list\s+of|an?\s+[a-z]+\s+)?(?:non[- ]?empty\s+)?(?:sorted\s+|unsorted\s+|binary\s+|positive\s+|integer\s+)?(?:array|string|matrix|tree|graph|linked\s+list|integer|number|list|pair|value|node|input)s?|you\s+are\s+given|you(?:'ll| will)\s+be\s+given|contiguous\s+subarray|implement|write\s+(?:a|an)\s+function|time\s+complexity|space\s+complexity|constraints?|examples?|return\s+(?:a|an|the|all|true|false|its?|your|back)\s|representing\s+(?:a|an|two|three|multiple)|non[- ]?empty\s+(?:array|string|linked\s+list|tree|list)|in\s+place|o\(n\)|o\(1\))\b/i.test(normalized);
    const hasInterviewQuestionCue = /\b(how\s+would\s+you\s+approach|talk\s+(?:me\s+)?through\s+your\s+approach|think\s+out\s+loud|walk\s+me\s+through|can\s+you\s+walk\s+me\s+through|how\s+(?:would|do)\s+you\s+solve|explain\s+your\s+approach)\b/i.test(normalized);

    if ((hasSolveDirective || hasProblemIntroCue) && (hasInterviewQuestionCue || /\byou\s+are\s+given\b/i.test(normalized) || /\bgiven\s+(?:a|an|two|three|four|five|some|the)\b/i.test(normalized))) {
        return true;
    }

    return hasImmediateRoundStartCue || (hasProblemIntroCue && hasSolveDirective);
}

export function isLikelyFundamentalsHandoffPrompt(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    const hasTransitionVerb = /\b(move\s+on|move\s+to|transition(?:ing)?|shift(?:ing)?\s+to|switch(?:ing)?(?:\s+to)?|turn(?:ing)?\s+to|jump(?:ing)?\s+(?:to|into)|dive\s+into|proceed(?:ing)?|go\s+to|head\s+to|pivot\s+to|next\s+(?:section|portion|round|part)|time\s+for)\b/i.test(normalized);
    const hasFundamentalsTarget =
        /\b(cs\s+fundamentals?|computer\s+science\s+fundamentals?|dbms|database\s+management|operating\s+systems?|computer\s+networks?|oops|object[- ]oriented|theory\s+round|theory\s+section|theory\s+questions?)\b/i.test(normalized) ||
        /\bfundamentals?\s+(?:portion|section|round|part|questions?)\b/i.test(normalized);

    return hasTransitionVerb && hasFundamentalsTarget;
}

export function isFundamentalsToSqlIntent(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    const explicitMoveSignal = /\b(move\s+on|move\s+to|start|begin|switch|go\s+to|next)\b/i.test(normalized);
    const sqlTarget = /\b(sql|sql\s+round|query\s+round|database\s+query\s+round)\b/i.test(normalized);

    return explicitMoveSignal && sqlTarget;
}

export function isLikelySqlRoundPrompt(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    const hasSqlKeyword = /\bsql\b/i.test(normalized);
    if (!hasSqlKeyword) return false;

    const transitionVerb = "(?:move\\s+on\\s+to|move\\s+to|shift\\s+to|switch\\s+to|turn\\s+to|jump\\s+into|dive\\s+into|transition\\s+to|pivot\\s+to|go\\s+to|proceed\\s+to|head\\s+to|start|begin|test)";
    const sqlTarget = "(?:the\\s+|our\\s+|a\\s+|this\\s+)?(?:practical\\s+)?(?:sql\\s+(?:round|portion|section|part|exercise|task|problem|skills?)|sql)";

    const hasImmediateSqlHandoffCue =
        new RegExp(`\\b(?:let'?s|we(?:'ll| will)?|i(?:'ll| will)?|now\\s+let'?s|we\\s+can|time\\s+for)\\s+(?:now\\s+|just\\s+|then\\s+)?${transitionVerb}\\s+${sqlTarget}\\b`, "i").test(normalized) ||
        /\b(?:sql\s+(?:round|portion|section|part|exercise|task|problem))\b(?:\s+\w+){0,6}\b(?:starts?|begins?)\s+now\b/i.test(normalized);

    // Agenda-style openers often mention SQL as a future stage while explicitly
    // starting with DBMS/OS/CN/OOPS right now. Do not treat those as SQL-round prompts.
    const hasAgendaSequencingCue = /\b(today\s+we(?:'ll| will)|we(?:'ll| will)\s+be\s+covering|we(?:'ll| will)\s+cover|also\s+have|followed\s+by|after\s+that|later|eventually|and\s+then|before\s+we|first\s+we(?:'ll| will)|let'?s\s+start\s+with)\b/i.test(normalized);
    const hasOtherFundamentalsTopicCue = /\b(dbms|databases?|operating\s+systems?|computer\s+networks?|cn|oops|object[- ]oriented)\b/i.test(normalized);
    const startsWithNonSqlTopicNow = /\b(let'?s|now)\s+(?:start|begin|move|dive)\s+(?:with|into|to)\s+(?:dbms|databases?|operating\s+systems?|computer\s+networks?|cn|oops|object[- ]oriented)\b/i.test(normalized);

    if ((hasAgendaSequencingCue && hasOtherFundamentalsTopicCue) || startsWithNonSqlTopicNow) {
        if (!hasImmediateSqlHandoffCue) {
            return false;
        }
    }

    const hasSqlRoundCue = /\bsql\s+(?:round|question|portion|section|part|exercise|task|problem|skills?)\b/i.test(normalized);
    const hasSqlTaskCue =
        /\b(write|run|execute|submit|solve|debug|optimize|review)\s+(?:an?\s+|your\s+|the\s+)?sql\s+query\b/i.test(normalized) ||
        /\bquery\s+problem\s+to\s+solve\b/i.test(normalized) ||
        /\b(query\s+(?:editor|against|this|the)|sql\s+editor|schema|tables?)\b/i.test(normalized) ||
        /\b(select\s+.+\s+from|join|group\s+by|order\s+by|having|where)\b/i.test(normalized);
    const hasInterviewQuestionCue = /\b(how\s+would\s+you\s+approach|talk\s+(?:me\s+)?through\s+your\s+approach|think\s+out\s+loud|walk\s+me\s+through|can\s+you\s+walk\s+me\s+through|explain\s+your\s+approach)\b/i.test(normalized);

    return hasImmediateSqlHandoffCue || (hasSqlRoundCue && hasSqlTaskCue) || (hasSqlTaskCue && hasInterviewQuestionCue);
}

/**
 * Detects when the AI is introducing a system design problem or starting
 * the system design stage (so we can force-open the scratchpad if the LLM
 * forgot to call open_scratchpad).
 */
export function isLikelySystemDesignPrompt(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    // Agenda-style opener — ignore.
    const hasAgendaSequencingCue = /\b(start\s+with|to\s+begin|then\s+move\s+on|followed\s+by|after\s+that|wrap\s+up|at\s+the\s+end)\b/i.test(normalized);
    const hasNonDesignStageCue = /\b(background|experience|about\s+yourself|coding\s+problem|fundamentals?|dsa|closing)\b/i.test(normalized);
    if (hasAgendaSequencingCue && hasNonDesignStageCue) {
        return false;
    }

    const transitionVerb = "(?:move\\s+on\\s+to|move\\s+to|shift\\s+to|switch\\s+to|turn\\s+to|jump\\s+into|dive\\s+into|transition\\s+to|pivot\\s+to|go\\s+to|proceed\\s+to|head\\s+to|start|begin)";
    const designTarget = "(?:the\\s+|our\\s+|a\\s+|this\\s+)?(?:system\\s+design|design\\s+(?:round|portion|section|part|problem|exercise|task|question|challenge)|architecture\\s+(?:round|problem|exercise)|scratchpad|whiteboard|design\\s+discussion)";

    const hasHandoffCue = new RegExp(`\\b(?:let'?s|we(?:'ll| will)?|i(?:'ll| will)?|now\\s+let'?s|we\\s+can|time\\s+for)\\s+(?:now\\s+|just\\s+|then\\s+)?${transitionVerb}\\s+${designTarget}\\b`, "i").test(normalized);

    const hasDesignProblemCue = /\b(design\s+(?:a|an|the)?\s*(?:url\s+shortener|rate\s+limiter|chat(?:\s+app)?|social\s+(?:network|media)|twitter|instagram|uber|airbnb|youtube|netflix|news\s+feed|search\s+engine|payment\s+system|messaging\s+system|notification\s+system|e[- ]?commerce|cache|cdn|file\s+storage|key[- ]value|distributed\s+\w+|scalable\s+\w+|high[- ]availability|load\s+balancer|web\s+crawler|feed|video\s+streaming|streaming\s+service|messenger|queue|analytics|api\s+gateway|authentication|billing|ride[- ]sharing|dating\s+app|forum|blog|marketplace|tinyurl|bitly|google|whatsapp|slack|zoom|dropbox|spotify|pinterest|yelp|tiktok)|how\s+would\s+you\s+design|design\s+this\s+system|sketch\s+(?:out|up)\s+(?:a|the|an)\s+high[- ]level|diagram\s+(?:out|up)?\s*(?:a|the|your)?\s*(?:architecture|design|system)|whiteboard\s+(?:a|the|your)|draw\s+(?:out|up)?\s*(?:a|the|your)?\s*(?:architecture|design|diagram|high[- ]level))\b/i.test(normalized);

    const hasInterviewQuestionCue = /\b(how\s+would\s+you\s+approach|talk\s+(?:me\s+)?through\s+your\s+approach|walk\s+me\s+through|start\s+(?:by\s+)?sketching|start\s+(?:by\s+)?drawing|start\s+with\s+(?:the\s+)?requirements)\b/i.test(normalized);

    if (hasDesignProblemCue && hasInterviewQuestionCue) return true;
    return hasHandoffCue;
}

/**
 * Detects when the AI is wrapping up / closing out the system design
 * stage (so we can force-close the scratchpad if the LLM forgot close_panel).
 */
export function isLikelySystemDesignClosingPrompt(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    const hasClosingCue = /\b(wrap(?:ping)?\s+up|conclud(?:e|ing)|move\s+(?:on\s+)?to\s+(?:the\s+)?(?:closing|final|wrap[- ]?up|last\s+section)|final\s+(?:thoughts|questions)|any\s+questions\s+for\s+(?:me|us)|that(?:'s|\s+is)\s+all\s+for\s+(?:the\s+)?(?:system\s+)?design|good\s+(?:job|work)\s+(?:on\s+)?(?:the\s+)?design|thanks\s+for\s+(?:the\s+|your\s+)?design|this\s+concludes\s+(?:the\s+)?(?:system\s+)?design)\b/i.test(normalized);

    const hasDesignContext = /\b(system\s+design|scratchpad|whiteboard|diagram|architecture)\b/i.test(normalized);

    return hasClosingCue && hasDesignContext;
}

/**
 * Detects when the AI is wrapping up / closing out the DSA coding stage
 * before the scratchpad-style panel has been closed (e.g. handoff from
 * DSA to fundamentals or CLOSING without close_panel).
 */
export function isLikelyDsaClosingPrompt(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    const hasClosingCue = /\b(wrap(?:ping)?\s+up|conclud(?:e|ing)|move\s+(?:on\s+)?to\s+(?:the\s+)?(?:next|closing|final|wrap[- ]?up|last\s+section)|good\s+(?:job|work)\s+(?:on\s+)?(?:that|the\s+coding|the\s+problem)|thanks\s+for\s+(?:walking|the\s+solution|solving)|this\s+concludes\s+(?:the\s+)?(?:coding|dsa))\b/i.test(normalized);

    const hasDsaContext = /\b(coding\s+(?:problem|round|portion|section|part)|dsa|algorithm|problem|solution|code|ide)\b/i.test(normalized);

    return hasClosingCue && hasDsaContext;
}
