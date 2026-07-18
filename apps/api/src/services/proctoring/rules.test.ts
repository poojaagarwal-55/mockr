const {
    SERVER_ONLY_PROCTORING_EVENT_TYPES,
    classifySeverity,
    computeIntegrityScore,
    evaluate,
} = require("./rules.js");

const rules = {
    thresholds: {
        face_absent_terminate_ms: 30000,
        face_multiple_terminate_count: 2,
        max_tab_hidden_events: 3,
        max_fullscreen_exit_events: 2,
        max_paste_char_count_single: 200,
        max_paste_total_char_count: 500,
        heartbeat_interval_ms: 5000,
        heartbeat_grace_ms: 15000,
        snapshot_interval_ms: 30000,
    },
    auto_terminate_on: [
        "webcam_revoked",
        "webcam_stream_ended",
        "multi_session_attempt",
    ],
    auto_terminate_on_severity: "critical",
    integrity_score_weights: {
        face_absent: 10,
        face_multiple: 25,
        face_looking_away: 3,
        object_detected: 20,
        tab_hidden: 8,
        window_blur: 2,
        fullscreen_exit: 15,
        devtools_opened: 30,
        paste: 5,
        heartbeat_gap: 5,
    },
    integrity_score_base: 100,
    integrity_score_floor: 0,
};

function makeEvent(eventType, severity, payload = {}, overrides = {}) {
    return {
        id: `${eventType}-${Math.random().toString(36).slice(2)}`,
        eventType,
        severity,
        payload,
        serverTimestamp: new Date().toISOString(),
        ...overrides,
    };
}

describe("proctoring rules", () => {
    test("exports the server-only events that client ingest must reject", () => {
        expect(SERVER_ONLY_PROCTORING_EVENT_TYPES).toEqual([
            "heartbeat_gap",
            "multi_session_attempt",
            "network_disconnect",
            "network_reconnect",
        ]);
    });

    describe("classifySeverity", () => {
        test.each([
            ["session_start", {}, "info"],
            ["session_heartbeat", { ts: 1779990000000 }, "info"],
            ["face_absent", { duration_ms: 4000 }, "low"],
            ["face_multiple", { count: 2, duration_ms: 3000 }, "high"],
            ["face_looking_away", { direction: "left", duration_ms: 2000 }, "low"],
            ["object_detected", { label: "cell phone", confidence: 0.7 }, "high"],
            ["tab_hidden", { duration_ms: 1000 }, "medium"],
            ["window_blur", { duration_ms: 800 }, "low"],
            ["fullscreen_exit", {}, "high"],
            ["devtools_opened", { detection_method: "viewport" }, "high"],
            ["copy", { char_count: 12 }, "low"],
            ["paste", { char_count: 41 }, "medium"],
            ["cut", { char_count: 8 }, "low"],
            ["contextmenu", {}, "info"],
            ["webcam_revoked", {}, "critical"],
            ["webcam_stream_ended", {}, "critical"],
            ["heartbeat_gap", { gap_ms: 29000 }, "medium"],
            ["multi_session_attempt", { attempted_from_ip: "203.0.113.9" }, "critical"],
            ["network_disconnect", {}, "low"],
            ["network_reconnect", { offline_ms: 1200 }, "info"],
        ])("classifies %s as %s", (eventType, payload, expectedSeverity) => {
            expect(classifySeverity(eventType, payload, rules)).toBe(expectedSeverity);
        });

        test("classifies threshold edges without trusting client hints", () => {
            expect(classifySeverity("face_absent", { duration_ms: 5000, client_severity_hint: "critical" }, rules)).toBe("medium");
            expect(classifySeverity("face_absent", { duration_ms: 15000 }, rules)).toBe("high");
            expect(classifySeverity("face_looking_away", { direction: "down", duration_ms: 3000 }, rules)).toBe("medium");
            expect(classifySeverity("object_detected", { label: "book", confidence: 0.99 }, rules)).toBe("medium");
            expect(classifySeverity("tab_hidden", { duration_ms: 2000 }, rules)).toBe("high");
            expect(classifySeverity("paste", { char_count: 40 }, rules)).toBe("low");
            expect(classifySeverity("heartbeat_gap", { gap_ms: 30000 }, rules)).toBe("high");
        });

        test("rejects unknown event types", () => {
            expect(() => classifySeverity("screen_shared", {}, rules)).toThrow("Unsupported proctoring event type");
        });
    });

    describe("evaluate", () => {
        const session = { id: "session-1", status: "active" };

        test("terminates for explicit auto-terminate events", () => {
            const result = evaluate(session, makeEvent("webcam_revoked", "critical"), [], rules);
            expect(result).toEqual({ shouldTerminate: true, terminationReason: "webcam_revoked" });
        });

        test("terminates for critical severity", () => {
            const result = evaluate(session, makeEvent("multi_session_attempt", "critical", { attempted_from_ip: "203.0.113.10" }), [], rules);
            expect(result).toEqual({ shouldTerminate: true, terminationReason: "multi_session_conflict" });
        });

        test("terminates when a face-absent event reaches the duration threshold", () => {
            const result = evaluate(session, makeEvent("face_absent", "high", { duration_ms: 30000 }), [], rules);
            expect(result).toEqual({ shouldTerminate: true, terminationReason: "auto_rule_violation" });
        });

        test("terminates when multiple-face events reach the count threshold", () => {
            const previous = [makeEvent("face_multiple", "high", { count: 2, duration_ms: 1000 })];
            const result = evaluate(session, makeEvent("face_multiple", "high", { count: 2, duration_ms: 1000 }), previous, rules);
            expect(result).toEqual({ shouldTerminate: true, terminationReason: "auto_rule_violation" });
        });

        test("terminates when tab-hidden count exceeds the threshold", () => {
            const previous = Array.from({ length: rules.thresholds.max_tab_hidden_events }, (_, index) =>
                makeEvent("tab_hidden", "medium", { duration_ms: 1000 }, { id: `tab-hidden-${index}` })
            );
            const result = evaluate(session, makeEvent("tab_hidden", "high", { duration_ms: 3000 }), previous, rules);
            expect(result).toEqual({ shouldTerminate: true, terminationReason: "auto_rule_violation" });
        });

        test("terminates when fullscreen exits exceed the threshold", () => {
            const previous = Array.from({ length: rules.thresholds.max_fullscreen_exit_events }, (_, index) =>
                makeEvent("fullscreen_exit", "high", {}, { id: `fullscreen-${index}` })
            );
            const result = evaluate(session, makeEvent("fullscreen_exit", "high", {}), previous, rules);
            expect(result).toEqual({ shouldTerminate: true, terminationReason: "auto_rule_violation" });
        });

        test("terminates when a single paste exceeds the character threshold", () => {
            const result = evaluate(session, makeEvent("paste", "medium", { char_count: 201 }), [], rules);
            expect(result).toEqual({ shouldTerminate: true, terminationReason: "auto_rule_violation" });
        });

        test("terminates when cumulative paste characters exceed the threshold", () => {
            const previous = [
                makeEvent("paste", "medium", { char_count: 250 }, { id: "paste-1" }),
                makeEvent("paste", "medium", { char_count: 250 }, { id: "paste-2" }),
            ];
            const result = evaluate(session, makeEvent("paste", "medium", { char_count: 1 }), previous, rules);
            expect(result).toEqual({ shouldTerminate: true, terminationReason: "auto_rule_violation" });
        });

        test("does not terminate when no rule is breached", () => {
            const result = evaluate(session, makeEvent("window_blur", "low", { duration_ms: 1000 }), [], rules);
            expect(result).toEqual({ shouldTerminate: false });
        });
    });

    describe("computeIntegrityScore", () => {
        test("computes a deterministic score from non-info events", () => {
            const events = [
                makeEvent("session_start", "info", {}),
                makeEvent("face_absent", "medium", { duration_ms: 6000 }),
                makeEvent("tab_hidden", "high", { duration_ms: 2500 }),
                makeEvent("paste", "low", { char_count: 10 }),
                makeEvent("network_reconnect", "info", { offline_ms: 2000 }),
            ];

            expect(computeIntegrityScore(events, rules)).toBe(71.5);
            expect(computeIntegrityScore(events, rules)).toBe(71.5);
        });

        test("applies the configured score floor", () => {
            const events = Array.from({ length: 10 }, (_, index) =>
                makeEvent("devtools_opened", "high", { detection_method: "viewport" }, { id: `devtools-${index}` })
            );

            expect(computeIntegrityScore(events, rules)).toBe(0);
        });
    });
});
