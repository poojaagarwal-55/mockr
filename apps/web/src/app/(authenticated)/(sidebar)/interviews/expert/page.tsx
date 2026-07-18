"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { ApiError, api } from "@/lib/api";

type SlotDraft = { startAt: string; endAt: string };

type ExpertCandidateSession = {
    id: string;
    status: string;
    interviewType: string;
    preferredLanguage: string;
    scheduledFor: string;
    endsAt: string | null;
    roomId: string;
    expert: { id: string; fullName: string; avatarUrl: string | null };
    feedbackAvailable: boolean;
};

const languages = ["python", "javascript", "typescript", "java", "cpp", "go"];
const topics = ["arrays", "strings", "hash-table", "dp", "graphs", "trees", "system-design", "behavioral"];
const formats = [
    { value: "coding", label: "Coding", icon: "code", copy: "Live problem solving, debugging, and signal-rich follow ups." },
    { value: "system_design", label: "System design", icon: "hub", copy: "Architecture tradeoffs, APIs, scale, and senior-level judgment." },
    { value: "behavioural", label: "Behavioral", icon: "forum", copy: "Story framing, leadership signals, and crisp communication." },
];
const levels = ["beginner", "intermediate", "advanced"];
const steps = ["Session Goals", "Availability", "Review"] as const;

function describeApiError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const body = err.body as { details?: Record<string, string[]>; message?: string; error?: string };
        const firstDetail = body.details
            ? Object.entries(body.details).find(([, messages]) => Array.isArray(messages) && messages.length > 0)
            : null;
        if (firstDetail) return `${firstDetail[0]}: ${firstDetail[1][0]}`;
        return body.message || body.error || err.message;
    }
    return err instanceof Error ? err.message : fallback;
}

function localValue(date: Date) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultSlots(): SlotDraft[] {
    const make = (days: number) => {
        const start = new Date();
        start.setDate(start.getDate() + days);
        start.setHours(18, 0, 0, 0);
        return { startAt: localValue(start), endAt: localValue(new Date(start.getTime() + 60 * 60_000)) };
    };
    return [make(1), make(2)];
}

function formatSlot(value: string) {
    if (!value) return "Not set";
    return new Date(value).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function formatTimeRange(startAt: string, endAt: string | null) {
    const start = new Date(startAt);
    const end = endAt ? new Date(endAt) : new Date(start.getTime() + 60 * 60_000);
    return `${start.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    })} - ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function slotProblem(slot: SlotDraft) {
    if (!slot.startAt || !slot.endAt) return "Start and end are required.";
    const start = new Date(slot.startAt).getTime();
    const end = new Date(slot.endAt).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return "Use a valid date and time.";
    if (end <= start) return "End must be after start.";
    if (end - start < 60 * 60_000) return "Window must fit a 60-minute interview.";
    return null;
}

function statusTone(status: string) {
    if (["COMPLETED"].includes(status)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (["CANCELLED", "ABANDONED"].includes(status)) return "bg-rose-50 text-rose-700 border-rose-200";
    return "bg-cyan-50 text-cyan-700 border-cyan-200";
}

export default function ExpertInterviewBookingPage() {
    const { session } = useAuth();
    const token = session?.access_token;

    const [modalOpen, setModalOpen] = useState(false);
    const [step, setStep] = useState<0 | 1 | 2>(0);
    const [interviewType, setInterviewType] = useState("coding");
    const [preferredLanguage, setPreferredLanguage] = useState("python");
    const [level, setLevel] = useState("intermediate");
    const [selectedTopics, setSelectedTopics] = useState<string[]>(["arrays"]);
    const [notes, setNotes] = useState("");
    const [slots, setSlots] = useState<SlotDraft[]>(defaultSlots);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [sessions, setSessions] = useState<ExpertCandidateSession[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);

    const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
    const slotErrors = slots.map(slotProblem);
    const canSubmit = selectedTopics.length > 0 && slotErrors.every((item) => !item);

    const loadSessions = useCallback(async () => {
        if (!token) return;
        setSessionsLoading(true);
        try {
            const result = await api.get<{ sessions: ExpertCandidateSession[] }>("/experts/me/sessions", token);
            setSessions(result.sessions);
        } catch {
            setSessions([]);
        } finally {
            setSessionsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    const upcomingSessions = useMemo(() => {
        const now = Date.now();
        return sessions
            .filter((item) => !["COMPLETED", "CANCELLED", "ABANDONED"].includes(item.status) && new Date(item.scheduledFor).getTime() >= now - 15 * 60_000)
            .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    }, [sessions]);

    const previousSessions = useMemo(() => {
        const now = Date.now();
        return sessions
            .filter((item) => ["COMPLETED", "CANCELLED", "ABANDONED"].includes(item.status) || new Date(item.scheduledFor).getTime() < now - 15 * 60_000)
            .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime());
    }, [sessions]);

    function setSlot(index: number, key: keyof SlotDraft, value: string) {
        setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, [key]: value } : slot)));
    }

    function toggleTopic(topic: string) {
        setSelectedTopics((current) =>
            current.includes(topic) ? current.filter((item) => item !== topic) : [...current, topic]
        );
    }

    function openBooking() {
        setModalOpen(true);
        setStep(0);
        setError(null);
        setNotice(null);
    }

    async function submitBooking(event: React.FormEvent) {
        event.preventDefault();
        if (!token || !canSubmit) return;
        setSubmitting(true);
        setError(null);
        setNotice(null);
        try {
            const created = await api.post<{ requestId: string; slotCount: number }>(
                "/experts/booking-requests",
                {
                    interviewType,
                    preferredLanguage,
                    level,
                    topicsFocus: selectedTopics,
                    notes: notes.trim() || undefined,
                    slots: slots.map((slot) => ({
                        startAt: new Date(slot.startAt).toISOString(),
                        endAt: new Date(slot.endAt).toISOString(),
                        timezone,
                    })),
                    expiresInHours: 48,
                },
                token
            );
            setNotice(`Request sent with ${created.slotCount} availability window${created.slotCount === 1 ? "" : "s"}.`);
            setNotes("");
            setSlots(defaultSlots());
            await loadSessions();
        } catch (err) {
            setError(describeApiError(err, "Failed to request expert interview"));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="min-h-full bg-[#f7f9fc] text-slate-950 dark:bg-lc-bg dark:text-white">
            <section className="relative overflow-hidden border-b border-slate-200 bg-[linear-gradient(135deg,#f8fbff_0%,#eefdf6_48%,#fff8e7_100%)] text-slate-950 dark:border-lc-border dark:bg-[#10141f] dark:text-white">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(14,165,233,0.12),transparent_30%)] dark:bg-[linear-gradient(120deg,rgba(16,185,129,0.22),transparent_42%,rgba(251,191,36,0.12))]" />
                <div className="relative mx-auto grid min-h-[520px] w-full max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_470px] lg:px-8">
                    <div className="flex flex-col justify-center">
                        <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-white/70 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 shadow-sm backdrop-blur dark:border-white/15 dark:bg-white/10 dark:text-emerald-200">
                            <span className="material-symbols-outlined text-[16px]">verified</span>
                            Expert-led interview practice
                        </div>
                        <h1 className="max-w-3xl text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
                            Interview with someone who knows what strong signal looks like.
                        </h1>
                        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg dark:text-slate-300">
                            Share two days of availability, get matched to an expert-selected slot, solve in a live peer-grade room, and receive structured feedback after the session.
                        </p>
                        <div className="mt-8 flex flex-wrap gap-3">
                            <button
                                onClick={openBooking}
                                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 text-sm font-black text-white shadow-[0_16px_40px_rgba(16,185,129,0.24)] transition hover:bg-emerald-600 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
                            >
                                <span className="material-symbols-outlined text-[20px]">event_available</span>
                                Book an interview
                            </button>
                            <Link
                                href="/interviews/expert/requests"
                                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white/75 px-5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-white dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                            >
                                <span className="material-symbols-outlined text-[20px]">receipt_long</span>
                                My requests
                            </Link>
                        </div>
                        <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
                            {[
                                ["60 min", "focused live session"],
                                ["1:1", "expert interviewer"],
                                ["Action plan", "structured feedback"],
                            ].map(([metric, copy]) => (
                                <div key={metric} className="rounded-lg border border-slate-200 bg-white/70 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.07]">
                                    <div className="text-xl font-black">{metric}</div>
                                    <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{copy}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center">
                        <div className="relative w-full overflow-hidden rounded-[28px] border border-white bg-white/70 p-3 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-white/[0.08]">
                            <div className="relative aspect-[4/5] overflow-hidden rounded-[20px] bg-[#edf5ff]">
                                <Image
                                    src="/expert_interview_doodle.png"
                                    alt="Expert interview"
                                    fill
                                    priority
                                    sizes="(max-width: 1024px) 100vw, 470px"
                                    className="object-cover object-center"
                                />
                                <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/30 bg-slate-950/78 p-4 text-white shadow-xl backdrop-blur-md">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-200">Next step</p>
                                            <p className="mt-1 text-lg font-black">Submit availability</p>
                                        </div>
                                        <div className="flex size-11 items-center justify-center rounded-full bg-emerald-400 text-slate-950">
                                            <span className="material-symbols-outlined">arrow_forward</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-3 lg:px-8">
                {[
                    ["track_changes", "Calibrated practice", "Pick goals and topics so the session is centered on your next real interview."],
                    ["schedule", "Expert picks exact time", "You provide windows; the expert chooses the exact start time that works for both sides."],
                    ["rate_review", "Feedback that travels", "You leave with signal on problem solving, communication, depth, and what to fix next."],
                ].map(([icon, title, copy]) => (
                    <article key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-slate-950 text-emerald-300 dark:bg-white dark:text-emerald-700">
                            <span className="material-symbols-outlined">{icon}</span>
                        </div>
                        <h2 className="text-lg font-black">{title}</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{copy}</p>
                    </article>
                ))}
            </section>

            {!sessionsLoading && (upcomingSessions.length > 0 || previousSessions.length > 0) && (
                <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
                    {upcomingSessions.length > 0 && (
                        <SessionList title="Upcoming interviews" sessions={upcomingSessions} />
                    )}
                    {previousSessions.length > 0 && (
                        <div className={upcomingSessions.length > 0 ? "mt-8" : undefined}>
                            <SessionList title="Previous interviews" sessions={previousSessions} previous />
                        </div>
                    )}
                </section>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-3 py-5 backdrop-blur-md sm:items-center">
                    <form
                        onSubmit={submitBooking}
                        className="relative flex h-auto max-h-none w-full max-w-5xl flex-col overflow-visible rounded-[28px] border border-white/80 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface sm:max-h-[92vh] sm:overflow-hidden"
                    >
                        <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#ffffff,#eefdf6)] p-5 text-slate-950 dark:border-lc-border dark:bg-[#10141f] dark:text-white">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">Book expert interview</p>
                                    <h2 className="mt-1 text-2xl font-black">Build your request</h2>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
                                    className="inline-flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                                    aria-label="Close booking"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                            <div className="mt-5 grid gap-2 sm:grid-cols-3">
                                {steps.map((label, index) => (
                                    <button
                                        key={label}
                                        type="button"
                                        onClick={() => setStep(index as 0 | 1 | 2)}
                                        className={`h-11 rounded-lg text-sm font-black transition ${
                                            step === index
                                                ? "bg-emerald-500 text-white dark:bg-emerald-400 dark:text-slate-950"
                                                : "border border-slate-200 bg-white/70 text-slate-600 hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-white/75 dark:hover:bg-white/15"
                                        }`}
                                    >
                                        {index + 1}. {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="custom-scrollbar grid min-h-0 flex-1 gap-0 overflow-visible sm:overflow-y-auto lg:grid-cols-[minmax(0,1fr)_330px]">
                            <section className="p-5 sm:p-7">
                                {notice && (
                                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
                                        <div className="flex items-start gap-3">
                                            <span className="material-symbols-outlined text-2xl">check_circle</span>
                                            <div>
                                                <h3 className="font-black">Request sent</h3>
                                                <p className="mt-1 text-sm font-medium">{notice} You will see the exact scheduled interview here after an expert claims a time.</p>
                                                <Link href="/interviews/expert/requests" className="mt-3 inline-flex text-sm font-black underline">
                                                    Track request status
                                                </Link>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {error && <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>}

                                {step === 0 && (
                                    <div>
                                        <h3 className="text-2xl font-black text-slate-950 dark:text-white">Session goals</h3>
                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Choose the kind of signal you want the expert to test.</p>
                                        <div className="mt-6 grid gap-3 md:grid-cols-3">
                                            {formats.map((format) => (
                                                <button
                                                    key={format.value}
                                                    type="button"
                                                    onClick={() => setInterviewType(format.value)}
                                                    className={`rounded-2xl border p-5 text-left transition ${
                                                        interviewType === format.value
                                                            ? "border-emerald-300 bg-emerald-50 text-emerald-900 shadow-sm"
                                                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-bg dark:text-slate-200"
                                                    }`}
                                                >
                                                    <span className="material-symbols-outlined text-[26px]">{format.icon}</span>
                                                    <div className="mt-3 font-black">{format.label}</div>
                                                    <p className="mt-2 text-xs leading-5 text-slate-500">{format.copy}</p>
                                                </button>
                                            ))}
                                        </div>
                                        <div className="mt-6 grid gap-5 md:grid-cols-2">
                                            <label className="text-sm font-bold text-slate-700 dark:text-slate-200">
                                                Language
                                                <select value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-lc-border dark:bg-lc-bg">
                                                    {languages.map((language) => <option key={language} value={language}>{language}</option>)}
                                                </select>
                                            </label>
                                            <div>
                                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Level</p>
                                                <div className="mt-2 grid grid-cols-3 gap-2">
                                                    {levels.map((item) => (
                                                        <button key={item} type="button" onClick={() => setLevel(item)} className={`h-12 rounded-xl border text-sm font-black capitalize ${level === item ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-lc-border"}`}>
                                                            {item}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-6">
                                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Focus areas</p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {topics.map((topic) => (
                                                    <button key={topic} type="button" onClick={() => toggleTopic(topic)} className={`rounded-full border px-4 py-2 text-sm font-bold transition ${selectedTopics.includes(topic) ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-bg"}`}>
                                                        {topic}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <label className="mt-6 block text-sm font-bold text-slate-700 dark:text-slate-200">
                                            Context for the expert
                                            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} placeholder="Target company, interview date, weak areas, or anything the expert should know." className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-lc-border dark:bg-lc-bg" />
                                        </label>
                                    </div>
                                )}

                                {step === 1 && (
                                    <div>
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <h3 className="text-2xl font-black text-slate-950 dark:text-white">Availability</h3>
                                                <p className="mt-2 text-sm text-slate-500">Add windows across two days that can fit a 60-minute session.</p>
                                            </div>
                                            <button type="button" onClick={() => setSlots((current) => [...current, { startAt: "", endAt: "" }])} disabled={slots.length >= 6} className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-lc-border">
                                                <span className="material-symbols-outlined text-[18px]">add</span>
                                                Add
                                            </button>
                                        </div>
                                        <div className="mt-6 grid gap-4 md:grid-cols-2">
                                            {slots.map((slot, index) => (
                                                <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-lc-border dark:bg-lc-bg">
                                                    <div className="mb-4 flex items-center justify-between">
                                                        <span className="text-sm font-black text-slate-800 dark:text-white">Window {index + 1}</span>
                                                        {slots.length > 2 && <button type="button" onClick={() => setSlots((current) => current.filter((_, i) => i !== index))} className="text-slate-400 hover:text-rose-600"><span className="material-symbols-outlined text-[20px]">close</span></button>}
                                                    </div>
                                                    <div className="grid gap-3">
                                                        <label className="block text-xs font-black uppercase tracking-wide text-slate-500">
                                                            Start
                                                            <input required type="datetime-local" value={slot.startAt} onChange={(event) => setSlot(index, "startAt", event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm normal-case tracking-normal dark:border-lc-border dark:bg-lc-surface" />
                                                        </label>
                                                        <label className="block text-xs font-black uppercase tracking-wide text-slate-500">
                                                            End
                                                            <input required type="datetime-local" value={slot.endAt} onChange={(event) => setSlot(index, "endAt", event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm normal-case tracking-normal dark:border-lc-border dark:bg-lc-surface" />
                                                        </label>
                                                    </div>
                                                    {slotErrors[index] && <p className="mt-3 text-xs font-bold text-rose-600">{slotErrors[index]}</p>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {step === 2 && (
                                    <div>
                                        <h3 className="text-2xl font-black text-slate-950 dark:text-white">Review request</h3>
                                        <p className="mt-2 text-sm text-slate-500">Experts will choose an exact start time inside one of these windows.</p>
                                        <div className="mt-6 space-y-4">
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700 dark:border-lc-border dark:bg-lc-bg dark:text-slate-200">
                                                {interviewType.replace("_", " ")} · {level} · {preferredLanguage}
                                            </div>
                                            <div className="flex flex-wrap gap-2">{selectedTopics.map((topic) => <span key={topic} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">{topic}</span>)}</div>
                                            <div className="grid gap-3">
                                                {slots.map((slot, index) => (
                                                    <div key={index} className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-600 dark:border-lc-border dark:text-slate-300">
                                                        {formatSlot(slot.startAt)} - {slot.endAt ? new Date(slot.endAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "Not set"}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </section>

                            <aside className="border-t border-slate-200 bg-slate-50 p-5 dark:border-lc-border dark:bg-lc-bg lg:border-l lg:border-t-0">
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Booking summary</p>
                                <h3 className="mt-2 text-xl font-black text-slate-950 dark:text-white">{interviewType.replace("_", " ")} interview</h3>
                                <div className="mt-5 space-y-3 text-sm">
                                    <div className="flex justify-between gap-4"><span className="text-slate-500">Level</span><span className="font-black capitalize">{level}</span></div>
                                    <div className="flex justify-between gap-4"><span className="text-slate-500">Language</span><span className="font-black">{preferredLanguage}</span></div>
                                    <div className="flex justify-between gap-4"><span className="text-slate-500">Timezone</span><span className="text-right font-black">{timezone}</span></div>
                                </div>
                                <div className="mt-5 space-y-2">
                                    {slots.map((slot, index) => (
                                        <div key={index} className="rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-600 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300">
                                            {formatSlot(slot.startAt)} - {slot.endAt ? new Date(slot.endAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "Not set"}
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-6 flex gap-2">
                                    {step > 0 && (
                                        <button type="button" onClick={() => setStep((step - 1) as 0 | 1 | 2)} className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-200">
                                            Back
                                        </button>
                                    )}
                                    {step < 2 ? (
                                        <button type="button" onClick={() => setStep((step + 1) as 0 | 1 | 2)} disabled={step === 1 && slotErrors.some(Boolean)} className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-slate-950 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                                            Continue
                                        </button>
                                    ) : (
                                        <button disabled={submitting || !token || !canSubmit} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-black text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">
                                            <span className="material-symbols-outlined text-[18px]">event_available</span>
                                            {submitting ? "Sending..." : "Request"}
                                        </button>
                                    )}
                                </div>
                            </aside>
                        </div>
                    </form>
                </div>
            )}
        </main>
    );
}

function SessionList({ title, sessions, previous = false }: { title: string; sessions: ExpertCandidateSession[]; previous?: boolean }) {
    return (
        <section>
            <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-2xl font-black text-slate-950 dark:text-white">{title}</h2>
                <span className="text-sm font-bold text-slate-500">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                {sessions.map((item) => (
                    <Link
                        key={item.id}
                        href={`/interviews/expert/session/${item.id}`}
                        className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:border-lc-border dark:bg-lc-surface"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-sm font-black text-slate-950 dark:text-white">{item.expert.fullName}</div>
                                <p className="mt-1 text-sm text-slate-500">{formatTimeRange(item.scheduledFor, item.endsAt)}</p>
                            </div>
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${statusTone(item.status)}`}>
                                {item.status}
                            </span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-lc-bg dark:text-slate-300">{item.interviewType.replace("_", " ")}</span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-lc-bg dark:text-slate-300">{item.preferredLanguage}</span>
                            {previous && item.feedbackAvailable && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">Feedback ready</span>}
                        </div>
                        <div className="mt-5 inline-flex items-center gap-1 text-sm font-black text-emerald-700 group-hover:gap-2">
                            {previous ? "View recap" : "View details"}
                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                        </div>
                    </Link>
                ))}
            </div>
        </section>
    );
}
