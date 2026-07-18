import type { ScreeningBlueprint, ScreeningPhase, ScreeningQuestion } from "./blueprint.js";

export type CompanyScreeningMockCursor = {
    phaseIndex: number;
    questionIndex: number;
    followUpIndex: number;
};

export type CompanyScreeningMockPromptMetadata = CompanyScreeningMockCursor & {
    version: 1;
    questionId: string;
    kind: "question" | "follow_up";
};

type MessageLike = {
    role: string;
    content?: string;
    metadata?: unknown;
};

type MockAnswerQuality = "usable" | "thin" | "skip" | "off_topic" | "abusive";

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function boolEnv(value: string | undefined) {
    return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function isCompanyScreeningMockInterviewerEnabled() {
    return boolEnv(process.env.COMPANY_AI_SCREENING_DETERMINISTIC_MOCK);
}

export function isCompanyScreeningTextOnlyTtsEnabled() {
    return boolEnv(process.env.COMPANY_AI_SCREENING_TEXT_ONLY_TTS)
        || boolEnv(process.env.COMPANY_AI_SCREENING_MOCK_INTERVIEWER);
}

export function isCompanyScreeningTestRestartEnabled() {
    return isCompanyScreeningMockInterviewerEnabled() || isCompanyScreeningTextOnlyTtsEnabled();
}

function firstCursor(blueprint: ScreeningBlueprint): CompanyScreeningMockCursor | null {
    for (let phaseIndex = 0; phaseIndex < blueprint.phases.length; phaseIndex += 1) {
        if (blueprint.phases[phaseIndex]?.questions.length) {
            return { phaseIndex, questionIndex: 0, followUpIndex: 0 };
        }
    }
    return null;
}

function phaseAt(blueprint: ScreeningBlueprint, cursor: CompanyScreeningMockCursor): ScreeningPhase | null {
    return blueprint.phases[cursor.phaseIndex] || null;
}

function questionAt(blueprint: ScreeningBlueprint, cursor: CompanyScreeningMockCursor): ScreeningQuestion | null {
    return phaseAt(blueprint, cursor)?.questions[cursor.questionIndex] || null;
}

function nextMainQuestionCursor(blueprint: ScreeningBlueprint, cursor: CompanyScreeningMockCursor): CompanyScreeningMockCursor | null {
    const phase = phaseAt(blueprint, cursor);
    if (phase && cursor.questionIndex + 1 < phase.questions.length) {
        return { phaseIndex: cursor.phaseIndex, questionIndex: cursor.questionIndex + 1, followUpIndex: 0 };
    }

    for (let phaseIndex = cursor.phaseIndex + 1; phaseIndex < blueprint.phases.length; phaseIndex += 1) {
        if (blueprint.phases[phaseIndex]?.questions.length) {
            return { phaseIndex, questionIndex: 0, followUpIndex: 0 };
        }
    }

    return null;
}

export function advanceCompanyScreeningMockCursor(
    blueprint: ScreeningBlueprint,
    cursor: CompanyScreeningMockCursor,
    answer?: string | null
): CompanyScreeningMockCursor | null {
    const question = questionAt(blueprint, cursor);
    if (!question) return null;

    const maxFollowUps = Math.max(0, Math.min(2, Number(question.followUpPolicy?.maxFollowUps ?? 0)));
    const quality = classifyMockAnswer(answer);

    if (quality === "skip" || quality === "abusive") {
        return nextMainQuestionCursor(blueprint, cursor);
    }

    if (quality === "off_topic" || quality === "thin") {
        if (cursor.followUpIndex === 0 && maxFollowUps > 0) {
            return {
                phaseIndex: cursor.phaseIndex,
                questionIndex: cursor.questionIndex,
                followUpIndex: 1,
            };
        }
        return nextMainQuestionCursor(blueprint, cursor);
    }

    if (cursor.followUpIndex < maxFollowUps) {
        return {
            phaseIndex: cursor.phaseIndex,
            questionIndex: cursor.questionIndex,
            followUpIndex: cursor.followUpIndex + 1,
        };
    }

    return nextMainQuestionCursor(blueprint, cursor);
}

function classifyMockAnswer(answer?: string | null): MockAnswerQuality {
    const normalized = String(answer || "").trim().toLowerCase();
    if (!normalized) return "thin";
    if (/\b(fuck|shit|bitch|asshole|chutiya|madarchod|bhenchod)\b/i.test(normalized)) return "abusive";
    if (/^(skip|pass|next|idk|i don'?t know|no idea|noidea|n\/a|na)\b/i.test(normalized)) return "skip";
    if (/\b(what'?s your name|who are you|your name|i am asking you|answer me|tell me about yourself)\b/i.test(normalized)) return "off_topic";
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount < 4) return "thin";
    return "usable";
}

function followUpPrompt(question: ScreeningQuestion, followUpIndex: number, previousAnswer?: string | null) {
    const quality = classifyMockAnswer(previousAnswer);
    if (quality === "abusive") {
        return "Please keep the interview professional. I will move to the next configured question.";
    }
    if (quality === "skip") {
        return "Okay, I will mark this as not answered and move to the next configured question.";
    }
    if (quality === "off_topic") {
        return "Please answer the screening question directly. Give the most relevant work, decision, or concept explanation you can.";
    }
    if (quality === "thin") {
        return "Please add a little more detail so there is enough evidence to evaluate this answer.";
    }

    const category = question.category.toLowerCase();

    if (category === "coding") {
        return followUpIndex === 1
            ? "Walk me through the approach and complexity you would use for this problem."
            : "What edge cases or optimizations would you verify before calling this solution complete?";
    }
    if (category === "cs_fundamentals") {
        return followUpIndex === 1
            ? "Can you explain that with one concrete example or scenario?"
            : "What is a common mistake or tradeoff related to this concept?";
    }
    if (category === "system_design") {
        return followUpIndex === 1
            ? "What are the main components and data flows in your design?"
            : "What bottleneck or failure mode would you handle first, and why?";
    }
    if (category === "resume" || category === "resume_project") {
        return followUpIndex === 1
            ? "What part of that work did you personally own, and how did you verify it worked?"
            : "What tradeoff, failure, or measurable result from that work is most important for this role?";
    }

    return followUpIndex === 1
        ? "Can you add one concrete example or detail that supports your answer?"
        : "What tradeoff, edge case, or verification detail should I know about here?";
}

export function buildCompanyScreeningMockPrompt(
    blueprint: ScreeningBlueprint,
    cursor: CompanyScreeningMockCursor,
    previousAnswer?: string | null
): { content: string; metadata: CompanyScreeningMockPromptMetadata } | null {
    const phase = phaseAt(blueprint, cursor);
    const question = questionAt(blueprint, cursor);
    if (!phase || !question) return null;

    const isFollowUp = cursor.followUpIndex > 0;
    const content = isFollowUp
        ? followUpPrompt(question, cursor.followUpIndex, previousAnswer)
        : `${phase.title}. ${question.prompt}`;

    return {
        content,
        metadata: {
            version: 1,
            phaseIndex: cursor.phaseIndex,
            questionIndex: cursor.questionIndex,
            followUpIndex: cursor.followUpIndex,
            questionId: question.id,
            kind: isFollowUp ? "follow_up" : "question",
        },
    };
}

function promptMetadata(message: MessageLike): CompanyScreeningMockPromptMetadata | null {
    const metadata = toRecord(message.metadata);
    const prompt = toRecord(metadata.companyScreeningMockPrompt);
    if (prompt.version !== 1) return null;

    return {
        version: 1,
        phaseIndex: Number(prompt.phaseIndex || 0),
        questionIndex: Number(prompt.questionIndex || 0),
        followUpIndex: Number(prompt.followUpIndex || 0),
        questionId: String(prompt.questionId || ""),
        kind: prompt.kind === "follow_up" ? "follow_up" : "question",
    };
}

export function deriveCompanyScreeningMockPosition(
    blueprint: ScreeningBlueprint,
    messages: MessageLike[]
): { cursor: CompanyScreeningMockCursor | null; waitingForAnswer: boolean } {
    let cursor = firstCursor(blueprint);
    let waitingForAnswer = false;
    let lastPrompt: CompanyScreeningMockCursor | null = null;

    for (const message of messages) {
        if (message.role === "assistant") {
            const prompt = promptMetadata(message);
            if (prompt) {
                lastPrompt = {
                    phaseIndex: prompt.phaseIndex,
                    questionIndex: prompt.questionIndex,
                    followUpIndex: prompt.followUpIndex,
                };
                cursor = lastPrompt;
                waitingForAnswer = true;
            }
            continue;
        }

        if (message.role === "user" && waitingForAnswer && lastPrompt) {
            cursor = advanceCompanyScreeningMockCursor(blueprint, lastPrompt, message.content);
            waitingForAnswer = false;
            lastPrompt = null;
        }
    }

    return { cursor, waitingForAnswer };
}
