import { validateToolArgs } from "./tool-args-schema.js";

export interface StreamedToolCall {
    id: string;
    name: string;
    arguments: string;
}

export type ServerControlSuggestion =
    | {
        kind: "transition_stage";
        toolCallId: string;
        args: { nextStage: string; reason: string };
    }
    | {
        kind: "end_interview";
        toolCallId: string;
        args: { summary: string };
    }
    | {
        kind: "invalid";
        toolCallId: string;
        message: string;
    };

export interface ServerActionPlan {
    passthroughToolCalls: StreamedToolCall[];
    controlSuggestions: ServerControlSuggestion[];
    deferredToolResponses: Array<{ toolCallId: string; content: string }>;
}

const CONTROL_TOOL_NAMES = new Set(["transition_stage", "end_interview"]);
const PANEL_OPEN_TOOL_NAMES = new Set(["open_ide", "open_sql_editor", "open_scratchpad"]);
const PANEL_CLOSE_TOOL_NAME = "close_panel";
const PREP_TOOL_NAMES = new Set(["record_question", "record_resume_probe", "fetch_question"]);
const EXECUTION_TOOL_NAMES = new Set(["run_candidate_code", "give_hint"]);

interface IndexedToolCall extends StreamedToolCall {
    index: number;
}

function isPanelAction(toolName: string): boolean {
    return PANEL_OPEN_TOOL_NAMES.has(toolName) || toolName === PANEL_CLOSE_TOOL_NAME;
}

function isPanelOpenAction(toolName: string): boolean {
    return PANEL_OPEN_TOOL_NAMES.has(toolName);
}

function withoutIndex(call: IndexedToolCall): StreamedToolCall {
    return {
        id: call.id,
        name: call.name,
        arguments: call.arguments,
    };
}

export function buildServerActionPlan(toolCalls: StreamedToolCall[]): ServerActionPlan {
    const passthroughIndexed: IndexedToolCall[] = [];
    const rankedControlSuggestions: Array<{ index: number; suggestion: ServerControlSuggestion }> = [];
    const validTransitions: Array<{ index: number; suggestion: Extract<ServerControlSuggestion, { kind: "transition_stage" }> }> = [];
    const validEnds: Array<{ index: number; suggestion: Extract<ServerControlSuggestion, { kind: "end_interview" }> }> = [];
    const rankedDeferredToolResponses: Array<{ index: number; toolCallId: string; content: string }> = [];

    const addDeferredResponse = (index: number, toolCallId: string, content: string) => {
        rankedDeferredToolResponses.push({ index, toolCallId, content });
    };

    for (let index = 0; index < toolCalls.length; index++) {
        const toolCall = toolCalls[index]!;

        if (!CONTROL_TOOL_NAMES.has(toolCall.name)) {
            passthroughIndexed.push({ ...toolCall, index });
            continue;
        }

        let parsedArgs: unknown;
        try {
            parsedArgs = JSON.parse(toolCall.arguments || "{}");
        } catch {
            rankedControlSuggestions.push({
                index,
                suggestion: {
                    kind: "invalid",
                    toolCallId: toolCall.id,
                    message: `Invalid JSON arguments for tool ${toolCall.name}.`,
                },
            });
            continue;
        }

        if (toolCall.name === "transition_stage") {
            const validated = validateToolArgs("transition_stage", parsedArgs);
            if (validated.success) {
                validTransitions.push({
                    index,
                    suggestion: {
                        kind: "transition_stage",
                        toolCallId: toolCall.id,
                        args: validated.data as { nextStage: string; reason: string },
                    },
                });
            } else {
                const failedValidation = validated as { success: false; message: string };
                rankedControlSuggestions.push({
                    index,
                    suggestion: {
                        kind: "invalid",
                        toolCallId: toolCall.id,
                        message: failedValidation.message,
                    },
                });
            }
            continue;
        }

        const validated = validateToolArgs("end_interview", parsedArgs);
        if (validated.success) {
            validEnds.push({
                index,
                suggestion: {
                    kind: "end_interview",
                    toolCallId: toolCall.id,
                    args: validated.data as { summary: string },
                },
            });
        } else {
            const failedValidation = validated as { success: false; message: string };
            rankedControlSuggestions.push({
                index,
                suggestion: {
                    kind: "invalid",
                    toolCallId: toolCall.id,
                    message: failedValidation.message,
                },
            });
        }
    }

    const selectedTransition = validTransitions.at(-1);
    const selectedEnd = validEnds.at(-1);

    for (const transition of validTransitions.slice(0, -1)) {
        addDeferredResponse(
            transition.index,
            transition.suggestion.toolCallId,
            "Suppressed by server control policy: only the latest transition_stage call is executed per turn."
        );
    }

    for (const endSuggestion of validEnds.slice(0, -1)) {
        addDeferredResponse(
            endSuggestion.index,
            endSuggestion.suggestion.toolCallId,
            "Suppressed by server control policy: only the latest end_interview call is executed per turn."
        );
    }

    if (selectedTransition) {
        rankedControlSuggestions.push({
            index: selectedTransition.index,
            suggestion: selectedTransition.suggestion,
        });
    }

    if (selectedEnd) {
        rankedControlSuggestions.push({
            index: selectedEnd.index,
            suggestion: selectedEnd.suggestion,
        });
    }

    rankedControlSuggestions.sort((a, b) => a.index - b.index);

    const panelActions = passthroughIndexed.filter((call) => isPanelAction(call.name));
    const selectedPanelAction = panelActions.at(-1);
    if (selectedPanelAction) {
        for (const suppressedPanelAction of panelActions.slice(0, -1)) {
            addDeferredResponse(
                suppressedPanelAction.index,
                suppressedPanelAction.id,
                "Suppressed by server sequencing policy: only the final panel action is executed per turn."
            );
        }
    }

    const nonPanelCalls = passthroughIndexed.filter((call) => !isPanelAction(call.name));
    const prepCalls = nonPanelCalls.filter((call) => PREP_TOOL_NAMES.has(call.name));
    const executionCalls = nonPanelCalls.filter((call) => EXECUTION_TOOL_NAMES.has(call.name));
    const otherCalls = nonPanelCalls.filter((call) => !PREP_TOOL_NAMES.has(call.name) && !EXECUTION_TOOL_NAMES.has(call.name));

    const orderedPassthroughCalls: IndexedToolCall[] = [
        ...prepCalls,
        ...(selectedPanelAction && isPanelOpenAction(selectedPanelAction.name) ? [selectedPanelAction] : []),
        ...executionCalls,
        ...otherCalls,
        ...(selectedPanelAction && selectedPanelAction.name === PANEL_CLOSE_TOOL_NAME ? [selectedPanelAction] : []),
    ];

    rankedDeferredToolResponses.sort((a, b) => a.index - b.index);

    return {
        passthroughToolCalls: orderedPassthroughCalls.map(withoutIndex),
        controlSuggestions: rankedControlSuggestions.map((entry) => entry.suggestion),
        deferredToolResponses: rankedDeferredToolResponses.map(({ toolCallId, content }) => ({ toolCallId, content })),
    };
}
