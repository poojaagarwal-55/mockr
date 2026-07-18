import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { screeningToolNamesForPhase, ALL_TOOL_DECLARATIONS } from "../agent/agent-tools.js";
import type { ScreeningPhaseType } from "./blueprint.js";

/**
 * COMPANY SCREENING tool exposure — PHASE-based, deliberately decoupled from the practice
 * stage machine.
 *
 * WHY THIS EXISTS (separate from the practice `getToolsForSession`): practice builds the LLM's
 * tool list from the InterviewStage (`config.stageTools[currentStage]`, guarded by `stageOrder`).
 * A screening runs the recruiter's phases inside a container stage, so routing screening through
 * the practice path (a) returns an EMPTY list whenever `currentStage` sits outside the container's
 * stageOrder, and (b) falls through to exposing EVERY practice tool (give_hint, fetch_question…)
 * for any stage the behavioural type doesn't define. Both are wrong for a screen.
 *
 * Here the tool set is decided PURELY by the recruiter's phase pointer (coding -> IDE,
 * cs_sql -> SQL editor, system_design -> scratchpad, behavioral -> notepad, closing ->
 * end_interview), so `currentStage` is irrelevant to screening tools. The phase -> tool-name
 * mapping is the single source of truth in `screeningToolNamesForPhase` (reused, NOT forked, so
 * exposure and the sequencer's gate can never drift), and the tool SCHEMAS come from the shared
 * `ALL_TOOL_DECLARATIONS`. Practice tool code is never touched — the runtime dispatches here only
 * for company screening sessions and to the practice `getToolsForSession` otherwise.
 */

const SCHEMA_BY_NAME: Map<string, ChatCompletionTool> = new Map(
    ALL_TOOL_DECLARATIONS
        .filter((tool): tool is ChatCompletionTool & { type: "function" } => tool.type === "function")
        .map((tool) => [tool.function.name, tool as ChatCompletionTool])
);

/**
 * The exact tool list a screening LLM gets for the phase the server currently has it on.
 * `phaseType` is the server-resolved current phase (null before the first question / between
 * phases → base tools only); `isClosing` is true once the server has entered CLOSING (only
 * end_interview is exposed then, so the model can't end early).
 */
export function buildScreeningTools(
    phaseType: ScreeningPhaseType | null | undefined,
    isClosing: boolean
): ChatCompletionTool[] {
    return screeningToolNamesForPhase(phaseType, isClosing)
        .map((name) => SCHEMA_BY_NAME.get(name))
        .filter((tool): tool is ChatCompletionTool => tool != null);
}
