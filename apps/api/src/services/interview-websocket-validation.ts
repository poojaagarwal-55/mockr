import { z } from "zod";

const SESSION_ID_SCHEMA = z.string().uuid();
const LANGUAGE_SCHEMA = z.string().trim().min(1).max(32);
const QUESTION_ID_SCHEMA = z.string().trim().min(1).max(256);
const CANVAS_SNAPSHOT_SCHEMA = z.union([
    z.array(z.unknown()),
    z.record(z.unknown()),
]);

export const sessionJoinPayloadSchema = z.object({
    sessionId: SESSION_ID_SCHEMA,
    isVoiceMode: z.boolean().optional(),
});

export const chatMessagePayloadSchema = z.object({
    content: z.string().trim().min(1).max(10_000),
    canvasSnapshot: CANVAS_SNAPSHOT_SCHEMA.optional(),
});

export const codeSnapshotPayloadSchema = z.object({
    code: z.string().max(200_000),
    language: LANGUAGE_SCHEMA,
});

export const canvasSnapshotPayloadSchema = z.object({
    elements: CANVAS_SNAPSHOT_SCHEMA,
});

export const notepadSnapshotPayloadSchema = z.object({
    html: z.string().max(200_000),
});

export const codeRunPayloadSchema = z.object({
    code: z.string().min(1).max(200_000),
    language: LANGUAGE_SCHEMA,
    questionId: QUESTION_ID_SCHEMA,
});

export const voiceAudioPayloadSchema = z.object({
    data: z.string().min(1).max(2_000_000),
    mimeType: z.string().trim().min(1).max(120).optional(),
});

export const voiceBinaryAudioPayloadSchema = z.object({
    audio: z.unknown(),
    mimeType: z.string().trim().min(1).max(120).optional(),
});

const voiceTextBasePayloadSchema = z.object({
    text: z.string().trim().min(1).max(10_000),
});

export const voiceTextPayloadSchema = z.object({
    text: z.string().trim().min(1).max(10_000),
    canvasSnapshot: z.preprocess(
        (value) => (value == null ? undefined : value),
        CANVAS_SNAPSHOT_SCHEMA.optional()
    ),
});

export const voiceMutePayloadSchema = z.object({
    muted: z.boolean(),
});

export const voicePTTModePayloadSchema = z.object({
    enabled: z.boolean(),
});

export type ParsedVoiceTextPayload = {
    text: string;
    canvasSnapshot?: Record<string, unknown> | unknown[];
};

export type VoiceTextParseResult =
    | { success: true; data: ParsedVoiceTextPayload; ignoredInvalidCanvasSnapshot: boolean }
    | { success: false; error: z.ZodError };

// For mode switches, text should never be blocked by an invalid optional snapshot.
export function parseVoiceTextPayload(payload: unknown): VoiceTextParseResult {
    const parsed = voiceTextPayloadSchema.safeParse(payload);
    if (parsed.success) {
        const parsedPayload: ParsedVoiceTextPayload = {
            text: parsed.data.text,
        };

        if (parsed.data.canvasSnapshot !== undefined) {
            parsedPayload.canvasSnapshot = parsed.data.canvasSnapshot;
        }

        return {
            success: true,
            data: parsedPayload,
            ignoredInvalidCanvasSnapshot: false,
        };
    }

    const textOnly = voiceTextBasePayloadSchema.safeParse(payload);
    if (textOnly.success) {
        return {
            success: true,
            data: { text: textOnly.data.text },
            ignoredInvalidCanvasSnapshot: true,
        };
    }

    return { success: false, error: parsed.error };
}

export function summarizeValidationError(error: z.ZodError): string {
    return error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
        .join("; ");
}
