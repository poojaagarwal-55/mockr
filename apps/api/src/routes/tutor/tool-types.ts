export type TutorToolName =
    | "resolve_report_from_user_reference"
    | "get_report_summary"
    | "get_report_stage_transcript_context"
    | "get_user_report_trend"
    | "get_question_activity_snapshot"
    | "get_sheet_status_for_report"
    | "get_action_plan_for_report"
    | "get_rubric_comparison"
    | "get_weak_area_drill_history"
    | "get_session_question_detail"
    | "get_score_percentile"
    | "get_accepted_action_plan";

export type TutorToolEvent = {
    toolName: TutorToolName;
    status: "ok" | "error";
    latencyMs: number;
    data?: unknown;
    error?: {
        code: string;
        message: string;
    };
};

export type ReportTrendQuerySpec = {
    typeFilter: string | null;
    sinceDate: Date | null;
    untilDate: Date | null;
    limit: number;
    includeAll: boolean;
    requestedTimespanDays: number | null;
    needExactTypeDistribution: boolean;
    exactDateText: string | null;
};

export type TutorRetrievalPlan = {
    tools: TutorToolName[];
    trendSpec: ReportTrendQuerySpec;
    plannerSource: "llm" | "fallback" | "cache";
};

export type TutorToolRunInput = {
    userId: string;
    message: string;
    context: any;
    retrievalPlan: TutorRetrievalPlan;
    maxTrendReports: number;
    getTutorBundle?: (reportId: string) => Promise<any>;
    setTutorBundle?: (reportId: string, bundle: any) => Promise<void>;
    parseTimespanFromMessage?: (text: string) => any;
    generateActionPlanBundle?: (context: any, timespan: any) => Promise<any>;
};

export type TutorToolRunResult = {
    toolName: TutorToolName;
    latencyMs: number;
    data?: unknown;
    error?: {
        code: string;
        message: string;
    };
};
