import type { ProctoringRules } from "@interviewforge/shared";

export const AI_SCREENING_PROCTORING_RULES: ProctoringRules = {
    disable_auto_termination: true,
    thresholds: {
        face_absent_terminate_ms: Number.MAX_SAFE_INTEGER,
        face_multiple_terminate_count: Number.MAX_SAFE_INTEGER,
        max_tab_hidden_events: Number.MAX_SAFE_INTEGER,
        max_fullscreen_exit_events: Number.MAX_SAFE_INTEGER,
        max_paste_char_count_single: Number.MAX_SAFE_INTEGER,
        max_paste_total_char_count: Number.MAX_SAFE_INTEGER,
        heartbeat_interval_ms: 5000,
        heartbeat_grace_ms: 15000,
        snapshot_interval_ms: 30000,
    },
    auto_terminate_on: [],
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
