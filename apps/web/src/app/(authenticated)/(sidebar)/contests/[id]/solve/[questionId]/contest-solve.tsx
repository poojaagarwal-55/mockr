"use client";

import { useState, useEffect, useRef, Suspense, Fragment, useCallback } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// Use the installed Monaco package so contest IDE startup does not wait on the CDN.
loader.config({ monaco });
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { LANGUAGE_MAP } from "@interviewforge/shared";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ModalDialog } from "@/components/modal-dialog";
import { ReportQuestionModal } from "@/components/report-question-modal";
import { AddToSheetModal } from "@/components/add-to-sheet-modal";
import { updateLastQuestionDate } from "@/lib/notifications";
import {
    UpgradeModal,
    copyFromUpgradeError,
    shouldShowUpgradeForError,
} from "@/components/upgrade-modal";
import { useBilling } from "@/hooks/use-billing";
import { useAuth } from "@/context/auth-context";
import {
    clearContestCodeDrafts,
    getContestAutoSubmissionType,
    getContestBlockedShortcutReason,
    normalizeClipboardText,
} from "@/lib/contest-integrity";
import { QuestionExampleValue, RichQuestionContent } from "@/components/question-content/rich-question-content";

// Types for solution structure
interface SolutionApproach {
    explaination?: string;
    description?: string;
    explanation?: string;
    timeComplexity?: string;
    spaceComplexity?: string;
    code?: Record<string, string>;
}

interface Solution {
    bruteForce?: SolutionApproach;
    optimized?: SolutionApproach;
}

interface Question {
    id: string;
    title: string;
    statement: string;
    difficulty: string;
    constraints?: string | string[] | Record<string, unknown>;
    examples: Array<{
        input: string;
        output: string;
        explanation?: string;
    }>;
    topics?: string[];
    companyTags?: string[];
    starter_code: Record<string, string>;
    sample_tests: any[];
    solution?: Solution;
}

const JUDGE0_LANGUAGE_IDS: Record<string, number> = {
    python: 71,
    python3: 71,
    javascript: 93,
    typescript: 74,
    java: 62,
    cpp: 54,
    'c++': 54,
    c: 50,
    csharp: 51,
    go: 60,
    rust: 73,
    ruby: 72,
};

const RECORD_INTEGRITY_VIOLATIONS = true;
const CONTEST_INTEGRITY_WARNING_LIMIT = 10;

const LANGUAGE_KEY_CANDIDATES: Record<string, string[]> = {
    cpp: ["cpp", "c++", "cplusplus"],
    "c++": ["c++", "cpp", "cplusplus"],
    python: ["python", "python3"],
    python3: ["python3", "python"],
    java: ["java"],
    javascript: ["javascript", "js", "nodejs"],
    js: ["js", "javascript", "nodejs"],
    typescript: ["typescript", "ts"],
    ts: ["ts", "typescript"],
    c: ["c"],
    csharp: ["csharp", "c#"],
    "c#": ["c#", "csharp"],
    go: ["go", "golang"],
    rust: ["rust"],
    ruby: ["ruby"],
};

function getStarterCodeForLanguage(starterCode: Record<string, string> | undefined, language: string): string | undefined {
    if (!starterCode) return undefined;
    const normalizedLanguage = (language || "").trim().toLowerCase();
    const candidates = LANGUAGE_KEY_CANDIDATES[normalizedLanguage] || [normalizedLanguage];
    for (const candidate of candidates) {
        const snippet = starterCode[candidate];
        if (typeof snippet === "string" && snippet.trim()) {
            return snippet;
        }
    }
    return undefined;
}

function getDefaultLanguage(starterCode: Record<string, string> | undefined, preferred: string): string {
    if (!starterCode || Object.keys(starterCode).length === 0) return preferred;
    if (getStarterCodeForLanguage(starterCode, preferred)) return preferred;
    if (starterCode.cpp) return "cpp";
    if (starterCode["c++"]) return "c++";
    return Object.keys(starterCode)[0] || preferred;
}

function contestCodeDraftKey(contestId?: string | null, questionId?: string | null, language?: string | null) {
    if (!contestId || !questionId || !language) return null;
    return [
        "practers",
        "contest-code-draft",
        encodeURIComponent(contestId),
        encodeURIComponent(questionId),
        encodeURIComponent(language),
    ].join(":");
}

function getDifficultyLabel(difficulty?: string | null) {
    const value = String(difficulty || "").toUpperCase();
    if (value === "EASY") return "Easy";
    if (value === "MEDIUM") return "Medium";
    if (value === "HARD") return "Hard";
    return String(difficulty || "");
}

function getDifficultyBadgeClass(difficulty?: string | null) {
    const value = String(difficulty || "").toUpperCase();
    if (value === "EASY") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    if (value === "MEDIUM") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
}

function readContestCodeDraft(contestId?: string | null, questionId?: string | null, language?: string | null) {
    if (typeof window === "undefined") return null;
    const key = contestCodeDraftKey(contestId, questionId, language);
    if (!key) return null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeContestCodeDraft(contestId: string | null | undefined, questionId: string | null | undefined, language: string | null | undefined, code: string) {
    if (typeof window === "undefined") return;
    const key = contestCodeDraftKey(contestId, questionId, language);
    if (!key) return;
    try {
        window.localStorage.setItem(key, code);
    } catch {
        // localStorage can be unavailable in private/locked-down browsers.
    }
}

function normalizeComplexityValue(value?: string): string {
    const normalized = (value || "").trim();
    if (!normalized) return "";
    const lowered = normalized.toLowerCase();
    if (lowered === "unknown" || lowered === "n/a" || lowered === "na" || lowered === "none") return "";
    return normalized;
}

function cleanExplainationText(value?: string): string {
    const raw = (value || "").trim();
    if (!raw) return "";

    return raw
        .split("\n")
        .filter((line) => {
            const trimmed = line.trim().toLowerCase();
            return !trimmed.startsWith("time complexity:") && !trimmed.startsWith("space complexity:");
        })
        .join("\n")
        .trim();
}

const SUPPORTED_CODE_LANGUAGES = new Set([
    'python',
    'python3',
    'cpp',
    'c++',
    'java',
    'javascript',
    'typescript',
    'c',
    'csharp',
    'go',
    'rust',
    'ruby',
    'swift',
    'kotlin',
    'php',
]);

function getCodeLanguages(code?: Record<string, string>): string[] {
    if (!code) return [];
    return Object.keys(code).filter((lang) => SUPPORTED_CODE_LANGUAGES.has(lang.toLowerCase()));
}

function getTestResultKey(test: any, index: number): string {
    if (test?.id !== undefined && test?.id !== null && String(test.id).trim() !== "") {
        return String(test.id);
    }
    return `test-${index}`;
}

function buildUniformResultMap(tests: any[], status: string, extra: Record<string, any> = {}): Record<string, any> {
    const next: Record<string, any> = {};
    tests.forEach((test, index) => {
        next[getTestResultKey(test, index)] = { status, ...extra };
    });
    return next;
}

function getRunCaseStatus(test: unknown): string {
    const result = test && typeof test === "object"
        ? test as { passed?: unknown; status?: unknown }
        : {};
    if (result.passed === true) return "Accepted";
    const rawStatus = String(result.status || "").trim();
    return rawStatus.toLowerCase() === "accepted"
        ? "Wrong Answer"
        : rawStatus || "Wrong Answer";
}

function formatWaitSeconds(seconds: number): string {
    const safeSeconds = Math.max(0, Math.ceil(seconds));
    return `${safeSeconds} ${safeSeconds === 1 ? "second" : "seconds"}`;
}

function getConstraintLines(constraints: unknown): string[] {
    if (!constraints) return [];

    if (typeof constraints === "string") {
        const trimmed = constraints.trim();
        if (!trimmed) return [];
        const hasRichBlock = /:::\w+|!\[[^\]]*]\(|\$\$|\\\[|\\\]|\n\s*\n/m.test(trimmed);
        return hasRichBlock ? [trimmed] : trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }

    if (Array.isArray(constraints)) {
        return constraints.flatMap((item) => {
            if (typeof item === "string") {
                const trimmed = item.trim();
                return trimmed ? [trimmed] : [];
            }
            return getConstraintLines(item);
        });
    }

    if (typeof constraints === "object") {
        return Object.entries(constraints as Record<string, unknown>)
            .map(([key, value]) => {
                if (value === null || value === undefined || value === "") return "";
                const renderedValue =
                    typeof value === "object" ? JSON.stringify(value) : String(value);
                return `${key}: ${renderedValue}`;
            })
            .filter(Boolean);
    }

    return [String(constraints).trim()].filter(Boolean);
}

export interface SolvePageContentProps {
    questionId?: string;
    sheetId?: string | null;
    contestId?: string | null;
    mode?: "contest" | "secure_oa" | string | null;
    oaSessionId?: string;
    oaQuestionKey?: string;
    autoSubmitLimit?: number;
    embedded?: boolean;
}

export function SolvePageContent({
    questionId: questionIdOverride,
    sheetId: sheetIdOverride,
    contestId: contestIdOverride,
    mode: modeOverride,
    oaSessionId: oaSessionIdOverride,
    oaQuestionKey: oaQuestionKeyOverride,
    autoSubmitLimit: autoSubmitLimitOverride,
    embedded = false,
}: SolvePageContentProps = {}) {
    const params = useParams();
    const searchParams = useSearchParams();
    const questionId = questionIdOverride || (params.questionId as string) || searchParams.get("id");
    const sheetId = sheetIdOverride ?? searchParams.get("sheetId");
    const contestId = contestIdOverride ?? (params.id as string) ?? searchParams.get("contestId");
    const mode = modeOverride ?? searchParams.get("mode") ?? (params.id ? "contest" : null); // 'contest' mode hides solution/topics tabs
    const isContestMode = mode === "contest";
    const isSecureOaMode = mode === "secure_oa";
    const isIntegrityMode = isContestMode || isSecureOaMode;
    const oaSessionId = oaSessionIdOverride ?? searchParams.get("oaSessionId") ?? "";
    const oaQuestionKey = oaQuestionKeyOverride ?? searchParams.get("oaQuestionKey") ?? questionId ?? "";
    const autoSubmitLimit = Math.max(1, Math.min(20, Number(autoSubmitLimitOverride ?? searchParams.get("autoSubmitLimit") ?? 5) || 5));
    const { resolvedTheme } = useTheme();
    const { user, session, loading: authLoading } = useAuth();
    const { snapshot: billingSnapshot } = useBilling();
    const [mounted, setMounted] = useState(false);
    
    // State for navigation from sheet
    const [nextQuestionUrl, setNextQuestionUrl] = useState<string | null>(null);

    const [question, setQuestion] = useState<Question | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    const [language, setLanguage] = useState("cpp");
    const [code, setCode] = useState("// Loading...");
    const [tests, setTests] = useState<any[]>([]);
    const [results, setResults] = useState<Record<string, any>>({});
    const [isRunning, setIsRunning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [pastSubmissions, setPastSubmissions] = useState<any[]>([]);
    const [expandedSubmissionIndex, setExpandedSubmissionIndex] = useState<number | null>(null);
    const [isSolved, setIsSolved] = useState(false);
    const [showAddToSheet, setShowAddToSheet] = useState(false);
    const [activeTab, setActiveTab] = useState<"description" | "solution" | "submissions" | "result">("description");
    const [isTopicsExpanded, setIsTopicsExpanded] = useState(false);
    const [expandedSolution, setExpandedSolution] = useState<string | null>(null);
    const [selectedLanguage, setSelectedLanguage] = useState<Record<string, string>>({});
    const [submissionResult, setSubmissionResult] = useState<{
        status: "accepted" | "wrong_answer" | "error" | "compile_error";
        message: string;
        samplePassed?: number;
        sampleTotal?: number;
        hiddenPassed?: number;
        hiddenTotal?: number;
        failedTest?: {
            source: "sample" | "hidden";
            status?: string;
            input: string;
            expected: string;
            actual: string;
            stderr?: string;
            compileOutput?: string;
        };
        hiddenFailedTest?: {
            input: string;
            expected: string;
            actual: string;
        };
        errorDetails?: string;
        isDuplicateCooldown?: boolean;
    } | null>(null);
    const [testPanelTab, setTestPanelTab] = useState<"testcase" | "result">("testcase");
    const [activeTestCaseIndex, setActiveTestCaseIndex] = useState<number>(0);
    const customTestIdRef = useRef(0);

    // Append a user-defined custom test case (output only; never affects submit).
    // Seed it with the first sample's raw input so the user sees the exact stdin
    // format the judge expects and only has to edit the values.
    const addCustomTest = useCallback(() => {
        const id = `custom-${customTestIdRef.current++}`;
        setTests((prev) => {
            const samples = prev.filter((t) => !t?.custom);
            const template = samples[samples.length - 1];
            const seedStdin = template?.stdin != null ? String(template.stdin) : "";
            setActiveTestCaseIndex(prev.length);
            return [...prev, { id, custom: true, stdin: seedStdin, expected_output: null }];
        });
        setTestPanelTab("testcase");
    }, []);

    const updateCustomTestStdin = useCallback((index: number, value: string) => {
        setTests((prev) => prev.map((test, i) => (i === index ? { ...test, stdin: value } : test)));
    }, []);

    const removeCustomTest = useCallback((index: number) => {
        setTests((prev) => prev.filter((_, i) => i !== index));
        setActiveTestCaseIndex((current) => (current >= index ? Math.max(0, current - 1) : current));
    }, []);
    const [hasTestRun, setHasTestRun] = useState(false);
    const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
    const languageMenuRef = useRef<HTMLDivElement | null>(null);
    const identityWatermark = [user?.email || session?.user?.email, user?.mobile || session?.user?.phone]
        .filter(Boolean)
        .join("  ");

    // ─── CONTEST AUTO-SUBMIT MODAL STATE ────────────────────────────────────
    const showAutoSubmitModal = false;
    const autoSubmitReason = "";
    const handleModalOk = () => {};
    const [showFullscreenReturnPrompt, setShowFullscreenReturnPrompt] = useState(false);
    const [integrityWarningCount, setIntegrityWarningCount] = useState(0);
    const router = useRouter();

    // ─── Contest-mode queue tracking (Codeforces-style) ────────────────────────
    const CONTEST_API = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
    const WS_URL = (process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002')
        .replace(/^http/, 'ws');

    // Track the current queued submission
    const [activeSubmissionId, setActiveSubmissionId] = useState<string | null>(null);
    const [queueStatus, setQueueStatus] = useState<'idle' | 'queued' | 'processing' | 'deferred' | 'completed'>('idle');
    const [queueElapsed, setQueueElapsed] = useState(0);
    const [attemptNumber, setAttemptNumber] = useState(0);
    const [duplicateRetryUntil, setDuplicateRetryUntil] = useState<number | null>(null);
    const [retryClock, setRetryClock] = useState(() => Date.now());

    // Contest-specific submission history for the Submissions tab
    const [contestSubmissions, setContestSubmissions] = useState<any[]>([]);
    const [loadingContestSubs, setLoadingContestSubs] = useState(false);
    const [contestQuestions, setContestQuestions] = useState<any[]>([]);
    const [contestEndTime, setContestEndTime] = useState<string | null>(null);
    const [showDifficultyTags, setShowDifficultyTags] = useState(true);
    const [isQuestionNavigatorOpen, setIsQuestionNavigatorOpen] = useState(false);
    const [contestTimerTick, setContestTimerTick] = useState(() => Date.now());

    // Global verdict toast (shown regardless of active tab)
    const [verdictToast, setVerdictToast] = useState<{
        visible: boolean;
        status: string;
        points: number;
        testsPassed: number;
        testsTotal: number;
        elapsedMs?: number;
    } | null>(null);

    // Refs for WS + polling
    const wsRef = useRef<WebSocket | null>(null);
    const pollingRef = useRef<NodeJS.Timeout | null>(null);
    const elapsedRef = useRef<NodeJS.Timeout | null>(null);
    const activeSubRef = useRef<string | null>(null); // mirror of activeSubmissionId for closures
    const lastIntegrityViolationRef = useRef<{ at: number; reason: string } | null>(null);
    const contestTimeSubmitRef = useRef(false);
    const integrityAutoSubmitRef = useRef(false);
    const altSwitchCandidateRef = useRef(false);
    const displayQuestionTitle =
        question?.title ||
        contestQuestions.find((item: any) => String(item.id) === String(questionId))?.title ||
        "Question";
    const constraintLines = getConstraintLines(question?.constraints);
    const duplicateRetrySeconds = duplicateRetryUntil
        ? Math.max(0, Math.ceil((duplicateRetryUntil - retryClock) / 1000))
        : 0;

    // Contest countdown timer
    const contestTimeRemainingMs = contestEndTime
        ? Math.max(0, new Date(contestEndTime).getTime() - contestTimerTick)
        : 0;
    const contestTimeFormatted = (() => {
        const totalSeconds = Math.floor(contestTimeRemainingMs / 1000);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    })();
    const contestTimerUrgent = contestTimeRemainingMs > 0 && contestTimeRemainingMs < 5 * 60 * 1000;
    const getAccessToken = useCallback(async () => {
        if (authLoading) return null;

        const supabase = createSupabaseBrowserClient();
        const { data: sessionData } = await supabase.auth.getSession();
        let activeSession = sessionData.session || session;

        if (!activeSession) return null;

        const expiresAtMs = activeSession.expires_at ? activeSession.expires_at * 1000 : 0;
        if (expiresAtMs && expiresAtMs - Date.now() < 60_000) {
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshData.session?.access_token) {
                activeSession = refreshData.session;
            }
        }

        return activeSession.access_token || null;
    }, [authLoading, session]);
    const getAccessTokenRef = useRef(getAccessToken);
    const latestEditorStateRef = useRef({ code, language });

    useEffect(() => {
        getAccessTokenRef.current = getAccessToken;
    }, [getAccessToken]);

    useEffect(() => {
        latestEditorStateRef.current = { code, language };
    }, [code, language]);

    useEffect(() => {
        if (!contestId || !questionId || !isContestMode || isSecureOaMode) return;
        try {
            window.localStorage.setItem(`contest-integrity-started-${contestId}`, "true");
        } catch {
            // Local storage is only a UI mirror; the backend open state remains authoritative.
        }
        void (async () => {
            try {
                const token = await getAccessTokenRef.current();
                if (!token) return;
                await fetch(`${CONTEST_API}/contests/${contestId}/rounds/dsa/questions/${questionId}/open`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
            } catch {
                // Opening state is rechecked by the backend when the student tries to leave.
            }
        })();
    }, [CONTEST_API, contestId, isContestMode, isSecureOaMode, questionId]);

    const handleBackNavigation = useCallback(() => {
        if (isContestMode && contestId) {
            router.push(`/contests/${contestId}/dsa`);
            return;
        }

        if (sheetId) router.push(`/sheets/${sheetId}`);
        else router.push("/questions/dsa");
    }, [contestId, isContestMode, router, sheetId]);

    const fetchContestDetailsForTimer = useCallback(async () => {
        if (!contestId || !isContestMode) return null;
        try {
            const token = await getAccessToken();
            if (!token) return null;

            const url = new URL(`${CONTEST_API}/contests/${contestId}`);
            url.searchParams.set('_ts', Date.now().toString());

            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });

            if (res.ok) {
                const data = await res.json();
                const nextEndTime = data.contest?.endTime || null;
                setContestEndTime(nextEndTime);
                setShowDifficultyTags(data.contest?.showDifficultyTags !== false);
                return nextEndTime as string | null;
            }
        } catch {
        }

        return null;
    }, [CONTEST_API, contestId, getAccessToken, isContestMode]);

    const submitContestOnTimeEnd = useCallback(async () => {
        if (!contestId || !isContestMode || contestTimeSubmitRef.current) return;
        contestTimeSubmitRef.current = true;

        try {
            const token = await getAccessToken();
            if (!token) {
                router.replace('/login');
                return;
            }

            const latestEndTime = await fetchContestDetailsForTimer();
            if (!latestEndTime) {
                contestTimeSubmitRef.current = false;
                return;
            }

            const latestEndAt = new Date(latestEndTime).getTime();
            if (Number.isFinite(latestEndAt) && Date.now() < latestEndAt) {
                contestTimeSubmitRef.current = false;
                return;
            }

            // Spread the contest-end auto-submit burst so 300 clients don't all
            // POST /submit within the same second. The contest is already over,
            // so a random 0-20s wait has no gameplay impact.
            await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 20000)));

            const response = await fetch(`${CONTEST_API}/contests/${contestId}/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ submissionType: 'auto_time' }),
            });

            if (response.status === 409) {
                contestTimeSubmitRef.current = false;
                void fetchContestDetailsForTimer();
                return;
            }

            if (!response.ok && response.status !== 400) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || 'Failed to submit contest');
            }

            localStorage.setItem(`contest-submitted-${contestId}`, 'true');
            clearContestCodeDrafts(contestId);
            router.replace(`/contests/${contestId}/submitted`);
        } catch {
            contestTimeSubmitRef.current = false;
        }
    }, [CONTEST_API, contestId, fetchContestDetailsForTimer, getAccessToken, isContestMode, router]);
    // ───────────────────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!duplicateRetryUntil) return;

        const tick = () => {
            const now = Date.now();
            setRetryClock(now);
            if (duplicateRetryUntil <= now) {
                setDuplicateRetryUntil(null);
            }
        };

        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [duplicateRetryUntil]);

    // Switch to result tab if any test finished
    useEffect(() => {
        if (tests && tests.length > 0) {
            const hasFinished = tests.some((t: any, idx: number) => {
                const s = results[getTestResultKey(t, idx)]?.status;
                return s && s !== "Pending" && s !== "Running";
            });
            if (hasFinished && testPanelTab === "testcase") {
                setTestPanelTab("result");
            }
        }
    }, [results, tests, testPanelTab]);

    const [modalState, setModalState] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: "success" | "error" | "warning" | "info";
        details?: string;
    }>({
        isOpen: false,
        title: "",
        message: "",
        type: "info",
    });
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [upgradeCopy, setUpgradeCopy] = useState<string | undefined>();

    const [copiedCodeSection, setCopiedCodeSection] = useState<'bruteForce' | 'optimized' | null>(null);

    const handleCopyCode = (code: string, section: 'bruteForce' | 'optimized') => {
        navigator.clipboard.writeText(code);
        setCopiedCodeSection(section);
        setTimeout(() => setCopiedCodeSection(null), 2000);
    };

    const assessmentStorageKey = isSecureOaMode
        ? `secure-oa-auto-submit-${oaSessionId || contestId || "session"}`
        : `contest-auto-submit-${contestId}`;
    const violationStorageKey = isSecureOaMode
        ? `secure-oa-violations-${oaSessionId || contestId || "session"}`
        : `contest-violations-${contestId}`;
    const dsaWarningStorageKey = contestId ? `contest-dsa-warning-count:${contestId}` : "";

    const postSecureOaMessage = (payload: Record<string, unknown>) => {
        if (!isSecureOaMode || typeof window === "undefined") return;
        window.parent?.postMessage({
            sessionId: oaSessionId,
            questionId: oaQuestionKey,
            ...payload,
        }, window.location.origin);
    };

    const submitContestForIntegrityLimit = async (reason: string, violationCount: number) => {
        const submissionType = getContestAutoSubmissionType(reason);
        const warningLimit = isContestMode ? CONTEST_INTEGRITY_WARNING_LIMIT : autoSubmitLimit;
        const autoSubmitPayload = {
            reason,
            submissionType,
            timestamp: Date.now(),
            violationCount,
            threshold: warningLimit,
        };

        localStorage.setItem(assessmentStorageKey, JSON.stringify(autoSubmitPayload));

        if (isSecureOaMode) {
            const latestEditorState = latestEditorStateRef.current;
            postSecureOaMessage({
                type: "secure-oa:auto-submit",
                reason,
                violationCount,
                code: latestEditorState.code,
                language: latestEditorState.language,
            });
            return;
        }

        if (!contestId || !isContestMode || integrityAutoSubmitRef.current) return;
        if (localStorage.getItem(`contest-submitted-${contestId}`)) return;
        integrityAutoSubmitRef.current = true;

        try {
            const token = await getAccessTokenRef.current();
            if (!token) {
                integrityAutoSubmitRef.current = false;
                localStorage.removeItem(assessmentStorageKey);
                router.replace('/login');
                return;
            }

            const response = await fetch(`${CONTEST_API}/contests/${contestId}/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ submissionType }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                if (String(error.message || '').toLowerCase().includes('already submitted')) {
                    localStorage.setItem(`contest-submitted-${contestId}`, 'true');
                    clearContestCodeDrafts(contestId);
                    router.replace(`/contests/${contestId}/submitted`);
                    return;
                }
                throw new Error(error.message || 'Failed to submit contest');
            }

            localStorage.setItem(`contest-submitted-${contestId}`, 'true');
            clearContestCodeDrafts(contestId);
            router.replace(`/contests/${contestId}/submitted`);
        } catch {
            integrityAutoSubmitRef.current = false;
            localStorage.removeItem(assessmentStorageKey);
            showIntegrityWarning('Warning limit reached, but contest submission failed. Please submit manually.');
        }
    };

    const requestIntegrityFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            }
            setShowFullscreenReturnPrompt(false);
            return true;
        } catch {
            setShowFullscreenReturnPrompt(true);
            return false;
        }
    };

    const showIntegrityWarning = (message: string) => {
        document.getElementById('contest-integrity-warning')?.remove();
        const warningDiv = document.createElement('div');
        warningDiv.id = 'contest-integrity-warning';
        warningDiv.textContent = message;
        warningDiv.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: #ef4444;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 700;
            z-index: 10000;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            max-width: 420px;
        `;
        document.body.appendChild(warningDiv);
        setTimeout(() => {
            warningDiv.style.opacity = '0';
            warningDiv.style.transition = 'opacity 0.3s';
            setTimeout(() => warningDiv.remove(), 300);
        }, 3500);
    };

    // ─── CONTEST AUTO-SUBMIT HANDLER ────────────────────────────────────────
    const handleContestAutoSubmit = async (submissionType: string) => {
        if (!questionId || (!contestId && !isSecureOaMode)) return;
        if (localStorage.getItem(assessmentStorageKey)) return;

        if (!RECORD_INTEGRITY_VIOLATIONS) {
            return;
        }

        const now = Date.now();
        const lastViolation = lastIntegrityViolationRef.current;
        if (lastViolation && now - lastViolation.at < 1200) {
            return;
        }
        lastIntegrityViolationRef.current = { at: now, reason: submissionType };

        const warningLimit = isContestMode ? CONTEST_INTEGRITY_WARNING_LIMIT : autoSubmitLimit;
        const storedViolations = Number(localStorage.getItem(violationStorageKey) || "0");
        const currentViolations = (Number.isFinite(storedViolations) ? Math.max(0, storedViolations) : 0) + 1;
        localStorage.setItem(violationStorageKey, String(currentViolations));
        setIntegrityWarningCount(currentViolations);
        const storedDsaWarnings = Number(localStorage.getItem(dsaWarningStorageKey) || "0");
        const currentDsaWarnings = isContestMode
            ? (Number.isFinite(storedDsaWarnings) ? Math.max(0, storedDsaWarnings) : 0) + 1
            : currentViolations;
        if (isContestMode && dsaWarningStorageKey) {
            localStorage.setItem(dsaWarningStorageKey, String(currentDsaWarnings));
        }
        const reasonText = submissionType
            .replace('auto_', '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());

        if (isContestMode && contestId) {
            try {
                const token = await getAccessTokenRef.current();
                if (token) {
                    await fetch(`${CONTEST_API}/contests/${contestId}/integrity-events`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            roundType: "dsa",
                            eventType: submissionType,
                            severity: submissionType === "auto_fullscreen_exit" || submissionType === "auto_page_leave" ? "high" : "medium",
                            warningCount: currentDsaWarnings,
                            payload: {
                                totalWarningCount: currentViolations,
                                warningLimit,
                                questionId,
                            },
                            clientEventId: `${questionId}-${submissionType}-${now}`,
                            clientTimestamp: new Date(now).toISOString(),
                        }),
                    });
                }
            } catch {
                // Best-effort audit logging; local warning state still controls the candidate flow.
            }
        }

        postSecureOaMessage({
            type: "secure-oa:violation",
            reason: submissionType,
            violationCount: currentViolations,
            threshold: warningLimit,
            code: latestEditorStateRef.current.code,
            language: latestEditorStateRef.current.language,
        });

        const reachedLimit = currentViolations >= warningLimit;
        showIntegrityWarning(
            reachedLimit
                ? `Integrity warning ${currentViolations}/${warningLimit}: ${reasonText}. Warning limit reached; submitting your contest.`
                : `Integrity warning ${currentViolations}/${warningLimit}: ${reasonText}. This warning was recorded.`
        );

        if (reachedLimit) {
            await submitContestForIntegrityLimit(submissionType, currentViolations);
            return;
        }

        if (submissionType === 'auto_fullscreen_exit') {
            setShowFullscreenReturnPrompt(true);
            void requestIntegrityFullscreen();
        }
    };

    // Check if contest was already submitted on mount
    useEffect(() => {
        if (!isIntegrityMode || (!contestId && !isSecureOaMode)) return;
        
        const autoSubmitData = localStorage.getItem(assessmentStorageKey);
        const isSubmitted = localStorage.getItem(`contest-submitted-${contestId}`);
        const storedViolations = Number(localStorage.getItem(violationStorageKey) || "0");
        const localWarningCount = Number.isFinite(storedViolations) ? Math.max(0, storedViolations) : 0;
        setIntegrityWarningCount(localWarningCount);

        // Back-navigation guard: once the whole contest is submitted, the solve page may not be re-entered.
        if (isContestMode && contestId && isSubmitted === "true") {
            router.replace(`/contests/${contestId}/submitted`);
            return;
        }

        if (isContestMode && contestId) {
            void (async () => {
                try {
                    const token = await getAccessTokenRef.current();
                    if (!token) return;
                    const response = await fetch(`${CONTEST_API}/contests/${contestId}/rounds`, {
                        headers: { Authorization: `Bearer ${token}` },
                        cache: "no-store",
                    });
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) return;
                    // Server-authoritative guard: redirect out if the contest/round is already submitted.
                    if (data?.participant?.isSubmitted === true) {
                        try {
                            localStorage.setItem(`contest-submitted-${contestId}`, "true");
                        } catch {
                            // Local storage only mirrors the server-side submission state.
                        }
                        router.replace(`/contests/${contestId}/submitted`);
                        return;
                    }
                    const dsaRoundStatus = String(data?.rounds?.dsa?.status ?? "");
                    if (dsaRoundStatus === "submitted" || dsaRoundStatus === "auto_submitted") {
                        router.replace(`/contests/${contestId}`);
                        return;
                    }
                    const serverMcqWarnings = Number(data?.rounds?.mcq?.warningCount ?? 0);
                    const serverDsaWarnings = Number(data?.rounds?.dsa?.warningCount ?? 0);
                    const serverTotalWarnings =
                        (Number.isFinite(serverMcqWarnings) ? serverMcqWarnings : 0) +
                        (Number.isFinite(serverDsaWarnings) ? serverDsaWarnings : 0);
                    const nextWarningCount = Math.max(localWarningCount, serverTotalWarnings);
                    localStorage.setItem(violationStorageKey, String(nextWarningCount));
                    if (dsaWarningStorageKey) {
                        localStorage.setItem(
                            dsaWarningStorageKey,
                            String(Math.max(Number(localStorage.getItem(dsaWarningStorageKey) || "0") || 0, Number.isFinite(serverDsaWarnings) ? serverDsaWarnings : 0))
                        );
                    }
                    setIntegrityWarningCount(nextWarningCount);
                } catch {
                    // Local warning storage remains authoritative until server sync succeeds.
                }
            })();
        }
        
        if (autoSubmitData && !isSubmitted) {
            localStorage.removeItem(assessmentStorageKey);
        }
    }, [CONTEST_API, assessmentStorageKey, contestId, dsaWarningStorageKey, isContestMode, isIntegrityMode, isSecureOaMode, mode, router, violationStorageKey]);

    // Legacy DOM modal disabled; integrity warnings now record only.
    useEffect(() => {
        if (showAutoSubmitModal) return;
        if (!showAutoSubmitModal) return;

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'contest-integrity-warning-modal';
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 32px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        `;

        modalContent.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                <h2 style="font-size: 24px; font-weight: 700; margin-bottom: 12px; color: #1a1a1a;">
                    Integrity Warning Recorded
                </h2>
                <p style="font-size: 16px; color: #666; margin-bottom: 24px; line-height: 1.6;">
                    Your ${isSecureOaMode ? "assessment" : "contest"} recorded an integrity warning due to:<br/>
                    <strong style="color: #ef4444; font-size: 18px;">${autoSubmitReason}</strong>
                </p>
                <p style="font-size: 14px; color: #888; margin-bottom: 24px;">
                    Your current progress remains available.
                </p>
                <button id="modal-ok-btn" style="
                    background: #4A7CFF;
                    color: white;
                    border: none;
                    padding: 12px 48px;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                ">
                    OK
                </button>
            </div>
        `;

        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);

        const okBtn = document.getElementById('modal-ok-btn');
        if (okBtn) {
            okBtn.addEventListener('click', handleModalOk);
            okBtn.addEventListener('mouseenter', () => {
                okBtn.style.background = '#3a63cc';
            });
            okBtn.addEventListener('mouseleave', () => {
                okBtn.style.background = '#4A7CFF';
            });
        }

        return () => {
            const existingModal = document.getElementById('contest-integrity-warning-modal');
            if (existingModal) {
                existingModal.remove();
            }
        };
    }, [showAutoSubmitModal, autoSubmitReason]);

    const sseConnections = useRef<Record<string, EventSource>>({});
    const mainEditorRef = useRef<any>(null);
    const lastLoadedFingerprintRef = useRef<string | null>(null);

    const loadEditorSource = useCallback(
        (nextLanguage: string, nextCode: string, nextQuestionId?: string | null) => {
            const editorQuestionId = nextQuestionId ?? questionId ?? "";

            latestEditorStateRef.current = { code: nextCode, language: nextLanguage };
            setLanguage(nextLanguage);
            setCode(nextCode);
            if (isContestMode) {
                writeContestCodeDraft(contestId, editorQuestionId, nextLanguage, nextCode);
            }

            if (!mainEditorRef.current) {
                lastLoadedFingerprintRef.current = null;
                return;
            }

            lastLoadedFingerprintRef.current = `${editorQuestionId}-${nextLanguage}`;

            if (mainEditorRef.current.getValue() !== nextCode) {
                mainEditorRef.current.setValue(nextCode);
            }

            const model = mainEditorRef.current.getModel();
            const monacoLanguage = LANGUAGE_MAP[nextLanguage as keyof typeof LANGUAGE_MAP]?.monacoId || nextLanguage;
            if (model) {
                monaco.editor.setModelLanguage(model, monacoLanguage);
            }
        },
        [contestId, isContestMode, questionId]
    );

    const getCurrentEditorCode = useCallback(() => {
        const editorValue = mainEditorRef.current?.getValue?.();
        if (typeof editorValue === "string" && editorValue !== code) {
            latestEditorStateRef.current = {
                code: editorValue,
                language: latestEditorStateRef.current.language || language,
            };
            setCode(editorValue);
            return editorValue;
        }
        return code;
    }, [code, language]);

    const currentContestQuestionIndex = isContestMode
        ? contestQuestions.findIndex((item: any) => String(item.id) === String(questionId))
        : -1;
    const previousContestQuestion = currentContestQuestionIndex > 0
        ? contestQuestions[currentContestQuestionIndex - 1]
        : null;
    const nextContestQuestion = currentContestQuestionIndex >= 0 && currentContestQuestionIndex < contestQuestions.length - 1
        ? contestQuestions[currentContestQuestionIndex + 1]
        : null;

    const navigateToContestQuestion = useCallback((targetQuestionId?: string | number | null) => {
        if (!isContestMode || !contestId || !targetQuestionId) return;

        const targetId = String(targetQuestionId);
        if (String(questionId) === targetId) {
            setIsQuestionNavigatorOpen(false);
            return;
        }

        writeContestCodeDraft(
            contestId,
            questionId,
            language,
            mainEditorRef.current?.getValue?.() ?? code
        );
        setIsQuestionNavigatorOpen(false);
        router.push(`/contests/${contestId}/solve/${targetId}`);
    }, [code, contestId, isContestMode, language, questionId, router]);

    const switchEditorLanguage = useCallback((nextLanguage: string) => {
        if (!question || !questionId) return;
        const currentState = latestEditorStateRef.current;
        const currentCode = mainEditorRef.current?.getValue?.() ?? currentState.code;
        const currentLanguage = currentState.language || language;

        if (isContestMode) {
            writeContestCodeDraft(contestId, questionId, currentLanguage, currentCode);
        }

        const nextStarterCode = getStarterCodeForLanguage(question.starter_code, nextLanguage) || "";
        const savedDraft = isContestMode
            ? readContestCodeDraft(contestId, questionId, nextLanguage)
            : null;
        loadEditorSource(nextLanguage, savedDraft ?? nextStarterCode, questionId);
        setIsLanguageMenuOpen(false);
    }, [contestId, isContestMode, language, loadEditorSource, question, questionId]);

    useEffect(() => {
        const fingerprint = `${questionId}-${language}`;
        if (mainEditorRef.current && fingerprint !== lastLoadedFingerprintRef.current) {
            lastLoadedFingerprintRef.current = fingerprint;
            if (mainEditorRef.current.getValue() !== code) {
                mainEditorRef.current.setValue(code);
            }
        }
    }, [code, language, questionId]);

    useEffect(() => {
        postSecureOaMessage({
            type: "secure-oa:code-change",
            code,
            language,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code, language, isSecureOaMode, oaSessionId, oaQuestionKey]);

    // Re-apply language tokenization whenever language changes (fixes Python colors)
    useEffect(() => {
        if (!mainEditorRef.current) return;
        import('monaco-editor').then((monaco) => {
            const model = mainEditorRef.current.getModel();
            const monacoLang = LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP]?.monacoId || language;
            if (model) monaco.editor.setModelLanguage(model, monacoLang);
        });
    }, [language]);

    useEffect(() => setMounted(true), []);
    const isDark = mounted && resolvedTheme === "dark";
    const editorTheme = isDark ? "vs-dark" : "light";

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
                setIsLanguageMenuOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Helper function to format test case data for display
    const formatTestData = (value: any): string => {
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return formatValue(parsed);
            } catch {
                return value;
            }
        }
        return formatValue(value);
    };

    const formatValue = (value: any): string => {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') return `"${value}"`;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            // Check if it's a 2D array
            if (Array.isArray(value[0])) {
                return `[\n  ${value.map(arr => `[${arr.join(', ')}]`).join(',\n  ')}\n]`;
            }
            return `[${value.map(v => formatValue(v)).join(', ')}]`;
        }
        if (typeof value === 'object') {
            const entries = Object.entries(value);
            if (entries.length === 0) return '{}';
            return entries.map(([k, v]) => `${k} = ${formatValue(v)}`).join(', ');
        }
        return String(value);
    };

    useEffect(() => setMounted(true), []);

    // Contest timer tick interval
    useEffect(() => {
        if (!contestEndTime || !isContestMode) return;
        const timer = window.setInterval(() => setContestTimerTick(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [contestEndTime, isContestMode]);

    useEffect(() => {
        if (!contestId || !isContestMode || isSecureOaMode) return;
        const intervalMs = contestTimerUrgent ? 5000 : 15000;
        const timer = window.setInterval(() => {
            void fetchContestDetailsForTimer();
        }, intervalMs);
        return () => window.clearInterval(timer);
    }, [contestId, contestTimerUrgent, fetchContestDetailsForTimer, isContestMode, isSecureOaMode]);

    const fetchSubmissions = async () => {
        if (!questionId) return;
        try {
            const token = await getAccessToken();
            if (!token) return;

            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/submissions/${questionId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setPastSubmissions(data.data);
                    setIsSolved(data.data.some((s: any) => s.status === "accepted"));
                }
            }
        } catch {
        }
    };

    // ─── CONTEST SUBMISSION HELPERS ────────────────────────────────────────────

    /** Fetch contest-specific submissions for the Submissions tab */
    const fetchContestSubmissions = async () => {
        if (!contestId || !questionId) return;
        setLoadingContestSubs(true);
        try {
            const token = await getAccessToken();
            if (!token) return;

            const res = await fetch(
                `${CONTEST_API}/contests/${contestId}/submissions?questionId=${questionId}`,
                { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
            );
            if (res.ok) {
                const data = await res.json();
                if (data.success) setContestSubmissions(data.submissions);
            }
        } catch {
        } finally {
            setLoadingContestSubs(false);
        }
    };

    const fetchContestQuestions = async () => {
        if (!contestId || !isContestMode || embedded) return;
        try {
            const token = await getAccessToken();
            if (!token) return;

            const url = new URL(`${CONTEST_API}/contests/${contestId}/questions`);
            url.searchParams.set("_ts", Date.now().toString());
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            if (res.ok) {
                const data = await res.json();
                setContestQuestions(data.questions || []);
            }
        } catch {
        }
    };

    /** Maps contest service status to UI label + colour + icon */
    const getVerdictMeta = (status: string) => {
        const s = (status || '').toUpperCase();
        const map: Record<string, { label: string; color: string; bg: string; icon: string; border: string }> = {
            ACCEPTED:              { label: 'Accepted',              color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20',  icon: 'check_circle', border: 'border-emerald-200 dark:border-emerald-700' },
            WRONG_ANSWER:          { label: 'Wrong Answer',          color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/20',           icon: 'cancel',        border: 'border-red-200 dark:border-red-700' },
            TIME_LIMIT_EXCEEDED:   { label: 'Time Limit Exceeded',   color: 'text-orange-600 dark:text-orange-400',   bg: 'bg-orange-50 dark:bg-orange-900/20',     icon: 'timer_off',     border: 'border-orange-200 dark:border-orange-700' },
            MEMORY_LIMIT_EXCEEDED: { label: 'Memory Limit Exceeded', color: 'text-orange-600 dark:text-orange-400',   bg: 'bg-orange-50 dark:bg-orange-900/20',     icon: 'memory',        border: 'border-orange-200 dark:border-orange-700' },
            RUNTIME_ERROR:         { label: 'Runtime Error',         color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/20',           icon: 'bug_report',    border: 'border-red-200 dark:border-red-700' },
            COMPILATION_ERROR:     { label: 'Compilation Error',     color: 'text-purple-600 dark:text-purple-400',   bg: 'bg-purple-50 dark:bg-purple-900/20',     icon: 'code_off',      border: 'border-purple-200 dark:border-purple-700' },
            QUEUED:                { label: 'In Queue',              color: 'text-slate-500 dark:text-slate-400',     bg: 'bg-slate-50 dark:bg-slate-900/20',       icon: 'schedule',      border: 'border-slate-200 dark:border-slate-700' },
            PROCESSING:            { label: 'Running...',            color: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-900/20',         icon: 'autorenew',     border: 'border-blue-200 dark:border-blue-700' },
            JUDGING_DEFERRED:      { label: 'Retrying Judge...',     color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-900/20',       icon: 'sync_problem',  border: 'border-amber-200 dark:border-amber-700' },
        };
        return map[s] || { label: s, color: 'text-slate-600', bg: 'bg-slate-50', icon: 'help', border: 'border-slate-200' };
    };

    /** Stop all active tracking (polling + elapsed timer) */
    const stopTracking = () => {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    };

    /** Called when a final verdict is received (via WS or polling) */
    const handleVerdictReceived = (result: {
        status: string;
        testCasesPassed: number;
        testCasesTotal: number;
        pointsAwarded: number;
        totalScore?: number;
        executionTime?: number | null;
        memoryUsed?: number | null;
        failedTest?: {
            source: "hidden";
            status?: string;
            input: string;
            expected: string;
            actual: string;
            stderr?: string;
            compileOutput?: string;
        };
        errorDetails?: string;
    }) => {
        stopTracking();
        setQueueStatus('completed');
        setIsSubmitting(false);
        activeSubRef.current = null;
        setActiveSubmissionId(null);

        const status = (result.status || '').toUpperCase();
        const isAccepted = status === 'ACCEPTED';
        const isTLE    = status === 'TIME_LIMIT_EXCEEDED';
        const isMLE    = status === 'MEMORY_LIMIT_EXCEEDED';
        const isRE     = status === 'RUNTIME_ERROR';
        const isCE     = status === 'COMPILATION_ERROR';

        // Map to the legacy submissionResult shape for existing verdict UI
        let mappedStatus: 'accepted' | 'wrong_answer' | 'error' | 'compile_error' = 'wrong_answer';
        if (isAccepted)           mappedStatus = 'accepted';
        else if (isCE)            mappedStatus = 'compile_error';
        else if (isTLE || isMLE || isRE) mappedStatus = 'error';

        const meta = getVerdictMeta(status);
        const testsPassed = result.testCasesPassed ?? 0;
        const testsTotal  = result.testCasesTotal  ?? 0;

        setSubmissionResult({
            status: mappedStatus,
            message: meta.label,
            hiddenPassed: testsPassed,
            hiddenTotal:  testsTotal,
            ...(result.failedTest ? {
                failedTest: {
                    source: result.failedTest.source,
                    status: result.failedTest.status,
                    input: result.failedTest.input || '',
                    expected: result.failedTest.expected || '',
                    actual: result.failedTest.actual || '',
                    stderr: result.failedTest.stderr || '',
                    compileOutput: result.failedTest.compileOutput || '',
                },
            } : {}),
            ...(result.errorDetails ? { errorDetails: result.errorDetails } : {}),
        });

        // Submit verdicts are hidden-test summaries. Keep the visible sample
        // pills for Run Tests results so hidden failures do not appear as
        // bogus "(No output)" sample failures.
        setResults((prev: Record<string, any>) => {
            const next = { ...prev };
            if (isCE) {
                tests.forEach((t: any, idx: number) => {
                    const key = getTestResultKey(t, idx);
                    next[key] = { ...next[key], status: 'Compilation Error' };
                });
                return next;
            }

            tests.forEach((t: any, idx: number) => {
                const key = getTestResultKey(t, idx);
                next[key] = { ...next[key], status: 'Pending' };
            });
            return next;
        });

        // Global toast — fires even if user is on another tab
        setVerdictToast({
            visible: true,
            status,
            points: result.pointsAwarded ?? 0,
            testsPassed,
            testsTotal,
            elapsedMs: result.executionTime ?? undefined,
        });
        setTimeout(() => setVerdictToast(null), 8000);

        if (isAccepted) updateLastQuestionDate();

        setActiveTab('result');
        fetchContestSubmissions();

        // Reset queue state after 2s so UI transitions cleanly
        setTimeout(() => setQueueStatus('idle'), 2000);
    };

    /** Polling fallback: every 2s check submission status */
    const startPolling = async (submissionId: string, token: string) => {
        let attempts = 0;
        pollingRef.current = setInterval(async () => {
            attempts++;
            if (attempts > 150) { // 5 min max
                stopTracking();
                setIsSubmitting(false);
                setQueueStatus('idle');
                return;
            }

            const currentSub = activeSubRef.current;
            if (!currentSub) { stopTracking(); return; }

            try {
                const res = await fetch(`${CONTEST_API}/execute/submission/${submissionId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const data = await res.json();
                const sub = data.submission;

                const status = (sub.status || '').toUpperCase();

                if (status === 'QUEUED') {
                    setQueueStatus('queued');
                } else if (status === 'PROCESSING') {
                    setQueueStatus('processing');
                } else if (status === 'JUDGING_DEFERRED') {
                    setQueueStatus('deferred');
                } else {
                    const needsDetailedVerdict = status !== 'ACCEPTED';
                    const hasDetailedPayload = Boolean(sub.failedTest || sub.errorDetails);
                    if (needsDetailedVerdict && !hasDetailedPayload) {
                        return;
                    }

                    // Final status
                    stopTracking();
                    handleVerdictReceived({
                        status: sub.status,
                        testCasesPassed: sub.testCasesPassed ?? 0,
                        testCasesTotal:  sub.testCasesTotal  ?? 0,
                        pointsAwarded:   sub.pointsAwarded   ?? 0,
                        executionTime:   sub.executionTime,
                        memoryUsed:      sub.memoryUsed,
                        failedTest:      sub.failedTest,
                        errorDetails:    sub.errorDetails,
                    });
                }
            } catch (_) { /* network hiccup, keep polling */ }
        }, 2000);
    };

    /** Connect WebSocket for real-time push; falls back to polling if disconnected */
    const connectWebSocket = async (submissionId: string, token: string) => {
        try {
            const ws = new WebSocket(`${WS_URL}/ws?token=${token}`);
            wsRef.current = ws;

            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'subscribe', data: { submissionId } }));
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'submission_completed') {
                        const currentSub = activeSubRef.current;
                        if (!currentSub || msg.submissionId !== currentSub) return;
                        stopTracking(); // stop polling since WS delivered
                        ws.close();
                        handleVerdictReceived(msg);
                    } else if (msg.type === 'connected') {
                        // WS connected — polling still runs as fallback
                    }
                } catch (_) {}
            };

            ws.onerror = () => { /* polling already running as fallback */ };
            ws.onclose = () => { wsRef.current = null; };
        } catch (_) {
            // WS unavailable, polling will handle it
        }
    };

    // ─────────────────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!questionId) {
            setError("No question ID provided");
            setLoading(false);
            return;
        }

        if (authLoading) {
            setLoading(true);
            return;
        }

        const fetchQuestion = async () => {
            try {
                const token = await getAccessToken();
                if (!token) {
                    throw new Error("Your session expired. Please sign in again.");
                }

                let data: Question;

                if (isContestMode && contestId) {
                    const contestQuestionsUrl = new URL(`${CONTEST_API}/contests/${contestId}/questions`);
                    contestQuestionsUrl.searchParams.set("_ts", Date.now().toString());
                    const res = await fetch(contestQuestionsUrl.toString(), {
                        headers: { Authorization: `Bearer ${token}` },
                        cache: "no-store",
                    });

                    if (!res.ok) {
                        let message = "Failed to fetch contest question";
                        try {
                            const errorBody = await res.json();
                            message = errorBody?.message || errorBody?.error || message;
                        } catch {
                            const text = await res.text().catch(() => "");
                            if (text) message = text;
                        }
                        throw new Error(message);
                    }

                    const payload = await res.json();
                    const questions = Array.isArray(payload?.questions) ? payload.questions : [];
                    setContestQuestions(questions);

                    const contestQuestion = questions.find((item: any) => String(item.id) === String(questionId));
                    if (!contestQuestion) {
                        throw new Error("This question is not part of the current contest.");
                    }

                    data = contestQuestion as Question;
                } else {
                    const questionUrl = new URL(
                        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/question/${questionId}`
                    );
                    if (isSecureOaMode) {
                        questionUrl.searchParams.set("mode", "secure_oa");
                        questionUrl.searchParams.set("oaSessionId", oaSessionId);
                        questionUrl.searchParams.set("oaQuestionKey", oaQuestionKey);
                    }
                    const res = await fetch(questionUrl.toString(), {
                        headers: { Authorization: `Bearer ${token}` },
                    });

                    if (!res.ok) {
                        let message = "Failed to fetch question";
                        try {
                            const errorBody = await res.json();
                            message = errorBody?.code
                                ? `${errorBody.message || message} (${errorBody.code})`
                                : errorBody?.message || errorBody?.error || message;
                        } catch {
                            const text = await res.text().catch(() => "");
                            if (text) message = text;
                        }
                        throw new Error(message);
                    }
                    data = await res.json();
                }
                setQuestion(data);
                
                // Set initial code from starter code - prioritize C++ and support legacy c++ key.
                const starters = (data.starter_code || {}) as Record<string, string>;
                const resolvedLanguage = getDefaultLanguage(starters, "cpp");
                const starterCode =
                    getStarterCodeForLanguage(starters, resolvedLanguage) ||
                    getStarterCodeForLanguage(starters, "javascript") ||
                    "// No starter code found";
                const savedDraft = isContestMode
                    ? readContestCodeDraft(contestId, questionId, resolvedLanguage)
                    : null;
                loadEditorSource(resolvedLanguage, savedDraft ?? starterCode, questionId);

                // Parse and set tests (API returns sample_tests)
                const parsedTests = data.sample_tests || [];
                setTests(parsedTests);
                setHasTestRun(false);
                setTestPanelTab("testcase");
                setActiveTestCaseIndex(0);
                setIsLanguageMenuOpen(false);

                // Initialize results
                const initialResults: Record<string, any> = {};
                parsedTests.forEach((t: any, idx: number) => {
                    initialResults[getTestResultKey(t, idx)] = { status: "Pending" };
                });
                setResults(initialResults);

                // Fetch sheet to see next question context
                if (sheetId && token) {
                    try {
                        const sheetRes = await fetch(
                            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/users/me/sheets/${encodeURIComponent(sheetId)}`,
                            { headers: { Authorization: `Bearer ${token}` } }
                        );
                        if (sheetRes.ok) {
                            const sheetData = await sheetRes.json();
                            const currentIndex = sheetData.questions.findIndex((q: any) => q.id.endsWith(questionId));
                            if (currentIndex !== -1 && currentIndex < sheetData.questions.length - 1) {
                                const nextQ = sheetData.questions[currentIndex + 1];
                                const getSolveUrl = (q: any, sId: string): string | null => {
                                    const match = q.id.match(/^(?:cs|dsa|sql|sd)-(.+)$/);
                                    if (!match) return null;
                                    const mongoId = match[1];
                                    const cat = q.category.toLowerCase();
                                    let baseUrl = "";
                                    if (q.id.startsWith("cs-") || cat === "os" || cat === "cn" || cat === "dbms" || cat === "oops" || cat === "cs_fundamentals") {
                                        baseUrl = `/questions/cs-fundamentals/solve?id=${mongoId}`;
                                    } else if (q.id.startsWith("dsa-") || cat === "coding") {
                                        baseUrl = `/questions/dsa/solve?id=${mongoId}`;
                                    } else if (q.id.startsWith("sql-") || cat === "sql") {
                                        baseUrl = `/questions/sql/solve?id=${mongoId}`;
                                    } else if (q.id.startsWith("sd-") || cat === "system_design") {
                                        baseUrl = `/questions/system-design/solve?id=${mongoId}`;
                                    }
                                    return baseUrl ? `${baseUrl}&sheetId=${sId}` : null;
                                };
                                setNextQuestionUrl(getSolveUrl(nextQ, sheetId));
                            }
                        }
                    } catch {
                    }
                }

                setLoading(false);
            } catch (err: any) {
                setError(err.message);
                setLoading(false);
            }
        };

        fetchQuestion();
        fetchSubmissions();
        if (contestId && isContestMode) fetchContestDetailsForTimer();
        if (contestId && isContestMode) fetchContestSubmissions();
        if (contestId && isContestMode && !embedded) fetchContestQuestions();

        return () => {
            // Cleanup SSE connections
            Object.values(sseConnections.current).forEach((src) => src.close());
            // Cleanup contest tracking
            stopTracking();
            if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
        };
    }, [CONTEST_API, authLoading, contestId, embedded, fetchContestDetailsForTimer, getAccessToken, isContestMode, isSecureOaMode, oaQuestionKey, oaSessionId, questionId]);

    useEffect(() => {
        if (!contestEndTime || !isContestMode || isSecureOaMode) return;

        const checkContestEnd = () => {
            const endAt = new Date(contestEndTime).getTime();
            if (Number.isFinite(endAt) && Date.now() >= endAt) {
                void submitContestOnTimeEnd();
            }
        };

        checkContestEnd();
        const timer = window.setInterval(checkContestEnd, 1000);
        return () => window.clearInterval(timer);
    }, [contestEndTime, isContestMode, isSecureOaMode, submitContestOnTimeEnd]);

    // ─── HIDE SIDEBAR DURING ACTIVE CONTEST ────────────────────────────────
    useEffect(() => {
        // Only hide in contest / secure OA mode
        if (embedded || !isIntegrityMode || (!contestId && !isSecureOaMode)) {
            document.body.classList.remove('contest-active-hide-nav');
            return;
        }

        // Add class to hide sidebar and header
        document.body.classList.add('contest-active-hide-nav');

        return () => {
            document.body.classList.remove('contest-active-hide-nav');
        };
    }, [embedded, isIntegrityMode, isSecureOaMode, mode, contestId]);

    // ─── FULLSCREEN ENFORCEMENT FOR CONTEST MODE ────────────────────────────
    useEffect(() => {
        // Only enforce fullscreen in contest / secure OA mode
        if (!isIntegrityMode || (!contestId && !isSecureOaMode)) return;

        if (!document.fullscreenElement) {
            setShowFullscreenReturnPrompt(true);
            void requestIntegrityFullscreen();
        }

        const handleFullscreenChange = () => {
            const isFullscreen = !!document.fullscreenElement;
            
            if (!isFullscreen) {
                setShowFullscreenReturnPrompt(true);
                handleContestAutoSubmit('auto_fullscreen_exit');
            } else {
                setShowFullscreenReturnPrompt(false);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, [isIntegrityMode, isSecureOaMode, mode, contestId]);

    // ─── TAB SWITCHING & WINDOW BLUR DETECTION FOR CONTEST MODE ────────────
    useEffect(() => {
        // Only enforce in contest / secure OA mode
        if (!isIntegrityMode || (!contestId && !isSecureOaMode)) return;

        const handleVisibilityChange = () => {
            if (document.hidden) {
                const reason = altSwitchCandidateRef.current ? 'auto_alt_tab' : 'auto_tab_switch';
                altSwitchCandidateRef.current = false;
                handleContestAutoSubmit(reason);
            }
        };

        const handleBlur = () => {
            window.setTimeout(() => {
                if (document.hidden || !document.hasFocus()) {
                    const reason = altSwitchCandidateRef.current ? 'auto_alt_tab' : 'auto_window_blur';
                    altSwitchCandidateRef.current = false;
                    handleContestAutoSubmit(reason);
                }
            }, 150);
        };

        const handleFocusLoss = () => {
            const reason = altSwitchCandidateRef.current ? 'auto_alt_tab' : 'auto_page_hide';
            altSwitchCandidateRef.current = false;
            handleContestAutoSubmit(reason);
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('pagehide', handleFocusLoss); // Detects page being hidden

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('pagehide', handleFocusLoss);
        };
    }, [isIntegrityMode, isSecureOaMode, mode, contestId]);

    // ─── INTERNAL CLIPBOARD TRACKING FOR CONTEST MODE ──────────────────────
    const internalClipboardRef = useRef<string>(''); // Track internal clipboard

    useEffect(() => {
        // Only enforce in contest / secure OA mode
        if (!isIntegrityMode || (!contestId && !isSecureOaMode)) return;

        const getEventElement = (target: EventTarget | null) => {
            if (target instanceof Element) return target;
            if (target instanceof Node) return target.parentElement;
            return null;
        };

        const readEditorSelection = () => {
            const editor = mainEditorRef.current;
            const model = editor?.getModel?.();
            const selection = editor?.getSelection?.();
            if (!model || !selection) return "";
            return model.getValueInRange(selection) || "";
        };

        const trackInternalClipboard = (e: ClipboardEvent, action: "copy" | "cut") => {
            const target = getEventElement(e.target);

            if (target?.closest('.monaco-editor')) {
                const copiedText = readEditorSelection();
                internalClipboardRef.current = normalizeClipboardText(copiedText);
                return true;
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            void handleContestAutoSubmit(action === "cut" ? 'auto_question_cut' : 'auto_question_copy');
            return false;
        };

        // Track internal copy/cut operations from the code editor only.
        const handleCopy = (e: ClipboardEvent) => {
            trackInternalClipboard(e, "copy");
        };

        const handleCut = (e: ClipboardEvent) => {
            trackInternalClipboard(e, "cut");
        };

        // Intercept paste operations - only allow internal clipboard
        const handlePaste = (e: ClipboardEvent) => {
            const target = getEventElement(e.target);
            
            // Only intercept paste in code editor
            if (target?.closest('.monaco-editor')) {
                const pastedText = e.clipboardData?.getData('text/plain') || '';
                const normalizedPaste = normalizeClipboardText(pastedText);
                const normalizedInternal = internalClipboardRef.current;
                
                
                // Check if pasted content matches internal clipboard
                if (normalizedPaste === normalizedInternal && normalizedInternal !== '') {
                    // Allow internal paste
                    // Let Monaco handle it naturally - don't prevent default
                    return;
                } else {
                    // Block external paste
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    
                    // Show a visual warning
                    const warningDiv = document.createElement('div');
                    warningDiv.textContent = '⚠️ External paste blocked - You can only paste code you copied within this contest';
                    warningDiv.style.cssText = `
                        position: fixed;
                        top: 80px;
                        right: 20px;
                        background: #ef4444;
                        color: white;
                        padding: 16px 24px;
                        border-radius: 8px;
                        font-size: 14px;
                        font-weight: 600;
                        z-index: 10000;
                        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
                        max-width: 400px;
                    `;
                    document.body.appendChild(warningDiv);
                    setTimeout(() => {
                        warningDiv.style.opacity = '0';
                        warningDiv.style.transition = 'opacity 0.3s';
                        setTimeout(() => warningDiv.remove(), 300);
                    }, 3000);
                    
                    void handleContestAutoSubmit('auto_external_paste');
                    return false;
                }
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            void handleContestAutoSubmit('auto_paste_outside_editor');
            return false;
        };

        // Prevent right-click context menu
        const handleContextMenu = (e: MouseEvent) => {
            const target = getEventElement(e.target);
            // Allow context menu in code editor only
            if (target?.closest('.monaco-editor')) {
                return; // Allow context menu in editor
            }
            e.preventDefault();
            void handleContestAutoSubmit('auto_context_menu');
        };

        // Prevent text selection on question
        const handleSelectStart = (e: Event) => {
            const target = getEventElement(e.target);
            // Allow selection in code editor and input fields
            if (target?.closest('.monaco-editor') || target?.closest('input') || target?.closest('textarea')) {
                return; // Allow selection in editor and inputs
            }
            e.preventDefault();
        };

        // Prevent opening new tabs/windows
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            void handleContestAutoSubmit('auto_page_leave');
            e.preventDefault();
            e.returnValue = isSecureOaMode
                ? 'Leaving this page will record an integrity warning. Are you sure?'
                : 'Leaving this page will record an integrity warning. Are you sure?';
            return e.returnValue;
        };

        // Block dangerous keyboard shortcuts, including common screenshot shortcuts.
        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            const target = getEventElement(e.target);
            const inEditor = !!target?.closest('.monaco-editor');

            if (key === 'alt' || key === 'meta' || key === 'os') {
                altSwitchCandidateRef.current = true;
                window.setTimeout(() => {
                    altSwitchCandidateRef.current = false;
                }, 1500);
            }

            const blockedReason = getContestBlockedShortcutReason(e, { inEditor });

            if (blockedReason) {
                if (blockedReason === 'auto_alt_tab' || blockedReason === 'auto_macos_app_switch') {
                    altSwitchCandidateRef.current = false;
                }
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                void handleContestAutoSubmit(blockedReason);
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (key === 'alt' || key === 'meta' || key === 'os') {
                altSwitchCandidateRef.current = false;
            }
            if (key !== 'printscreen' && key !== 'print') return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            void handleContestAutoSubmit('auto_screenshot_printscreen');
        };

        document.addEventListener('copy', handleCopy, true);
        document.addEventListener('cut', handleCut, true);
        document.addEventListener('paste', handlePaste, true); // Use capture phase
        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('selectstart', handleSelectStart);
        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);

        return () => {
            document.removeEventListener('copy', handleCopy, true);
            document.removeEventListener('cut', handleCut, true);
            document.removeEventListener('paste', handlePaste, true);
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('selectstart', handleSelectStart);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('keyup', handleKeyUp, true);
        };
    }, [isIntegrityMode, isSecureOaMode, mode, contestId, code, language]);

    const runAllTests = async () => {
        if (!question || tests.length === 0) return;

        setHasTestRun(true);
        setSubmissionResult(null);
        setActiveTab((currentTab) => currentTab === "result" ? "description" : currentTab);
        setTestPanelTab("result");
        setIsRunning(true);

        // Set all to running
        setResults((prev) => {
            const next = { ...prev };
            tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Running" }));
            return next;
        });

        try {
            const token = await getAccessToken();
            const currentCode = getCurrentEditorCode();

            const contestRun = isContestMode && contestId && !isSecureOaMode;
            const res = await fetch(
                contestRun
                    ? `${CONTEST_API}/execute/run`
                    : `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/run`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        questionId: question.id,
                        code: currentCode,
                        language,
                        // Send user-added custom cases so the contest run executes
                        // them too (output only — they never affect submission).
                        ...(contestRun
                            ? { customTests: tests.filter((t) => t?.custom).map((t) => ({ stdin: String(t?.stdin ?? "") })) }
                            : {}),
                        ...(!contestRun ? {
                            language_id: JUDGE0_LANGUAGE_IDS[language?.toLowerCase?.() || language],
                            ...(isSecureOaMode ? {
                                mode: "secure_oa",
                                oaSessionId,
                                oaQuestionKey,
                            } : {}),
                        } : {}),
                    }),
                }
            );

            const data = await res.json();

            // Handle compilation errors
            if (!data.success && data.compileOutput) {
                setIsRunning(false);
                setSubmissionResult({
                    status: "compile_error",
                    message: "Compilation Error",
                    errorDetails: data.compileOutput,
                });
                setActiveTab("result");
                
                setResults(buildUniformResultMap(tests, "Compilation Error", { compile_output: data.compileOutput }));
                return;
            }

            if (data.error) throw new Error(data.error);

            // Handle results - API returns { success, sample: { tests: [...] } }
            if (data.success && data.sample?.tests) {
                // Convert API format to frontend format
                const resultsMap: Record<string, any> = {};
                data.sample.tests.forEach((test: any, idx: number) => {
                    const status = getRunCaseStatus(test);
                    const testId = getTestResultKey(tests[idx], idx);
                    resultsMap[testId] = {
                        status,
                        input: test.input,
                        expected: test.expectedOutput,
                        actual: test.actualOutput,
                        passed: test.passed,
                        error: test.error,
                        runtime: test.time,
                        memory: test.memory,
                    };
                });
                setResults(resultsMap);
                setIsRunning(false);

                const firstCompileFailure = data.sample.tests.find((test: any) =>
                    typeof test?.status === "string" && test.status.toLowerCase().includes("compilation")
                );
                const firstRuntimeFailure = data.sample.tests.find((test: any) =>
                    typeof test?.status === "string" &&
                    !test.passed &&
                    (
                        test.status.toLowerCase().includes("runtime") ||
                        test.status.toLowerCase().includes("time limit") ||
                        test.status.toLowerCase().includes("memory limit")
                    )
                );

                if (firstCompileFailure) {
                    setSubmissionResult({
                        status: "compile_error",
                        message: "Compilation Error",
                        errorDetails: firstCompileFailure.error || "Your code failed to compile.",
                    });
                    setActiveTab("result");
                    return;
                }

                if (firstRuntimeFailure) {
                    setSubmissionResult({
                        status: "error",
                        message: firstRuntimeFailure.status || "Runtime Error",
                        errorDetails: firstRuntimeFailure.error || "Your code failed while running the sample tests.",
                    });
                    setActiveTab("result");
                    return;
                }
            } else if (Array.isArray(data.results)) {
                const resultsMap: Record<string, any> = {};
                data.results.forEach((test: any, idx: number) => {
                    const status = getRunCaseStatus(test);
                    const testId = getTestResultKey(tests[idx], idx);
                    resultsMap[testId] = {
                        status,
                        input: test.input,
                        expected: test.expectedOutput,
                        actual: test.actualOutput,
                        passed: test.passed,
                        error: test.error,
                        runtime: test.executionTime,
                        memory: test.memory,
                    };
                });
                setResults(resultsMap);
                setIsRunning(false);

                const firstCompileFailure = data.results.find((test: any) =>
                    typeof test?.status === "string" && test.status.toLowerCase().includes("compilation")
                );
                const firstRuntimeFailure = data.results.find((test: any) =>
                    typeof test?.status === "string" &&
                    !test.passed &&
                    (
                        test.status.toLowerCase().includes("runtime") ||
                        test.status.toLowerCase().includes("time limit") ||
                        test.status.toLowerCase().includes("memory limit")
                    )
                );

                if (firstCompileFailure) {
                    setSubmissionResult({
                        status: "compile_error",
                        message: "Compilation Error",
                        errorDetails: firstCompileFailure.error || "Your code failed to compile.",
                    });
                    setActiveTab("result");
                    return;
                }

                if (firstRuntimeFailure) {
                    setSubmissionResult({
                        status: "error",
                        message: firstRuntimeFailure.status || "Runtime Error",
                        errorDetails: firstRuntimeFailure.error || "Your code failed while running the sample tests.",
                    });
                    setActiveTab("result");
                    return;
                }
            } else if (data.results) {
                setResults(data.results);
                setIsRunning(false);
            } else {
                // No valid results format found
                throw new Error("Invalid response format from server");
            }
        } catch (err: any) {
            setIsRunning(false);
            setSubmissionResult({
                status: "error",
                message: "Failed to run code",
                errorDetails: err.message,
            });
            setActiveTab("result");

            setResults(buildUniformResultMap(tests, "Error", { error: err.message }));
        }
    };

    const submitCode = async () => {
        if (!question) return;

        if (isSecureOaMode) {
            postSecureOaMessage({
                type: "secure-oa:submit-request",
                code,
                language,
            });
            return;
        }

        // ── CONTEST MODE: Queue-based async submission (Codeforces-style) ──────
        if (isContestMode && contestId && questionId) {
            setHasTestRun(true);
            setTestPanelTab('result');
            setIsSubmitting(true);
            setQueueStatus('queued');
            setQueueElapsed(0);
            setDuplicateRetryUntil(null);
            setSubmissionResult(null);

            // Set test pills to "Running" — but never touch the user's custom
            // cases: Submit only runs the real (hidden) judge tests.
            setResults((prev: Record<string, any>) => {
                const next = { ...prev };
                tests.forEach((t: any, idx: number) => {
                    if (t?.custom) return;
                    next[getTestResultKey(t, idx)] = { status: 'Running' };
                });
                return next;
            });

            // Start elapsed timer
            const startTime = Date.now();
            elapsedRef.current = setInterval(() => {
                setQueueElapsed(Math.floor((Date.now() - startTime) / 1000));
            }, 1000);

            try {
                const token = await getAccessToken();
                if (!token) throw new Error('Not authenticated');
                const currentCode = getCurrentEditorCode();

                const idempotencyKey = crypto.randomUUID();
                const res = await fetch(`${CONTEST_API}/execute/submit`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        contestId,
                        questionId,
                        code: currentCode,
                        language,
                        idempotencyKey,
                    }),
                });

                const data = await res.json();

                if (!res.ok) {
                    stopTracking();
                    setIsSubmitting(false);
                    setQueueStatus('idle');
                    const retryAfterSeconds = Number(data?.retryAfterSeconds ?? data?.retryAfter ?? 0);
                    const isDuplicateCooldown =
                        data?.code === 'DUPLICATE_SUBMISSION' ||
                        retryAfterSeconds > 0 ||
                        /duplicate submission/i.test(String(data?.message || data?.error || ''));

                    if (isDuplicateCooldown) {
                        const seconds = Math.max(1, Math.ceil(retryAfterSeconds || 30));
                        const details = `Duplicate submission detected. Please wait ${formatWaitSeconds(seconds)} before submitting the same code again.`;
                        setDuplicateRetryUntil(Date.now() + seconds * 1000);
                        setSubmissionResult({
                            status: 'error',
                            message: 'Duplicate submission detected',
                            errorDetails: details,
                            isDuplicateCooldown: true,
                        });
                        setActiveTab('result');
                        setResults(buildUniformResultMap(tests.filter((t: any) => !t?.custom), "Error", { error: details }));
                        return;
                    }
                    throw new Error(data.message || data.error || 'Submission failed');
                }

                const { submissionId, attemptNumber: attempt } = data;
                setActiveSubmissionId(submissionId);
                activeSubRef.current = submissionId;
                setAttemptNumber(attempt ?? 1);

                // Start polling (always runs as fallback) + WebSocket (primary)
                await startPolling(submissionId, token);
                connectWebSocket(submissionId, token);

            } catch (err: any) {
                stopTracking();
                setIsSubmitting(false);
                setQueueStatus('idle');
                setSubmissionResult({
                    status: 'error',
                    message: err.message || 'Failed to submit',
                    errorDetails: err.message,
                });
                setActiveTab('result');
                setResults(buildUniformResultMap(tests.filter((t: any) => !t?.custom), "Error", { error: err.message }));
            }
            return; // Don't fall through to the regular submit logic
        }

        // ── REGULAR MODE: Synchronous IDE submit ──────────────────────────────
        if (billingSnapshot?.plan === 'FREE') {
            setUpgradeOpen(true);
            setUpgradeCopy('Upgrade to Plus or higher to run your code against hidden test cases and submit your solutions officially.');
            return;
        }

        setHasTestRun(true);
        setTestPanelTab('result');
        setIsSubmitting(true);

        setResults((prev: Record<string, any>) => {
            const next = { ...prev };
            tests.forEach((t: any, idx: number) => (next[getTestResultKey(t, idx)] = { status: 'Running' }));
            return next;
        });

        try {
            const token = await getAccessToken();

            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/ide/submit`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        questionId: question.id,
                        code,
                        language,
                        language_id: JUDGE0_LANGUAGE_IDS[language?.toLowerCase?.() || language],
                    }),
                }
            );

            const data = await res.json();

            if (!res.ok && shouldShowUpgradeForError(data)) {
                setIsSubmitting(false);
                setUpgradeCopy(copyFromUpgradeError(data));
                setUpgradeOpen(true);
                setResults((prev: Record<string, any>) => {
                    const next = { ...prev };
                    tests.forEach((t: any, idx: number) => (next[getTestResultKey(t, idx)] = { status: 'Pending' }));
                    return next;
                });
                return;
            }

            if (!data.success && data.compileOutput) {
                setIsSubmitting(false);
                setSubmissionResult({ status: 'compile_error', message: 'Compilation Error', errorDetails: data.compileOutput });
                setActiveTab('result');
                setResults(buildUniformResultMap(tests, 'Compilation Error', { compile_output: data.compileOutput }));
                return;
            }

            if (data.error) {
                if (shouldShowUpgradeForError(data)) {
                    setIsSubmitting(false);
                    setUpgradeCopy(copyFromUpgradeError(data));
                    setUpgradeOpen(true);
                    setResults((prev: Record<string, any>) => {
                        const next = { ...prev };
                        tests.forEach((t: any, idx: number) => (next[getTestResultKey(t, idx)] = { status: 'Pending' }));
                        return next;
                    });
                    return;
                }
                throw new Error(data.message || data.error);
            }

            if (data.success) {
                const resultsMap: Record<string, any> = {};

                if (data.sample?.tests) {
                    data.sample.tests.forEach((test: any, idx: number) => {
                        const testId = getTestResultKey(tests[idx], idx);
                        resultsMap[testId] = {
                            status: test.passed ? 'Accepted' : 'Wrong Answer',
                            input: test.input, expected: test.expectedOutput, actual: test.actualOutput,
                            passed: test.passed, error: test.error, runtime: test.time, memory: test.memory,
                            stdout: test.actualOutput, stderr: test.stderr, compile_output: test.compileOutput,
                        };
                    });
                }

                const samplePassed = data.sample?.summary?.passed || 0;
                const sampleTotal  = data.sample?.summary?.total  || 0;
                const hiddenPassed = data.hidden?.summary?.passed || 0;
                const hiddenTotal  = data.hidden?.summary?.total  || 0;

                const failedSampleTest = data.sample?.tests?.find((t: any) => !t.passed);
                const failedHiddenTest = data.hidden?.firstFailed;
                const failedTest = failedSampleTest
                    ? { source: 'sample' as const, status: failedSampleTest.status, input: failedSampleTest.input || '', expected: failedSampleTest.expectedOutput || '', actual: failedSampleTest.actualOutput || '', stderr: failedSampleTest.stderr || '', compileOutput: failedSampleTest.compileOutput || '' }
                    : failedHiddenTest
                    ? { source: 'hidden' as const, status: failedHiddenTest.status, input: failedHiddenTest.input || '', expected: failedHiddenTest.expectedOutput || '', actual: failedHiddenTest.actualOutput || '', stderr: failedHiddenTest.stderr || '', compileOutput: failedHiddenTest.compileOutput || '' }
                    : undefined;

                const allPassed = samplePassed === sampleTotal && (!data.hidden?.summary || hiddenPassed === hiddenTotal);

                setSubmissionResult({
                    status: allPassed ? 'accepted' : 'wrong_answer',
                    message: allPassed ? 'All test cases passed!' : `Failed ${sampleTotal - samplePassed + (hiddenTotal - hiddenPassed)} test case(s)`,
                    samplePassed, sampleTotal,
                    ...(data.hidden?.summary && { hiddenPassed, hiddenTotal }),
                    ...(failedTest ? { failedTest } : {}),
                });
                setResults(resultsMap);
                setIsSubmitting(false);

                if (allPassed) {
                    updateLastQuestionDate();
                    if (sheetId && questionId) {
                        try {
                            const t2 = await getAccessToken();
                            if (t2) {
                                try {
                                    await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/custom-sheets/${encodeURIComponent(sheetId)}/progress`, {
                                        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t2}` },
                                        body: JSON.stringify({ questionId: `dsa-${questionId}`, status: 'completed' }),
                                    });
                                } catch {
                                    await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/users/me/sheets/${encodeURIComponent(sheetId)}/progress`, {
                                        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t2}` },
                                        body: JSON.stringify({ questionId: `dsa-${questionId}`, status: 'completed' }),
                                    });
                                }
                            }
                        } catch {}
                    }
                }

                setActiveTab('result');
                fetchSubmissions();
            } else {
                throw new Error('Invalid response format from server');
            }
        } catch (err: any) {
            setIsSubmitting(false);
            setSubmissionResult({ status: 'error', message: 'Failed to submit code', errorDetails: err.message });
            setActiveTab('result');
            setResults(buildUniformResultMap(tests, "Error", { error: err.message }));
        }
    };

    const getBadgeClass = (status: string) => {
        if (!status || status === "Pending") return "bg-slate-500";
        if (status === "Running") return "bg-blue-500 animate-pulse";
        if (status === "Accepted") return "bg-emerald-500";
        return "bg-red-500";
    };


    if (loading) {
        return (
            <div className={`flex items-center justify-center ${embedded ? "h-full min-h-[520px]" : "h-screen"} bg-[#FAFBFC] dark:bg-lc-bg`}>
                <div className="text-slate-600 dark:text-slate-400">Loading question...</div>
            </div>
        );
    }

    if (error || !question) {
        return (
            <div className={`flex items-center justify-center ${embedded ? "h-full min-h-[520px]" : "h-screen"} bg-[#FAFBFC] dark:bg-lc-bg`}>
                <div className="text-red-600 dark:text-red-400">
                    {error || "Question not found"}
                </div>
            </div>
        );
    }

    return (
        <div className={`${embedded ? "h-full" : "h-screen"} relative bg-[#FAFBFC] dark:bg-lc-bg`}>
            <style jsx global>{`
                .contest-question-content {
                    box-sizing: border-box;
                    min-width: 0;
                    max-width: 100%;
                    white-space: normal !important;
                    overflow-wrap: break-word !important;
                    word-break: normal !important;
                }

                .contest-question-statement {
                    min-width: 0 !important;
                    max-width: 100% !important;
                    overflow-wrap: break-word !important;
                    word-break: normal !important;
                }

                .contest-question-statement table {
                    white-space: normal !important;
                }

                .contest-question-statement pre,
                .contest-question-statement code {
                    white-space: pre-wrap !important;
                }

                .contest-question-statement .katex-display {
                    overflow-x: auto;
                    overflow-y: hidden;
                    padding-bottom: 0.125rem;
                }

                .contest-question-content img,
                .contest-question-content svg {
                    max-width: 100%;
                    height: auto;
                }

                .contest-question-content code,
                .contest-question-content pre {
                    white-space: pre-wrap !important;
                    overflow-wrap: anywhere !important;
                    word-break: break-word !important;
                }

                .contest-question-content pre,
                .contest-question-content table {
                    display: block;
                    overflow-x: auto;
                    width: 100%;
                }
            `}</style>
            {isIntegrityMode && identityWatermark && <IntegrityWatermark text={identityWatermark} />}
            <ModalDialog
                isOpen={modalState.isOpen}
                onClose={() => setModalState({ ...modalState, isOpen: false })}
                title={modalState.title}
                message={modalState.message}
                type={modalState.type}
                details={modalState.details}
            />

            {/* ── Global Verdict Toast (contest mode) ───────────────────────── */}
            {verdictToast?.visible && (
                <div
                    className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border backdrop-blur-md transition-all duration-500 max-w-sm ${
                        verdictToast.status === 'ACCEPTED'
                            ? 'bg-emerald-50/95 dark:bg-emerald-900/90 border-emerald-200 dark:border-emerald-700'
                            : verdictToast.status === 'TIME_LIMIT_EXCEEDED' || verdictToast.status === 'MEMORY_LIMIT_EXCEEDED'
                            ? 'bg-orange-50/95 dark:bg-orange-900/90 border-orange-200 dark:border-orange-700'
                            : verdictToast.status === 'COMPILATION_ERROR'
                            ? 'bg-purple-50/95 dark:bg-purple-900/90 border-purple-200 dark:border-purple-700'
                            : 'bg-red-50/95 dark:bg-red-900/90 border-red-200 dark:border-red-700'
                    }`}
                >
                    <span className={`material-symbols-outlined text-[28px] ${getVerdictMeta(verdictToast.status).color}`}>
                        {getVerdictMeta(verdictToast.status).icon}
                    </span>
                    <div className="flex-1 min-w-0">
                        <p className={`font-bold text-sm ${getVerdictMeta(verdictToast.status).color}`}>
                            {getVerdictMeta(verdictToast.status).label}
                        </p>
                    </div>
                    <span className={`text-sm font-bold ${verdictToast.points > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                        {verdictToast.points > 0 ? `+${verdictToast.points}` : verdictToast.points}
                    </span>
                    <button
                        onClick={() => setVerdictToast(null)}
                        className="ml-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            )}
            {/* ───────────────────────────────────────────────────────────────── */}

            <UpgradeModal
                open={upgradeOpen}
                onClose={() => setUpgradeOpen(false)}
                feature="dsa_submit"
                reason="limit"
                title="Upgrade to submit"
                description={
                    upgradeCopy ||
                    "Hidden test submissions and higher submit limits are available on paid plans."
                }
                currentPlan={billingSnapshot?.plan}
                currentSubscriptionId={billingSnapshot?.subscriptionId ?? undefined}
            />

            {showAutoSubmitModal && (
                <div className="fixed inset-0 z-[99999] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
                    <section className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-slate-950 shadow-2xl dark:border-white/10 dark:bg-[#202020] dark:text-white sm:p-8">
                        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300">
                                <span className="material-symbols-outlined text-[30px]">gpp_maybe</span>
                            </span>
                            <div className="flex-1">
                                <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-red-600 dark:text-red-300">
                                    Integrity warning recorded
                                </p>
                                <h2 className="mt-2 font-nunito text-2xl font-extrabold">
                                    Warning recorded
                                </h2>
                                <p className="mt-3 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                                    Your {isSecureOaMode ? "assessment" : "contest"} recorded this integrity warning:
                                </p>
                                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-extrabold text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
                                    {autoSubmitReason}
                                </div>
                                <div className="mt-5">
                                    <div className="mb-2 flex items-center justify-between text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">
                                        <span>Warnings recorded</span>
                                        <span>{integrityWarningCount}</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-slate-200 dark:bg-white/10">
                                        <div className="h-full rounded-full bg-red-500" style={{ width: "100%" }} />
                                    </div>
                                </div>
                                <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    Current progress remains available.
                                </p>
                            </div>
                        </div>
                        <div className="mt-8 flex justify-end">
                            <button
                                type="button"
                                onClick={handleModalOk}
                                className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-7 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                            >
                                Continue
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {showFullscreenReturnPrompt && isIntegrityMode && !showAutoSubmitModal && (
                <div className="fixed inset-0 z-[9998] grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
                    <section className="w-full max-w-md rounded-lg border border-white/10 bg-white p-6 text-slate-950 shadow-2xl dark:bg-[#262626] dark:text-white">
                        <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined mt-1 text-slate-700 dark:text-slate-200">fullscreen</span>
                            <div>
                                <h2 className="font-nunito text-xl font-extrabold">Return to fullscreen</h2>
                                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                                    Fullscreen is required. Warning {integrityWarningCount} has been recorded.
                                </p>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button
                                type="button"
                                onClick={requestIntegrityFullscreen}
                                className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-slate-950 px-5 text-sm font-extrabold text-white shadow-lg shadow-black/20 transition hover:bg-slate-800 dark:border-white/15 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                            >
                                Enter Fullscreen
                            </button>
                        </div>
                    </section>
                </div>
            )}
            <Group orientation="horizontal" className="h-full w-full overflow-hidden">
                {/* Left Panel - Problem Description */}
                <Panel
                    defaultSize={40}
                    minSize={25}
                    className="min-w-0 overflow-hidden"
                    style={{ minWidth: 0, overflow: "hidden" }}
                >
                    <div
                        className="grid h-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden bg-white dark:bg-[#282828]"
                        style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
                    >
                        <div className="relative z-40 shrink-0 border-b border-slate-200 bg-white dark:border-[#3e3e3e] dark:bg-[#282828]">
                            <div className="flex min-h-[52px] min-w-0 items-center gap-2.5 px-4">
                                {(!embedded || isContestMode) && (
                                    <button
                                        type="button"
                                        onClick={() => void handleBackNavigation()}
                                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                                        title="Back"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                                    </button>
                                )}

                                <div className="min-w-0 flex-1">
                                    <h1 className="truncate font-nunito text-[17px] font-extrabold text-slate-900 dark:text-white">
                                        {displayQuestionTitle}
                                    </h1>
                                </div>

                                {sheetId && nextQuestionUrl && (
                                    <a
                                        href={nextQuestionUrl}
                                        className="hidden shrink-0 items-center gap-1.5 rounded bg-teal-50 px-2.5 py-1 text-[12px] font-semibold text-teal-700 transition-colors hover:bg-teal-100 dark:bg-teal-900/30 dark:text-teal-400 dark:hover:bg-teal-800/50 sm:inline-flex"
                                    >
                                        Next
                                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                                    </a>
                                )}

                                {isContestMode && contestId && (
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        {contestEndTime && contestTimeRemainingMs > 0 && (
                                            <span
                                                className={`rounded-md px-2 py-1 font-mono text-[13px] font-extrabold leading-none ${
                                                    contestTimerUrgent
                                                        ? 'animate-pulse bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                                                        : 'bg-slate-100 text-slate-600 dark:bg-[#333333] dark:text-slate-300'
                                                }`}
                                                title="Time remaining"
                                            >
                                                {contestTimeFormatted}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => navigateToContestQuestion(previousContestQuestion?.id)}
                                            disabled={!previousContestQuestion}
                                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                                            title="Previous question"
                                            aria-label="Previous question"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">chevron_left</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => navigateToContestQuestion(nextContestQuestion?.id)}
                                            disabled={!nextContestQuestion}
                                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                                            title="Next question"
                                            aria-label="Next question"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">chevron_right</span>
                                        </button>
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setIsQuestionNavigatorOpen((open) => !open)}
                                            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                                            title="Question navigator"
                                            aria-label="Question navigator"
                                        >
                                            <span className="material-symbols-outlined text-[22px]">more_vert</span>
                                        </button>

                                        {isQuestionNavigatorOpen && (
                                            <div className="absolute right-0 top-11 z-[120] w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-2xl dark:border-[#3e3e3e] dark:bg-[#242424]">
                                                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-[#3e3e3e]">
                                                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Questions</p>
                                                    <p className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-extrabold text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                                                        Warnings {integrityWarningCount}
                                                    </p>
                                                </div>
                                                <div className="mt-2 max-h-[60vh] overflow-y-auto pr-1">
                                                    {contestQuestions.length > 0 ? contestQuestions.map((item: any, index: number) => {
                                                        const active = String(item.id) === String(questionId);
                                                        const solved = item.status === "solved";
                                                        return (
                                                            <button
                                                                key={item.id}
                                                                type="button"
                                                                onClick={() => navigateToContestQuestion(item.id)}
                                                                className={`mb-1 w-full rounded-lg p-3 text-left transition ${
                                                                    active
                                                                        ? "bg-primary text-white shadow-lg shadow-primary/20"
                                                                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#333333]"
                                                                }`}
                                                            >
                                                                <span className={`text-[11px] font-extrabold uppercase tracking-[0.12em] ${active ? "text-white/75" : "text-primary"}`}>
                                                                    Question {index + 1}
                                                                </span>
                                                                <span className="mt-1 block truncate text-sm font-extrabold">{item.title || "Untitled question"}</span>
                                                                <span className={`mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold ${active ? "text-white/75" : "text-slate-500 dark:text-slate-400"}`}>
                                                                    <span>{item.points || 0} pts</span>
                                                                    {item.negativePoints > 0 && (
                                                                        <span className={active ? "text-white/60" : "text-red-500 dark:text-red-400"}>−{item.negativePoints} per wrong</span>
                                                                    )}
                                                                    {solved && <span className={active ? "text-white/90" : "text-emerald-600 dark:text-emerald-400"}>✓ Solved</span>}
                                                                    {item.attempts > 0 && <span>{item.attempts} attempts</span>}
                                                                </span>
                                                            </button>
                                                        );
                                                    }) : (
                                                        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500 dark:border-[#3e3e3e] dark:text-slate-400">
                                                            Loading questions...
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    </div>
                                )}
                            </div>
                        </div>
                <div className="flex w-full min-w-0 max-w-full items-center overflow-hidden bg-slate-100 dark:bg-[#333333]">
                    <button
                        onClick={() => setActiveTab("description")}
                        className={`px-3 py-2 text-[13px] font-medium ${
                            activeTab === "description"
                                ? "text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                    >
                        Description
                    </button>
                    {/* Hide Solution tab in contest mode */}
                    {!isIntegrityMode && (
                        <button
                            onClick={() => setActiveTab("solution")}
                            className={`px-3 py-2 text-[13px] font-medium ${
                                activeTab === "solution"
                                    ? "text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400"
                                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                        >
                            Solution
                        </button>
                    )}
                    <button
                        onClick={() => setActiveTab("submissions")}
                        className={`px-3 py-2 text-[13px] font-medium ${
                            activeTab === "submissions"
                                ? "text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                    >
                        Submissions
                    </button>
                    {/* Processing Tab - shown during contest submission queue */}
                    {(queueStatus === 'queued' || queueStatus === 'processing' || queueStatus === 'deferred') && (
                        <button
                            onClick={() => setActiveTab('result')}
                            className={`px-3 py-2 text-[13px] font-medium flex items-center gap-2 transition-colors ${
                                activeTab === 'result'
                                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                                    : 'text-blue-500 dark:text-blue-400 hover:text-blue-700'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[14px] animate-spin">autorenew</span>
                            {queueStatus === 'queued' ? 'In Queue' : queueStatus === 'deferred' ? 'Retrying' : 'Running'}
                        </button>
                    )}
                    {/* Result Tab - Only shown when there's a submission result */}
                    {submissionResult && (
                        <div className="relative flex items-center group">
                            <button
                                onClick={() => setActiveTab("result")}
                                className={`px-3 py-2 text-[13px] font-medium flex items-center gap-2 transition-colors ${
                                    activeTab === "result"
                                        ? submissionResult.status === "accepted"
                                            ? "text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-600 dark:border-emerald-400"
                                            : "text-red-600 dark:text-red-400 border-b-2 border-red-600 dark:border-red-400"
                                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                                }`}
                            >
                                {/* Status Icon - matches LeetCode style */}
                                {submissionResult.status === "accepted" ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                )}
                                
                                {/* Tab Label */}
                                {submissionResult.status === "accepted" ? "Accepted" : 
                                 submissionResult.status === "compile_error" ? "Compile Error" : 
                                 "Wrong Answer"}
                            </button>
                            
                            {/* Close Button - hidden by default, appears on hover of the tab */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSubmissionResult(null);
                                    setActiveTab("submissions");
                                }}
                                className="ml-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-all"
                                title="Close result"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    )}
                    {/* Report bug — pushed to far right */}
                    <div className="ml-auto pr-3">
                        <ReportQuestionModal
                            questionId={question.id}
                            questionType="dsa"
                            questionTitle={question.title}
                        />
                    </div>
                </div>

                <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-6">
                    {/* Difficulty Badge and non-contest sheet action */}
                    <div className="mb-4 flex items-center justify-between">
                        {(!isContestMode || showDifficultyTags) && (
                            <span
                                className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${getDifficultyBadgeClass(question.difficulty)}`}
                            >
                                {getDifficultyLabel(question.difficulty)}
                            </span>
                        )}
                        
                        {!isIntegrityMode && (
                            <button
                                onClick={() => setShowAddToSheet(true)}
                                className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-200 hover:text-slate-800 dark:bg-[#333333] dark:text-slate-400 dark:hover:bg-[#3e3e3e] dark:hover:text-slate-200"
                                title="Add to custom sheet"
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    playlist_add
                                </span>
                                <span>Add to Sheet</span>
                            </button>
                        )}
                    </div>

                    {activeTab === "description" ? (
                        <div className="contest-question-content prose prose-sm dark:prose-invert w-full max-w-full min-w-0 break-words [&_*]:max-w-full [&_*]:min-w-0 [&_li]:whitespace-normal [&_p]:whitespace-normal [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_code]:whitespace-pre-wrap">
                            {/* Description */}
                            <RichQuestionContent
                                content={question.statement || (question as any)?.description || ""}
                                compact
                                className="contest-question-statement min-w-0 break-words text-[14px] leading-6 text-slate-700 dark:text-slate-100"
                            />
                            
                            {/* Examples */}
                            {question.examples && question.examples.length > 0 && (
                                <div className="mt-6">
                                    <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">Examples</h3>
                                    {question.examples.map((ex: any, idx: number) => (
                                        <div key={idx} className="mb-4 max-w-full min-w-0 overflow-hidden rounded-lg bg-slate-50 p-3 dark:bg-[#1c160d]">
                                            <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
                                                Example {idx + 1}:
                                            </div>
                                            {ex.input && (
                                                <div className="mb-3">
                                                    <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                                                        Input:
                                                    </div>
                                                    <div className="max-w-full min-w-0 overflow-x-auto rounded bg-white p-2.5 dark:bg-[#282828]">
                                                        <QuestionExampleValue value={ex.input} />
                                                    </div>
                                                </div>
                                            )}
                                            {ex.output && (
                                                <div className="mb-3">
                                                    <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                                                        Output:
                                                    </div>
                                                    <div className="max-w-full min-w-0 overflow-x-auto rounded bg-white p-2.5 dark:bg-[#282828]">
                                                        <QuestionExampleValue value={ex.output} />
                                                    </div>
                                                </div>
                                            )}
                                            {ex.explanation && (
                                                <div>
                                                    <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                                                        Explanation:
                                                    </div>
                                                    <RichQuestionContent content={ex.explanation} compact />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                            
                            {/* Constraints */}
                            {constraintLines.length > 0 && (
                                <div className="mt-6">
                                    <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">Constraints</h3>
                                    <div className="max-w-full min-w-0 overflow-hidden rounded-lg bg-slate-50 p-3 dark:bg-[#1c160d]">
                                        <div className="max-w-full min-w-0 space-y-2 text-sm text-slate-700 dark:text-slate-100">
                                            {constraintLines.map((constraint: string, idx: number) => (
                                                <div key={idx} className="max-w-full min-w-0 overflow-x-auto rounded-md bg-white/70 px-3 py-2 leading-relaxed break-words dark:bg-[#282828]">
                                                    <RichQuestionContent content={constraint} compact />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Topics - Hidden in contest mode */}
                            {!isIntegrityMode && question.topics && question.topics.length > 0 && (
                                <div className="mt-8">
                                    <button
                                        type="button"
                                        onClick={() => setIsTopicsExpanded((prev) => !prev)}
                                        className="w-full flex items-center justify-between text-left"
                                    >
                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Topics</h3>
                                        <span className="material-symbols-outlined text-[20px] text-slate-600 dark:text-slate-300">
                                            {isTopicsExpanded ? "expand_less" : "expand_more"}
                                        </span>
                                    </button>
                                    {isTopicsExpanded && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {question.topics.map((topic: string, idx: number) => (
                                                <span
                                                    key={idx}
                                                    className="px-3 py-1 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-full text-sm"
                                                >
                                                    {topic}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Company Tags */}
                            {question.companyTags && question.companyTags.length > 0 && (
                                <div className="mt-8">
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">Companies</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {question.companyTags.map((company: string, idx: number) => (
                                            <span
                                                key={idx}
                                                className="px-3 py-1 bg-slate-100 dark:bg-[#333333] text-slate-700 dark:text-slate-300 rounded-full text-sm"
                                            >
                                                {company}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : activeTab === "solution" ? (
                        <div className="space-y-4">
                            {question.solution ? (
                                <>
                                    {/* Brute Force Solution */}
                                    {question.solution.bruteForce && (
                                        <div className="rounded-3xl overflow-hidden bg-slate-50 dark:bg-[#1a1a1a]">
                                            <button
                                                onClick={() => setExpandedSolution(expandedSolution === 'bruteForce' ? null : 'bruteForce')}
                                                className="w-full bg-slate-100 dark:bg-[#222222] px-4 py-3 flex items-center justify-between hover:bg-slate-200 dark:hover:bg-[#2a2a2a] transition-colors"
                                            >
                                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                                    Brute Force
                                                </h3>
                                                <svg 
                                                    className={`w-5 h-5 text-slate-600 dark:text-slate-400 transition-transform ${expandedSolution === 'bruteForce' ? 'rotate-180' : ''}`}
                                                    fill="none" 
                                                    stroke="currentColor" 
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </button>
                                            
                                            {expandedSolution === 'bruteForce' && (
                                                <div className="p-4 space-y-4 bg-white dark:bg-[#282828]">
                                                    {(() => {
                                                        const explainationText = cleanExplainationText(
                                                            question.solution.bruteForce.explaination ||
                                                            question.solution.bruteForce.description ||
                                                            question.solution.bruteForce.explanation
                                                        );
                                                        if (!explainationText) return null;

                                                        return (
                                                        <div>
                                                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                                                Explaination
                                                            </h4>
                                                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                                                {explainationText}
                                                            </p>
                                                        </div>
                                                        );
                                                    })()}

                                                    {(() => {
                                                        const bruteTime = normalizeComplexityValue(question.solution.bruteForce.timeComplexity);
                                                        const bruteSpace = normalizeComplexityValue(question.solution.bruteForce.spaceComplexity);
                                                        if (!bruteTime && !bruteSpace) return null;

                                                        return (
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                            {bruteTime && (
                                                                <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#222222]">
                                                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Time Complexity</h4>
                                                                    <p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{bruteTime}</p>
                                                                </div>
                                                            )}
                                                            {bruteSpace && (
                                                                <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#222222]">
                                                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Space Complexity</h4>
                                                                    <p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{bruteSpace}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                        );
                                                    })()}

                                                    {question.solution.bruteForce.code && Object.keys(question.solution.bruteForce.code).length > 0 && (
                                                        <div>
                                                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                                                                Code
                                                            </h4>
                                                            {(() => {
                                                                const bruteCodeLanguages = getCodeLanguages(question.solution?.bruteForce?.code);
                                                                if (bruteCodeLanguages.length === 0) return null;
                                                                const selectedBruteLang = selectedLanguage.bruteForce || bruteCodeLanguages[0];
                                                                const bruteCode = question.solution?.bruteForce?.code?.[selectedBruteLang] || "";

                                                                return (
                                                                    <>
                                                                        {/* Language Tabs - Horizontally Scrollable */}
                                                                        <div className="overflow-x-auto mb-3 border-b border-slate-200 dark:border-[#3e3e3e]">
                                                                            <div className="flex gap-2 min-w-max">
                                                                                {bruteCodeLanguages.map((lang) => (
                                                                                    <button
                                                                                        key={lang}
                                                                                        onClick={() => setSelectedLanguage({ ...selectedLanguage, bruteForce: lang })}
                                                                                        className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                                                                                            selectedBruteLang === lang
                                                                                                ? 'text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400'
                                                                                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                                                                        }`}
                                                                                    >
                                                                                        {lang.charAt(0).toUpperCase() + lang.slice(1)}
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        </div>

                                                                        {/* Code Display */}
                                                                        <div className="relative group">
                                                                            <button 
                                                                                onClick={() => handleCopyCode(bruteCode, 'bruteForce')}
                                                                                className="absolute top-3 right-3 z-10 p-1.5 rounded-md bg-transparent hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-all flex items-center justify-center opacity-70 hover:opacity-100"
                                                                                title="Copy Code"
                                                                            >
                                                                                {copiedCodeSection === 'bruteForce' ? (
                                                                                    <span className="material-symbols-outlined text-[12px] text-emerald-500 dark:text-emerald-400">check</span>
                                                                                ) : (
                                                                                    <span className="material-symbols-outlined text-[12px]">content_copy</span>
                                                                                )}
                                                                            </button>
                                                                            <div 
                                                                                className="rounded-xl overflow-hidden bg-[#ebebeb] dark:bg-[#1e1e1e]" 
                                                                                style={{ height: `${Math.max(120, bruteCode.split('\n').length * 21 + 32)}px` }}
                                                                            >
                                                                                <Editor
                                                                                    key={`brute-${selectedBruteLang}-${bruteCode.length}`}
                                                                                    height="100%"
                                                                                    theme={editorTheme}
                                                                                    defaultLanguage={LANGUAGE_MAP[selectedBruteLang as keyof typeof LANGUAGE_MAP]?.monacoId || selectedBruteLang}
                                                                                    value={bruteCode}
                                                                                    beforeMount={(monaco) => {
                                                                                        // Ensure the language is registered before mounting
                                                                                        const lang = LANGUAGE_MAP[selectedBruteLang as keyof typeof LANGUAGE_MAP]?.monacoId || selectedBruteLang;
                                                                                        monaco.editor.createModel('', lang);
                                                                                    }}
                                                                                    onMount={(editor, monaco) => {
                                                                                        const monacoLang = LANGUAGE_MAP[selectedBruteLang as keyof typeof LANGUAGE_MAP]?.monacoId || selectedBruteLang;
                                                                                        const model = editor.getModel();
                                                                                        if (model) monaco.editor.setModelLanguage(model, monacoLang);
                                                                                    }}
                                                                                    options={{
                                                                                        readOnly: true,
                                                                                        minimap: { enabled: false },
                                                                                        fontSize: 14,
                                                                                        lineNumbers: "off",
                                                                                        scrollBeyondLastLine: false,
                                                                                        automaticLayout: true,
                                                                                        padding: { top: 16, bottom: 16 },
                                                                                        renderLineHighlight: "none",
                                                                                        hideCursorInOverviewRuler: true,
                                                                                        overviewRulerBorder: false,
                                                                                        lineDecorationsWidth: 0,
                                                                                        lineNumbersMinChars: 0,
                                                                                        guides: { indentation: false },
                                                                                        scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
                                                                                        domReadOnly: true
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Better Approach */}
                                    {question.solution.optimized && (
                                        <div className="rounded-3xl overflow-hidden bg-slate-50 dark:bg-[#1a1a1a]">
                                            <button
                                                onClick={() => setExpandedSolution(expandedSolution === 'optimized' ? null : 'optimized')}
                                                className="w-full bg-slate-100 dark:bg-[#222222] px-4 py-3 flex items-center justify-between hover:bg-slate-200 dark:hover:bg-[#2a2a2a] transition-colors"
                                            >
                                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                                    Optimal Approach
                                                </h3>
                                                <svg 
                                                    className={`w-5 h-5 text-slate-600 dark:text-slate-400 transition-transform ${expandedSolution === 'optimized' ? 'rotate-180' : ''}`}
                                                    fill="none" 
                                                    stroke="currentColor" 
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </button>
                                            
                                            {expandedSolution === 'optimized' && (
                                                <div className="p-4 space-y-4 bg-white dark:bg-[#282828]">
                                                    {(() => {
                                                        const explainationText = cleanExplainationText(
                                                            question.solution.optimized.explaination ||
                                                            question.solution.optimized.description ||
                                                            question.solution.optimized.explanation
                                                        );
                                                        if (!explainationText) return null;

                                                        return (
                                                        <div>
                                                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                                                Explaination
                                                            </h4>
                                                            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                                                {explainationText}
                                                            </p>
                                                        </div>
                                                        );
                                                    })()}

                                                    {(() => {
                                                        const optimizedTime = normalizeComplexityValue(question.solution.optimized.timeComplexity);
                                                        const optimizedSpace = normalizeComplexityValue(question.solution.optimized.spaceComplexity);
                                                        if (!optimizedTime && !optimizedSpace) return null;

                                                        return (
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                            {optimizedTime && (
                                                                <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#222222]">
                                                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Time Complexity</h4>
                                                                    <p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{optimizedTime}</p>
                                                                </div>
                                                            )}
                                                            {optimizedSpace && (
                                                                <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#222222]">
                                                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Space Complexity</h4>
                                                                    <p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{optimizedSpace}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                        );
                                                    })()}

                                                    {question.solution.optimized.code && Object.keys(question.solution.optimized.code).length > 0 && (
                                                        <div>
                                                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                                                                Code
                                                            </h4>
                                                            {(() => {
                                                                const optimizedCodeLanguages = getCodeLanguages(question.solution?.optimized?.code);
                                                                if (optimizedCodeLanguages.length === 0) return null;
                                                                const selectedOptimizedLang = selectedLanguage.optimized || optimizedCodeLanguages[0];
                                                                const optimizedCode = question.solution?.optimized?.code?.[selectedOptimizedLang] || "";

                                                                return (
                                                                    <>
                                                                        {/* Language Tabs - Horizontally Scrollable */}
                                                                        <div className="overflow-x-auto mb-3 border-b border-slate-200 dark:border-[#3e3e3e]">
                                                                            <div className="flex gap-2 min-w-max">
                                                                                {optimizedCodeLanguages.map((lang) => (
                                                                                    <button
                                                                                        key={lang}
                                                                                        onClick={() => setSelectedLanguage({ ...selectedLanguage, optimized: lang })}
                                                                                        className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                                                                                            selectedOptimizedLang === lang
                                                                                                ? 'text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400'
                                                                                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                                                                        }`}
                                                                                    >
                                                                                        {lang.charAt(0).toUpperCase() + lang.slice(1)}
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        </div>

                                                                        {/* Code Display */}
                                                                        <div className="relative group">
                                                                            <button 
                                                                                onClick={() => handleCopyCode(optimizedCode, 'optimized')}
                                                                                className="absolute top-3 right-3 z-10 p-1.5 rounded-md bg-transparent hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-all flex items-center justify-center opacity-70 hover:opacity-100"
                                                                                title="Copy Code"
                                                                            >
                                                                                {copiedCodeSection === 'optimized' ? (
                                                                                    <span className="material-symbols-outlined text-[12px] text-emerald-500 dark:text-emerald-400">check</span>
                                                                                ) : (
                                                                                    <span className="material-symbols-outlined text-[12px]">content_copy</span>
                                                                                )}
                                                                            </button>
                                                                            <div 
                                                                                className="rounded-xl overflow-hidden bg-[#ebebeb] dark:bg-[#1e1e1e]" 
                                                                                style={{ height: `${Math.max(120, optimizedCode.split('\n').length * 21 + 32)}px` }}
                                                                            >
                                                                                <Editor
                                                                                    key={`optimized-${selectedOptimizedLang}-${optimizedCode.length}`}
                                                                                    height="100%"
                                                                                    theme={editorTheme}
                                                                                    defaultLanguage={LANGUAGE_MAP[selectedOptimizedLang as keyof typeof LANGUAGE_MAP]?.monacoId || selectedOptimizedLang}
                                                                                    value={optimizedCode}
                                                                                    beforeMount={(monaco) => {
                                                                                        const lang = LANGUAGE_MAP[selectedOptimizedLang as keyof typeof LANGUAGE_MAP]?.monacoId || selectedOptimizedLang;
                                                                                        monaco.editor.createModel('', lang);
                                                                                    }}
                                                                                    onMount={(editor, monaco) => {
                                                                                        const monacoLang = LANGUAGE_MAP[selectedOptimizedLang as keyof typeof LANGUAGE_MAP]?.monacoId || selectedOptimizedLang;
                                                                                        const model = editor.getModel();
                                                                                        if (model) monaco.editor.setModelLanguage(model, monacoLang);
                                                                                    }}
                                                                                    options={{
                                                                                        readOnly: true,
                                                                                        minimap: { enabled: false },
                                                                                        fontSize: 14,
                                                                                        lineNumbers: "off",
                                                                                        scrollBeyondLastLine: false,
                                                                                        automaticLayout: true,
                                                                                        padding: { top: 16, bottom: 16 },
                                                                                        renderLineHighlight: "none",
                                                                                        hideCursorInOverviewRuler: true,
                                                                                        overviewRulerBorder: false,
                                                                                        lineDecorationsWidth: 0,
                                                                                        lineNumbersMinChars: 0,
                                                                                        guides: { indentation: false },
                                                                                        scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
                                                                                        domReadOnly: true
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="text-center py-12">
                                    <svg className="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                    <p className="text-lg text-slate-600 dark:text-slate-400">Solution not available yet</p>
                                    <p className="text-sm text-slate-500 dark:text-slate-500 mt-2">
                                        Try solving this problem on your own first!
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : activeTab === "result" ? (
                        <div className="w-full max-w-full min-w-0">
                            {/* Contest Queue Waiting State */}
                            {(queueStatus === 'queued' || queueStatus === 'processing' || queueStatus === 'deferred') && !submissionResult && (
                                <div className="flex flex-col items-center justify-center py-16 gap-6">
                                    <div className="relative w-20 h-20">
                                        <div className="absolute inset-0 rounded-full border-4 border-blue-200 dark:border-blue-900" />
                                        <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 dark:border-t-blue-400 animate-spin" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="material-symbols-outlined text-blue-500 text-[28px]">
                                                {queueStatus === 'queued' ? 'schedule' : queueStatus === 'deferred' ? 'sync_problem' : 'terminal'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-lg font-bold text-slate-800 dark:text-white">
                                            {queueStatus === 'queued' ? 'Your submission is in the queue...' : queueStatus === 'deferred' ? 'Judge is temporarily unavailable. Retrying...' : 'Judge is running your code...'}
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                                            Attempt #{attemptNumber} · {language.toUpperCase()} · {queueElapsed}s elapsed
                                        </p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                            You'll see the verdict here and as a notification — even if you navigate away
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {['●', '●', '●'].map((dot, i) => (
                                            <span key={i} className="text-blue-400 animate-bounce" style={{ animationDelay: `${i * 0.2}s` }}>{dot}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {submissionResult && (

                                <div className="space-y-4 relative">
                                    {/* Compilation Error */}
                                    {submissionResult.status === "compile_error" && (
                                        <>
                                            <div className="p-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Compilation Error</h2>
                                                </div>
                                                <p className="text-slate-700 dark:text-slate-300 text-lg">
                                                    Your code failed to compile
                                                </p>
                                            </div>

                                            {submissionResult.errorDetails && (
                                                <div className="bg-white dark:bg-[#282828] rounded-lg border border-red-200 dark:border-red-800 p-4">
                                                    <h3 className="font-semibold text-red-600 dark:text-red-400 mb-3">Error Details:</h3>
                                                    <pre className="p-4 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-900 dark:text-red-100 overflow-x-auto border border-red-200 dark:border-red-800 whitespace-pre-wrap">
{submissionResult.errorDetails}
                                                    </pre>
                                                </div>
                            )}
                                        </>
                                    )}

                                    {/* Status Header for Accepted/Wrong Answer */}
                                    {(submissionResult.status === "accepted" || submissionResult.status === "wrong_answer") && (
                                        <>
                                            <div className={`relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm dark:bg-[#282828] ${
                                                submissionResult.status === "accepted"
                                                    ? "border-emerald-200 dark:border-emerald-800"
                                                    : "border-red-200 dark:border-red-800"
                                            }`}>
                                                <div className={`absolute inset-x-0 top-0 h-1 ${submissionResult.status === "accepted" ? "bg-emerald-500" : "bg-red-500"}`} />
                                                <div className="flex items-start gap-3">
                                                    {submissionResult.status === "accepted" ? (
                                                        <>
                                                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                                                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                </svg>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <h2 className="font-nunito text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">Accepted</h2>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
                                                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                </svg>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <h2 className="font-nunito text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">Wrong Answer</h2>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Test Results Summary */}
                                            {(submissionResult.sampleTotal !== undefined || submissionResult.hiddenTotal !== undefined) && (
                                                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#3e3e3e] dark:bg-[#282828]">
                                                    <div className="mb-4 flex items-center justify-between">
                                                        <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Test Results</h3>
                                                    </div>
                                                    <div className="space-y-3">
                                                        {submissionResult.sampleTotal !== undefined && (
                                                            <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100 dark:bg-[#1f1f1f] dark:ring-[#3a3a3a]">
                                                                <div className="flex items-center justify-between gap-4">
                                                                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Sample Tests</span>
                                                                    <span className={`font-mono text-sm font-extrabold ${
                                                                    submissionResult.samplePassed === submissionResult.sampleTotal
                                                                        ? "text-emerald-600 dark:text-emerald-400"
                                                                        : "text-red-600 dark:text-red-400"
                                                                    }`}>
                                                                        {submissionResult.samplePassed === submissionResult.sampleTotal ? "Passed" : "Failed"}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {submissionResult.hiddenTotal !== undefined && (() => {
                                                            const isLimited = billingSnapshot?.entitlements?.dsaSubmitAccess === "limited";
                                                            const allPassed = submissionResult.hiddenPassed === submissionResult.hiddenTotal;
                                                            return (
                                                                <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100 dark:bg-[#1f1f1f] dark:ring-[#3a3a3a]">
                                                                    <div className="flex items-center justify-between gap-4">
                                                                        <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                                                                            {isLimited ? "Hidden Tests (limited)" : "Hidden Tests"}
                                                                        </span>
                                                                        {allPassed && (
                                                                            <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                                                                                All test cases passed
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                    {billingSnapshot?.entitlements?.dsaSubmitAccess === "limited" && (
                                                        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2.5 py-1.5 border border-amber-200 dark:border-amber-700">
                                                            <span className="material-symbols-outlined text-[14px]">info</span>
                                                            Running on limited hidden test cases. Upgrade for full test coverage.
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Upgrade Banner for PLUS users only */}
                                            {billingSnapshot?.plan === "PLUS" && submissionResult.status === "accepted" && (
                                                <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 rounded-xl p-6 border border-blue-200 dark:border-blue-800/50 shadow-lg">
                                                    <div className="flex items-start gap-4">
                                                        <div className="flex-shrink-0">
                                                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-600 dark:to-indigo-700 flex items-center justify-center shadow-lg">
                                                                <span className="material-symbols-outlined text-white text-[24px]">rocket_launch</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex-1">
                                                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                                                Unlock Full Test Coverage
                                                            </h3>
                                                            <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
                                                                Your solution is currently tested against a limited set of hidden test cases. 
                                                                Upgrade to <span className="font-semibold text-indigo-600 dark:text-indigo-400">MAX</span> to run against all hidden test cases and ensure your code handles every edge case.
                                                            </p>
                                                            <button
                                                                onClick={() => {
                                                                    setUpgradeOpen(true);
                                                                    setUpgradeCopy("Upgrade to MAX to run your code against all hidden test cases and get comprehensive validation.");
                                                                }}
                                                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 dark:from-blue-500 dark:to-indigo-500 dark:hover:from-blue-600 dark:hover:to-indigo-600 text-white text-sm font-semibold shadow-md hover:shadow-lg transition-all duration-200"
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">upgrade</span>
                                                                Upgrade to MAX
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Submitted Code - Only show for accepted submissions */}
                                            {submissionResult.status === "accepted" && code && (
                                                <div className="bg-white dark:bg-[#282828] rounded-lg border border-slate-200 dark:border-[#3e3e3e] p-4">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h3 className="font-semibold text-slate-900 dark:text-white">Submitted Code</h3>
                                                        <button
                                                            onClick={() => {
                                                                loadEditorSource(language, code, questionId);
                                                                setActiveTab("description");
                                                            }}
                                                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-md transition-colors border border-emerald-200 dark:border-emerald-800"
                                                        >
                                                            Load into Editor
                                                        </button>
                                                    </div>
                                                    <div className="relative">
                                                        <pre className="p-4 bg-slate-50 dark:bg-[#1c160d] rounded text-sm text-slate-900 dark:text-slate-100 overflow-x-auto border border-slate-200 dark:border-[#3e3e3e] font-mono">
<code>{code}</code>
                                                        </pre>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Failed Test Case Details */}
                                    {submissionResult.failedTest && (
                                        <div className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm dark:border-red-800 dark:bg-[#282828]">
                                            <div className="border-b border-red-100 bg-red-50/70 px-5 py-4 dark:border-red-900/50 dark:bg-red-500/10">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="flex min-w-0 items-center gap-3">
                                                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-red-600 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
                                                            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                        </div>
                                                        <h3 className="truncate font-nunito text-lg font-extrabold text-red-700 dark:text-red-300">
                                                            {submissionResult.failedTest.source === "hidden"
                                                                ? "First Failed Hidden Test Case"
                                                                : "Failed Test Case"}
                                                        </h3>
                                                    </div>
                                                    {submissionResult.failedTest.status && (
                                                        <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
                                                            {submissionResult.failedTest.status}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="space-y-4 p-5">
                                                <div>
                                                    <label className="mb-2 block text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Input</label>
                                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-[#3e3e3e] dark:bg-[#1f1f1f]">
                                                        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-6 text-slate-900 dark:text-slate-100">
{submissionResult.failedTest.input || "N/A"}
                                                        </pre>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="mb-2 block text-xs font-extrabold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Expected Output</label>
                                                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-800 dark:bg-emerald-500/10">
                                                        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-6 text-emerald-950 dark:text-emerald-100">
{submissionResult.failedTest.expected || "N/A"}
                                                        </pre>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="mb-2 block text-xs font-extrabold uppercase tracking-[0.12em] text-red-700 dark:text-red-300">Your Output</label>
                                                    <div className="rounded-xl border border-red-200 bg-red-50/80 p-3 dark:border-red-800 dark:bg-red-500/10">
                                                        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-6 text-red-950 dark:text-red-100">
{submissionResult.failedTest.actual || "N/A"}
                                                        </pre>
                                                    </div>
                                                </div>
                                                {submissionResult.failedTest.stderr && (
                                                    <div>
                                                        <label className="mb-2 block text-xs font-extrabold uppercase tracking-[0.12em] text-red-700 dark:text-red-300">Stderr</label>
                                                        <div className="rounded-xl border border-red-200 bg-red-50/80 p-3 dark:border-red-800 dark:bg-red-500/10">
                                                            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-6 text-red-950 dark:text-red-100">
{submissionResult.failedTest.stderr}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                )}
                                                {submissionResult.failedTest.compileOutput && (
                                                    <div>
                                                        <label className="mb-2 block text-xs font-extrabold uppercase tracking-[0.12em] text-red-700 dark:text-red-300">Compile Output</label>
                                                        <div className="rounded-xl border border-red-200 bg-red-50/80 p-3 dark:border-red-800 dark:bg-red-500/10">
                                                            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-6 text-red-950 dark:text-red-100">
{submissionResult.failedTest.compileOutput}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Message when only hidden tests failed */}
                                    {!submissionResult.failedTest && submissionResult.status === "wrong_answer" && (
                                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 p-4">
                                            <div className="flex items-start gap-3">
                                                <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <div className="flex-1">
                                                    <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-1">Hidden Test Cases Failed</h3>
                                                    <p className="text-sm text-amber-800 dark:text-amber-200">
                                                        {submissionResult.sampleTotal !== undefined
                                                            ? "Your solution passed all sample test cases but failed some hidden test cases. Review your code for edge cases and constraints."
                                                            : "Your submission failed hidden test cases. Run sample tests to inspect visible inputs, then review your code for edge cases and constraints."}
                                                    </p>
                                                    
                                                    {/* Show first failed hidden test if available */}
                                                    {submissionResult.hiddenFailedTest && (
                                                        <div className="mt-4 p-3 bg-white dark:bg-amber-950/30 rounded border border-amber-300 dark:border-amber-700">
                                                            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
                                                                First Failed Hidden Test:
                                                            </h4>
                                                            <div className="space-y-2 text-sm">
                                                                <div>
                                                                    <span className="font-medium text-amber-800 dark:text-amber-200">Input:</span>
                                                                    <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-900/20 rounded font-mono text-xs">
                                                                        {submissionResult.hiddenFailedTest.input}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <span className="font-medium text-emerald-700 dark:text-emerald-300">Expected:</span>
                                                                    <div className="mt-1 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded font-mono text-xs">
                                                                        {submissionResult.hiddenFailedTest.expected}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <span className="font-medium text-red-700 dark:text-red-300">Your Output:</span>
                                                                    <div className="mt-1 p-2 bg-red-50 dark:bg-red-900/20 rounded font-mono text-xs">
                                                                        {submissionResult.hiddenFailedTest.actual}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Runtime Error */}
                                    {submissionResult.status === "error" && submissionResult.errorDetails && (() => {
                                        const isDuplicateCooldown = Boolean(submissionResult.isDuplicateCooldown);
                                        const duplicateMessage = duplicateRetrySeconds > 0
                                            ? `Duplicate submission detected. Please wait ${formatWaitSeconds(duplicateRetrySeconds)} before submitting the same code again.`
                                            : "You can submit the same code again now.";
                                        const displayMessage = isDuplicateCooldown ? duplicateMessage : submissionResult.message;
                                        const displayDetails = isDuplicateCooldown ? duplicateMessage : submissionResult.errorDetails;

                                        return (
                                        <>
                                            <div className="p-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                                        {isDuplicateCooldown ? "Duplicate Submission" : "Runtime Error"}
                                                    </h2>
                                                </div>
                                                <p className="text-slate-700 dark:text-slate-300 text-lg">
                                                    {displayMessage}
                                                </p>
                                            </div>

                                            <div className="bg-white dark:bg-[#282828] rounded-lg border border-red-200 dark:border-red-800 p-4">
                                                <h3 className="font-semibold text-red-600 dark:text-red-400 mb-3">Error Details:</h3>
                                                <pre className="p-4 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-900 dark:text-red-100 overflow-x-auto border border-red-200 dark:border-red-800 whitespace-pre-wrap">
{displayDetails}
                                                </pre>
                                            </div>
                                        </>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div>
                            {/* Submissions Tab */}
                            {isContestMode && contestId ? (
                                /* Contest-specific submission history (Codeforces-style) */
                                <div className="w-full max-w-full min-w-0">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Submissions</h3>
                                        <button
                                            onClick={fetchContestSubmissions}
                                            disabled={loadingContestSubs}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-[#333] hover:bg-slate-200 dark:hover:bg-[#3e3e3e] text-slate-600 dark:text-slate-300 transition-colors"
                                        >
                                            <span className={`material-symbols-outlined text-[14px] ${loadingContestSubs ? 'animate-spin' : ''}`}>refresh</span>
                                            Refresh
                                        </button>
                                    </div>

                                    {/* In-queue state banner */}
                                    {queueStatus !== 'idle' && queueStatus !== 'completed' && (
                                        <div className="mb-4 p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 flex items-center gap-3">
                                            <span className="material-symbols-outlined text-blue-500 text-[22px] animate-spin">autorenew</span>
                                            <div className="flex-1">
                                                <p className="font-semibold text-blue-700 dark:text-blue-300 text-sm">
                                                    {queueStatus === 'queued' ? '⏳ Submission in queue...' : '⚡ Judge is evaluating your code...'}
                                                </p>
                                                <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">
                                                    Attempt #{attemptNumber} · {language.toUpperCase()} · {queueElapsed}s elapsed
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {contestSubmissions.length > 0 ? (
                                        <div className="w-full max-w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-[#3e3e3e]">
                                            <table className="min-w-full divide-y divide-slate-200 dark:divide-[#3e3e3e]">
                                                <thead className="bg-slate-50 dark:bg-[#1c1c1c]">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left"><span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">#</span></th>
                                                        <th className="px-4 py-3 text-left"><span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Verdict</span></th>
                                                        <th className="px-4 py-3 text-center"><span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tests</span></th>
                                                        <th className="px-4 py-3 text-center"><span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Points</span></th>
                                                        <th className="px-4 py-3 text-center"><span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Lang</span></th>
                                                        <th className="px-4 py-3 text-right"><span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Submitted</span></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-200 dark:divide-[#3e3e3e] bg-white dark:bg-[#282828]">
                                                    {contestSubmissions.map((sub: any, i: number) => {
                                                        const meta = getVerdictMeta(sub.status);
                                                        const isExpanded = expandedSubmissionIndex === i;
                                                        return (
                                                            <Fragment key={sub.id}>
                                                                <tr
                                                                    onClick={() => setExpandedSubmissionIndex(isExpanded ? null : i)}
                                                                    className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-[#343434] ${isExpanded ? 'bg-slate-50 dark:bg-[#2e2e2e]' : ''}`}
                                                                >
                                                                    <td className="px-4 py-3 text-sm text-slate-400 dark:text-slate-500 font-mono">#{sub.attemptNumber}</td>
                                                                    <td className="px-4 py-3">
                                                                        <div className="flex flex-col">
                                                                            <span className={`font-semibold text-sm ${meta.color}`}>{meta.label}</span>
                                                                            <span className="text-[11px] text-slate-400 mt-0.5">{new Date(sub.submittedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-center">
                                                                        <span className={`text-sm font-medium ${sub.status === 'ACCEPTED' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                                                            {sub.testCasesPassed}/{sub.testCasesTotal}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-center">
                                                                        <span className={`text-sm font-bold ${sub.pointsAwarded > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                                            {sub.pointsAwarded > 0 ? `+${sub.pointsAwarded}` : sub.pointsAwarded}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-center">
                                                                        <span className="text-slate-600 dark:text-slate-300 font-mono text-[10px] px-2 py-1 bg-slate-100 dark:bg-[#1c1c1c] rounded-full border border-slate-200 dark:border-slate-700 font-semibold uppercase">{sub.language}</span>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-right">
                                                                        <span className="material-symbols-outlined text-[18px] text-slate-400">{isExpanded ? 'expand_less' : 'expand_more'}</span>
                                                                    </td>
                                                                </tr>
                                                                {isExpanded && (
                                                                    <tr>
                                                        <td colSpan={6} className="p-0">
                                                                            <div className="p-4 bg-slate-50 dark:bg-[#1a1a1a] border-b border-slate-200 dark:border-[#3e3e3e]">
                                                                                <div className="flex justify-between items-center mb-3">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
                                                                                        <span className="text-slate-400 text-xs">· Attempt #{sub.attemptNumber} · {sub.language.toUpperCase()}</span>
                                                                                    </div>
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            loadEditorSource(sub.language, sub.code, questionId);
                                                                                        }}
                                                                                        className="text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 font-medium px-3 py-1 border border-teal-200 dark:border-teal-800 rounded-lg bg-white dark:bg-[#282828] flex items-center gap-1.5 transition-colors text-xs shadow-sm"
                                                                                    >
                                                                                        Load into Editor
                                                                                    </button>
                                                                                </div>
                                                                                <pre className="p-4 bg-white dark:bg-[#282828] border border-slate-200 dark:border-[#3e3e3e] rounded-lg text-[12px] font-mono text-slate-800 dark:text-slate-200 overflow-x-auto whitespace-pre-wrap max-h-64">{sub.code}</pre>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : loadingContestSubs ? (
                                        <div className="text-center py-16 text-slate-500">
                                            <span className="material-symbols-outlined text-3xl animate-spin">autorenew</span>
                                            <p className="mt-3 text-sm">Loading submissions...</p>
                                        </div>
                                    ) : (
                                        <div className="grid min-h-[280px] w-full max-w-full place-items-center rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-500 dark:border-[#3e3e3e] dark:bg-[#282828] dark:text-slate-400">
                                            <div>
                                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-[#1c1c1c]">
                                                    <span className="material-symbols-outlined text-3xl text-slate-400">send</span>
                                                </div>
                                                <p className="text-lg font-bold text-slate-900 dark:text-white">No submissions yet</p>
                                                <p className="mt-1 text-sm">Submit your code to see results here</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : pastSubmissions.length > 0 ? (
                                /* Normal mode: existing submission history */
                                <div className="w-full max-w-full min-w-0">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Submission History</h3>
                                    <div className="w-full max-w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-[#3e3e3e]">
                                        <table className="min-w-full divide-y divide-slate-200 dark:divide-[#3e3e3e]">
                                            <thead className="bg-slate-50 dark:bg-[#1c160d]">
                                                <tr>
                                                    <th className="px-4 py-3 text-left w-1/3"><span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</span></th>
                                                    <th className="px-4 py-3 text-center w-1/6"><span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Language</span></th>
                                                    <th className="px-4 py-3 text-right w-1/6"><span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Code</span></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-200 dark:divide-[#3e3e3e] bg-white dark:bg-[#282828] cursor-default">
                                                {pastSubmissions.map((sub: any, i: number) => (
                                                    <Fragment key={i}>
                                                        <tr
                                                            onClick={() => setExpandedSubmissionIndex(expandedSubmissionIndex === i ? null : i)}
                                                            className={`hover:bg-slate-50 dark:hover:bg-[#343434] transition-colors cursor-pointer ${expandedSubmissionIndex === i ? 'bg-slate-50 dark:bg-[#1f1a14]' : ''}`}
                                                        >
                                                            <td className="px-4 py-3 text-sm">
                                                                <div className="flex flex-col">
                                                                    <span className={`font-semibold ${sub.status === 'accepted' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                        {sub.status === 'accepted' ? 'Accepted' : (sub.status === 'wrong_answer' ? 'Wrong Answer' : 'Compile Error')}
                                                                    </span>
                                                                    <span className="text-[11px] text-slate-500 font-medium tracking-tight whitespace-nowrap mt-0.5">{new Date(sub.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-center"><span className="text-slate-600 dark:text-slate-300 font-mono text-[11px] px-2 py-1 bg-slate-100 dark:bg-[#1c160d] rounded-full border border-slate-200 dark:border-slate-800 tracking-wider font-semibold">{sub.language}</span></td>
                                                            <td className="px-4 py-3 text-right"><button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors ml-auto flex items-center"><span className="material-symbols-outlined text-[20px]">{expandedSubmissionIndex === i ? 'expand_less' : 'expand_more'}</span></button></td>
                                                        </tr>
                                                        {expandedSubmissionIndex === i && (
                                                            <tr>
                                              <td colSpan={3} className="p-0 border-t-0">
                                                                    <div className="p-4 bg-slate-50 dark:bg-[#1a1510] border-b border-slate-200 dark:border-[#3e3e3e]">
                                                                        <div className="flex justify-between items-center mb-3">
                                                                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Submitted Code</span>
                                                                            <button onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                loadEditorSource(sub.language, sub.code, questionId);
                                                                            }} className="text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 font-medium px-3 py-1 border border-teal-200 dark:border-teal-800 rounded bg-white dark:bg-[#282828] flex items-center gap-1.5 transition-colors text-xs shadow-sm hover:shadow">
                                                                                Load into Editor
                                                                            </button>
                                                                        </div>
                                                                        <pre className="p-4 bg-white dark:bg-[#282828] border border-slate-200 dark:border-[#3e3e3e] rounded-lg text-[13px] font-mono text-slate-800 dark:text-slate-200 overflow-x-auto whitespace-pre-wrap">{sub.code}</pre>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </Fragment>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : !submissionResult && (
                                <div className="text-center py-16 text-slate-500 dark:text-slate-400 bg-white dark:bg-[#282828] rounded-lg border border-slate-200 dark:border-[#3e3e3e]">
                                    <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 dark:bg-[#1c160d] rounded-full flex items-center justify-center">
                                        <span className="material-symbols-outlined text-3xl text-slate-400 dark:text-slate-500">history</span>
                                    </div>
                                    <p className="text-lg font-bold text-slate-900 dark:text-white">No submissions yet</p>
                                    <p className="text-sm mt-2 text-slate-500 dark:text-slate-400">Run and submit your code to track your progress</p>
                                </div>
                            )}

                        </div>
                    )}
                </div>
                    </div>
                </Panel>
                <Separator className="relative flex w-1.5 cursor-col-resize items-center justify-center bg-slate-200 transition-colors hover:bg-teal-500 dark:bg-[#3e3e3e] dark:hover:bg-teal-500 group">
                    <div className="w-0.5 h-6 bg-slate-400 dark:bg-slate-500 rounded-full group-hover:bg-teal-400 transition-colors" />
                </Separator>

                {/* Right Panel - Code Editor and Test Results */}
                <Panel defaultSize={60} minSize={30} className="min-w-0 overflow-hidden">
                <div className="h-full min-w-0 max-w-full overflow-hidden">
                    <Group orientation="vertical">
                        {/* Code Editor Panel */}
                        <Panel defaultSize={50} minSize={20}>
                            <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2 dark:bg-[#242424]">
                    <div ref={languageMenuRef} className="relative">
                        <button
                            type="button"
                            onClick={() => setIsLanguageMenuOpen((prev) => !prev)}
                            className="flex h-7 items-center gap-2 rounded-full bg-slate-200 px-3 text-[13px] font-medium text-slate-700 transition-all hover:bg-slate-300 dark:bg-[#333333] dark:text-slate-300 dark:hover:bg-[#3e3e3e]"
                            title="Select language"
                        >
                            <span>{LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP]?.label || language.toUpperCase()}</span>
                            <span className="material-symbols-outlined text-[16px] leading-none text-slate-500 dark:text-slate-300">
                                {isLanguageMenuOpen ? "expand_less" : "expand_more"}
                            </span>
                        </button>

                        {isLanguageMenuOpen && (
                            <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 min-w-[180px] overflow-hidden rounded-2xl border border-slate-200 dark:border-lc-border bg-white/95 dark:bg-lc-surface/95 backdrop-blur-md shadow-lg">
                                {Object.keys(question?.starter_code || {}).map((lang) => {
                                    const isActive = lang === language;
                                    return (
                                        <button
                                            key={lang}
                                            type="button"
                                            onClick={() => {
                                                switchEditorLanguage(lang);
                                            }}
                                            className={`w-full px-4 py-2.5 text-left text-[12px] font-semibold transition-colors ${
                                                isActive
                                                    ? "bg-primary/10 text-primary"
                                                    : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-lc-hover"
                                            }`}
                                        >
                                            {LANGUAGE_MAP[lang as keyof typeof LANGUAGE_MAP]?.label || lang.toUpperCase()}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={runAllTests}
                            disabled={isRunning || isSubmitting || !question}
                            className="flex h-7 items-center justify-center rounded-full bg-slate-600 px-3 text-[13px] font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isRunning ? "Running..." : "Run Tests"}
                        </button>
                        <button
                            onClick={submitCode}
                            disabled={isRunning || isSubmitting || !question}
                            className="flex h-7 items-center justify-center rounded-full bg-teal-600 px-3 text-[13px] font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSubmitting ? "Submitting..." : "Submit"}
                        </button>
                    </div>
                                </div>

                                <div className="flex-1 overflow-hidden">
                                    <Editor
                                        onMount={(editor, monaco) => {
                                            mainEditorRef.current = editor;
                                            // Force language tokenization immediately after mount
                                            const model = editor.getModel();
                                            const monacoLang = LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP]?.monacoId || language;
                                            if (model) monaco.editor.setModelLanguage(model, monacoLang);
                                        }}
                                        height="100%"
                                        language={LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP]?.monacoId || language}
                                        theme={editorTheme}
                                        defaultValue={code}
                                        onChange={(value) => {
                                            const nextCode = value || "";
                                            const activeLanguage = latestEditorStateRef.current.language || language;
                                            latestEditorStateRef.current = { code: nextCode, language: activeLanguage };
                                            setCode(nextCode);
                                            if (isContestMode) {
                                                writeContestCodeDraft(contestId, questionId, activeLanguage, nextCode);
                                            }
                                        }}
                                        options={{
                                            minimap: { enabled: false },
                                            fontSize: 13,
                                            lineNumbers: "on",
                                            scrollBeyondLastLine: false,
                                            automaticLayout: true,
                                            padding: { top: 10 },
                                            renderLineHighlight: "none",
                                            guides: { indentation: false }
                                        }}
                                    />
                                </div>
                            </div>
                        </Panel>

                        <Separator className="relative h-1.5 bg-slate-200 dark:bg-[#3e3e3e] hover:bg-teal-500 dark:hover:bg-teal-500 transition-colors group cursor-row-resize flex items-center justify-center">
                            <div className="h-0.5 w-6 bg-slate-400 dark:bg-slate-500 rounded-full group-hover:bg-teal-400 transition-colors" />
                        </Separator>

                        {/* Test Results Panel */}
                        <Panel defaultSize={50} minSize={20}>
                            <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] overflow-hidden">
                                {/* Header Tabs */}
                                <div className="flex items-end gap-2 bg-slate-50 px-4 pt-1.5 dark:bg-[#282828]">
                                    <button
                                        onClick={() => setTestPanelTab("testcase")}
                                        className={`flex items-center gap-2 rounded-t-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                                            testPanelTab === "testcase"
                                                ? "bg-white dark:bg-[#1e1e1e] text-green-600 dark:text-green-500"
                                                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">task_alt</span>
                                        Testcase
                                    </button>
                                    <div className="h-5 w-px bg-slate-300 dark:bg-[#444] mb-2.5 mx-1 rounded-full" />
                                    <button
                                        onClick={() => setTestPanelTab("result")}
                                        className={`flex items-center gap-2 rounded-t-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                                            testPanelTab === "result"
                                                ? "bg-white dark:bg-[#1e1e1e] text-slate-800 dark:text-slate-100"
                                                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">terminal</span>
                                        Test Result
                                    </button>
                                </div>

                                {/* Content Body */}
                                <div className="p-4 overflow-auto flex-1 bg-white dark:bg-[#1e1e1e]">
                                    {tests.length === 0 ? (
                                        <div className="text-slate-500 text-center py-4">No test cases available</div>
                                    ) : (
                                        <>
                                            {/* Results Overall Header (Only in Result tab) */}
                                            {testPanelTab === "result" && (() => {
                                                // Custom cases are output-only (never scored), so they must
                                                // not influence the overall Run/Submit verdict.
                                                const normalizedStatuses = tests
                                                    .map((t, idx) => ({ t, status: String(results[getTestResultKey(t, idx)]?.status || "Pending") }))
                                                    .filter((x) => !x.t?.custom)
                                                    .map((x) => x.status);
                                                const allFinished = normalizedStatuses.every(
                                                    (status) => status !== "Pending" && status !== "Running"
                                                );
                                                const someWrong = normalizedStatuses.some((status) => {
                                                    const lowered = status.toLowerCase();
                                                    return (
                                                        lowered.includes("wrong") ||
                                                        lowered.includes("fail") ||
                                                        lowered.includes("error")
                                                    );
                                                });
                                                const hasExecutionError =
                                                    submissionResult?.status === "error" ||
                                                    submissionResult?.status === "compile_error" ||
                                                    submissionResult?.status === "wrong_answer";

                                                let titleMsg = "Ready to Run";
                                                let titleColor = "text-slate-600 dark:text-slate-400";

                                                if (isRunning || isSubmitting) {
                                                    titleMsg = "Running...";
                                                } else if (!hasTestRun) {
                                                    titleMsg = "Ready to Run";
                                                } else if (submissionResult?.status === "accepted") {
                                                    titleMsg = "Submitted";
                                                    titleColor = "text-green-500";
                                                } else if (hasExecutionError || someWrong || !allFinished) {
                                                    titleMsg = "Failed";
                                                    titleColor = "text-red-500";
                                                } else {
                                                    titleMsg = "Submitted";
                                                    titleColor = "text-green-500";
                                                }

                                                return (
                                                    <div className="mb-3 flex items-baseline gap-3">
                                                        <h2 className={`text-xl font-semibold ${titleColor}`}>
                                                            {titleMsg}
                                                        </h2>
                                                    </div>
                                                );
                                            })()}

                                            {testPanelTab === "result" &&
                                                submissionResult?.hiddenTotal !== undefined &&
                                                submissionResult.sampleTotal === undefined &&
                                                !isRunning &&
                                                !isSubmitting && (
                                                    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-[#3e3e3e] dark:bg-[#282828]">
                                                        <div className="flex items-center justify-between gap-4">
                                                            <span className="font-semibold text-slate-700 dark:text-slate-200">Hidden Tests</span>
                                                            {submissionResult.hiddenPassed === submissionResult.hiddenTotal && (
                                                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                                                    All test cases passed
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                            {/* Pills row */}
                                            <div className="mb-4 flex flex-wrap gap-2">
                                                {tests.map((test, index) => {
                                                    const res = results[getTestResultKey(test, index)] || { status: "Pending" };
                                                    let isFail = false;
                                                    let isPass = false;
                                                    if (testPanelTab === "result") {
                                                        isFail = res.status === "Wrong Answer" || res.status?.toLowerCase().includes("error");
                                                        isPass = res.status === "Accepted";
                                                    }

                                                    const isActive = activeTestCaseIndex === index;

                                                    return (
                                                        <button
                                                            key={getTestResultKey(test, index)}
                                                            onClick={() => setActiveTestCaseIndex(index)}
                                                            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                                                                isActive 
                                                                    ? "bg-slate-200 dark:bg-[#333] text-slate-900 dark:text-white shadow-sm" 
                                                                    : "bg-slate-50 dark:bg-[#282828] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#333]"
                                                            }`}
                                                        >
                                                            {testPanelTab === "result" && (
                                                                isFail ? (
                                                                    <span className="flex items-center justify-center h-4 w-4 rounded-sm bg-red-500 text-white"><span className="material-symbols-outlined text-[12px] font-bold">close</span></span>
                                                                ) : isPass ? (
                                                                    <span className="flex items-center justify-center h-4 w-4 rounded-sm bg-green-500 text-white"><span className="material-symbols-outlined text-[12px] font-bold">check</span></span>
                                                                ) : (
                                                                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                                                )
                                                            )}
                                                            Case {index + 1}
                                                            {test?.custom && (
                                                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">Custom</span>
                                                            )}
                                                            {testPanelTab === "result" && hasTestRun && !isRunning && !isSubmitting && !test?.custom && (
                                                                <span className={`text-[11px] font-semibold ${isFail ? "text-red-500" : isPass ? "text-green-600 dark:text-green-500" : "text-slate-400"}`}>
                                                                    {isFail ? "Failed" : isPass ? "Submitted" : ""}
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                                {isContestMode && (
                                                    <button
                                                        type="button"
                                                        onClick={addCustomTest}
                                                        title="Add custom test case"
                                                        className="flex items-center justify-center rounded-lg bg-slate-50 px-2.5 py-1.5 text-slate-500 transition-colors hover:bg-slate-100 dark:bg-[#282828] dark:text-slate-400 dark:hover:bg-[#333]"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px] leading-none">add</span>
                                                    </button>
                                                )}
                                            </div>

                                            {/* Details of active case */}
                                            {(() => {
                                                const activeTest = tests[activeTestCaseIndex];
                                                if (!activeTest) return null;
                                                const res = results[getTestResultKey(activeTest, activeTestCaseIndex)] || { status: "Pending" };
                                                const isFinished = res.status !== "Pending" && res.status !== "Running";

                                                const renderMultiline = (str: string, isError = false) => {
                                                    return (
                                                        <div className={`mt-1.5 p-4 rounded-lg ${isError ? "bg-red-50 dark:bg-[#2c1515]" : "bg-slate-50 dark:bg-[#282828]"}`}>
                                                            <code className={`font-mono text-sm whitespace-pre-wrap break-words block ${isError ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-300"}`}>
                                                                {str}
                                                            </code>
                                                        </div>
                                                    );
                                                };

                                                const parseObjToString = (str: string): string => {
                                                    try {
                                                        const parsed = JSON.parse(str);
                                                        if (typeof parsed === 'object' && parsed !== null) {
                                                            let out = '';
                                                            for (const key of Object.keys(parsed)) {
                                                                out += `${key} =\n${JSON.stringify(parsed[key])}\n`;
                                                            }
                                                            return out.trim();
                                                        }
                                                    } catch(e) {}
                                                    return str;
                                                }

                                                let inputFormatStr = formatTestData(activeTest.stdin);
                                                // apply custom formatting for variables if it's JSON
                                                if (inputFormatStr.startsWith('{')) {
                                                    inputFormatStr = parseObjToString(inputFormatStr);
                                                }

                                                const isCustom = !!activeTest?.custom;
                                                const renderHidden = () => (
                                                    <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-slate-50 p-4 dark:bg-[#282828]">
                                                        <span className="material-symbols-outlined text-[18px] text-slate-400">lock</span>
                                                        <span className="font-mono text-sm text-slate-500 dark:text-slate-400">Hidden</span>
                                                    </div>
                                                );

                                                return (
                                                    <div className="space-y-6">
                                                        <div>
                                                            <div className="mb-2 flex items-center justify-between">
                                                                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Input</span>
                                                                {isCustom && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeCustomTest(activeTestCaseIndex)}
                                                                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                                        Remove
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {isCustom ? (
                                                                <textarea
                                                                    value={String(activeTest.stdin ?? "")}
                                                                    onChange={(e) => updateCustomTestStdin(activeTestCaseIndex, e.target.value)}
                                                                    placeholder="Enter your custom input..."
                                                                    spellCheck={false}
                                                                    className="mt-1.5 min-h-[96px] w-full resize-y rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-700 outline-none ring-1 ring-transparent transition focus:ring-2 focus:ring-primary/40 dark:bg-[#282828] dark:text-slate-200"
                                                                />
                                                            ) : (
                                                                renderMultiline(inputFormatStr)
                                                            )}
                                                            {isCustom && (
                                                                <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">Use the same input format as the sample cases — just change the values.</p>
                                                            )}
                                                        </div>

                                                        {testPanelTab === "testcase" && (
                                                            <div>
                                                                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">{isCustom ? "Expected" : "Output"}</div>
                                                                {isCustom ? renderHidden() : renderMultiline(formatTestData(activeTest.expected_output))}
                                                            </div>
                                                        )}

                                                        {testPanelTab === "result" && isFinished && (
                                                            <>
                                                                <div>
                                                                    <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Output</div>
                                                                    {res.actual ? renderMultiline(formatTestData(res.actual)) : renderMultiline("(No output)")}
                                                                </div>

                                                                <div>
                                                                    <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Expected</div>
                                                                    {isCustom ? renderHidden() : renderMultiline(formatTestData(activeTest.expected_output))}
                                                                </div>
                                                                
                                                                {res.stderr && (
                                                                    <div>
                                                                        <div className="text-sm font-semibold text-red-500 mb-2">Stderr</div>
                                                                        {renderMultiline(res.stderr, true)}
                                                                    </div>
                                                                )}
                                                                
                                                                {res.compile_output && (
                                                                    <div>
                                                                        <div className="text-sm font-semibold text-red-500 mb-2">Compile Error</div>
                                                                        {renderMultiline(res.compile_output, true)}
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </>
                                    )}
                                </div>
                            </div>
                        </Panel>
                    </Group>
                </div>
                </Panel>
            </Group>
            
            {/* Add to Sheet Modal */}
            <AddToSheetModal
                isOpen={showAddToSheet}
                onClose={() => setShowAddToSheet(false)}
                questionId={questionId || ""}
                questionType="dsa"
                onSuccess={() => {
                }}
            />
        </div>
    );
}

export default function SolvePage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
            <SolvePageContent />
        </Suspense>
    );
}

function IntegrityWatermark({ text }: { text: string }) {
    const items = Array.from({ length: 54 });
    return (
        <div className="pointer-events-none fixed inset-0 z-[35] grid grid-cols-3 gap-x-12 gap-y-9 overflow-hidden p-8 opacity-[0.075] sm:grid-cols-4 lg:grid-cols-5">
            {items.map((_, index) => (
                <span
                    key={index}
                    className="select-none whitespace-pre-line text-center text-xs font-extrabold leading-5 text-slate-900 dark:text-white"
                    style={{ transform: "rotate(-18deg)" }}
                >
                    {text}
                </span>
            ))}
        </div>
    );
}
