"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Group, Panel, Separator } from "react-resizable-panels";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { ReportQuestionModal } from "@/components/report-question-modal";
import { AddToSheetModal } from "@/components/add-to-sheet-modal";
import { updateLastQuestionDate } from "@/lib/notifications";
import { serializeExcalidrawForLLM } from "@/lib/excalidraw-serializer";
import { readPublicQuestionDraft, solveDraftPath } from "@/lib/public-question-drafts";
import ArchitectureDiagram, {
    type DiagramData,
} from "@/components/system-design/architecture-diagram";
import RequirementCard from "@/components/system-design/requirement-card";
import DiagramViewer from "@/components/system-design/diagram-viewer";

// Inline Excalidraw — full default toolbar, no extra header chrome.
const SystemDesignScratchpad = dynamic(
    () => import("@/components/system-design/scratchpad"),
    { ssr: false }
);

// ── Types ────────────────────────────────────────────────────────
interface Question {
    id: string;
    slug: string;
    title: string;
    difficulty: string;
    problemStatement: string;
    hints: string[];
    followUpQuestions: string[];
    rubricLite?: {
        requiredComponents?: string[];
        keyTradeoffs?: string[];
        antiPatterns?: string[];
    };
    sampleAnswer?: string | null;
    scoringDimensions?: { name: string; weight: number; criteria: string }[];
    architectureDiagram?: DiagramData | null;
    sampleDiagramUrl?: string | null;
}

interface DimensionScore {
    name: string;
    weight: number;
    score: number;
    feedback: string;
}

interface Verdict {
    overallScore: number;
    verdict: string;
    summary: string;
    strengths?: string[];
    improvements?: string[];
    missingComponents?: string[];
    tradeoffsCovered?: string[];
    tradeoffsMissed?: string[];
    diagramFeedback?: string;
    dimensionScores?: DimensionScore[];
}

interface Submission {
    id: string;
    createdAt: string;
    functionalRequirements: string;
    nonFunctionalRequirements: string;
    scratchpadElements: any[] | null;
    verdict: Verdict;
}

type Tab = "description" | "solution" | "submissions" | "verdict";

// ── Helpers ─────────────────────────────────────────────────────
function getDifficultyColor(difficulty: string) {
    switch (difficulty) {
        case "Easy":
            return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
        case "Medium":
            return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
        case "Hard":
            return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
        default:
            return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400";
    }
}

// Render markdown-lite **bold** within plain text (for the problemStatement).
function renderInlineMarkdown(text: string): React.ReactNode {
    const parts: (string | React.ReactNode)[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;
    let key = 0;
    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
        parts.push(<strong key={`b-${key++}`} className="text-slate-900 dark:text-white font-semibold">{match[1]}</strong>);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
}

// Split a problemStatement into the lead-in description and the FR / NFR /
// Scale lists. The JSONs use markdown headings like `**Functional Requirements:**`
// followed by `- bullet` lines.
interface ParsedStatement {
    intro: string;
    sections: { title: string; items: string[] }[];
}

function parseProblemStatement(raw: string): ParsedStatement {
    const text = (raw || "").replace(/\r\n/g, "\n");
    const headingRe = /\*\*(Functional Requirements|Non-Functional Requirements|Scale)\s*:?\s*\*\*/gi;

    const matches: { title: string; index: number; matchLength: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(text)) !== null) {
        matches.push({ title: m[1], index: m.index, matchLength: m[0].length });
    }

    if (matches.length === 0) {
        return { intro: text.trim(), sections: [] };
    }

    const intro = text.slice(0, matches[0].index).trim();

    const sections = matches.map((mt, i) => {
        const start = mt.index + mt.matchLength;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const body = text.slice(start, end);
        // Extract `- foo` bullet lines (or numbered). Fallback to non-empty lines.
        const lines = body
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        const bullets = lines
            .map((l) => l.replace(/^[-•*]\s+/, "").replace(/^\d+[.)]\s+/, ""))
            .filter(Boolean);
        return { title: mt.title, items: bullets };
    });

    return { intro, sections };
}

// ── Page ───────────────────────────────────────────────────────────
function SystemDesignSolveContent() {
    const searchParams = useSearchParams();
    const questionId = searchParams.get("id");
    const sheetId = searchParams.get("sheetId");
    const { resolvedTheme } = useTheme();

    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const isDark = mounted && resolvedTheme === "dark";

    const [question, setQuestion] = useState<Question | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<Tab>("description");
    const [showAddToSheet, setShowAddToSheet] = useState(false);
    const [nextQuestionUrl, setNextQuestionUrl] = useState<string | null>(null);

    // Authoring state
    const [fr, setFr] = useState("");
    const [nfr, setNfr] = useState("");
    const [initialScratchpadElements, setInitialScratchpadElements] = useState<any[]>([]);
    const scratchpadElementsRef = useRef<any[]>([]);

    // Submission state
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [activeVerdict, setActiveVerdict] = useState<Verdict | null>(null);
    const [activeSubmission, setActiveSubmission] = useState<Submission | null>(null);
    const [pastSubmissions, setPastSubmissions] = useState<Submission[]>([]);
    const [expandedSubIdx, setExpandedSubIdx] = useState<number | null>(null);

    const isSolved = pastSubmissions.some(s => (s.verdict?.overallScore ?? 0) >= 60);

    // ── Fetch question ───────────────────────────────────────────
    useEffect(() => {
        if (!questionId) {
            setError("No question ID provided");
            setLoading(false);
            return;
        }

        const fetchAll = async () => {
            try {
                const supabase = createSupabaseBrowserClient();
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData.session?.access_token;
                const headers: Record<string, string> = token
                    ? { Authorization: `Bearer ${token}` }
                    : {};

                const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
                const cleanQuestionId = questionId.startsWith("sd-") ? questionId.substring(3) : questionId;

                const res = await fetch(`${apiBase}/system-design/question/${cleanQuestionId}`, { headers });
                if (!res.ok) throw new Error("Failed to fetch question");
                const data = await res.json();
                setQuestion(data);
                const savedDraft = readPublicQuestionDraft(solveDraftPath("system-design", questionId));
                if (savedDraft?.content) {
                    const systemDesignDraft = savedDraft.content.match(
                        /^Functional Requirements:\n([\s\S]*?)\n\nNon-Functional Requirements:\n([\s\S]*)$/
                    );
                    if (systemDesignDraft) {
                        setFr(systemDesignDraft[1]);
                        setNfr(systemDesignDraft[2]);
                    } else {
                        setFr(savedDraft.content);
                    }
                    if (savedDraft.systemDesignElements?.length) {
                        const restoredElements = savedDraft.systemDesignElements as any[];
                        setInitialScratchpadElements(restoredElements);
                        scratchpadElementsRef.current = restoredElements;
                    }
                }

                // Past submissions
                if (token) {
                    try {
                        const subRes = await fetch(`${apiBase}/system-design/submissions/${cleanQuestionId}`, { headers });
                        if (subRes.ok) {
                            const subData = await subRes.json();
                            if (subData.success) setPastSubmissions(subData.data || []);
                        }
                    } catch (subErr) {
                        console.error("Failed to fetch submissions", subErr);
                    }
                }

                // Sheet next link
                if (sheetId && token) {
                    try {
                        const sheetRes = await fetch(
                            `${apiBase}/users/me/sheets/${encodeURIComponent(sheetId)}`,
                            { headers }
                        );
                        if (sheetRes.ok) {
                            const sheetData = await sheetRes.json();
                            const currentIndex = sheetData.questions.findIndex((q: any) => q.id.endsWith(cleanQuestionId));
                            if (currentIndex !== -1 && currentIndex < sheetData.questions.length - 1) {
                                const nextQ = sheetData.questions[currentIndex + 1];
                                const match = nextQ.id.match(/^(?:cs|dsa|sql|sd)-(.+)$/);
                                if (match) {
                                    const mongoId = match[1];
                                    const cat = (nextQ.category || "").toLowerCase();
                                    let baseUrl = "";
                                    if (cat === "cs_fundamentals" || cat === "os" || cat === "cn" || cat === "dbms" || cat === "oops") {
                                        baseUrl = `/questions/cs-fundamentals/solve?id=${mongoId}`;
                                    } else if (nextQ.id.startsWith("sql-") || cat === "sql") {
                                        baseUrl = `/questions/sql/solve?id=${mongoId}`;
                                    } else if (cat === "system_design") {
                                        baseUrl = `/questions/system-design/solve?id=${mongoId}`;
                                    } else if (nextQ.id.startsWith("cs-")) {
                                        baseUrl = `/questions/cs-fundamentals/solve?id=${mongoId}`;
                                    } else if (nextQ.id.startsWith("sd-")) {
                                        baseUrl = `/questions/system-design/solve?id=${mongoId}`;
                                    } else if (nextQ.id.startsWith("dsa-") || cat === "coding" || cat === "dsa") {
                                        baseUrl = `/questions/dsa/solve?id=${mongoId}`;
                                    }
                                    if (baseUrl) setNextQuestionUrl(`${baseUrl}&sheetId=${sheetId}`);
                                }
                            }
                        }
                    } catch (sheetErr) {
                        console.error("Failed to load sheet context:", sheetErr);
                    }
                }

                setLoading(false);
            } catch (err: any) {
                setError(err?.message || "Failed to load question");
                setLoading(false);
            }
        };

        fetchAll();
    }, [questionId, sheetId]);

    // ── Submit handler ───────────────────────────────────────────
    const handleSubmit = async () => {
        if (!question || isSubmitting) return;
        if (!fr.trim() && !nfr.trim() && scratchpadElementsRef.current.length === 0) {
            setSubmitError("Add some requirements or draw on the whiteboard before submitting.");
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const supabase = createSupabaseBrowserClient();
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) {
                setSubmitError("You must be logged in to submit.");
                setIsSubmitting(false);
                return;
            }

            const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

            const res = await fetch(`${apiBase}/system-design/submit`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    questionId: question.id,
                    functionalRequirements: fr,
                    nonFunctionalRequirements: nfr,
                    scratchpadElements: scratchpadElementsRef.current,
                    diagramDescription: serializeExcalidrawForLLM(scratchpadElementsRef.current),
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data?.error || "Submission failed");
            }

            const submission: Submission = data.submission;
            setActiveVerdict(submission.verdict);
            setActiveSubmission(submission);
            setPastSubmissions((prev) => [submission, ...prev]);
            setActiveTab("verdict");
            updateLastQuestionDate();
            
            // Auto-mark as completed in sheet if coming from a sheet and submission passed
            if (sheetId && questionId && submission.verdict?.overallScore >= 70) {
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
                                        questionId: `sd-${questionId}`,
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
                                        questionId: `sd-${questionId}`,
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
        } catch (err: any) {
            setSubmitError(err?.message || "Submission failed");
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Render gates ─────────────────────────────────────────────
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
                <div className="text-red-600 dark:text-red-400">{error || "Question not found"}</div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-[#FAFBFC] dark:bg-lc-bg">
            <Group orientation="horizontal">
                {/* ── Left Panel: Question / Solution / Submissions / Verdict ── */}
                <Panel defaultSize={40} minSize={28}>
                    <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <PageHeader
                                    title={question.title}
                                    showBack={true}
                                    backUrl={sheetId ? `/sheets/${sheetId}` : "/questions/system-design"}
                                />
                                {isSolved && (
                                    <div className="ml-3 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm border border-emerald-200 dark:border-emerald-800/60">
                                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                        Solved
                                    </div>
                                )}
                            </div>
                            {sheetId && nextQuestionUrl && (
                                <a
                                    href={nextQuestionUrl}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 mr-3 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-900/30 dark:text-teal-400 dark:hover:bg-teal-800/50 rounded text-[13px] font-semibold transition-colors whitespace-nowrap"
                                >
                                    Next
                                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                                </a>
                            )}
                        </div>

                        {/* Tabs */}
                        <div className="flex items-center bg-slate-100 dark:bg-[#333333]">
                            <TabButton
                                label="Description"
                                active={activeTab === "description"}
                                onClick={() => setActiveTab("description")}
                            />
                            <TabButton
                                label="Solution"
                                active={activeTab === "solution"}
                                onClick={() => setActiveTab("solution")}
                            />
                            <TabButton
                                label={`Submissions${pastSubmissions.length ? ` (${pastSubmissions.length})` : ""}`}
                                active={activeTab === "submissions"}
                                onClick={() => setActiveTab("submissions")}
                            />
                            {activeVerdict && (
                                <button
                                    onClick={() => setActiveTab("verdict")}
                                    className={`group flex items-center gap-1.5 px-4 py-2 text-sm font-medium ${
                                        activeTab === "verdict"
                                            ? "text-slate-900 dark:text-white border-b-2 border-slate-700 dark:border-slate-300"
                                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                                    }`}
                                >
                                    Verdict
                                    <span
                                        role="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveVerdict(null);
                                            setActiveSubmission(null);
                                            setActiveTab("submissions");
                                        }}
                                        className="-ml-1 -mr-1 w-6 h-6 rounded-full hover:bg-slate-200 dark:hover:bg-[#3e3e3e] flex items-center justify-center"
                                        title="Close verdict tab"
                                    >
                                        <span className="text-[16px] leading-none font-medium">×</span>
                                    </span>
                                </button>
                            )}
                            <div className="ml-auto pr-3">
                                <ReportQuestionModal
                                    questionId={question.id}
                                    questionType="system_design"
                                    questionTitle={question.title}
                                />
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-auto p-6">
                            {/* Always-visible badges row */}
                            <div className="mb-4 flex items-center justify-between">
                                <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getDifficultyColor(question.difficulty)}`}>
                                    {question.difficulty}
                                </span>
                                <button
                                    onClick={() => setShowAddToSheet(true)}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 dark:bg-[#333333] dark:hover:bg-[#3e3e3e] dark:text-slate-400 dark:hover:text-slate-200 transition-all"
                                    title="Add to custom sheet"
                                >
                                    <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                                    <span className="text-sm font-medium">Add to Sheet</span>
                                </button>
                            </div>

                            {activeTab === "description" && <DescriptionTab question={question} />}
                            {activeTab === "solution" && <SolutionTab question={question} />}
                            {activeTab === "submissions" && (
                                <SubmissionsTab
                                    submissions={pastSubmissions}
                                    expandedIdx={expandedSubIdx}
                                    setExpandedIdx={setExpandedSubIdx}
                                    onView={(s) => {
                                        setActiveVerdict(s.verdict);
                                        setActiveSubmission(s);
                                        setActiveTab("verdict");
                                    }}
                                />
                            )}
                            {activeTab === "verdict" && activeVerdict && (
                                <VerdictTab verdict={activeVerdict} submission={activeSubmission} />
                            )}
                        </div>
                    </div>
                </Panel>

                <Separator className="relative w-1.5 bg-slate-200 dark:bg-[#3e3e3e] hover:bg-teal-500 dark:hover:bg-teal-500 transition-colors group cursor-col-resize flex items-center justify-center">
                    <div className="w-0.5 h-6 bg-slate-400 dark:bg-slate-500 rounded-full group-hover:bg-teal-400 transition-colors" />
                </Separator>

                {/* ── Right Panel: Whiteboard + FR/NFR ── */}
                <Panel defaultSize={60} minSize={30}>
                    <Group orientation="vertical">
                        {/* Whiteboard panel — full Excalidraw, top-right Submit overlay */}
                        <Panel defaultSize={55} minSize={25}>
                            <div className="relative h-full bg-white dark:bg-[#282828]">
                                <SystemDesignScratchpad
                                    isDark={isDark}
                                    initialElements={initialScratchpadElements}
                                    onSceneChange={(elements) => {
                                        scratchpadElementsRef.current = elements;
                                    }}
                                />

                                {/* Floating submit control */}
                                <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2">
                                    {submitError && (
                                        <span className="pointer-events-auto px-3 py-1.5 rounded-full text-[11px] font-medium bg-slate-800/80 text-white max-w-[280px] truncate backdrop-blur-sm" title={submitError}>
                                            {submitError}
                                        </span>
                                    )}
                                    <button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting}
                                        className="pointer-events-auto px-5 h-9 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                                Reviewing…
                                            </>
                                        ) : (
                                            "Submit"
                                        )}
                                    </button>
                                </div>
                            </div>
                        </Panel>

                        <Separator className="relative h-1.5 bg-slate-200 dark:bg-[#3e3e3e] hover:bg-teal-500 dark:hover:bg-teal-500 transition-colors group cursor-row-resize flex items-center justify-center">
                            <div className="h-0.5 w-6 bg-slate-400 dark:bg-slate-500 rounded-full group-hover:bg-teal-400 transition-colors" />
                        </Separator>

                        {/* Requirements panel */}
                        <Panel defaultSize={45} minSize={25}>
                            <div className="h-full bg-slate-50 dark:bg-[#1e1e1e] p-4 overflow-hidden">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                                    <RequirementCard
                                        title="Functional Requirements"
                                        placeholder="Write functional requirements here..."
                                        value={fr}
                                        onChange={setFr}
                                    />
                                    <RequirementCard
                                        title="Non-Functional Requirements"
                                        placeholder="Write non-functional requirements here..."
                                        value={nfr}
                                        onChange={setNfr}
                                    />
                                </div>
                            </div>
                        </Panel>
                    </Group>
                </Panel>
            </Group>

            <AddToSheetModal
                isOpen={showAddToSheet}
                onClose={() => setShowAddToSheet(false)}
                questionId={questionId || ""}
                questionType="sd"
                onSuccess={() => {}}
            />
        </div>
    );
}

// ── Sub-components ──────────────────────────────────────────────

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-2 text-sm font-medium ${
                active
                    ? "text-slate-900 dark:text-white border-b-2 border-slate-700 dark:border-slate-300"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
        >
            {label}
        </button>
    );
}

function DescriptionTab({ question }: { question: Question }) {
    const parsed = parseProblemStatement(question.problemStatement);
    const [revealed, setRevealed] = useState(0);

    const hints = question.hints || [];

    return (
        <div className="space-y-8">
            {/* Intro paragraph (FR/NFR/Scale extracted out, shown in Solution tab) */}
            {parsed.intro && (
                <div className="text-[16px] text-slate-700 dark:text-slate-100 leading-relaxed whitespace-pre-wrap">
                    {renderInlineMarkdown(parsed.intro)}
                </div>
            )}

            {/* Follow-up Questions — above Hints */}
            {!!question.followUpQuestions?.length && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-[21px] text-slate-500 dark:text-slate-400">quiz</span>
                        Follow-up Questions
                    </h3>
                    <ol className="space-y-2 list-decimal list-inside marker:text-slate-400 dark:marker:text-slate-500">
                        {question.followUpQuestions.map((q, idx) => (
                            <li key={idx} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed pl-1">
                                {q}
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {/* Hints — collapsed by default, reveal one at a time */}
            {!!hints.length && (
                <section>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[19px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-[21px] text-slate-500 dark:text-slate-400">lightbulb</span>
                            Hints
                            <span className="text-[13px] font-medium text-slate-400 dark:text-slate-500 ml-1">
                                ({revealed}/{hints.length})
                            </span>
                        </h3>
                        {revealed > 0 && (
                            <button
                                type="button"
                                onClick={() => setRevealed(0)}
                                className="text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-2 py-1 rounded"
                            >
                                Hide all
                            </button>
                        )}
                    </div>

                    {revealed === 0 ? (
                        <button
                            type="button"
                            onClick={() => setRevealed(1)}
                            className="px-4 py-2 text-slate-800 dark:text-slate-200 text-[14px] font-medium transition-colors hover:text-slate-600 dark:hover:text-slate-400"
                        >
                            Reveal first hint
                        </button>
                    ) : (
                        <div className="space-y-3">
                            {hints.slice(0, revealed).map((hint, idx) => (
                                <div key={idx} className="flex items-start gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 mt-0.5 bg-blue-500 text-white rounded-full flex items-center justify-center text-[11px] font-bold">
                                        {idx + 1}
                                    </span>
                                    <p className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed">{hint}</p>
                                </div>
                            ))}
                            {revealed < hints.length && (
                                <button
                                    type="button"
                                    onClick={() => setRevealed((r) => Math.min(r + 1, hints.length))}
                                    className="px-4 py-2 text-slate-800 dark:text-slate-200 text-[14px] font-medium transition-colors hover:text-slate-600 dark:hover:text-slate-400"
                                >
                                    Show next hint
                                </button>
                            )}
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}

function PlainList({ title, icon, items }: { title: string; icon: string; items: string[] }) {
    return (
        <section>
            <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[21px] text-slate-500 dark:text-slate-400">{icon}</span>
                {title}
            </h3>
            <ul className="space-y-2">
                {items.map((it, idx) => (
                    <li key={idx} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2">
                        <span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">•</span>
                        <span>{it}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function SolutionTab({ question }: { question: Question }) {
    const parsed = parseProblemStatement(question.problemStatement);

    const fr = parsed.sections.find((s) => /functional requirements/i.test(s.title) && !/non/i.test(s.title));
    const nfr = parsed.sections.find((s) => /non-functional/i.test(s.title));
    const scale = parsed.sections.find((s) => /scale/i.test(s.title));

    const hasContent =
        question.sampleAnswer ||
        question.architectureDiagram ||
        question.sampleDiagramUrl ||
        fr?.items.length ||
        nfr?.items.length ||
        scale?.items.length ||
        question.rubricLite?.requiredComponents?.length ||
        question.rubricLite?.keyTradeoffs?.length ||
        question.rubricLite?.antiPatterns?.length ||
        question.scoringDimensions?.length;

    if (!hasContent) {
        return (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                <span className="material-symbols-outlined text-5xl mb-2 text-slate-400">draft</span>
                <p>Solution material not available for this question yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Functional / Non-Functional / Scale — extracted from problem */}
            {!!fr?.items.length && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">
                        Functional Requirements
                    </h3>
                    <ul className="space-y-2">
                        {fr.items.map((it, idx) => (
                            <li key={idx} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2">
                                <span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">•</span>
                                <span>{it}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {!!nfr?.items.length && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">
                        Non-Functional Requirements
                    </h3>
                    <ul className="space-y-2">
                        {nfr.items.map((it, idx) => (
                            <li key={idx} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2">
                                <span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">•</span>
                                <span>{it}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {!!scale?.items.length && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">
                        Scale
                    </h3>
                    <ul className="space-y-2">
                        {scale.items.map((it, idx) => (
                            <li key={idx} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2">
                                <span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">•</span>
                                <span>{it}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Sample Approach — text + reference architecture diagram together */}
            {(question.sampleAnswer || question.architectureDiagram) && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">
                        Sample Approach
                    </h3>
                    <div className="space-y-4">
                        {question.sampleAnswer && (
                            <p className="text-[15.5px] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                                {question.sampleAnswer}
                            </p>
                        )}
                        {question.architectureDiagram && (
                            <ArchitectureDiagram diagram={question.architectureDiagram as DiagramData} />
                        )}
                    </div>
                </section>
            )}

            {!!question.rubricLite?.requiredComponents?.length && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">
                        Required Components
                    </h3>
                    <ul className="space-y-2">
                        {question.rubricLite.requiredComponents.map((it, idx) => (
                            <li key={idx} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2">
                                <span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">•</span>
                                <span>{it}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {!!question.rubricLite?.keyTradeoffs?.length && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">
                        Key Trade-offs to Consider
                    </h3>
                    <ul className="space-y-2">
                        {question.rubricLite.keyTradeoffs.map((it, idx) => (
                            <li key={idx} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2">
                                <span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">•</span>
                                <span>{it}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {!!question.rubricLite?.antiPatterns?.length && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">
                        Common Anti-Patterns to Avoid
                    </h3>
                    <ul className="space-y-2">
                        {question.rubricLite.antiPatterns.map((it, idx) => (
                            <li key={idx} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2">
                                <span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">•</span>
                                <span>{it}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {question.sampleDiagramUrl && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-[21px] text-slate-500 dark:text-slate-400">schema</span>
                        Reference Architecture
                    </h3>
                    <div className="rounded-xl border border-slate-200 dark:border-[#3e3e3e] overflow-hidden bg-white dark:bg-[#1e1e1e]">
                        <img
                            src={question.sampleDiagramUrl}
                            alt={`Reference architecture diagram for ${question.title}`}
                            className="w-full h-auto object-contain"
                            loading="lazy"
                        />
                    </div>
                </section>
            )}

            {!!question.scoringDimensions?.length && (
                <section>
                    <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">
                        How You're Evaluated
                    </h3>
                    <div className="space-y-3">
                        {question.scoringDimensions.map((d, idx) => (
                            <div key={idx} className="flex items-start gap-3.5">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold text-[12px] shadow-sm">
                                    {d.weight}%
                                </div>
                                <div className="min-w-0 pt-0.5">
                                    <div className="text-[16px] font-semibold text-slate-900 dark:text-white">{d.name}</div>
                                    <div className="text-[14px] text-slate-600 dark:text-slate-400 leading-relaxed mt-0.5">{d.criteria}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

function SubmissionsTab({
    submissions,
    expandedIdx,
    setExpandedIdx,
    onView,
}: {
    submissions: Submission[];
    expandedIdx: number | null;
    setExpandedIdx: (n: number | null) => void;
    onView: (s: Submission) => void;
}) {
    if (submissions.length === 0) {
        return (
            <div className="text-center py-16 text-slate-500 dark:text-slate-400">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center bg-blue-50 dark:bg-blue-900/30">
                    <span className="material-symbols-outlined text-3xl text-blue-500 dark:text-blue-400">history</span>
                </div>
                <p className="text-[16px] font-bold text-slate-900 dark:text-white">No submissions yet</p>
                <p className="text-[13.5px] mt-2 text-slate-500 dark:text-slate-400">
                    Draft your design on the right and click <span className="font-semibold text-blue-600 dark:text-blue-400">Submit</span> to see your verdict here.
                </p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-slate-100 dark:divide-[#2a2a2a]">
                <thead>
                    <tr>
                        <th className="px-2 py-3 text-left">
                            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Verdict</span>
                        </th>
                        <th className="px-2 py-3 text-center">
                            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Score</span>
                        </th>
                        <th className="px-2 py-3 text-center">
                            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Diagram</span>
                        </th>
                        <th className="px-2 py-3 text-right">
                            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Open</span>
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#2a2a2a]">
                    {submissions.map((sub, i) => {
                        const expanded = expandedIdx === i;
                        return (
                            <Fragment key={sub.id}>
                                <tr
                                    onClick={() => setExpandedIdx(expanded ? null : i)}
                                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-[#1f1f1f] transition-colors"
                                >
                                    <td className="px-2 py-3 text-sm">
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-slate-800 dark:text-slate-100">
                                                {sub.verdict?.verdict || "Reviewed"}
                                            </span>
                                            <span className="text-[11px] text-slate-500 mt-0.5">
                                                {new Date(sub.createdAt).toLocaleString([], {
                                                    month: "short",
                                                    day: "numeric",
                                                    year: "numeric",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                })}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-2 py-3 text-center">
                                        <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100">
                                            {Math.round(sub.verdict?.overallScore ?? 0)}
                                        </span>
                                        <span className="text-xs text-slate-400">/100</span>
                                    </td>
                                    <td className="px-2 py-3 text-center text-sm text-slate-500 dark:text-slate-400">
                                        {Array.isArray(sub.scratchpadElements) ? `${sub.scratchpadElements.length} el` : "—"}
                                    </td>
                                    <td className="px-2 py-3 text-right">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onView(sub); }}
                                            className="text-[12px] font-semibold text-white px-3 py-1 rounded-full bg-blue-500 hover:bg-blue-600"
                                        >
                                            View
                                        </button>
                                    </td>
                                </tr>
                                {expanded && (
                                    <tr>
                                        <td colSpan={4} className="px-2 py-3">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                                                <PreviewBlock label="Functional Requirements" body={sub.functionalRequirements} />
                                                <PreviewBlock label="Non-Functional Requirements" body={sub.nonFunctionalRequirements} />
                                            </div>
                                            {sub.verdict?.summary && (
                                                <p className="text-[12.5px] text-slate-600 dark:text-slate-400 italic">
                                                    {sub.verdict.summary}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function PreviewBlock({ label, body }: { label: string; body: string }) {
    return (
        <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 font-semibold">{label}</div>
            <div className="text-[13px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                {body || <span className="italic text-slate-400">(empty)</span>}
            </div>
        </div>
    );
}

function VerdictTab({ verdict, submission }: { verdict: Verdict; submission: Submission | null }) {
    const score = Math.round(verdict.overallScore || 0);

    return (
        <div className="space-y-8">
            {/* Header — blue accent, the only colored callout in the tab */}
            <div className="p-5 rounded-xl bg-blue-50 dark:bg-blue-900/25">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <div className="text-[22px] font-bold text-blue-900 dark:text-blue-100">
                            {verdict.verdict || "Reviewed"}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-[42px] leading-none font-bold text-blue-700 dark:text-blue-200 font-mono">{score}</div>
                        <div className="text-[11px] uppercase tracking-wider text-blue-700/70 dark:text-blue-300/70">/ 100</div>
                    </div>
                </div>
                <div className="mt-3 h-2 bg-blue-100/80 dark:bg-blue-800/40 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-blue-500 dark:bg-blue-400 transition-all"
                        style={{ width: `${Math.max(2, score)}%` }}
                    />
                </div>
                {verdict.summary && (
                    <p className="mt-4 text-[14px] leading-relaxed text-blue-900 dark:text-blue-100">
                        {verdict.summary}
                    </p>
                )}
            </div>

            {/* Strengths / Improvements */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
                <PlainListBlock
                    title="Strengths"
                    icon="thumb_up"
                    items={verdict.strengths || []}
                    emptyMessage="No notable strengths identified."
                    headingColor="text-blue-800 dark:text-blue-200"
                />
                <PlainListBlock
                    title="Improvements"
                    icon="trending_up"
                    items={verdict.improvements || []}
                    emptyMessage="No specific improvements suggested."
                    headingColor="text-blue-800 dark:text-blue-200"
                />
            </div>

            {/* Missing & trade-offs */}
            {(verdict.missingComponents?.length || verdict.tradeoffsMissed?.length || verdict.tradeoffsCovered?.length) ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
                    {!!verdict.missingComponents?.length && (
                        <PlainListBlock
                            title="Missing Components"
                            icon="warning"
                            items={verdict.missingComponents}
                            headingColor="text-red-600 dark:text-red-400"
                        />
                    )}
                    {!!verdict.tradeoffsCovered?.length && (
                        <PlainListBlock
                            title="Trade-offs Covered"
                            icon="check_circle"
                            items={verdict.tradeoffsCovered}
                            headingColor="text-blue-800 dark:text-blue-200"
                        />
                    )}
                    {!!verdict.tradeoffsMissed?.length && (
                        <PlainListBlock
                            title="Trade-offs Missed"
                            icon="balance"
                            items={verdict.tradeoffsMissed}
                            headingColor="text-red-600 dark:text-red-400"
                        />
                    )}
                </div>
            ) : null}

            {/* Diagram feedback */}
            {(verdict.diagramFeedback || (submission?.scratchpadElements && submission.scratchpadElements.length > 0)) && (
                <section>
                    <h4 className="text-[16px] font-bold text-blue-800 dark:text-blue-200 mb-2">
                        Diagram Feedback
                    </h4>
                    {submission?.scratchpadElements && submission.scratchpadElements.length > 0 && (
                        <div className="mb-3 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                            <div className="bg-slate-50 dark:bg-[#1e1e1e] p-2 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-[12px] font-medium text-slate-600 dark:text-slate-400">Your Diagram</span>
                            </div>
                            <DiagramViewer elements={submission.scratchpadElements} />
                        </div>
                    )}
                    {verdict.diagramFeedback && (
                        <p className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">
                            {verdict.diagramFeedback}
                        </p>
                    )}
                </section>
            )}

            {/* Dimension scores */}
            {!!verdict.dimensionScores?.length && (
                <section>
                    <h4 className="text-[16px] font-bold text-blue-800 dark:text-blue-200 mb-4">
                        Per-Dimension Breakdown
                    </h4>
                    <div className="space-y-4">
                        {verdict.dimensionScores.map((d, idx) => {
                            const s = Math.round(d.score || 0);
                            return (
                                <div key={idx}>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-[14.5px] font-semibold text-slate-900 dark:text-white truncate">{d.name}</span>
                                            <span className="text-[11px] text-slate-400 dark:text-slate-500">weight {d.weight}%</span>
                                        </div>
                                        <span className="text-[14px] font-bold font-mono text-slate-800 dark:text-slate-100">{s}/100</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 dark:bg-[#2a2a2a] rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 dark:bg-blue-400" style={{ width: `${Math.max(2, s)}%` }} />
                                    </div>
                                    {d.feedback && (
                                        <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                                            {d.feedback}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}

function PlainListBlock({
    title,
    icon,
    items,
    emptyMessage,
    headingColor = "text-blue-800 dark:text-blue-200",
}: {
    title: string;
    icon: string;
    items: string[];
    emptyMessage?: string;
    headingColor?: string;
}) {
    return (
        <section>
            <h4 className={`text-[16px] font-bold mb-3 flex items-center gap-2 ${headingColor}`}>
                <span className="material-symbols-outlined text-[18px]">{icon}</span>
                {title}
            </h4>
            {items.length > 0 ? (
                <ul className="space-y-2">
                    {items.map((it, idx) => (
                        <li key={idx} className="text-[14px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2">
                            <span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">•</span>
                            <span>{it}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-[13px] text-slate-500 dark:text-slate-400 italic">
                    {emptyMessage || "Nothing here."}
                </p>
            )}
        </section>
    );
}

export default function SystemDesignSolvePage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
            <SystemDesignSolveContent />
        </Suspense>
    );
}
