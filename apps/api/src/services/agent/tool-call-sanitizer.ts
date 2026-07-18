export interface StreamedToolCall {
    id: string;
    name: string;
    arguments: string;
}

export interface ToolCallSanitizationResult {
    allowedToolCalls: StreamedToolCall[];
    rejectedToolCalls: StreamedToolCall[];
    allowedToolNames: string[];
    rejectedToolNames: string[];
}

export function splitToolCallsByAvailability(
    toolCalls: StreamedToolCall[],
    allowedToolNames: Iterable<string>
): ToolCallSanitizationResult {
    const allowedSet = new Set<string>(allowedToolNames);
    const allowed: StreamedToolCall[] = [];
    const rejected: StreamedToolCall[] = [];

    for (const toolCall of toolCalls) {
        if (allowedSet.has(toolCall.name)) {
            allowed.push(toolCall);
        } else {
            rejected.push(toolCall);
        }
    }

    return {
        allowedToolCalls: allowed,
        rejectedToolCalls: rejected,
        allowedToolNames: Array.from(allowedSet),
        rejectedToolNames: Array.from(new Set(rejected.map((toolCall) => toolCall.name))),
    };
}

export function buildUnavailableToolNotice(
    rejectedToolNames: string[],
    allowedToolNames: string[]
): string {
    const rejected = rejectedToolNames.length > 0
        ? rejectedToolNames.join(", ")
        : "(none)";
    const allowed = allowedToolNames.length > 0
        ? allowedToolNames.join(", ")
        : "(none)";

    return `[SYSTEM NOTICE] Unauthorized tool call(s) were blocked and ignored: ${rejected}. ` +
        `You must ONLY use tools available in this stage: ${allowed}. ` +
        `Do not retry blocked tools; continue with allowed tools or normal interviewer speech.`;
}
