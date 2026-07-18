"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError, getApiBaseUrl } from "@/lib/api";

type Question = {
    id: string;
    text: string;
    setId?: string;
    setTitle?: string;
    type?: string | null;
    questionId?: string;
    difficulty?: string | null;
};

type QuestionSet = {
    id: string;
    title: string;
    focus: string;
    isQuestionBank?: boolean;
    questions: Question[];
};

type QuestionBankTypeTab = "sql" | "dsa" | "cs_fundamentals" | "system_design";
type QuestionBankTab = "all" | QuestionBankTypeTab;

const questionBankTabs: Array<{ value: QuestionBankTab; label: string }> = [
    { value: "all", label: "All" },
    { value: "sql", label: "SQL" },
    { value: "dsa", label: "DSA" },
    { value: "cs_fundamentals", label: "CS Fundamentals" },
    { value: "system_design", label: "System Design" },
];

const questionPreviewRoutes: Record<QuestionBankTypeTab, string> = {
    sql: "sql",
    dsa: "dsa",
    cs_fundamentals: "cs-fundamentals",
    system_design: "system-design",
};

function isQuestionBankTab(value?: string | null): value is QuestionBankTypeTab {
    return Boolean(value && value in questionPreviewRoutes);
}

function questionPreviewHref(question: Question) {
    if (!isQuestionBankTab(question.type) || !question.questionId) return null;
    return `/companies/question-bank/${questionPreviewRoutes[question.type]}/${encodeURIComponent(question.questionId)}`;
}

type Interviewer = {
    id: string;
    memberId?: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    role: "admin" | "member" | string;
    teamId?: string | null;
    teamName?: string | null;
};

type DirectMessage = {
    id: string;
    clientMessageId?: string | null;
    senderType: "company" | "candidate";
    senderId: string;
    senderName: string;
    content: string;
    createdAt: string;
    readByCompanyAt?: string | null;
    readByCandidateAt?: string | null;
    pending?: boolean;
    failed?: boolean;
};

type CandidateProfile = {
    profileLanguage?: string | null;
    pronouns?: string | null;
    headline?: string | null;
    industry?: string | null;
    city?: string | null;
    country?: string | null;
    postalCode?: string | null;
    location?: string | null;
    about?: string | null;
    openTo?: string | null;
    coverImageUrl?: string | null;
    selectedResumeId?: string | null;
    leetcodeUrl?: string | null;
    geeksforgeeksUrl?: string | null;
    codeforcesUrl?: string | null;
    codechefUrl?: string | null;
    skills?: Array<string | { id?: string; name?: string; context?: string | null }>;
    featured?: Array<Record<string, any>>;
    experiences?: Array<Record<string, any>>;
    education?: Array<Record<string, any>>;
    projects?: Array<Record<string, any>>;
    isPublished?: boolean;
} | null;

type JourneyRound = {
    id: string;
    roundNumber?: number | null;
    roundType: string;
    title: string;
    status: string;
    advanced: boolean;
    score: number;
    submittedAt?: string | null;
    evaluatedAt?: string | null;
    advancedAt?: string | null;
    report?: {
        id?: string;
        roundType?: string;
        overallScore?: number;
        aiSummary?: string;
        recommendation?: string;
        strengths?: string[];
        risks?: string[];
        detail?: Record<string, any>;
        evidenceSnapshot?: Record<string, any>;
        rubricBreakdown?: Record<string, any> | Array<Record<string, any>> | null;
        evaluatedAt?: string | null;
    } | null;
    submissions?: Array<{
        id: string;
        title: string;
        status: string;
        score: number;
        repoUrl: string;
        submittedAt?: string | null;
        report?: Record<string, any>;
    }>;
};

type JourneySubmission = NonNullable<JourneyRound["submissions"]>[number];

type DirectCandidate = {
    id: string;
    roundId: string;
    applicationId: string;
    userId: string;
    status: string;
    sourceStatus?: string;
    score: number;
    selectedAt?: string | null;
    selectedFrom?: string;
    unreadMessageCount: number;
    lastMessageAt?: string | null;
    messages?: DirectMessage[];
    detailsLoaded?: boolean;
    schedule?: {
        scheduledAt?: string;
        timezone?: string;
        durationMinutes?: number;
        mode?: "video" | "phone" | "onsite";
        meetingLink?: string | null;
        location?: string | null;
        notes?: string | null;
    } | null;
    interviewer?: Interviewer | null;
    questionSelection?: {
        setIds?: string[];
        questions?: Question[];
        notes?: string | null;
    } | null;
    candidate: {
        name: string;
        email: string;
        avatarUrl?: string | null;
        username?: string | null;
        location?: string | null;
        website?: string | null;
        githubUrl?: string | null;
        linkedinUrl?: string | null;
        profileUrl?: string | null;
    };
    profile: CandidateProfile;
    journey: JourneyRound[];
    latestReport?: JourneyRound["report"] | null;
};

type DirectJob = {
    id: string;
    title: string;
    companyName: string;
    companyLogoUrl?: string | null;
    location: string;
    status: string;
    workMode?: string | null;
    employmentType?: string | null;
    roleType?: string | null;
    profession?: string | null;
    discipline?: string | null;
    travel?: string | null;
    openings?: number | null;
    experienceLevel?: string | null;
    compensationType?: string | null;
    compensation?: string | null;
    duration?: string | null;
    timeCommitment?: string | null;
    applicationDeadline?: string | null;
    skills?: string[];
    companyOverview?: string | null;
    aboutRole?: string | null;
    responsibilities?: string[];
    requirements?: string[];
    benefits?: string[];
    applicationNote?: string | null;
    roundCount: number;
    candidateCount: number;
    scheduledCount: number;
    unreadMessageCount: number;
    rounds: Array<{ id: string; title: string; roundNumber: number; status: string; candidateCount: number }>;
    candidates: DirectCandidate[];
};

type DirectInterviewsResponse = {
    jobs: DirectJob[];
    interviewers: Interviewer[];
    questionSets: QuestionSet[];
    questionBankGroups: QuestionSet[];
};

type CandidateAction = "actions" | "schedule" | "interviewer" | "chat" | "profile" | "journey" | "start";
const restrictedCandidateActions = new Set<CandidateAction>(["schedule", "interviewer", "start"]);
const directInterviewAccessMessage = "You don't have access to it. Reach out to your company owner or admin.";

const emptyResponse: DirectInterviewsResponse = {
    jobs: [],
    interviewers: [],
    questionSets: [],
    questionBankGroups: [],
};

let directInterviewsPageCache: DirectInterviewsResponse | null = null;
let directInterviewsPageCacheOwnerId: string | null = null;
const directInterviewsCacheTtlMs = 5 * 60 * 1000;

function directInterviewsStorageKey(ownerId: string) {
    return `practers.company.direct-interviews.${ownerId}.v5`;
}

function directInterviewsUiStateKey(ownerId: string) {
    return `practers.company.direct-interviews.ui.${ownerId}.v1`;
}

type SavedDirectInterviewUiState = {
    candidateJobId: string;
    activeCandidateId: string;
    candidateAction: CandidateAction;
    candidateActionBackTarget: "list" | "actions";
    interviewerForm?: {
        interviewerMemberId: string;
        questionIds: string[];
        notes: string;
    };
};

function readStoredDirectInterviewsData(ownerId?: string | null) {
    if (!ownerId || typeof window === "undefined") return null;

    try {
        const raw = window.sessionStorage.getItem(directInterviewsStorageKey(ownerId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { cachedAt?: number; data?: DirectInterviewsResponse };
        if (!parsed.cachedAt || Date.now() - parsed.cachedAt > directInterviewsCacheTtlMs) {
            window.sessionStorage.removeItem(directInterviewsStorageKey(ownerId));
            return null;
        }
        return parsed.data
            ? {
                ...emptyResponse,
                ...parsed.data,
                jobs: parsed.data.jobs || [],
                interviewers: parsed.data.interviewers || [],
                questionSets: parsed.data.questionSets || [],
                questionBankGroups: parsed.data.questionBankGroups || [],
            }
            : null;
    } catch {
        return null;
    }
}

function readStoredDirectInterviewsUiState(ownerId?: string | null): SavedDirectInterviewUiState | null {
    if (!ownerId || typeof window === "undefined") return null;

    try {
        const raw = window.sessionStorage.getItem(directInterviewsUiStateKey(ownerId));
        if (!raw) return null;
        return JSON.parse(raw) as SavedDirectInterviewUiState;
    } catch {
        return null;
    }
}

function writeStoredDirectInterviewsUiState(ownerId: string | null | undefined, state: SavedDirectInterviewUiState) {
    if (!ownerId || typeof window === "undefined") return;

    try {
        window.sessionStorage.setItem(directInterviewsUiStateKey(ownerId), JSON.stringify(state));
    } catch {
        // UI state persistence is only a guard against dev refreshes while previewing questions.
    }
}

function clearStoredDirectInterviewsUiState(ownerId?: string | null) {
    if (!ownerId || typeof window === "undefined") return;

    try {
        window.sessionStorage.removeItem(directInterviewsUiStateKey(ownerId));
    } catch {
        // Ignore storage failures.
    }
}

function writeStoredDirectInterviewsData(next: DirectInterviewsResponse, ownerId?: string | null) {
    if (!ownerId || typeof window === "undefined") return;

    try {
        window.sessionStorage.setItem(
            directInterviewsStorageKey(ownerId),
            JSON.stringify({ cachedAt: Date.now(), data: next })
        );
    } catch {
        // Session cache is only a speed-up; the network response remains the source of truth.
    }
}

function hasBrokenCandidateIdentity(data?: DirectInterviewsResponse | null) {
    return Boolean(data?.jobs.some((job) =>
        job.candidates.some((candidate) =>
            candidate.profile &&
            candidate.candidate.name === "Candidate" &&
            !candidate.candidate.email
        )
    ));
}

function hasStaleDirectInterviewsData(data?: DirectInterviewsResponse | null) {
    return Boolean(
        hasBrokenCandidateIdentity(data) ||
        data?.jobs.some((job) => typeof job.aboutRole === "undefined")
    );
}

function directInterviewsCacheForOwner(ownerId?: string | null) {
    if (!ownerId) return null;
    if (directInterviewsPageCacheOwnerId === ownerId && directInterviewsPageCache) {
        if (!hasStaleDirectInterviewsData(directInterviewsPageCache)) return directInterviewsPageCache;
        directInterviewsPageCache = null;
        directInterviewsPageCacheOwnerId = null;
    }

    const stored = readStoredDirectInterviewsData(ownerId);
    if (!stored) return null;
    if (hasStaleDirectInterviewsData(stored)) return null;

    directInterviewsPageCache = stored;
    directInterviewsPageCacheOwnerId = ownerId;
    return stored;
}

function rememberDirectInterviewsData(next: DirectInterviewsResponse, ownerId?: string | null) {
    directInterviewsPageCache = next;
    directInterviewsPageCacheOwnerId = ownerId || directInterviewsPageCacheOwnerId;
    writeStoredDirectInterviewsData(next, ownerId || directInterviewsPageCacheOwnerId);
    return next;
}

function withCachedResources(next: DirectInterviewsResponse, fallback?: DirectInterviewsResponse | null) {
    const cached = fallback;
    return {
        ...next,
        interviewers: next.interviewers.length ? next.interviewers : cached?.interviewers || [],
        questionSets: next.questionSets.length ? next.questionSets : cached?.questionSets || [],
        questionBankGroups: next.questionBankGroups?.length ? next.questionBankGroups : cached?.questionBankGroups || [],
    };
}

function usefulCandidateIdentity(candidate?: DirectCandidate["candidate"] | null) {
    if (!candidate) return false;
    return Boolean(
        candidate.email ||
        candidate.username ||
        candidate.avatarUrl ||
        (candidate.name && candidate.name !== "Candidate")
    );
}

function mergeCandidateIdentity(
    current: DirectCandidate["candidate"],
    incoming?: DirectCandidate["candidate"] | null
) {
    if (!incoming) return current;
    if (!usefulCandidateIdentity(incoming) && usefulCandidateIdentity(current)) return current;

    return {
        ...current,
        ...incoming,
        name: incoming.name && incoming.name !== "Candidate" ? incoming.name : current.name || incoming.name || "Candidate",
        email: incoming.email || current.email || "",
        avatarUrl: incoming.avatarUrl || current.avatarUrl || null,
        username: incoming.username || current.username || null,
        location: incoming.location || current.location || null,
        website: incoming.website || current.website || null,
        githubUrl: incoming.githubUrl || current.githubUrl || null,
        linkedinUrl: incoming.linkedinUrl || current.linkedinUrl || null,
        profileUrl: incoming.profileUrl || current.profileUrl || null,
    };
}

function mergeDirectCandidate(current: DirectCandidate, patch: Partial<DirectCandidate>) {
    return {
        ...current,
        ...patch,
        candidate: mergeCandidateIdentity(current.candidate, patch.candidate),
    };
}

const DEFAULT_COVER = "linear-gradient(120deg, #2563eb 0%, #14b8a6 42%, #facc15 100%)";

const CODING_PROFILE_ITEMS = [
    { key: "leetcodeUrl", label: "LeetCode" },
    { key: "geeksforgeeksUrl", label: "GeeksForGeeks" },
    { key: "codeforcesUrl", label: "Codeforces" },
    { key: "codechefUrl", label: "CodeChef" },
] as const;

function formatDate(value?: string | null) {
    if (!value) return "Not set";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(value));
}

function formatLongDate(value?: string | null) {
    if (!value) return "Not available";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

function toDateTimeLocal(value?: string | null) {
    const date = value ? new Date(value) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pad = (item: number) => String(item).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusCopy(value?: string | null) {
    const normalized = (value || "selected").replace(/_/g, " ");
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function statusClasses(value?: string | null) {
    if (value === "scheduled") return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20";
    if (value === "completed") return "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/20";
    if (value === "cancelled") return "bg-red-50 text-red-700 ring-red-200 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/20";
    return "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-lc-hover dark:text-slate-200 dark:ring-lc-border";
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

function normalizeSkill(skill: string | { name?: string }) {
    return typeof skill === "string" ? skill : skill.name || "";
}

function skillKey(skill: string | { id?: string; name?: string }, index: number) {
    if (typeof skill === "string") return `${skill}-${index}`;
    return skill.id || `${skill.name || "skill"}-${index}`;
}

function monthRange(start?: string | null, end?: string | null) {
    if (!start && !end) return "";
    if (!start) return end || "";
    return `${start}${end ? ` - ${end}` : " - Present"}`;
}

function profileLocation(profile: NonNullable<CandidateProfile>, candidate: DirectCandidate) {
    return [profile.city, profile.country].filter(Boolean).join(", ") || profile.location || candidate.candidate.location || "";
}

function codingProfileCount(profile: NonNullable<CandidateProfile>) {
    return CODING_PROFILE_ITEMS.filter((item) => String(profile[item.key] || "").trim()).length;
}

function profileExternalUrl(url?: string | null) {
    const value = String(url || "").trim();
    if (!value) return "";
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function displayUrlLabel(url?: string | null) {
    const value = String(url || "").trim();
    if (!value) return "";
    try {
        const parsed = new URL(profileExternalUrl(value));
        return parsed.hostname.replace(/^www\./, "");
    } catch {
        return value.replace(/^https?:\/\//i, "");
    }
}

function asPlainRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function reportValueText(value: unknown) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const label = record.label || record.name || record.platform || record.title || record.domainOrResponsibility;
        const score = record.score ?? record.value ?? record.coverage;
        const reason = record.reason || record.evidence || record.note || record.summary || record.description;
        return [label, score != null ? `${score}/100` : "", reason].filter(Boolean).join(" - ");
    }
    return String(value).trim();
}

function reportTextArray(value: unknown, limit = 6) {
    if (!Array.isArray(value)) return [];
    return value.map(reportValueText).filter(Boolean).slice(0, limit);
}

function reportScore(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
}

function reportOptionalScore(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : undefined;
}

function reportRows(value: unknown): Array<{ label: string; score: number; weight?: number; note?: string }> {
    if (Array.isArray(value)) {
        return value
            .map((row, index) => {
                const record = asPlainRecord(row);
                return {
                    label: String(record.label || record.name || record.title || `Criterion ${index + 1}`),
                    score: reportScore(record.score ?? record.value),
                    weight: Number(record.weight || 0) || undefined,
                    note: String(record.note || record.reason || record.summary || ""),
                };
            })
            .filter((row) => row.label);
    }

    const record = asPlainRecord(value);
    return Object.entries(record)
        .map(([key, item]) => {
            const row = asPlainRecord(item);
            return {
                label: String(row.label || key),
                score: reportScore(row.score ?? row.value ?? item),
                weight: Number(row.weight || 0) || undefined,
                note: String(row.note || row.reason || row.summary || ""),
            };
        })
        .filter((row) => row.label);
}

function makeClientMessageId() {
    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isOptimisticMessage(message: DirectMessage) {
    return Boolean(message.pending || message.id.startsWith("optimistic-"));
}

function messagesLookSame(first: DirectMessage, second: DirectMessage) {
    if (first.clientMessageId && second.clientMessageId && first.clientMessageId === second.clientMessageId) return true;
    if (first.senderType !== second.senderType || first.content !== second.content) return false;

    const firstTime = new Date(first.createdAt).getTime();
    const secondTime = new Date(second.createdAt).getTime();
    return Number.isFinite(firstTime) && Number.isFinite(secondTime) && Math.abs(firstTime - secondTime) < 30_000;
}

function sortMessages(messages: DirectMessage[]) {
    return [...messages].sort((first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime());
}

function mergeIncomingMessage(current: DirectMessage[], incoming: DirectMessage) {
    const existingIndex = current.findIndex((message) =>
        message.id === incoming.id ||
        (incoming.clientMessageId && message.clientMessageId === incoming.clientMessageId) ||
        (isOptimisticMessage(message) && messagesLookSame(message, incoming))
    );

    if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = { ...incoming, pending: false, failed: false };
        return sortMessages(next);
    }

    return sortMessages([...current, incoming]);
}

function mergeServerMessages(current: DirectMessage[], serverMessages: DirectMessage[]) {
    const merged = [...serverMessages];
    for (const message of current) {
        if (!isOptimisticMessage(message)) continue;
        if (!merged.some((serverMessage) => messagesLookSame(message, serverMessage))) {
            merged.push(message);
        }
    }

    return sortMessages(merged);
}

function unreadForCompany(messages: DirectMessage[]) {
    return messages.filter((message) => message.senderType === "candidate" && !message.readByCompanyAt).length;
}

function recomputeJob(job: DirectJob): DirectJob {
    return {
        ...job,
        candidateCount: job.candidates.length,
        scheduledCount: job.candidates.filter((candidate) => candidate.schedule?.scheduledAt).length,
        unreadMessageCount: job.candidates.reduce((sum, candidate) => sum + candidate.unreadMessageCount, 0),
    };
}

function isCompleteSet(set: QuestionSet, selectedIds: string[]) {
    return set.questions.every((question) => selectedIds.includes(question.id));
}

export function DirectInterviewsWorkspace() {
    const { session, company } = useCompanyAuth();
    const canManageDirectInterviews = company?.role === "owner" || company?.role === "admin";
    const canUseDirectInterviewChat = canManageDirectInterviews || company?.role === "member";
    const ownerCache = directInterviewsCacheForOwner(session?.user?.id);
    const [data, setData] = useState<DirectInterviewsResponse>(() => ownerCache || emptyResponse);
    const [loading, setLoading] = useState(() => !ownerCache);
    const [error, setError] = useState<string | null>(null);
    const [accessNotice, setAccessNotice] = useState<string | null>(null);
    const [jobDetailsId, setJobDetailsId] = useState<string | null>(null);
    const [candidateJobId, setCandidateJobId] = useState<string | null>(null);
    const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
    const [candidateAction, setCandidateAction] = useState<CandidateAction | null>(null);
    const [candidateActionBackTarget, setCandidateActionBackTarget] = useState<"list" | "actions">("list");
    const [scheduleForm, setScheduleForm] = useState({
        scheduledAt: toDateTimeLocal(),
        timezone: "Asia/Kolkata",
        durationMinutes: "45",
        mode: "video",
        meetingLink: "",
        location: "",
        notes: "",
    });
    const [interviewerForm, setInterviewerForm] = useState({
        interviewerMemberId: "",
        questionIds: [] as string[],
        notes: "",
    });
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [savingInterviewer, setSavingInterviewer] = useState(false);
    const [chatMessages, setChatMessages] = useState<DirectMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatError, setChatError] = useState<string | null>(null);
    const [chatLoading, setChatLoading] = useState(false);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [hydratingCandidateIds, setHydratingCandidateIds] = useState<Set<string>>(() => new Set());
    const [resourcesLoading, setResourcesLoading] = useState(false);
    const [resourcesError, setResourcesError] = useState<string | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const hydratedCandidateIdsRef = useRef<Set<string>>(new Set());
    const hydratingCandidateIdsRef = useRef<Set<string>>(new Set());
    const resourcesLoadedRef = useRef(Boolean(ownerCache?.interviewers.length || ownerCache?.questionSets.length || ownerCache?.questionBankGroups?.length));
    const resourcesLoadingRef = useRef(false);

    const selectedJobDetails = useMemo(() => data.jobs.find((job) => job.id === jobDetailsId) || null, [data.jobs, jobDetailsId]);
    const candidateJob = useMemo(() => data.jobs.find((job) => job.id === candidateJobId) || null, [data.jobs, candidateJobId]);
    const activeCandidate = useMemo(() => {
        return candidateJob?.candidates.find((candidate) => candidate.id === activeCandidateId) || null;
    }, [candidateJob, activeCandidateId]);
    const activeQuestionIdsKey = activeCandidate?.questionSelection?.questions?.map((question) => question.id).join("|") || "";
    const activeInterviewerId = activeCandidate?.interviewer?.memberId || activeCandidate?.interviewer?.id || "";
    const needsCandidateContext = Boolean(
        activeCandidate &&
        candidateAction &&
        ["actions", "profile", "journey"].includes(candidateAction) &&
        !activeCandidate.detailsLoaded
    );
    const candidateContextLoading = Boolean(
        activeCandidate &&
        (needsCandidateContext || hydratingCandidateIds.has(activeCandidate.id))
    );
    const stats = useMemo(() => {
        const candidates = data.jobs.flatMap((job) => job.candidates);
        return {
            jobs: data.jobs.length,
            candidates: candidates.length,
            scheduled: candidates.filter((candidate) => candidate.schedule?.scheduledAt).length,
            unread: candidates.reduce((sum, candidate) => sum + candidate.unreadMessageCount, 0),
        };
    }, [data.jobs]);

    useEffect(() => {
        if (!session?.access_token) return;

        let mounted = true;
        const sessionCache = directInterviewsCacheForOwner(session.user?.id);
        if (sessionCache) {
            setData(sessionCache);
            resourcesLoadedRef.current = Boolean(sessionCache.interviewers.length || sessionCache.questionSets.length || sessionCache.questionBankGroups?.length);
        }
        setLoading(!sessionCache);
        setError(null);
        setAccessNotice(null);

        api.get<DirectInterviewsResponse>("/companies/direct-interviews", session.access_token)
            .then((payload) => {
                if (!mounted) return;
                const nextData = withCachedResources({
                    jobs: payload.jobs || [],
                    interviewers: payload.interviewers || [],
                    questionSets: payload.questionSets || [],
                    questionBankGroups: payload.questionBankGroups || [],
                }, directInterviewsCacheForOwner(session.user?.id));
                rememberDirectInterviewsData(nextData, session.user?.id);
                resourcesLoadedRef.current = Boolean(nextData.interviewers.length || nextData.questionSets.length || nextData.questionBankGroups.length);
                setData(nextData);
            })
            .catch((err) => {
                if (mounted) setError(err instanceof ApiError ? err.message : "Failed to load direct interviews.");
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [session?.access_token, session?.user?.id]);

    useEffect(() => {
        if (!activeCandidate) return;
        setScheduleForm({
            scheduledAt: toDateTimeLocal(activeCandidate.schedule?.scheduledAt),
            timezone: activeCandidate.schedule?.timezone || company?.defaultTimezone || "Asia/Kolkata",
            durationMinutes: String(activeCandidate.schedule?.durationMinutes || 45),
            mode: activeCandidate.schedule?.mode || "video",
            meetingLink: activeCandidate.schedule?.meetingLink || "",
            location: activeCandidate.schedule?.location || "",
            notes: activeCandidate.schedule?.notes || "",
        });
        setInterviewerForm({
            interviewerMemberId: activeInterviewerId,
            questionIds: activeCandidate.questionSelection?.questions?.map((question) => question.id) || [],
            notes: activeCandidate.questionSelection?.notes || "",
        });
    }, [activeCandidate?.id, activeInterviewerId, activeQuestionIdsKey, activeCandidate?.questionSelection?.notes, company?.defaultTimezone]);

    useEffect(() => {
        if (!session?.access_token || !activeCandidate || candidateAction !== "chat") return;

        setChatError(null);
        setChatLoading(!(activeCandidate.messages || []).length);
        api.get<{ messages: DirectMessage[] }>(`/companies/direct-interviews/${activeCandidate.id}/messages`, session.access_token)
            .then((payload) => {
                const messages = payload.messages || [];
                setChatMessages((current) => mergeServerMessages(current, messages));
                mergeCandidateServerMessages(activeCandidate.id, messages, 0);
            })
            .catch((err) => setChatError(err instanceof ApiError ? err.message : "Failed to load chat."))
            .finally(() => setChatLoading(false));

        const socket = io(getApiBaseUrl(), {
            auth: { token: session.access_token },
            transports: ["websocket", "polling"],
            withCredentials: true,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
            socket.emit("direct_interview:join", { roundCandidateId: activeCandidate.id });
        });
        socket.on("direct_interview:joined", (payload: { messages?: DirectMessage[] }) => {
            const messages = payload.messages || [];
            setChatMessages((current) => mergeServerMessages(current, messages));
            mergeCandidateServerMessages(activeCandidate.id, messages, 0);
        });
        socket.on("direct_interview:message", (payload: { roundCandidateId: string; message: DirectMessage }) => {
            if (payload.roundCandidateId !== activeCandidate.id) return;
            setChatMessages((current) => mergeIncomingMessage(current, payload.message));
            mergeCandidateIncomingMessage(activeCandidate.id, payload.message, payload.message.senderType === "candidate" ? 0 : activeCandidate.unreadMessageCount);
            socket.emit("direct_interview:read", { roundCandidateId: activeCandidate.id });
        });
        socket.on("direct_interview:read", (payload: { roundCandidateId: string; messages?: DirectMessage[] }) => {
            if (payload.roundCandidateId === activeCandidate.id && payload.messages) {
                const messages = payload.messages || [];
                setChatMessages((current) => mergeServerMessages(current, messages));
                mergeCandidateServerMessages(activeCandidate.id, messages, 0);
            }
        });
        socket.on("direct_interview:error", (payload: { message?: string }) => {
            setChatError(payload.message || "Chat connection failed.");
            setChatMessages((current) => current.map((message) =>
                message.pending ? { ...message, pending: false, failed: true } : message
            ));
        });
        socket.on("connect_error", (err) => {
            setChatError(err.message || "Chat connection failed.");
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [activeCandidate?.id, candidateAction, session?.access_token]);

    useEffect(() => {
        if (!activeCandidateId || !candidateAction || candidateAction === "chat") return;
        void hydrateCandidateDetails(activeCandidateId);
    }, [activeCandidateId, candidateAction, session?.access_token]);

    useEffect(() => {
        if (!session?.user?.id || loading || candidateJobId || activeCandidateId || candidateAction) return;
        const savedState = readStoredDirectInterviewsUiState(session.user.id);
        if (!savedState) return;

        const job = data.jobs.find((item) => item.id === savedState.candidateJobId);
        const candidate = job?.candidates.find((item) => item.id === savedState.activeCandidateId);
        if (!job || !candidate) {
            clearStoredDirectInterviewsUiState(session.user.id);
            return;
        }

        setCandidateJobId(savedState.candidateJobId);
        setActiveCandidateId(savedState.activeCandidateId);
        setCandidateAction(savedState.candidateAction);
        setCandidateActionBackTarget(savedState.candidateActionBackTarget);
        if (savedState.interviewerForm) {
            setInterviewerForm(savedState.interviewerForm);
        }
        seedChatFromCandidate(savedState.candidateAction === "chat" ? candidate : null);
        if (savedState.candidateAction === "interviewer") void ensureInterviewResourcesLoaded();
    }, [session?.user?.id, loading, data.jobs, candidateJobId, activeCandidateId, candidateAction]);

    async function ensureInterviewResourcesLoaded() {
        if (!session?.access_token || resourcesLoadedRef.current || resourcesLoadingRef.current) return;

        resourcesLoadingRef.current = true;
        setResourcesLoading(true);
        setResourcesError(null);
        try {
            const payload = await api.get<Pick<DirectInterviewsResponse, "interviewers" | "questionSets" | "questionBankGroups">>(
                "/companies/direct-interviews/resources",
                session.access_token
            );
            setData((current) => {
                const nextData = rememberDirectInterviewsData({
                    ...current,
                    interviewers: payload.interviewers || [],
                    questionSets: payload.questionSets || [],
                    questionBankGroups: payload.questionBankGroups || [],
                }, session.user?.id);
                resourcesLoadedRef.current = true;
                return nextData;
            });
        } catch (err) {
            setResourcesError(err instanceof ApiError ? err.message : "Failed to load interviewer resources.");
        } finally {
            resourcesLoadingRef.current = false;
            setResourcesLoading(false);
        }
    }

    function mergeCandidate(candidateId: string, patch: Partial<DirectCandidate>) {
        setData((current) => rememberDirectInterviewsData({
            ...current,
            jobs: current.jobs.map((job) => {
                const nextJob = {
                    ...job,
                    candidates: job.candidates.map((candidate) =>
                        candidate.id === candidateId ? mergeDirectCandidate(candidate, patch) : candidate
                    ),
                };
                return recomputeJob(nextJob);
            }),
        }, session?.user?.id));
    }

    async function hydrateCandidateDetails(candidateId: string) {
        if (!session?.access_token) return;
        if (hydratedCandidateIdsRef.current.has(candidateId) || hydratingCandidateIdsRef.current.has(candidateId)) return;

        hydratingCandidateIdsRef.current.add(candidateId);
        setHydratingCandidateIds((current) => new Set(current).add(candidateId));
        try {
            const payload = await api.get<{ candidate: DirectCandidate }>(
                `/companies/direct-interviews/${candidateId}/context`,
                session.access_token
            );
            const candidate = payload.candidate;
            hydratedCandidateIdsRef.current.add(candidateId);
            mergeCandidate(candidateId, {
                ...candidate,
                detailsLoaded: true,
                messages: candidate.messages || [],
            });
            if (activeCandidateId === candidateId && candidateAction === "chat") {
                setChatMessages((current) => mergeServerMessages(current, candidate.messages || []));
            }
        } catch (err) {
            if (activeCandidateId === candidateId && candidateAction && candidateAction !== "chat") {
                setError(err instanceof ApiError ? err.message : "Failed to load candidate details.");
            }
            mergeCandidate(candidateId, { detailsLoaded: true });
        } finally {
            hydratingCandidateIdsRef.current.delete(candidateId);
            setHydratingCandidateIds((current) => {
                const next = new Set(current);
                next.delete(candidateId);
                return next;
            });
        }
    }

    function mergeCandidateServerMessages(candidateId: string, messages: DirectMessage[], unreadCount?: number) {
        setData((current) => rememberDirectInterviewsData({
            ...current,
            jobs: current.jobs.map((job) => {
                const nextJob = {
                    ...job,
                    candidates: job.candidates.map((candidate) => {
                        if (candidate.id !== candidateId) return candidate;
                        const nextMessages = mergeServerMessages(candidate.messages || [], messages);
                        return {
                            ...candidate,
                            messages: nextMessages,
                            lastMessageAt: nextMessages.length ? nextMessages[nextMessages.length - 1].createdAt : null,
                            unreadMessageCount: unreadCount ?? unreadForCompany(nextMessages),
                        };
                    }),
                };
                return recomputeJob(nextJob);
            }),
        }, session?.user?.id));
    }

    function mergeCandidateIncomingMessage(candidateId: string, message: DirectMessage, unreadCount = 0) {
        setData((current) => rememberDirectInterviewsData({
            ...current,
            jobs: current.jobs.map((job) => {
                const nextJob = {
                    ...job,
                    candidates: job.candidates.map((candidate) => {
                        if (candidate.id !== candidateId) return candidate;
                        const nextMessages = mergeIncomingMessage(candidate.messages || [], message);
                        return {
                            ...candidate,
                            messages: nextMessages,
                            lastMessageAt: nextMessages.length ? nextMessages[nextMessages.length - 1].createdAt : null,
                            unreadMessageCount: unreadCount,
                        };
                    }),
                };
                return recomputeJob(nextJob);
            }),
        }, session?.user?.id));
    }

    function markCachedMessageFailed(candidateId: string, clientMessageId: string) {
        setData((current) => rememberDirectInterviewsData({
            ...current,
            jobs: current.jobs.map((job) => {
                const nextJob = {
                    ...job,
                    candidates: job.candidates.map((candidate) => {
                        if (candidate.id !== candidateId) return candidate;
                        return {
                            ...candidate,
                            messages: (candidate.messages || []).map((message) =>
                                message.clientMessageId === clientMessageId
                                    ? { ...message, pending: false, failed: true }
                                    : message
                            ),
                        };
                    }),
                };
                return recomputeJob(nextJob);
            }),
        }, session?.user?.id));
    }

    function seedChatFromCandidate(candidate?: DirectCandidate | null) {
        setChatMessages(sortMessages(candidate?.messages || []));
    }

    function openCandidates(jobId: string) {
        setCandidateJobId(jobId);
        setActiveCandidateId(null);
        setCandidateAction(null);
        setCandidateActionBackTarget("list");
        setAccessNotice(null);
        seedChatFromCandidate(null);
        setChatInput("");
        setChatError(null);
        setChatLoading(false);
    }

    function requireDirectInterviewManageAccess() {
        if (canManageDirectInterviews) return true;
        setAccessNotice(directInterviewAccessMessage);
        return false;
    }

    function requireDirectInterviewChatAccess() {
        if (canUseDirectInterviewChat) return true;
        setAccessNotice(directInterviewAccessMessage);
        return false;
    }

    function openCandidateAction(jobId: string, candidate: DirectCandidate, action: CandidateAction = "actions") {
        setCandidateJobId(jobId);
        setActiveCandidateId(candidate.id);
        if (restrictedCandidateActions.has(action) && !canManageDirectInterviews) {
            setCandidateAction("actions");
            setCandidateActionBackTarget("list");
            setAccessNotice(directInterviewAccessMessage);
            seedChatFromCandidate(null);
            setChatInput("");
            setChatError(null);
            setChatLoading(false);
            return;
        }

        setAccessNotice(null);
        setCandidateAction(action);
        setCandidateActionBackTarget("list");
        seedChatFromCandidate(action === "chat" ? candidate : null);
        setChatInput("");
        setChatError(null);
        setChatLoading(action === "chat" && !(candidate.messages || []).length);
        if (action === "interviewer") void ensureInterviewResourcesLoaded();
    }

    function openNestedCandidateAction(action: CandidateAction) {
        if (restrictedCandidateActions.has(action) && !requireDirectInterviewManageAccess()) return;
        setAccessNotice(null);
        setCandidateAction(action);
        setCandidateActionBackTarget("actions");
        seedChatFromCandidate(action === "chat" ? activeCandidate : null);
        setChatInput("");
        setChatError(null);
        setChatLoading(action === "chat" && !(activeCandidate?.messages || []).length);
        if (action === "interviewer") void ensureInterviewResourcesLoaded();
    }

    function backToCandidateList() {
        clearStoredDirectInterviewsUiState(session?.user?.id);
        setActiveCandidateId(null);
        setCandidateAction(null);
        setCandidateActionBackTarget("list");
        setAccessNotice(null);
        setChatMessages([]);
        setChatInput("");
        setChatError(null);
        setChatLoading(false);
    }

    function backToCandidateActions() {
        setCandidateAction("actions");
        setCandidateActionBackTarget("list");
        setAccessNotice(null);
        setChatMessages([]);
        setChatInput("");
        setChatError(null);
        setChatLoading(false);
    }

    function closeCandidateFlow() {
        clearStoredDirectInterviewsUiState(session?.user?.id);
        setCandidateJobId(null);
        setActiveCandidateId(null);
        setCandidateAction(null);
        setCandidateActionBackTarget("list");
        setAccessNotice(null);
        setChatMessages([]);
        setChatInput("");
        setChatError(null);
        setChatLoading(false);
    }

    async function saveSchedule() {
        if (!session?.access_token || !activeCandidate) return;
        if (!requireDirectInterviewManageAccess()) return;
        setSavingSchedule(true);
        setError(null);
        try {
            const payload = await api.patch<{ interview: Partial<DirectCandidate> }>(
                `/companies/direct-interviews/${activeCandidate.id}/schedule`,
                {
                    scheduledAt: new Date(scheduleForm.scheduledAt).toISOString(),
                    timezone: scheduleForm.timezone,
                    durationMinutes: scheduleForm.durationMinutes,
                    mode: scheduleForm.mode,
                    meetingLink: scheduleForm.meetingLink,
                    location: scheduleForm.location,
                    notes: scheduleForm.notes,
                },
                session.access_token
            );
            mergeCandidate(activeCandidate.id, {
                status: payload.interview.status || "scheduled",
                schedule: payload.interview.schedule,
            });
            setCandidateAction("actions");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to schedule interview.");
        } finally {
            setSavingSchedule(false);
        }
    }

    async function saveInterviewer() {
        if (!session?.access_token || !activeCandidate) return;
        if (!requireDirectInterviewManageAccess()) return;
        setSavingInterviewer(true);
        setError(null);
        try {
            const completeSetIds = data.questionSets
                .filter((set) => isCompleteSet(set, interviewerForm.questionIds))
                .map((set) => set.id);
            const payload = await api.patch<{ interview: Partial<DirectCandidate> }>(
                `/companies/direct-interviews/${activeCandidate.id}/interviewer`,
                {
                    interviewerMemberId: interviewerForm.interviewerMemberId,
                    questionSetIds: completeSetIds,
                    questionIds: interviewerForm.questionIds,
                    notes: interviewerForm.notes,
                },
                session.access_token
            );
            mergeCandidate(activeCandidate.id, {
                status: payload.interview.status || activeCandidate.status,
                interviewer: payload.interview.interviewer,
                questionSelection: payload.interview.questionSelection,
            });
            setCandidateAction("actions");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to assign interviewer.");
        } finally {
            setSavingInterviewer(false);
        }
    }

    async function sendMessage() {
        if (!activeCandidate || !chatInput.trim() || sendingMessage) return;
        if (!requireDirectInterviewChatAccess()) return;
        setSendingMessage(true);
        setChatError(null);
        const content = chatInput.trim();
        const clientMessageId = makeClientMessageId();
        const optimisticMessage: DirectMessage = {
            id: `optimistic-${clientMessageId}`,
            clientMessageId,
            senderType: "company",
            senderId: session?.user?.id || "company",
            senderName: company?.name || "Practers",
            content,
            createdAt: new Date().toISOString(),
            pending: true,
        };

        setChatInput("");
        setChatMessages((current) => mergeIncomingMessage(current, optimisticMessage));
        mergeCandidateIncomingMessage(activeCandidate.id, optimisticMessage, 0);

        try {
            if (socketRef.current?.connected) {
                socketRef.current.emit("direct_interview:message", {
                    roundCandidateId: activeCandidate.id,
                    content,
                    clientMessageId,
                });
            } else if (session?.access_token) {
                const payload = await api.post<{ message: DirectMessage; messages?: DirectMessage[] }>(
                    `/companies/direct-interviews/${activeCandidate.id}/messages`,
                    { content, clientMessageId },
                    session.access_token
                );
                setChatMessages((current) => mergeIncomingMessage(current, { ...payload.message, clientMessageId }));
                mergeCandidateIncomingMessage(activeCandidate.id, { ...payload.message, clientMessageId }, 0);
            }
        } catch (err) {
            setChatMessages((current) => current.map((message) =>
                message.clientMessageId === clientMessageId
                    ? { ...message, pending: false, failed: true }
                    : message
            ));
            markCachedMessageFailed(activeCandidate.id, clientMessageId);
            setChatError(err instanceof ApiError ? err.message : "Failed to send message.");
            setChatInput(content);
        } finally {
            setSendingMessage(false);
        }
    }

    function toggleQuestion(questionId: string) {
        setInterviewerForm((current) => ({
            ...current,
            questionIds: current.questionIds.includes(questionId)
                ? current.questionIds.filter((id) => id !== questionId)
                : [...current.questionIds, questionId],
        }));
    }

    function toggleSet(set: QuestionSet) {
        setInterviewerForm((current) => {
            const complete = isCompleteSet(set, current.questionIds);
            const setQuestionIds = set.questions.map((question) => question.id);
            return {
                ...current,
                questionIds: complete
                    ? current.questionIds.filter((id) => !setQuestionIds.includes(id))
                    : Array.from(new Set([...current.questionIds, ...setQuestionIds])),
            };
        });
    }

    function previewQuestion(question: Question) {
        const href = questionPreviewHref(question);
        if (!href || typeof window === "undefined") return;

        writeStoredDirectInterviewsUiState(session?.user?.id, {
            candidateJobId: candidateJobId || "",
            activeCandidateId: activeCandidateId || "",
            candidateAction: "interviewer",
            candidateActionBackTarget,
            interviewerForm,
        });
        window.open(href, "_blank", "noopener,noreferrer");
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-7">
                <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex items-center gap-4">
                        <span className="flex size-16 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <span className="material-symbols-outlined text-4xl">record_voice_over</span>
                        </span>
                        <div>
                            <p className="text-sm font-bold uppercase text-slate-400 dark:text-slate-500">Company Workspace</p>
                            <h1 className="font-nunito text-4xl font-extrabold text-slate-950 dark:text-white">Direct Interviews</h1>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                                {canManageDirectInterviews
                                    ? "Jobs with candidates moved to direct final interview. Open a job to schedule, assign interviewers, chat, and review context."
                                    : "Jobs with candidates moved to direct final interview. Open a job to review selected candidates, chat, and hiring context."}
                            </p>
                        </div>
                    </div>
                </section>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
                        {error}
                    </div>
                ) : null}

                

                {loading ? (
                    <section className="grid min-h-[360px] place-items-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="text-center">
                            <span className="material-symbols-outlined animate-pulse text-5xl text-primary">hourglass_top</span>
                            <p className="mt-3 font-nunito text-lg font-extrabold text-slate-900 dark:text-white">Loading direct interviews</p>
                        </div>
                    </section>
                ) : data.jobs.length === 0 ? (
                    <section className="grid min-h-[400px] place-items-center rounded-lg border border-slate-200 bg-white px-6 py-12 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="max-w-xl">
                            <span className="mx-auto flex size-16 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <span className="material-symbols-outlined text-4xl">route</span>
                            </span>
                            <h2 className="mt-5 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">No direct interview candidates yet</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                Move candidates to Direct final interview from Jobs or Assessments. Those jobs will appear here.
                            </p>
                        </div>
                    </section>
                ) : (
                    <section className="space-y-4">
                        {data.jobs.map((job) => (
                            <DirectJobRow
                                key={job.id}
                                job={job}
                                onOpenDetails={() => setJobDetailsId(job.id)}
                                onOpenCandidates={() => openCandidates(job.id)}
                            />
                        ))}
                    </section>
                )}
            </div>

            {selectedJobDetails ? (
                <JobDetailsModal
                    job={selectedJobDetails}
                    onClose={() => setJobDetailsId(null)}
                    onOpenCandidates={() => {
                        setJobDetailsId(null);
                        openCandidates(selectedJobDetails.id);
                    }}
                />
            ) : null}

            {candidateJob && (!activeCandidate || !candidateAction) ? (
                <CandidatesModal
                    job={candidateJob}
                    activeCandidateId={activeCandidateId}
                    onClose={closeCandidateFlow}
                    onOpenCandidate={(candidate, action) => openCandidateAction(candidateJob.id, candidate, action)}
                />
            ) : null}

            {candidateJob && activeCandidate && candidateAction === "actions" ? (
                <CandidateActionsModal
                    candidate={activeCandidate}
                    job={candidateJob}
                    loading={candidateContextLoading}
                    notice={accessNotice}
                    onBack={backToCandidateList}
                    onClose={closeCandidateFlow}
                    onOpen={openNestedCandidateAction}
                />
            ) : null}

            {candidateJob && activeCandidate && candidateAction === "schedule" ? (
                <ScheduleModal
                    candidate={activeCandidate}
                    form={scheduleForm}
                    setForm={setScheduleForm}
                    saving={savingSchedule}
                    onBack={backToCandidateActions}
                    onClose={closeCandidateFlow}
                    onSave={saveSchedule}
                />
            ) : null}

            {candidateJob && activeCandidate && candidateAction === "interviewer" ? (
                <InterviewerModal
                    candidate={activeCandidate}
                    form={interviewerForm}
                    setForm={setInterviewerForm}
                    interviewers={data.interviewers}
                    questionSets={data.questionSets}
                    questionBankGroups={data.questionBankGroups}
                    loading={resourcesLoading}
                    error={resourcesError}
                    saving={savingInterviewer}
                    onBack={backToCandidateActions}
                    onClose={closeCandidateFlow}
                    onSave={saveInterviewer}
                    toggleQuestion={toggleQuestion}
                    toggleSet={toggleSet}
                    onPreviewQuestion={previewQuestion}
                />
            ) : null}

            {candidateJob && activeCandidate && candidateAction === "chat" ? (
                <ChatModal
                    candidate={activeCandidate}
                    messages={chatMessages}
                    input={chatInput}
                    setInput={setChatInput}
                    error={chatError}
                    loading={chatLoading}
                    sending={sendingMessage}
                    onBack={candidateActionBackTarget === "list" ? backToCandidateList : backToCandidateActions}
                    onClose={closeCandidateFlow}
                    onSend={sendMessage}
                />
            ) : null}

            {candidateJob && activeCandidate && candidateAction === "profile" ? (
                <ProfileModal
                    candidate={activeCandidate}
                    loading={candidateContextLoading}
                    onBack={backToCandidateActions}
                    onClose={closeCandidateFlow}
                />
            ) : null}

            {candidateJob && activeCandidate && candidateAction === "journey" ? (
                <JourneyModal
                    candidate={activeCandidate}
                    loading={candidateContextLoading}
                    onBack={backToCandidateActions}
                    onClose={closeCandidateFlow}
                />
            ) : null}

            {candidateJob && activeCandidate && candidateAction === "start" ? (
                <StartModal
                    candidate={activeCandidate}
                    onBack={backToCandidateActions}
                    onClose={closeCandidateFlow}
                />
            ) : null}
        </main>
    );
}

function StatBox({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
            <div className="flex items-center justify-between">
                <p className="font-nunito text-sm font-extrabold text-slate-500 dark:text-slate-400">{label}</p>
                <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <span className="material-symbols-outlined">{icon}</span>
                </span>
            </div>
            <p className="mt-2 font-nunito text-4xl font-black text-slate-950 dark:text-white">{value}</p>
        </div>
    );
}

function DirectJobRow({
    job,
    onOpenDetails,
    onOpenCandidates,
}: {
    job: DirectJob;
    onOpenDetails: () => void;
    onOpenCandidates: () => void;
}) {
    return (
        <article
            role="button"
            tabIndex={0}
            onClick={onOpenDetails}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenDetails();
                }
            }}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-lc-border dark:bg-lc-surface"
        >
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                    <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-primary/20 bg-primary/10 text-2xl font-black text-primary">
                        {job.companyLogoUrl ? <img src={job.companyLogoUrl} alt="" className="h-full w-full object-contain p-1.5" /> : job.title.charAt(0)}
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-bold uppercase tracking-wide text-primary">{statusCopy(job.status || "open")}</p>
                        <h2 className="mt-1 truncate font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">{job.title}</h2>
                        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                            {job.companyName}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                        <span className="material-symbols-outlined text-lg">groups</span>
                        {job.candidateCount} selected
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                        <span className="material-symbols-outlined text-lg">event_available</span>
                        {job.scheduledCount} scheduled
                    </span>
                    {job.unreadMessageCount ? (
                        <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-4 py-2 text-sm font-extrabold text-red-600 dark:bg-red-400/10 dark:text-red-200">
                            <span className="material-symbols-outlined text-lg">mark_chat_unread</span>
                            {job.unreadMessageCount} unread
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpenCandidates();
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-nunito text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                    >
                        <span className="material-symbols-outlined">groups</span>
                        Selected candidates
                    </button>
                </div>
            </div>
        </article>
    );
}

function JobDetailsModal({
    job,
    onClose,
    onOpenCandidates,
}: {
    job: DirectJob;
    onClose: () => void;
    onOpenCandidates: () => void;
}) {
    const meta = [job.workMode, job.location].filter(Boolean).join(" | ");
    const tags = [job.employmentType, job.experienceLevel, job.roleType, job.compensationType, job.duration].filter(Boolean);

    return (
        <ModalShell
            title={job.title}
            subtitle={`${job.companyName}${meta ? ` - ${meta}` : ""}`}
            icon="work"
            onClose={onClose}
            width="max-w-5xl"
            z="z-[130]"
        >
            <div className="max-h-[78vh] overflow-y-auto bg-[#FAFBFC] p-6 dark:bg-lc-bg">
                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{statusCopy(job.status || "open")}</p>
                            <h1 className="mt-1 font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">{job.title}</h1>
                            <p className="mt-2 text-lg font-semibold text-slate-700 dark:text-slate-200">{job.companyName}</p>
                            {meta ? <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">{meta}</p> : null}
                        </div>
                        <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white text-2xl font-black text-primary dark:border-lc-border dark:bg-lc-elevated">
                            {job.companyLogoUrl ? <img src={job.companyLogoUrl} alt="" className="h-full w-full object-contain p-2" /> : job.title.charAt(0)}
                        </span>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                        {tags.map((item, index) => (
                            <span key={`${item}-${index}`} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                                {item}
                            </span>
                        ))}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                            <span className="material-symbols-outlined text-lg">groups</span>
                            {job.candidateCount} selected
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                            <span className="material-symbols-outlined text-lg">event_available</span>
                            {job.scheduledCount} scheduled
                        </span>
                        <button
                            type="button"
                            onClick={onOpenCandidates}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-nunito text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                        >
                            <span className="material-symbols-outlined">groups</span>
                            Selected candidates
                        </button>
                    </div>
                </section>

                <div className="mt-5 grid gap-5">
                    <JobDetailText title="About the company" text={job.companyOverview} />
                    <JobDetailText title="About the role" text={job.aboutRole} />
                    <JobDetailList title="Responsibilities" items={job.responsibilities} />
                    <JobDetailList title="Requirements" items={job.requirements} />
                    <JobDetailList title="Benefits" items={job.benefits} />
                    <JobDetailText title="Application note" text={job.applicationNote} />
                </div>

                <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Additional information</h3>
                    <div className="mt-4 grid gap-3 text-sm font-medium text-slate-600 dark:text-slate-300 md:grid-cols-2">
                        {formatDate(job.applicationDeadline) ? <p>Deadline: {formatDate(job.applicationDeadline)}</p> : null}
                        {job.timeCommitment ? <p>Time commitment: {job.timeCommitment}</p> : null}
                        {job.travel ? <p>Travel: {job.travel}</p> : null}
                        {job.openings ? <p>Open positions: {job.openings}</p> : null}
                        {job.compensation ? <p>Compensation: {job.compensation}</p> : null}
                        {job.profession ? <p>Profession: {job.profession}</p> : null}
                        {job.discipline ? <p>Discipline: {job.discipline}</p> : null}
                    </div>
                    {job.skills?.length ? (
                        <div className="mt-5 flex flex-wrap gap-2">
                            {job.skills.map((skill) => (
                                <span key={skill} className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-extrabold text-primary">
                                    {skill}
                                </span>
                            ))}
                        </div>
                    ) : null}
                </section>
            </div>
        </ModalShell>
    );
}

function JobDetailText({ title, text }: { title: string; text?: string | null }) {
    if (!text) return null;
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">{text}</p>
        </section>
    );
}

function JobDetailList({ title, items }: { title: string; items?: string[] }) {
    if (!items?.length) return null;
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {items.map((item, index) => (
                    <li key={`${title}-${index}`} className="flex gap-2">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function ModalShell({
    title,
    subtitle,
    icon,
    width = "max-w-5xl",
    z = "z-[140]",
    onClose,
    onBack,
    children,
}: {
    title: string;
    subtitle?: string;
    icon: string;
    width?: string;
    z?: string;
    onClose: () => void;
    onBack?: () => void;
    children: ReactNode;
}) {
    return (
        <div className={`fixed inset-0 ${z} overflow-y-auto bg-slate-950/55 px-4 py-6 backdrop-blur-sm`}>
            <div className={`mx-auto ${width} rounded-lg bg-white shadow-2xl dark:bg-lc-surface`}>
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6 dark:border-lc-border">
                    <div className="flex min-w-0 items-start gap-3">
                        {onBack ? (
                            <button
                                type="button"
                                onClick={onBack}
                                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-lc-hover"
                                aria-label="Back"
                            >
                                <span className="material-symbols-outlined text-3xl">arrow_back</span>
                            </button>
                        ) : (
                            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <span className="material-symbols-outlined text-3xl">{icon}</span>
                            </span>
                        )}
                        <div className="min-w-0">
                            <h2 className="truncate font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{title}</h2>
                            {subtitle ? <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex size-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover"
                            aria-label="Close"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </div>
                {children}
            </div>
        </div>
    );
}

function CandidateAvatar({ candidate, size = "size-12" }: { candidate: DirectCandidate; size?: string }) {
    return (
        <span className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 font-nunito text-sm font-black text-slate-700 dark:bg-lc-hover dark:text-slate-200`}>
            {candidate.candidate.avatarUrl ? <img src={candidate.candidate.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(candidate.candidate.name)}
        </span>
    );
}

function ModalLoadingState({ label }: { label: string }) {
    return (
        <div className="grid min-h-[360px] place-items-center p-6 text-center">
            <div>
                <span className="material-symbols-outlined animate-pulse text-5xl text-primary">hourglass_top</span>
                <p className="mt-3 font-nunito text-lg font-extrabold text-slate-900 dark:text-white">{label}</p>
            </div>
        </div>
    );
}

function CandidatesModal({
    job,
    activeCandidateId,
    onClose,
    onOpenCandidate,
}: {
    job: DirectJob;
    activeCandidateId: string | null;
    onClose: () => void;
    onOpenCandidate: (candidate: DirectCandidate, action: CandidateAction) => void;
}) {
    return (
        <ModalShell
            title="Selected candidates"
            subtitle={`${job.title} - ${job.candidateCount} candidate${job.candidateCount === 1 ? "" : "s"}`}
            icon="groups"
            onClose={onClose}
            width="max-w-6xl"
            z="z-[130]"
        >
            <div className="p-6">
                <div className="space-y-3">
                    {job.candidates.map((candidate) => (
                        <article
                            key={candidate.id}
                            className={`rounded-lg border p-4 transition ${activeCandidateId === candidate.id ? "border-primary bg-primary/5" : "border-slate-200 dark:border-lc-border"}`}
                        >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div className="flex min-w-0 items-start gap-3">
                                    <CandidateAvatar candidate={candidate} />
                                    <div className="min-w-0">
                                        <h3 className="truncate font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{candidate.candidate.name}</h3>
                                        <p className="truncate text-sm font-semibold text-slate-500 dark:text-slate-400">{candidate.candidate.email}</p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ring-1 ${statusClasses(candidate.status)}`}>{statusCopy(candidate.status)}</span>
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{candidate.score}/100</span>
                                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                                                {candidate.schedule?.scheduledAt ? formatDate(candidate.schedule.scheduledAt) : "Not scheduled"}
                                            </span>
                                            {candidate.interviewer ? (
                                                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-400/10 dark:text-blue-300">
                                                    {candidate.interviewer.name}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex shrink-0 flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onOpenCandidate(candidate, "actions")}
                                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-nunito text-sm font-extrabold text-white"
                                    >
                                        <span className="material-symbols-outlined">tune</span>
                                        Manage
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onOpenCandidate(candidate, "chat")}
                                        className="relative inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-3 font-nunito text-sm font-extrabold text-slate-700 dark:border-lc-border dark:text-slate-200"
                                    >
                                        <span className="material-symbols-outlined">chat</span>
                                        Chat
                                        {candidate.unreadMessageCount ? (
                                            <span className="absolute -right-2 -top-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-black text-white">{candidate.unreadMessageCount}</span>
                                        ) : null}
                                    </button>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </ModalShell>
    );
}

function CandidateActionsModal({
    candidate,
    job,
    loading,
    notice,
    onBack,
    onClose,
    onOpen,
}: {
    candidate: DirectCandidate;
    job: DirectJob;
    loading: boolean;
    notice?: string | null;
    onBack: () => void;
    onClose: () => void;
    onOpen: (action: CandidateAction) => void;
}) {
    const questionCount = candidate.questionSelection?.questions?.length || 0;
    const actions: Array<{ action: CandidateAction; icon: string; title: string; body: string; badge?: string }> = [
        {
            action: "schedule",
            icon: "event",
            title: "Schedule interview",
            body: candidate.schedule?.scheduledAt ? formatLongDate(candidate.schedule.scheduledAt) : "Set time, duration, mode, and meeting details.",
        },
        {
            action: "interviewer",
            icon: "assignment_ind",
            title: "Interviewer and questions",
            body: candidate.interviewer ? `${candidate.interviewer.name} - ${questionCount} question${questionCount === 1 ? "" : "s"}` : "Choose a team member and assign the question plan.",
        },
        {
            action: "chat",
            icon: "chat",
            title: "Candidate chat",
            body: candidate.lastMessageAt ? `Last message ${formatDate(candidate.lastMessageAt)}` : "Open direct chat with the candidate.",
            badge: candidate.unreadMessageCount ? `${candidate.unreadMessageCount}` : undefined,
        },
        {
            action: "profile",
            icon: "person_search",
            title: "View profile",
            body: candidate.profile?.headline || "Open the candidate profile created on the client side.",
        },
        {
            action: "journey",
            icon: "route",
            title: "View journey",
            body: `${candidate.journey.length} hiring round${candidate.journey.length === 1 ? "" : "s"} with reports and submissions.`,
        },
        {
            action: "start",
            icon: "play_arrow",
            title: "Start interview",
            body: "Interview room placeholder for now.",
        },
    ];

    return (
        <ModalShell
            title={candidate.candidate.name}
            subtitle={`${job.title} - ${candidate.candidate.email}`}
            icon="tune"
            onBack={onBack}
            onClose={onClose}
            width="max-w-4xl"
            z="z-[150]"
        >
            <div className="p-6">
                {loading ? (
                    <div className="mb-5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-extrabold text-primary">
                        Loading candidate profile, reports, and journey...
                    </div>
                ) : null}
                {notice ? (
                    <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-extrabold text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                        {notice}
                    </div>
                ) : null}
                <div className="mb-5 flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-extrabold ring-1 ${statusClasses(candidate.status)}`}>{statusCopy(candidate.status)}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{candidate.score}/100</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">Selected from {statusCopy(candidate.selectedFrom)}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                    {actions.map((item) => (
                        <button
                            key={item.action}
                            type="button"
                            onClick={() => onOpen(item.action)}
                            className="relative rounded-lg border border-slate-200 p-4 text-left transition hover:border-primary/50 hover:bg-primary/5 dark:border-lc-border dark:hover:bg-primary/10"
                        >
                            {item.badge ? (
                                <span className="absolute right-4 top-4 rounded-full bg-red-500 px-2 py-0.5 text-xs font-black text-white">{item.badge}</span>
                            ) : null}
                            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <span className="material-symbols-outlined">{item.icon}</span>
                            </span>
                            <h3 className="mt-3 font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{item.title}</h3>
                            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{item.body}</p>
                        </button>
                    ))}
                </div>
            </div>
        </ModalShell>
    );
}

function ScheduleModal({
    candidate,
    form,
    setForm,
    saving,
    onBack,
    onClose,
    onSave,
}: {
    candidate: DirectCandidate;
    form: any;
    setForm: (updater: any) => void;
    saving: boolean;
    onBack: () => void;
    onClose: () => void;
    onSave: () => void;
}) {
    return (
        <ModalShell
            title="Schedule interview"
            subtitle={`${candidate.candidate.name} - ${candidate.candidate.email}`}
            icon="event"
            onBack={onBack}
            onClose={onClose}
            width="max-w-3xl"
            z="z-[160]"
        >
            <div className="grid gap-4 p-6">
                <label className="block">
                    <span className="text-sm font-extrabold text-slate-600 dark:text-slate-300">Date and time</span>
                    <input
                        type="datetime-local"
                        value={form.scheduledAt}
                        onChange={(event) => setForm((current: any) => ({ ...current, scheduledAt: event.target.value }))}
                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                    />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                        <span className="text-sm font-extrabold text-slate-600 dark:text-slate-300">Duration</span>
                        <select
                            value={form.durationMinutes}
                            onChange={(event) => setForm((current: any) => ({ ...current, durationMinutes: event.target.value }))}
                            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                        >
                            <option value="30">30 minutes</option>
                            <option value="45">45 minutes</option>
                            <option value="60">60 minutes</option>
                            <option value="90">90 minutes</option>
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-sm font-extrabold text-slate-600 dark:text-slate-300">Mode</span>
                        <select
                            value={form.mode}
                            onChange={(event) => setForm((current: any) => ({ ...current, mode: event.target.value }))}
                            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                        >
                            <option value="video">Video</option>
                            <option value="phone">Phone</option>
                            <option value="onsite">On-site</option>
                        </select>
                    </label>
                </div>
                <label className="block">
                    <span className="text-sm font-extrabold text-slate-600 dark:text-slate-300">Meeting link or location</span>
                    <input
                        value={form.mode === "onsite" ? form.location : form.meetingLink}
                        onChange={(event) => setForm((current: any) => form.mode === "onsite" ? { ...current, location: event.target.value } : { ...current, meetingLink: event.target.value })}
                        placeholder={form.mode === "onsite" ? "Office address or room" : "https://meet.google.com/..."}
                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                    />
                </label>
                <label className="block">
                    <span className="text-sm font-extrabold text-slate-600 dark:text-slate-300">Notes</span>
                    <textarea
                        value={form.notes}
                        onChange={(event) => setForm((current: any) => ({ ...current, notes: event.target.value }))}
                        rows={3}
                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                    />
                </label>
                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-nunito text-sm font-extrabold text-white disabled:opacity-60"
                    >
                        <span className="material-symbols-outlined">save</span>
                        {saving ? "Saving..." : "Save schedule"}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

function InterviewerModal({
    candidate,
    form,
    setForm,
    interviewers,
    questionSets = [],
    questionBankGroups = [],
    loading,
    error,
    saving,
    onBack,
    onClose,
    onSave,
    toggleQuestion,
    toggleSet,
    onPreviewQuestion,
}: any) {
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
    const [activeQuestionType, setActiveQuestionType] = useState<QuestionBankTab>("all");
    const allQuestionGroups = useMemo(
        () => [...questionSets, ...questionBankGroups],
        [questionSets, questionBankGroups]
    );
    const tabCounts = useMemo(() => {
        return questionBankTabs.reduce((counts, tab) => {
            counts[tab.value] = allQuestionGroups.reduce((total, group) => {
                if (tab.value === "all") return total + group.questions.length;
                return total + group.questions.filter((question: Question) => question.type === tab.value).length;
            }, 0);
            return counts;
        }, {} as Record<QuestionBankTab, number>);
    }, [allQuestionGroups]);
    const visibleQuestionSets = useMemo(
        () => questionSets
            .map((set: QuestionSet) => ({
                ...set,
                questions: activeQuestionType === "all"
                    ? set.questions
                    : set.questions.filter((question) => question.type === activeQuestionType),
            }))
            .filter((set: QuestionSet) => set.questions.length),
        [questionSets, activeQuestionType]
    );
    const visibleQuestionBankGroups = useMemo(
        () => questionBankGroups
            .map((set: QuestionSet) => ({
                ...set,
                questions: activeQuestionType === "all"
                    ? set.questions
                    : set.questions.filter((question) => question.type === activeQuestionType),
            }))
            .filter((set: QuestionSet) => set.questions.length),
        [questionBankGroups, activeQuestionType]
    );
    const hasQuestionOptions = Boolean(allQuestionGroups.some((group) => group.questions.length));
    const hasVisibleQuestionOptions = Boolean(visibleQuestionSets.length || visibleQuestionBankGroups.length);

    useEffect(() => {
        if (tabCounts[activeQuestionType] > 0) return;
        const firstAvailableTab = questionBankTabs.find((tab) => tabCounts[tab.value] > 0);
        if (firstAvailableTab) setActiveQuestionType(firstAvailableTab.value);
    }, [activeQuestionType, tabCounts]);

    function toggleCollapsedGroup(groupId: string) {
        setCollapsedGroupIds((current) => {
            const next = new Set(current);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    }

    function renderQuestionGroup(set: QuestionSet) {
        const collapsed = collapsedGroupIds.has(set.id);
        const complete = isCompleteSet(set, form.questionIds);
        return (
            <div key={set.id} className="rounded-lg border border-slate-200 p-4 dark:border-lc-border dark:bg-lc-surface">
                <div className="flex items-start justify-between gap-3">
                    <button
                        type="button"
                        onClick={() => toggleCollapsedGroup(set.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left text-slate-950 hover:text-primary dark:text-white dark:hover:text-primary"
                    >
                        <span className="material-symbols-outlined mt-0.5 text-lg text-slate-400">
                            {collapsed ? "chevron_right" : "expand_more"}
                        </span>
                        <span className="min-w-0">
                            <span className="block font-nunito text-base font-extrabold">{set.title}</span>
                            <span className="mt-1 block text-sm font-semibold text-slate-500 dark:text-slate-400">{set.focus}</span>
                            <span className="mt-2 block text-xs font-extrabold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                {set.questions.length} question{set.questions.length === 1 ? "" : "s"}
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => toggleSet(set)}
                        className="shrink-0 rounded-lg border border-primary/30 px-3 py-2 text-xs font-extrabold text-primary hover:border-primary hover:bg-primary/10 dark:border-primary/40 dark:hover:bg-primary/15"
                    >
                        {complete ? (set.isQuestionBank ? "Clear all" : "Clear set") : (set.isQuestionBank ? "Select all" : "Select set")}
                    </button>
                </div>
                {!collapsed ? (
                    <div className="mt-3 space-y-2">
                        {set.questions.map((question) => (
                            <div
                                key={question.id}
                                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-lc-hover"
                            >
                                <label className="flex min-w-0 flex-1 cursor-pointer gap-3">
                                    <input
                                        type="checkbox"
                                        checked={form.questionIds.includes(question.id)}
                                        onChange={() => toggleQuestion(question.id)}
                                        className="mt-1 size-4 accent-primary"
                                    />
                                    <span className="min-w-0 text-sm leading-6 text-slate-700 dark:text-slate-200">
                                        <span>{question.text}</span>
                                        {question.difficulty ? (
                                            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-extrabold text-slate-500 dark:bg-lc-hover dark:text-slate-300">
                                                {question.difficulty}
                                            </span>
                                        ) : null}
                                    </span>
                                </label>
                                {questionPreviewHref(question) ? (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onPreviewQuestion(question);
                                        }}
                                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/20 px-2.5 py-1.5 text-xs font-extrabold text-primary hover:border-primary hover:bg-primary/10 dark:border-primary/40 dark:hover:bg-primary/15"
                                    >
                                        <span className="material-symbols-outlined text-base">visibility</span>
                                        Preview
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <ModalShell
            title="Interviewer and questions"
            subtitle={`${candidate.candidate.name} - ${candidate.candidate.email}`}
            icon="assignment_ind"
            onBack={onBack}
            onClose={onClose}
            width="max-w-5xl"
            z="z-[160]"
        >
            <div className="grid gap-5 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
                <section className="space-y-4">
                    {error ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
                            {error}
                        </div>
                    ) : null}
                    <label className="block">
                        <span className="text-sm font-extrabold text-slate-600 dark:text-slate-300">Interviewer</span>
                        <select
                            value={form.interviewerMemberId}
                            onChange={(event) => setForm((current: any) => ({ ...current, interviewerMemberId: event.target.value }))}
                            disabled={loading}
                            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                        >
                            <option value="">{loading ? "Loading interviewers..." : "Choose interviewer"}</option>
                            {interviewers.map((interviewer: Interviewer) => (
                                <option key={interviewer.id} value={interviewer.id}>
                                    {interviewer.name} - {interviewer.teamName}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-sm font-extrabold text-slate-600 dark:text-slate-300">Interviewer notes</span>
                        <textarea
                            value={form.notes}
                            onChange={(event) => setForm((current: any) => ({ ...current, notes: event.target.value }))}
                            rows={7}
                            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={loading || saving || !form.interviewerMemberId || form.questionIds.length === 0}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-nunito text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className="material-symbols-outlined">save</span>
                        {saving ? "Saving..." : "Save interviewer plan"}
                    </button>
                </section>

                <section className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
                    {loading ? (
                        <ModalLoadingState label="Loading interviewer options" />
                    ) : hasQuestionOptions ? (
                        <>
                            <div className="sticky top-0 z-10 -mx-1 bg-white/95 px-1 pb-2 backdrop-blur dark:bg-lc-surface/95">
                                <div className="flex flex-wrap gap-2">
                                    {questionBankTabs.map((tab) => {
                                        const active = activeQuestionType === tab.value;
                                        const count = tabCounts[tab.value] || 0;
                                        return (
                                            <button
                                                key={tab.value}
                                                type="button"
                                                onClick={() => setActiveQuestionType(tab.value)}
                                                disabled={count === 0}
                                                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-extrabold transition ${
                                                    active
                                                        ? "bg-primary text-white shadow-sm"
                                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-lc-hover dark:text-slate-200 dark:hover:bg-lc-border"
                                                } disabled:cursor-not-allowed disabled:opacity-45`}
                                            >
                                                {tab.label}
                                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                                    active
                                                        ? "bg-white/20 text-white"
                                                        : "bg-white text-slate-500 dark:bg-lc-bg dark:text-slate-300"
                                                }`}>
                                                    {count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {hasVisibleQuestionOptions ? (
                                <>
                                    {visibleQuestionSets.length ? (
                                        <div className="space-y-2">
                                            <p className="px-1 text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                                Question sets
                                            </p>
                                            {visibleQuestionSets.map((set: QuestionSet) => renderQuestionGroup(set))}
                                        </div>
                                    ) : null}

                                    {visibleQuestionBankGroups.length ? (
                                        <div className="space-y-2 pt-2">
                                            <p className="px-1 text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                                Question bank not in sets
                                            </p>
                                            {visibleQuestionBankGroups.map((set: QuestionSet) => renderQuestionGroup(set))}
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <div className="rounded-lg border border-slate-200 p-5 text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                    No {activeQuestionType === "all" ? "" : `${questionBankTabs.find((tab) => tab.value === activeQuestionType)?.label} `}questions are available in sets or question bank.
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="rounded-lg border border-slate-200 p-5 text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                            No question sets or ungrouped question-bank questions are available yet.
                        </div>
                    )}
                </section>
            </div>
        </ModalShell>
    );
}

function ChatModal({
    candidate,
    messages,
    input,
    setInput,
    error,
    loading,
    sending,
    onBack,
    onClose,
    onSend,
}: {
    candidate: DirectCandidate;
    messages: DirectMessage[];
    input: string;
    setInput: (value: string) => void;
    error: string | null;
    loading: boolean;
    sending: boolean;
    onBack: () => void;
    onClose: () => void;
    onSend: () => void;
}) {
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, [messages.length]);

    return (
        <ModalShell
            title="Candidate chat"
            subtitle={`${candidate.candidate.name} - ${candidate.candidate.email}`}
            icon="chat"
            onBack={onBack}
            onClose={onClose}
            width="max-w-4xl"
            z="z-[160]"
        >
            <div className="flex h-[70vh] flex-col">
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-5 dark:bg-lc-bg">
                    {messages.length === 0 ? (
                        <div className="grid h-full min-h-[260px] place-items-center text-center">
                            <div>
                                <span className={`material-symbols-outlined text-5xl ${loading ? "animate-pulse text-primary" : "text-slate-300"}`}>
                                    {loading ? "hourglass_top" : "chat"}
                                </span>
                                <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    {loading ? "Loading messages..." : "No messages yet."}
                                </p>
                            </div>
                        </div>
                    ) : messages.map((message) => (
                        <div key={message.id} className={`flex ${message.senderType === "company" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[78%] rounded-lg px-4 py-3 shadow-sm ${message.senderType === "company" ? "bg-primary text-white" : "bg-white text-slate-800 dark:bg-lc-surface dark:text-slate-100"} ${message.pending ? "opacity-80" : ""} ${message.failed ? "ring-2 ring-red-300" : ""}`}>
                                <p className="text-xs font-bold opacity-75">
                                    {message.senderName} - {message.failed ? "Not sent" : message.pending ? "Sending..." : formatDate(message.createdAt)}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                            </div>
                        </div>
                    ))}
                    <div ref={bottomRef} />
                </div>
                {error ? <p className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">{error}</p> : null}
                <div className="flex gap-3 border-t border-slate-200 p-4 dark:border-lc-border">
                    <textarea
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                onSend();
                            }
                        }}
                        placeholder="Message the candidate"
                        rows={2}
                        className="min-h-[52px] flex-1 resize-none rounded-lg border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                    />
                    <button
                        type="button"
                        onClick={onSend}
                        disabled={sending || !input.trim()}
                        className="flex min-h-[52px] w-14 items-center justify-center rounded-lg bg-primary text-white disabled:opacity-50"
                        aria-label="Send message"
                    >
                        <span className="material-symbols-outlined">send</span>
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

function ProfileModal({ candidate, loading, onBack, onClose }: { candidate: DirectCandidate; loading: boolean; onBack: () => void; onClose: () => void }) {
    const profile = candidate.profile;
    const skills = profile?.skills || [];
    const fullName = candidate.candidate.name || "Candidate";
    const location = profile ? profileLocation(profile, candidate) : candidate.candidate.location || "";

    return (
        <ModalShell
            title="Candidate profile"
            subtitle={`${candidate.candidate.name} - ${candidate.candidate.email}`}
            icon="person_search"
            onBack={onBack}
            onClose={onClose}
            width="max-w-6xl"
            z="z-[160]"
        >
            {loading ? (
                <ModalLoadingState label="Loading candidate profile" />
            ) : !profile ? (
                <div className="grid min-h-[360px] place-items-center p-6 text-center">
                    <div>
                        <span className="material-symbols-outlined text-5xl text-slate-300">person_off</span>
                        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">This candidate has not published a job profile yet.</p>
                    </div>
                </div>
            ) : (
                <div className="max-h-[78vh] overflow-y-auto bg-slate-50 p-5 dark:bg-lc-bg">
                    <div className="space-y-5">
                        <main className="space-y-5">
                            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                                <div
                                    className="relative h-[220px] bg-cover bg-center"
                                    style={profile.coverImageUrl ? { backgroundImage: `url(${profile.coverImageUrl})` } : { background: DEFAULT_COVER }}
                                >
                                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.35),transparent_26%),linear-gradient(120deg,rgba(15,23,42,.18),rgba(15,23,42,.45))]" />
                                </div>

                                <div className="relative px-5 pb-6 pt-20">
                                    <div className="absolute -top-20 left-5 size-36 overflow-hidden rounded-full border-4 border-white bg-white shadow-lg dark:border-lc-surface dark:bg-lc-surface">
                                        {candidate.candidate.avatarUrl ? (
                                            <img src={candidate.candidate.avatarUrl} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="grid h-full w-full place-items-center bg-primary font-nunito text-4xl font-black text-white">{initials(fullName)}</div>
                                        )}
                                    </div>

                                    <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="font-nunito text-[34px] font-extrabold leading-tight text-slate-950 dark:text-white">{fullName}</h3>
                                                {profile.pronouns ? <span className="text-base font-semibold text-slate-500 dark:text-slate-400">{profile.pronouns}</span> : null}
                                                {!profile.isPublished ? (
                                                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
                                                        Draft
                                                    </span>
                                                ) : null}
                                            </div>
                                            <p className="mt-2 max-w-3xl text-[18px] leading-snug text-slate-900 dark:text-slate-100">
                                                {profile.headline || "Profile headline not added"}
                                            </p>
                                            <p className="mt-2 text-[15px] font-semibold text-slate-500 dark:text-slate-400">
                                                {[location, profile.industry].filter(Boolean).join(" - ") || "Candidate details are limited."}
                                                {candidate.candidate.linkedinUrl ? (
                                                    <>
                                                        <span> - </span>
                                                        <a className="text-primary hover:underline" href={profileExternalUrl(candidate.candidate.linkedinUrl)} target="_blank" rel="noreferrer">
                                                            LinkedIn
                                                        </a>
                                                    </>
                                                ) : null}
                                            </p>
                                            {profile.openTo ? <p className="mt-3 font-bold text-primary">Open to: {profile.openTo}</p> : null}
                                            <div className="mt-5 flex flex-wrap gap-3">
                                                {candidate.candidate.profileUrl ? (
                                                    <a
                                                        href={candidate.candidate.profileUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                                                        Open public profile
                                                    </a>
                                                ) : null}
                                                {candidate.candidate.website ? (
                                                    <a
                                                        href={profileExternalUrl(candidate.candidate.website)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 dark:border-lc-border dark:text-slate-100 dark:hover:bg-lc-hover"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">language</span>
                                                        Website
                                                    </a>
                                                ) : null}
                                                {candidate.candidate.githubUrl ? (
                                                    <a
                                                        href={profileExternalUrl(candidate.candidate.githubUrl)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 dark:border-lc-border dark:text-slate-100 dark:hover:bg-lc-hover"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">code</span>
                                                        GitHub
                                                    </a>
                                                ) : null}
                                            </div>
                                        </div>

                                        <div className="space-y-3 text-sm">
                                            <div className="rounded-lg bg-slate-50 p-4 dark:bg-lc-hover">
                                                <p className="font-bold text-slate-950 dark:text-white">Recruiter URL</p>
                                                <p className="mt-1 break-all font-semibold text-primary">{candidate.candidate.profileUrl || "No username set"}</p>
                                            </div>
                                            <div className="rounded-lg bg-slate-50 p-4 dark:bg-lc-hover">
                                                <p className="font-bold text-slate-950 dark:text-white">Featured resume</p>
                                                <p className="mt-1 text-slate-600 dark:text-slate-300">{profile.selectedResumeId ? "Resume selected on profile" : "No resume selected"}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <ProfileSection title="About">
                                <p className="whitespace-pre-line text-[16px] leading-7 text-slate-800 dark:text-slate-200">
                                    {profile.about || "No profile summary added yet."}
                                </p>
                            </ProfileSection>

                            <ProfileSection title="Featured">
                                <ProfileFeaturedGrid items={profile.featured || []} />
                            </ProfileSection>

                            <ProfileSection title="Projects">
                                <ProfileProjectGrid items={profile.projects || []} />
                            </ProfileSection>

                            <ProfileSection title="Experience">
                                <ProfileTimeline items={profile.experiences || []} variant="experience" />
                            </ProfileSection>

                            <ProfileSection title="Education">
                                <ProfileTimeline items={profile.education || []} variant="education" />
                            </ProfileSection>

                            <ProfileSection title="Skills">
                                <ProfileSkills items={skills} />
                            </ProfileSection>

                            <ProfileSection title="Coding profiles">
                                <ProfileCodingProfiles profile={profile} />
                            </ProfileSection>
                        </main>
                    </div>
                </div>
            )}
        </ModalShell>
    );
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
            <div className="px-5 py-4">
                <h3 className="font-nunito text-[22px] font-extrabold text-slate-950 dark:text-white">{title}</h3>
            </div>
            <div className="px-5 pb-5">
                {children}
            </div>
        </section>
    );
}

function ProfileFeaturedGrid({ items }: { items: Array<Record<string, any>> }) {
    if (!items.length) {
        return <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No featured work added yet.</p>;
    }

    return (
        <div className="grid gap-4 md:grid-cols-2">
            {items.map((item, index) => (
                <article key={item.id || `featured-${index}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                    <div className="h-40 bg-slate-100 dark:bg-lc-hover">
                        {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                            <div className="grid h-full place-items-center text-primary">
                                <span className="material-symbols-outlined text-[48px]">workspaces</span>
                            </div>
                        )}
                    </div>
                    <div className="p-4">
                        <h4 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{item.title || `Featured ${index + 1}`}</h4>
                        {item.description ? <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p> : null}
                        {item.linkUrl ? (
                            <a href={profileExternalUrl(item.linkUrl)} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-extrabold text-primary hover:underline">
                                {displayUrlLabel(item.linkUrl)}
                            </a>
                        ) : null}
                    </div>
                </article>
            ))}
        </div>
    );
}

function ProfileProjectGrid({ items }: { items: Array<Record<string, any>> }) {
    if (!items.length) {
        return <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No projects added yet.</p>;
    }

    return (
        <div className="grid gap-4 md:grid-cols-2">
            {items.map((project, index) => (
                <article key={project.id || `project-${index}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                    <div className="h-44 bg-slate-100 dark:bg-lc-hover">
                        {project.imageUrl ? (
                            <img src={project.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                            <div className="grid h-full place-items-center text-primary">
                                <span className="material-symbols-outlined text-[48px]">deployed_code</span>
                            </div>
                        )}
                    </div>
                    <div className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h4 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{project.title || `Project ${index + 1}`}</h4>
                                {project.role ? <p className="text-sm font-bold text-primary">{project.role}</p> : null}
                            </div>
                            {project.startDate || project.endDate ? <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{monthRange(project.startDate, project.endDate)}</p> : null}
                        </div>
                        {project.description ? <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-700 dark:text-slate-300">{project.description}</p> : null}
                        {Array.isArray(project.technologies) && project.technologies.length ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                                {project.technologies.slice(0, 8).map((tech: string) => (
                                    <span key={tech} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-lc-hover dark:text-slate-200">{tech}</span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </article>
            ))}
        </div>
    );
}

function ProfileTimeline({ items, variant }: { items: Array<Record<string, any>>; variant: "experience" | "education" }) {
    if (!items.length) {
        return <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{variant === "experience" ? "No experience added yet." : "No education added yet."}</p>;
    }

    return (
        <div className="space-y-5">
            {items.map((item, index) => {
                const title = variant === "education" ? item.school : item.title;
                const subtitle = variant === "education"
                    ? [item.degree, item.field].filter(Boolean).join(" in ")
                    : [item.company, item.employmentType].filter(Boolean).join(" - ");
                const meta = variant === "education"
                    ? monthRange(item.startDate, item.endDate)
                    : [monthRange(item.startDate, item.endDate), item.location, item.locationType].filter(Boolean).join(" - ");

                return (
                    <div key={item.id || `${variant}-${index}`} className={`flex gap-4 ${index > 0 ? "border-t border-slate-200 pt-5 dark:border-lc-border" : ""}`}>
                        <ProfileLogoMark src={item.logoUrl} label={title || subtitle || variant} />
                        <div className="min-w-0">
                            <h4 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title || `${statusCopy(variant)} ${index + 1}`}</h4>
                            {subtitle ? <p className="font-semibold text-slate-800 dark:text-slate-200">{subtitle}</p> : null}
                            {meta ? <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{meta}</p> : null}
                            {item.description ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700 dark:text-slate-300">{item.description}</p> : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ProfileLogoMark({ src, label }: { src?: string | null; label?: string | null }) {
    if (src) {
        return <img src={src} alt="" className="size-12 rounded-md border border-slate-200 object-cover dark:border-lc-border" />;
    }

    return (
        <div className="grid size-12 shrink-0 place-items-center rounded-md bg-slate-100 font-nunito font-black text-slate-700 dark:bg-lc-hover dark:text-slate-200">
            {initials(label || "P")}
        </div>
    );
}

function ProfileSkills({ items }: { items: NonNullable<CandidateProfile>["skills"] }) {
    const normalized = (items || []).filter((skill) => normalizeSkill(skill));
    if (!normalized.length) {
        return <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No skills added yet.</p>;
    }

    return (
        <div className="space-y-4">
            {normalized.slice(0, 12).map((skill, index) => {
                const name = normalizeSkill(skill);
                const context = typeof skill === "string" ? "" : skill.context || "";
                return (
                    <div key={skillKey(skill, index)} className={index > 0 ? "border-t border-slate-200 pt-4 dark:border-lc-border" : ""}>
                        <h4 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{name}</h4>
                        {context ? <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{context}</p> : null}
                    </div>
                );
            })}
        </div>
    );
}

function ProfileCodingProfiles({ profile }: { profile: NonNullable<CandidateProfile> }) {
    const links = CODING_PROFILE_ITEMS
        .map((item) => ({ ...item, url: String(profile[item.key] || "").trim() }))
        .filter((item) => item.url);

    if (!links.length) {
        return <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No coding profiles added yet.</p>;
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {links.map((item) => (
                <a
                    key={item.key}
                    href={profileExternalUrl(item.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm font-extrabold text-slate-800 transition hover:border-primary hover:text-primary dark:border-lc-border dark:text-slate-100"
                >
                    <span>{item.label}</span>
                    <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                </a>
            ))}
        </div>
    );
}

function JourneyModal({ candidate, loading, onBack, onClose }: { candidate: DirectCandidate; loading: boolean; onBack: () => void; onClose: () => void }) {
    const [selectedRound, setSelectedRound] = useState<JourneyRound | null>(null);
    const [selectedSubmission, setSelectedSubmission] = useState<{ round: JourneyRound; submission: JourneySubmission } | null>(null);
    const inReportView = Boolean(selectedRound || selectedSubmission);
    const activeTitle = selectedSubmission ? "Assignment report" : selectedRound ? "Detailed report" : "Candidate journey";
    const activeSubtitle = selectedSubmission
        ? `${candidate.candidate.name} - ${selectedSubmission.round.title}`
        : selectedRound
            ? `${candidate.candidate.name} - ${selectedRound.title}`
            : `${candidate.candidate.name} - ${candidate.candidate.email}`;
    const activeIcon = selectedSubmission ? "description" : selectedRound ? "analytics" : "route";
    const activeWidth = inReportView ? "max-w-6xl" : "max-w-5xl";

    function backWithinJourney() {
        if (selectedSubmission) {
            setSelectedSubmission(null);
            return;
        }
        if (selectedRound) {
            setSelectedRound(null);
            return;
        }
        onBack();
    }

    return (
        <ModalShell
            title={activeTitle}
            subtitle={activeSubtitle}
            icon={activeIcon}
            onBack={backWithinJourney}
            onClose={onClose}
            width={activeWidth}
            z="z-[160]"
        >
            {loading ? (
                <ModalLoadingState label="Loading candidate journey" />
            ) : selectedSubmission ? (
                <div className="max-h-[78vh] overflow-y-auto bg-slate-50 p-6 dark:bg-lc-bg">
                    <AssignmentRoundReport
                        report={{
                            overallScore: selectedSubmission.submission.score,
                            aiSummary: String(selectedSubmission.submission.report?.summary || ""),
                            strengths: Array.isArray(selectedSubmission.submission.report?.strengths) ? selectedSubmission.submission.report.strengths : [],
                            risks: Array.isArray(selectedSubmission.submission.report?.risks) ? selectedSubmission.submission.report.risks : [],
                            detail: selectedSubmission.submission.report || {},
                            rubricBreakdown: selectedSubmission.submission.report?.rubric || null,
                            evaluatedAt: selectedSubmission.submission.submittedAt,
                        }}
                        repoUrl={selectedSubmission.submission.repoUrl}
                    />
                </div>
            ) : selectedRound?.report ? (
                <RoundReportContent round={selectedRound} />
            ) : (
                <div className="max-h-[76vh] overflow-y-auto p-6">
                    {candidate.journey.length === 0 ? (
                        <div className="grid min-h-[320px] place-items-center text-center">
                            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No journey data available yet.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {candidate.journey.map((round) => (
                                <article key={round.id} className="rounded-lg border border-slate-200 p-5 dark:border-lc-border">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <p className="text-sm font-bold uppercase text-slate-400 dark:text-slate-500">Round {round.roundNumber || "-"} - {statusCopy(round.roundType)}</p>
                                            <h3 className="mt-1 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{round.title}</h3>
                                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                Status: {statusCopy(round.status)}
                                                {round.report ? ` - Score: ${round.report.overallScore ?? round.score ?? 0}/100` : ""}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                         
                                            {round.report ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedRound(round)}
                                                    className="inline-flex items-center gap-2 rounded-full border border-primary/25 px-4 py-2 text-xs font-extrabold text-primary transition hover:bg-primary hover:text-white"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">analytics</span>
                                                    View detailed report
                                                </button>
                                            ) : (
                                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-500 dark:bg-lc-hover dark:text-slate-300">No report yet</span>
                                            )}
                                        </div>
                                    </div>
                                    {round.report?.aiSummary ? <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{round.report.aiSummary}</p> : null}
                                    {round.report?.risks?.length ? (
                                        <div className="mt-4 rounded-lg bg-amber-50 p-4 dark:bg-amber-400/10">
                                            <p className="text-sm font-extrabold text-amber-800 dark:text-amber-200">Problems to discuss</p>
                                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-800 dark:text-amber-100">
                                                {round.report.risks.slice(0, 4).map((risk) => <li key={risk}>{risk}</li>)}
                                            </ul>
                                        </div>
                                    ) : null}
                                    {round.submissions?.length ? (
                                        <div className="mt-4 space-y-2">
                                            {round.submissions.map((submission) => (
                                                <div key={submission.id} className="flex flex-col gap-3 rounded-lg bg-slate-50 p-4 dark:bg-lc-hover sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <p className="font-nunito text-base font-extrabold text-slate-950 dark:text-white">{submission.title}</p>
                                                        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{statusCopy(submission.status)} - {submission.score}/100 - {formatLongDate(submission.submittedAt)}</p>
                                                    </div>
                                                    {submission.report && Object.keys(submission.report).length ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedSubmission({ round, submission })}
                                                            className="inline-flex items-center justify-center gap-2 rounded-full border border-primary/25 px-4 py-2 text-xs font-extrabold text-primary transition hover:bg-primary hover:text-white"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">description</span>
                                                            Assignment report
                                                        </button>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </article>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </ModalShell>
    );
}

function RoundReportContent({ round }: { round: JourneyRound }) {
    const report = round.report;
    if (!report) return null;

    const detail = asPlainRecord(report.detail);
    const hasRecruiterScorecard = Boolean(detail.agentSummary || detail.projectSlots || detail.charts || detail.scoringConfig);
    const hasAssignmentReport = round.roundType === "technical_assignment" || Array.isArray(detail.rubric) || Boolean(detail.summary && (detail.strengths || detail.risks));

    return (
        <div className="max-h-[78vh] overflow-y-auto bg-slate-50 p-6 dark:bg-lc-bg">
            {hasRecruiterScorecard ? (
                <RecruiterRoundReport report={report} />
            ) : hasAssignmentReport ? (
                <AssignmentRoundReport report={report} repoUrl={round.submissions?.[0]?.repoUrl} />
            ) : (
                <GenericRoundReport report={report} />
            )}
        </div>
    );
}

function RecruiterRoundReport({ report }: { report: NonNullable<JourneyRound["report"]> }) {
    const detail = asPlainRecord(report.detail);
    const charts = asPlainRecord(detail.charts);
    const scoringConfig = asPlainRecord(detail.scoringConfig);
    const weights = asPlainRecord(scoringConfig.weights);
    const agents = asPlainRecord(detail.agentSummary);
    const profileAgent = asPlainRecord(agents.profileSummary);
    const projectAgent = asPlainRecord(agents.projectQuality);
    const stackAgent = asPlainRecord(agents.techStackMatch);
    const domainAgent = asPlainRecord(agents.domainRelevance);
    const codingAgent = asPlainRecord(agents.codingProfile);
    const synthesisAgent = asPlainRecord(agents.finalSynthesis);
    const projectSlots = Array.isArray(detail.projectSlots) ? detail.projectSlots.map(asPlainRecord) : [];
    const isolatedSlots = Array.isArray(projectAgent.slots) ? projectAgent.slots.map(asPlainRecord) : [];
    const coding = asPlainRecord(detail.coding);
    const overall = reportScore(detail.overallScore ?? report.overallScore);
    const github = reportScore(detail.githubScore);
    const codingScore = reportScore(detail.codingScore);

    return (
        <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <ReportScoreRing value={overall} label="Overall fit" />
                    <p className="mt-4 text-center text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                        {String(detail.recommendation || report.recommendation || "Scorecard recommendation unavailable.")}
                    </p>
                </section>
                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Score split</h3>
                    <div className="mt-4">
                        <ReportBarChart items={Array.isArray(charts.overall) ? charts.overall : [
                            { label: "GitHub", value: github, weight: weights.github || 60 },
                            { label: "Coding", value: codingScore, weight: weights.coding || 40 },
                        ]} />
                    </div>
                    <div className="mt-5 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                        {reportTextArray(detail.summary, 4).map((item, index) => <p key={`summary-${index}-${item}`}>{item}</p>)}
                    </div>
                </section>
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Profile summary</h3>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    {String(detail.profileSummary || report.aiSummary || "No recruiter profile summary available.")}
                </p>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
                <ReportAgentCard
                    title="Candidate summary agent"
                    score={reportOptionalScore(profileAgent.profileScore)}
                    summary={profileAgent.oneLineVerdict || reportTextArray(profileAgent.bioLines, 3).join(" ")}
                    positives={profileAgent.relevantStrengths || profileAgent.roleRelevantStrengths}
                    gaps={profileAgent.gapsForThisRole || profileAgent.profileGaps}
                    chartItems={profileAgent.chartData}
                />
                <ReportAgentCard
                    title="Project quality agent"
                    score={reportOptionalScore(projectAgent.projectQualityScore)}
                    summary="Evaluates repo structure, README, commit discipline, ownership, tests, forks, and maintainability."
                    positives={Array.isArray(projectAgent.slots) ? projectAgent.slots.flatMap((slot: any) => asPlainRecord(slot).evidence || []) : []}
                    gaps={Array.isArray(projectAgent.slots) ? projectAgent.slots.flatMap((slot: any) => asPlainRecord(slot).risks || []) : []}
                    chartItems={projectAgent.graphData}
                />
                <ReportAgentCard
                    title="Tech stack match agent"
                    score={reportOptionalScore(stackAgent.stackMatchScore)}
                    summary="Checks required stack coverage across the selected projects."
                    positives={Array.isArray(stackAgent.technologies) ? stackAgent.technologies.filter((item: any) => item?.matched).map((item: any) => `${item.name}: ${item.coverage}% coverage`) : []}
                    gaps={stackAgent.missingCriticalStack}
                    chartItems={stackAgent.graphData}
                />
                <ReportAgentCard
                    title="Domain relevance agent"
                    score={reportOptionalScore(domainAgent.domainScore)}
                    summary="Checks whether projects match the product domain and role responsibilities."
                    positives={Array.isArray(domainAgent.domainCoverage) ? domainAgent.domainCoverage.map((item: any) => `${item.domainOrResponsibility}: ${item.coverage}%`) : []}
                    gaps={domainAgent.genericProjectRisks}
                    chartItems={domainAgent.graphData}
                />
                <ReportAgentCard
                    title="Coding signal agent"
                    score={reportOptionalScore(codingAgent.codingScore)}
                    summary="Coding profile is compared against the company's threshold for this opening."
                    positives={Array.isArray(codingAgent.platformBreakdown) ? codingAgent.platformBreakdown.map((item: any) => `${item.platform}: ${item.score}/100 - ${item.reason}`) : []}
                    gaps={codingAgent.thresholdGaps}
                    chartItems={codingAgent.graphData}
                />
                <ReportAgentCard
                    title="Final synthesis agent"
                    score={reportOptionalScore(synthesisAgent.overallScore)}
                    summary={synthesisAgent.recommendation}
                    positives={synthesisAgent.hireReasons || synthesisAgent.onePageSummary}
                    gaps={synthesisAgent.rejectReasons || synthesisAgent.interviewFocus}
                    chartItems={synthesisAgent.visualSummary}
                />
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">GitHub project slots</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Each selected project contributes to the GitHub scorecard used by this job.</p>
                {projectSlots.length ? (
                    <div className="mt-5 grid gap-4 lg:grid-cols-3">
                        {projectSlots.map((project, index) => {
                            const isolatedSlot = isolatedSlots[index] || {};
                            const isolatedBars = Array.isArray(isolatedSlot.qualityBars) ? isolatedSlot.qualityBars : [];
                            const evidence = reportTextArray(isolatedSlot.evidence);
                            const risks = reportTextArray(isolatedSlot.risks);

                            return (
                                <div key={`${project.title || "project"}-${index}`} className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">Slot {index + 1} - {String(isolatedSlot.status || project.status || "reviewed")}</p>
                                            <h4 className="mt-1 font-bold text-slate-950 dark:text-white">{String(project.title || `Project ${index + 1}`)}</h4>
                                        </div>
                                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">{reportScore(isolatedSlot.score ?? project.score)}/100</span>
                                    </div>
                                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{String(isolatedSlot.slotVerdict || project.summary || "No project verdict available.")}</p>
                                    {isolatedBars.length ? (
                                        <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-lc-hover">
                                            <ReportBarChart items={isolatedBars.slice(0, 5)} />
                                        </div>
                                    ) : null}
                                    {evidence.length || risks.length ? (
                                        <div className="mt-4 grid gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            {evidence.length ? <p>Evidence: {evidence.join(" ")}</p> : null}
                                            {risks.length ? <p>Watch: {risks.join(" ")}</p> : null}
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">No project slot details available.</p>
                )}
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Coding scorecard</h3>
                    <div className="mt-4">
                        <ReportBarChart items={Array.isArray(charts.coding) ? charts.coding : []} />
                    </div>
                    <div className="mt-5">
                        <ReportCriteriaTable rows={coding.breakdown} />
                    </div>
                </section>
                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Company criteria</h3>
                    <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                        <p>GitHub/Coding weight: {String(weights.github || 60)}% / {String(weights.coding || 40)}%</p>
                        <p>Required stack: {Array.isArray(asPlainRecord(scoringConfig.github).requiredTechStack) ? asPlainRecord(scoringConfig.github).requiredTechStack.join(", ") : "Falls back to job skills"}</p>
                        <p>Project focus: {Array.isArray(asPlainRecord(scoringConfig.github).focusAreas) ? asPlainRecord(scoringConfig.github).focusAreas.join(", ") : "Falls back to role skills and responsibilities"}</p>
                    </div>
                </section>
            </div>
        </div>
    );
}

function AssignmentRoundReport({ report, repoUrl }: { report: NonNullable<JourneyRound["report"]>; repoUrl?: string | null }) {
    const detail = asPlainRecord(report.detail);
    const strengths = reportTextArray(detail.strengths, 10).length ? reportTextArray(detail.strengths, 10) : report.strengths || [];
    const risks = reportTextArray(detail.risks, 10).length ? reportTextArray(detail.risks, 10) : report.risks || [];
    const rubricSource = detail.rubric || report.rubricBreakdown || asPlainRecord(report.evidenceSnapshot).scorecard;

    return (
        <main className="space-y-5">
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Overall assignment score</p>
                    <p className="mt-1 font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">{reportScore(detail.overallScore ?? report.overallScore)}/100</p>
                </div>
                {repoUrl ? (
                    <a href={repoUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-full border border-primary/20 px-4 py-2 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                        Open repository
                    </a>
                ) : null}
            </section>
            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Evaluator summary</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{String(detail.summary || report.aiSummary || "No evaluator summary available.")}</p>
            </section>
            <div className="grid gap-5 md:grid-cols-2">
                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Strengths</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {(strengths.length ? strengths : ["No strengths were returned for this report."]).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                    </ul>
                </section>
                <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-300/30 dark:bg-amber-300/10">
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Watchouts</h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-amber-800 dark:text-amber-100">
                        {(risks.length ? risks : ["No major watchouts were returned for this report."]).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                    </ul>
                </section>
            </div>
            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Rubric breakdown</h3>
                <div className="mt-4">
                    <ReportCriteriaTable rows={rubricSource} />
                </div>
            </section>
        </main>
    );
}

function GenericRoundReport({ report }: { report: NonNullable<JourneyRound["report"]> }) {
    const detail = asPlainRecord(report.detail);
    const rows = reportRows(report.rubricBreakdown || detail.rubric || asPlainRecord(report.evidenceSnapshot).scorecard);
    const strengths = reportTextArray(detail.strengths).length ? reportTextArray(detail.strengths) : report.strengths || [];
    const risks = reportTextArray(detail.risks).length ? reportTextArray(detail.risks) : report.risks || [];
    const detailEntries = Object.entries(detail)
        .filter(([key]) => !["summary", "strengths", "risks", "rubric"].includes(key))
        .slice(0, 8);

    return (
        <main className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                <div className="grid gap-5 md:grid-cols-[180px_1fr]">
                    <ReportScoreRing value={reportScore(detail.overallScore ?? report.overallScore)} label="Overall score" />
                    <div>
                        <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Report summary</h3>
                        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{String(detail.summary || detail.headline || report.aiSummary || "No report summary available.")}</p>
                        {detail.recommendation || report.recommendation ? <p className="mt-3 text-sm font-bold text-primary">{String(detail.recommendation || report.recommendation)}</p> : null}
                    </div>
                </div>
            </section>
            {(strengths.length || risks.length) ? (
                <div className="grid gap-5 md:grid-cols-2">
                    <ReportList title="Strengths" items={strengths} />
                    <ReportList title="Watchouts" items={risks} tone="warning" />
                </div>
            ) : null}
            {rows.length ? (
                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Rubric breakdown</h3>
                    <div className="mt-4">
                        <ReportCriteriaTable rows={rows} />
                    </div>
                </section>
            ) : null}
            {detailEntries.length ? (
                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Additional report data</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {detailEntries.map(([key, value]) => (
                            <div key={key} className="rounded-lg bg-slate-50 p-4 dark:bg-lc-hover">
                                <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">{statusCopy(key)}</p>
                                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{Array.isArray(value) ? reportTextArray(value, 4).join(" ") : reportValueText(value) || "Available in stored report."}</p>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
        </main>
    );
}

function ReportScoreRing({ value, label }: { value: number; label: string }) {
    const pct = reportScore(value);
    return (
        <div className="grid place-items-center gap-2">
            <div
                className="grid size-28 place-items-center rounded-full"
                style={{ background: `conic-gradient(#4f7cff ${pct * 3.6}deg, rgba(148,163,184,.22) 0deg)` }}
            >
                <div className="grid size-20 place-items-center rounded-full bg-white font-nunito text-2xl font-extrabold text-slate-950 dark:bg-lc-surface dark:text-white">
                    {pct}
                </div>
            </div>
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</p>
        </div>
    );
}

function ReportBarChart({ items }: { items?: unknown }) {
    const clean = Array.isArray(items) ? items : [];
    if (!clean.length) return <p className="text-sm text-slate-500 dark:text-slate-400">No score rows available.</p>;

    return (
        <div className="grid gap-3">
            {clean.map((item, index) => {
                const row = asPlainRecord(item);
                const label = String(row.label || row.name || row.title || `Score ${index + 1}`);
                const value = reportScore(row.value ?? row.score);
                const subLabel = row.weight ? `${row.weight}%` : row.status ? String(row.status) : "";
                return (
                    <div key={`${label}-${index}`}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold text-slate-500 dark:text-slate-400">
                            <span className="truncate">{label}</span>
                            <span>{value}/100{subLabel ? ` - ${subLabel}` : ""}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-lc-hover">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ReportCriteriaTable({ rows }: { rows?: unknown }) {
    const clean = reportRows(rows);
    if (!clean.length) return <p className="text-sm text-slate-500 dark:text-slate-400"></p>;

    return (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-lc-border">
            {clean.map((row, index) => (
                <div key={`${row.label}-${index}`} className="grid gap-2 border-b border-slate-200 px-4 py-3 last:border-b-0 dark:border-lc-border md:grid-cols-[170px_1fr_90px] md:items-center">
                    <div className="font-bold text-slate-950 dark:text-white">{row.label}</div>
                    <div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-lc-hover">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${reportScore(row.score)}%` }} />
                        </div>
                        {row.note ? <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{row.note}</p> : null}
                    </div>
                    <div className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{reportScore(row.score)}/100</div>
                </div>
            ))}
        </div>
    );
}

function ReportList({ title, items, tone = "default" }: { title: string; items: string[]; tone?: "default" | "warning" }) {
    const warning = tone === "warning";
    return (
        <section className={`rounded-lg border p-5 ${warning ? "border-amber-200 bg-amber-50 dark:border-amber-300/30 dark:bg-amber-300/10" : "border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface"}`}>
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <ul className={`mt-3 list-disc space-y-2 pl-5 text-sm leading-6 ${warning ? "text-amber-800 dark:text-amber-100" : "text-slate-600 dark:text-slate-300"}`}>
                {(items.length ? items : ["No data returned."]).map((item, index) => <li key={`${title}-${item}-${index}`}>{item}</li>)}
            </ul>
        </section>
    );
}

function ReportAgentCard({
    title,
    score,
    summary,
    positives,
    gaps,
    chartItems,
}: {
    title: string;
    score?: number;
    summary?: unknown;
    positives?: unknown;
    gaps?: unknown;
    chartItems?: unknown;
}) {
    const good = reportTextArray(positives);
    const watch = reportTextArray(gaps);
    const chart = Array.isArray(chartItems) ? chartItems : [];

    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
                    {summary ? <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{reportValueText(summary)}</p> : null}
                </div>
                {typeof score === "number" ? <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">{score}/100</span> : null}
            </div>
            {chart.length ? (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-lc-hover">
                    <ReportBarChart items={chart.slice(0, 5)} />
                </div>
            ) : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300">Evidence</p>
                    <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
                        {(good.length ? good : ["No positive evidence returned by this agent."]).map((item, index) => <li key={`evidence-${index}-${item}`}>{item}</li>)}
                    </ul>
                </div>
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">Watch</p>
                    <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
                        {(watch.length ? watch : ["No major gap returned by this agent."]).map((item, index) => <li key={`watch-${index}-${item}`}>{item}</li>)}
                    </ul>
                </div>
            </div>
        </section>
    );
}

function StartModal({ candidate, onBack, onClose }: { candidate: DirectCandidate; onBack: () => void; onClose: () => void }) {
    return (
        <ModalShell
            title="Start interview"
            subtitle={`${candidate.candidate.name} - ${candidate.schedule?.scheduledAt ? formatLongDate(candidate.schedule.scheduledAt) : "Not scheduled yet"}`}
            icon="play_arrow"
            onBack={onBack}
            onClose={onClose}
            width="max-w-2xl"
            z="z-[160]"
        >
            <div className="grid min-h-[280px] place-items-center p-6 text-center">
                <div>
                    <span className="mx-auto flex size-16 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <span className="material-symbols-outlined text-4xl">construction</span>
                    </span>
                    <h3 className="mt-4 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Currently under development</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">The live direct interview room will open from here once it is ready.</p>
                </div>
            </div>
        </ModalShell>
    );
}
