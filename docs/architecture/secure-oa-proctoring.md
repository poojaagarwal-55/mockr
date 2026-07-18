# Secure OA Proctoring Foundation

This module adds the browser-only proctoring foundation for online assessments. It is intentionally separate from the existing OA setup and session flow. The later integration touchpoint is a single call from the OA start flow, `startProctoring(sessionId)`.

This PR does not build API route handlers, Socket.IO handlers, client proctoring modules, AI detection, Electron, Chrome extensions, video streaming, biometric identity, ID checks, AI cross-questioning, or frontend review UI.

## Existing Anchors

OA identity currently lives on `job_rounds`, with OA rounds represented by `round_type = 'mock_oa'`. There is no dedicated `OnlineAssessment` model in this codebase, so proctoring rows anchor to `job_round_id`.

The candidate start contract is:

```http
POST /secure-oa/sessions/:jobRoundId/start
```

The start handler must validate that:

- The authenticated candidate is in the requested job round.
- `job_rounds.round_type = 'mock_oa'`.
- The OA window is currently open.
- The candidate has no other active secure OA session.

Company-side proctoring session listing lives beside the existing company OA API prefix:

```http
GET /companies/online-assessments/:roundId/sessions
```

## Future migration to a dedicated OnlineAssessment model

Future migration to a dedicated OnlineAssessment model

If a dedicated `OnlineAssessment` model is introduced later, migrate `secure_oa_sessions.job_round_id` and `proctoring_rules.job_round_id` behind a compatibility layer before changing public route contracts.

## Data Model

### `secure_oa_sessions`

One row per candidate attempt at one OA. Created when the candidate starts a secure OA session and the OA is open.

Important columns:

- `job_round_id`: FK to `job_rounds.id`, `ON DELETE CASCADE`.
- `job_round_candidate_id`: FK to `job_round_candidates.id`, `ON DELETE CASCADE`.
- `candidate_user_id`: FK to `users.id`, `ON DELETE RESTRICT`.
- `company_id`: FK to `companies.id`, `ON DELETE CASCADE`, denormalized for RLS and fast company review queries.
- `status`: `pending | active | submitted | terminated | abandoned`.
- `terminated_reason`: `auto_rule_violation | manual_company | webcam_revoked | multi_session_conflict`.
- `integrity_score`: null until submit, 0 to 100.
- `integrity_rules_snapshot`: copied rules JSON used for scoring.

Constraints and indexes:

- Unique: `(job_round_id, job_round_candidate_id)`.
- Indexes: `(job_round_id, status)`, `(candidate_user_id, status)`, `(company_id, status, created_at)`.

RLS:

- Company can manage rows where `(auth.uid())::text = company_id`.
- Candidate can read and update rows where `(auth.uid())::text = candidate_user_id`.

### `proctoring_events`

Append-only event log. Events are never updated after insert except `processed_at` and `triggered_termination`.

Important columns:

- `session_id`: FK to `secure_oa_sessions.id`, `ON DELETE CASCADE`.
- `client_event_id`: monotonic client ID for dedupe.
- `event_type`: fixed v1 catalog only.
- `severity`: server-classified `info | low | medium | high | critical`.
- `payload`: event-specific JSON.
- `client_timestamp`: evidence only.
- `server_timestamp`: authoritative ordering timestamp.

Constraints and indexes:

- Unique: `(session_id, client_event_id)`.
- Indexes: `(session_id, server_timestamp)`, `(session_id, event_type)`, `(session_id, severity)`.

RLS:

- Company can read events where the parent session belongs to the company.
- Candidate has no direct read access.
- Inserts are server-side only through the service role.

### `proctoring_snapshots`

Periodic webcam stills uploaded to S3.

Important columns:

- `session_id`: FK to `secure_oa_sessions.id`, `ON DELETE CASCADE`.
- `s3_key`, `s3_bucket`.
- `mime_type`: `image/jpeg` for v1.
- `width`, `height`, `byte_size`.
- `taken_at`: client-reported capture time.
- `trigger`: `scheduled | event_triggered`.
- `triggering_event_id`: optional FK to `proctoring_events.id`, `ON DELETE SET NULL`.

Indexes:

- `(session_id, taken_at)`.

RLS:

- Company can read snapshots where the parent session belongs to the company.
- Candidate has no direct access.

### `proctoring_rules`

Server-side ruleset. The migration seeds one default row with `job_round_id = null`; per-OA overrides use the OA `job_round_id`.

Important columns:

- `job_round_id`: optional FK to `job_rounds.id`, `ON DELETE CASCADE`.
- `version`: increments on every update.
- `rules`: fixed JSON schema below.
- `is_active`: active ruleset flag.

Constraints and indexes:

- Unique: `(job_round_id, version)`.
- Index: `(job_round_id, is_active)`.

RLS:

- Company can read the default rules row and company-owned job round rules.
- Company can manage only rules tied to company-owned job rounds.
- Candidate has no direct access.

## Fixed Event Catalog

The server accepts only these event types in v1. Unknown `event_type` values return `400`.

| Event type | Source | Payload | Default server severity |
| --- | --- | --- | --- |
| `session_start` | client | `{}` | `info` |
| `session_heartbeat` | client | `{ ts: number }` | `info` |
| `face_absent` | client | `{ duration_ms: number }` | `low` if `<5000`, `medium` if `<15000`, `high` otherwise |
| `face_multiple` | client | `{ count: number, duration_ms: number }` | `high` |
| `face_looking_away` | client | `{ direction: 'left' \| 'right' \| 'down' \| 'up', duration_ms: number }` | `low` if `<3000`, `medium` otherwise |
| `object_detected` | client | `{ label: 'cell phone' \| 'book' \| 'laptop' \| 'tv', confidence: number }` | `high` if cell phone and confidence `>= 0.6`, `medium` otherwise |
| `tab_hidden` | client | `{ duration_ms: number }` | `medium` if `<2000`, `high` otherwise |
| `window_blur` | client | `{ duration_ms: number }` | `low` |
| `fullscreen_exit` | client | `{}` | `high` |
| `devtools_opened` | client | `{ detection_method: string }` | `high` |
| `copy` | client | `{ char_count: number }` | `low` |
| `paste` | client | `{ char_count: number }` | `medium` if `>40`, `low` otherwise |
| `cut` | client | `{ char_count: number }` | `low` |
| `contextmenu` | client | `{}` | `info` |
| `webcam_revoked` | client | `{}` | `critical` |
| `webcam_stream_ended` | client | `{}` | `critical` |
| `heartbeat_gap` | server | `{ gap_ms: number }` | `medium` if `<30000`, `high` otherwise |
| `multi_session_attempt` | server | `{ attempted_from_ip: string }` | `critical` |
| `network_disconnect` | server | `{}` | `low` |
| `network_reconnect` | server | `{ offline_ms: number }` | `info` |

The client may send `client_severity_hint`, but the server logs it only inside `payload` and ignores it for classification.

The REST and socket ingest paths must reject client-submitted server-only events: `heartbeat_gap`, `multi_session_attempt`, `network_disconnect`, and `network_reconnect`. The rules module exports `SERVER_ONLY_PROCTORING_EVENT_TYPES` for this check.

## Default Ruleset

```json
{
  "thresholds": {
    "face_absent_terminate_ms": 30000,
    "face_multiple_terminate_count": 2,
    "max_tab_hidden_events": 3,
    "max_fullscreen_exit_events": 2,
    "max_paste_char_count_single": 200,
    "max_paste_total_char_count": 500,
    "heartbeat_interval_ms": 5000,
    "heartbeat_grace_ms": 15000,
    "snapshot_interval_ms": 30000
  },
  "auto_terminate_on": [
    "webcam_revoked",
    "webcam_stream_ended",
    "multi_session_attempt"
  ],
  "auto_terminate_on_severity": "critical",
  "integrity_score_weights": {
    "face_absent": 10,
    "face_multiple": 25,
    "face_looking_away": 3,
    "object_detected": 20,
    "tab_hidden": 8,
    "window_blur": 2,
    "fullscreen_exit": 15,
    "devtools_opened": 30,
    "paste": 5,
    "heartbeat_gap": 5
  },
  "integrity_score_base": 100,
  "integrity_score_floor": 0
}
```

## Integrity Score

The score is deterministic and computed exactly once on submission. The result is stored on `secure_oa_sessions.integrity_score`, and the rules used are copied to `integrity_rules_snapshot`.

```text
score = integrity_score_base
for each event in proctoring_events where session_id = X and severity != 'info':
  weight = integrity_rules_snapshot.integrity_score_weights[event.event_type] or 0
  multiplier = { info: 0, low: 0.5, medium: 1, high: 2, critical: 4 }[event.severity]
  score = score - (weight * multiplier)
score = max(score, integrity_score_floor)
```

No AI output or randomness can affect `integrity_score`. AI summaries, if introduced later, must write to a different field.

## Candidate API Contracts

All candidate routes require candidate JWT authentication through middleware. The route handler must derive the candidate user ID from the verified token, never from the request body.

### Start Session

```http
POST /secure-oa/sessions/:jobRoundId/start
Content-Type: application/json

{
  "client_fingerprint": "sha256-ua-screen-timezone",
  "user_agent": "Mozilla/5.0 ..."
}
```

Validation:

- The OA job round exists and `round_type = 'mock_oa'`.
- The OA window is currently open.
- The candidate is in this job round.
- No other secure OA session for this candidate is active.
- A duplicate start for the same `(job_round_id, job_round_candidate_id)` returns the existing row.

Success:

```json
{
  "sessionId": "9d34db2e-6824-43fd-9da4-98f3f7923d55",
  "rulesPublic": {
    "heartbeat_interval_ms": 5000,
    "snapshot_interval_ms": 30000
  }
}
```

Multi-session conflict:

```json
{
  "code": "multi_session_attempt",
  "message": "Another secure OA session is already active."
}
```

When this happens, the existing active session receives a server-side `multi_session_attempt` event and auto-terminates per rules.

### Submit Events Fallback

```http
POST /secure-oa/sessions/:id/events
Content-Type: application/json

{
  "events": [
    {
      "client_event_id": "session-123-42",
      "event_type": "tab_hidden",
      "payload": { "duration_ms": 3200 },
      "client_timestamp": "2026-05-29T07:20:35.112Z"
    }
  ]
}
```

Rules:

- Batch size is at most 50.
- Validate every event with Zod before DB writes.
- Deduplicate on `(session_id, client_event_id)`.
- Classify severity server-side.
- Persist accepted events.
- Run rule evaluation after inserts.

Response:

```json
{
  "accepted": ["session-123-42"],
  "rejected": [],
  "session_status": "active",
  "terminated": false
}
```

Partial rejection:

```json
{
  "accepted": ["session-123-42"],
  "rejected": [
    { "client_event_id": "session-123-43", "reason": "unsupported_event_type" }
  ],
  "session_status": "active",
  "terminated": false
}
```

### Upload Snapshot

```http
POST /secure-oa/sessions/:id/snapshots
Content-Type: multipart/form-data

image=<jpeg bytes>
taken_at=2026-05-29T07:20:40.000Z
trigger=event_triggered
triggering_client_event_id=session-123-42
```

Rules:

- JPEG only.
- Enforce max 200 KB server-side.
- Upload to S3 key `proctoring/{session_id}/{snapshot_id}.jpg`.
- If `triggering_client_event_id` is provided, resolve it to `triggering_event_id`.

Response:

```json
{
  "snapshotId": "7d74cf34-f0ed-43c2-92f7-fc0cf672d857"
}
```

### Submit Session

```http
POST /secure-oa/sessions/:id/submit
```

Rules:

- Status must be `active`.
- Load the active ruleset.
- Compute integrity score once.
- Store `submitted_at`, `status = 'submitted'`, `integrity_score`, and `integrity_rules_snapshot`.
- Do not return the integrity score to the candidate.

Response:

```json
{
  "status": "submitted"
}
```

## Socket.IO Contract

Namespace:

```text
/secure-oa
```

Room:

```text
session:{sessionId}
```

Connection authorization:

- Verify candidate JWT during handshake.
- Verify the session belongs to that candidate.
- Verify session status is `active` or `pending`.
- Refuse the connection otherwise.

Client emits:

```text
proctoring:event
```

Payload:

```json
{
  "client_event_id": "session-123-45",
  "event_type": "window_blur",
  "payload": { "duration_ms": 900 },
  "client_timestamp": "2026-05-29T07:21:00.000Z"
}
```

Server emits:

```json
{
  "event": "proctoring:ack",
  "data": { "client_event_id": "session-123-45", "accepted": true }
}
```

```json
{
  "event": "proctoring:terminate",
  "data": { "reason": "auto_rule_violation" }
}
```

```json
{
  "event": "proctoring:heartbeat_required",
  "data": { "ts": 1779990000000 }
}
```

Reconnection uses REST `/events` to replay queued events atomically. The socket is only for low-latency forward flow.

## Company API Contracts

All company routes require company member authentication and workspace authorization middleware.

### List OA Sessions

```http
GET /companies/online-assessments/:roundId/sessions?status=submitted
```

Returns all secure OA sessions for the OA job round the company owns. `status` is optional.

Response:

```json
{
  "sessions": [
    {
      "id": "9d34db2e-6824-43fd-9da4-98f3f7923d55",
      "jobRoundId": "round-1",
      "candidate": {
        "id": "user-1",
        "fullName": "Piyush Agarwal",
        "email": "masked@example.com"
      },
      "status": "submitted",
      "startedAt": "2026-05-29T07:10:00.000Z",
      "submittedAt": "2026-05-29T08:40:00.000Z",
      "integrityScore": 86
    }
  ]
}
```

### Session Detail

```http
GET /companies/secure-oa/sessions/:id
```

Returns candidate info, status, integrity score, event aggregations by `event_type` and `severity`, and the rules snapshot. It does not return raw events.

Response:

```json
{
  "session": {
    "id": "9d34db2e-6824-43fd-9da4-98f3f7923d55",
    "status": "submitted",
    "integrityScore": 86,
    "candidate": {
      "id": "user-1",
      "fullName": "Piyush Agarwal",
      "email": "masked@example.com"
    },
    "eventCountsByType": {
      "tab_hidden": 2,
      "paste": 1
    },
    "eventCountsBySeverity": {
      "low": 1,
      "medium": 1,
      "high": 2
    },
    "rulesSnapshot": {
      "thresholds": {
        "heartbeat_interval_ms": 5000
      }
    }
  }
}
```

### Session Events

```http
GET /companies/secure-oa/sessions/:id/events?cursor=2026-05-29T07:10:00.000Z
```

Returns raw event log ordered by `server_timestamp asc`. Page size is 100.

Response:

```json
{
  "events": [
    {
      "id": "event-1",
      "clientEventId": "session-123-42",
      "eventType": "tab_hidden",
      "severity": "high",
      "payload": { "duration_ms": 3200 },
      "clientTimestamp": "2026-05-29T07:20:35.112Z",
      "serverTimestamp": "2026-05-29T07:20:35.700Z",
      "triggeredTermination": false
    }
  ],
  "nextCursor": null
}
```

### Session Snapshots

```http
GET /companies/secure-oa/sessions/:id/snapshots?cursor=2026-05-29T07:10:00.000Z
```

Returns paginated snapshots with S3 presigned URLs valid for 5 minutes.

Response:

```json
{
  "snapshots": [
    {
      "id": "snapshot-1",
      "url": "https://signed-url.example",
      "takenAt": "2026-05-29T07:20:40.000Z",
      "trigger": "event_triggered",
      "triggeringEventId": "event-1"
    }
  ],
  "nextCursor": null
}
```

### Manual Termination

```http
POST /companies/secure-oa/sessions/:id/terminate
Content-Type: application/json

{
  "reason": "Candidate confirmed external help."
}
```

Rules:

- Requires company ownership of the session.
- Requires a non-empty reason for audit logs.
- Sets `status = 'terminated'`, `terminated_reason = 'manual_company'`, and `terminated_at = now`.

Response:

```json
{
  "status": "terminated",
  "terminatedReason": "manual_company"
}
```

## Rule Evaluation

After every event insert, the server calls:

```ts
evaluate(session, newEvent, recentEvents, rules)
```

It returns:

```ts
{
  shouldTerminate: boolean;
  terminationReason?: "auto_rule_violation" | "manual_company" | "webcam_revoked" | "multi_session_conflict";
}
```

Termination triggers:

- `newEvent.event_type` is in `rules.auto_terminate_on`.
- `newEvent.severity === rules.auto_terminate_on_severity`.
- Aggregate thresholds are breached:
  - `face_absent.duration_ms >= face_absent_terminate_ms`.
  - `face_multiple` count reaches `face_multiple_terminate_count`.
  - `tab_hidden` count exceeds `max_tab_hidden_events`.
  - `fullscreen_exit` count exceeds `max_fullscreen_exit_events`.
  - A single paste exceeds `max_paste_char_count_single`.
  - Total paste characters exceed `max_paste_total_char_count`.

On termination:

- Update session status to `terminated`.
- Set `terminated_at` and `terminated_reason`.
- Emit socket `proctoring:terminate`.
- Mark the triggering event with `triggered_termination = true`.
- Do not compute integrity score. Terminated sessions keep `integrity_score = null`.

## Heartbeat Watchdog

Use the existing in-process background-job pattern from API startup for v1. A single `setInterval(...).unref()` can run every 10 seconds until a formal job runner exists.

The watchdog:

- Tracks last heartbeat in memory per active session.
- Derives last heartbeat from `MAX(server_timestamp)` where `event_type = 'session_heartbeat'` when cache is cold.
- Inserts server-side `heartbeat_gap` when `now - last_heartbeat > heartbeat_grace_ms`.
- Marks the session `abandoned` when `now - last_event > 5 * heartbeat_grace_ms`.
- Separately marks active sessions `abandoned` when the OA `closes_at` has passed and no submit arrived.

`abandoned` is not `terminated`. Product can decide later how to surface it.

## Client Module Boundaries

These modules are specified for the next PR only. Each module must be independently testable.

### `CameraWorker`

Owns webcam `MediaStream`, MediaPipe, and coco-ssd.

```ts
type CameraWorker = {
  start(sessionId: string): Promise<void>;
  stop(): Promise<void>;
  onFinding(listener: (event: ProctoringEventInput) => void): () => void;
  getStream(): MediaStream | null;
};
```

### `FocusWatcher`

Owns `visibilitychange`, `blur`, `fullscreenchange`, and devtools heuristics.

```ts
type FocusWatcher = {
  start(): void;
  stop(): void;
  onEvent(listener: (event: ProctoringEventInput) => void): () => void;
};
```

### `InputWatcher`

Owns copy, paste, cut, and contextmenu listeners scoped to the OA editor area.

```ts
type InputWatcher = {
  attach(root: HTMLElement): void;
  detach(): void;
  onEvent(listener: (event: ProctoringEventInput) => void): () => void;
};
```

### `EventQueue`

In-memory plus IndexedDB-backed FIFO. `client_event_id` is monotonic and generated as `${sessionId}-${counter}`.

```ts
type EventQueue = {
  enqueue(input: Omit<ProctoringEventInput, "client_event_id">): Promise<ProctoringEventInput>;
  peek(limit: number): Promise<ProctoringEventInput[]>;
  markAccepted(clientEventIds: string[]): Promise<void>;
  markRejected(clientEventIds: string[]): Promise<void>;
  size(): Promise<number>;
};
```

### `Transport`

Owns socket forward flow and REST fallback.

```ts
type Transport = {
  connect(sessionId: string, jwt: string): Promise<void>;
  disconnect(): void;
  sendEvent(event: ProctoringEventInput): Promise<void>;
  flush(events: ProctoringEventInput[]): Promise<{
    accepted: string[];
    rejected: { client_event_id: string; reason: string }[];
    session_status: string;
    terminated: boolean;
  }>;
  onTerminate(listener: (reason: string) => void): () => void;
};
```

### `SnapshotUploader`

Captures JPEGs at `snapshot_interval_ms` and on `event_triggered` triggers.

```ts
type SnapshotUploader = {
  start(sessionId: string, stream: MediaStream, intervalMs: number): void;
  stop(): void;
  uploadNow(trigger: "scheduled" | "event_triggered", triggeringClientEventId?: string): Promise<string>;
};
```

## Edge Cases

### Webcam permission denied at start

Emit `webcam_revoked`. The session moves to `terminated` immediately. Candidate sees a permission-required screen.

### Webcam revoked mid-session

Use the same path as permission denied: `webcam_revoked`, critical severity, auto-termination.

### Network drop

Events queue in IndexedDB. On reconnect, the client drains through REST `/events`. Dedupe on `client_event_id` makes replay safe.

### Multiple tabs of same session

Second start call returns `409` with `code = 'multi_session_attempt'`. The original session receives a server-side `multi_session_attempt` event with critical severity and auto-terminates.

### Clock skew

`server_timestamp` is always authoritative for ordering and rule evaluation. `client_timestamp` is evidence only.

### Camera covered or pointed away

This is `face_absent`. V1 does not distinguish covered camera from no face detected because both appear the same to MediaPipe.

### Browser crash

The session remains active with no events. The heartbeat watchdog inserts `heartbeat_gap` events. If `now - last_event > 5 * heartbeat_grace_ms`, mark the session `abandoned`.

### OA closes while session is active

A background interval transitions active sessions whose `job_rounds.closes_at` has passed to `abandoned` if no submit arrived.

### Re-attempt

Out of scope. Unique `(job_round_id, job_round_candidate_id)` prevents it. If product wants re-attempts later, add `attempt_number` and include it in the uniqueness constraint.
