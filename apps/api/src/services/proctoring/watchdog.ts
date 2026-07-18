import type { PrismaClient } from "@interviewforge/db";
import { DEFAULT_PROCTORING_RULES, type ProctoringRules } from "@interviewforge/shared";
import { ProctoringIngestService } from "./ingest.js";
import {
    disconnectProctoringSession,
    emitProctoringHeartbeatRequired,
} from "./socket-bus.js";

type Logger = {
    info: (...args: any[]) => void;
    error: (...args: any[]) => void;
    warn: (...args: any[]) => void;
};

const HEARTBEAT_INTERVAL_MS = 10_000;
const OA_CLOSED_SWEEP_INTERVAL_MS = 60_000;
const RULES_REFRESH_MS = 5 * 60_000;

let started = false;
let cachedDefaultRules: { rules: ProctoringRules; loadedAt: number } | null = null;

function logInfo(logger: Partial<Logger> | undefined, ...args: any[]) {
    if (logger?.info) logger.info(...args);
    else console.log(...args);
}

function logError(logger: Partial<Logger> | undefined, ...args: any[]) {
    if (logger?.error) logger.error(...args);
    else console.error(...args);
}

function serializeError(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return error;
}

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

async function getDefaultRules(prisma: any): Promise<ProctoringRules> {
    const now = Date.now();
    if (cachedDefaultRules && now - cachedDefaultRules.loadedAt < RULES_REFRESH_MS) {
        return cachedDefaultRules.rules;
    }
    const row = await prisma.proctoringRule.findFirst({
        where: { jobRoundId: null, isActive: true },
        orderBy: { version: "desc" },
        select: { rules: true },
    });
    cachedDefaultRules = { rules: (row?.rules as ProctoringRules | undefined) || DEFAULT_PROCTORING_RULES, loadedAt: now };
    return cachedDefaultRules.rules;
}

function lastTimestamp(row: any) {
    return row?._max?.serverTimestamp ? new Date(row._max.serverTimestamp) : null;
}

function assessmentClosesAt(session: any) {
    const config = toRecord(toRecord(session.jobRound?.config).onlineAssessment);
    const value = config.closesAt || config.endAt || session.jobRound?.closesAt;
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
}

export async function runProctoringHeartbeatPass(prisma: any, logger?: Partial<Logger>) {
    const rules = await getDefaultRules(prisma);
    const graceMs = rules.thresholds.heartbeat_grace_ms;
    const now = new Date();
    const sessions = await prisma.secureOaSession.findMany({
        where: { status: "active" },
        select: { id: true, startedAt: true },
    });
    if (!sessions.length) return { scanned: 0, heartbeatGaps: 0, abandoned: 0 };

    const sessionIds = sessions.map((session: any) => session.id);
    const [lastEvents, recentGaps] = await Promise.all([
        prisma.proctoringEvent.groupBy({
            by: ["sessionId"],
            where: { sessionId: { in: sessionIds } },
            _max: { serverTimestamp: true },
        }),
        prisma.proctoringEvent.groupBy({
            by: ["sessionId"],
            where: {
                sessionId: { in: sessionIds },
                eventType: "heartbeat_gap",
                serverTimestamp: { gt: new Date(now.getTime() - graceMs) },
            },
            _count: { _all: true },
        }),
    ]);

    const lastBySession = new Map(lastEvents.map((row: any) => [row.sessionId, lastTimestamp(row)]));
    const recentGapSessionIds = new Set(recentGaps.map((row: any) => row.sessionId));
    const ingestService = new ProctoringIngestService(prisma);
    let heartbeatGaps = 0;
    let abandoned = 0;

    for (const session of sessions) {
        const lastEventAt = lastBySession.get(session.id) || session.startedAt || now;
        const ageMs = now.getTime() - new Date(lastEventAt as any).getTime();

        if (ageMs > graceMs * 0.7 && ageMs <= graceMs) {
            emitProctoringHeartbeatRequired(session.id);
        }

        if (ageMs > graceMs && !recentGapSessionIds.has(session.id)) {
            heartbeatGaps += 1;
            await ingestService.ingestServerEvent(session.id, {
                client_event_id: `server:${session.id}:heartbeat_gap:${Math.floor(now.getTime() / graceMs)}`,
                event_type: "heartbeat_gap",
                payload: { gap_ms: ageMs },
                client_timestamp: now.toISOString(),
            } as any);
        }

        if (ageMs > 5 * graceMs) {
            abandoned += 1;
            await prisma.secureOaSession.update({
                where: { id: session.id },
                data: {
                    status: "abandoned",
                    terminatedAt: now,
                    terminatedReason: null,
                },
            });
            disconnectProctoringSession(session.id);
        }
    }

    return { scanned: sessions.length, heartbeatGaps, abandoned };
}

export async function runProctoringOaClosedSweep(prisma: any) {
    const now = new Date();
    const sessions = await prisma.secureOaSession.findMany({
        where: { status: "active" },
        select: {
            id: true,
            jobRound: {
                select: {
                    closesAt: true,
                    config: true,
                },
            },
        },
    });

    const expired = sessions.filter((session: any) => {
        const closesAt = assessmentClosesAt(session);
        return closesAt ? closesAt <= now : false;
    });
    for (const session of expired) {
        await prisma.secureOaSession.update({
            where: { id: session.id },
            data: {
                status: "abandoned",
                terminatedAt: now,
                terminatedReason: null,
            },
        });
        disconnectProctoringSession(session.id);
    }

    return { scanned: sessions.length, abandoned: expired.length };
}

export function startProctoringWatchdog(prisma: PrismaClient, logger?: Partial<Logger>) {
    if (started) {
        return () => { };
    }
    started = true;

    const heartbeatTimer = setInterval(async () => {
        try {
            const result = await runProctoringHeartbeatPass(prisma, logger);
            if (result.heartbeatGaps || result.abandoned) {
                logInfo(logger, { result }, "Secure OA heartbeat watchdog completed");
            }
        } catch (error) {
            logError(logger, { error: serializeError(error) }, "Secure OA heartbeat watchdog failed");
        }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();

    const oaClosedTimer = setInterval(async () => {
        try {
            const result = await runProctoringOaClosedSweep(prisma);
            if (result.abandoned) {
                logInfo(logger, { result }, "Secure OA closed-window sweep completed");
            }
        } catch (error) {
            logError(logger, { error: serializeError(error) }, "Secure OA closed-window sweep failed");
        }
    }, OA_CLOSED_SWEEP_INTERVAL_MS);
    oaClosedTimer.unref();

    logInfo(logger, "Secure OA proctoring watchdog started");

    return () => {
        clearInterval(heartbeatTimer);
        clearInterval(oaClosedTimer);
        started = false;
    };
}
