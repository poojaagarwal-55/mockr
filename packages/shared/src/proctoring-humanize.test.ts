import type { ProctoringEventRecord, ProctoringEventType } from "./types/proctoring-events";

const { humanizeProctoringEvent } = require("./proctoring-humanize.ts") as typeof import("./proctoring-humanize");

function event(eventType: ProctoringEventType, payload: Record<string, unknown> = {}) {
  return { eventType, payload } as ProctoringEventRecord;
}

describe("humanizeProctoringEvent", () => {
  test.each([
    ["session_start", {}, "Session started"],
    ["session_heartbeat", { ts: 1 }, "Heartbeat received"],
    ["face_absent", { duration_ms: 12000 }, "Face not visible"],
    ["face_multiple", { count: 2, duration_ms: 8000 }, "Multiple faces detected"],
    ["face_looking_away", { direction: "left", duration_ms: 4000 }, "Looking away from screen"],
    ["object_detected", { label: "cell phone", confidence: 0.87 }, "Phone detected"],
    ["tab_hidden", { duration_ms: 4200 }, "Switched tabs"],
    ["window_blur", { duration_ms: 900 }, "Window lost focus"],
    ["fullscreen_exit", {}, "Exited fullscreen"],
    ["devtools_opened", { detection_method: "viewport_delta" }, "Developer tools opened"],
    ["copy", { char_count: 12 }, "Copied content"],
    ["paste", { char_count: 320 }, "Pasted content"],
    ["cut", { char_count: 8 }, "Cut content"],
    ["contextmenu", {}, "Context menu opened"],
    ["webcam_revoked", {}, "Camera disabled"],
    ["webcam_stream_ended", {}, "Camera stream ended"],
    ["heartbeat_gap", { gap_ms: 20000 }, "Heartbeat gap"],
    ["multi_session_attempt", { attempted_from_ip: "127.0.0.1" }, "Multiple session attempt"],
    ["network_disconnect", {}, "Network disconnected"],
    ["network_reconnect", { offline_ms: 6000 }, "Network reconnected"],
  ] as Array<[ProctoringEventType, Record<string, unknown>, string]>)(
    "humanizes %s",
    (eventType, payload, title) => {
      expect(humanizeProctoringEvent(event(eventType, payload)).title).toBe(title);
    }
  );
});
