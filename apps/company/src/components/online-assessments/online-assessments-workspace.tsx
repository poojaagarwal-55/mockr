"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError } from "@/lib/api";

type QuestionBankType = "sql" | "dsa" | "cs_fundamentals" | "system_design";

type Question = {
    id: string;
    text: string;
    setId?: string | null;
    setTitle?: string | null;
    type?: QuestionBankType | null;
    questionId?: string;
    difficulty?: string | null;
};

type QuestionGroup = {
    id: string;
    title: string;
    focus?: string;
    isQuestionBank?: boolean;
    questions: Question[];
};

type AssessmentQuestion = Question & {
    timeLimitMinutes: number | string;
    aiInterviewEnabled: boolean;
    orderIndex?: number;
};

type AssessmentSubmission = {
    id: string;
    roundCandidateId: string;
    applicationId: string;
    candidateName: string;
    candidateEmail: string;
    avatarUrl?: string | null;
    status: string;
    score: number | null;
    startedAt?: string | null;
    submittedAt?: string | null;
    evaluatedAt?: string | null;
    report?: {
        id: string;
        overallScore: number;
        aiSummary: string;
        evaluatedAt?: string | null;
    } | null;
};

type OnlineAssessment = {
    id: string;
    roundId: string;
    jobId: string;
    jobTitle: string;
    companyName: string;
    status: "draft" | "scheduled" | "live" | "closed" | string;
    configured: boolean;
    title: string;
    startAt?: string | null;
    endAt?: string | null;
    durationMinutes?: number | null;
    instructions?: string;
    candidateMessage?: string;
    requireSecureBrowser?: boolean;
    shuffleQuestions?: boolean;
    allowLateStart?: boolean;
    questionCount: number;
    totalQuestionMinutes: number;
    aiInterviewQuestionCount: number;
    questions: AssessmentQuestion[];
    candidateCount: number;
    submittedCount: number;
    createdAt?: string | null;
    updatedAt?: string | null;
    submissions: AssessmentSubmission[];
};

type ProctoringSessionSummary = {
    id: string;
    jobRoundCandidateId: string;
    status: "pending" | "active" | "submitted" | "terminated" | "abandoned" | string;
    startedAt?: string | null;
    submittedAt?: string | null;
    terminatedAt?: string | null;
    terminatedReason?: string | null;
    integrityScore?: number | null;
};

type OnlineAssessmentsResponse = {
    assessments: OnlineAssessment[];
    questionSets: QuestionGroup[];
    questionBankGroups: QuestionGroup[];
};

type SetupForm = {
    title: string;
    startAt: string;
    endAt: string;
    durationMinutes: string;
    questionCount: string;
    instructions: string;
    candidateMessage: string;
    requireSecureBrowser: boolean;
    shuffleQuestions: boolean;
    allowLateStart: boolean;
};

type SetupPayload = {
    title: string;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    questionCount: number;
    instructions: string;
    candidateMessage: string;
    requireSecureBrowser: boolean;
    shuffleQuestions: boolean;
    allowLateStart: boolean;
    questions: Array<{ id: string; timeLimitMinutes: number; aiInterviewEnabled: boolean }>;
};

type SetupStep = "schedule" | "questions" | "timing" | "review";

type SavedOnlineAssessmentSetupState = {
    assessmentId: string;
    form: SetupForm;
    selected: Record<string, AssessmentQuestion>;
    selectedOrder: string[];
    activeType: "all" | QuestionBankType;
    search: string;
    step: SetupStep;
    savedAt: number;
};

const setupSteps: Array<{ id: SetupStep; title: string; icon: string; description: string }> = [
    { id: "schedule", title: "Basics", icon: "event", description: "Name, window, duration, and guardrails." },
    { id: "questions", title: "Questions", icon: "library_books", description: "Pick the exact question-bank items." },
    { id: "timing", title: "Timing", icon: "timer", description: "Set time and AI follow-ups per question." },
    { id: "review", title: "Review", icon: "fact_check", description: "Confirm the candidate experience." },
];

const emptyResponse: OnlineAssessmentsResponse = {
    assessments: [],
    questionSets: [],
    questionBankGroups: [],
};

const typeLabels: Record<QuestionBankType, string> = {
    sql: "SQL",
    dsa: "DSA",
    cs_fundamentals: "CS",
    system_design: "System Design",
};

const questionPreviewRoutes: Record<QuestionBankType, string> = {
    sql: "sql",
    dsa: "dsa",
    cs_fundamentals: "cs-fundamentals",
    system_design: "system-design",
};

const onlineAssessmentSetupStateTtlMs = 30 * 60 * 1000;

function onlineAssessmentSetupStateKey(ownerId: string) {
    return `practers:company:online-assessment-setup:${ownerId}`;
}

function questionPreviewHref(question: Question) {
    if (!question.type || !question.questionId) return null;
    return `/companies/question-bank/${questionPreviewRoutes[question.type]}/${encodeURIComponent(question.questionId)}`;
}

function readStoredOnlineAssessmentSetupState(ownerId?: string | null): SavedOnlineAssessmentSetupState | null {
    if (!ownerId || typeof window === "undefined") return null;

    try {
        const raw = window.sessionStorage.getItem(onlineAssessmentSetupStateKey(ownerId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as SavedOnlineAssessmentSetupState;
        if (!parsed.savedAt || Date.now() - parsed.savedAt > onlineAssessmentSetupStateTtlMs) {
            window.sessionStorage.removeItem(onlineAssessmentSetupStateKey(ownerId));
            return null;
        }
        return parsed.assessmentId && parsed.form && parsed.selected ? parsed : null;
    } catch {
        return null;
    }
}

function writeStoredOnlineAssessmentSetupState(ownerId: string | null | undefined, state: SavedOnlineAssessmentSetupState) {
    if (!ownerId || typeof window === "undefined") return;

    try {
        window.sessionStorage.setItem(onlineAssessmentSetupStateKey(ownerId), JSON.stringify(state));
    } catch {
        // This only protects the setup wizard from dev refreshes while previewing.
    }
}

function clearStoredOnlineAssessmentSetupState(ownerId?: string | null) {
    if (!ownerId || typeof window === "undefined") return;

    try {
        window.sessionStorage.removeItem(onlineAssessmentSetupStateKey(ownerId));
    } catch {
        // Ignore storage failures.
    }
}

function formatDateTime(value?: string | null) {
    if (!value) return "Not scheduled";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not scheduled";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function formatLongDateTime(value?: string | null) {
    if (!value) return "Not scheduled";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not scheduled";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}

function toDateTimeLocalValue(date: Date) {
    const pad = (item: number) => String(item).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function currentDateTimeLocal() {
    const now = new Date();
    now.setSeconds(0, 0);
    return toDateTimeLocalValue(now);
}

function toDateTimeLocal(value?: string | null, fallbackOffsetHours = 24, minDate?: Date) {
    const fallback = new Date(Date.now() + fallbackOffsetHours * 60 * 60 * 1000);
    const date = value ? new Date(value) : fallback;
    let safe = Number.isNaN(date.getTime()) ? fallback : date;
    if (minDate && safe.getTime() < minDate.getTime()) safe = minDate;
    return toDateTimeLocalValue(safe);
}

function localDateTimeToIso(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dateTimeLocalFromValue(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : toDateTimeLocalValue(date);
}

function hasDateReached(value?: string | null) {
    const date = value ? new Date(value) : null;
    return Boolean(date && !Number.isNaN(date.getTime()) && date.getTime() <= Date.now());
}

function normalizeScheduleForm(form: SetupForm, lockedStartAt?: string | null): SetupForm {
    const minStart = new Date();
    minStart.setSeconds(0, 0);

    const lockedStart = lockedStartAt ? new Date(lockedStartAt) : null;
    const parsedStart = new Date(form.startAt);
    const safeStart = lockedStart && !Number.isNaN(lockedStart.getTime())
        ? lockedStart
        : Number.isNaN(parsedStart.getTime()) || parsedStart.getTime() < minStart.getTime()
            ? minStart
            : parsedStart;

    const durationMinutes = Math.max(15, asNumber(form.durationMinutes, 120));
    const minEnd = new Date(safeStart.getTime() + durationMinutes * 60_000);
    const parsedEnd = new Date(form.endAt);
    const safeEnd = Number.isNaN(parsedEnd.getTime()) || parsedEnd.getTime() < minEnd.getTime()
        ? minEnd
        : parsedEnd;

    return {
        ...form,
        startAt: toDateTimeLocalValue(safeStart),
        endAt: toDateTimeLocalValue(safeEnd),
    };
}

function durationText(minutes?: number | string | null) {
    const value = Number(minutes || 0);
    if (!value) return "Not set";
    const hours = Math.floor(value / 60);
    const remaining = value % 60;
    if (hours && remaining) return `${hours}h ${remaining}m`;
    if (hours) return `${hours}h`;
    return `${remaining}m`;
}

function distributeMinutes(totalMinutes: number, count: number) {
    if (count <= 0) return [];
    const base = Math.floor(totalMinutes / count);
    const remainder = totalMinutes % count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function statusLabel(value: string) {
    if (value === "draft") return "Needs setup";
    return value.replace(/_/g, " ");
}

function statusClasses(value: string) {
    if (value === "live") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
    if (value === "scheduled") return "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300";
    if (value === "closed") return "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300";
    return "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200";
}

function initials(name: string) {
    return name
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase() || "C";
}

function defaultForm(assessment: OnlineAssessment, lockedStartAt?: string | null): SetupForm {
    const durationMinutes = assessment.durationMinutes || 120;
    const minStart = new Date();
    minStart.setSeconds(0, 0);
    const defaultStart = lockedStartAt
        ? dateTimeLocalFromValue(lockedStartAt) || toDateTimeLocal(assessment.startAt, 24, minStart)
        : toDateTimeLocal(assessment.startAt, 24, minStart);
    const minEnd = new Date(new Date(defaultStart).getTime() + durationMinutes * 60_000);
    const defaultEnd = toDateTimeLocal(assessment.endAt, 72, minEnd);
    const questionCount = assessment.questionCount || Math.max(assessment.questions.length, 2);

    return normalizeScheduleForm({
        title: assessment.configured ? assessment.title : `${assessment.jobTitle} OA`,
        startAt: defaultStart,
        endAt: defaultEnd,
        durationMinutes: String(durationMinutes),
        questionCount: String(questionCount),
        instructions: assessment.instructions || "Use the secure browser. Read each problem carefully, submit your own work, and do not switch away from the assessment.",
        candidateMessage: assessment.candidateMessage || `You have been selected for the online assessment round for ${assessment.jobTitle}.`,
        requireSecureBrowser: assessment.requireSecureBrowser ?? true,
        shuffleQuestions: assessment.shuffleQuestions ?? true,
        allowLateStart: assessment.allowLateStart ?? false,
    }, lockedStartAt);
}

function selectedDefaults(assessment: OnlineAssessment) {
    const selected: Record<string, AssessmentQuestion> = {};
    const order: string[] = [];
    assessment.questions.forEach((question) => {
        if (selected[question.id]) return;
        selected[question.id] = {
            ...question,
            timeLimitMinutes: Number(question.timeLimitMinutes || 30),
            aiInterviewEnabled: Boolean(question.aiInterviewEnabled),
        };
        order.push(question.id);
    });
    return { selected, order };
}

function asNumber(value: string, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function fieldClass() {
    return "mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white";
}

function AssessmentCard({
    assessment,
    onOpen,
    onSetup,
    onSubmissions,
}: {
    assessment: OnlineAssessment;
    onOpen: (assessment: OnlineAssessment) => void;
    onSetup: (assessment: OnlineAssessment) => void;
    onSubmissions: (assessment: OnlineAssessment) => void;
}) {
    return (
        <article
            role="button"
            tabIndex={0}
            onClick={() => onOpen(assessment)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(assessment);
                }
            }}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-surface"
        >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-extrabold capitalize ${statusClasses(assessment.status)}`}>
                            {statusLabel(assessment.status)}
                        </span>
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">
                            {assessment.candidateCount} candidates
                        </span>
                    </div>
                    <h2 className="mt-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{assessment.title}</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{assessment.jobTitle} - {assessment.companyName}</p>
                    <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {assessment.configured
                            ? `${formatDateTime(assessment.startAt)} to ${formatDateTime(assessment.endAt)}`
                            : "Question selection, timing, and secure launch settings are not published yet."}
                    </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[390px]">
                    <span className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-extrabold text-slate-600 dark:bg-lc-elevated dark:text-slate-300">
                        {assessment.questionCount || assessment.questions.length || 0} questions
                    </span>
                    <span className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-extrabold text-slate-600 dark:bg-lc-elevated dark:text-slate-300">
                        {durationText(assessment.durationMinutes)}
                    </span>
                    <span className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-extrabold text-slate-600 dark:bg-lc-elevated dark:text-slate-300">
                        {assessment.submittedCount} submitted
                    </span>
                </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-lc-border">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetup(assessment);
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                >
                    <span className="material-symbols-outlined text-[18px]">{assessment.configured ? "edit_note" : "construction"}</span>
                    {assessment.configured ? "Edit setup" : "Setup OA"}
                </button>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onSubmissions(assessment);
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white"
                >
                    <span className="material-symbols-outlined text-[18px]">folder_managed</span>
                    See submissions
                </button>
            </div>
        </article>
    );
}

function AssessmentDetailModal({
    assessment,
    onClose,
    onSetup,
    onSubmissions,
}: {
    assessment: OnlineAssessment;
    onClose: () => void;
    onSetup: () => void;
    onSubmissions: () => void;
}) {
    return (
        <div className="fixed inset-0 z-[130] bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Online assessment</p>
                        <h2 className="truncate font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{assessment.title}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{assessment.jobTitle} - {assessment.companyName}</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close details">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                        <section className="space-y-5">
                            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Schedule</h3>
                                <div className="mt-4 grid gap-3 md:grid-cols-2">
                                    <Metric label="Starts" value={formatLongDateTime(assessment.startAt)} />
                                    <Metric label="Ends" value={formatLongDateTime(assessment.endAt)} />
                                    <Metric label="Candidate duration" value={durationText(assessment.durationMinutes)} />
                                </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Questions</h3>
                                {assessment.questions.length ? (
                                    <div className="mt-4 divide-y divide-slate-100 dark:divide-lc-border">
                                        {assessment.questions.map((question, index) => (
                                            <div key={`${question.id}-${index}`} className="py-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-extrabold text-slate-950 dark:text-white">{index + 1}. {question.text}</p>
                                                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                                            {question.type ? typeLabels[question.type] : "Question"}{question.difficulty ? ` - ${question.difficulty}` : ""}
                                                        </p>
                                                    </div>
                                                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{durationText(question.timeLimitMinutes)}</span>
                                                        {question.aiInterviewEnabled && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">AI follow-up</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">No questions selected yet.</p>
                                )}
                            </div>
                        </section>

                        <aside className="space-y-4">
                            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Status</p>
                                <p className="mt-2 font-nunito text-2xl font-extrabold capitalize text-slate-950 dark:text-white">{statusLabel(assessment.status)}</p>
                            </div>
                            <Metric label="Submissions" value={`${assessment.submittedCount}/${assessment.candidateCount}`} />
                            <Metric label="AI interview checkpoints" value={String(assessment.aiInterviewQuestionCount)} />
                            <Metric label="Question time" value={durationText(assessment.totalQuestionMinutes)} />
                            <button type="button" onClick={onSetup} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20">
                                <span className="material-symbols-outlined text-[18px]">{assessment.configured ? "edit_note" : "construction"}</span>
                                {assessment.configured ? "Edit setup" : "Setup OA"}
                            </button>
                            <button type="button" onClick={onSubmissions} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-5 text-sm font-extrabold text-primary hover:bg-primary hover:text-white">
                                <span className="material-symbols-outlined text-[18px]">folder_managed</span>
                                See submissions
                            </button>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-lc-border dark:bg-lc-surface">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-extrabold text-slate-950 dark:text-white">{value}</p>
        </div>
    );
}

function proctoringScoreClass(score?: number | null) {
    if (typeof score !== "number") return "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300";
    if (score >= 80) return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
    if (score >= 60) return "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200";
    return "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300";
}

function proctoringReportPath(sessionId: string) {
    if (typeof window === "undefined") return `/oa/proctoring/${sessionId}`;
    const prefix = window.location.pathname.startsWith("/companies") ? "/companies" : "";
    return `${prefix}/oa/proctoring/${sessionId}`;
}

function ProctoringPill({ session, loading }: { session?: ProctoringSessionSummary; loading: boolean }) {
    if (loading) {
        return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-500 dark:bg-lc-hover dark:text-slate-300">Proctoring...</span>;
    }
    if (!session) {
        return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-500 dark:bg-lc-hover dark:text-slate-300">No proctoring</span>;
    }

    const label = session.status === "submitted" && typeof session.integrityScore === "number"
        ? `Integrity ${session.integrityScore}/100`
        : session.status === "active"
            ? "In progress"
            : session.status === "terminated"
                ? "Terminated"
                : session.status === "abandoned"
                    ? "Abandoned"
                    : session.status.replace(/_/g, " ");
    const className = session.status === "active"
        ? "bg-emerald-500 text-white"
        : session.status === "terminated"
            ? "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300"
            : session.status === "abandoned"
                ? "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300"
                : proctoringScoreClass(session.integrityScore);

    return (
        <a
            href={proctoringReportPath(session.id)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-extrabold capitalize transition hover:scale-[1.02] ${className}`}
            onClick={(event) => event.stopPropagation()}
        >
            {session.status === "active" && <span className="size-1.5 animate-pulse rounded-full bg-white" />}
            {label}
        </a>
    );
}

function SubmissionsModal({
    assessment,
    onClose,
}: {
    assessment: OnlineAssessment;
    onClose: () => void;
}) {
    const { session } = useCompanyAuth();
    const token = session?.access_token;
    const [sessions, setSessions] = useState<ProctoringSessionSummary[]>([]);
    const [loadingSessions, setLoadingSessions] = useState(false);

    useEffect(() => {
        if (!token) return;
        let mounted = true;
        setLoadingSessions(true);
        api.get<{ sessions: ProctoringSessionSummary[] }>(`/companies/online-assessments/${assessment.roundId}/sessions`, token)
            .then((payload) => {
                if (mounted) setSessions(payload.sessions || []);
            })
            .catch(() => {
                if (mounted) setSessions([]);
            })
            .finally(() => {
                if (mounted) setLoadingSessions(false);
            });
        return () => {
            mounted = false;
        };
    }, [assessment.roundId, token]);

    const sessionByCandidateId = useMemo(() => {
        return new Map(sessions.map((item) => [item.jobRoundCandidateId, item]));
    }, [sessions]);

    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-lc-border">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">OA submissions</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{assessment.title}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{assessment.submittedCount} OA submission(s)</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close submissions">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {assessment.submissions.length ? (
                        <div className="grid gap-3">
                            {assessment.submissions.map((submission) => {
                                const proctoringSession = sessionByCandidateId.get(submission.roundCandidateId);
                                return (
                                <article key={submission.id} className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div className="flex min-w-0 items-center gap-3">
                                            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-sm font-extrabold text-primary">
                                                {submission.avatarUrl ? <img src={submission.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(submission.candidateName)}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-extrabold text-slate-950 dark:text-white">{submission.candidateName}</span>
                                                <span className="block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{submission.candidateEmail}</span>
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold capitalize text-slate-600 dark:bg-lc-hover dark:text-slate-300">{submission.status.replace(/_/g, " ")}</span>
                                            {submission.score !== null ? (
                                                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">{submission.score}/100</span>
                                            ) : (
                                                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">Pending evaluation</span>
                                            )}
                                            <ProctoringPill session={proctoringSession} loading={loadingSessions} />
                                        </div>
                                    </div>
                                    <div className="mt-4 grid gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400 md:grid-cols-3">
                                        <span>Started: {formatDateTime(submission.startedAt)}</span>
                                        <span>Submitted: {formatDateTime(submission.submittedAt)}</span>
                                        <span>Evaluated: {formatDateTime(submission.evaluatedAt)}</span>
                                    </div>
                                    {submission.report?.aiSummary && (
                                        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{submission.report.aiSummary}</p>
                                    )}
                                </article>
                            );
                            })}
                        </div>
                    ) : (
                        <div className="grid min-h-[260px] place-items-center rounded-lg border border-dashed border-slate-200 text-center dark:border-lc-border">
                            <div>
                                <span className="material-symbols-outlined text-5xl text-slate-300">inbox</span>
                                <h3 className="mt-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">No OA submissions yet</h3>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function SetupAssessmentModal({
    assessment,
    questionGroups,
    initialDraft,
    saving,
    error,
    onClose,
    onDraftChange,
    onSave,
}: {
    assessment: OnlineAssessment;
    questionGroups: QuestionGroup[];
    initialDraft?: SavedOnlineAssessmentSetupState | null;
    saving: boolean;
    error?: string | null;
    onClose: () => void;
    onDraftChange?: (state: SavedOnlineAssessmentSetupState) => void;
    onSave: (payload: SetupPayload) => Promise<void>;
}) {
    const draft = initialDraft?.assessmentId === assessment.id ? initialDraft : null;
    const startLocked = Boolean(assessment.configured && hasDateReached(assessment.startAt));
    const lockedStartAt = startLocked ? assessment.startAt : null;
    const lockedStartLocal = dateTimeLocalFromValue(lockedStartAt);
    const [form, setForm] = useState<SetupForm>(() => normalizeScheduleForm(draft?.form || defaultForm(assessment, lockedStartAt), lockedStartAt));
    const initialSelection = useMemo(() => {
        if (draft?.selected && draft?.selectedOrder) {
            return {
                selected: draft.selected,
                order: Array.from(new Set(draft.selectedOrder)),
            };
        }
        return selectedDefaults(assessment);
    }, [assessment, draft]);
    const [selected, setSelected] = useState<Record<string, AssessmentQuestion>>(initialSelection.selected);
    const [selectedOrder, setSelectedOrder] = useState<string[]>(initialSelection.order);
    const [activeType, setActiveType] = useState<"all" | QuestionBankType>(draft?.activeType || "all");
    const [search, setSearch] = useState(draft?.search || "");
    const [step, setStep] = useState<SetupStep>(draft?.step || "schedule");
    const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
    const [dragOverQuestionId, setDragOverQuestionId] = useState<string | null>(null);
    const questionCount = Math.max(1, asNumber(form.questionCount, 1));
    const durationMinutes = Math.max(15, asNumber(form.durationMinutes, 120));

    useEffect(() => {
        setForm((current) => {
            const normalized = normalizeScheduleForm(current, lockedStartAt);
            return normalized.startAt === current.startAt && normalized.endAt === current.endAt ? current : normalized;
        });
    }, [assessment.id, lockedStartAt]);

    const selectedQuestions = useMemo(() => {
        const seen = new Set<string>();
        const questions: AssessmentQuestion[] = [];
        for (const id of selectedOrder) {
            if (seen.has(id) || !selected[id]) continue;
            seen.add(id);
            questions.push(selected[id]);
        }
        return questions;
    }, [selected, selectedOrder]);
    const selectedMinutes = selectedQuestions.reduce((sum, question) => sum + Number(question.timeLimitMinutes || 0), 0);
    const timeDelta = durationMinutes - selectedMinutes;
    const activeStepIndex = setupSteps.findIndex((item) => item.id === step);
    const allQuestions = useMemo(() => {
        const seen = new Set<string>();
        return questionGroups.flatMap((group) =>
            group.questions.filter((question) => {
                if (seen.has(question.id)) return false;
                seen.add(question.id);
                return true;
            })
        );
    }, [questionGroups]);
    const typeCounts = useMemo(() => {
        return allQuestions.reduce<Record<string, number>>((counts, question) => {
            const type = question.type || "all";
            counts[type] = (counts[type] || 0) + 1;
            return counts;
        }, {});
    }, [allQuestions]);
    const visibleQuestions = useMemo(() => {
        const term = search.trim().toLowerCase();
        return allQuestions.filter((question) => {
            if (activeType !== "all" && question.type !== activeType) return false;
            if (!term) return true;
            return [
                question.text,
                question.setTitle,
                question.difficulty,
                question.type ? typeLabels[question.type] : "",
            ].filter(Boolean).join(" ").toLowerCase().includes(term);
        });
    }, [activeType, allQuestions, search]);
    const minStartLocal = currentDateTimeLocal();
    const startIso = localDateTimeToIso(form.startAt);
    const endIso = localDateTimeToIso(form.endAt);
    const startTime = startIso ? new Date(startIso).getTime() : Number.NaN;
    const endTime = endIso ? new Date(endIso).getTime() : Number.NaN;
    const minStartTime = new Date(minStartLocal).getTime();
    const startAllowed = startLocked ? Boolean(lockedStartLocal && form.startAt === lockedStartLocal) : startTime >= minStartTime;
    const windowMinutes = Number.isFinite(startTime) && Number.isFinite(endTime)
        ? Math.floor((endTime - startTime) / 60_000)
        : 0;
    const scheduleReady = Boolean(
        form.title.trim() &&
        startIso &&
        endIso &&
        Number.isFinite(startTime) &&
        Number.isFinite(endTime) &&
        startAllowed &&
        endTime > startTime &&
        durationMinutes <= windowMinutes
    );
    const questionsReady = selectedQuestions.length === questionCount;
    const timingReady = questionsReady && selectedQuestions.every((question) => Number(question.timeLimitMinutes || 0) > 0) && selectedMinutes === durationMinutes;
    const canSave = scheduleReady && questionsReady && timingReady;
    const currentStepReady = step === "schedule" ? scheduleReady : step === "questions" ? questionsReady : step === "timing" ? timingReady : canSave;

    function update<K extends keyof SetupForm>(key: K, value: SetupForm[K]) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    function toggleQuestion(question: Question) {
        setSelected((current) => {
            if (current[question.id]) {
                const { [question.id]: _removed, ...rest } = current;
                setSelectedOrder((order) => order.filter((id) => id !== question.id));
                return rest;
            }

            if (selectedQuestions.length >= questionCount) return current;
            const currentAllocated = Object.values(current).reduce((sum, item) => sum + Number(item.timeLimitMinutes || 0), 0);
            const isLastQuestion = selectedQuestions.length === questionCount - 1;
            const defaultMinutes = isLastQuestion
                ? Math.max(1, durationMinutes - currentAllocated)
                : Math.max(1, Math.floor(durationMinutes / questionCount));
            setSelectedOrder((order) => order.includes(question.id) ? order : [...order, question.id]);
            return {
                ...current,
                [question.id]: {
                    ...question,
                    timeLimitMinutes: defaultMinutes,
                    aiInterviewEnabled: false,
                },
            };
        });
    }

    function updateSelected(id: string, patch: Partial<AssessmentQuestion>) {
        setSelected((current) => ({
            ...current,
            [id]: {
                ...current[id],
                ...patch,
            },
        }));
    }

    function autoBalanceTimings() {
        const balanced = distributeMinutes(durationMinutes, selectedQuestions.length);
        setSelected((current) => {
            const next = { ...current };
            selectedQuestions.forEach((question, index) => {
                next[question.id] = {
                    ...next[question.id],
                    timeLimitMinutes: balanced[index] || 1,
                };
            });
            return next;
        });
    }

    function moveSelectedQuestion(fromId: string, toId: string) {
        if (fromId === toId) return;

        setSelectedOrder((order) => {
            const next = Array.from(new Set(order)).filter((id) => selected[id]);
            const fromIndex = next.indexOf(fromId);
            const toIndex = next.indexOf(toId);
            if (fromIndex === -1 || toIndex === -1) return order;

            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    }

    function nudgeSelectedQuestion(id: string, direction: -1 | 1) {
        setSelectedOrder((order) => {
            const next = Array.from(new Set(order)).filter((item) => selected[item]);
            const index = next.indexOf(id);
            const target = index + direction;
            if (index === -1 || target < 0 || target >= next.length) return order;
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    }

    const buildDraft = useCallback((): SavedOnlineAssessmentSetupState => ({
        assessmentId: assessment.id,
        form,
        selected,
        selectedOrder: Array.from(new Set(selectedOrder)),
        activeType,
        search,
        step,
        savedAt: Date.now(),
    }), [activeType, assessment.id, form, search, selected, selectedOrder, step]);

    useEffect(() => {
        onDraftChange?.(buildDraft());
    }, [buildDraft, onDraftChange]);

    function previewQuestion(question: Question) {
        const href = questionPreviewHref(question);
        if (!href || typeof window === "undefined") return;

        onDraftChange?.(buildDraft());
        window.open(href, "_blank", "noopener,noreferrer");
    }

    function goNext() {
        if (!currentStepReady) return;
        const next = setupSteps[activeStepIndex + 1];
        if (next) setStep(next.id);
    }

    function goBack() {
        const previous = setupSteps[activeStepIndex - 1];
        if (previous) setStep(previous.id);
    }

    async function submit() {
        if (!canSave || saving) return;
        await onSave({
            title: form.title.trim(),
            startAt: localDateTimeToIso(form.startAt),
            endAt: localDateTimeToIso(form.endAt),
            durationMinutes,
            questionCount,
            instructions: form.instructions,
            candidateMessage: form.candidateMessage,
            requireSecureBrowser: form.requireSecureBrowser,
            shuffleQuestions: form.shuffleQuestions,
            allowLateStart: form.allowLateStart,
            questions: selectedQuestions.map((question) => ({
                id: question.id,
                timeLimitMinutes: Math.max(1, Number(question.timeLimitMinutes || 1)),
                aiInterviewEnabled: Boolean(question.aiInterviewEnabled),
            })),
        });
    }

    return (
        <div className="fixed inset-0 z-[160] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Setup OA</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{assessment.jobTitle}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{assessment.candidateCount} shortlisted candidate(s)</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close OA setup">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
                        <aside className="rounded-lg border border-slate-200 bg-white p-3 dark:border-lc-border dark:bg-lc-surface">
                            {setupSteps.map((item, index) => {
                                const active = item.id === step;
                                const complete = item.id === "schedule" ? scheduleReady : item.id === "questions" ? questionsReady : item.id === "timing" ? timingReady : canSave;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => {
                                            if (index <= activeStepIndex || complete) setStep(item.id);
                                        }}
                                        className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition ${active ? "bg-primary text-white shadow-sm shadow-primary/20" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"}`}
                                    >
                                        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? "bg-white/20 text-white" : complete ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-lc-hover dark:text-slate-300"}`}>
                                            <span className="material-symbols-outlined text-[20px]">{complete && !active ? "check" : item.icon}</span>
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-extrabold">{item.title}</span>
                                            <span className={`mt-1 block text-xs leading-5 ${active ? "text-white/75" : "text-slate-500 dark:text-slate-400"}`}>{item.description}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </aside>

                        <section className="min-h-[560px] rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            {step === "schedule" && (
                                <div className="space-y-5">
                                    <div>
                                        <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Basics and window</h3>
                                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Candidates can start only inside this window, and their session duration must fit inside it.</p>
                                    </div>
                                    <label className="block">
                                        <span className="text-sm font-extrabold text-slate-800 dark:text-white">OA name</span>
                                        <input value={form.title} onChange={(event) => update("title", event.target.value)} className={fieldClass()} />
                                    </label>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-white">Start date</span>
                                            <input
                                                type="datetime-local"
                                                min={minStartLocal}
                                                value={form.startAt}
                                                disabled={startLocked}
                                                onChange={(event) => update("startAt", event.target.value)}
                                                onBlur={() => setForm((current) => normalizeScheduleForm(current, lockedStartAt))}
                                                className={`${fieldClass()} disabled:cursor-not-allowed disabled:opacity-70`}
                                            />
                                            {startLocked && (
                                                <span className="mt-2 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                                                    Start date is locked because this OA has already opened.
                                                </span>
                                            )}
                                        </label>
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-white">End date</span>
                                            <input
                                                type="datetime-local"
                                                min={form.startAt || minStartLocal}
                                                value={form.endAt}
                                                onChange={(event) => update("endAt", event.target.value)}
                                                onBlur={() => setForm((current) => normalizeScheduleForm(current, lockedStartAt))}
                                                className={fieldClass()}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-white">Duration minutes</span>
                                            <input type="number" min={15} max={600} value={form.durationMinutes} onChange={(event) => update("durationMinutes", event.target.value)} className={fieldClass()} />
                                        </label>
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-white">Number of questions</span>
                                            <input type="number" min={1} max={50} value={form.questionCount} onChange={(event) => update("questionCount", event.target.value)} className={fieldClass()} />
                                        </label>
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-3">
                                        <Toggle label="Secure browser required" checked={form.requireSecureBrowser} onChange={(value) => update("requireSecureBrowser", value)} />
                                        <Toggle label="Shuffle questions" checked={form.shuffleQuestions} onChange={(value) => update("shuffleQuestions", value)} />
                                        <Toggle label="Allow late start" checked={form.allowLateStart} onChange={(value) => update("allowLateStart", value)} />
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-white">Candidate message</span>
                                            <textarea value={form.candidateMessage} onChange={(event) => update("candidateMessage", event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white" />
                                        </label>
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-white">Instructions</span>
                                            <textarea value={form.instructions} onChange={(event) => update("instructions", event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white" />
                                        </label>
                                    </div>
                                    {!scheduleReady && (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100">
                                            {startLocked
                                                ? "Start time is locked. The end time must stay after the start time and leave enough room for the OA duration."
                                                : "Start time must be now or later, and the end time must leave enough room for the OA duration."}
                                        </div>
                                    )}
                                </div>
                            )}

                            {step === "questions" && (
                                <div className="space-y-5">
                                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                        <div>
                                            <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Choose questions</h3>
                                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{selectedQuestions.length}/{questionCount} selected from the company question bank.</p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {(["all", "dsa", "sql", "cs_fundamentals", "system_design"] as const).map((type) => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => setActiveType(type)}
                                                    className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-extrabold transition ${activeType === type ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-primary/10 hover:text-primary dark:bg-lc-hover dark:text-slate-300"}`}
                                                >
                                                    {type === "all" ? "All" : typeLabels[type]}
                                                    <span className={`rounded-full px-1.5 ${activeType === type ? "bg-white/20" : "bg-white dark:bg-lc-surface"}`}>
                                                        {type === "all" ? allQuestions.length : typeCounts[type] || 0}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">search</span>
                                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions" className="h-11 w-full rounded-full border border-slate-200 bg-white pl-12 pr-4 text-sm font-semibold text-slate-950 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white" />
                                    </div>
                                    <div className="grid max-h-[500px] gap-3 overflow-y-auto pr-1">
                                        {visibleQuestions.length ? visibleQuestions.map((question) => {
                                            const isSelected = Boolean(selected[question.id]);
                                            const locked = !isSelected && selectedQuestions.length >= questionCount;
                                            const previewHref = questionPreviewHref(question);
                                            return (
                                                <div
                                                    key={question.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-disabled={locked}
                                                    onClick={() => {
                                                        if (!locked) toggleQuestion(question);
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (locked || (event.key !== "Enter" && event.key !== " ")) return;
                                                        event.preventDefault();
                                                        toggleQuestion(question);
                                                    }}
                                                    className={`grid cursor-pointer grid-cols-[28px_1fr_auto] items-start gap-3 rounded-lg border px-4 py-3 text-left transition ${locked ? "cursor-not-allowed opacity-60" : ""} ${isSelected ? "border-primary bg-primary/5" : "border-slate-200 hover:border-primary/40 dark:border-lc-border"}`}
                                                >
                                                    <span className={`mt-1 grid size-5 place-items-center rounded border ${isSelected ? "border-primary bg-primary text-white" : "border-slate-300 text-transparent dark:border-slate-600"}`}>
                                                        <span className="material-symbols-outlined text-[15px]">check</span>
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block line-clamp-2 text-sm font-extrabold text-slate-950 dark:text-white">{question.text}</span>
                                                        <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                                                            {question.type ? typeLabels[question.type] : "Question"}{question.setTitle ? ` - ${question.setTitle}` : ""}
                                                        </span>
                                                    </span>
                                                    <span className="flex shrink-0 items-center gap-2">
                                                        {previewHref && (
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.preventDefault();
                                                                    event.stopPropagation();
                                                                    previewQuestion(question);
                                                                }}
                                                                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/25 px-3 text-xs font-extrabold text-primary hover:border-primary hover:bg-primary/10 dark:border-primary/40 dark:hover:bg-primary/15"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">visibility</span>
                                                                Preview
                                                            </button>
                                                        )}
                                                        {question.difficulty && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{question.difficulty}</span>}
                                                    </span>
                                                </div>
                                            );
                                        }) : (
                                            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">No questions found.</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {step === "timing" && (
                                <div className="space-y-5">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Time and AI follow-ups</h3>
                                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                {durationText(selectedMinutes)} allocated out of {durationText(durationMinutes)}.
                                                {timeDelta > 0 ? ` ${durationText(timeDelta)} remaining.` : timeDelta < 0 ? ` ${durationText(Math.abs(timeDelta))} over.` : " Fully allocated."}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={autoBalanceTimings}
                                            disabled={!selectedQuestions.length}
                                            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-primary/25 px-4 text-sm font-extrabold text-primary hover:border-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary/40 dark:hover:bg-primary/15"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                                            Auto balance
                                        </button>
                                    </div>
                                    <div className="grid gap-3">
                                        {selectedQuestions.length ? selectedQuestions.map((question, index) => (
                                            <div key={`${question.id}-${index}`} className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Question {index + 1}</p>
                                                        <p className="mt-1 line-clamp-2 text-sm font-extrabold text-slate-950 dark:text-white">{question.text}</p>
                                                    </div>
                                                    <button type="button" onClick={() => toggleQuestion(question)} className="grid size-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-400/10" aria-label="Remove question">
                                                        <span className="material-symbols-outlined text-[19px]">close</span>
                                                    </button>
                                                </div>
                                                <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr] md:items-end">
                                                    <label className="block">
                                                        <span className="text-xs font-extrabold text-slate-500 dark:text-slate-400">Time minutes</span>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={240}
                                                            value={question.timeLimitMinutes}
                                                            onChange={(event) => updateSelected(question.id, { timeLimitMinutes: event.target.value })}
                                                            onBlur={(event) => {
                                                                const parsed = Number.parseInt(event.target.value, 10);
                                                                if (!Number.isFinite(parsed) || parsed < 1) {
                                                                    updateSelected(question.id, { timeLimitMinutes: "" });
                                                                    return;
                                                                }
                                                                updateSelected(question.id, { timeLimitMinutes: Math.min(240, parsed) });
                                                            }}
                                                            className={fieldClass()}
                                                        />
                                                    </label>
                                                    <Toggle label="Run AI interview after this question" checked={Boolean(question.aiInterviewEnabled)} onChange={(value) => updateSelected(question.id, { aiInterviewEnabled: value })} />
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">Select questions before setting timings.</div>
                                        )}
                                    </div>
                                    {!timingReady && (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100">
                                            {selectedQuestions.length !== questionCount
                                                ? `Select exactly ${questionCount} question(s).`
                                                : timeDelta > 0
                                                    ? `Allocate the remaining ${durationText(timeDelta)} to the selected questions.`
                                                    : timeDelta < 0
                                                        ? `Reduce question timings by ${durationText(Math.abs(timeDelta))}.`
                                                        : "Question timings must be greater than 0."}
                                        </div>
                                    )}
                                </div>
                            )}

                            {step === "review" && (
                                <div className="space-y-5">
                                    <div>
                                        <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Review OA</h3>
                                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Drag questions into the exact order candidates should receive them.</p>
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-4">
                                        <Metric label="Window" value={`${formatDateTime(startIso)} - ${formatDateTime(endIso)}`} />
                                        <Metric label="Duration" value={durationText(durationMinutes)} />
                                        <Metric label="Questions" value={String(selectedQuestions.length)} />
                                        <Metric label="AI follow-ups" value={String(selectedQuestions.filter((question) => question.aiInterviewEnabled).length)} />
                                    </div>
                                    <div className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                        <p className="text-sm font-extrabold text-slate-950 dark:text-white">{form.title}</p>
                                        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{form.candidateMessage}</p>
                                    </div>
                                    <div className="grid gap-2">
                                        {selectedQuestions.map((question, index) => (
                                            <div
                                                key={question.id}
                                                draggable
                                                onDragStart={(event) => {
                                                    setDraggedQuestionId(question.id);
                                                    event.dataTransfer.effectAllowed = "move";
                                                    event.dataTransfer.setData("text/plain", question.id);
                                                }}
                                                onDragEnter={() => setDragOverQuestionId(question.id)}
                                                onDragOver={(event) => {
                                                    event.preventDefault();
                                                    event.dataTransfer.dropEffect = "move";
                                                    setDragOverQuestionId(question.id);
                                                }}
                                                onDragLeave={() => setDragOverQuestionId((current) => current === question.id ? null : current)}
                                                onDrop={(event) => {
                                                    event.preventDefault();
                                                    const fromId = event.dataTransfer.getData("text/plain") || draggedQuestionId;
                                                    if (fromId) moveSelectedQuestion(fromId, question.id);
                                                    setDraggedQuestionId(null);
                                                    setDragOverQuestionId(null);
                                                }}
                                                onDragEnd={() => {
                                                    setDraggedQuestionId(null);
                                                    setDragOverQuestionId(null);
                                                }}
                                                className={`flex cursor-grab items-center justify-between gap-3 rounded-lg px-4 py-3 transition active:cursor-grabbing ${dragOverQuestionId === question.id && draggedQuestionId !== question.id ? "bg-primary/10 ring-2 ring-primary/40" : "bg-slate-50 dark:bg-lc-elevated"} ${draggedQuestionId === question.id ? "opacity-60" : ""}`}
                                            >
                                                <span className="flex min-w-0 items-center gap-3">
                                                    <span className="material-symbols-outlined shrink-0 text-[20px] text-slate-400">drag_indicator</span>
                                                    <span className="min-w-0 truncate text-sm font-bold text-slate-800 dark:text-white">{index + 1}. {question.text}</span>
                                                </span>
                                                <span className="flex shrink-0 items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => nudgeSelectedQuestion(question.id, -1)}
                                                        disabled={index === 0}
                                                        className="grid size-8 place-items-center rounded-full text-slate-400 hover:bg-white hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-lc-surface"
                                                        aria-label="Move question up"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => nudgeSelectedQuestion(question.id, 1)}
                                                        disabled={index === selectedQuestions.length - 1}
                                                        className="grid size-8 place-items-center rounded-full text-slate-400 hover:bg-white hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-lc-surface"
                                                        aria-label="Move question down"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                                                    </button>
                                                    <span className="text-xs font-extrabold text-slate-500 dark:text-slate-400">{durationText(question.timeLimitMinutes)}{question.aiInterviewEnabled ? " + AI" : ""}</span>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    {(error || !canSave) && (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100">
                                            {error || "Complete the previous steps before publishing."}
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                    <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover">Cancel</button>
                    <div className="flex flex-wrap items-center gap-3">
                        {activeStepIndex > 0 && (
                            <button type="button" onClick={goBack} className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 px-5 text-sm font-extrabold text-slate-600 hover:bg-slate-50 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-hover">
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                Back
                            </button>
                        )}
                        {step !== "review" ? (
                            <button type="button" onClick={goNext} disabled={!currentStepReady} className="inline-flex h-11 min-w-[140px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50">
                                Next
                                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                            </button>
                        ) : (
                            <button type="button" onClick={submit} disabled={!canSave || saving} className="inline-flex h-11 min-w-[180px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50">
                                {saving ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <span className="material-symbols-outlined text-[18px]">save</span>}
                                {saving ? "Saving..." : "Publish OA"}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={`flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition ${checked ? "border-primary bg-primary/5" : "border-slate-200 bg-white hover:border-primary/30 dark:border-lc-border dark:bg-lc-surface"}`}
        >
            <span className="text-sm font-extrabold text-slate-800 dark:text-white">{label}</span>
            <span className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-primary" : "bg-slate-300 dark:bg-slate-700"}`}>
                <span className={`absolute top-1 size-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} />
            </span>
        </button>
    );
}

export function OnlineAssessmentsWorkspace() {
    const { session } = useCompanyAuth();
    const token = session?.access_token;
    const ownerId = session?.user?.id;
    const [data, setData] = useState<OnlineAssessmentsResponse>(emptyResponse);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"all" | "draft" | "scheduled" | "live" | "closed">("all");
    const [detailAssessment, setDetailAssessment] = useState<OnlineAssessment | null>(null);
    const [setupAssessment, setSetupAssessment] = useState<OnlineAssessment | null>(null);
    const [setupDraft, setSetupDraft] = useState<SavedOnlineAssessmentSetupState | null>(null);
    const [submissionsAssessment, setSubmissionsAssessment] = useState<OnlineAssessment | null>(null);
    const [saving, setSaving] = useState(false);
    const [setupError, setSetupError] = useState<string | null>(null);

    const loadAssessments = useCallback(async (showLoading: boolean) => {
        if (!token) {
            setData(emptyResponse);
            setLoading(false);
            return;
        }
        if (showLoading) setLoading(true);
        try {
            const payload = await api.get<OnlineAssessmentsResponse>("/companies/online-assessments", token);
            setData({
                assessments: payload.assessments || [],
                questionSets: payload.questionSets || [],
                questionBankGroups: payload.questionBankGroups || [],
            });
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load online assessments.");
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        void loadAssessments(true);
    }, [loadAssessments]);

    const persistSetupDraft = useCallback((state: SavedOnlineAssessmentSetupState) => {
        setSetupDraft(state);
        writeStoredOnlineAssessmentSetupState(ownerId, state);
    }, [ownerId]);

    const clearSetupDraft = useCallback(() => {
        setSetupDraft(null);
        clearStoredOnlineAssessmentSetupState(ownerId);
    }, [ownerId]);

    useEffect(() => {
        if (!ownerId || loading || setupAssessment) return;
        const savedState = readStoredOnlineAssessmentSetupState(ownerId);
        if (!savedState) return;

        const assessment = data.assessments.find((item) => item.id === savedState.assessmentId);
        if (!assessment) {
            clearStoredOnlineAssessmentSetupState(ownerId);
            return;
        }

        setSetupDraft(savedState);
        setSetupError(null);
        setSetupAssessment(assessment);
    }, [data.assessments, loading, ownerId, setupAssessment]);

    const questionGroups = useMemo(() => [
        ...data.questionSets,
        ...data.questionBankGroups,
    ], [data.questionBankGroups, data.questionSets]);

    const counts = useMemo(() => {
        return data.assessments.reduce<Record<string, number>>((acc, assessment) => {
            acc.all += 1;
            acc[assessment.status] = (acc[assessment.status] || 0) + 1;
            return acc;
        }, { all: 0, draft: 0, scheduled: 0, live: 0, closed: 0 });
    }, [data.assessments]);

    const visibleAssessments = useMemo(() => {
        const list = activeTab === "all"
            ? data.assessments
            : data.assessments.filter((assessment) => assessment.status === activeTab);
        return [...list].sort((first, second) => {
            const firstTime = first.startAt ? new Date(first.startAt).getTime() : Number.MAX_SAFE_INTEGER;
            const secondTime = second.startAt ? new Date(second.startAt).getTime() : Number.MAX_SAFE_INTEGER;
            return firstTime - secondTime;
        });
    }, [activeTab, data.assessments]);

    function replaceAssessment(next: OnlineAssessment) {
        setData((current) => ({
            ...current,
            assessments: current.assessments.map((assessment) => assessment.id === next.id ? next : assessment),
        }));
        setDetailAssessment((current) => current?.id === next.id ? next : current);
        setSubmissionsAssessment((current) => current?.id === next.id ? next : current);
    }

    async function saveSetup(roundId: string, payload: SetupPayload) {
        if (!token || saving) return;
        setSaving(true);
        setSetupError(null);
        try {
            const response = await api.post<{ assessment: OnlineAssessment }>(
                `/companies/online-assessments/${roundId}/setup`,
                payload,
                token
            );
            replaceAssessment(response.assessment);
            setSetupAssessment(null);
            clearSetupDraft();
        } catch (err) {
            setSetupError(err instanceof ApiError ? err.message : "Failed to save OA setup.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-8">
                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">quiz</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Company Workspace</p>
                            <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">Online Assessments</h1>
                        </div>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">Schedule OA rounds, choose exact question-bank problems, control per-question time, and attach AI follow-ups where they add signal.</p>
                </section>

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                        {error}
                    </div>
                )}

                {loading ? (
                    <section className="grid min-h-[320px] place-items-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    </section>
                ) : data.assessments.length === 0 ? (
                    <section className="rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <span className="material-symbols-outlined text-5xl text-slate-400">quiz</span>
                        <h2 className="mt-4 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">No OA rounds yet</h2>
                        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">Move candidates to OA from Jobs or Assessments. The setup card will appear here.</p>
                    </section>
                ) : (
                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                            <div className="flex flex-wrap gap-2">
                                {(["all", "draft", "scheduled", "live", "closed"] as const).map((tab) => (
                                    <button
                                        key={tab}
                                        type="button"
                                        onClick={() => setActiveTab(tab)}
                                        className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-extrabold capitalize transition ${activeTab === tab ? "bg-primary text-white shadow-sm shadow-primary/20" : "bg-slate-100 text-slate-600 hover:text-slate-950 dark:bg-lc-hover dark:text-slate-300 dark:hover:text-white"}`}
                                    >
                                        {tab === "draft" ? "Needs setup" : tab}
                                        <span className={`rounded-full px-2 py-0.5 text-xs ${activeTab === tab ? "bg-white/20 text-white" : "bg-white text-slate-600 dark:bg-lc-surface dark:text-slate-300"}`}>{counts[tab] || 0}</span>
                                    </button>
                                ))}
                            </div>
                            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{questionGroups.reduce((sum, group) => sum + group.questions.length, 0)} question-bank questions available.</p>
                        </div>
                        <div className="mt-5 grid gap-4">
                            {visibleAssessments.length ? visibleAssessments.map((assessment) => (
                                <AssessmentCard
                                    key={assessment.id}
                                    assessment={assessment}
                                    onOpen={setDetailAssessment}
                                    onSetup={(value) => {
                                        setSetupError(null);
                                        clearSetupDraft();
                                        setSetupAssessment(value);
                                    }}
                                    onSubmissions={setSubmissionsAssessment}
                                />
                            )) : (
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm font-semibold text-slate-500 dark:border-lc-border dark:bg-lc-elevated dark:text-slate-400">
                                    No rounds in this view.
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </div>

            {detailAssessment && (
                <AssessmentDetailModal
                    assessment={detailAssessment}
                    onClose={() => setDetailAssessment(null)}
                    onSetup={() => {
                        setSetupError(null);
                        clearSetupDraft();
                        setSetupAssessment(detailAssessment);
                    }}
                    onSubmissions={() => setSubmissionsAssessment(detailAssessment)}
                />
            )}
            {submissionsAssessment && (
                <SubmissionsModal assessment={submissionsAssessment} onClose={() => setSubmissionsAssessment(null)} />
            )}
            {setupAssessment && (
                <SetupAssessmentModal
                    key={setupAssessment.id}
                    assessment={setupAssessment}
                    questionGroups={questionGroups}
                    initialDraft={setupDraft}
                    saving={saving}
                    error={setupError}
                    onClose={() => {
                        setSetupAssessment(null);
                        clearSetupDraft();
                    }}
                    onDraftChange={persistSetupDraft}
                    onSave={(payload) => saveSetup(setupAssessment.roundId, payload)}
                />
            )}
        </main>
    );
}
