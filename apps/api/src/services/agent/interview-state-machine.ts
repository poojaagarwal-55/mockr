import type { InterviewStage, InterviewType } from "@interviewforge/shared";
import {
    getExpectedNextStage,
    getInterviewRuntimePolicy,
} from "./interview-runtime-policy.js";

export type TransitionRejectionCode =
    | "invalid_current_stage"
    | "invalid_next_stage"
    | "non_forward_transition"
    | "stage_skip_blocked"
    | "scratchpad_required"
    | "minimum_exchanges_required";

export interface StageTransitionValidationInput {
    interviewType: InterviewType;
    currentStage: InterviewStage;
    nextStage: InterviewStage;
    stageOrder?: InterviewStage[];
    scratchpadOpened?: boolean;
    systemDesignExchangeCount?: number;
}

export type StageTransitionValidationResult =
    | {
        allowed: true;
        code: "ok";
        message: string;
        expectedNextStage: InterviewStage | null;
    }
    | {
        allowed: false;
        code: TransitionRejectionCode;
        message: string;
        expectedNextStage: InterviewStage | null;
    };

export interface EndInterviewValidationInput {
    interviewType: InterviewType;
    currentStage: InterviewStage;
    stageOrder?: InterviewStage[];
    scratchpadOpened?: boolean;
}

export type EndInterviewValidationResult =
    | { allowed: true; code: "ok"; message: string }
    | { allowed: false; code: "not_final_stage" | "scratchpad_required"; message: string };

export function validateStageTransition(
    input: StageTransitionValidationInput
): StageTransitionValidationResult {
    const policy = getInterviewRuntimePolicy(input.interviewType, input.stageOrder);
    const { stageOrder } = policy;

    const currentIdx = stageOrder.indexOf(input.currentStage);
    if (currentIdx < 0) {
        return {
            allowed: false,
            code: "invalid_current_stage",
            message: `Current stage \"${input.currentStage}\" is not valid for this interview type. Stage order: ${stageOrder.join(" -> ")}.`,
            expectedNextStage: null,
        };
    }

    const nextIdx = stageOrder.indexOf(input.nextStage);
    if (nextIdx < 0) {
        return {
            allowed: false,
            code: "invalid_next_stage",
            message: `Invalid stage: \"${input.nextStage}\" for this interview type. Valid stages: ${stageOrder.join(", ")}.`,
            expectedNextStage: getExpectedNextStage(input.interviewType, input.currentStage, stageOrder),
        };
    }

    const expectedNextStage = getExpectedNextStage(input.interviewType, input.currentStage, stageOrder);

    if (nextIdx <= currentIdx) {
        return {
            allowed: false,
            code: "non_forward_transition",
            message: `Cannot transition from ${input.currentStage} to ${input.nextStage} - can only move forward. Stage order: ${stageOrder.join(" -> ")}.`,
            expectedNextStage,
        };
    }

    if (policy.enforceSequentialTransitions && expectedNextStage && input.nextStage !== expectedNextStage) {
        return {
            allowed: false,
            code: "stage_skip_blocked",
            message: `Cannot skip stages. You are in ${input.currentStage} and must transition to ${expectedNextStage} next, not ${input.nextStage}. Stage order: ${stageOrder.join(" -> ")}.`,
            expectedNextStage,
        };
    }

    if (
        input.currentStage === "SYSTEM_DESIGN" &&
        policy.requireScratchpadBeforeLeavingSystemDesign
    ) {
        const exchangeCount = input.systemDesignExchangeCount ?? 0;
        const scratchpadUsed = input.scratchpadOpened === true || exchangeCount > 0;

        if (!scratchpadUsed) {
            return {
                allowed: false,
                code: "scratchpad_required",
                message:
                    "CANNOT transition out of the System Design stage yet. The scratchpad/whiteboard has NOT been opened. You MUST call open_scratchpad first and have the candidate draw their architecture.",
                expectedNextStage,
            };
        }

        if (exchangeCount < policy.minSystemDesignExchangesBeforeClose) {
            return {
                allowed: false,
                code: "minimum_exchanges_required",
                message:
                    `CANNOT transition out of System Design yet. Only ${exchangeCount} of ${policy.minSystemDesignExchangesBeforeClose} required exchanges have occurred. Continue the design discussion.`,
                expectedNextStage,
            };
        }
    }

    return {
        allowed: true,
        code: "ok",
        message: "Transition approved.",
        expectedNextStage,
    };
}

export function validateEndInterview(
    input: EndInterviewValidationInput
): EndInterviewValidationResult {
    const policy = getInterviewRuntimePolicy(input.interviewType, input.stageOrder);

    if (input.currentStage !== policy.finalStage && input.currentStage !== "CLOSING") {
        return {
            allowed: false,
            code: "not_final_stage",
            message: `Cannot end the interview during ${input.currentStage} stage. Complete the current stage first.`,
        };
    }

    if (
        policy.stageOrder.includes("SYSTEM_DESIGN") &&
        input.currentStage !== "CLOSING" &&
        input.scratchpadOpened !== true
    ) {
        return {
            allowed: false,
            code: "scratchpad_required",
            message:
                "Cannot end the interview - the System Design whiteboard was never used. You must use the scratchpad before ending.",
        };
    }

    return {
        allowed: true,
        code: "ok",
        message: "Interview end approved.",
    };
}
