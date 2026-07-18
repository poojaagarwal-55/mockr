"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ClockIcon } from "@/components/icons/clock-icon";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { usePeerSocket } from "@/hooks/use-peer-socket";

const languageOptions = ["python", "javascript", "java", "cpp"] as const;
const LANGUAGE_LABELS: Record<string, string> = {
    python: "Python",
    javascript: "JavaScript",
    java: "Java",
    cpp: "C++",
};
const DEFAULT_INTERVIEW_TYPE = "coding" as const;
const DEFAULT_TIMING_PRESET = "deep_60" as const;
const JOIN_WINDOW_MS = 60_000;
const SLOT_LOOKAHEAD_DAYS = 7;
const SLOT_START_HOUR = 9;
const SLOT_END_HOUR = 23;
const ENABLE_DEV_PEER_TEST_SLOT = process.env.NODE_ENV !== "production";
// Two dev test offsets so two browser sessions can pick the same target slot and
// walk through the full lobby matching pipeline at a fast cadence. Both round up
// to the next whole minute so two users clicking within the same minute land on
// the same slot id.
const DEV_TEST_SLOT_OFFSETS_MS = [2 * 60_000, 5 * 60_000] as const;

const PEER_INTERVIEW_CARD = {
    id: "coding",
    label: "Coding Interview",
    icon: "code",
    description: "Practice a live DSA interview with another candidate. One person interviews, one person solves, then feedback is exchanged after the session.",
    details: ["Live peer matching", "Shared IDE", "Video, chat, and synced question flow", "Peer feedback after completion"],
};

const LEVEL_OPTIONS: Array<{ value: PeerLevel; label: string; description: string }> = [
    { value: "beginner", label: "Beginner", description: "I am new to peer mock interviews." },
    { value: "intermediate", label: "Intermediate", description: "I have done several interviews already." },
    { value: "advanced", label: "Advanced", description: "I am very comfortable with mock interviews." },
];

const SCHEDULE_STEPS: Array<{ icon: string; title: string; description: string }> = [
    {
        icon: "calendar_add_on",
        title: "Pick a time",
        description: "Choose your interview type, pick your level, and book a slot that fits your schedule.",
    },
    {
        icon: "diversity_3",
        title: "Get matched live",
        description: "At your slot, join the waiting room. We pair you with a peer at your level within minutes.",
    },
    {
        icon: "terminal",
        title: "Run the interview",
        description: "Take turns as interviewer and candidate with live video, chat, and a synced question to work through.",
    },
    {
        icon: "rate_review",
        title: "Exchange feedback",
        description: "Rate each other afterwards to get a report and watch your rating improve over time.",
    },
];

const INTERVIEW_TYPE_LABEL: Record<string, string> = {
    coding: "Data Structures & Algorithms",
    system_design: "System Design",
    behavioural: "Behavioural",
};

type PeerLevel = "beginner" | "intermediate" | "advanced";

type PeerProfile = {
    currentLevel: PeerLevel;
    score: number;
    sessionsRated: number;
    onboarded: boolean;
};

type PeerSessionSummary = {
    sessionId: string;
    status: string;
    source: string;
    scheduledFor: string | null;
    startedAt: string | null;
    endedAt: string | null;
    participantRole: "interviewer" | "candidate";
    preferredLanguage: string;
    isReady: boolean;
    hasPeer: boolean;
    canSubmitFeedback: boolean;
    submittedFeedback: boolean;
    prepQuestion: {
        assignmentId: string;
        title: string;
        difficulty: string;
        category: string;
        practiceUrl: string;
    } | null;
    receivedFeedback: {
        overallRating: number;
        problemSolving: number;
        communication: number;
        codeQuality: number;
        interviewing: number;
        wouldMatchAgain: boolean;
        whatWentWell: string | null;
        improvementAreas: string | null;
    } | null;
};

type SessionsResponse = {
    sessions: PeerSessionSummary[];
};

type BookingResponse = {
    sessionId: string;
    scheduledFor: string | null;
    prepQuestion: {
        assignmentId: string;
        title: string;
        difficulty: string;
        category: string;
        practiceUrl: string;
    } | null;
};

type SlotOption = {
    iso: string;
    dayLabel: string;
    timeLabel: string;
    fullLabel: string;
    isDev?: boolean;
};

type ModalStep = "level" | "time" | "confirm";

function buildSlotOptions(nowMs = Date.now()): SlotOption[] {
    const now = new Date(nowMs);
    const slots: SlotOption[] = [];

    if (ENABLE_DEV_PEER_TEST_SLOT) {
        const seenIsos = new Set<string>();
        for (const offsetMs of DEV_TEST_SLOT_OFFSETS_MS) {
            const devSlot = new Date(Math.ceil((nowMs + offsetMs) / 60_000) * 60_000);
            const iso = devSlot.toISOString();
            if (seenIsos.has(iso)) continue;
            seenIsos.add(iso);

            const minutesFromNow = Math.max(1, Math.round((devSlot.getTime() - nowMs) / 60_000));
            slots.push({
                iso,
                dayLabel: "Dev test",
                timeLabel: `+${minutesFromNow}m · ${devSlot.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
                fullLabel: devSlot.toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                }),
                isDev: true,
            });
        }
    }

    for (let dayOffset = 0; dayOffset < SLOT_LOOKAHEAD_DAYS; dayOffset += 1) {
        const day = new Date(now);
        day.setDate(now.getDate() + dayOffset);

        for (let hour = SLOT_START_HOUR; hour <= SLOT_END_HOUR; hour += 1) {
            const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
            if (slot.getTime() <= now.getTime() + 30_000) {
                continue;
            }

            slots.push({
                iso: slot.toISOString(),
                dayLabel: slot.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
                timeLabel: slot.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
                fullLabel: slot.toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                }),
            });
        }
    }

    return slots;
}

function formatClock(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function canJoinSession(session: PeerSessionSummary, nowMs: number): boolean {
    const status = session.status.toUpperCase();
    if (["ACTIVE", "CONNECTING", "MATCHED"].includes(status)) return true;
    if (!session.scheduledFor) return false;
    return new Date(session.scheduledFor).getTime() - nowMs <= 0;
}

// An interview already in progress (e.g. the user got disconnected / refreshed)
// is rejoined rather than freshly joined — they resume where they left off.
function isRejoinableSession(session: PeerSessionSummary): boolean {
    return session.status.toUpperCase() === "ACTIVE";
}

function statusLabel(session: PeerSessionSummary): string {
    const status = session.status.toUpperCase();
    if (status === "PENDING") return session.hasPeer ? "Matched" : "Waiting for slot";
    if (status === "MATCHED") return "Matched";
    if (status === "CONNECTING") return "Starting";
    if (status === "ACTIVE") return "Live";
    if (status === "COMPLETED") return "Completed";
    if (status === "ABANDONED") return "Ended";
    return status;
}

function formatSlotDate(iso: string | null): string {
    if (!iso) return "Instant session";
    return new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export default function PeerInterviewPage() {
    useEffect(() => {
        document.title = "Peer Interview | Mockr";
    }, []);

    const router = useRouter();
    const { session } = useAuth();
    const { match, scheduled, lastError, markReady, clearError, clearScheduled } = usePeerSocket();

    const [nowMs, setNowMs] = useState(Date.now());
    const slotRefreshMinute = Math.floor(nowMs / 60_000);
    const slotOptions = useMemo(() => buildSlotOptions(nowMs), [slotRefreshMinute]);
    const groupedSlots = useMemo(() => {
        return slotOptions.reduce<Record<string, SlotOption[]>>((groups, slot) => {
            groups[slot.dayLabel] = [...(groups[slot.dayLabel] || []), slot];
            return groups;
        }, {});
    }, [slotOptions]);

    const [profile, setProfile] = useState<PeerProfile | null>(null);
    const [sessions, setSessions] = useState<PeerSessionSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [creatingBooking, setCreatingBooking] = useState(false);
    const [savingLevel, setSavingLevel] = useState(false);
    const [bookingError, setBookingError] = useState<string | null>(null);

    // Booking modal state machine.
    const [modalStep, setModalStep] = useState<ModalStep | null>(null);
    const [selectedLevel, setSelectedLevel] = useState<PeerLevel>("beginner");
    const [selectedLanguage, setSelectedLanguage] = useState<(typeof languageOptions)[number]>("cpp");
    const [selectedSlotIso, setSelectedSlotIso] = useState(slotOptions[0]?.iso || "");
    const [confirmation, setConfirmation] = useState<BookingResponse | null>(null);

    // Pre-join A/V check ("Lights, camera, action!").
    const [avCheckSessionId, setAvCheckSessionId] = useState<string | null>(null);
    const [avError, setAvError] = useState<string | null>(null);
    const [avDevices, setAvDevices] = useState<{ cameras: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cameras: [], mics: [] });
    const avVideoRef = useRef<HTMLVideoElement | null>(null);
    const avStreamRef = useRef<MediaStream | null>(null);

    const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

    const stopAvStream = useCallback(() => {
        avStreamRef.current?.getTracks().forEach((track) => track.stop());
        avStreamRef.current = null;
    }, []);

    // When the A/V check opens, request the camera/mic and show a live preview.
    useEffect(() => {
        if (!avCheckSessionId || typeof navigator === "undefined") return;

        let cancelled = false;
        setAvError(null);

        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then(async (stream) => {
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                avStreamRef.current = stream;
                if (avVideoRef.current) {
                    avVideoRef.current.srcObject = stream;
                    void avVideoRef.current.play().catch(() => undefined);
                }
                try {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!cancelled) {
                        setAvDevices({
                            cameras: devices.filter((d) => d.kind === "videoinput"),
                            mics: devices.filter((d) => d.kind === "audioinput"),
                        });
                    }
                } catch {
                    // Device labels are best-effort.
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setAvError(err instanceof Error ? err.message : "Unable to access camera/microphone");
                }
            });

        return () => {
            cancelled = true;
            stopAvStream();
        };
    }, [avCheckSessionId, stopAvStream]);

    useEffect(() => {
        if (slotOptions.some((slot) => slot.iso === selectedSlotIso)) {
            return;
        }
        setSelectedSlotIso(slotOptions[0]?.iso || "");
    }, [selectedSlotIso, slotOptions]);

    const loadPeerData = useCallback(async () => {
        if (!session?.access_token) return;

        const [profileResponse, sessionsResponse] = await Promise.all([
            api.get<PeerProfile>("/p2p/me/skill-profile", session.access_token),
            api.get<SessionsResponse>("/p2p/me/sessions", session.access_token),
        ]);

        setProfile(profileResponse);
        setSessions(sessionsResponse.sessions);
    }, [session?.access_token]);

    useEffect(() => {
        if (!session?.access_token) return;

        let cancelled = false;
        setLoading(true);

        loadPeerData()
            .catch((error) => {
                if (!cancelled) {
                    const message = error instanceof Error ? error.message : "Unable to load peer interview data";
                    setBookingError(message);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        const refresh = window.setInterval(() => {
            void loadPeerData().catch(() => undefined);
        }, 15_000);

        return () => {
            cancelled = true;
            window.clearInterval(refresh);
        };
    }, [loadPeerData, session?.access_token]);

    useEffect(() => {
        const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(tick);
    }, []);

    useEffect(() => {
        if (!match?.peerSessionId) return;
        router.push(`/interviews/peer/session/${match.peerSessionId}`);
    }, [match?.peerSessionId, router]);

    useEffect(() => {
        if (!scheduled?.peerSessionId) return;
        router.push(`/interviews/peer/session/${scheduled.peerSessionId}/prep`);
        clearScheduled();
    }, [clearScheduled, router, scheduled?.peerSessionId]);

    const upcomingSessions = sessions.filter(
        (item) => !["COMPLETED", "ABANDONED", "CANCELLED"].includes(item.status.toUpperCase())
    );
    // Only feedback the user still owes shows on this tab; all completed reports
    // live in the Reports tab.
    const pendingReports = sessions.filter((item) => item.canSubmitFeedback && !item.submittedFeedback);

    const openBookingFlow = () => {
        setBookingError(null);
        clearError();
        setConfirmation(null);
        if (profile && !profile.onboarded) {
            setSelectedLevel(profile.currentLevel);
            setModalStep("level");
        } else {
            if (profile) setSelectedLevel(profile.currentLevel);
            setModalStep("time");
        }
    };

    const closeModal = () => {
        setModalStep(null);
        setConfirmation(null);
    };

    const handleSaveLevel = async () => {
        if (!session?.access_token) return;
        setSavingLevel(true);
        setBookingError(null);
        try {
            const updated = await api.post<PeerProfile>(
                "/p2p/profile",
                { level: selectedLevel },
                session.access_token
            );
            setProfile({
                currentLevel: updated.currentLevel,
                score: updated.score,
                sessionsRated: updated.sessionsRated,
                onboarded: true,
            });
            setModalStep("time");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to save your level";
            setBookingError(message);
        } finally {
            setSavingLevel(false);
        }
    };

    const handleCreateBooking = async () => {
        if (!session?.access_token || !selectedSlotIso) return;

        setCreatingBooking(true);
        setBookingError(null);

        try {
            const response = await api.post<BookingResponse>(
                "/p2p/bookings",
                {
                    interviewType: DEFAULT_INTERVIEW_TYPE,
                    preferredLanguage: selectedLanguage,
                    timingPreset: DEFAULT_TIMING_PRESET,
                    scheduledFor: selectedSlotIso,
                    timeZone,
                },
                session.access_token
            );

            await loadPeerData();
            setConfirmation(response);
            setModalStep("confirm");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to create scheduled session";
            setBookingError(message);
        } finally {
            setCreatingBooking(false);
        }
    };

    const handleJoinLobby = (peerSessionId: string) => {
        // Run the camera/mic check before entering the waiting room.
        setAvCheckSessionId(peerSessionId);
    };

    const handleEnterWaitingRoom = () => {
        if (!avCheckSessionId) return;
        const peerSessionId = avCheckSessionId;
        stopAvStream();
        setAvCheckSessionId(null);
        markReady(peerSessionId);
        router.push(`/interviews/peer/session/${peerSessionId}`);
    };

    const handleCancel = async (peerSessionId: string) => {
        if (!session?.access_token) return;
        setBookingError(null);

        try {
            await api.post(`/p2p/sessions/${peerSessionId}/cancel`, {}, session.access_token);
            await loadPeerData();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to cancel this slot";
            setBookingError(message);
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg">
            <PageHeader
                showBack
                backUrl="/interviews"
                titleNode={
                    <div className="flex items-center gap-5">
                        <Link
                            href="/interviews/peer"
                            className="text-[28px] font-bold font-nunito tracking-[-0.02em] text-slate-950 dark:text-white"
                        >
                            Peer Interview
                        </Link>
                        <span className="h-8 w-px bg-slate-300 dark:bg-white/15" />
                        <Link
                            href="/interviews/peer/reports"
                            className="text-[28px] font-bold font-nunito tracking-[-0.02em] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        >
                            Reports
                        </Link>
                    </div>
                }
            />

            <main className="flex-1 flex flex-col w-full py-12 px-6 lg:px-8 pb-16 space-y-12 text-left">
                <section className="space-y-6">
                    <div className="flex flex-wrap items-start gap-4">
                        <div
                            onClick={openBookingFlow}
                            className="group relative w-[200px] md:w-[240px] min-h-[260px] md:min-h-[270px] p-4 md:p-5 rounded-2xl border-2 text-left flex flex-col transition-all duration-300 ease-out cursor-pointer hover:-translate-y-3 overflow-hidden before:pointer-events-none before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-1/2 before:transition-transform before:duration-700 before:ease-in-out shadow-sm hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] border-slate-200 dark:border-white/10 bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 dark:from-[#2a2a2a] dark:via-[#222222] dark:to-[#1a1a1a] dark:hover:from-[#303030] dark:hover:to-[#1e1e1e] backdrop-blur-sm hover:border-primary/50"
                        >
                            <div className="relative z-10 flex flex-col items-start gap-2.5 flex-1 w-full">
                                <h2 className="font-bold font-nunito text-lg text-slate-900 dark:text-[#eff1f6] leading-tight">
                                    {PEER_INTERVIEW_CARD.label}
                                </h2>
                                <p className="text-[13px] leading-snug text-slate-600 dark:text-slate-400">
                                    {PEER_INTERVIEW_CARD.description}
                                </p>
                                <span className="mt-auto pt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-400">
                                    <ClockIcon size={13} />
                                    60 min
                                </span>
                            </div>
                        </div>

                        {(bookingError || lastError) && !modalStep && (
                            <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 text-sm text-red-700 dark:text-red-300 max-w-sm self-start mt-2">
                                {bookingError || lastError}
                            </div>
                        )}
                    </div>
                </section>

                {upcomingSessions.length > 0 && (
                <section className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-2xl font-bold font-nunito tracking-tight text-slate-950 dark:text-white">Upcoming interviews</h2>
                        {loading && <span className="text-xs text-slate-500">Refreshing...</span>}
                    </div>

                    <div className="rounded-2xl bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-xs font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-lc-border">
                                    <th className="px-5 py-3">Date</th>
                                    <th className="px-5 py-3">Type</th>
                                    <th className="px-5 py-3">Question you&apos;ll ask</th>
                                    <th className="px-5 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {upcomingSessions.map((item) => {
                                    const joinable = canJoinSession(item, nowMs);
                                    const msUntil = item.scheduledFor
                                        ? new Date(item.scheduledFor).getTime() - nowMs
                                        : 0;
                                    const withinTimerWindow = !joinable && msUntil > 0 && msUntil <= JOIN_WINDOW_MS;

                                    return (
                                        <tr key={item.sessionId} className="border-b border-slate-100 dark:border-lc-border/60 last:border-0">
                                            <td className="px-5 py-4 align-middle">
                                                <div className="font-semibold text-slate-950 dark:text-white">{formatSlotDate(item.scheduledFor)}</div>
                                            </td>
                                            <td className="px-5 py-4 align-middle text-sm text-slate-700 dark:text-slate-300">
                                                {INTERVIEW_TYPE_LABEL.coding}
                                            </td>
                                            <td className="px-5 py-4 align-middle">
                                                {item.prepQuestion ? (
                                                    <Link
                                                        href={item.prepQuestion.practiceUrl}
                                                        className="text-sm font-semibold text-primary hover:underline"
                                                    >
                                                        {item.prepQuestion.title}
                                                    </Link>
                                                ) : (
                                                    <span className="text-sm text-slate-400">Assigning…</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 align-middle">
                                                <div className="flex items-center justify-end">
                                                    {isRejoinableSession(item) ? (
                                                        <button
                                                            onClick={() => handleJoinLobby(item.sessionId)}
                                                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">replay</span>
                                                            Rejoin session
                                                        </button>
                                                    ) : joinable ? (
                                                        <button
                                                            onClick={() => handleJoinLobby(item.sessionId)}
                                                            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors"
                                                        >
                                                            Join session
                                                        </button>
                                                    ) : withinTimerWindow ? (
                                                        <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm font-bold font-mono tabular-nums">
                                                            <span className="material-symbols-outlined text-[16px]">schedule</span>
                                                            {formatClock(msUntil)}
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleCancel(item.sessionId)}
                                                            className="px-4 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                                                        >
                                                            Cancel session
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
                )}

                {pendingReports.length > 0 && (
                <section className="space-y-4">
                    <div>
                        <h2 className="text-2xl font-bold font-nunito tracking-tight text-slate-950 dark:text-white">Pending feedback</h2>
                        <p className="text-sm text-slate-500">Your partner is refreshing their inbox waiting for this. Don&apos;t leave them on read, submit your feedback.</p>
                    </div>
                    <div className="rounded-2xl bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-xs font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200 dark:border-lc-border">
                                    <th className="px-5 py-3">Date</th>
                                    <th className="px-5 py-3">Type</th>
                                    <th className="px-5 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingReports.map((item) => (
                                    <tr key={item.sessionId} className="border-b border-slate-100 dark:border-lc-border/60 last:border-0">
                                        <td className="px-5 py-4 align-middle">
                                            <div className="font-semibold text-slate-950 dark:text-white">
                                                {formatSlotDate(item.scheduledFor)}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 align-middle text-sm text-slate-700 dark:text-slate-300">
                                            {INTERVIEW_TYPE_LABEL.coding}
                                        </td>
                                        <td className="px-5 py-4 align-middle">
                                            <div className="flex items-center justify-end">
                                                <Link
                                                    href={`/interviews/peer/session/${item.sessionId}/feedback`}
                                                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors"
                                                >
                                                    Submit feedback
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
                )}

                <section className="space-y-5">
                    <div>
                        <h2 className="text-2xl font-bold font-nunito tracking-tight text-slate-950 dark:text-white">How to schedule a practice session</h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {SCHEDULE_STEPS.map((step, index) => (
                            <div
                                key={step.title}
                                className="group relative rounded-2xl bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_16px_34px_-18px_rgba(0,0,0,0.25)]"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center transition-colors group-hover:bg-primary group-hover:text-white">
                                        <span className="material-symbols-outlined text-[22px]">{step.icon}</span>
                                    </div>
                                    <span className="font-nunito font-black text-3xl leading-none text-slate-100 dark:text-white/10 select-none">
                                        {(index + 1).toString().padStart(2, "0")}
                                    </span>
                                </div>
                                <h3 className="mt-4 font-bold font-nunito text-slate-900 dark:text-white">{step.title}</h3>
                                <p className="mt-1.5 text-[13px] leading-snug text-slate-500 dark:text-slate-400">{step.description}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </main>

            {modalStep && (
                <div onClick={closeModal} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
                    <div onClick={(event) => event.stopPropagation()} className="w-full max-w-lg rounded-3xl bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-end px-5 pt-4">
                            {profile?.onboarded ? (
                                <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-bold capitalize">
                                    {profile.currentLevel} · {Math.round(profile.score)}
                                </span>
                            ) : (
                                <button
                                    onClick={closeModal}
                                    className="inline-flex items-center justify-center size-8 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                                    aria-label="Close"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            )}
                        </div>

                        {modalStep === "level" && (
                            <div className="px-6 pb-6 -mt-2">
                                <div className="text-center space-y-1">
                                    <h3 className="text-xl font-bold font-nunito text-slate-950 dark:text-white">Choose your interview level</h3>
                                    <p className="text-sm text-slate-500">This will be used to help match you with the best partner.</p>
                                </div>
                                <div className="mt-5 space-y-3">
                                    {LEVEL_OPTIONS.map((option) => (
                                        <button
                                            key={option.value}
                                            onClick={() => setSelectedLevel(option.value)}
                                            className={`w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all ${
                                                selectedLevel === option.value
                                                    ? "border-primary bg-primary/5"
                                                    : "border-slate-200 dark:border-lc-border hover:border-primary/40"
                                            }`}
                                        >
                                            <div className="font-bold text-slate-950 dark:text-white">{option.label}</div>
                                            <div className="text-sm text-slate-500">{option.description}</div>
                                        </button>
                                    ))}
                                </div>
                                {bookingError && (
                                    <div className="mt-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 text-sm text-red-700 dark:text-red-300">
                                        {bookingError}
                                    </div>
                                )}
                                <div className="mt-6 flex items-center gap-3">
                                    <button onClick={closeModal} className="flex-1 px-5 py-3 rounded-xl border border-slate-300 dark:border-lc-border font-bold text-slate-700 dark:text-slate-100">
                                        Back
                                    </button>
                                    <button
                                        onClick={handleSaveLevel}
                                        disabled={savingLevel}
                                        className="flex-1 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold disabled:opacity-50"
                                    >
                                        {savingLevel ? "Saving…" : "Next"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {modalStep === "time" && (
                            <div className="px-6 pb-6 -mt-2">
                                <div className="space-y-1 text-left">
                                    <h3 className="text-[22px] font-bold font-nunito text-slate-950 dark:text-white">Select a time to practice</h3>
                                    <p className="text-sm text-slate-500">All times shown in your local timezone ({timeZone})</p>
                                </div>

                                <label className="mt-4 flex items-center justify-between gap-3 text-sm">
                                    <span className="font-bold text-slate-800 dark:text-slate-100">Coding language</span>
                                    <div className="relative">
                                        <select
                                            value={selectedLanguage}
                                            onChange={(event) => setSelectedLanguage(event.target.value as typeof selectedLanguage)}
                                            className="appearance-none border border-slate-300 dark:border-lc-border rounded-xl pl-3 pr-9 py-2 bg-white dark:bg-lc-bg font-semibold"
                                        >
                                            {languageOptions.map((language) => (
                                                <option key={language} value={language}>{LANGUAGE_LABELS[language] ?? language}</option>
                                            ))}
                                        </select>
                                        <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[20px] text-slate-500">expand_more</span>
                                    </div>
                                </label>

                                <div className="mt-4 max-h-[320px] overflow-auto pr-1 space-y-4 custom-scrollbar">
                                    {Object.entries(groupedSlots).map(([day, slots]) => (
                                        <div key={day} className="space-y-2">
                                            <div className="text-xs font-black uppercase tracking-wide text-slate-500">{day}</div>
                                            <div className="space-y-2">
                                                {slots.map((slot) => (
                                                    <button
                                                        key={slot.iso}
                                                        onClick={() => setSelectedSlotIso(slot.iso)}
                                                        className={`w-full rounded-xl border px-4 py-3 text-sm font-bold transition-all ${
                                                            selectedSlotIso === slot.iso
                                                                ? "border-primary bg-primary text-white shadow-lg shadow-primary/20"
                                                                : "border-slate-200 dark:border-lc-border text-slate-700 dark:text-slate-100 hover:border-primary hover:bg-primary/5"
                                                        }`}
                                                        title={slot.fullLabel}
                                                    >
                                                        {slot.isDev ? `Test ${slot.timeLabel}` : slot.timeLabel}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {bookingError && (
                                    <div className="mt-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 text-sm text-red-700 dark:text-red-300">
                                        {bookingError}
                                    </div>
                                )}

                                <div className="mt-6 flex items-center gap-3">
                                    <button onClick={closeModal} className="flex-1 px-5 py-3 rounded-xl border border-slate-300 dark:border-lc-border font-bold text-slate-700 dark:text-slate-100">
                                        Back
                                    </button>
                                    <button
                                        onClick={handleCreateBooking}
                                        disabled={creatingBooking || !selectedSlotIso}
                                        className="flex-1 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold disabled:opacity-50"
                                    >
                                        {creatingBooking ? "Scheduling…" : "Schedule"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {modalStep === "confirm" && confirmation && (
                            <div className="px-6 pb-6 -mt-2">
                                <div className="text-center space-y-3">
                                    <div className="mx-auto size-14 rounded-full bg-green-100 dark:bg-green-500/15 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-green-600 dark:text-green-400 text-3xl">check</span>
                                    </div>
                                    <h3 className="text-xl font-bold font-nunito text-slate-950 dark:text-white">Your interview is confirmed!</h3>
                                </div>

                                <div className="mt-5 space-y-3">
                                    <div className="flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-lc-border p-4">
                                        <span className="material-symbols-outlined text-slate-500">schedule</span>
                                        <p className="text-sm text-slate-700 dark:text-slate-300">
                                            Your <span className="font-bold">{INTERVIEW_TYPE_LABEL.coding}</span> interview is{" "}
                                            <span className="font-bold">{formatSlotDate(confirmation.scheduledFor)}</span>.
                                        </p>
                                    </div>
                                    {confirmation.prepQuestion && (
                                        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-lc-border p-4">
                                            <span className="material-symbols-outlined text-slate-500">menu_book</span>
                                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                                Your assigned question to ask is{" "}
                                                <Link href={confirmation.prepQuestion.practiceUrl} className="font-bold text-primary hover:underline">
                                                    {confirmation.prepQuestion.title}
                                                </Link>
                                                . Review it beforehand.
                                            </p>
                                        </div>
                                    )}
                                    <div className="flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-lc-border p-4">
                                        <span className="material-symbols-outlined text-slate-500">mic</span>
                                        <p className="text-sm text-slate-700 dark:text-slate-300">
                                            Make sure you have a working camera and microphone, and arrive on time.
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-6 flex items-center gap-3">
                                    <button
                                        onClick={closeModal}
                                        className="flex-1 px-5 py-3 rounded-xl border border-slate-300 dark:border-lc-border font-bold text-slate-700 dark:text-slate-100"
                                    >
                                        Done
                                    </button>
                                    <button
                                        onClick={() => {
                                            setConfirmation(null);
                                            setModalStep("time");
                                        }}
                                        className="flex-1 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
                                    >
                                        Schedule another
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {avCheckSessionId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
                    <div className="w-full max-w-xl rounded-3xl bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border shadow-2xl p-6 sm:p-8">
                        <div className="text-center space-y-1">
                            <h3 className="text-xl font-bold font-nunito text-slate-950 dark:text-white">Lights, camera, action!</h3>
                            <p className="text-sm text-slate-500">
                                Set up your camera so your partner will be able to see you. Click &ldquo;Allow&rdquo; when prompted to give camera access.
                            </p>
                        </div>

                        <div className="mt-6 flex flex-col sm:flex-row gap-4">
                            <div className="relative w-full sm:w-48 aspect-[4/3] rounded-2xl bg-slate-900 overflow-hidden shrink-0">
                                <video ref={avVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                            </div>
                            <div className="flex-1 space-y-3">
                                <div className="flex items-center gap-3 rounded-xl bg-slate-100 dark:bg-white/5 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                    <span className="material-symbols-outlined text-[20px] text-slate-500">videocam</span>
                                    <span className="truncate">{avDevices.cameras[0]?.label || "Camera"}</span>
                                </div>
                                <div className="flex items-center gap-3 rounded-xl bg-slate-100 dark:bg-white/5 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                    <span className="material-symbols-outlined text-[20px] text-slate-500">mic</span>
                                    <span className="truncate">{avDevices.mics[0]?.label || "Microphone"}</span>
                                </div>
                            </div>
                        </div>

                        {avError && (
                            <div className="mt-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 text-sm text-red-700 dark:text-red-300">
                                {avError}. You can still join, but your partner won&apos;t see or hear you.
                            </div>
                        )}

                        <div className="mt-6 flex items-center justify-between gap-3">
                            <button
                                onClick={() => { stopAvStream(); setAvCheckSessionId(null); }}
                                className="text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleEnterWaitingRoom}
                                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors"
                            >
                                Join the waiting room
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
