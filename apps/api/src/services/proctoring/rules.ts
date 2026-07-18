import type {
    ProctoringEventPayload,
    ProctoringEventRecord,
    ProctoringEventType,
    ProctoringRules,
    ProctoringSeverity,
    ProctoringTerminationReason,
} from "@interviewforge/shared";

const knownEventTypes: readonly ProctoringEventType[] = [
    "session_start",
    "session_heartbeat",
    "face_absent",
    "face_multiple",
    "face_looking_away",
    "object_detected",
    "tab_hidden",
    "window_blur",
    "fullscreen_exit",
    "devtools_opened",
    "copy",
    "paste",
    "cut",
    "contextmenu",
    "webcam_revoked",
    "webcam_stream_ended",
    "heartbeat_gap",
    "multi_session_attempt",
    "network_disconnect",
    "network_reconnect",
];

export const SERVER_ONLY_PROCTORING_EVENT_TYPES: readonly ProctoringEventType[] = [
    "heartbeat_gap",
    "multi_session_attempt",
    "network_disconnect",
    "network_reconnect",
];

const severityMultipliers: Record<ProctoringSeverity, number> = {
    info: 0,
    low: 0.5,
    medium: 1,
    high: 2,
    critical: 4,
};

const severityRank: Record<ProctoringSeverity, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};

export type ProctoringSessionForEvaluation = {
    id: string;
    status: string;
};

export type ProctoringEvaluationResult = {
    shouldTerminate: boolean;
    terminationReason?: ProctoringTerminationReason;
};

function isKnownEventType(eventType: string): eventType is ProctoringEventType {
    return (knownEventTypes as readonly string[]).includes(eventType);
}

function payloadNumber(payload: ProctoringEventPayload, key: string) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compareSeverity(first: ProctoringSeverity, second: ProctoringSeverity) {
    return severityRank[first] - severityRank[second];
}

function terminationReasonForEvent(eventType: ProctoringEventType): ProctoringTerminationReason {
    if (eventType === "multi_session_attempt") return "multi_session_conflict";
    if (eventType === "webcam_revoked" || eventType === "webcam_stream_ended") return "webcam_revoked";
    return "auto_rule_violation";
}

function eventsIncludingNewEvent(recentEvents: ProctoringEventRecord[], newEvent: ProctoringEventRecord) {
    const hasNewEvent = recentEvents.some((event) => {
        if (event.id && newEvent.id) return event.id === newEvent.id;
        if (event.clientEventId && newEvent.clientEventId) return event.clientEventId === newEvent.clientEventId;
        return false;
    });
    return hasNewEvent ? recentEvents : [...recentEvents, newEvent];
}

export function classifySeverity<T extends ProctoringEventType>(
    eventType: T,
    payload: ProctoringEventPayload<T>,
    _rules: ProctoringRules
): ProctoringSeverity {
    if (!isKnownEventType(eventType)) {
        throw new Error(`Unsupported proctoring event type: ${eventType}`);
    }

    switch (eventType) {
        case "session_start":
        case "session_heartbeat":
        case "contextmenu":
        case "network_reconnect":
            return "info";
        case "face_absent": {
            const durationMs = payloadNumber(payload, "duration_ms");
            if (durationMs < 5000) return "low";
            if (durationMs < 15000) return "medium";
            return "high";
        }
        case "face_multiple":
            return "high";
        case "face_looking_away":
            return payloadNumber(payload, "duration_ms") < 3000 ? "low" : "medium";
        case "object_detected": {
            const item = payload as { label?: string; confidence?: number };
            return item.label === "cell phone" && Number(item.confidence || 0) >= 0.6 ? "high" : "medium";
        }
        case "tab_hidden":
            return payloadNumber(payload, "duration_ms") < 2000 ? "medium" : "high";
        case "window_blur":
        case "copy":
        case "cut":
        case "network_disconnect":
            return "low";
        case "fullscreen_exit":
        case "devtools_opened":
            return "high";
        case "paste":
            return payloadNumber(payload, "char_count") > 40 ? "medium" : "low";
        case "webcam_revoked":
        case "webcam_stream_ended":
        case "multi_session_attempt":
            return "critical";
        case "heartbeat_gap":
            return payloadNumber(payload, "gap_ms") < 30000 ? "medium" : "high";
        default: {
            const neverEvent: never = eventType;
            throw new Error(`Unsupported proctoring event type: ${neverEvent}`);
        }
    }
}

export function evaluate(
    _session: ProctoringSessionForEvaluation,
    newEvent: ProctoringEventRecord,
    recentEvents: ProctoringEventRecord[],
    rules: ProctoringRules
): ProctoringEvaluationResult {
    if (rules.disable_auto_termination === true) {
        return { shouldTerminate: false };
    }

    const eventType = newEvent.eventType;
    if (rules.auto_terminate_on.includes(eventType)) {
        return {
            shouldTerminate: true,
            terminationReason: terminationReasonForEvent(eventType),
        };
    }

    if (compareSeverity(newEvent.severity, rules.auto_terminate_on_severity) >= 0) {
        return {
            shouldTerminate: true,
            terminationReason: terminationReasonForEvent(eventType),
        };
    }

    const events = eventsIncludingNewEvent(recentEvents, newEvent);
    if (
        eventType === "face_absent" &&
        payloadNumber(newEvent.payload, "duration_ms") >= rules.thresholds.face_absent_terminate_ms
    ) {
        return { shouldTerminate: true, terminationReason: "auto_rule_violation" };
    }

    const faceMultipleCount = events.filter((event) => event.eventType === "face_multiple").length;
    if (faceMultipleCount >= rules.thresholds.face_multiple_terminate_count) {
        return { shouldTerminate: true, terminationReason: "auto_rule_violation" };
    }

    const tabHiddenCount = events.filter((event) => event.eventType === "tab_hidden").length;
    if (tabHiddenCount > rules.thresholds.max_tab_hidden_events) {
        return { shouldTerminate: true, terminationReason: "auto_rule_violation" };
    }

    const fullscreenExitCount = events.filter((event) => event.eventType === "fullscreen_exit").length;
    if (fullscreenExitCount > rules.thresholds.max_fullscreen_exit_events) {
        return { shouldTerminate: true, terminationReason: "auto_rule_violation" };
    }

    if (
        eventType === "paste" &&
        payloadNumber(newEvent.payload, "char_count") > rules.thresholds.max_paste_char_count_single
    ) {
        return { shouldTerminate: true, terminationReason: "auto_rule_violation" };
    }

    const pasteTotal = events
        .filter((event) => event.eventType === "paste")
        .reduce((sum, event) => sum + payloadNumber(event.payload, "char_count"), 0);
    if (pasteTotal > rules.thresholds.max_paste_total_char_count) {
        return { shouldTerminate: true, terminationReason: "auto_rule_violation" };
    }

    return { shouldTerminate: false };
}

export function computeIntegrityScore(events: ProctoringEventRecord[], rulesSnapshot: ProctoringRules) {
    const score = events.reduce((currentScore, event) => {
        if (event.severity === "info") return currentScore;
        const weight = rulesSnapshot.integrity_score_weights[event.eventType] || 0;
        const multiplier = severityMultipliers[event.severity];
        return currentScore - weight * multiplier;
    }, rulesSnapshot.integrity_score_base);

    return Math.max(score, rulesSnapshot.integrity_score_floor);
}
