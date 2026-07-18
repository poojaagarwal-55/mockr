import crypto from "node:crypto";
import type {
    ProctoringEventInput,
    ProctoringEventPayload,
    ProctoringEventRecord,
    ProctoringEventType,
    ProctoringRules,
    ProctoringSessionStatus,
    ProctoringSeverity,
} from "@interviewforge/shared";
import {
    SERVER_ONLY_PROCTORING_EVENT_TYPES,
    classifySeverity,
    evaluate,
} from "./rules.js";
import { proctoringEventInputSchema } from "./schemas.js";
import { emitProctoringTerminate } from "./socket-bus.js";

export type ProctoringIngestContext = {
    source: "rest" | "socket" | "server";
    ip: string;
};

export type ProctoringIngestResult = {
    accepted: string[];
    rejected: { client_event_id: string; reason: string }[];
    sessionStatus: ProctoringSessionStatus;
    terminated: boolean;
    terminationReason?: string;
};

export type ProctoringNotifier = {
    emitTerminate?: (sessionId: string, reason: string) => void | Promise<void>;
};

type LoadedRuleset = {
    id: string;
    rules: ProctoringRules;
};

type EventRow = {
    id: string;
    sessionId: string;
    clientEventId: string;
    eventType: ProctoringEventType;
    severity: ProctoringSeverity;
    payload: ProctoringEventPayload;
    clientTimestamp: Date;
    serverTimestamp: Date;
};

const serverOnlyEventTypes = new Set<string>(SERVER_ONLY_PROCTORING_EVENT_TYPES);

function delegate(prisma: any, name: string) {
    const model = prisma[name];
    if (!model) throw new Error(`Prisma delegate missing: ${name}`);
    return model;
}

function toEventRecord(event: any): ProctoringEventRecord {
    return {
        id: event.id,
        clientEventId: event.clientEventId,
        eventType: event.eventType,
        severity: event.severity,
        payload: event.payload,
        clientTimestamp: event.clientTimestamp,
        serverTimestamp: event.serverTimestamp,
        processedAt: event.processedAt,
        triggeredTermination: event.triggeredTermination,
    };
}

function status(value: unknown): ProctoringSessionStatus {
    const candidate = String(value || "pending");
    if (["pending", "active", "submitted", "terminated", "abandoned"].includes(candidate)) {
        return candidate as ProctoringSessionStatus;
    }
    return "pending";
}

async function withTransaction<T>(prisma: any, fn: (tx: any) => Promise<T>): Promise<T> {
    if (typeof prisma.$transaction === "function") {
        return prisma.$transaction(fn);
    }
    return fn(prisma);
}

export async function loadActiveProctoringRules(prisma: any, jobRoundId: string): Promise<LoadedRuleset> {
    const proctoringRule = delegate(prisma, "proctoringRule");
    const override = await proctoringRule.findFirst({
        where: { jobRoundId, isActive: true },
        orderBy: { version: "desc" },
        select: { id: true, rules: true },
    });
    if (override) return { id: override.id, rules: override.rules as ProctoringRules };

    const fallback = await proctoringRule.findFirst({
        where: { jobRoundId: null, isActive: true },
        orderBy: { version: "desc" },
        select: { id: true, rules: true },
    });
    if (!fallback) {
        throw new Error("No active proctoring ruleset found.");
    }

    return { id: fallback.id, rules: fallback.rules as ProctoringRules };
}

export class ProctoringIngestService {
    constructor(
        private readonly prisma: any,
        private readonly notifier: ProctoringNotifier = { emitTerminate: emitProctoringTerminate }
    ) { }

    async ingestBatch(
        sessionId: string,
        events: ProctoringEventInput[],
        _context: ProctoringIngestContext
    ): Promise<ProctoringIngestResult> {
        return this.ingestBatchInternal(sessionId, events, false);
    }

    async ingestServerEvent(
        sessionId: string,
        event: ProctoringEventInput
    ): Promise<ProctoringIngestResult> {
        return this.ingestBatchInternal(sessionId, [event], true);
    }

    private async ingestBatchInternal(
        sessionId: string,
        events: ProctoringEventInput[],
        allowServerOnlyEvents: boolean
    ): Promise<ProctoringIngestResult> {
        const secureOaSession = delegate(this.prisma, "secureOaSession");
        const proctoringEvent = delegate(this.prisma, "proctoringEvent");

        const session = await secureOaSession.findUnique({
            where: { id: sessionId },
            select: {
                id: true,
                status: true,
                jobRoundId: true,
            },
        });

        if (!session) {
            return {
                accepted: [],
                rejected: events.map((event: any) => ({
                    client_event_id: String(event?.client_event_id || "unknown"),
                    reason: "session_not_found",
                })),
                sessionStatus: "terminated",
                terminated: false,
            };
        }

        if (session.status !== "active") {
            return {
                accepted: [],
                rejected: events.map((event: any) => ({
                    client_event_id: String(event?.client_event_id || "unknown"),
                    reason: "session_not_active",
                })),
                sessionStatus: status(session.status),
                terminated: session.status === "terminated",
            };
        }

        const rejected: ProctoringIngestResult["rejected"] = [];
        const seenInBatch = new Set<string>();
        const validEvents: ProctoringEventInput[] = [];

        for (const rawEvent of events as any[]) {
            const parsed = proctoringEventInputSchema.safeParse(rawEvent);
            const clientEventId = typeof rawEvent?.client_event_id === "string" ? rawEvent.client_event_id : "unknown";
            if (!parsed.success) {
                rejected.push({ client_event_id: clientEventId, reason: "invalid_payload" });
                continue;
            }

            if (!allowServerOnlyEvents && serverOnlyEventTypes.has(parsed.data.event_type)) {
                rejected.push({ client_event_id: parsed.data.client_event_id, reason: "server_only_event_type" });
                continue;
            }

            if (seenInBatch.has(parsed.data.client_event_id)) {
                rejected.push({ client_event_id: parsed.data.client_event_id, reason: "duplicate_event" });
                continue;
            }

            seenInBatch.add(parsed.data.client_event_id);
            validEvents.push(parsed.data);
        }

        if (!validEvents.length) {
            return {
                accepted: [],
                rejected,
                sessionStatus: "active",
                terminated: false,
            };
        }

        const candidateClientIds = validEvents.map((event) => event.client_event_id);
        const existingEvents = await proctoringEvent.findMany({
            where: {
                sessionId,
                clientEventId: { in: candidateClientIds },
            },
            select: { clientEventId: true },
        });
        const existingClientIds = new Set(existingEvents.map((event: any) => event.clientEventId));

        const eventsToConsider = validEvents.filter((event) => {
            if (!existingClientIds.has(event.client_event_id)) return true;
            rejected.push({ client_event_id: event.client_event_id, reason: "duplicate_event" });
            return false;
        });

        if (!eventsToConsider.length) {
            return {
                accepted: [],
                rejected,
                sessionStatus: "active",
                terminated: false,
            };
        }

        const ruleset = await loadActiveProctoringRules(this.prisma, session.jobRoundId);
        const previousEvents = await proctoringEvent.findMany({
            where: { sessionId },
            orderBy: { serverTimestamp: "asc" },
        });
        const evaluationTimeline = previousEvents.map(toEventRecord);
        const rowsToPersist: EventRow[] = [];
        let terminated = false;
        let terminationReason: string | undefined;
        let triggeringEventId: string | undefined;

        for (const input of eventsToConsider) {
            if (terminated) {
                rejected.push({
                    client_event_id: input.client_event_id,
                    reason: "session_terminated_mid_batch",
                });
                continue;
            }

            const severity = classifySeverity(input.event_type, input.payload as any, ruleset.rules);
            const row: EventRow = {
                id: crypto.randomUUID(),
                sessionId,
                clientEventId: input.client_event_id,
                eventType: input.event_type,
                severity,
                payload: input.payload as ProctoringEventPayload,
                clientTimestamp: new Date(input.client_timestamp),
                serverTimestamp: new Date(Date.now() + rowsToPersist.length),
            };
            const record = toEventRecord(row);
            rowsToPersist.push(row);

            const result = evaluate(session, record, evaluationTimeline, ruleset.rules);
            evaluationTimeline.push(record);
            if (result.shouldTerminate) {
                terminated = true;
                terminationReason = result.terminationReason || "auto_rule_violation";
                triggeringEventId = row.id;
            }
        }

        const accepted = rowsToPersist.map((row) => row.clientEventId);
        const processedAt = new Date();

        await withTransaction(this.prisma, async (tx) => {
            const txProctoringEvent = delegate(tx, "proctoringEvent");
            const txSecureOaSession = delegate(tx, "secureOaSession");

            if (rowsToPersist.length) {
                await txProctoringEvent.createMany({
                    data: rowsToPersist.map((row) => ({
                        id: row.id,
                        sessionId: row.sessionId,
                        clientEventId: row.clientEventId,
                        eventType: row.eventType,
                        severity: row.severity,
                        payload: row.payload,
                        clientTimestamp: row.clientTimestamp,
                        serverTimestamp: row.serverTimestamp,
                    })),
                    skipDuplicates: true,
                });
                await txProctoringEvent.updateMany({
                    where: { id: { in: rowsToPersist.map((row) => row.id) } },
                    data: { processedAt },
                });
            }

            if (terminated) {
                await txSecureOaSession.update({
                    where: { id: sessionId },
                    data: {
                        status: "terminated",
                        terminatedAt: processedAt,
                        terminatedReason: terminationReason,
                    },
                });
                if (triggeringEventId) {
                    await txProctoringEvent.update({
                        where: { id: triggeringEventId },
                        data: {
                            triggeredTermination: true,
                            processedAt,
                        },
                    });
                }
            }
        });

        if (terminated && terminationReason) {
            await this.notifier.emitTerminate?.(sessionId, terminationReason);
        }

        return {
            accepted,
            rejected,
            sessionStatus: terminated ? "terminated" : "active",
            terminated,
            terminationReason,
        };
    }
}
