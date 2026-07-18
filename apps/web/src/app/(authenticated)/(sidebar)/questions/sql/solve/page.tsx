"use client";

import { useEffect, useMemo, useState, useRef, Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { Group, Panel, Separator } from "react-resizable-panels";
import { ModalDialog } from "@/components/modal-dialog";
import { ReportQuestionModal } from "@/components/report-question-modal";
import { AddToSheetModal } from "@/components/add-to-sheet-modal";
import dynamic from "next/dynamic";
import { updateLastQuestionDate } from "@/lib/notifications";
import { readPublicQuestionDraft, solveDraftPath } from "@/lib/public-question-drafts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

function normalizeDisplayText(value: unknown) {
    return String(value ?? "")
        .replace(/[\u2013\u2014]/g, "-");
}

// Helper component to render JSON data as HTML table
function DataTable({ data, title, titleNode }: { data: any; title?: string; titleNode?: ReactNode }) {
    if (!data) return null;

    // Parse if string
    let parsedData = data;
    if (typeof data === 'string') {
        try {
            parsedData = JSON.parse(data);
        } catch {
            return <pre className="text-sm">{normalizeDisplayText(data)}</pre>;
        }
    }

    // Handle array of objects (table rows)
    if (Array.isArray(parsedData) && parsedData.length > 0) {
        const keys = Object.keys(parsedData[0]);
        
        return (
            <div className="overflow-x-auto">
                {(titleNode || title) && (
                    <div className="mb-2 text-slate-700 dark:text-slate-300">{titleNode || <p className="font-semibold">{normalizeDisplayText(title)}</p>}</div>
                )}
                <table className="min-w-full border border-slate-300 dark:border-slate-600 text-sm">
                    <thead className="bg-slate-100 dark:bg-slate-700">
                        <tr>
                            {keys.map((key) => (
                                <th
                                    key={key}
                                    className="px-4 py-2 text-left font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-300 dark:border-slate-600"
                                >
                                    {key}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {parsedData.map((row: any, idx: number) => (
                            <tr
                                key={idx}
                                className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                            >
                                {keys.map((key) => (
                                    <td
                                        key={key}
                                        className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                                    >
                                        {row[key] !== null && row[key] !== undefined
                                            ? normalizeDisplayText(row[key])
                                            : "NULL"}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    // Handle object with table name as key
    if (typeof parsedData === 'object' && !Array.isArray(parsedData)) {
        return (
            <div className="space-y-4">
                {Object.entries(parsedData).map(([tableName, tableData]: [string, any]) => (
                    <DataTable key={tableName} data={tableData} title={tableName} />
                ))}
            </div>
        );
    }

    // Fallback to JSON
    return <pre className="text-sm">{normalizeDisplayText(JSON.stringify(parsedData, null, 2))}</pre>;
}

function inferSchemaFromInput(input: any): string {
    if (!input || typeof input !== "object") return "";

    const blocks: string[] = [];
    for (const [tableName, rows] of Object.entries(input)) {
        if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0] !== "object") continue;

        const firstRow = rows[0] as Record<string, unknown>;
        const columns = Object.keys(firstRow);
        if (columns.length === 0) continue;

        const lines = [
            `Table: ${tableName}`,
            "",
            "| Column Name | Example Value |",
            "|-------------|---------------|",
            ...columns.map((col) => {
                const value = firstRow[col];
                const sample = value === null || value === undefined ? "NULL" : String(value);
                return `| ${col} | ${sample} |`;
            }),
        ];

        blocks.push(lines.join("\n"));
    }

    return blocks.join("\n\n");
}

function parseSchemaMarkdown(schemaText: string): Array<{ name: string; rows: Record<string, string>[] }> {
    if (!schemaText) return [];

    const lines = schemaText.split("\n");
    const tables: Array<{ name: string; rows: Record<string, string>[] }> = [];

    const parseMarkdownRows = (blockLines: string[]): Record<string, string>[] => {
        const tableLines = blockLines.map((l) => l.trim()).filter((l) => l.startsWith("|"));
        if (tableLines.length < 2) return [];

        let headers: string[] = [];
        const rows: Record<string, string>[] = [];

        for (const line of tableLines) {
            const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
            if (cells.length === 0) continue;

            const isSeparatorRow = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
            if (isSeparatorRow) continue;

            if (headers.length === 0) {
                headers = cells;
                continue;
            }

            const row: Record<string, string> = {};
            headers.forEach((header, idx) => {
                row[header] = cells[idx] ?? "";
            });
            rows.push(row);
        }

        return rows;
    };

    const parseColonRows = (blockLines: string[]): Record<string, string>[] => {
        const rows: Record<string, string>[] = [];

        for (const raw of blockLines) {
            const line = raw.trim().replace(/^[-*]\s*/, "");
            if (!line || /^\(.*primary key.*\)$/i.test(line)) continue;

            const m = line.match(/^([A-Za-z_][\w\s]*)\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/);
            if (!m) continue;

            rows.push({
                "Column Name": m[1].trim(),
                Type: (m[2] || "").trim(),
                Description: m[3].trim(),
            });
        }

        return rows;
    };

    let currentName = "Schema";
    let currentBlock: string[] = [];

    const flushBlock = () => {
        if (currentBlock.length === 0) return;
        const markdownRows = parseMarkdownRows(currentBlock);
        const rows = markdownRows.length > 0 ? markdownRows : parseColonRows(currentBlock);
        if (rows.length > 0) {
            tables.push({ name: currentName || "Schema", rows });
        }
        currentBlock = [];
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (/^Table\s*:/i.test(line)) {
            flushBlock();
            currentName = line.replace(/^Table\s*:/i, "").trim() || "Schema";
            continue;
        }

        currentBlock.push(rawLine);
    }

    flushBlock();
    return tables;
}

function SQLSolveContent() {
    const searchParams = useSearchParams();
    const questionId = searchParams.get("id");
    const sheetId = searchParams.get("sheetId");
    const { resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const isDark = mounted && resolvedTheme === "dark";
    const mainEditorRef = useRef<any>(null);
    const lastLoadedFingerprintRef = useRef<string | null>(null);


    const [question, setQuestion] = useState<any>(null);
    const [code, setCode] = useState("-- Write your SQL query here\nSELECT * FROM employee;");
    const [loading, setLoading] = useState(true);
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<any>(null);
    const [nextQuestionUrl, setNextQuestionUrl] = useState<string | null>(null);
    const [showAddToSheet, setShowAddToSheet] = useState(false);
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
    const [testPanelTab, setTestPanelTab] = useState<"testcase" | "result">("testcase");
    const [activeTab, setActiveTab] = useState<"description" | "solution" | "submissions">("description");
    const [pastSubmissions, setPastSubmissions] = useState<any[]>([]);
    const [expandedSubmissionIndex, setExpandedSubmissionIndex] = useState<number | null>(null);
    const [isSolved, setIsSolved] = useState(false);

    useEffect(() => {
        const fingerprint = `${questionId}`;
        if (mainEditorRef.current && fingerprint !== lastLoadedFingerprintRef.current) {
            lastLoadedFingerprintRef.current = fingerprint;
            const model = mainEditorRef.current.getModel();
            if (model && model.getValue() !== code) {
                mainEditorRef.current.setValue(code);
            }
        }
    }, [code, questionId]);


    const resolvedSchema = question?.schema || inferSchemaFromInput(question?.examples?.[0]?.input);
    const isInferredSchema = !question?.schema && Boolean(resolvedSchema);
    const schemaTables = useMemo(
        () => parseSchemaMarkdown(resolvedSchema || ""),
        [resolvedSchema]
    );

    const fetchSubmissions = async () => {
        if (!questionId) return;
        try {
            const supabase = createSupabaseBrowserClient();
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) return;

            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/sql/submissions/${questionId}`,
                { 
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                }
            );
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setPastSubmissions(data.data || []);
                    setIsSolved((data.data || []).some((s: any) => s.status === "accepted"));
                }
            }
        } catch (err) {
            console.error("Failed to fetch submissions", err);
        }
    };

    useEffect(() => {
        const fetchQuestion = async () => {
            try {
                const supabase = createSupabaseBrowserClient();
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData.session?.access_token;

                const res = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/sql/question/${questionId}?_t=${Date.now()}`,
                    {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                        cache: "no-store",
                    }
                );

                const data = await res.json();
                setQuestion(data);
                
                // Initialize code for the new question
                const starterCode = "-- Write your SQL query here\nSELECT * FROM employee;";
                const savedDraft = questionId ? readPublicQuestionDraft(solveDraftPath("sql", questionId)) : null;
                setCode(savedDraft?.content || starterCode);
                lastLoadedFingerprintRef.current = `${questionId}`;

                // Fetch sheet to see next question context
                if (sheetId && token && questionId) {
                    try {
                        const sheetRes = await fetch(
                            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/users/me/sheets/${encodeURIComponent(sheetId)}?_t=${Date.now()}`,
                            {
                                headers: { Authorization: `Bearer ${token}` },
                                cache: "no-store",
                            }
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
            } catch (err) {
                console.error("Failed to load question:", err);
                setLoading(false);
            }
        };

        if (questionId) {
            fetchQuestion();
            fetchSubmissions();
        }
    }, [questionId]);

    const handleRunCode = async () => {
        setIsRunning(true);
        setResults(null);

        try {
            const supabase = createSupabaseBrowserClient();
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;

            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/sql/run`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        ...(question?.id ? { questionId: question.id } : questionId ? { questionId } : {}),
                        code,
                    }),
                }
            );

            const data = await res.json();
            
            if (!data.success) {
                throw new Error(data.error || "Query execution failed");
            }
            
            setResults(data);
            
            // Track question completion for reminder system
            updateLastQuestionDate();
            
            if (data.passed) {
                setIsSolved(true);
                
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
                                            questionId: `sql-${questionId}`,
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
                                            questionId: `sql-${questionId}`,
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
            
            // Refresh submissions
            fetchSubmissions();
        } catch (err: any) {
            setModalState({
                isOpen: true,
                title: "Query Failed",
                message: "Failed to execute SQL query",
                type: "error",
                details: err.message,
            });
        } finally {
            setIsRunning(false);
            setTestPanelTab("result");
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="text-slate-600 dark:text-slate-400">Loading question...</div>
            </div>
        );
    }

    if (!question) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="text-red-600 dark:text-red-400">Question not found</div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-[#FAFBFC] dark:bg-lc-bg">
            <ModalDialog
                isOpen={modalState.isOpen}
                onClose={() => setModalState({ ...modalState, isOpen: false })}
                title={modalState.title}
                message={modalState.message}
                type={modalState.type}
                details={modalState.details}
            />
            
            <Group orientation="horizontal">
                {/* Left Panel - Problem Description */}
                <Panel defaultSize={40} minSize={25}>
                    <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                        <div className="p-1 mx-[-8]">
                            <div className="flex items-center justify-between pr-4">
                                <div className="flex items-center">
                                    <PageHeader title={normalizeDisplayText(question.title)} showBack={true} backUrl={sheetId ? `/sheets/${sheetId}` : "/questions/sql"} />
                                    {isSolved && (
                                        <div className="ml-3 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 mt-1 shadow-sm border border-emerald-200 dark:border-emerald-800/60">
                                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                            Solved
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
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
                            </div>
                        </div>
                        
                        {/* Tab Strip */}
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
                            {/* Report bug */}
                            <div className="ml-auto pr-3">
                                <ReportQuestionModal
                                    questionId={questionId!}
                                    questionType="sql"
                                    questionTitle={normalizeDisplayText(question.title)}
                                />
                            </div>
                        </div>
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === "description" ? (
                        <div className="prose dark:prose-invert max-w-none">
                            {/* Difficulty Badge and Add to Sheet Button */}
                            <div className="mb-4 flex items-center justify-between">
                                {question.difficulty && (
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
                                )}

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
                            <h3>Description</h3>
                            <div className="whitespace-pre-wrap dark:text-slate-300">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                    {normalizeDisplayText(question.description)}
                                </ReactMarkdown>
                            </div>

                            {resolvedSchema && (
                                <>
                                    <h3 className="mt-8 text-lg font-semibold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 pb-2">{isInferredSchema ? "Database Schema (Inferred)" : "Database Schema"}</h3>
                                    <div className="bg-slate-50 dark:bg-[#1c160d] p-4 rounded space-y-4 mt-4">
                                        {schemaTables.length > 0 ? (
                                            schemaTables.map((table, index) => (
                                                <DataTable
                                                    key={`${table.name}-${index}`}
                                                    data={table.rows}
                                                    title={table.name}
                                                />
                                            ))
                                        ) : (
                                            <div className="prose prose-sm dark:prose-invert max-w-none">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                                    {normalizeDisplayText(resolvedSchema)}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {question.examples && question.examples.length > 0 && (
                                <>
                                    <h3>Example</h3>
                                    <div className="bg-slate-50 dark:bg-[#1c160d] p-4 rounded space-y-4">
                                        <DataTable data={question.examples[0].input} titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Input</h1>} />
                                        <DataTable data={question.examples[0].output} titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Output</h1>} />
                                        {question.examples[0].explanation && (
                                            <>
                                                <p className="font-semibold mt-4 mb-2">Explanation:</p>
                                                <p className="text-sm">{normalizeDisplayText(question.examples[0].explanation)}</p>
                                            </>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    ) : activeTab === "solution" ? (
                        <div className="flex flex-col items-center justify-center h-full text-center py-12">
                            <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600 mb-4">
                                construction
                            </span>
                            <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Coming Soon
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Solutions for SQL questions will be available soon.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {pastSubmissions.length > 0 ? (
                                pastSubmissions.map((submission: any, index: number) => {
                                    const isExpanded = expandedSubmissionIndex === index;
                                    const statusColor = 
                                        submission.status === "accepted" 
                                            ? "text-emerald-600 dark:text-emerald-400" 
                                            : submission.status === "wrong_answer"
                                            ? "text-red-600 dark:text-red-400"
                                            : "text-amber-600 dark:text-amber-400";
                                    
                                    const statusBg = 
                                        submission.status === "accepted" 
                                            ? "bg-emerald-50 dark:bg-emerald-900/20" 
                                            : submission.status === "wrong_answer"
                                            ? "bg-red-50 dark:bg-red-900/20"
                                            : "bg-amber-50 dark:bg-amber-900/20";

                                    return (
                                        <div 
                                            key={submission.id || index} 
                                            className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden"
                                        >
                                            <button
                                                onClick={() => setExpandedSubmissionIndex(isExpanded ? null : index)}
                                                className="w-full px-4 py-3 flex items-center justify-between bg-slate-50 dark:bg-[#222222] hover:bg-slate-100 dark:hover:bg-[#2a2a2a] transition-colors"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className={`font-semibold capitalize ${statusColor}`}>
                                                        {submission.status === "accepted" ? "Accepted" : submission.status === "wrong_answer" ? "Wrong Answer" : "Error"}
                                                    </span>
                                                    <span className="text-sm text-slate-500 dark:text-slate-400">
                                                        {new Date(submission.submittedAt).toLocaleString()}
                                                    </span>
                                                </div>
                                                <span className="material-symbols-outlined text-slate-400">
                                                    {isExpanded ? "expand_less" : "expand_more"}
                                                </span>
                                            </button>
                                            
                                            {isExpanded && (
                                                <div className="p-4 bg-white dark:bg-[#1e1e1e] space-y-4">
                                                    {/* Status Details */}
                                                    <div className={`p-3 rounded-lg ${statusBg}`}>
                                                        <p className={`text-sm font-semibold ${statusColor}`}>
                                                            {submission.status === "accepted" 
                                                                ? "✓ Query executed successfully" 
                                                                : submission.status === "wrong_answer"
                                                                ? "✗ Wrong Answer"
                                                                : "⚠ Execution Error"}
                                                        </p>
                                                        {submission.message && (
                                                            <p className="text-xs mt-1 text-slate-600 dark:text-slate-400">
                                                                {submission.message}
                                                            </p>
                                                        )}
                                                    </div>

                                                    {/* Code */}
                                                    <div>
                                                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                                            Your Query
                                                        </h4>
                                                        <div className="bg-slate-50 dark:bg-[#282828] p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                                            <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap overflow-x-auto">
                                                                {submission.code}
                                                            </pre>
                                                        </div>
                                                    </div>

                                                    {/* Output if available */}
                                                    {submission.output && (
                                                        <div>
                                                            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                                                Output
                                                            </h4>
                                                            <div className="bg-slate-50 dark:bg-[#282828] p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                                                <DataTable data={submission.output} />
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Error if available */}
                                                    {submission.error && (
                                                        <div>
                                                            <h4 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">
                                                                Error Details
                                                            </h4>
                                                            <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800/30">
                                                                <pre className="text-xs font-mono text-red-700 dark:text-red-300 whitespace-pre-wrap">
                                                                    {submission.error}
                                                                </pre>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                                    <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600 mb-4">
                                        history
                                    </span>
                                    <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                        No Submissions Yet
                                    </h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        Your submission history will appear here after you run queries.
                                    </p>
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

                {/* Right Panel - SQL Editor and Results */}
                <Panel defaultSize={60} minSize={30}>
                    <Group orientation="vertical">
                        {/* SQL Editor Panel */}
                        <Panel defaultSize={60} minSize={30}>
                            <div className="h-full flex flex-col bg-white dark:bg-[#282828]">
                <div className="px-4 h-12 flex items-center justify-between bg-slate-50 dark:bg-[#242424]">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        SQL Editor
                    </div>
                    <button
                        onClick={handleRunCode}
                        disabled={isRunning}
                        className="px-4 h-8 flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
                    >
                        {isRunning ? "Running..." : "Run Query"}
                    </button>
                                </div>

                                <div className="flex-1 overflow-hidden">
                                    <MonacoEditor
                                        onMount={(editor) => {
                                            mainEditorRef.current = editor;
                                        }}
                                        height="100%"
                                        language="sql"
                                        theme={isDark ? "vs-dark" : "light"}
                                        defaultValue={code}
                                        onChange={(value) => setCode(value || "")}
                                        options={{
                                            minimap: { enabled: false },
                                            fontSize: 14,
                                            lineNumbers: "on",
                                            scrollBeyondLastLine: false,
                                            automaticLayout: true,
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

                        {/* Results Panel */}
                        <Panel defaultSize={40} minSize={20}>
                            <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] overflow-hidden">
                                {/* Tab Header */}
                                <div className="flex bg-slate-50 dark:bg-[#282828] px-4 pt-2 gap-2 items-end">
                                    <button
                                        onClick={() => setTestPanelTab("testcase")}
                                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${
                                            testPanelTab === "testcase"
                                                ? "bg-white dark:bg-[#1e1e1e] text-green-600 dark:text-green-500"
                                                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                                        Testcase
                                    </button>
                                    <button
                                        onClick={() => setTestPanelTab("result")}
                                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${
                                            testPanelTab === "result"
                                                ? "bg-white dark:bg-[#1e1e1e] text-green-600 dark:text-green-500"
                                                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">terminal</span>
                                        Result
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-[#1e1e1e]">
                                    {testPanelTab === "testcase" ? (
                                        <div className="space-y-4">
                                            {question?.examples && question.examples.length > 0 ? (
                                                <>
                                                    <DataTable 
                                                        data={question.examples[0].input} 
                                                        titleNode={
                                                            <p className="font-semibold text-slate-700 dark:text-slate-300">Input</p>
                                                        } 
                                                    />
                                                    <DataTable 
                                                        data={question.examples[0].output} 
                                                        titleNode={
                                                            <p className="font-semibold text-slate-700 dark:text-slate-300">Output</p>
                                                        } 
                                                    />
                                                </>
                                            ) : (
                                                <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                                                    <p className="text-sm">No test cases available for this question</p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {results ? (
                                                <div className="space-y-4">
                                                    {results.success ? (
                                                        <div className="text-green-600 dark:text-green-400">
                                                            <p className="font-medium mb-2 flex items-center gap-2">
                                                                <span className="material-symbols-outlined text-lg">check_circle</span>
                                                                Query executed successfully!
                                                            </p>
                                                            {results.passed ? (
                                                                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg border border-emerald-100 dark:border-emerald-800/30">
                                                                    <p className="text-sm font-semibold">Accepted</p>
                                                                    <p className="text-xs mt-1 text-emerald-600/80 dark:text-emerald-400/80">Your output matches the expected result.</p>
                                                                </div>
                                                            ) : (
                                                                <div className="text-red-600 dark:text-red-400 mt-2">
                                                                    <p className="text-sm font-semibold mb-2">Wrong Answer</p>
                                                                    <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
                                                                        <pre className="text-xs whitespace-pre-wrap font-mono uppercase">
                                                                            {results.results?.[0]?.error || "Output does not match expected result."}
                                                                        </pre>
                                                                    </div>
                                                                </div>
                                                            )}
                                                            
                                                            {results.results?.[0]?.actualOutput && (
                                                                <div className="mt-6">
                                                                    <DataTable 
                                                                        data={results.results[0].actualOutput} 
                                                                        titleNode={<p className="font-semibold text-slate-700 dark:text-slate-300">Your Output</p>} 
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="text-red-600 dark:text-red-400">
                                                            <p className="font-medium flex items-center gap-2 mb-2">
                                                                <span className="material-symbols-outlined text-lg">error</span>
                                                                Execution Error
                                                            </p>
                                                            <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
                                                                <pre className="text-xs whitespace-pre-wrap font-mono">
                                                                    {results.error || results.message}
                                                                </pre>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-center py-12 text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-[#3e3e3e] rounded-xl">
                                                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">terminal</span>
                                                    <p className="text-sm">Run your query to see the results here</p>
                                                </div>
                                            )}
                                        </div>
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
                questionType="sql"
                onSuccess={() => {
                    console.log("Question added to sheet successfully");
                }}
            />
        </div>
    );
}

export default function SQLSolvePage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <SQLSolveContent />
        </Suspense>
    );
}
