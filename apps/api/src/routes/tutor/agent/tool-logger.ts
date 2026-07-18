/**
 * Fire-and-forget writer for TutorToolCallLog rows.
 *
 * Per CLAUDE.md privacy rules we log only metadata (tool name, latency,
 * status, error code) — never tool inputs or outputs. The userId is a
 * relational key, not a log line, so we keep it raw for analytics
 * filtering.
 */

import { ToolCallStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import type { ToolExecutionResult } from "./tool-registry.js";

export function logToolCall(input: {
    userId: string;
    conversationId: string | null;
    result: ToolExecutionResult;
}): void {
    // Intentionally not awaited — logging must never delay the response.
    prisma.tutorToolCallLog
        .create({
            data: {
                userId: input.userId,
                conversationId: input.conversationId,
                toolName: input.result.name.slice(0, 80),
                status: input.result.ok ? ToolCallStatus.OK : ToolCallStatus.ERROR,
                latencyMs: Math.max(0, Math.min(60_000, input.result.latencyMs | 0)),
                errorCode: input.result.errorCode ? input.result.errorCode.slice(0, 40) : null,
            },
        })
        .catch((err) => {
            console.error("[tutor-agent] tool-call log write failed", {
                userId: `user-${input.userId.slice(0, 8)}`,
                tool: input.result.name,
                error: err?.message ?? err,
            });
        });
}
