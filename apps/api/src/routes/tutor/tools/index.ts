import type { TutorToolName, TutorToolRunInput, TutorToolRunResult } from "../tool-types.js";
import { runGetActionPlanForReportTool } from "./get-action-plan-for-report.js";
import { runGetQuestionActivitySnapshotTool } from "./get-question-activity-snapshot.js";
import { runGetReportSummaryTool } from "./get-report-summary.js";
import { runGetReportStageTranscriptContextTool } from "./get-report-stage-transcript-context.js";
import { runGetSheetStatusForReportTool } from "./get-sheet-status-for-report.js";
import { runGetUserReportTrendTool } from "./get-user-report-trend.js";
import { runGetRubricComparisonTool } from "./get-rubric-comparison.js";
import { runGetWeakAreaDrillHistoryTool } from "./get-weak-area-drill-history.js";
import { runGetSessionQuestionDetailTool } from "./get-session-question-detail.js";
import { runGetScorePercentileTool } from "./get-score-percentile.js";
import { runGetAcceptedActionPlanTool } from "./get-accepted-action-plan.js";

export async function runTutorTool(toolName: TutorToolName, input: TutorToolRunInput): Promise<TutorToolRunResult> {
    const startedAt = Date.now();

    try {
        let data: unknown = null;

        if (toolName === "get_report_summary") {
            data = await runGetReportSummaryTool(input);
        } else if (toolName === "get_report_stage_transcript_context") {
            data = await runGetReportStageTranscriptContextTool(input);
        } else if (toolName === "get_user_report_trend") {
            data = await runGetUserReportTrendTool(input);
        } else if (toolName === "get_question_activity_snapshot") {
            data = await runGetQuestionActivitySnapshotTool(input);
        } else if (toolName === "get_sheet_status_for_report") {
            data = await runGetSheetStatusForReportTool(input);
        } else if (toolName === "get_action_plan_for_report") {
            data = await runGetActionPlanForReportTool(input);
        } else if (toolName === "get_rubric_comparison") {
            data = await runGetRubricComparisonTool(input);
        } else if (toolName === "get_weak_area_drill_history") {
            data = await runGetWeakAreaDrillHistoryTool(input);
        } else if (toolName === "get_session_question_detail") {
            data = await runGetSessionQuestionDetailTool(input);
        } else if (toolName === "get_score_percentile") {
            data = await runGetScorePercentileTool(input);
        } else if (toolName === "get_accepted_action_plan") {
            data = await runGetAcceptedActionPlanTool(input);
        }

        return {
            toolName,
            data,
            latencyMs: Date.now() - startedAt,
        };
    } catch (error: any) {
        return {
            toolName,
            error: {
                code: "TOOL_EXECUTION_FAILED",
                message: error?.message || "Tool execution failed",
            },
            latencyMs: Date.now() - startedAt,
        };
    }
}
