"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserProctoringClient } from "@/lib/proctoring/client";
import type { ProctoringClientStatus, ProctoringDebugEvent } from "@/lib/proctoring/types";

type LogEntry = ProctoringDebugEvent & {
    at: string;
};

const STATUS_RANK: Record<LogEntry["status"], number> = {
    queued: 0,
    accepted: 1,
    rejected: 1,
};

export default function ProctoringHarnessPage() {
    const [sessionId, setSessionId] = useState("");
    const [jwt, setJwt] = useState("");
    const [heartbeatMs, setHeartbeatMs] = useState(5000);
    const [snapshotMs, setSnapshotMs] = useState(30000);
    const [status, setStatus] = useState<ProctoringClientStatus>("idle");
    const [queueSize, setQueueSize] = useState(0);
    const [events, setEvents] = useState<LogEntry[]>([]);
    const editorRef = useRef<HTMLTextAreaElement | null>(null);
    const clientRef = useRef<BrowserProctoringClient | null>(null);

    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;

        const client = new BrowserProctoringClient({
            onDebugEvent: (event) => {
                setEvents((current) => upsertLogEntry(current, event));
            },
            onQueueSizeChange: setQueueSize,
        });
        client.onStatusChange(setStatus);
        client.onTerminate((reason) => {
            setEvents((current) => [
                {
                    at: new Date().toLocaleTimeString(),
                    status: "rejected",
                    reason,
                    event: {
                        client_event_id: "server-terminate",
                        event_type: "webcam_revoked",
                        payload: {},
                        client_timestamp: new Date().toISOString(),
                    },
                },
                ...current,
            ]);
        });
        clientRef.current = client;

        return () => {
            void client.stop();
            clientRef.current = null;
        };
    }, []);

    if (process.env.NODE_ENV === "production") {
        return null;
    }

    async function start() {
        if (!sessionId.trim() || !jwt.trim() || !editorRef.current || !clientRef.current) return;
        await clientRef.current.start({
            sessionId: sessionId.trim(),
            jwt: jwt.trim(),
            rulesPublic: {
                heartbeat_interval_ms: heartbeatMs,
                snapshot_interval_ms: snapshotMs,
            },
            editorRoot: editorRef.current,
        });
    }

    async function stop() {
        await clientRef.current?.stop();
    }

    return (
        <main className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100">
            <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[380px_1fr]">
                <section className="space-y-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">Secure OA</p>
                        <h1 className="mt-2 text-2xl font-extrabold">Proctoring Harness</h1>
                    </div>

                    <label className="block text-sm font-bold">
                        Session ID
                        <input
                            value={sessionId}
                            onChange={(event) => setSessionId(event.target.value)}
                            className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm outline-none focus:border-blue-400"
                            placeholder="secure_oa_session id"
                        />
                    </label>

                    <label className="block text-sm font-bold">
                        JWT
                        <textarea
                            value={jwt}
                            onChange={(event) => setJwt(event.target.value)}
                            className="mt-2 h-28 w-full resize-none rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs outline-none focus:border-blue-400"
                            placeholder="Supabase access token. Bearer prefix is okay."
                        />
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                        <label className="block text-sm font-bold">
                            Heartbeat ms
                            <input
                                type="number"
                                min={1000}
                                value={heartbeatMs}
                                onChange={(event) => setHeartbeatMs(Number(event.target.value) || 5000)}
                                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm outline-none focus:border-blue-400"
                            />
                        </label>
                        <label className="block text-sm font-bold">
                            Snapshot ms
                            <input
                                type="number"
                                min={5000}
                                value={snapshotMs}
                                onChange={(event) => setSnapshotMs(Number(event.target.value) || 30000)}
                                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-sm outline-none focus:border-blue-400"
                            />
                        </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={start}
                            disabled={status === "starting" || status === "running"}
                            className="h-11 rounded-full bg-blue-500 px-4 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Start
                        </button>
                        <button
                            type="button"
                            onClick={stop}
                            disabled={status !== "running" && status !== "starting"}
                            className="h-11 rounded-full border border-white/15 px-4 text-sm font-extrabold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Stop
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            setEvents([]);
                            setQueueSize(0);
                            indexedDB.deleteDatabase("practers-proctoring-events");
                        }}
                        className="h-10 w-full rounded-full border border-amber-300/30 bg-amber-300/10 px-4 text-xs font-extrabold text-amber-100"
                    >
                        Clear local harness queue
                    </button>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-lg border border-white/10 bg-slate-900 p-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Status</p>
                            <p className="mt-1 font-bold">{status}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-slate-900 p-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Queue</p>
                            <p className="mt-1 font-bold">{queueSize}</p>
                        </div>
                    </div>

                    <details className="rounded-lg border border-white/10 bg-slate-900 p-3 text-xs text-slate-300">
                        <summary className="cursor-pointer font-bold text-slate-100">Dev reset SQL</summary>
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap leading-5">{`-- Option A: reset this smoke session to active
update secure_oa_sessions
set status = 'active',
    submitted_at = null,
    terminated_at = null,
    terminated_reason = null,
    integrity_score = null,
    integrity_rules_snapshot = null,
    updated_at = now()
where id = '${sessionId || "<session_id>"}';

delete from proctoring_events
where session_id = '${sessionId || "<session_id>"}';

delete from proctoring_snapshots
where session_id = '${sessionId || "<session_id>"}';

-- Option B: delete the attempt so /start returns a fresh row
delete from secure_oa_sessions
where id = '${sessionId || "<session_id>"}';`}</pre>
                    </details>
                </section>

                <section className="grid gap-6 lg:grid-rows-[minmax(320px,1fr)_320px]">
                    <textarea
                        ref={editorRef}
                        className="min-h-[320px] resize-none rounded-lg border border-white/10 bg-slate-900 p-5 font-mono text-sm leading-6 outline-none focus:border-blue-400"
                        defaultValue={"function solve(input) {\n  // Type, paste, copy, or right-click here to test input events.\n  return input;\n}"}
                    />

                    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
                        <div className="border-b border-white/10 px-4 py-3">
                            <h2 className="text-sm font-extrabold">Live Event Log</h2>
                        </div>
                        <div className="max-h-[270px] overflow-y-auto">
                            {events.length ? events.map((entry, index) => (
                                <div key={`${entry.event.client_event_id}:${index}`} className="grid gap-2 border-b border-white/10 px-4 py-3 text-xs md:grid-cols-[90px_1fr_90px]">
                                    <span className="text-slate-400">{entry.at}</span>
                                    <span className="break-all font-mono">
                                        {entry.event.client_event_id} · {entry.event.event_type}
                                        {entry.reason ? ` · ${entry.reason}` : ""}
                                    </span>
                                    <span className="font-bold uppercase text-blue-300">{entry.status}</span>
                                </div>
                            )) : (
                                <div className="px-4 py-8 text-sm text-slate-400">No events yet.</div>
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}

function upsertLogEntry(current: LogEntry[], event: ProctoringDebugEvent): LogEntry[] {
    const at = new Date().toLocaleTimeString();
    const existingIndex = current.findIndex(
        (entry) => entry.event.client_event_id === event.event.client_event_id
    );

    if (existingIndex === -1) {
        return [{ ...event, at }, ...current].slice(0, 200);
    }

    const existing = current[existingIndex];
    if (STATUS_RANK[event.status] < STATUS_RANK[existing.status]) {
        return current;
    }

    const next = [...current];
    next[existingIndex] = {
        ...existing,
        ...event,
        at,
    };
    return next;
}
