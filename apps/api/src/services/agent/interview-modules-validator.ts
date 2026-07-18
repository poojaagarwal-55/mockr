import type { InterviewType } from "@interviewforge/shared";
import {
    getInterviewTypeConfig,
    getModuleCompatibilityManifest,
} from "./interview-types/index.js";
import { resolveEffectiveInterviewTypeConfig } from "./interview-module-selection.js";

export interface PreflightValidationInput {
    interviewType: InterviewType;
    role: string;
    level: string;
    hasResume: boolean;
    isVoiceMode: boolean;
    moduleConfig?: unknown;
}

export interface CompatibilityValidationError {
    code: string;
    message: string;
    severity: "critical" | "error";
    field?: string;
    suggestion?: string;
}

export interface CompatibilityValidationWarning {
    code: string;
    message: string;
    impact?: string;
}

export interface CompatibilityValidationResult {
    valid: boolean;
    errors: CompatibilityValidationError[];
    warnings: CompatibilityValidationWarning[];
}

export class InterviewModulesValidator {
    validate(input: PreflightValidationInput): CompatibilityValidationResult {
        const errors: CompatibilityValidationError[] = [];
        const warnings: CompatibilityValidationWarning[] = [];

        let config;
        try {
            config = getInterviewTypeConfig(input.interviewType);
        } catch (error) {
            errors.push({
                code: "INTERVIEW_TYPE_UNREGISTERED",
                message: `Interview type \"${input.interviewType}\" is not registered.`,
                severity: "critical",
                field: "type",
            });

            return { valid: false, errors, warnings };
        }

        const manifestValidation = this.validateManifest(input.interviewType);
        if (!manifestValidation.valid) {
            for (const manifestError of manifestValidation.errors) {
                errors.push({
                    code: "MANIFEST_INVALID",
                    message: manifestError,
                    severity: "error",
                });
            }
        }

        const effectiveConfig = resolveEffectiveInterviewTypeConfig(input.interviewType, input.moduleConfig);
        const manifest = effectiveConfig.compatibilityManifest || getModuleCompatibilityManifest(input.interviewType);

        if (!effectiveConfig.stages.length) {
            errors.push({
                code: "EMPTY_STAGE_ORDER",
                message: `Interview type \"${input.interviewType}\" has no configured stages.`,
                severity: "critical",
            });
        }

        if (manifest.prefetchRequirements.requiresResume && !input.hasResume) {
            warnings.push({
                code: "RESUME_MISSING_OPTIONAL",
                message: `${config.label} works best with a resume but none was provided.`,
                impact: "Intro/background probing quality may be reduced.",
            });
        }

        if (input.isVoiceMode && manifest.modeSupport && !manifest.modeSupport.voiceSupported) {
            errors.push({
                code: "VOICE_MODE_UNSUPPORTED",
                message: `${config.label} is not configured for voice mode.`,
                severity: "error",
                suggestion: "Start this interview in text mode.",
            });
        }

        const practiceStages = effectiveConfig.stages.filter((stage) => stage !== "CLOSING");
        if (practiceStages.length === 0) {
            errors.push({
                code: "NO_PRACTICE_MODULE_SELECTED",
                message: "Select at least one interview module before starting.",
                severity: "error",
                field: "moduleConfig.enabledStages",
            });
        }

        for (const stage of effectiveConfig.stages) {
            const tools = effectiveConfig.stageTools[stage] || [];
            if (tools.length === 0 && stage !== "CLOSING") {
                warnings.push({
                    code: "STAGE_HAS_NO_TOOLS",
                    message: `${config.label} stage ${stage} has no configured tools.`,
                });
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    validateManifest(interviewType: InterviewType): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        const config = getInterviewTypeConfig(interviewType);
        const manifest = getModuleCompatibilityManifest(interviewType);

        if (!manifest.prefetchRequirements) {
            errors.push("Missing prefetchRequirements in compatibility manifest.");
        }

        const stageContracts = manifest.stageContracts || {};
        for (const stage of config.stages) {
            if (!stageContracts[stage]) {
                errors.push(`Missing stage contract for ${stage}.`);
            }
        }

        for (const stage of Object.keys(stageContracts)) {
            if (!config.stages.includes(stage as any)) {
                errors.push(`Stage contract declared for unsupported stage: ${stage}.`);
            }
        }

        return { valid: errors.length === 0, errors };
    }
}
