"use client";

import { useState, useEffect, useRef, Suspense, Fragment, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import Editor, { loader } from "@monaco-editor/react";

// Pre-configure Monaco to use a pinned CDN version matching installed monaco-editor
// This ensures all language tokenizers (including Python) are loaded correctly
loader.config({
    paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs' },
});
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { LANGUAGE_MAP } from "@interviewforge/shared";
import { Group, Panel, Separator } from "react-resizable-panels";
import { PageHeader } from "@/components/page-header";
import { ModalDialog } from "@/components/modal-dialog";
import { ReportQuestionModal } from "@/components/report-question-modal";
import { AddToSheetModal } from "@/components/add-to-sheet-modal";
import { updateLastQuestionDate } from "@/lib/notifications";
import { readPublicQuestionDraft, solveDraftPath } from "@/lib/public-question-drafts";
import {
    UpgradeModal,
    // Upgrade paywall disabled for the practice IDE — these helpers are only used
    // by the commented-out "Upgrade to submit" modal triggers in submitCode.
    // copyFromUpgradeError,
    // shouldShowUpgradeForError,
} from "@/components/upgrade-modal";
import { useBilling } from "@/hooks/use-billing";
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
    constraints: string;
    examples: Array<{
        input: string;
        output: string;
        explanation?: string;
    }>;
    hints?: string[];
    topics?: string[];
    companyTags?: string[];
    starter_code: Record<string, string>;
    sample_tests: any[];
    solution?: Solution;
}

type RawSubmission = Record<string, unknown>;

interface SubmissionRecord extends RawSubmission {
    id: string;
    status: string;
    language: string;
    code: string;
    createdAt: string;
    submittedAt?: string;
    runtimeMs?: number | null;
    memoryKb?: number | null;
    source?: "practice" | "contest";
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

const CONTEST_API = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";

function normalizeSubmissionStatus(status: unknown): string {
    const normalized = String(status || "").trim();
    if (!normalized) return "error";

    switch (normalized.toUpperCase()) {
        case "ACCEPTED":
            return "accepted";
        case "WRONG_ANSWER":
            return "wrong_answer";
        case "COMPILATION_ERROR":
            return "compile_error";
        case "TIME_LIMIT_EXCEEDED":
            return "time_limit_exceeded";
        case "MEMORY_LIMIT_EXCEEDED":
            return "memory_limit_exceeded";
        case "RUNTIME_ERROR":
            return "runtime_error";
        case "QUEUED":
        case "PROCESSING":
        case "JUDGING_DEFERRED":
            return normalized.toLowerCase();
        default:
            return normalized.toLowerCase();
    }
}

function getSubmissionStatusLabel(status: unknown): string {
    switch (normalizeSubmissionStatus(status)) {
        case "accepted":
            return "Accepted";
        case "wrong_answer":
            return "Wrong Answer";
        case "compile_error":
            return "Compile Error";
        case "time_limit_exceeded":
            return "Time Limit Exceeded";
        case "memory_limit_exceeded":
            return "Memory Limit Exceeded";
        case "runtime_error":
            return "Runtime Error";
        case "queued":
            return "Queued";
        case "processing":
            return "Processing";
        case "judging_deferred":
            return "Judging Deferred";
        default:
            return "Error";
    }
}

function toSubmissionString(value: unknown, fallback = ""): string {
    return typeof value === "string" && value.trim() ? value : fallback;
}

function toSubmissionNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizePracticeSubmission(sub: RawSubmission): SubmissionRecord {
    const createdAt = toSubmissionString(sub.createdAt, toSubmissionString(sub.submittedAt, new Date().toISOString()));
    return {
        ...sub,
        id: toSubmissionString(sub.id, `practice-${createdAt}`),
        status: normalizeSubmissionStatus(sub.status),
        language: toSubmissionString(sub.language, "unknown"),
        code: toSubmissionString(sub.code),
        createdAt,
        runtimeMs: toSubmissionNumber(sub.runtimeMs),
        memoryKb: toSubmissionNumber(sub.memoryKb),
        source: "practice",
    };
}

function normalizeContestSubmission(sub: RawSubmission): SubmissionRecord {
    const createdAt = toSubmissionString(sub.submittedAt, toSubmissionString(sub.createdAt, new Date().toISOString()));
    const rawId = toSubmissionString(sub.id, createdAt);
    return {
        ...sub,
        id: `contest-${rawId}`,
        status: normalizeSubmissionStatus(sub.status),
        language: toSubmissionString(sub.language, "unknown"),
        code: toSubmissionString(sub.code),
        createdAt,
        submittedAt: createdAt,
        runtimeMs: toSubmissionNumber(sub.executionTime),
        memoryKb: toSubmissionNumber(sub.memoryUsed),
        source: "contest",
    };
}

function getRichConstraintItems(value: unknown): string[] {
    if (!value) return [];

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return [];
        const hasRichBlock = /:::\w+|!\[[^\]]*]\(|\$\$|\\\[|\\\]|\n\s*\n/m.test(trimmed);
        return hasRichBlock ? [trimmed] : trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }

    if (Array.isArray(value)) {
        return value.flatMap((item) => {
            if (typeof item === "string") {
                const trimmed = item.trim();
                return trimmed ? [trimmed] : [];
            }
            return getRichConstraintItems(item);
        });
    }

    if (typeof value === "object") {
        return Object.entries(value as Record<string, unknown>)
            .map(([key, item]) => {
                if (item === null || item === undefined || item === "") return "";
                return `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`;
            })
            .filter(Boolean);
    }

    return [String(value).trim()].filter(Boolean);
}

function getStarterCodeForLanguage(starterCode: Record<string, string> | undefined, language: string): string | undefined {
    if (!starterCode) return undefined;
    const candidates = language === "cpp" ? ["cpp", "c++"] : [language];
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

function getDefaultSolutionCodeLanguage(languages: string[]): string {
    return languages.find((lang) => ["cpp", "c++"].includes(lang.toLowerCase())) || languages[0] || "";
}

function getTestResultKey(test: any, index: number): string {
    if (test?.id !== undefined && test?.id !== null && String(test.id).trim() !== "") {
        return String(test.id);
    }
    return `test-${index}`;
}

function SolvePageContent() {
    const searchParams = useSearchParams();
    const questionId = searchParams.get("id");
    const sheetId = searchParams.get("sheetId");
    const contestId = searchParams.get("contestId");
    const source = searchParams.get("source");
    const from = searchParams.get("from");
    const sourceBackUrl = from === "/admin/contest-questions"
        ? "/admin/contest-questions"
        : contestId && from === `/contests/${contestId}/dsa/practice`
            ? from
            : null;
    const mode = searchParams.get("mode"); // 'contest' mode hides solution/topics tabs
    const { resolvedTheme } = useTheme();
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
    const [pastSubmissions, setPastSubmissions] = useState<SubmissionRecord[]>([]);
    const [expandedSubmissionIndex, setExpandedSubmissionIndex] = useState<number | null>(null);
    const [isSolved, setIsSolved] = useState(false);
    const [showAddToSheet, setShowAddToSheet] = useState(false);
    const [activeTab, setActiveTab] = useState<"description" | "solution" | "submissions" | "result">("description");
    const [isTopicsExpanded, setIsTopicsExpanded] = useState(false);
    const [isHintsExpanded, setIsHintsExpanded] = useState(false);
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
    const lastLoadedFingerprintRef = useRef<string | null>(null);


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

    const sseConnections = useRef<Record<string, EventSource>>({});
    const mainEditorRef = useRef<any>(null);
    const latestEditorStateRef = useRef({ code, language });

    useEffect(() => {
        latestEditorStateRef.current = { code, language };
    }, [code, language]);

    const loadEditorSource = useCallback((nextLanguage: string, nextCode: string) => {
        latestEditorStateRef.current = { code: nextCode, language: nextLanguage };
        setLanguage(nextLanguage);
        setCode(nextCode);
        lastLoadedFingerprintRef.current = `${questionId || ""}-${nextLanguage}`;

        if (!mainEditorRef.current) return;

        if (mainEditorRef.current.getValue() !== nextCode) {
            mainEditorRef.current.setValue(nextCode);
        }

        const model = mainEditorRef.current.getModel();
        const monacoLanguage = LANGUAGE_MAP[nextLanguage as keyof typeof LANGUAGE_MAP]?.monacoId || nextLanguage;
        if (model) {
            import('monaco-editor').then((monaco) => {
                monaco.editor.setModelLanguage(model, monacoLanguage);
            });
        }
    }, [questionId]);

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

    useEffect(() => {
        const fingerprint = `${questionId}-${language}`;
        if (mainEditorRef.current && fingerprint !== lastLoadedFingerprintRef.current) {
            lastLoadedFingerprintRef.current = fingerprint;
            const model = mainEditorRef.current.getModel();
            if (model && model.getValue() !== code) {
                mainEditorRef.current.setValue(code);
            }
        }
    }, [code, language, questionId]);

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

    const fetchSubmissions = async () => {
        if (!questionId) return;
        try {
            const supabase = createSupabaseBrowserClient();
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) return;

            const authHeaders = { Authorization: `Bearer ${token}` };
            const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            let practiceSubmissions: SubmissionRecord[] = [];
            let contestSubmissions: SubmissionRecord[] = [];

            const practiceRes = await fetch(
                `${apiBase}/ide/submissions/${questionId}`,
                { headers: authHeaders, cache: "no-store" }
            );
            if (practiceRes.ok) {
                const data = await practiceRes.json() as { success?: boolean; data?: unknown };
                if (data.success && Array.isArray(data.data)) {
                    practiceSubmissions = data.data.map((sub) => normalizePracticeSubmission(sub as RawSubmission));
                }
            }

            if (contestId) {
                const contestUrl = new URL(`${CONTEST_API}/contests/${contestId}/submissions`);
                contestUrl.searchParams.set("questionId", questionId);
                const contestRes = await fetch(contestUrl.toString(), {
                    headers: authHeaders,
                    cache: "no-store",
                });
                if (contestRes.ok) {
                    const data = await contestRes.json() as { success?: boolean; submissions?: unknown };
                    if (data.success && Array.isArray(data.submissions)) {
                        contestSubmissions = data.submissions.map((sub) => normalizeContestSubmission(sub as RawSubmission));
                    }
                }
            }

            const mergedSubmissions = [...contestSubmissions, ...practiceSubmissions].sort((a, b) => {
                const bTime = new Date(b.createdAt || b.submittedAt || 0).getTime();
                const aTime = new Date(a.createdAt || a.submittedAt || 0).getTime();
                return bTime - aTime;
            });

            setPastSubmissions(mergedSubmissions);
            setIsSolved(mergedSubmissions.some((s) => normalizeSubmissionStatus(s.status) === "accepted"));
        } catch (err) {
            console.error("Failed to fetch submissions", err);
        }
    };

    useEffect(() => {
        if (!questionId) {
            setError("No question ID provided");
            setLoading(false);
            return;
        }

        const fetchQuestion = async () => {
            try {
                const supabase = createSupabaseBrowserClient();
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData.session?.access_token;

                const questionUrl = new URL(
                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/question/${questionId}`
                );
                if (contestId) {
                    questionUrl.searchParams.set("contestId", contestId);
                }
                if (source === "contest-bank") {
                    questionUrl.searchParams.set("source", "contest-bank");
                }
                const shouldBypassQuestionCache = source === "contest-bank" || Boolean(contestId);
                if (shouldBypassQuestionCache) {
                    questionUrl.searchParams.set("_ts", Date.now().toString());
                }

                const res = await fetch(questionUrl.toString(), {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    cache: shouldBypassQuestionCache ? "no-store" : "default",
                });

                if (!res.ok) throw new Error("Failed to fetch question");
                const data = await res.json();
                console.log("Question data received:", data);
                console.log("Examples:", data.examples);
                console.log("Hints:", data.hints);
                console.log("Sample tests:", data.sample_tests);
                setQuestion(data);
                
                // Set initial code from starter code - prioritize C++ and support legacy c++ key.
                const starters = (data.starter_code || {}) as Record<string, string>;
                const savedDraft = readPublicQuestionDraft(solveDraftPath("dsa", questionId));
                const draftLanguage = savedDraft?.language && getStarterCodeForLanguage(starters, savedDraft.language)
                    ? savedDraft.language
                    : null;
                const resolvedLanguage = draftLanguage || getDefaultLanguage(starters, "cpp");
                const starterCode =
                    getStarterCodeForLanguage(starters, resolvedLanguage) ||
                    getStarterCodeForLanguage(starters, "javascript") ||
                    "// No starter code found";
                loadEditorSource(resolvedLanguage, savedDraft?.content || starterCode);

                // Parse and set tests (API returns sample_tests)
                const parsedTests = data.sample_tests || [];
                console.log("Parsed tests:", parsedTests);
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
                    } catch (sheetErr) {
                        console.error("Failed to load sheet context:", sheetErr);
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

        return () => {
            // Cleanup SSE connections
            Object.values(sseConnections.current).forEach((src) => src.close());
        };
    }, [contestId, questionId, source]);

    const runAllTests = async () => {
        if (!question || tests.length === 0) return;

        setHasTestRun(true);
        setSubmissionResult(null);
        setTestPanelTab("result");
        setIsRunning(true);

        // Set all to running
        setResults((prev) => {
            const next = { ...prev };
            tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Running" }));
            return next;
        });

        try {
            const supabase = createSupabaseBrowserClient();
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            const currentCode = getCurrentEditorCode();

            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/run`,
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
                        language_id: JUDGE0_LANGUAGE_IDS[language?.toLowerCase?.() || language],
                        ...(contestId ? { contestId } : {}),
                        ...(source === "contest-bank" ? { source: "contest-bank" } : {}),
                        // User-added custom cases run for output only (never scored).
                        customTests: tests.filter((t) => t?.custom).map((t) => ({ stdin: String(t?.stdin ?? "") })),
                    }),
                }
            );

            const data = await res.json();
            console.log("API Response:", data);

            // Handle compilation errors
            if (!data.success && data.compileOutput) {
                setIsRunning(false);
                setSubmissionResult({
                    status: "compile_error",
                    message: "Compilation Error",
                    errorDetails: data.compileOutput,
                });
                setActiveTab("result");
                
                // Reset to pending
                setResults((prev) => {
                    const next = { ...prev };
                    tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Pending" }));
                    return next;
                });
                return;
            }

            if (data.error) throw new Error(data.error);

            // Handle results - API returns { success, sample: { tests: [...] } }
            if (data.success && data.sample?.tests) {
                console.log("Processing sample tests:", data.sample.tests);
                // Convert API format to frontend format
                const resultsMap: Record<string, any> = {};
                data.sample.tests.forEach((test: any, idx: number) => {
                    const testId = getTestResultKey(tests[idx], idx);
                    const isCustom = !!tests[idx]?.custom;
                    resultsMap[testId] = {
                        status: isCustom ? "Finished" : (test.passed ? "Accepted" : "Wrong Answer"),
                        input: test.input,
                        expected: test.expectedOutput,
                        actual: test.actualOutput,
                        passed: isCustom ? undefined : test.passed,
                        error: test.error,
                        runtime: test.time,
                        memory: test.memory,
                    };
                });
                console.log("Results map:", resultsMap);
                setResults(resultsMap);
                setIsRunning(false);
            } else if (data.results) {
                // Fallback for old format
                console.log("Using old format results");
                setResults(data.results);
                setIsRunning(false);
            } else {
                // No valid results format found
                console.error("Unexpected response format:", data);
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

            // Reset to pending
            setResults((prev) => {
                const next = { ...prev };
                tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Pending" }));
                return next;
            });
        }
    };

    const submitCode = async () => {
        if (!question) return;

        // NEW: Direct check for free plan instead of using LockedFeature wrapper
        // Paywall disabled for the DSA practice IDE so candidates can submit while
        // practicing (including post-contest practice) without a paid plan.
        // if (billingSnapshot?.plan === "FREE") {
        //     setUpgradeOpen(true);
        //     setUpgradeCopy("Upgrade to Plus or higher to run your code against hidden test cases and submit your solutions officially.");
        //     return;
        // }

        setHasTestRun(true);
        setTestPanelTab("result");
        setIsSubmitting(true);

        // Set all to running — but never the user's custom cases: Submit only
        // runs the real (hidden) judge tests.
        setResults((prev) => {
            const next = { ...prev };
            tests.forEach((t, idx) => {
                if (t?.custom) return;
                next[getTestResultKey(t, idx)] = { status: "Running" };
            });
            return next;
        });

        try {
            const supabase = createSupabaseBrowserClient();
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/submit`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        questionId: question.id,
                        code: getCurrentEditorCode(),
                        language,
                        language_id: JUDGE0_LANGUAGE_IDS[language?.toLowerCase?.() || language],
                        ...(contestId ? { contestId } : {}),
                        ...(source === "contest-bank" ? { source: "contest-bank" } : {}),
                    }),
                }
            );

            const data = await res.json();
            console.log("Submit API Response:", data);
            console.log("Sample tests:", data.sample?.tests);

            // Upgrade paywall disabled for the practice IDE — do not surface the
            // "Upgrade to submit" modal when the server flags a paid-plan error.
            // if (!res.ok && shouldShowUpgradeForError(data)) {
            //     setIsSubmitting(false);
            //     setUpgradeCopy(copyFromUpgradeError(data));
            //     setUpgradeOpen(true);
            //     setResults((prev) => {
            //         const next = { ...prev };
            //         tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Pending" }));
            //         return next;
            //     });
            //     return;
            // }

            // Handle compilation errors
            if (!data.success && data.compileOutput) {
                setIsSubmitting(false);
                setSubmissionResult({
                    status: "compile_error",
                    message: "Compilation Error",
                    errorDetails: data.compileOutput,
                });
                setActiveTab("result");
                
                // Reset to pending
                setResults((prev) => {
                    const next = { ...prev };
                    tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Pending" }));
                    return next;
                });
                return;
            }

            if (data.error) {
                // Upgrade paywall disabled for the practice IDE — skip the modal.
                // if (shouldShowUpgradeForError(data)) {
                //     setIsSubmitting(false);
                //     setUpgradeCopy(copyFromUpgradeError(data));
                //     setUpgradeOpen(true);
                //     setResults((prev) => {
                //         const next = { ...prev };
                //         tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Pending" }));
                //         return next;
                //     });
                //     return;
                // }
                throw new Error(data.message || data.error);
            }

            // Handle results for both sample and hidden tests
            if (data.success) {
                const resultsMap: Record<string, any> = {};
                
                // Process sample tests
                if (data.sample?.tests) {
                    data.sample.tests.forEach((test: any, idx: number) => {
                        const testId = getTestResultKey(tests[idx], idx);
                        resultsMap[testId] = {
                            status: test.passed ? "Accepted" : "Wrong Answer",
                            input: test.input,
                            expected: test.expectedOutput,
                            actual: test.actualOutput,
                            passed: test.passed,
                            error: test.error,
                            runtime: test.time,
                            memory: test.memory,
                            stdout: test.actualOutput,
                            stderr: test.stderr,
                            compile_output: test.compileOutput,
                        };
                    });
                }

                const samplePassed = data.sample?.summary?.passed || 0;
                const sampleTotal = data.sample?.summary?.total || 0;
                const hiddenPassed = data.hidden?.summary?.passed || 0;
                const hiddenTotal = data.hidden?.summary?.total || 0;

                // Prefer failed sample details; if samples passed but hidden failed,
                // show the first failed hidden test details from backend.
                const failedSampleTest = data.sample?.tests?.find((t: any) => !t.passed);
                const failedHiddenTest = data.hidden?.firstFailed;

                const failedTest = failedSampleTest
                    ? {
                        source: "sample" as const,
                        status: failedSampleTest.status,
                        input: failedSampleTest.input || "",
                        expected: failedSampleTest.expectedOutput || "",
                        actual: failedSampleTest.actualOutput || "",
                        stderr: failedSampleTest.stderr || "",
                        compileOutput: failedSampleTest.compileOutput || "",
                    }
                    : failedHiddenTest
                        ? {
                            source: "hidden" as const,
                            status: failedHiddenTest.status,
                            input: failedHiddenTest.input || "",
                            expected: failedHiddenTest.expectedOutput || "",
                            actual: failedHiddenTest.actualOutput || "",
                            stderr: failedHiddenTest.stderr || "",
                            compileOutput: failedHiddenTest.compileOutput || "",
                        }
                        : undefined;

                // Determine overall status
                const allPassed = (samplePassed === sampleTotal) && 
                                 (!data.hidden?.summary || hiddenPassed === hiddenTotal);

                // Find first failed hidden test if available
                const hiddenFailedTest = data.hidden?.firstFailedTest;

                // Build submission result
                const submissionData = {
                    status: allPassed ? "accepted" as const : "wrong_answer" as const,
                    message: allPassed
                        ? `All test cases passed!`
                        : `Failed ${sampleTotal - samplePassed + (hiddenTotal - hiddenPassed)} test case(s)`,
                    samplePassed,
                    sampleTotal,
                    ...(data.hidden?.summary && {
                        hiddenPassed,
                        hiddenTotal,
                    }),
                    ...(failedTest ? { failedTest } : {}),
                };

                console.log("Submission data:", submissionData);
                console.log("Failed test details:", failedTest);
                console.log("Hidden failed test details:", hiddenFailedTest);

                setSubmissionResult(submissionData);
                setResults(resultsMap);
                setIsSubmitting(false);

                // Track question completion for reminder system
                if (allPassed) {
                    updateLastQuestionDate();
                    
                    // Auto-mark as completed in sheet if coming from a sheet
                    if (sheetId && questionId) {
                        try {
                            const supabase = createSupabaseBrowserClient();
                            const { data: sessionData } = await supabase.auth.getSession();
                            const token = sessionData.session?.access_token;
                            
                            if (token) {
                                // Try custom sheet first, then AI-generated sheet
                                try {
                                    await fetch(
                                        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/custom-sheets/${encodeURIComponent(sheetId)}/progress`,
                                        {
                                            method: "PATCH",
                                            headers: {
                                                "Content-Type": "application/json",
                                                Authorization: `Bearer ${token}`,
                                            },
                                            body: JSON.stringify({
                                                questionId: `dsa-${questionId}`,
                                                status: "completed",
                                            }),
                                        }
                                    );
                                } catch (customErr) {
                                    // If custom sheet fails, try AI-generated sheet
                                    await fetch(
                                        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/users/me/sheets/${encodeURIComponent(sheetId)}/progress`,
                                        {
                                            method: "PATCH",
                                            headers: {
                                                "Content-Type": "application/json",
                                                Authorization: `Bearer ${token}`,
                                            },
                                            body: JSON.stringify({
                                                questionId: `dsa-${questionId}`,
                                                status: "completed",
                                            }),
                                        }
                                    );
                                }
                            }
                        } catch (sheetErr) {
                            console.error("Failed to update sheet progress:", sheetErr);
                            // Don't block the user experience if sheet update fails
                        }
                    }
                }

                // Switch to result tab to show results
                setActiveTab("result");
                fetchSubmissions();
            } else {
                throw new Error("Invalid response format from server");
            }
        } catch (err: any) {
            setIsSubmitting(false);
            setSubmissionResult({
                status: "error",
                message: "Failed to submit code",
                errorDetails: err.message,
            });
            setActiveTab("result");

            // Reset to pending
            setResults((prev) => {
                const next = { ...prev };
                tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Pending" }));
                return next;
            });
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
            <div className="flex items-center justify-center h-screen bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="text-slate-600 dark:text-slate-400">Loading question...</div>
            </div>
        );
    }

    if (error || !question) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="text-red-600 dark:text-red-400">
                    {error || "Question not found"}
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-[#FAFBFC] dark:bg-lc-bg">
            {/* Keep wide markdown tables and display-math inside the panel instead of
                overflowing it — mirrors the contest solve page so both IDEs render
                GFM tables + LaTeX identically. */}
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
            <ModalDialog
                isOpen={modalState.isOpen}
                onClose={() => setModalState({ ...modalState, isOpen: false })}
                title={modalState.title}
                message={modalState.message}
                type={modalState.type}
                details={modalState.details}
            />
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
            
            <Group orientation="horizontal">
                {/* Left Panel - Problem Description */}
                <Panel defaultSize={40} minSize={25}>
                    <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                <div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <PageHeader 
                                title={question.title} 
                                showBack={true} 
                                backUrl={
                                    sourceBackUrl ||
                                    (contestId
                                        ? `/contests/${contestId}` 
                                        : sheetId 
                                            ? `/sheets/${sheetId}` 
                                            : "/questions/dsa")
                                } 
                            />
                            {isSolved && (
                                <div className="ml-3 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 mt-1 shadow-sm border border-emerald-200 dark:border-emerald-800/60">
                                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                    Solved
                                </div>
                            )}
                        </div>
                        {sheetId && nextQuestionUrl && (
                            <a 
                                href={nextQuestionUrl}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-900/30 dark:text-teal-400 dark:hover:bg-teal-800/50 rounded text-[13px] font-semibold transition-colors whitespace-nowrap"
                            >
                                Next 
                                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                            </a>
                        )}
                    </div>
                           
                            {/* <div className="mt-2 flex items-right ">
                                <span
                                    className={`text-sm font-medium ${
                                        question.difficulty === "Easy"
                                            ? "text-emerald-500"
                                            : question.difficulty === "Medium"
                                            ? "text-amber-500"
                                            : "text-red-500"
                                    }`}
                                >
                                    {question.difficulty}
                                </span>
                            </div> */}
                        </div>
                <div className="flex items-center bg-slate-100 dark:bg-[#333333]">
                    <button
                        onClick={() => setActiveTab("description")}
                        className={`px-4 py-2 text-sm font-medium ${
                            activeTab === "description"
                                ? "text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                    >
                        Description
                    </button>
                    {/* Hide Solution tab in contest mode */}
                    {mode !== 'contest' && (
                        <button
                            onClick={() => setActiveTab("solution")}
                            className={`px-4 py-2 text-sm font-medium ${
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
                        className={`px-4 py-2 text-sm font-medium ${
                            activeTab === "submissions"
                                ? "text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400"
                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                    >
                        Submissions
                    </button>
                    {/* Result Tab - Only shown when there's a submission result */}
                    {submissionResult && (
                        <div className="relative flex items-center group">
                            <button
                                onClick={() => setActiveTab("result")}
                                className={`px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors ${
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

                <div className="flex-1 overflow-auto p-6">
                    {/* Difficulty Badge and Add to Sheet Button (Always Visible) */}
                    <div className="mb-4 flex items-center justify-between">
                        <span
                            className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                                question.difficulty === "Easy"
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                    : question.difficulty === "Medium"
                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }`}
                        >
                            {question.difficulty}
                        </span>
                        
                        {/* Add to Custom Sheet Button */}
                        <button
                            onClick={() => setShowAddToSheet(true)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 dark:bg-[#333333] dark:hover:bg-[#3e3e3e] dark:text-slate-400 dark:hover:text-slate-200 transition-all"
                            title="Add to custom sheet"
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                playlist_add
                            </span>
                            <span className="text-sm font-medium">Add to Sheet</span>
                        </button>
                    </div>

                    {activeTab === "description" ? (
                        <div className="contest-question-content prose prose-sm dark:prose-invert w-full max-w-full min-w-0 break-words [&_*]:max-w-full [&_*]:min-w-0 [&_li]:whitespace-normal [&_p]:whitespace-normal [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_code]:whitespace-pre-wrap">
                            {/* Description */}
                            <RichQuestionContent
                                content={question.statement}
                                compact
                                className="contest-question-statement min-w-0 break-words text-slate-700 dark:text-slate-100 leading-relaxed"
                            />
                            
                            {/* Examples */}
                            {question.examples && question.examples.length > 0 && (
                                <div className="mt-8">
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Examples</h3>
                                    {question.examples.map((ex: any, idx: number) => (
                                        <div key={idx} className="mb-6 p-4 bg-slate-50 dark:bg-[#1c160d] rounded-lg">
                                            <div className="font-semibold text-slate-900 dark:text-white mb-3">
                                                Example {idx + 1}:
                                            </div>
                                            {ex.input && (
                                                <div className="mb-3">
                                                    <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                                        Input:
                                                    </div>
                                                    <div className="p-3 bg-white dark:bg-[#282828] rounded">
                                                        <QuestionExampleValue value={ex.input} />
                                                    </div>
                                                </div>
                                            )}
                                            {ex.output && (
                                                <div className="mb-3">
                                                    <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                                                        Output:
                                                    </div>
                                                    <div className="p-3 bg-white dark:bg-[#282828] rounded">
                                                        <QuestionExampleValue value={ex.output} />
                                                    </div>
                                                </div>
                                            )}
                                            {ex.explanation && (
                                                <div>
                                                    <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
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
                            {getRichConstraintItems(question.constraints).length > 0 && (
                                <div className="mt-8">
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Constraints</h3>
                                    <div className="max-w-full min-w-0 overflow-hidden p-4 bg-slate-50 dark:bg-[#1c160d] rounded-lg">
                                        <div className="max-w-full min-w-0 space-y-2 text-sm text-slate-700 dark:text-slate-100">
                                            {getRichConstraintItems(question.constraints).map((constraint: string, idx: number) => (
                                                <div key={idx} className="max-w-full min-w-0 rounded-md bg-white/70 px-3 py-2 leading-relaxed break-words [overflow-wrap:anywhere] dark:bg-[#282828]">
                                                    <RichQuestionContent content={constraint} compact />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Hints */}
                            {question.hints && question.hints.length > 0 && (
                                <div className="mt-8">
                                    <button
                                        type="button"
                                        onClick={() => setIsHintsExpanded((prev) => !prev)}
                                        className="w-full flex items-center justify-between text-left"
                                    >
                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Hints</h3>
                                        <span className="material-symbols-outlined text-[20px] text-slate-600 dark:text-slate-300">
                                            {isHintsExpanded ? "expand_less" : "expand_more"}
                                        </span>
                                    </button>
                                    {isHintsExpanded && (
                                        <div className="space-y-3 mt-3">
                                            {question.hints.map((hint: string, idx: number) => (
                                                <div key={idx} className="p-4 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800/30 rounded-lg">
                                                    <div className="flex items-start gap-3">
                                                        <span className="material-symbols-outlined text-yellow-600 dark:text-yellow-500 text-[20px] mt-0.5">
                                                            lightbulb
                                                        </span>
                                                        <div className="flex-1">
                                                            <div className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-1">
                                                                Hint {idx + 1}
                                                            </div>
                                                            <div className="min-w-0 text-sm text-slate-700 dark:text-slate-300">
                                                                <RichQuestionContent content={hint} compact />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Topics - Hidden in contest mode */}
                            {mode !== 'contest' && question.topics && question.topics.length > 0 && (
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
                                                                    Explanation
                                                                </h4>
                                                                <RichQuestionContent content={explainationText} compact />
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
                                                                const selectedBruteLang = selectedLanguage.bruteForce || getDefaultSolutionCodeLanguage(bruteCodeLanguages);
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
                                                                    Explanation
                                                                </h4>
                                                                <RichQuestionContent content={explainationText} compact />
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
                                                                const selectedOptimizedLang = selectedLanguage.optimized || getDefaultSolutionCodeLanguage(optimizedCodeLanguages);
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
                        <div>
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
                                            {submissionResult.sampleTotal !== undefined && (
                                                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#3e3e3e] dark:bg-[#282828]">
                                                    <div className="mb-4 flex items-center justify-between">
                                                        <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Test Results</h3>
                                                    </div>
                                                    <div className="space-y-3">
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
                                                                setCode(code);
                                                                lastLoadedFingerprintRef.current = null; // Force reset
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
                                                        Your solution passed all sample test cases but failed some hidden test cases. 
                                                        Review your code for edge cases and constraints.
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
                                    {submissionResult.status === "error" && submissionResult.errorDetails && (
                                        <>
                                            <div className="p-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Runtime Error</h2>
                                                </div>
                                                <p className="text-slate-700 dark:text-slate-300 text-lg">
                                                    {submissionResult.message}
                                                </p>
                                            </div>

                                            <div className="bg-white dark:bg-[#282828] rounded-lg border border-red-200 dark:border-red-800 p-4">
                                                <h3 className="font-semibold text-red-600 dark:text-red-400 mb-3">Error Details:</h3>
                                                <pre className="p-4 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-900 dark:text-red-100 overflow-x-auto border border-red-200 dark:border-red-800 whitespace-pre-wrap">
{submissionResult.errorDetails}
                                                </pre>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div>
                            {/* Submissions Tab - Only Submission History */}
                            {pastSubmissions.length > 0 ? (
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Submission History</h3>
                                    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-[#3e3e3e]">
                                        <table className="min-w-full divide-y divide-slate-200 dark:divide-[#3e3e3e]">
                                            <thead className="bg-slate-50 dark:bg-[#1c160d]">
                                                <tr>
                                                    <th className="px-4 py-3 text-left w-1/3">
                                                       <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</span>
                                                    </th>
                                                    <th className="px-4 py-3 text-center w-1/6">
                                                       <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Language</span>
                                                    </th>
                                                    <th className="px-4 py-3 text-center w-1/6">
                                                       <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Runtime</span>
                                                    </th>
                                                    <th className="px-4 py-3 text-center w-1/6">
                                                       <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Memory</span>
                                                    </th>
                                                    <th className="px-4 py-3 text-right w-1/6">
                                                       <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Code</span>
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-200 dark:divide-[#3e3e3e] bg-white dark:bg-[#282828] cursor-default">
                                                {pastSubmissions.map((sub, i) => (
                                                    <Fragment key={i}>
                                                        <tr 
                                                            onClick={() => setExpandedSubmissionIndex(expandedSubmissionIndex === i ? null : i)}
                                                            className={`hover:bg-slate-50 dark:hover:bg-[#343434] transition-colors cursor-pointer ${expandedSubmissionIndex === i ? 'bg-slate-50 dark:bg-[#1f1a14]' : ''}`}
                                                        >
                                                            <td className="px-4 py-3 text-sm">
                                                                <div className="flex flex-col">
                                                                    <span className={`font-semibold ${normalizeSubmissionStatus(sub.status) === 'accepted' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                        {getSubmissionStatusLabel(sub.status)}
                                                                    </span>
                                                                    <span className="text-[11px] text-slate-500 font-medium tracking-tight whitespace-nowrap mt-0.5">{new Date(sub.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className="text-slate-600 dark:text-slate-300 font-mono text-[11px] px-2 py-1 bg-slate-100 dark:bg-[#1c160d] rounded-full border border-slate-200 dark:border-slate-800 tracking-wider font-semibold">{sub.language}</span>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className="text-slate-600 dark:text-slate-300 text-[13px] font-medium flex items-center justify-center gap-1">
                                                                    <span className="material-symbols-outlined text-[14px] text-slate-400">timer</span>
                                                                    {sub.runtimeMs ? `${sub.runtimeMs} ms` : 'N/A'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className="text-slate-600 dark:text-slate-300 text-[13px] font-medium flex items-center justify-center gap-1">
                                                                    <span className="material-symbols-outlined text-[14px] text-slate-400">memory</span>
                                                                    {sub.memoryKb ? `${(sub.memoryKb / 1024).toFixed(1)} MB` : 'N/A'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-right">
                                                                <button 
                                                                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors ml-auto flex items-center"
                                                                >
                                                                    <span className="material-symbols-outlined text-[20px]">
                                                                        {expandedSubmissionIndex === i ? 'expand_less' : 'expand_more'}
                                                                    </span>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                        {expandedSubmissionIndex === i && (
                                                            <tr>
                                                                <td colSpan={5} className="p-0 border-t-0">
                                                                    <div className="p-4 bg-slate-50 dark:bg-[#1a1510] border-b border-slate-200 dark:border-[#3e3e3e]">
                                                                        <div className="flex justify-between items-center mb-3">
                                                                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Submitted Code</span>
                                                                            <button 
                                                                                onClick={(e) => { 
                                                                                    e.stopPropagation(); 
                                                                                    loadEditorSource(sub.language, sub.code);
                                                                                }}
                                                                                className="text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 font-medium px-3 py-1 border border-teal-200 dark:border-teal-800 rounded bg-white dark:bg-[#282828] flex items-center gap-1.5 transition-colors text-xs shadow-sm hover:shadow"
                                                                            >
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
                <Separator className="relative w-1.5 bg-slate-200 dark:bg-[#3e3e3e] hover:bg-teal-500 dark:hover:bg-teal-500 transition-colors group cursor-col-resize flex items-center justify-center">
                    <div className="w-0.5 h-6 bg-slate-400 dark:bg-slate-500 rounded-full group-hover:bg-teal-400 transition-colors" />
                </Separator>

                {/* Right Panel - Code Editor and Test Results */}
                <Panel defaultSize={60} minSize={30}>
                    <Group orientation="vertical">
                        {/* Code Editor Panel */}
                        <Panel defaultSize={50} minSize={20}>
                            <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                <div className="p-4 flex items-center justify-between bg-slate-50 dark:bg-[#242424]">
                    <div ref={languageMenuRef} className="relative">
                        <button
                            type="button"
                            onClick={() => setIsLanguageMenuOpen((prev) => !prev)}
                            className="flex items-center h-8 gap-2 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-[#333333] dark:hover:bg-[#3e3e3e] px-4 text-sm font-medium text-slate-700 dark:text-slate-300 transition-all"
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
                                                loadEditorSource(lang, getStarterCodeForLanguage(question.starter_code, lang) || "");
                                                setIsLanguageMenuOpen(false);
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
                            className="px-4 h-8 flex items-center justify-center bg-slate-600 hover:bg-slate-700 text-white rounded-full text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isRunning ? "Running..." : "Run Tests"}
                        </button>
                        <button
                            onClick={submitCode}
                            disabled={isRunning || isSubmitting || !question}
                            className="px-4 h-8 flex items-center justify-center bg-teal-600 hover:bg-teal-700 text-white rounded-full text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
                                        }}
                                        options={{
                                            minimap: { enabled: false },
                                            fontSize: 14,
                                            lineNumbers: "on",
                                            scrollBeyondLastLine: false,
                                            automaticLayout: true,
                                            padding: { top: 16 },
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
                                <div className="flex bg-slate-50 dark:bg-[#282828] px-4 pt-2 gap-2 items-end">
                                    <button
                                        onClick={() => setTestPanelTab("testcase")}
                                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${
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
                                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${
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
                                                } else if (hasExecutionError || someWrong || !allFinished) {
                                                    titleMsg = "Failed";
                                                    titleColor = "text-red-500";
                                                } else {
                                                    titleMsg = "Submitted";
                                                    titleColor = "text-green-500";
                                                }

                                                const avgRuntime = results[getTestResultKey(tests[0], 0)]?.runtime || 0;

                                                return (
                                                    <div className="mb-4 flex items-baseline gap-4">
                                                        <h2 className={`text-2xl font-semibold ${titleColor}`}>
                                                            {titleMsg}
                                                        </h2>
                                                        {(titleMsg !== "Ready to Run" && avgRuntime > 0) && (
                                                            <span className="text-sm text-slate-500">Runtime: {avgRuntime} ms</span>
                                                        )}
                                                    </div>
                                                );
                                            })()}

                                            {/* Pills row */}
                                            <div className="flex gap-2 flex-wrap mb-6">
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
                                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
                                                <button
                                                    type="button"
                                                    onClick={addCustomTest}
                                                    title="Add custom test case"
                                                    className="flex items-center justify-center rounded-lg bg-slate-50 px-3 py-2 text-slate-500 transition-colors hover:bg-slate-100 dark:bg-[#282828] dark:text-slate-400 dark:hover:bg-[#333]"
                                                >
                                                    <span className="material-symbols-outlined text-[18px] leading-none">add</span>
                                                </button>
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
                </Panel>
            </Group>
            
            {/* Add to Sheet Modal */}
            <AddToSheetModal
                isOpen={showAddToSheet}
                onClose={() => setShowAddToSheet(false)}
                questionId={questionId || ""}
                questionType="dsa"
                onSuccess={() => {
                    console.log("Question added to sheet successfully");
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
