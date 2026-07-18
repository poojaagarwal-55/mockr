import type { InterviewType } from "@interviewforge/shared";
import { getInterviewTypeConfig, getModuleCompatibilityManifest } from "./interview-types/index.js";

export interface VoiceTextCompatibilityResult {
    compatible: boolean;
    gaps: string[];
}

export function validateVoiceTextCompatibility(interviewType: InterviewType): VoiceTextCompatibilityResult {
    const config = getInterviewTypeConfig(interviewType);
    const manifest = getModuleCompatibilityManifest(interviewType);

    const gaps: string[] = [];

    if (manifest.modeSupport && !manifest.modeSupport.voiceSupported) {
        gaps.push("voice mode is disabled in modeSupport");
    }

    if (!config.stages.length) {
        gaps.push("stage order is empty");
    }

    for (const stage of config.stages) {
        if (!(stage in config.stageTools)) {
            gaps.push(`missing stageTools mapping for ${stage}`);
        }
    }

    return {
        compatible: gaps.length === 0,
        gaps,
    };
}
