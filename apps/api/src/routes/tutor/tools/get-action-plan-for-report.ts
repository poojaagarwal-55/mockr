import type { TutorToolRunInput } from "../tool-types.js";

export async function runGetActionPlanForReportTool(input: TutorToolRunInput) {
    if (
        !input.getTutorBundle ||
        !input.setTutorBundle ||
        !input.parseTimespanFromMessage ||
        !input.generateActionPlanBundle
    ) {
        throw new Error("Action plan tool dependencies are missing");
    }

    const timespan = input.parseTimespanFromMessage(input.message);
    const cached = await input.getTutorBundle(input.context.report.id);
    let actionPlan = cached?.actionPlan || null;
    let source: "cached_generated" | "fresh_generated" = "cached_generated";

    if (!actionPlan || cached?.actionPlanTimespan !== timespan) {
        const generated = await input.generateActionPlanBundle(input.context, timespan);
        actionPlan = generated.actionPlan;
        source = "fresh_generated";
        await input.setTutorBundle(input.context.report.id, {
            reportId: input.context.report.id,
            actionPlan: generated.actionPlan,
            actionPlanTimespan: timespan,
            openingMessage: generated.openingMessage,
            updatedAt: Date.now(),
        });
    }

    return {
        actionPlan,
        timespan,
        source,
    };
}
