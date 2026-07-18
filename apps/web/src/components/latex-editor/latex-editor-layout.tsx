"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTheme } from "next-themes";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useLatexAutosave } from "@/hooks/use-latex-autosave";
import { LatexToolbar } from "./latex-toolbar";
import { LatexSourceEditor } from "./latex-source-editor";
import { LatexPreviewPanel } from "./latex-preview-panel";
import { LatexAgentPanel } from "./latex-agent-panel";
import { LatexErrorPanel } from "./latex-error-panel";
import { ResumeBuilderModal } from "./resume-builder-modal";
import { LockedFeature } from "@/components/locked-feature";

interface LatexEditorLayoutProps {
    resumeId: string;
    initialTitle: string;
    initialSource: string;
    initialCompiledUrl: string | null;
}

const MAIN_SPLITTER_WIDTH = 8;
const AI_SPLITTER_WIDTH = 8;
const MIN_EDITOR_WIDTH = 260;
const MIN_PREVIEW_WIDTH = 260;
const MIN_AI_WIDTH = 250;
const MAX_AI_WIDTH = 460;

export function LatexEditorLayout({
    resumeId,
    initialTitle,
    initialSource,
    initialCompiledUrl,
}: LatexEditorLayoutProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    // State
    const [source, setSource] = useState(initialSource);
    const [title, setTitle] = useState(initialTitle);
    const [aiOpen, setAiOpen] = useState(false);
    const [compiling, setCompiling] = useState(false);
    const [compiledPdfUrl, setCompiledPdfUrl] = useState<string | null>(initialCompiledUrl);
    const [previewVersion, setPreviewVersion] = useState(0);
    const [compileErrors, setCompileErrors] = useState<{ line: number; message: string; severity: "error" | "warning" }[]>([]);
    const [compileWarnings, setCompileWarnings] = useState<string[]>([]);
    const [showErrors, setShowErrors] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [token, setToken] = useState<string>("");
    const [highlightRanges, setHighlightRanges] = useState<{ startLine: number; endLine: number }[]>([]);
    const [aiWidth, setAiWidth] = useState(320);
    const [draggingSplitter, setDraggingSplitter] = useState<"main" | "ai" | null>(null);
    const [mobileTab, setMobileTab] = useState<"editor" | "preview" | "ai">("editor");

    // Resizable panel
    const [leftWidth, setLeftWidth] = useState(50); // percentage
    const isResizing = useRef(false);
    const isAiResizing = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const getMaxAiWidth = useCallback((containerWidth: number) => {
        const maxBySpace = containerWidth - MIN_EDITOR_WIDTH - MIN_PREVIEW_WIDTH - MAIN_SPLITTER_WIDTH - AI_SPLITTER_WIDTH;
        return Math.max(MIN_AI_WIDTH, Math.min(MAX_AI_WIDTH, maxBySpace));
    }, []);

    // Auth token
    useEffect(() => {
        const supabase = createSupabaseBrowserClient();
        supabase.auth.getSession().then(({ data }) => {
            if (data.session?.access_token) setToken(data.session.access_token);
        });
    }, []);

    useEffect(() => {
        if (!token || !initialCompiledUrl) return;

        let cancelled = false;

        const refreshCompiledPreviewUrl = async () => {
            try {
                const { url } = await api.get<{ url: string }>(
                    `/latex-resumes/${resumeId}/download`,
                    token
                );
                if (!cancelled) {
                    setCompiledPdfUrl(url);
                }
            } catch {
                // Keep existing URL if presign fetch fails.
            }
        };

        void refreshCompiledPreviewUrl();

        return () => {
            cancelled = true;
        };
    }, [token, initialCompiledUrl, resumeId]);

    // Auto-save
    useLatexAutosave({
        resumeId,
        source,
        title,
        token,
    });

    // Resize handler
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizing.current = true;
        setDraggingSplitter("main");

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!isResizing.current || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const aiConsumed = aiOpen ? aiWidth + AI_SPLITTER_WIDTH : 0;
            const available = rect.width - aiConsumed;
            if (available <= 0) return;
            const minPercent = Math.min(80, (MIN_EDITOR_WIDTH / available) * 100);
            const maxPercent = Math.max(minPercent, ((available - MIN_PREVIEW_WIDTH) / available) * 100);
            const newPercent = ((moveEvent.clientX - rect.left) / available) * 100;
            setLeftWidth(Math.max(minPercent, Math.min(maxPercent, newPercent)));
        };

        const handleMouseUp = () => {
            isResizing.current = false;
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            setDraggingSplitter(null);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    }, [aiOpen, aiWidth]);

    const handleAiMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isAiResizing.current = true;
        setDraggingSplitter("ai");

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!isAiResizing.current || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const newWidth = rect.right - moveEvent.clientX;
            const maxAi = getMaxAiWidth(rect.width);
            setAiWidth(Math.max(MIN_AI_WIDTH, Math.min(maxAi, newWidth)));
        };

        const handleMouseUp = () => {
            isAiResizing.current = false;
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            setDraggingSplitter(null);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    }, [getMaxAiWidth]);

    useEffect(() => {
        if (!aiOpen || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const maxAi = getMaxAiWidth(rect.width);
        setAiWidth((prev) => Math.min(prev, maxAi));
    }, [aiOpen, getMaxAiWidth]);

    // Compile
    const handleCompile = useCallback(async () => {
        if (!token) return;
        setCompiling(true);
        setCompileErrors([]);
        setCompileWarnings([]);
        // Hide the previous PDF while a new compile is in flight to avoid stale-view confusion.
        setCompiledPdfUrl(null);

        const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

        try {
            const res = await fetch(`${API_BASE}/latex-resumes/${resumeId}/compile`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ source }),
            });

            const result = await res.json() as {
                success?: boolean;
                pdfUrl?: string;
                errors?: { line: number; message: string; severity: "error" | "warning" }[];
                warnings?: string[];
                error?: string;
                message?: string;
            };

            if (result.success && result.pdfUrl) {
                setCompiledPdfUrl(result.pdfUrl);
                setPreviewVersion((v) => v + 1);
                if (result.warnings?.length) {
                    setCompileWarnings(result.warnings);
                    setShowErrors(true);
                }
            } else {
                // 422 (compile errors) or 503 (service down) — both return errors array
                setCompileErrors(
                    result.errors?.length
                        ? result.errors
                        : [{ line: 0, message: result.message || "Compilation failed", severity: "error" as const }]
                );
                setCompileWarnings(result.warnings || []);
                setShowErrors(true);
            }
        } catch {
            setCompileErrors([{ line: 0, message: "Network error — could not reach the server", severity: "error" }]);
            setShowErrors(true);
        } finally {
            setCompiling(false);
        }
    }, [resumeId, token, source]);

    // Auto-compile on initial load if no PDF exists
    const hasAutoCompiled = useRef(false);
    useEffect(() => {
        if (token && !initialCompiledUrl && !hasAutoCompiled.current) {
            hasAutoCompiled.current = true;
            void handleCompile();
        }
    }, [token, initialCompiledUrl, handleCompile]);

    // Download
    const handleDownload = useCallback(async () => {
        if (!token || !compiledPdfUrl) return;
        try {
            const { url } = await api.get<{ url: string }>(
                `/latex-resumes/${resumeId}/download`,
                token
            );
            window.open(url, "_blank");
        } catch {
            // silently fail
        }
    }, [resumeId, token, compiledPdfUrl]);

    const handleEditDetails = useCallback(() => {
        setDetailsOpen(true);
    }, []);

    // AI rewrite from editor context menu
    const handleAiRewrite = useCallback((selectedText: string) => {
        setAiOpen(true);
        void selectedText;
    }, []);

    const handleAiFix = useCallback(() => {
        setAiOpen(true);
    }, []);

    // Auto-clear AI highlights after 8 seconds
    useEffect(() => {
        if (highlightRanges.length === 0) return;
        const timer = setTimeout(() => setHighlightRanges([]), 8000);
        return () => clearTimeout(timer);
    }, [highlightRanges]);

    return (
        <>
            <div className="flex flex-col h-full min-h-0">
                {/* Toolbar */}
                <LatexToolbar
                    resumeId={resumeId}
                    title={title}
                    onTitleChange={setTitle}
                    onCompile={handleCompile}
                    compiling={compiling}
                    onDownload={handleDownload}
                    onEditDetails={handleEditDetails}
                    onAiToggle={() => setAiOpen(!aiOpen)}
                    aiOpen={aiOpen}
                    hasCompiledPdf={!!compiledPdfUrl}
                    mobileTab={mobileTab}
                />

                {/* Mobile tab bar */}
                <div className="md:hidden flex border-b border-gray-200 dark:border-[#3e3e3e] bg-white dark:bg-[#1e1e1e] shrink-0">
                    {[
                        { id: "editor", label: "LaTeX Editor" },
                        { id: "preview", label: "Preview" },
                        { id: "ai", label: "AI" },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setMobileTab(tab.id as "editor" | "preview" | "ai")}
                            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                                mobileTab === tab.id
                                    ? "border-b-2 border-[#4A7CFF] text-[#4A7CFF]"
                                    : "text-slate-500 dark:text-slate-400"
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Main Content */}
                <div className="flex flex-1 overflow-hidden" ref={containerRef}>
                {/* Editor Panel */}
                <div
                    className={`flex-col overflow-hidden ${isDark ? "bg-[#1a1a1a]" : "bg-white"} flex-1 md:flex-none ${mobileTab !== "editor" ? "hidden md:flex" : "flex"}`}
                    style={{
                        width: aiOpen
                            ? `calc((100% - ${aiWidth + AI_SPLITTER_WIDTH}px) * ${leftWidth / 100})`
                            : `${leftWidth}%`,
                        minWidth: MIN_EDITOR_WIDTH,
                    }}
                >
                    <div className="flex-1 overflow-hidden">
                        <LatexSourceEditor
                            value={source}
                            onChange={setSource}
                            onAiRewrite={handleAiRewrite}
                            onAiFix={handleAiFix}
                            errors={compileErrors}
                            highlightRanges={highlightRanges}
                            onClearHighlights={() => setHighlightRanges([])}
                        />
                    </div>

                    {/* Error Panel */}
                    {showErrors && (
                        <LatexErrorPanel
                            errors={compileErrors}
                            warnings={compileWarnings}
                            onClose={() => setShowErrors(false)}
                        />
                    )}
                </div>

                {/* Resize Handle */}
                <div
                    className={`hidden md:block relative w-2 cursor-col-resize flex-shrink-0 transition-colors ${
                        isDark ? "bg-[#2f2f2f] hover:bg-[#4A7CFF]" : "bg-gray-200 hover:bg-blue-400"
                    }`}
                    onMouseDown={handleMouseDown}
                >
                    <span
                        className={`pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 ${
                            isDark ? "bg-[#5a5a5a]" : "bg-gray-400"
                        }`}
                    />
                </div>

                {/* Preview Panel */}
                <div
                    className={`min-w-0 flex-1 flex-col overflow-hidden ${mobileTab !== "preview" ? "hidden md:flex" : "flex"} ${draggingSplitter ? "pointer-events-none" : ""} ${isDark ? "bg-[#252525]" : "bg-gray-50"}`}
                    style={{ minWidth: MIN_PREVIEW_WIDTH }}
                >
                    <LatexPreviewPanel
                        compiling={compiling}
                        compiledPdfUrl={compiledPdfUrl}
                        previewVersion={previewVersion}
                    />
                </div>

                {/* AI Agent Panel */}
                {/* On desktop: show when aiOpen. On mobile: show when mobileTab === "ai" */}
                {(aiOpen || mobileTab === "ai") && (
                    <>
                        <div
                            className={`hidden md:block relative w-2 cursor-col-resize flex-shrink-0 transition-colors ${
                                isDark ? "bg-[#2f2f2f] hover:bg-[#0e639c]" : "bg-gray-200 hover:bg-[#0078d4]"
                            }`}
                            onMouseDown={handleAiMouseDown}
                        >
                            <span
                                className={`pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 ${
                                    isDark ? "bg-[#5a5a5a]" : "bg-gray-400"
                                }`}
                            />
                        </div>
                        <div
                            className={`flex-shrink-0 h-full min-h-0 overflow-hidden animate-in slide-in-from-right-2 fade-in duration-200 ${isDark ? "bg-[#1e1e1e]" : "bg-white"} ${mobileTab !== "ai" ? "hidden md:flex md:flex-col" : "flex flex-col flex-1 md:flex-none"}`}
                            style={{ width: aiWidth }}
                        >
                            <LockedFeature feature="latex_ai">
                                <LatexAgentPanel
                                    resumeId={resumeId}
                                    latexSource={source}
                                    token={token}
                                    onSourceChange={setSource}
                                    onHighlightRanges={setHighlightRanges}
                                />
                            </LockedFeature>
                        </div>
                    </>
                )}

                {draggingSplitter && <div className="fixed inset-0 z-[120] cursor-col-resize" />}
                </div>
            </div>

            <ResumeBuilderModal
                isOpen={detailsOpen}
                onClose={() => setDetailsOpen(false)}
                editingResumeId={resumeId}
                onExitEditMode={() => setDetailsOpen(false)}
            />
        </>
    );
}
