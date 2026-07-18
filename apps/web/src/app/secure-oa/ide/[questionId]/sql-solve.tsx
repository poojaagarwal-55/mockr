"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Group, Panel, Separator } from "react-resizable-panels";
import { getApiBaseUrl } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type SecureOaSqlIdeProps = {
    questionId: string;
    oaSessionId: string;
    oaQuestionKey: string;
};

function DataTable({ data, title, titleNode }: { data: any; title?: string; titleNode?: ReactNode }) {
    if (!data) return null;

    let parsedData = data;
    if (typeof data === "string") {
        try {
            parsedData = JSON.parse(data);
        } catch {
            return <pre className="whitespace-pre-wrap text-sm">{data}</pre>;
        }
    }

    if (Array.isArray(parsedData) && parsedData.length > 0 && typeof parsedData[0] === "object") {
        const keys = Object.keys(parsedData[0]);
        return (
            <div className="overflow-x-auto">
                {(titleNode || title) && (
                    <div className="mb-2 text-slate-700 dark:text-slate-300">{titleNode || <p className="font-semibold">{title}</p>}</div>
                )}
                <table className="min-w-full border border-slate-300 text-sm dark:border-slate-600">
                    <thead className="bg-slate-100 dark:bg-slate-700">
                        <tr>
                            {keys.map((key) => (
                                <th key={key} className="border-b border-slate-300 px-4 py-2 text-left font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">
                                    {key}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {parsedData.map((row: any, index: number) => (
                            <tr key={index} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                {keys.map((key) => (
                                    <td key={key} className="border-b border-slate-200 px-4 py-2 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                        {row[key] === null || row[key] === undefined ? "NULL" : String(row[key])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    if (typeof parsedData === "object" && !Array.isArray(parsedData)) {
        return (
            <div className="space-y-4">
                {Object.entries(parsedData).map(([tableName, tableData]) => (
                    <DataTable key={tableName} data={tableData} title={tableName} />
                ))}
            </div>
        );
    }

    return <pre className="whitespace-pre-wrap text-sm">{JSON.stringify(parsedData, null, 2)}</pre>;
}

function inferSchemaFromInput(input: any): string {
    if (!input || typeof input !== "object") return "";

    const blocks: string[] = [];
    for (const [tableName, rows] of Object.entries(input)) {
        if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0] !== "object") continue;
        const firstRow = rows[0] as Record<string, unknown>;
        const columns = Object.keys(firstRow);
        if (!columns.length) continue;

        blocks.push([
            `Table: ${tableName}`,
            "",
            "| Column Name | Example Value |",
            "|-------------|---------------|",
            ...columns.map((column) => `| ${column} | ${firstRow[column] === null || firstRow[column] === undefined ? "NULL" : String(firstRow[column])} |`),
        ].join("\n"));
    }

    return blocks.join("\n\n");
}

function postSecureOaMessage(payload: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    window.parent?.postMessage(payload, window.location.origin);
}

export function SecureOaSqlIde({ questionId, oaSessionId, oaQuestionKey }: SecureOaSqlIdeProps) {
    const { resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [question, setQuestion] = useState<any>(null);
    const [code, setCode] = useState("-- Write your SQL query here\n");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<"description" | "schema">("description");
    const [testPanelTab, setTestPanelTab] = useState<"testcase" | "result">("testcase");
    const editorRef = useRef<any>(null);

    useEffect(() => setMounted(true), []);
    const isDark = mounted && resolvedTheme === "dark";

    const resolvedSchema = question?.schema || inferSchemaFromInput(question?.examples?.[0]?.input);
    const sampleInput = question?.examples?.[0]?.input || question?.visibleTestCases?.[0]?.input;
    const sampleOutput = question?.examples?.[0]?.output || question?.visibleTestCases?.[0]?.expected;
    const accepted = Boolean(results?.success && results?.passed);
    const failedResult = results?.results?.find((result: any) => !result.passed) || results?.results?.[0];

    const questionUrl = useMemo(() => {
        const url = new URL(`/ide/question/${encodeURIComponent(questionId)}`, `${getApiBaseUrl()}/`);
        url.searchParams.set("mode", "secure_oa");
        url.searchParams.set("oaSessionId", oaSessionId);
        url.searchParams.set("oaQuestionKey", oaQuestionKey);
        return url.toString();
    }, [oaQuestionKey, oaSessionId, questionId]);

    useEffect(() => {
        let cancelled = false;

        async function loadQuestion() {
            setLoading(true);
            setError("");
            try {
                const supabase = createSupabaseBrowserClient();
                const { data } = await supabase.auth.getSession();
                const token = data.session?.access_token;
                const response = await fetch(questionUrl, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    cache: "no-store",
                });
                const body = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(body?.message || body?.error || "Failed to load SQL question.");
                }

                if (cancelled) return;
                setQuestion(body);
                const starter = body?.starter_code?.sql || body?.starterCode?.sql || "-- Write your SQL query here\n";
                setCode(starter);
                setResults(null);
                setTestPanelTab("testcase");
            } catch (err: any) {
                if (!cancelled) setError(err?.message || "Failed to load SQL question.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        if (questionId) void loadQuestion();
        return () => {
            cancelled = true;
        };
    }, [questionId, questionUrl]);

    useEffect(() => {
        if (!editorRef.current) return;
        const model = editorRef.current.getModel();
        if (model && model.getValue() !== code) {
            model.setValue(code);
        }
    }, [question?.id]);

    useEffect(() => {
        postSecureOaMessage({
            type: "secure-oa:code-change",
            sessionId: oaSessionId,
            questionId: oaQuestionKey,
            code,
            language: "sql",
        });
    }, [code, oaQuestionKey, oaSessionId]);

    async function runQuery() {
        if (!question || isRunning) return;
        setIsRunning(true);
        setResults(null);
        setTestPanelTab("result");

        try {
            const supabase = createSupabaseBrowserClient();
            const { data } = await supabase.auth.getSession();
            const token = data.session?.access_token;
            const response = await fetch(`${getApiBaseUrl()}/ide/run`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    questionId: question.id || questionId,
                    code,
                    language: "sql",
                    language_id: 82,
                    mode: "secure_oa",
                    oaSessionId,
                    oaQuestionKey,
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !body?.success) {
                throw new Error(body?.error || body?.message || "Query execution failed.");
            }
            setResults(body);
        } catch (err: any) {
            setResults({
                success: false,
                passed: false,
                error: err?.message || "Query execution failed.",
            });
        } finally {
            setIsRunning(false);
        }
    }

    if (loading) {
        return (
            <div className="grid h-full min-h-[520px] place-items-center bg-[#FAFBFC] text-slate-600 dark:bg-lc-bg dark:text-slate-400">
                Loading SQL question...
            </div>
        );
    }

    if (error || !question) {
        return (
            <div className="grid h-full min-h-[520px] place-items-center bg-[#FAFBFC] text-red-600 dark:bg-lc-bg dark:text-red-400">
                {error || "SQL question not found"}
            </div>
        );
    }

    return (
        <div className="h-full bg-[#FAFBFC] dark:bg-lc-bg">
            <Group orientation="horizontal">
                <Panel defaultSize={40} minSize={25}>
                    <div className="flex h-full flex-col bg-white dark:bg-[#282828]">
                        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6 dark:border-slate-700">
                            <div className="min-w-0">
                                <h2 className="truncate font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{question.title}</h2>
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-600 dark:text-teal-400">SQL question</p>
                            </div>
                            {question.difficulty && (
                                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                                    {question.difficulty}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center bg-slate-100 dark:bg-[#333333]">
                            <button
                                type="button"
                                onClick={() => setActiveTab("description")}
                                className={`px-4 py-2 text-sm font-bold ${activeTab === "description" ? "border-b-2 border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400" : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"}`}
                            >
                                Description
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("schema")}
                                className={`px-4 py-2 text-sm font-bold ${activeTab === "schema" ? "border-b-2 border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400" : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"}`}
                            >
                                Schema
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {activeTab === "description" ? (
                                <div className="prose max-w-none dark:prose-invert">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                        {question.description || question.statement || ""}
                                    </ReactMarkdown>
                                    {question.examples?.[0]?.explanation && (
                                        <p className="mt-5 text-sm font-semibold text-slate-600 dark:text-slate-300">{question.examples[0].explanation}</p>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    {resolvedSchema ? (
                                        <div className="prose prose-sm max-w-none rounded-lg bg-slate-50 p-4 dark:prose-invert dark:bg-[#1c160d]">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                                {resolvedSchema}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No schema metadata was provided.</p>
                                    )}
                                    {sampleInput && <DataTable data={sampleInput} titleNode={<p className="font-bold text-slate-800 dark:text-slate-200">Sample Input</p>} />}
                                    {sampleOutput && <DataTable data={sampleOutput} titleNode={<p className="font-bold text-slate-800 dark:text-slate-200">Expected Output</p>} />}
                                </div>
                            )}
                        </div>
                    </div>
                </Panel>

                <Separator className="relative flex w-1.5 cursor-col-resize items-center justify-center bg-slate-200 transition-colors hover:bg-teal-500 dark:bg-[#3e3e3e] dark:hover:bg-teal-500">
                    <div className="h-6 w-0.5 rounded-full bg-slate-400 dark:bg-slate-500" />
                </Separator>

                <Panel defaultSize={60} minSize={30}>
                    <Group orientation="vertical">
                        <Panel defaultSize={60} minSize={30}>
                            <div className="flex h-full flex-col bg-white dark:bg-[#282828]">
                                <div className="flex h-12 items-center justify-between bg-slate-50 px-4 dark:bg-[#242424]">
                                    <div className="text-sm font-bold text-slate-700 dark:text-slate-300">SQL Editor</div>
                                    <button
                                        type="button"
                                        onClick={runQuery}
                                        disabled={isRunning}
                                        className="flex h-8 items-center justify-center rounded-full bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isRunning ? "Running..." : "Run Query"}
                                    </button>
                                </div>

                                <div className="flex-1 overflow-hidden">
                                    <MonacoEditor
                                        onMount={(editor) => {
                                            editorRef.current = editor;
                                        }}
                                        height="100%"
                                        language="sql"
                                        theme={isDark ? "vs-dark" : "light"}
                                        value={code}
                                        onChange={(value) => setCode(value || "")}
                                        options={{
                                            minimap: { enabled: false },
                                            fontSize: 14,
                                            lineNumbers: "on",
                                            scrollBeyondLastLine: false,
                                            automaticLayout: true,
                                            renderLineHighlight: "none",
                                            guides: { indentation: false },
                                        }}
                                    />
                                </div>
                            </div>
                        </Panel>

                        <Separator className="relative flex h-1.5 cursor-row-resize items-center justify-center bg-slate-200 transition-colors hover:bg-teal-500 dark:bg-[#3e3e3e] dark:hover:bg-teal-500">
                            <div className="h-0.5 w-6 rounded-full bg-slate-400 dark:bg-slate-500" />
                        </Separator>

                        <Panel defaultSize={40} minSize={20}>
                            <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-[#1e1e1e]">
                                <div className="flex items-end gap-2 bg-slate-50 px-4 pt-2 dark:bg-[#282828]">
                                    <button
                                        type="button"
                                        onClick={() => setTestPanelTab("testcase")}
                                        className={`flex items-center gap-2 rounded-t-md px-4 py-2 text-sm font-bold transition-colors ${testPanelTab === "testcase" ? "bg-white text-green-600 dark:bg-[#1e1e1e] dark:text-green-500" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"}`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                                        Testcase
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setTestPanelTab("result")}
                                        className={`flex items-center gap-2 rounded-t-md px-4 py-2 text-sm font-bold transition-colors ${testPanelTab === "result" ? "bg-white text-green-600 dark:bg-[#1e1e1e] dark:text-green-500" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"}`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">terminal</span>
                                        Result
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto bg-white p-6 dark:bg-[#1e1e1e]">
                                    {testPanelTab === "testcase" ? (
                                        <div className="space-y-4">
                                            {sampleInput ? <DataTable data={sampleInput} titleNode={<p className="font-bold text-slate-700 dark:text-slate-300">Input</p>} /> : null}
                                            {sampleOutput ? <DataTable data={sampleOutput} titleNode={<p className="font-bold text-slate-700 dark:text-slate-300">Output</p>} /> : null}
                                            {!sampleInput && !sampleOutput && (
                                                <p className="py-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">No visible SQL test case was provided.</p>
                                            )}
                                        </div>
                                    ) : results ? (
                                        <div className={accepted ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                                            <p className="mb-3 flex items-center gap-2 font-bold">
                                                <span className="material-symbols-outlined text-lg">{accepted ? "check_circle" : "error"}</span>
                                                {accepted ? "Accepted" : results.success ? "Wrong Answer" : "Execution Error"}
                                            </p>
                                            {!accepted && (
                                                <div className="rounded-lg border border-red-100 bg-red-50 p-3 dark:border-red-800/30 dark:bg-red-900/20">
                                                    <pre className="whitespace-pre-wrap font-mono text-xs">{failedResult?.error || results.error || "Output does not match expected result."}</pre>
                                                </div>
                                            )}
                                            {failedResult?.actualOutput && (
                                                <div className="mt-6">
                                                    <DataTable data={failedResult.actualOutput} titleNode={<p className="font-bold text-slate-700 dark:text-slate-300">Your Output</p>} />
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-slate-500 dark:border-[#3e3e3e] dark:text-slate-400">
                                            <span className="material-symbols-outlined mb-2 text-4xl opacity-50">terminal</span>
                                            <p className="text-sm font-semibold">Run your query to see the result here</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Panel>
                    </Group>
                </Panel>
            </Group>
        </div>
    );
}

export default SecureOaSqlIde;
