import type { InterviewStage, InterviewType } from "@interviewforge/shared";
import { getInterviewTypeConfig } from "./interview-types/index.js";

export interface InterviewRuntimePolicy {
    interviewType: InterviewType;
    stageOrder: InterviewStage[];
    finalStage: InterviewStage;
    enforceSequentialTransitions: boolean;
    requireScratchpadBeforeLeavingSystemDesign: boolean;
    minSystemDesignExchangesBeforeClose: number;
}

const DEFAULT_MIN_SYSTEM_DESIGN_EXCHANGES = 3;

export function getInterviewRuntimePolicy(
    interviewType: InterviewType,
    stageOrderOverride?: InterviewStage[]
): InterviewRuntimePolicy {
    const config = getInterviewTypeConfig(interviewType);
    const stageOrder = stageOrderOverride && stageOrderOverride.length > 0
        ? stageOrderOverride
        : config.stages;

    const finalStage = stageOrder[stageOrder.length - 1];
    if (!finalStage) {
        throw new Error(`Interview type "${interviewType}" has no configured stages.`);
    }

    return {
        interviewType,
        stageOrder,
        finalStage,
        enforceSequentialTransitions: true,
        requireScratchpadBeforeLeavingSystemDesign: stageOrder.includes("SYSTEM_DESIGN"),
        minSystemDesignExchangesBeforeClose: DEFAULT_MIN_SYSTEM_DESIGN_EXCHANGES,
    };
}

export function getExpectedNextStage(
    interviewType: InterviewType,
    currentStage: InterviewStage,
    stageOrderOverride?: InterviewStage[]
): InterviewStage | null {
    const policy = getInterviewRuntimePolicy(interviewType, stageOrderOverride);
    const currentIdx = policy.stageOrder.indexOf(currentStage);
    if (currentIdx < 0) return null;

    return policy.stageOrder[currentIdx + 1] ?? null;
}
