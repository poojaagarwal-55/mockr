import { z } from "zod";
import type { ProctoringEventInput } from "@interviewforge/shared";

const severityHintSchema = z.object({
    client_severity_hint: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
});

const emptyPayloadSchema = severityHintSchema.strict();

const eventBaseSchema = {
    client_event_id: z.string().trim().min(1).max(220),
    client_timestamp: z.string().datetime(),
};

function eventSchema<T extends string, S extends z.ZodTypeAny>(eventType: T, payload: S) {
    return z.object({
        ...eventBaseSchema,
        event_type: z.literal(eventType),
        payload,
    });
}

const numberMsSchema = z.number().finite().nonnegative();

export const proctoringEventInputSchema = z.discriminatedUnion("event_type", [
    eventSchema("session_start", emptyPayloadSchema),
    eventSchema("session_heartbeat", severityHintSchema.extend({ ts: z.number().finite() }).strict()),
    eventSchema("face_absent", severityHintSchema.extend({ duration_ms: numberMsSchema }).strict()),
    eventSchema("face_multiple", severityHintSchema.extend({
        count: z.number().int().min(1).max(20),
        duration_ms: numberMsSchema,
    }).strict()),
    eventSchema("face_looking_away", severityHintSchema.extend({
        direction: z.enum(["left", "right", "down", "up"]),
        duration_ms: numberMsSchema,
    }).strict()),
    eventSchema("object_detected", severityHintSchema.extend({
        label: z.enum(["object", "cell phone", "book", "laptop", "tv"]),
        confidence: z.number().finite().min(0).max(1),
    }).strict()),
    eventSchema("tab_hidden", severityHintSchema.extend({ duration_ms: numberMsSchema }).strict()),
    eventSchema("window_blur", severityHintSchema.extend({ duration_ms: numberMsSchema }).strict()),
    eventSchema("fullscreen_exit", emptyPayloadSchema),
    eventSchema("devtools_opened", severityHintSchema.extend({
        detection_method: z.string().trim().min(1).max(120),
    }).strict()),
    eventSchema("copy", severityHintSchema.extend({ char_count: z.number().int().nonnegative().max(1_000_000) }).strict()),
    eventSchema("paste", severityHintSchema.extend({ char_count: z.number().int().nonnegative().max(1_000_000) }).strict()),
    eventSchema("cut", severityHintSchema.extend({ char_count: z.number().int().nonnegative().max(1_000_000) }).strict()),
    eventSchema("contextmenu", emptyPayloadSchema),
    eventSchema("webcam_revoked", emptyPayloadSchema),
    eventSchema("webcam_stream_ended", emptyPayloadSchema),
    eventSchema("heartbeat_gap", severityHintSchema.extend({ gap_ms: numberMsSchema }).strict()),
    eventSchema("multi_session_attempt", severityHintSchema.extend({
        attempted_from_ip: z.string().trim().min(1).max(120),
    }).strict()),
    eventSchema("network_disconnect", emptyPayloadSchema),
    eventSchema("network_reconnect", severityHintSchema.extend({ offline_ms: numberMsSchema }).strict()),
]) as z.ZodType<ProctoringEventInput>;

export const proctoringEventsBodySchema = z.object({
    events: z.array(proctoringEventInputSchema).min(1).max(50),
});
