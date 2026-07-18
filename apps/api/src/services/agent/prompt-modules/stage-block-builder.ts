import type { InterviewStage } from "@interviewforge/shared";
import type { InterviewTypeConfig, StagePromptModule } from "../interview-types/base.js";

function buildStagePromptFromModule(stage: InterviewStage, module: StagePromptModule): string {
    const sections: string[] = [`## Stage: ${stage}`];

    if (module.opening?.trim()) sections.push(module.opening.trim());
    if (module.mandatorySteps?.trim()) {
        sections.push("### Mandatory Steps");
        sections.push(module.mandatorySteps.trim());
    }
    if (module.evaluationCriteria?.trim()) {
        sections.push("### Evaluation Criteria");
        sections.push(module.evaluationCriteria.trim());
    }
    if (module.toolGuidance?.trim()) {
        sections.push("### Tool Guidance");
        sections.push(module.toolGuidance.trim());
    }
    if (module.transitions?.trim()) {
        sections.push("### Transition Guidance");
        sections.push(module.transitions.trim());
    }
    if (module.closeout?.trim()) {
        sections.push("### Closeout");
        sections.push(module.closeout.trim());
    }

    return sections.join("\n\n");
}

export function resolveStagePrompt(
    config: InterviewTypeConfig,
    stage: InterviewStage
): string {
    const module = config.stagePromptModules?.[stage];
    if (module) {
        return buildStagePromptFromModule(stage, module);
    }

    return config.stagePrompts[stage] || "";
}
