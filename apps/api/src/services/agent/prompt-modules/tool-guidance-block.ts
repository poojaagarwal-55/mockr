import type { InterviewStage } from "@interviewforge/shared";

const TOOL_DESCRIPTIONS: Record<string, string> = {
    fetch_question: "Fetch the current-stage DB question.",
    open_ide: "Open the coding editor with a valid questionId.",
    open_sql_editor: "Open the SQL editor for the server-prefetched SQL question.",
    open_scratchpad: "Open the notepad/whiteboard panel.",
    close_panel: "Close the active work panel.",
    run_candidate_code: "Run candidate code when requested or submitted.",
    give_hint: "Give one progressive hint when stuck.",
    transition_stage: "Move stages after current goals are met.",
    end_interview: "End the interview from the final enabled stage.",
    record_question: "Persist an asked bank question for reporting.",
};

export function buildToolUsageInstructions(
    stageTools: Partial<Record<InterviewStage, string[]>>,
    currentStage: InterviewStage
): string {
    const allowedTools = stageTools[currentStage] || [];

    const lines = ["## Tool Access (Current Stage)"];
    lines.push(`You can call ONLY these tools right now in stage ${currentStage}:`);

    if (allowedTools.length === 0) {
        lines.push("- none; continue with interviewer speech only.");
    }

    for (const tool of allowedTools) {
        lines.push(`- **${tool}**: ${TOOL_DESCRIPTIONS[tool] || tool}`);
    }

    lines.push("Rules: call only listed tools; tool calls are silent; when chaining tools, speak only after the chain completes.");

    return lines.join("\n");
}
