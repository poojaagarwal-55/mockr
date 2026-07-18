"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { api, ApiError } from "@/lib/api";
import { useCompanyAuth } from "@/context/company-auth-context";
import RequirementCard from "@/components/system-design/requirement-card";

loader.config({
    paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs" },
});

const SystemDesignScratchpad = dynamic(
    () => import("@/components/system-design/scratchpad"),
    { ssr: false }
);

// â”€â”€ Judge0 language IDs (same as web) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


// â”€â”€ Inline LANGUAGE_MAP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LANGUAGE_MAP: Record<string, { label: string; monacoId: string }> = {
    python:     { label: "Python 3",    monacoId: "python" },
    python3:    { label: "Python 3",    monacoId: "python" },
    javascript: { label: "JavaScript",  monacoId: "javascript" },
    typescript: { label: "TypeScript",  monacoId: "typescript" },
    java:       { label: "Java",        monacoId: "java" },
    cpp:        { label: "C++",         monacoId: "cpp" },
    "c++":      { label: "C++",         monacoId: "cpp" },
    go:         { label: "Go",          monacoId: "go" },
    rust:       { label: "Rust",        monacoId: "rust" },
    c:          { label: "C",           monacoId: "c" },
    csharp:     { label: "C#",          monacoId: "csharp" },
    ruby:       { label: "Ruby",        monacoId: "ruby" },
    sql:        { label: "SQL",         monacoId: "sql" },
};

const JUDGE0_LANGUAGE_IDS: Record<string, number> = {
    python: 71, python3: 71,
    javascript: 93, typescript: 74,
    java: 62, cpp: 54, "c++": 54, c: 50,
    csharp: 51, go: 60, rust: 73, ruby: 72,
};

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export type QuestionType = "dsa" | "sql" | "system_design" | "cs_fundamentals";

export type QuestionPayload = Record<string, any> & {
    id: string;
    title?: string;
    question?: string;
    difficulty?: string;
    description?: string;
    statement?: string;
    problemStatement?: string;
    answer?: string;
    answerPreview?: string;
    detailedAnswer?: string;
    schema?: string;
    examples?: any[];
    testCases?: any[];
    sampleTestCases?: any[];
    sample_tests?: any[];
    constraints?: string[] | string;
    topics?: string[];
    companyTags?: string[];
    tags?: string[];
    hints?: string[];
    followUpQuestions?: string[];
    codeSnippets?: Record<string, { starter_code?: string; wrapper_code?: string }>;
    starterCode?: Record<string, string>;
    starter_code?: Record<string, string>;
    wrapperCode?: string;
    solution?: any;
    rubricLite?: any;
    sampleAnswer?: string;
    scoringDimensions?: any[];
    architectureDiagram?: any;
    sampleDiagramUrl?: string;
};

export const ROUTE_TO_TYPE: Record<string, QuestionType> = {
    dsa: "dsa",
    sql: "sql",
    "system-design": "system_design",
    "cs-fundamentals": "cs_fundamentals",
};

type PreviewBackProps = {
    backHref: string;
    onBack?: () => void;
};

function PreviewBackButton({ backHref, onBack }: PreviewBackProps) {
    const className = "flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-lc-hover dark:hover:text-white";

    if (onBack) {
        return (
            <button type="button" onClick={onBack} className={className}>
                <span className="material-symbols-outlined">arrow_back</span>
            </button>
        );
    }

    return (
        <Link href={backHref} className={className}>
            <span className="material-symbols-outlined">arrow_back</span>
        </Link>
    );
}

// â”€â”€ Data helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getStarterCodeForLanguage(
    starterCode: Record<string, string> | undefined,
    language: string
): string | undefined {
    if (!starterCode) return undefined;
    const candidates = language === "cpp" ? ["cpp", "c++"] : [language];
    for (const c of candidates) {
        const s = starterCode[c];
        if (typeof s === "string" && s.trim()) return s;
    }
    return undefined;
}

function normalizeStarterCode(q: QuestionPayload): Record<string, string> {
    // Prefer starter_code (web format), then starterCode, then codeSnippets
    if (q.starter_code && Object.keys(q.starter_code).length) return q.starter_code;
    if (q.starterCode && Object.keys(q.starterCode).length) return q.starterCode;
    if (q.codeSnippets) {
        const out: Record<string, string> = {};
        for (const [lang, snip] of Object.entries(q.codeSnippets)) {
            const code = snip?.starter_code || snip?.wrapper_code;
            if (typeof code === "string" && code.trim()) out[lang] = code;
        }
        return out;
    }
    return {};
}

function normalizeSampleTests(q: QuestionPayload): any[] {
    return q.sample_tests?.length
        ? q.sample_tests
        : q.sampleTestCases?.length
        ? q.sampleTestCases
        : q.testCases?.length
        ? q.testCases
        : [];
}

function normalizeComplexityValue(value?: string): string {
    const n = (value || "").trim();
    if (!n) return "";
    const l = n.toLowerCase();
    if (l === "unknown" || l === "n/a" || l === "na" || l === "none") return "";
    return n;
}

function cleanExplainationText(value?: string): string {
    const raw = (value || "").trim();
    if (!raw) return "";
    return raw
        .split("\n")
        .filter((line) => {
            const t = line.trim().toLowerCase();
            return !t.startsWith("time complexity:") && !t.startsWith("space complexity:");
        })
        .join("\n")
        .trim();
}

const SUPPORTED_CODE_LANGUAGES = new Set([
    "python", "python3", "cpp", "c++", "java", "javascript",
    "typescript", "c", "csharp", "go", "rust", "ruby", "swift", "kotlin", "php",
]);

function getCodeLanguages(code?: Record<string, string>): string[] {
    if (!code) return [];
    return Object.keys(code).filter((l) => SUPPORTED_CODE_LANGUAGES.has(l.toLowerCase()));
}

function getDefaultLanguage(starterCode: Record<string, string>, preferred: string): string {
    if (!Object.keys(starterCode).length) return preferred;
    if (getStarterCodeForLanguage(starterCode, preferred)) return preferred;
    if (starterCode.cpp) return "cpp";
    if (starterCode["c++"]) return "c++";
    return Object.keys(starterCode)[0] || preferred;
}

function getTestResultKey(test: any, index: number): string {
    if (test?.id !== undefined && test?.id !== null && String(test.id).trim() !== "")
        return String(test.id);
    return `test-${index}`;
}

function formatTestData(value: any): string {
    if (typeof value === "string") {
        try { return formatValue(JSON.parse(value)); } catch { return value; }
    }
    return formatValue(value);
}

function formatValue(value: any): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return `"${value}"`;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        if (!value.length) return "[]";
        if (Array.isArray(value[0])) return `[\n  ${value.map((a) => `[${a.join(", ")}]`).join(",\n  ")}\n]`;
        return `[${value.map(formatValue).join(", ")}]`;
    }
    if (typeof value === "object") {
        const entries = Object.entries(value);
        if (!entries.length) return "{}";
        return entries.map(([k, v]) => `${k} = ${formatValue(v)}`).join(", ");
    }
    return String(value);
}

// â”€â”€ DSA description cleaner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Company API returns the full LeetCode markdown (description + examples + constraints in one string).
// We strip everything from the first "Example 1:" or "Constraints:" section header so those sections
// can be rendered separately as structured blocks (matching the web client layout).
function extractProblemStatement(raw: string): string {
    if (!raw) return "";
    // Match any line that starts with optional ** markers followed by "Example 1" or "Constraints"
    const match = raw.match(/(?:^|\n)\s*\*{0,2}(Example\s+1|Constraints?)\s*\*{0,2}\s*[:*]/im);
    if (match && match.index !== undefined) {
        return raw.slice(0, match.index).trim();
    }
    return raw.trim();
}

// Parse example_text markdown (e.g. "**Input:** num = 3\n**Output:** \"III\"") into structured fields
function parseExampleText(raw: string): { inputStr: string | null; outputStr: string | null; explanation: string | null } {
    const inputM = raw.match(/\*{0,2}Input\s*:\*{0,2}\s*([^\n*]+)/i);
    const outputM = raw.match(/\*{0,2}Output\s*:\*{0,2}\s*([^\n*]+)/i);
    const explM = raw.match(/\*{0,2}Explanation\s*:\*{0,2}\s*([^\n*]+(?:\n[^\n*]+)*)/i);
    return {
        inputStr: inputM ? inputM[1].trim() : null,
        outputStr: outputM ? outputM[1].trim() : null,
        explanation: explM ? explM[1].trim() : null,
    };
}

// â”€â”€ SQL helpers (DataTable) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DataTable({ data, title, titleNode }: { data: any; title?: string; titleNode?: React.ReactNode }) {
    if (!data) return null;
    let parsed = data;
    if (typeof data === "string") {
        try { parsed = JSON.parse(data); } catch { return <pre className="text-sm">{data}</pre>; }
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
        const keys = Object.keys(parsed[0]);
        return (
            <div className="overflow-x-auto">
                {(titleNode || title) && <div className="mb-2 text-slate-700 dark:text-slate-300">{titleNode || <p className="font-semibold">{title}</p>}</div>}
                <table className="min-w-full border border-slate-300 dark:border-slate-600 text-sm">
                    <thead className="bg-slate-100 dark:bg-slate-700">
                        <tr>{keys.map((k) => <th key={k} className="px-4 py-2 text-left font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-300 dark:border-slate-600">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                        {parsed.map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                {keys.map((k) => <td key={k} className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">{row[k] !== null && row[k] !== undefined ? String(row[k]) : "NULL"}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
        return (
            <div className="space-y-4">
                {Object.entries(parsed).map(([tableName, tableData]: [string, any]) => (
                    <DataTable key={tableName} data={tableData} title={tableName} />
                ))}
            </div>
        );
    }
    return <pre className="text-sm">{JSON.stringify(parsed, null, 2)}</pre>;
}

// â”€â”€ CS Fundamentals formatted answer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function FormattedAnswer({ text }: { text: string }) {
    let cleaned = text.trim();
    const firstPeriod = cleaned.match(/^[^.]*\.\s*/);
    if (firstPeriod) cleaned = cleaned.substring(firstPeriod[0].length).trim();
    cleaned = cleaned.replace(/^\*+\s*/, "").trim();
    cleaned = cleaned.replace(/^\*+\s*$/gm, "").replace(/\s+\*+\s+/g, " ").replace(/^\*+\s+/gm, "");
    cleaned = cleaned.replace(/^#{1,6}\s*$/gm, "");
    cleaned = cleaned.replace(/\s+(\d+)\.\s+/g, "\n\n$1. ");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    const paragraphs = cleaned.split("\n\n").filter((p) => {
        const t = p.trim();
        return t && t !== "*" && t !== "**" && !/^\*+$/.test(t) && !/^#{1,6}$/.test(t);
    });

    const fmt = (content: string) => {
        content = content.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>');
        content = content.replace(/\*(.+?)\*/g, '<em class="italic text-blue-700 dark:text-blue-400">$1</em>');
        content = content.replace(/`(.+?)`/g, '<code class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-sm font-mono text-blue-600 dark:text-blue-400">$1</code>');
        return content;
    };

    return (
        <div className="space-y-6">
            {paragraphs.map((para, idx) => {
                if (para.startsWith("### ")) return <h4 key={idx} className="text-lg font-bold text-slate-900 dark:text-white mt-6 mb-3">{para.replace("### ", "")}</h4>;
                if (para.startsWith("## ")) return <h3 key={idx} className="text-xl font-bold text-slate-900 dark:text-white mt-8 mb-4">{para.replace("## ", "")}</h3>;
                if (para.includes("\n- ") || para.startsWith("- ")) {
                    const items = para.split("\n").filter((l) => l.trim().startsWith("- "));
                    return (
                        <ul key={idx} className="space-y-3 ml-4">
                            {items.map((item, i) => (
                                <li key={i} className="flex items-start gap-3 text-slate-700 dark:text-slate-300 leading-relaxed">
                                    <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2" />
                                    <span dangerouslySetInnerHTML={{ __html: fmt(item.replace(/^- /, "")) }} />
                                </li>
                            ))}
                        </ul>
                    );
                }
                if (/^\d+\.\s/.test(para)) {
                    const match = para.match(/^(\d+)\.\s([\s\S]+)$/);
                    if (match) {
                        const [, num, content] = match;
                        return (
                            <div key={idx} className="flex items-start gap-3 ml-4">
                                <span className="flex-shrink-0 w-7 h-7 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full flex items-center justify-center text-sm font-semibold">{num}</span>
                                <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-lg flex-1" dangerouslySetInnerHTML={{ __html: fmt(content) }} />
                            </div>
                        );
                    }
                }
                return <p key={idx} className="text-slate-700 dark:text-slate-300 leading-relaxed text-lg" dangerouslySetInnerHTML={{ __html: fmt(para) }} />;
            })}
        </div>
    );
}

// â”€â”€ System Design helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderInlineMarkdown(text: string): React.ReactNode {
    const parts: (string | React.ReactNode)[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let lastIndex = 0; let match; let key = 0;
    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
        parts.push(<strong key={`b-${key++}`} className="text-slate-900 dark:text-white font-semibold">{match[1]}</strong>);
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
}

interface ParsedStatement { intro: string; sections: { title: string; items: string[] }[] }

function parseProblemStatement(raw: string): ParsedStatement {
    const text = (raw || "").replace(/\r\n/g, "\n");
    const headingRe = /\*\*(Functional Requirements|Non-Functional Requirements|Scale)\s*:?\s*\*\*/gi;
    const matches: { title: string; index: number; matchLength: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(text)) !== null) matches.push({ title: m[1], index: m.index, matchLength: m[0].length });
    if (!matches.length) return { intro: text.trim(), sections: [] };
    const intro = text.slice(0, matches[0].index).trim();
    const sections = matches.map((mt, i) => {
        const start = mt.index + mt.matchLength;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const body = text.slice(start, end);
        const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
        const bullets = lines
            .map((l) => l.replace(/^(?:[-*\u2022]|\u00e2\u20ac\u00a2)\s+/, "").replace(/^\d+[.)]\s+/, ""))
            .filter(Boolean);
        return { title: mt.title, items: bullets };
    });
    return { intro, sections };
}

// â”€â”€ Reusable tab button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} className={`px-4 py-2 text-sm font-medium ${active ? "text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"}`}>
            {label}
        </button>
    );
}

// â”€â”€ Separator (shared) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function HSep() {
    return (
        <Separator className="relative w-1.5 bg-slate-200 dark:bg-[#3e3e3e] hover:bg-teal-500 dark:hover:bg-teal-500 transition-colors group cursor-col-resize flex items-center justify-center">
            <div className="w-0.5 h-6 bg-slate-400 dark:bg-slate-500 rounded-full group-hover:bg-teal-400 transition-colors" />
        </Separator>
    );
}

function VSep() {
    return (
        <Separator className="relative h-1.5 bg-slate-200 dark:bg-[#3e3e3e] hover:bg-teal-500 dark:hover:bg-teal-500 transition-colors group cursor-row-resize flex items-center justify-center">
            <div className="h-0.5 w-6 bg-slate-400 dark:bg-slate-500 rounded-full group-hover:bg-teal-400 transition-colors" />
        </Separator>
    );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DSA PREVIEW â€” copied from web dsa/solve/page.tsx
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function DSAPreview({ q, backHref, isDark, onBack }: { q: QuestionPayload; backHref: string; isDark: boolean; onBack?: () => void }) {
    const starterCodeMap = normalizeStarterCode(q);
    const sampleTests = normalizeSampleTests(q);

    const defaultLang = getDefaultLanguage(starterCodeMap, "cpp");
    const [language, setLanguage] = useState(defaultLang);
    const [code, setCode] = useState(getStarterCodeForLanguage(starterCodeMap, defaultLang) || "// Loading...");
    const [activeTab, setActiveTab] = useState<"description" | "solution" | "submissions">("description");
    const [testPanelTab, setTestPanelTab] = useState<"testcase" | "result">("testcase");
    const [activeTestCaseIndex, setActiveTestCaseIndex] = useState(0);
    const { session } = useCompanyAuth();
    const [tests] = useState<any[]>(sampleTests);
    const [results, setResults] = useState<Record<string, any>>({});
    const [isRunning, setIsRunning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasTestRun, setHasTestRun] = useState(false);
    const [submissionResult, setSubmissionResult] = useState<{
        status: "accepted" | "wrong_answer" | "error" | "compile_error";
        message: string;
        errorDetails?: string;
        samplePassed?: number;
        sampleTotal?: number;
        hiddenPassed?: number;
        hiddenTotal?: number;
        hiddenFirstFailed?: {
            status?: string;
            input?: string;
            expectedOutput?: string;
            actualOutput?: string;
            stderr?: string;
            compileOutput?: string;
        };
    } | null>(null);
    const [isTopicsExpanded, setIsTopicsExpanded] = useState(false);
    const [isHintsExpanded, setIsHintsExpanded] = useState(false);
    const [expandedSolution, setExpandedSolution] = useState<string | null>(null);
    const [selectedLanguage, setSelectedLanguage] = useState<Record<string, string>>({});
    const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
    const [copiedCodeSection, setCopiedCodeSection] = useState<"bruteForce" | "optimized" | null>(null);
    const languageMenuRef = useRef<HTMLDivElement | null>(null);
    const mainEditorRef = useRef<any>(null);
    const lastLoadedFingerprintRef = useRef<string | null>(null);
    const editorTheme = isDark ? "vs-dark" : "light";

    // Strip Examples/Constraints sections from description â€” those are rendered as separate blocks below
    const statement = extractProblemStatement(q.statement || q.description || q.problemStatement || "");
    const difficulty = q.difficulty || "";
    const constraints = typeof q.constraints === "string" ? q.constraints : Array.isArray(q.constraints) ? q.constraints.join("\n") : "";
    const examples = q.examples || [];
    const hints = q.hints || [];
    const topics = q.topics || [];
    const companyTags = q.companyTags || [];
    const solution = q.solution || null;

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (languageMenuRef.current && !languageMenuRef.current.contains(e.target as Node))
                setIsLanguageMenuOpen(false);
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    // Sync editor content when code/language changes (copied from web dsa/solve/page.tsx)
    useEffect(() => {
        const fingerprint = `${language}`;
        if (mainEditorRef.current && fingerprint !== lastLoadedFingerprintRef.current) {
            lastLoadedFingerprintRef.current = fingerprint;
            const model = mainEditorRef.current.getModel();
            if (model && model.getValue() !== code) {
                mainEditorRef.current.setValue(code);
            }
        }
    }, [code, language]);

    // Re-apply Monaco language tokenization when language changes
    useEffect(() => {
        if (!mainEditorRef.current) return;
        import("monaco-editor").then((monaco) => {
            const model = mainEditorRef.current?.getModel();
            const monacoLang = LANGUAGE_MAP[language]?.monacoId || language;
            if (model) monaco.editor.setModelLanguage(model, monacoLang);
        });
    }, [language]);

    function handleLanguageChange(lang: string) {
        setLanguage(lang);
        setCode(getStarterCodeForLanguage(starterCodeMap, lang) || DEFAULT_DSA_CODE);
        setIsLanguageMenuOpen(false);
    }

    const runAllTests = async (mode: "run" | "submit" = "run") => {
        if (!q || tests.length === 0) return;
        const isSubmit = mode === "submit";
        setHasTestRun(true);
        setSubmissionResult(null);
        setTestPanelTab("result");
        setIsRunning(!isSubmit);
        setIsSubmitting(isSubmit);
        setResults((prev) => {
            const next = { ...prev };
            tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Running" }));
            return next;
        });
        try {
            const token = session?.access_token;
            const data = await api.post<any>(
                `/companies/question-bank/dsa/${q.id}/run-preview`,
                {
                    code,
                    language,
                    language_id: JUDGE0_LANGUAGE_IDS[language?.toLowerCase() ?? language],
                    mode,
                },
                token
            );

            if (!data.success && data.compileOutput) {
                setSubmissionResult({ status: "compile_error", message: "Compilation Error", errorDetails: data.compileOutput });
                setResults((prev) => {
                    const next = { ...prev };
                    tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Pending" }));
                    return next;
                });
                return;
            }
            if (!data.success || data.error) throw new Error(data.error || "Code execution failed.");

            if (data.success && data.sample?.tests) {
                const map: Record<string, any> = {};
                data.sample.tests.forEach((test: any, idx: number) => {
                    const id = getTestResultKey(tests[idx], idx);
                    map[id] = {
                        status: test.passed ? "Accepted" : "Wrong Answer",
                        input: test.input,
                        expected: test.expectedOutput,
                        actual: test.actualOutput,
                        passed: test.passed,
                        runtime: test.time,
                        memory: test.memory,
                    };
                });
                setResults(map);

                const sampleSummary = data.sample?.summary;
                const hiddenSummary = data.hidden?.summary;
                const samplePassed = Number(sampleSummary?.passed ?? data.sample.tests.filter((test: any) => test.passed).length);
                const sampleTotal = Number(sampleSummary?.total ?? data.sample.tests.length);
                const hiddenPassed = hiddenSummary ? Number(hiddenSummary.passed ?? 0) : undefined;
                const hiddenTotal = hiddenSummary ? Number(hiddenSummary.total ?? 0) : undefined;
                const allVisiblePassed = sampleTotal > 0 && samplePassed === sampleTotal;
                const allHiddenPassed = !hiddenSummary || hiddenPassed === hiddenTotal;

                if (isSubmit) {
                    const accepted = allVisiblePassed && allHiddenPassed;
                    setSubmissionResult({
                        status: accepted ? "accepted" : "wrong_answer",
                        message: accepted
                            ? "All preview tests passed. Nothing was saved."
                            : "Some preview tests failed. Nothing was saved.",
                        samplePassed,
                        sampleTotal,
                        hiddenPassed,
                        hiddenTotal,
                        hiddenFirstFailed: data.hidden?.firstFailed,
                    });
                }
            } else {
                throw new Error("Unexpected response format");
            }
        } catch (err: any) {
            setSubmissionResult({ status: "error", message: "Failed to run code", errorDetails: err.message });
            setResults((prev) => {
                const next = { ...prev };
                tests.forEach((t, idx) => (next[getTestResultKey(t, idx)] = { status: "Pending" }));
                return next;
            });
        } finally {
            setIsRunning(false);
            setIsSubmitting(false);
        }
    };

    function handleCopyCode(c: string, section: "bruteForce" | "optimized") {
        navigator.clipboard.writeText(c);
        setCopiedCodeSection(section);
        setTimeout(() => setCopiedCodeSection(null), 2000);
    }

    return (
        <main className="h-[calc(100vh-74px)] overflow-hidden bg-[#FAFBFC] dark:bg-lc-bg">
            <Group orientation="horizontal" className="h-full">
                {/* Left Panel */}
                <Panel defaultSize={40} minSize={25}>
                    <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <header className="flex items-center gap-3 px-4 py-3">
                                    <PreviewBackButton backHref={backHref} onBack={onBack} />
                                    <div className="min-w-0 truncate font-nunito text-[18px] font-bold text-slate-800 dark:text-white">
                                        {q.title || "Question"}
                                    </div>
                                </header>
                            </div>
                        </div>

                        {/* Tab bar */}
                        <div className="flex items-center bg-slate-100 dark:bg-[#333333]">
                            <TabBtn label="Description" active={activeTab === "description"} onClick={() => setActiveTab("description")} />
                            <TabBtn label="Solution" active={activeTab === "solution"} onClick={() => setActiveTab("solution")} />
                            <TabBtn label="Submissions" active={activeTab === "submissions"} onClick={() => setActiveTab("submissions")} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-auto p-6">
                            {/* Difficulty badge */}
                            <div className="mb-4 flex items-center gap-3">
                                {difficulty && (
                                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${difficulty === "Easy" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : difficulty === "Medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                                        {difficulty}
                                    </span>
                                )}
                            </div>

                            {activeTab === "description" && (
                                <div className="prose dark:prose-invert max-w-none">
                                    {/* description from company API is markdown, not HTML â€” use ReactMarkdown */}
                                    <div className="text-slate-700 dark:text-slate-100 leading-relaxed">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                            {statement}
                                        </ReactMarkdown>
                                    </div>

                                    {(() => {
                                        const cards = examples
                                            .map((ex: any, idx: number) => {
                                                // example_text format: parse markdown to extract structured fields
                                                if (ex?.example_text) {
                                                    const rawText = String(ex.example_text).trim();
                                                    const parsed = parseExampleText(String(ex.example_text));
                                                    if (!parsed.inputStr && !parsed.outputStr && !parsed.explanation) {
                                                        return { idx, rawText, inputStr: null, outputStr: null, explanation: null };
                                                    }
                                                    return { idx, rawText: null, ...parsed };
                                                }
                                                const rawInput = ex?.input ?? ex?.stdin;
                                                const rawOutput = ex?.output ?? ex?.expected_output ?? ex?.expectedOutput;
                                                const inputStr = rawInput != null
                                                    ? (typeof rawInput === "string" ? rawInput : formatValue(rawInput))
                                                    : null;
                                                const outputStr = rawOutput != null
                                                    ? (typeof rawOutput === "string" ? rawOutput : formatValue(rawOutput))
                                                    : null;
                                                if (!inputStr && !outputStr) return null;
                                                return { idx, rawText: null, inputStr, outputStr, explanation: ex?.explanation ?? null };
                                            })
                                            .filter(Boolean) as { idx: number; rawText: string | null; inputStr: string | null; outputStr: string | null; explanation: string | null }[];

                                        if (!cards.length) return null;
                                        return (
                                            <div className="mt-8">
                                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Examples</h3>
                                                {cards.map((c) => (
                                                    <div key={c.idx} className="mb-6 p-4 bg-slate-50 dark:bg-[#1c160d] rounded-lg">
                                                        <div className="font-semibold text-slate-900 dark:text-white mb-3">Example {c.idx + 1}:</div>
                                                        {c.rawText && (
                                                            <pre className="whitespace-pre-wrap rounded bg-white p-3 text-sm leading-6 text-slate-700 dark:bg-[#282828] dark:text-slate-100">
                                                                {c.rawText}
                                                            </pre>
                                                        )}
                                                        {c.inputStr && <div className="mb-3"><div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Input:</div><div className="p-3 bg-white dark:bg-[#282828] rounded"><code className="text-sm text-slate-700 dark:text-slate-100 whitespace-pre-wrap break-words">{c.inputStr}</code></div></div>}
                                                        {c.outputStr && <div className="mb-3"><div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Output:</div><div className="p-3 bg-white dark:bg-[#282828] rounded"><code className="text-sm text-slate-700 dark:text-slate-100 whitespace-pre-wrap break-words">{c.outputStr}</code></div></div>}
                                                        {c.explanation && <div><div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Explanation:</div><p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{c.explanation}</p></div>}
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}

                                    {constraints && (
                                        <div className="mt-8">
                                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Constraints</h3>
                                            <div className="max-w-full min-w-0 overflow-hidden p-4 bg-slate-50 dark:bg-[#1c160d] rounded-lg">
                                                <ul className="max-w-full min-w-0 list-disc list-inside space-y-2 text-sm text-slate-700 dark:text-slate-100">
                                                    {constraints.split("\n").map((c: string, i: number) => c.trim() && (
                                                        <li key={i} className="max-w-full min-w-0 leading-relaxed break-all [overflow-wrap:anywhere]">
                                                            <code className="max-w-full whitespace-pre-wrap break-all [overflow-wrap:anywhere] text-xs bg-white dark:bg-[#282828] px-2 py-0.5 rounded">{c.trim()}</code>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    )}

                                    {hints.length > 0 && (
                                        <div className="mt-8">
                                            <button type="button" onClick={() => setIsHintsExpanded((p) => !p)} className="w-full flex items-center justify-between text-left">
                                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Hints</h3>
                                                <span className="material-symbols-outlined text-[20px] text-slate-600 dark:text-slate-300">{isHintsExpanded ? "expand_less" : "expand_more"}</span>
                                            </button>
                                            {isHintsExpanded && (
                                                <div className="space-y-3 mt-3">
                                                    {hints.map((hint: string, i: number) => (
                                                        <div key={i} className="p-4 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800/30 rounded-lg">
                                                            <div className="flex items-start gap-3">
                                                                <span className="material-symbols-outlined text-yellow-600 dark:text-yellow-500 text-[20px] mt-0.5">lightbulb</span>
                                                                <div className="flex-1">
                                                                    <div className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-1">Hint {i + 1}</div>
                                                                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{hint}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {topics.length > 0 && (
                                        <div className="mt-8">
                                            <button type="button" onClick={() => setIsTopicsExpanded((p) => !p)} className="w-full flex items-center justify-between text-left">
                                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Topics</h3>
                                                <span className="material-symbols-outlined text-[20px] text-slate-600 dark:text-slate-300">{isTopicsExpanded ? "expand_less" : "expand_more"}</span>
                                            </button>
                                            {isTopicsExpanded && (
                                                <div className="flex flex-wrap gap-2 mt-3">
                                                    {topics.map((t: string, i: number) => <span key={i} className="px-3 py-1 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-full text-sm">{t}</span>)}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {companyTags.length > 0 && (
                                        <div className="mt-8">
                                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">Companies</h3>
                                            <div className="flex flex-wrap gap-2">
                                                {companyTags.map((c: string, i: number) => <span key={i} className="px-3 py-1 bg-slate-100 dark:bg-[#333333] text-slate-700 dark:text-slate-300 rounded-full text-sm">{c}</span>)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === "solution" && (
                                <div className="space-y-4">
                                    {solution ? (
                                        <>
                                            {solution.bruteForce && (
                                                <div className="rounded-3xl overflow-hidden bg-slate-50 dark:bg-[#1a1a1a]">
                                                    <button onClick={() => setExpandedSolution(expandedSolution === "bruteForce" ? null : "bruteForce")} className="w-full bg-slate-100 dark:bg-[#222222] px-4 py-3 flex items-center justify-between hover:bg-slate-200 dark:hover:bg-[#2a2a2a] transition-colors">
                                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Brute Force</h3>
                                                        <svg className={`w-5 h-5 text-slate-600 dark:text-slate-400 transition-transform ${expandedSolution === "bruteForce" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                    </button>
                                                    {expandedSolution === "bruteForce" && (
                                                        <div className="p-4 space-y-4 bg-white dark:bg-[#282828]">
                                                            {(() => {
                                                                const txt = cleanExplainationText(solution.bruteForce.explaination || solution.bruteForce.description || solution.bruteForce.explanation);
                                                                if (!txt) return null;
                                                                return <div><h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Explanation</h4><p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{txt}</p></div>;
                                                            })()}
                                                            {(() => {
                                                                const t = normalizeComplexityValue(solution.bruteForce.timeComplexity);
                                                                const s = normalizeComplexityValue(solution.bruteForce.spaceComplexity);
                                                                if (!t && !s) return null;
                                                                return (
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                        {t && <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#222222]"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Time Complexity</h4><p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{t}</p></div>}
                                                                        {s && <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#222222]"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Space Complexity</h4><p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{s}</p></div>}
                                                                    </div>
                                                                );
                                                            })()}
                                                            {solution.bruteForce.code && Object.keys(solution.bruteForce.code).length > 0 && (() => {
                                                                const langs = getCodeLanguages(solution.bruteForce.code);
                                                                if (!langs.length) return null;
                                                                const selLang = selectedLanguage.bruteForce || langs[0];
                                                                const bruteCode = solution.bruteForce.code[selLang] || "";
                                                                return (
                                                                    <div>
                                                                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Code</h4>
                                                                        <div className="overflow-x-auto mb-3 border-b border-slate-200 dark:border-[#3e3e3e]">
                                                                            <div className="flex gap-2 min-w-max">
                                                                                {langs.map((l) => <button key={l} onClick={() => setSelectedLanguage({ ...selectedLanguage, bruteForce: l })} className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${selLang === l ? "text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"}`}>{l.charAt(0).toUpperCase() + l.slice(1)}</button>)}
                                                                            </div>
                                                                        </div>
                                                                        <div className="relative group">
                                                                            <button onClick={() => handleCopyCode(bruteCode, "bruteForce")} className="absolute top-3 right-3 z-10 p-1.5 rounded-md bg-transparent hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-all flex items-center justify-center opacity-70 hover:opacity-100">
                                                                                {copiedCodeSection === "bruteForce" ? <span className="material-symbols-outlined text-[12px] text-emerald-500">check</span> : <span className="material-symbols-outlined text-[12px]">content_copy</span>}
                                                                            </button>
                                                                            <div className="rounded-xl overflow-hidden bg-[#ebebeb] dark:bg-[#1e1e1e]" style={{ height: `${Math.max(120, bruteCode.split("\n").length * 21 + 32)}px` }}>
                                                                                <Editor key={`brute-${selLang}`} height="100%" theme={editorTheme} defaultLanguage={LANGUAGE_MAP[selLang]?.monacoId || selLang} value={bruteCode} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 14, lineNumbers: "off", scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16, bottom: 16 }, renderLineHighlight: "none", scrollbar: { vertical: "hidden", horizontal: "hidden" } }} />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {solution.optimized && (
                                                <div className="rounded-3xl overflow-hidden bg-slate-50 dark:bg-[#1a1a1a]">
                                                    <button onClick={() => setExpandedSolution(expandedSolution === "optimized" ? null : "optimized")} className="w-full bg-slate-100 dark:bg-[#222222] px-4 py-3 flex items-center justify-between hover:bg-slate-200 dark:hover:bg-[#2a2a2a] transition-colors">
                                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Optimal Approach</h3>
                                                        <svg className={`w-5 h-5 text-slate-600 dark:text-slate-400 transition-transform ${expandedSolution === "optimized" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                    </button>
                                                    {expandedSolution === "optimized" && (
                                                        <div className="p-4 space-y-4 bg-white dark:bg-[#282828]">
                                                            {(() => {
                                                                const txt = cleanExplainationText(solution.optimized.explaination || solution.optimized.description || solution.optimized.explanation);
                                                                if (!txt) return null;
                                                                return <div><h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Explanation</h4><p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{txt}</p></div>;
                                                            })()}
                                                            {(() => {
                                                                const t = normalizeComplexityValue(solution.optimized.timeComplexity);
                                                                const s = normalizeComplexityValue(solution.optimized.spaceComplexity);
                                                                if (!t && !s) return null;
                                                                return (
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                        {t && <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#222222]"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Time Complexity</h4><p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{t}</p></div>}
                                                                        {s && <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#222222]"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Space Complexity</h4><p className="text-sm text-slate-700 dark:text-slate-300 font-mono">{s}</p></div>}
                                                                    </div>
                                                                );
                                                            })()}
                                                            {solution.optimized.code && Object.keys(solution.optimized.code).length > 0 && (() => {
                                                                const langs = getCodeLanguages(solution.optimized.code);
                                                                if (!langs.length) return null;
                                                                const selLang = selectedLanguage.optimized || langs[0];
                                                                const optCode = solution.optimized.code[selLang] || "";
                                                                return (
                                                                    <div>
                                                                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Code</h4>
                                                                        <div className="overflow-x-auto mb-3 border-b border-slate-200 dark:border-[#3e3e3e]">
                                                                            <div className="flex gap-2 min-w-max">
                                                                                {langs.map((l) => <button key={l} onClick={() => setSelectedLanguage({ ...selectedLanguage, optimized: l })} className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${selLang === l ? "text-teal-600 dark:text-teal-400 border-b-2 border-teal-600 dark:border-teal-400" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"}`}>{l.charAt(0).toUpperCase() + l.slice(1)}</button>)}
                                                                            </div>
                                                                        </div>
                                                                        <div className="relative group">
                                                                            <button onClick={() => handleCopyCode(optCode, "optimized")} className="absolute top-3 right-3 z-10 p-1.5 rounded-md bg-transparent hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-all flex items-center justify-center opacity-70 hover:opacity-100">
                                                                                {copiedCodeSection === "optimized" ? <span className="material-symbols-outlined text-[12px] text-emerald-500">check</span> : <span className="material-symbols-outlined text-[12px]">content_copy</span>}
                                                                            </button>
                                                                            <div className="rounded-xl overflow-hidden bg-[#ebebeb] dark:bg-[#1e1e1e]" style={{ height: `${Math.max(120, optCode.split("\n").length * 21 + 32)}px` }}>
                                                                                <Editor key={`opt-${selLang}`} height="100%" theme={editorTheme} defaultLanguage={LANGUAGE_MAP[selLang]?.monacoId || selLang} value={optCode} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 14, lineNumbers: "off", scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16, bottom: 16 }, renderLineHighlight: "none", scrollbar: { vertical: "hidden", horizontal: "hidden" } }} />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="text-center py-12">
                                            <p className="text-lg text-slate-600 dark:text-slate-400">Solution not available yet</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === "submissions" && (
                                <div className="grid min-h-[280px] place-items-center rounded-xl bg-slate-50 text-center dark:bg-[#1f1f1f]">
                                    <div>
                                        <span className="material-symbols-outlined text-4xl text-blue-400">history</span>
                                        <p className="mt-3 text-[16px] font-extrabold text-slate-900 dark:text-white">Company preview</p>
                                        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Submission history is available on the candidate side.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </Panel>

                <HSep />

                {/* Right Panel */}
                <Panel defaultSize={60} minSize={30}>
                    <Group orientation="vertical" className="h-full">
                        <Panel defaultSize={55} minSize={20}>
                            <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                                <div className="p-4 flex items-center justify-between bg-slate-50 dark:bg-[#242424]">
                                    <div ref={languageMenuRef} className="relative">
                                        <button type="button" onClick={() => setIsLanguageMenuOpen((p) => !p)} className="flex items-center h-8 gap-2 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-[#333333] dark:hover:bg-[#3e3e3e] px-4 text-sm font-medium text-slate-700 dark:text-slate-300 transition-all">
                                            <span>{LANGUAGE_MAP[language]?.label || language.toUpperCase()}</span>
                                            <span className="material-symbols-outlined text-[16px] leading-none text-slate-500 dark:text-slate-300">{isLanguageMenuOpen ? "expand_less" : "expand_more"}</span>
                                        </button>
                                        {isLanguageMenuOpen && (
                                            <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 min-w-[180px] overflow-hidden rounded-2xl border border-slate-200 dark:border-lc-border bg-white/95 dark:bg-lc-surface/95 backdrop-blur-md shadow-lg">
                                                {Object.keys(starterCodeMap).map((lang) => (
                                                    <button key={lang} type="button" onClick={() => handleLanguageChange(lang)} className={`w-full px-4 py-2.5 text-left text-[12px] font-semibold transition-colors ${lang === language ? "bg-primary/10 text-primary" : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-lc-hover"}`}>
                                                        {LANGUAGE_MAP[lang]?.label || lang.toUpperCase()}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => void runAllTests("run")} disabled={isRunning || isSubmitting} className="px-4 h-8 flex items-center justify-center bg-slate-600 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full text-sm font-medium">
                                            {isRunning ? "Running..." : "Run Tests"}
                                        </button>
                                        <button onClick={() => void runAllTests("submit")} disabled={isRunning || isSubmitting} className="px-4 h-8 flex items-center justify-center bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full text-sm font-medium">
                                            {isSubmitting ? "Submitting..." : "Submit"}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <Editor
                                        onMount={(editor, monaco) => {
                                            mainEditorRef.current = editor;
                                            const model = editor.getModel();
                                            const ml = LANGUAGE_MAP[language]?.monacoId || language;
                                            if (model) monaco.editor.setModelLanguage(model, ml);
                                        }}
                                        height="100%"
                                        language={LANGUAGE_MAP[language]?.monacoId || language}
                                        theme={editorTheme}
                                        defaultValue={code}
                                        onChange={(v) => setCode(v || "")}
                                        options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: "on", scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16 }, renderLineHighlight: "none", guides: { indentation: false } }}
                                    />
                                </div>
                            </div>
                        </Panel>

                        <VSep />

                        <Panel defaultSize={45} minSize={20}>
                            <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] overflow-hidden">
                                <div className="flex bg-slate-50 dark:bg-[#282828] px-4 pt-2 gap-2 items-end">
                                    <button onClick={() => setTestPanelTab("testcase")} className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${testPanelTab === "testcase" ? "bg-white dark:bg-[#1e1e1e] text-green-600 dark:text-green-500" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}>
                                        <span className="material-symbols-outlined text-[16px]">task_alt</span>Testcase
                                    </button>
                                    <div className="h-5 w-px bg-slate-300 dark:bg-[#444] mb-2.5 mx-1 rounded-full" />
                                    <button onClick={() => setTestPanelTab("result")} className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${testPanelTab === "result" ? "bg-white dark:bg-[#1e1e1e] text-slate-800 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}>
                                        <span className="material-symbols-outlined text-[16px]">terminal</span>Test Result
                                    </button>
                                </div>
                                <div className="p-4 overflow-auto flex-1 bg-white dark:bg-[#1e1e1e]">
                                    {tests.length === 0 ? (
                                        <div className="text-slate-500 text-center py-4">No test cases available</div>
                                    ) : (
                                        <>
                                            {/* Result header */}
                                            {testPanelTab === "result" && hasTestRun && (
                                                <div className="mb-4 flex items-baseline gap-4">
                                                    <h2 className={`text-2xl font-semibold ${
                                                        isRunning || isSubmitting ? "text-blue-500" :
                                                        submissionResult?.status === "compile_error" || submissionResult?.status === "error" || submissionResult?.status === "wrong_answer" ? "text-red-500" :
                                                        submissionResult?.status === "accepted" ? "text-green-500" :
                                                        Object.values(results).some(r => r.status === "Wrong Answer") ? "text-red-500" :
                                                        Object.values(results).every(r => r.status === "Accepted") ? "text-green-500" :
                                                        "text-slate-500"
                                                    }`}>
                                                        {isRunning || isSubmitting ? "Running..." :
                                                         submissionResult?.status === "compile_error" ? "Compile Error" :
                                                         submissionResult?.status === "error" ? "Error" :
                                                         submissionResult?.status === "accepted" ? "Accepted" :
                                                         submissionResult?.status === "wrong_answer" ? "Wrong Answer" :
                                                         Object.values(results).every(r => r.status === "Accepted") && Object.keys(results).length > 0 ? "Accepted" :
                                                         Object.keys(results).length > 0 ? "Wrong Answer" : "Ready"}
                                                    </h2>
                                                </div>
                                            )}

                                            {/* Compile / runtime error */}
                                            {testPanelTab === "result" && submissionResult && (submissionResult.status === "compile_error" || submissionResult.status === "error") && (
                                                <div className="mb-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                                    <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">{submissionResult.message}</p>
                                                    {submissionResult.errorDetails && (
                                                        <pre className="text-xs font-mono text-red-800 dark:text-red-200 whitespace-pre-wrap overflow-x-auto">{submissionResult.errorDetails}</pre>
                                                    )}
                                                </div>
                                            )}

                                            {testPanelTab === "result" && submissionResult && (submissionResult.status === "accepted" || submissionResult.status === "wrong_answer") && (
                                                <div className={`mb-4 rounded-lg border p-4 ${
                                                    submissionResult.status === "accepted"
                                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200"
                                                        : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200"
                                                }`}>
                                                    <p className="text-sm font-semibold">{submissionResult.message}</p>
                                                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                                                        {submissionResult.sampleTotal !== undefined && (
                                                            <span className="rounded-full bg-white/70 px-3 py-1 dark:bg-black/20">
                                                                Samples {submissionResult.samplePassed}/{submissionResult.sampleTotal}
                                                            </span>
                                                        )}
                                                        {submissionResult.hiddenTotal !== undefined && (
                                                            <span className="rounded-full bg-white/70 px-3 py-1 dark:bg-black/20">
                                                                Hidden {submissionResult.hiddenPassed}/{submissionResult.hiddenTotal}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {submissionResult.hiddenFirstFailed && (
                                                        <div className="mt-3 rounded-lg bg-white/70 p-3 text-xs dark:bg-black/20">
                                                            <p className="mb-2 font-bold">First hidden failure: {submissionResult.hiddenFirstFailed.status || "Failed"}</p>
                                                            <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono">
                                                                {submissionResult.hiddenFirstFailed.actualOutput || submissionResult.hiddenFirstFailed.stderr || submissionResult.hiddenFirstFailed.compileOutput || "(no output)"}
                                                            </pre>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Case pills */}
                                            <div className="flex flex-wrap gap-2 mb-4">
                                                {tests.slice(0, 5).map((t, i) => {
                                                    const res = results[getTestResultKey(t, i)];
                                                    const isPass = res?.status === "Accepted";
                                                    const isFail = res?.status === "Wrong Answer" || res?.status?.toLowerCase().includes("error");
                                                    const isActive = activeTestCaseIndex === i;
                                                    return (
                                                        <button key={i} onClick={() => setActiveTestCaseIndex(i)}
                                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-slate-200 dark:bg-[#333] text-slate-900 dark:text-white shadow-sm" : "bg-slate-50 dark:bg-[#282828] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#333]"}`}>
                                                            {testPanelTab === "result" && isPass && <span className="flex items-center justify-center h-4 w-4 rounded-sm bg-green-500 text-white"><span className="material-symbols-outlined text-[12px]">check</span></span>}
                                                            {testPanelTab === "result" && isFail && <span className="flex items-center justify-center h-4 w-4 rounded-sm bg-red-500 text-white"><span className="material-symbols-outlined text-[12px]">close</span></span>}
                                                            Case {i + 1}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* Active case detail */}
                                            {(() => {
                                                const t = tests[activeTestCaseIndex];
                                                if (!t) return null;
                                                const res = results[getTestResultKey(t, activeTestCaseIndex)];
                                                const inputStr = formatTestData(t.stdin ?? t.input);
                                                const expectedStr = formatTestData(t.expected_output ?? t.expectedOutput ?? t.output);
                                                const isFinished = res?.status && res.status !== "Pending" && res.status !== "Running";
                                                return (
                                                    <div className="space-y-4">
                                                        <div>
                                                            <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Input</div>
                                                            <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#282828]">
                                                                <code className="font-mono text-sm whitespace-pre-wrap break-words block text-slate-700 dark:text-slate-300">{inputStr}</code>
                                                            </div>
                                                        </div>
                                                        {testPanelTab === "testcase" && expectedStr && (
                                                            <div>
                                                                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Expected Output</div>
                                                                <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#282828]">
                                                                    <code className="font-mono text-sm whitespace-pre-wrap break-words block text-slate-700 dark:text-slate-300">{expectedStr}</code>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {testPanelTab === "result" && isFinished && (
                                                            <>
                                                                <div>
                                                                    <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Your Output</div>
                                                                    <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#282828]">
                                                                        <code className="font-mono text-sm whitespace-pre-wrap break-words block text-slate-700 dark:text-slate-300">{res.actual ?? "(no output)"}</code>
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Expected</div>
                                                                    <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#282828]">
                                                                        <code className="font-mono text-sm whitespace-pre-wrap break-words block text-slate-700 dark:text-slate-300">{res.expected ?? expectedStr}</code>
                                                                    </div>
                                                                </div>
                                                                {res.runtime && <div className="text-xs text-slate-400">Runtime: {res.runtime} ms</div>}
                                                            </>
                                                        )}
                                                        {testPanelTab === "result" && res?.status === "Running" && (
                                                            <div className="text-sm text-blue-500 animate-pulse">Running...</div>
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
        </main>
    );
}

const DEFAULT_DSA_CODE = "class Solution {\npublic:\n    // write your solution here\n};\n";

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SQL PREVIEW â€” copied from web sql/solve/page.tsx
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SQLPreview({ q, backHref, isDark, onBack }: { q: QuestionPayload; backHref: string; isDark: boolean; onBack?: () => void }) {
    const [code, setCode] = useState("-- Write your SQL query here\nSELECT * FROM employee;");
    const [activeTab, setActiveTab] = useState<"description" | "solution" | "submissions">("description");
    const [testPanelTab, setTestPanelTab] = useState<"testcase" | "result">("testcase");
    const [isRunning, setIsRunning] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    const [sqlResults, setSqlResults] = useState<any[]>([]);
    const { session } = useCompanyAuth();
    const mainEditorRef = useRef<any>(null);

    async function handleRun() {
        if (!q.id) return;
        setTestPanelTab("result");
        setIsRunning(true);
        setRunError(null);
        setSqlResults([]);
        try {
            const payload = await api.post<any>(
                `/companies/question-bank/sql/${q.id}/run-preview`,
                { code, language: "sql", mode: "run" },
                session?.access_token
            );
            if (!payload.success) throw new Error(payload.error || "SQL execution failed.");
            setSqlResults(Array.isArray(payload.results) ? payload.results : []);
        } catch (err: any) {
            setRunError(err instanceof ApiError ? err.message : err.message || "SQL execution failed.");
        } finally {
            setIsRunning(false);
        }
    }

    return (
        <main className="h-[calc(100vh-74px)] overflow-hidden bg-[#FAFBFC] dark:bg-lc-bg">
            <Group orientation="horizontal" className="h-full">
                <Panel defaultSize={40} minSize={25}>
                    <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                        <div className="p-1">
                            <div className="flex items-center justify-between pr-4">
                                <div className="flex items-center">
                                    <header className="flex items-center gap-3 px-4 py-3">
                                        <PreviewBackButton backHref={backHref} onBack={onBack} />
                                        <div className="min-w-0 truncate font-nunito text-[18px] font-bold text-slate-800 dark:text-white">{q.title || "Question"}</div>
                                    </header>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center bg-slate-100 dark:bg-[#333333]">
                            <TabBtn label="Description" active={activeTab === "description"} onClick={() => setActiveTab("description")} />
                            <TabBtn label="Solution" active={activeTab === "solution"} onClick={() => setActiveTab("solution")} />
                            <TabBtn label="Submissions" active={activeTab === "submissions"} onClick={() => setActiveTab("submissions")} />
                        </div>
                        <div className="flex-1 overflow-y-auto p-6">
                            {activeTab === "description" ? (
                                <div className="prose dark:prose-invert max-w-none">
                                    <div className="mb-4 flex items-center gap-3">
                                        {q.difficulty && (
                                            <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${q.difficulty === "Easy" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : q.difficulty === "Medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>{q.difficulty}</span>
                                        )}
                                    </div>
                                    <h3>Description</h3>
                                    <div className="whitespace-pre-wrap dark:text-slate-300">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                            {q.description || q.statement || ""}
                                        </ReactMarkdown>
                                    </div>
                                    {q.schema && (
                                        <>
                                            <h3 className="mt-8 text-lg font-semibold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">Database Schema</h3>
                                            <div className="bg-slate-50 dark:bg-[#1c160d] p-4 rounded space-y-4 mt-4">
                                                <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{q.schema}</pre>
                                            </div>
                                        </>
                                    )}
                                    {q.examples && q.examples.length > 0 && (
                                        <>
                                            <h3>Example</h3>
                                            <div className="bg-slate-50 dark:bg-[#1c160d] p-4 rounded space-y-4">
                                                <DataTable data={q.examples[0].input} titleNode={<p className="font-semibold text-slate-700 dark:text-slate-300">Input</p>} />
                                                <DataTable data={q.examples[0].output} titleNode={<p className="font-semibold text-slate-700 dark:text-slate-300">Output</p>} />
                                                {q.examples[0].explanation && <><p className="font-semibold mt-4 mb-2">Explanation:</p><p className="text-sm">{q.examples[0].explanation}</p></>}
                                            </div>
                                        </>
                                    )}
                                </div>
                            ) : activeTab === "solution" ? (
                                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                                    <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600 mb-4">construction</span>
                                    <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">Coming Soon</h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">Solutions for SQL questions will be available soon.</p>
                                </div>
                            ) : (
                                <div className="grid min-h-[280px] place-items-center rounded-xl bg-slate-50 text-center dark:bg-[#1f1f1f]">
                                    <div>
                                        <span className="material-symbols-outlined text-4xl text-blue-400">history</span>
                                        <p className="mt-3 text-[16px] font-extrabold text-slate-900 dark:text-white">Company preview</p>
                                        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Submission history is available on the candidate side.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </Panel>

                <HSep />

                <Panel defaultSize={60} minSize={30}>
                    <Group orientation="vertical" className="h-full">
                        <Panel defaultSize={60} minSize={30}>
                            <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                                <div className="px-4 h-12 flex items-center justify-between bg-slate-50 dark:bg-[#242424]">
                                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300">SQL Editor</div>
                                    <button onClick={() => void handleRun()} disabled={isRunning} className="px-4 h-8 flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full text-sm font-medium shadow-sm transition-all">
                                        {isRunning ? "Running..." : "Run Query"}
                                    </button>
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <Editor
                                        onMount={(editor) => { mainEditorRef.current = editor; }}
                                        height="100%"
                                        language="sql"
                                        theme={isDark ? "vs-dark" : "light"}
                                        defaultValue={code}
                                        onChange={(v) => setCode(v || "")}
                                        options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: "on", scrollBeyondLastLine: false, automaticLayout: true, renderLineHighlight: "none", guides: { indentation: false } }}
                                    />
                                </div>
                            </div>
                        </Panel>

                        <VSep />

                        <Panel defaultSize={40} minSize={20}>
                            <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] overflow-hidden">
                                <div className="flex bg-slate-50 dark:bg-[#282828] px-4 pt-2 gap-2 items-end">
                                    <button onClick={() => setTestPanelTab("testcase")} className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${testPanelTab === "testcase" ? "bg-white dark:bg-[#1e1e1e] text-green-600 dark:text-green-500" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"}`}>
                                        <span className="material-symbols-outlined text-[18px]">check_circle</span>Testcase
                                    </button>
                                    <button onClick={() => setTestPanelTab("result")} className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${testPanelTab === "result" ? "bg-white dark:bg-[#1e1e1e] text-green-600 dark:text-green-500" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"}`}>
                                        <span className="material-symbols-outlined text-[18px]">terminal</span>Result
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-[#1e1e1e]">
                                    {testPanelTab === "testcase" ? (
                                        <div className="space-y-4">
                                            {q.examples && q.examples.length > 0 ? (
                                                <>
                                                    <DataTable data={q.examples[0].input} titleNode={<p className="font-semibold text-slate-700 dark:text-slate-300">Input</p>} />
                                                    <DataTable data={q.examples[0].output} titleNode={<p className="font-semibold text-slate-700 dark:text-slate-300">Output</p>} />
                                                </>
                                            ) : (
                                                <div className="text-center py-8 text-slate-500 dark:text-slate-400"><p className="text-sm">No test cases available</p></div>
                                            )}
                                        </div>
                                    ) : isRunning ? (
                                        <div className="text-center py-12 text-blue-500 border border-dashed border-slate-200 dark:border-[#3e3e3e] rounded-xl">
                                            <span className="material-symbols-outlined text-4xl mb-2 animate-pulse">terminal</span>
                                            <p className="text-sm font-semibold">Running query with Judge0...</p>
                                        </div>
                                    ) : runError ? (
                                        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                                            {runError}
                                        </div>
                                    ) : sqlResults.length > 0 ? (
                                        <div className="space-y-4">
                                            <h2 className={`text-2xl font-semibold ${sqlResults.every((result) => result.passed) ? "text-green-500" : "text-red-500"}`}>
                                                {sqlResults.every((result) => result.passed) ? "Accepted" : "Wrong Answer"}
                                            </h2>
                                            {sqlResults.map((result) => (
                                                <div key={result.id} className="rounded-xl border border-slate-200 p-4 dark:border-[#3e3e3e]">
                                                    <div className="mb-3 flex items-center justify-between">
                                                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{result.label || result.id}</p>
                                                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${result.passed ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
                                                            {result.passed ? "Passed" : "Failed"}
                                                        </span>
                                                    </div>
                                                    {result.error && <p className="mb-3 text-xs font-semibold text-red-600 dark:text-red-300">{result.error}</p>}
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        <div>
                                                            <p className="mb-2 text-xs font-bold uppercase text-slate-400">Your Output</p>
                                                            <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-[#282828]">{result.actualOutput || "(no output)"}</pre>
                                                        </div>
                                                        <div>
                                                            <p className="mb-2 text-xs font-bold uppercase text-slate-400">Expected</p>
                                                            <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-[#282828]">{result.expectedOutput || "(no output)"}</pre>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-12 text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-[#3e3e3e] rounded-xl">
                                            <span className="material-symbols-outlined text-4xl mb-2 opacity-50">terminal</span>
                                            <p className="text-sm">Run the query to preview Judge0 results. Nothing will be saved.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Panel>
                    </Group>
                </Panel>
            </Group>
        </main>
    );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SYSTEM DESIGN PREVIEW â€” copied from web system-design/solve/page.tsx
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SystemDesignPreview({ q, backHref, isDark, onBack }: { q: QuestionPayload; backHref: string; isDark: boolean; onBack?: () => void }) {
    const [activeTab, setActiveTab] = useState<"description" | "solution" | "submissions">("description");
    const [fr, setFr] = useState("");
    const [nfr, setNfr] = useState("");
    const scratchpadElementsRef = useRef<any[]>([]);

    const parsed = parseProblemStatement(q.problemStatement || q.description || "");
    const frSection = parsed.sections.find((s) => /functional requirements/i.test(s.title) && !/non/i.test(s.title));
    const nfrSection = parsed.sections.find((s) => /non-functional/i.test(s.title));
    const scaleSection = parsed.sections.find((s) => /scale/i.test(s.title));
    const hints = q.hints || [];
    const [revealedHints, setRevealedHints] = useState(0);

    return (
        <main className="h-[calc(100vh-74px)] overflow-hidden bg-[#FAFBFC] dark:bg-lc-bg">
            <Group orientation="horizontal" className="h-full">
                <Panel defaultSize={40} minSize={28}>
                    <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <header className="flex items-center gap-3 px-4 py-3">
                                    <PreviewBackButton backHref={backHref} onBack={onBack} />
                                    <div className="min-w-0 truncate font-nunito text-[18px] font-bold text-slate-800 dark:text-white">{q.title || "Question"}</div>
                                </header>
                            </div>
                        </div>

                        <div className="flex items-center bg-slate-100 dark:bg-[#333333]">
                            {(["description", "solution", "submissions"] as const).map((tab) => (
                                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium capitalize ${activeTab === tab ? "text-slate-900 dark:text-white border-b-2 border-slate-700 dark:border-slate-300" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"}`}>
                                    {tab}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-auto p-6">
                            <div className="mb-4 flex items-center gap-3">
                                {q.difficulty && <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${q.difficulty === "Easy" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : q.difficulty === "Medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>{q.difficulty}</span>}
                            </div>

                            {activeTab === "description" && (
                                <div className="space-y-8">
                                    {parsed.intro && <div className="text-[16px] text-slate-700 dark:text-slate-100 leading-relaxed whitespace-pre-wrap">{renderInlineMarkdown(parsed.intro)}</div>}

                                    {!!q.followUpQuestions?.length && (
                                        <section>
                                            <h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                                                <span className="material-symbols-outlined text-[21px] text-slate-500 dark:text-slate-400">quiz</span>Follow-up Questions
                                            </h3>
                                            <ol className="space-y-2 list-decimal list-inside marker:text-slate-400">
                                                {q.followUpQuestions.map((fq: string, i: number) => <li key={i} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed pl-1">{fq}</li>)}
                                            </ol>
                                        </section>
                                    )}

                                    {!!hints.length && (
                                        <section>
                                            <div className="flex items-center justify-between mb-3">
                                                <h3 className="text-[19px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                    <span className="material-symbols-outlined text-[21px] text-slate-500 dark:text-slate-400">lightbulb</span>Hints
                                                    <span className="text-[13px] font-medium text-slate-400 dark:text-slate-500 ml-1">({revealedHints}/{hints.length})</span>
                                                </h3>
                                                {revealedHints > 0 && <button type="button" onClick={() => setRevealedHints(0)} className="text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-2 py-1 rounded">Hide all</button>}
                                            </div>
                                            {revealedHints === 0 ? (
                                                <button type="button" onClick={() => setRevealedHints(1)} className="px-4 py-2 text-slate-800 dark:text-slate-200 text-[14px] font-medium transition-colors hover:text-slate-600">Reveal first hint</button>
                                            ) : (
                                                <div className="space-y-3">
                                                    {hints.slice(0, revealedHints).map((hint: string, i: number) => (
                                                        <div key={i} className="flex items-start gap-3">
                                                            <span className="flex-shrink-0 w-6 h-6 mt-0.5 bg-blue-500 text-white rounded-full flex items-center justify-center text-[11px] font-bold">{i + 1}</span>
                                                            <p className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed">{hint}</p>
                                                        </div>
                                                    ))}
                                                    {revealedHints < hints.length && <button type="button" onClick={() => setRevealedHints((r) => Math.min(r + 1, hints.length))} className="px-4 py-2 text-slate-800 dark:text-slate-200 text-[14px] font-medium transition-colors hover:text-slate-600">Show next hint</button>}
                                                </div>
                                            )}
                                        </section>
                                    )}
                                </div>
                            )}

                            {activeTab === "solution" && (
                                <div className="space-y-8">
                                    {!!frSection?.items.length && <section><h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">Functional Requirements</h3><ul className="space-y-2">{frSection.items.map((it, i) => <li key={i} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2"><span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">&bull;</span><span>{it}</span></li>)}</ul></section>}
                                    {!!nfrSection?.items.length && <section><h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">Non-Functional Requirements</h3><ul className="space-y-2">{nfrSection.items.map((it, i) => <li key={i} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2"><span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">&bull;</span><span>{it}</span></li>)}</ul></section>}
                                    {!!scaleSection?.items.length && <section><h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">Scale</h3><ul className="space-y-2">{scaleSection.items.map((it, i) => <li key={i} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2"><span className="text-slate-400 dark:text-slate-500 mt-1 flex-shrink-0">&bull;</span><span>{it}</span></li>)}</ul></section>}
                                    {q.sampleAnswer && <section><h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">Sample Approach</h3><p className="text-[15.5px] leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{q.sampleAnswer}</p></section>}
                                    {!!q.rubricLite?.requiredComponents?.length && <section><h3 className="text-[19px] font-bold text-slate-900 dark:text-white mb-3">Required Components</h3><ul className="space-y-2">{q.rubricLite.requiredComponents.map((it: string, i: number) => <li key={i} className="text-[15.5px] text-slate-700 dark:text-slate-200 leading-relaxed flex items-start gap-2"><span className="text-slate-400 mt-1 flex-shrink-0">&bull;</span><span>{it}</span></li>)}</ul></section>}
                                    {!frSection && !nfrSection && !q.sampleAnswer && !q.rubricLite?.requiredComponents?.length && (
                                        <div className="text-center py-12 text-slate-500 dark:text-slate-400"><span className="material-symbols-outlined text-5xl mb-2 text-slate-400">draft</span><p>Solution material not available for this question yet.</p></div>
                                    )}
                                </div>
                            )}

                            {activeTab === "submissions" && (
                                <div className="grid min-h-[280px] place-items-center rounded-xl bg-slate-50 text-center dark:bg-[#1f1f1f]">
                                    <div>
                                        <span className="material-symbols-outlined text-4xl text-blue-400">history</span>
                                        <p className="mt-3 text-[16px] font-extrabold text-slate-900 dark:text-white">Company preview</p>
                                        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Submission history is available on the candidate side.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </Panel>

                <HSep />

                <Panel defaultSize={60} minSize={30}>
                    <Group orientation="vertical" className="h-full">
                        <Panel defaultSize={55} minSize={25}>
                            <div className="relative h-full bg-white dark:bg-[#282828]">
                                <SystemDesignScratchpad isDark={isDark} onSceneChange={(els) => { scratchpadElementsRef.current = els; }} />
                                <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2">
                                    <span className="pointer-events-auto px-3 py-1.5 rounded-full text-[11px] font-medium bg-slate-800/80 text-white backdrop-blur-sm">Company preview - whiteboard is for reference only</span>
                                </div>
                            </div>
                        </Panel>

                        <VSep />

                        <Panel defaultSize={45} minSize={25}>
                            <div className="h-full bg-slate-50 dark:bg-[#1e1e1e] p-4 overflow-hidden">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                                    <RequirementCard title="Functional Requirements" placeholder="Write functional requirements here..." value={fr} onChange={setFr} />
                                    <RequirementCard title="Non-Functional Requirements" placeholder="Write non-functional requirements here..." value={nfr} onChange={setNfr} />
                                </div>
                            </div>
                        </Panel>
                    </Group>
                </Panel>
            </Group>
        </main>
    );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CS FUNDAMENTALS PREVIEW â€” copied from web cs-fundamentals/solve/page.tsx
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function CSFundamentalsPreview({ q, backHref, onBack }: { q: QuestionPayload; backHref: string; onBack?: () => void }) {
    return (
        <div className="h-[calc(100vh-74px)] overflow-hidden bg-white dark:bg-[#1a1a1a] flex flex-col">
            <div className="flex items-center border-b border-slate-100 dark:border-white/5">
                <header className="flex items-center gap-3 px-4 py-3">
                    <PreviewBackButton backHref={backHref} onBack={onBack} />
                    <div className="min-w-0 truncate font-nunito text-[18px] font-bold text-slate-800 dark:text-white">{q.title || q.question || "Question"}</div>
                </header>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-6xl mx-auto px-6 py-8 pb-20">
                    {/* Question */}
                    <div className="mb-8">
                        <div className="flex items-start gap-3 mb-6">
                            <span className="text-3xl font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">Q.</span>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white leading-relaxed">
                                {q.question || q.title || ""}
                            </h1>
                        </div>
                    </div>

                    {/* Answer */}
                    <div>
                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-1 h-8 bg-green-500 rounded-full" />
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Answer</h2>
                        </div>
                        <div className="prose prose-slate dark:prose-invert max-w-none">
                            {q.detailedAnswer ? (
                                <div className="text-slate-700 dark:text-slate-300 text-lg">
                                    <FormattedAnswer text={q.detailedAnswer} />
                                </div>
                            ) : q.answer ? (
                                <p className="text-slate-700 dark:text-slate-300 text-lg leading-relaxed whitespace-pre-wrap">{q.answer}</p>
                            ) : (
                                <div className="p-8 bg-slate-50 dark:bg-slate-900/30 rounded-lg text-center">
                                    <span className="material-symbols-outlined text-5xl text-slate-400 dark:text-slate-600 mb-3">info</span>
                                    <p className="text-slate-600 dark:text-slate-400">No answer available for this question yet.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN PAGE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export function CompanyQuestionIdePreview({
    question,
    type,
    backHref,
    isDark,
    onBack,
}: {
    question: QuestionPayload;
    type: QuestionType;
    backHref: string;
    isDark: boolean;
    onBack?: () => void;
}) {
    if (type === "sql") return <SQLPreview q={question} backHref={backHref} isDark={isDark} onBack={onBack} />;
    if (type === "system_design") return <SystemDesignPreview q={question} backHref={backHref} isDark={isDark} onBack={onBack} />;
    if (type === "cs_fundamentals") return <CSFundamentalsPreview q={question} backHref={backHref} onBack={onBack} />;
    return <DSAPreview q={question} backHref={backHref} isDark={isDark} onBack={onBack} />;
}
