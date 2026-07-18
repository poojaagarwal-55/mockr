export const PROCTORING_EVENT_TYPES = [
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
] as const;

export type ProctoringEventType = typeof PROCTORING_EVENT_TYPES[number];

export const PROCTORING_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

export type ProctoringSeverity = typeof PROCTORING_SEVERITIES[number];

export type ProctoringTerminationReason =
  | "auto_rule_violation"
  | "manual_company"
  | "webcam_revoked"
  | "multi_session_conflict";

export type ProctoringSessionStatus =
  | "pending"
  | "active"
  | "submitted"
  | "terminated"
  | "abandoned";

export type ProctoringSnapshotTrigger = "scheduled" | "event_triggered";

export type ProctoringEventPayloadMap = {
  session_start: Record<string, never>;
  session_heartbeat: { ts: number };
  face_absent: { duration_ms: number };
  face_multiple: { count: number; duration_ms: number };
  face_looking_away: { direction: "left" | "right" | "down" | "up"; duration_ms: number };
  object_detected: { label: "object" | "cell phone" | "book" | "laptop" | "tv"; confidence: number };
  tab_hidden: { duration_ms: number };
  window_blur: { duration_ms: number };
  fullscreen_exit: Record<string, never>;
  devtools_opened: { detection_method: string };
  copy: { char_count: number };
  paste: { char_count: number };
  cut: { char_count: number };
  contextmenu: Record<string, never>;
  webcam_revoked: Record<string, never>;
  webcam_stream_ended: Record<string, never>;
  heartbeat_gap: { gap_ms: number };
  multi_session_attempt: { attempted_from_ip: string };
  network_disconnect: Record<string, never>;
  network_reconnect: { offline_ms: number };
};

export type ProctoringEventPayload<T extends ProctoringEventType = ProctoringEventType> =
  ProctoringEventPayloadMap[T];

export type ProctoringEventInput = {
  [T in ProctoringEventType]: {
    client_event_id: string;
    event_type: T;
    payload: ProctoringEventPayloadMap[T] & {
      client_severity_hint?: ProctoringSeverity;
    };
    client_timestamp: string;
  };
}[ProctoringEventType];

export type ProctoringEventRecord = {
  id?: string;
  clientEventId?: string;
  eventType: ProctoringEventType;
  severity: ProctoringSeverity;
  payload: ProctoringEventPayload;
  clientTimestamp?: Date | string;
  serverTimestamp?: Date | string;
  processedAt?: Date | string | null;
  triggeredTermination?: boolean;
};

export type ProctoringRules = {
  disable_auto_termination?: boolean;
  thresholds: {
    face_absent_terminate_ms: number;
    face_multiple_terminate_count: number;
    max_tab_hidden_events: number;
    max_fullscreen_exit_events: number;
    max_paste_char_count_single: number;
    max_paste_total_char_count: number;
    heartbeat_interval_ms: number;
    heartbeat_grace_ms: number;
    snapshot_interval_ms: number;
  };
  auto_terminate_on: ProctoringEventType[];
  auto_terminate_on_severity: ProctoringSeverity;
  integrity_score_weights: Partial<Record<ProctoringEventType, number>>;
  integrity_score_base: number;
  integrity_score_floor: number;
};

export const DEFAULT_PROCTORING_RULES: ProctoringRules = {
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
