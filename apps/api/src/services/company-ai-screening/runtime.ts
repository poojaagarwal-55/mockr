import type { ScreeningBlueprint, ScreeningPhase, ScreeningQuestion } from "./blueprint.js";

export type ScreeningTurn = {
    phaseIndex: number;
    questionIndex: number;
    followUpIndex: number;
    phaseTitle: string;
    questionId: string;
    prompt: string;
    kind: "question" | "follow_up";
    progress: {
        answeredQuestions: number;
        totalQuestions: number;
    };
};

export type ScreeningAnswerRecord = {
    phaseIndex: number;
    questionIndex: number;
    followUpIndex: number;
    phaseType: string;
    questionId: string;
    prompt: string;
    answer: string;
    answeredAt: string;
};

export type ScreeningAttemptState = {
    version: 1;
    status: "active" | "submitted";
    startedAt: string;
    submittedAt?: string | null;
    proctoringSessionId: string;
    interviewSessionId?: string | null;
    blueprintSnapshot: ScreeningBlueprint;
    currentPhaseIndex: number;
    currentQuestionIndex: number;
    followUpIndex: number;
    currentPrompt: string;
    answers: ScreeningAnswerRecord[];
};

function totalQuestions(blueprint: ScreeningBlueprint) {
    return blueprint.phases.reduce((sum, phase) => sum + phase.questions.length, 0);
}

function answeredMainQuestions(state: ScreeningAttemptState) {
    const keys = new Set<string>();
    for (const answer of state.answers) {
        if (answer.followUpIndex === 0) {
            keys.add(`${answer.phaseIndex}:${answer.questionIndex}`);
        }
    }
    return keys.size;
}

function phaseAt(blueprint: ScreeningBlueprint, index: number): ScreeningPhase | null {
    return blueprint.phases[index] || null;
}

function questionAt(blueprint: ScreeningBlueprint, phaseIndex: number, questionIndex: number): ScreeningQuestion | null {
    return phaseAt(blueprint, phaseIndex)?.questions[questionIndex] || null;
}

function nextQuestionPosition(blueprint: ScreeningBlueprint, phaseIndex: number, questionIndex: number) {
    const phase = phaseAt(blueprint, phaseIndex);
    if (phase && questionIndex + 1 < phase.questions.length) {
        return { phaseIndex, questionIndex: questionIndex + 1 };
    }
    for (let nextPhaseIndex = phaseIndex + 1; nextPhaseIndex < blueprint.phases.length; nextPhaseIndex++) {
        const nextPhase = phaseAt(blueprint, nextPhaseIndex);
        if (nextPhase?.questions.length) {
            return { phaseIndex: nextPhaseIndex, questionIndex: 0 };
        }
    }
    return null;
}

function fallbackFollowUp(question: ScreeningQuestion, followUpIndex: number) {
    const expected = question.expectedPoints
        .map((point) => point.text)
        .filter(Boolean)
        .slice(0, 3)
        .join("; ");
    const category = question.category.toLowerCase();
    if (category === "coding") {
        return followUpIndex === 1
            ? "Walk me through the approach and complexity you would use for this problem."
            : "What edge cases or optimizations would you verify before calling this solution complete?";
    }
    if (category === "cs_fundamentals" || category === "cs_sql" || category === "sql") {
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
    return expected
        ? `Add one more specific detail that helps verify this evidence: ${expected}`
        : "Can you add one concrete example, tradeoff, or verification detail?";
}

export function createScreeningAttemptState(args: {
    blueprint: ScreeningBlueprint;
    proctoringSessionId: string;
    interviewSessionId?: string | null;
    startedAt: string;
}): ScreeningAttemptState {
    const firstPhase = args.blueprint.phases.find((phase) => phase.questions.length);
    const firstPhaseIndex = firstPhase ? args.blueprint.phases.indexOf(firstPhase) : 0;
    const firstQuestion = firstPhase?.questions[0];
    return {
        version: 1,
        status: "active",
        startedAt: args.startedAt,
        submittedAt: null,
        proctoringSessionId: args.proctoringSessionId,
        interviewSessionId: args.interviewSessionId || null,
        blueprintSnapshot: args.blueprint,
        currentPhaseIndex: firstPhaseIndex,
        currentQuestionIndex: 0,
        followUpIndex: 0,
        currentPrompt: firstQuestion?.prompt || "The screening is ready.",
        answers: [],
    };
}

export function currentScreeningTurn(state: ScreeningAttemptState): ScreeningTurn | null {
    if (state.status !== "active") return null;
    const blueprint = state.blueprintSnapshot;
    const phase = phaseAt(blueprint, state.currentPhaseIndex);
    const question = questionAt(blueprint, state.currentPhaseIndex, state.currentQuestionIndex);
    if (!phase || !question) return null;

    return {
        phaseIndex: state.currentPhaseIndex,
        questionIndex: state.currentQuestionIndex,
        followUpIndex: state.followUpIndex,
        phaseTitle: phase.title,
        questionId: question.id,
        prompt: state.currentPrompt || question.prompt,
        kind: state.followUpIndex > 0 ? "follow_up" : "question",
        progress: {
            answeredQuestions: answeredMainQuestions(state),
            totalQuestions: totalQuestions(blueprint),
        },
    };
}

export function advanceScreeningAttempt(state: ScreeningAttemptState, answer: string) {
    const blueprint = state.blueprintSnapshot;
    const phase = phaseAt(blueprint, state.currentPhaseIndex);
    const question = questionAt(blueprint, state.currentPhaseIndex, state.currentQuestionIndex);
    if (!phase || !question || state.status !== "active") {
        return { state, turn: null, completed: true };
    }

    const nextState: ScreeningAttemptState = {
        ...state,
        answers: [
            ...state.answers,
            {
                phaseIndex: state.currentPhaseIndex,
                questionIndex: state.currentQuestionIndex,
                followUpIndex: state.followUpIndex,
                phaseType: phase.type,
                questionId: question.id,
                prompt: state.currentPrompt || question.prompt,
                answer: answer.trim(),
                answeredAt: new Date().toISOString(),
            },
        ],
    };

    const maxFollowUps = Math.max(0, Math.min(2, Number(question.followUpPolicy?.maxFollowUps ?? 2)));
    if (state.followUpIndex < maxFollowUps) {
        const followUpIndex = state.followUpIndex + 1;
        nextState.followUpIndex = followUpIndex;
        nextState.currentPrompt = fallbackFollowUp(question, followUpIndex);
        return {
            state: nextState,
            turn: currentScreeningTurn(nextState),
            completed: false,
        };
    }

    const nextPosition = nextQuestionPosition(blueprint, state.currentPhaseIndex, state.currentQuestionIndex);
    if (!nextPosition) {
        nextState.currentPrompt = "";
        return { state: nextState, turn: null, completed: true };
    }

    const nextQuestion = questionAt(blueprint, nextPosition.phaseIndex, nextPosition.questionIndex);
    nextState.currentPhaseIndex = nextPosition.phaseIndex;
    nextState.currentQuestionIndex = nextPosition.questionIndex;
    nextState.followUpIndex = 0;
    nextState.currentPrompt = nextQuestion?.prompt || "";
    return {
        state: nextState,
        turn: currentScreeningTurn(nextState),
        completed: false,
    };
}
