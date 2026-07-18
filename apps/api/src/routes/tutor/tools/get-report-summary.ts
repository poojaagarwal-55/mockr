import type { TutorToolRunInput } from "../tool-types.js";
import { buildEffectiveInterviewConfig } from "../module-context.js";

export async function runGetReportSummaryTool(input: TutorToolRunInput) {
    const { context } = input;
    const session = context.report.session;

    return {
        report: {
            reportId: context.report.id,
            sessionId: context.report.sessionId,
            type: session.type,
            role: session.role,
            level: session.level,
            effectiveInterviewConfig: buildEffectiveInterviewConfig(session.type, session.moduleConfig),
            overallScore: Math.round(Number(context.report.overallScore) || 0),
            generatedAt: context.report.generatedAt,
            rubricScores: context.rubricScores,
            competencyScores: context.competencyScores,
            strengths: context.report.strengths,
            improvements: context.report.improvements,
        },
    };
}
