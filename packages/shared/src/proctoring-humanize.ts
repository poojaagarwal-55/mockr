import type { ProctoringEventRecord, ProctoringEventType } from "./types/proctoring-events.js";

type HumanizedProctoringEvent = {
  title: string;
  detail?: string;
};

function seconds(ms: unknown): string {
  const value = typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
  const rounded = Math.max(0, Math.round(value / 1000));
  return `${rounded} second${rounded === 1 ? "" : "s"}`;
}

function percent(value: unknown): string {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `${Math.round(Math.max(0, Math.min(1, number)) * 100)}% confidence`;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function humanizeProctoringEvent(event: Pick<ProctoringEventRecord, "eventType" | "payload">): HumanizedProctoringEvent {
  const payload = event.payload as Record<string, unknown>;

  switch (event.eventType as ProctoringEventType) {
    case "session_start":
      return { title: "Session started" };
    case "session_heartbeat":
      return { title: "Heartbeat received" };
    case "face_absent":
      return { title: "Face not visible", detail: seconds(payload.duration_ms) };
    case "face_multiple":
      return {
        title: "Multiple faces detected",
        detail: `${numberValue(payload.count)} people in frame for ${seconds(payload.duration_ms)}`,
      };
    case "face_looking_away":
      return {
        title: "Looking away from screen",
        detail: `${String(payload.direction || "away")} for ${seconds(payload.duration_ms)}`,
      };
    case "object_detected":
      return {
        title: payload.label === "cell phone"
          ? "Phone detected"
          : payload.label === "object"
            ? "Object detected"
            : `${String(payload.label || "Object")} detected`,
        detail: percent(payload.confidence),
      };
    case "tab_hidden":
      return { title: "Switched tabs", detail: `Away for ${seconds(payload.duration_ms)}` };
    case "window_blur":
      return { title: "Window lost focus", detail: seconds(payload.duration_ms) };
    case "fullscreen_exit":
      return { title: "Exited fullscreen" };
    case "devtools_opened":
      return { title: "Developer tools opened", detail: String(payload.detection_method || "Detected by browser signal") };
    case "copy":
      return { title: "Copied content", detail: `${numberValue(payload.char_count)} characters` };
    case "paste":
      return { title: "Pasted content", detail: `${numberValue(payload.char_count)} characters` };
    case "cut":
      return { title: "Cut content", detail: `${numberValue(payload.char_count)} characters` };
    case "contextmenu":
      return { title: "Context menu opened" };
    case "webcam_revoked":
      return { title: "Camera disabled" };
    case "webcam_stream_ended":
      return { title: "Camera stream ended" };
    case "heartbeat_gap":
      return { title: "Heartbeat gap", detail: seconds(payload.gap_ms) };
    case "multi_session_attempt":
      return { title: "Multiple session attempt", detail: String(payload.attempted_from_ip || "Another tab or device") };
    case "network_disconnect":
      return { title: "Network disconnected" };
    case "network_reconnect":
      return { title: "Network reconnected", detail: `Offline for ${seconds(payload.offline_ms)}` };
    default:
      return { title: "Proctoring event" };
  }
}
