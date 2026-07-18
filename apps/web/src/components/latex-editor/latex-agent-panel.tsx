"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { useBilling } from "@/hooks/use-billing";
import {
    UpgradeModal,
    copyFromUpgradeError,
    shouldShowUpgradeForError,
} from "@/components/upgrade-modal";

// ── Types ────────────────────────────────────────────────────

type AgentEvent =
    | { type: "status"; message: string }
    | { type: "edit"; originalText: string; newText: string; description: string; updatedSource?: string }
    | { type: "compile_result"; success: boolean; errors: { line: number; message: string; severity: string }[]; warnings: string[] }
    | { type: "message"; content: string }
    | { type: "done"; summary: string; updatedSource?: string }
    | { type: "error"; message: string };

type AgentPhase = "processing" | "reading" | "editing" | "compiling" | "messaging" | "generic";
type StepState = "running" | "done" | "failed";

type ActivityItem =
    | { kind: "user"; text: string }
    | { kind: "status"; message: string; phase: AgentPhase; state: StepState }
    | { kind: "edit"; description: string; originalText: string; newText: string; expanded: boolean }
    | { kind: "compile"; success: boolean; errors: { line: number; message: string; severity: string }[]; warnings: string[] }
    | { kind: "message"; content: string }
    | { kind: "done"; summary: string }
    | { kind: "error"; message: string };

interface LatexAgentPanelProps {
    resumeId: string;
    latexSource: string;
    token: string;
    onSourceChange: (src: string) => void;
    onHighlightRanges: (ranges: { startLine: number; endLine: number }[]) => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ── Helper: compute highlight range from edit ────────────────

function computeHighlight(
    source: string,
    originalText: string,
    newText: string
): { startLine: number; endLine: number } | null {
    const idx = source.indexOf(originalText);
    if (idx === -1) return null;
    const before = source.slice(0, idx);
    const startLine = before.split("\n").length;
    const endLine = startLine + newText.split("\n").length - 1;
    return { startLine, endLine };
}

function mapStatusToPhase(message: string): AgentPhase {
    const normalized = message.toLowerCase();
    if (/(read|scan|load|inspect)/.test(normalized)) return "reading";
    if (/(compile|pdflatex|build)/.test(normalized)) return "compiling";
    if (/(edit|rewrite|replace|patch|update|apply)/.test(normalized)) return "editing";
    if (/(message|respond|explain)/.test(normalized)) return "messaging";
    if (/(analy|think|process|plan|reason)/.test(normalized)) return "processing";
    return "generic";
}

function sanitizeAssistantText(text: string): string {
    return text
        .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
        .replace(/\r/g, "")
        .trim();
}

// ── Panel ────────────────────────────────────────────────────

export function LatexAgentPanel({
    resumeId,
    latexSource,
    token,
    onSourceChange,
    onHighlightRanges,
}: LatexAgentPanelProps) {
    const { resolvedTheme } = useTheme();
    const { snapshot: billingSnapshot } = useBilling();
    const isDark = resolvedTheme === "dark";
    const [input, setInput] = useState("");
    const [running, setRunning] = useState(false);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [upgradeCopy, setUpgradeCopy] = useState<string | undefined>();
    const [activity, setActivity] = useState<ActivityItem[]>([]);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    // Keep a live ref to source so SSE handler always sees latest
    const sourceRef = useRef(latexSource);
    useEffect(() => { sourceRef.current = latexSource; }, [latexSource]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [activity]);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;

        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }, [input]);

    const pushItem = useCallback((item: ActivityItem, settleRunning = false) => {
        setActivity((prev) => {
            const settled = settleRunning
                ? prev.map((entry) =>
                    entry.kind === "status" && entry.state === "running"
                        ? { ...entry, state: "done" as const }
                        : entry
                )
                : prev;
            return [...settled, item];
        });
    }, []);

    const markRunningStatuses = useCallback((nextState: StepState) => {
        setActivity((prev) =>
            prev.map((entry) =>
                entry.kind === "status" && entry.state === "running"
                    ? { ...entry, state: nextState }
                    : entry
            )
        );
    }, []);

    const run = useCallback(async (message: string) => {
        if (!message.trim() || running) return;
        setRunning(true);
        setActivity((prev) => [...prev, { kind: "user", text: message }]);
        pushItem({
            kind: "status",
            message: "Processing request...",
            phase: "processing",
            state: "running",
        });
        setInput("");

        abortRef.current = new AbortController();

        try {
            const res = await fetch(`${API_BASE}/latex-resumes/${resumeId}/agent`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ message, source: sourceRef.current }),
                signal: abortRef.current.signal,
            });

            if (!res.ok || !res.body) {
                const text = await res.text();
                if (shouldShowUpgradeForError(text)) {
                    setUpgradeCopy(copyFromUpgradeError(text));
                    setUpgradeOpen(true);
                    throw new Error("This LaTeX AI action needs an upgraded plan.");
                }
                throw new Error(text);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const parts = buffer.split("\n\n");
                buffer = parts.pop() ?? "";

                for (const part of parts) {
                    if (!part.startsWith("data: ")) continue;
                    const json = part.slice(6).trim();
                    if (!json) continue;

                    let event: AgentEvent;
                    try { event = JSON.parse(json); } catch { continue; }

                    if (event.type === "status") {
                        const statusMessage = sanitizeAssistantText(event.message) || "Working...";
                        markRunningStatuses("done");
                        pushItem({
                            kind: "status",
                            message: statusMessage,
                            phase: mapStatusToPhase(statusMessage),
                            state: "running",
                        });

                    } else if (event.type === "edit") {
                        markRunningStatuses("done");
                        const description = sanitizeAssistantText(event.description) || "Applied edit";
                        // Apply edit to source
                        if (event.updatedSource) {
                            sourceRef.current = event.updatedSource;
                            onSourceChange(event.updatedSource);
                            // Highlight the changed lines
                            const h = computeHighlight(event.updatedSource, event.newText, event.newText);
                            if (h) onHighlightRanges([h]);
                        } else {
                            // Compute ourselves
                            const current = sourceRef.current;
                            const searchText = current.includes(event.originalText)
                                ? event.originalText
                                : current.includes(event.originalText.trim())
                                    ? event.originalText.trim()
                                    : null;
                            if (searchText) {
                                const updated = current.replace(searchText, event.newText);
                                sourceRef.current = updated;
                                onSourceChange(updated);
                                const h = computeHighlight(updated, event.newText, event.newText);
                                if (h) onHighlightRanges([h]);
                            }
                        }
                        pushItem({ kind: "edit", description, originalText: event.originalText, newText: event.newText, expanded: false });

                    } else if (event.type === "compile_result") {
                        markRunningStatuses(event.success ? "done" : "failed");
                        pushItem({ kind: "compile", success: event.success, errors: event.errors, warnings: event.warnings });

                    } else if (event.type === "message") {
                        markRunningStatuses("done");
                        pushItem({ kind: "message", content: sanitizeAssistantText(event.content) });

                    } else if (event.type === "done") {
                        markRunningStatuses("done");
                        if (event.updatedSource) {
                            sourceRef.current = event.updatedSource;
                            onSourceChange(event.updatedSource);
                        }
                        pushItem({ kind: "done", summary: sanitizeAssistantText(event.summary) || "Done." });
                        break;

                    } else if (event.type === "error") {
                        markRunningStatuses("failed");
                        if (shouldShowUpgradeForError(event)) {
                            setUpgradeCopy(copyFromUpgradeError(event));
                            setUpgradeOpen(true);
                        }
                        pushItem({ kind: "error", message: sanitizeAssistantText(event.message) || "Request failed" });
                        break;
                    }
                }
            }
        } catch (err: unknown) {
            if ((err as Error).name !== "AbortError") {
                markRunningStatuses("failed");
                pushItem({ kind: "error", message: sanitizeAssistantText((err as Error).message || "Request failed") });
            }
        } finally {
            markRunningStatuses("done");
            setRunning(false);
            abortRef.current = null;
        }
    }, [resumeId, token, running, pushItem, onSourceChange, onHighlightRanges, markRunningStatuses]);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        markRunningStatuses("failed");
        pushItem({ kind: "error", message: "Run cancelled." });
        setRunning(false);
    }, [markRunningStatuses, pushItem]);

    const toggleEdit = useCallback((idx: number) => {
        setActivity((prev) =>
            prev.map((item, i) =>
                i === idx && item.kind === "edit" ? { ...item, expanded: !item.expanded } : item
            )
        );
    }, []);

    // ── Colors ─────────────────────────────────────────────────
    const bg = isDark ? "bg-[#1e1e1e]" : "bg-white";
    const border = isDark ? "border-[#3e3e3e]" : "border-gray-200";
    const muted = isDark ? "text-gray-400" : "text-gray-500";
    const surface = isDark ? "bg-[#252526]" : "bg-gray-50";
    const surfaceBorder = isDark ? "border-[#3e3e3e]" : "border-gray-200";
    const activeStatus = [...activity]
        .reverse()
        .find((item): item is Extract<ActivityItem, { kind: "status" }> => item.kind === "status" && item.state === "running");

    return (
        <div className={`relative flex flex-col h-full min-h-0 overflow-hidden font-sans ${bg}`}>
            <UpgradeModal
                open={upgradeOpen}
                onClose={() => setUpgradeOpen(false)}
                feature="latex_ai"
                reason="tokens"
                title="Upgrade LaTeX AI"
                description={
                    upgradeCopy ||
                    "Your current plan has reached its LaTeX AI limit. Upgrade for a larger monthly AI budget."
                }
                currentPlan={billingSnapshot?.plan}
                currentSubscriptionId={billingSnapshot?.subscriptionId ?? undefined}
            />
            <div className={`px-3 py-2 border-b ${border} flex-shrink-0 ${surface}`}>
                <div className="flex items-center justify-between gap-2">
                    {running && activeStatus ? (
                        <p className={`text-[11px] ${muted}`}>{activeStatus.message}</p>
                    ) : (
                        <span />
                    )}
                    {activity.length > 0 && (
                        <button
                            onClick={() => setActivity([])}
                            disabled={running}
                            className={`text-[10px] font-semibold rounded-lg px-2.5 py-1.5 border shadow-sm transition-all duration-200 active:scale-[0.98] ${
                                running
                                    ? "opacity-45 cursor-not-allowed"
                                    : "hover:-translate-y-[1px]"
                            } ${
                                isDark
                                    ? "bg-[#2a1f22] text-red-300 border-[#5a2d35] hover:bg-[#3a252a]"
                                    : "bg-white text-red-600 border-red-200 hover:bg-red-50"
                            }`}
                        >
                            Clear conversation
                        </button>
                    )}
                </div>
            </div>

            {/* Quick prompts */}
            {activity.length === 0 && (
                <div className={`px-3 py-2 border-b ${border} flex-shrink-0 ${surface}`}>
                    <div className="flex flex-col gap-1.5">
                        {[
                            "Fix all compilation errors",
                            "Improve bullet points to be more impactful",
                            "Optimize for ATS systems",
                            "Make this resume more concise and quantified",
                        ].map((prompt) => (
                            <button
                                key={prompt}
                                onClick={() => run(prompt)}
                                disabled={running}
                                className={`text-left text-[11px] leading-5 px-3 py-2 rounded-lg border shadow-sm transition-all duration-200 ${surfaceBorder} ${
                                    isDark
                                        ? "bg-[#2d2d30] text-gray-200 hover:bg-[#343438]"
                                        : "bg-white text-gray-700 hover:bg-gray-100"
                                } ${running ? "opacity-40 cursor-not-allowed" : ""}`}
                            >
                                {prompt}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Activity feed */}
            <div className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-2 [scrollbar-width:thin]">
                {activity.map((item, idx) => {
                    if (item.kind === "user") {
                        return (
                            <div key={idx} className="flex justify-end">
                                <div className={`text-[12px] leading-5 px-3 py-2 rounded-md max-w-[85%] border ${
                                    isDark
                                        ? "bg-[#d9dee8] text-gray-900 border-[#c7cedb]"
                                        : "bg-gray-100 text-gray-800 border-gray-200"
                                }`}>
                                    {item.text}
                                </div>
                            </div>
                        );
                    }

                    if (item.kind === "status") {
                        return (
                            <p key={idx} className={`text-[12px] leading-5 ${muted}`}>
                                {item.message}
                            </p>
                        );
                    }

                    if (item.kind === "compile") {
                        return (
                            <div key={idx} className={`text-[12px] leading-5 ${item.success ? muted : isDark ? "text-red-300" : "text-red-600"}`}>
                                <p>{item.success ? "Compile succeeded." : `Compile failed with ${item.errors.length} error${item.errors.length !== 1 ? "s" : ""}.`}</p>
                                {!item.success && item.errors.length > 0 && (
                                    <div className="mt-1 space-y-1">
                                        {item.errors.map((e, ei) => (
                                            <p key={ei} className="font-mono text-[11px] leading-4">
                                                {e.line > 0 ? `L${e.line}: ` : ""}
                                                {e.message}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    }

                    if (item.kind === "edit") {
                        return (
                            <div key={idx} className={`text-[12px] leading-5 ${muted}`}>
                                <div className="flex items-center gap-1.5">
                                    <p className={`text-[12px] leading-5 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                                        Edited: {item.description}
                                    </p>
                                    <button
                                        onClick={() => toggleEdit(idx)}
                                        className={`text-[14px] leading-none transition-transform duration-200 ${
                                            isDark ? "text-gray-300 hover:text-white" : "text-gray-600 hover:text-gray-900"
                                        }`}
                                        aria-label={item.expanded ? "Collapse changes" : "Expand changes"}
                                    >
                                        <span className={`inline-block transition-transform duration-200 ${item.expanded ? "rotate-90" : "rotate-0"}`}>
                                            &gt;
                                        </span>
                                    </button>
                                </div>
                                <div className={`overflow-hidden transition-all duration-300 ease-out ${item.expanded ? "max-h-80 opacity-100 mt-1" : "max-h-0 opacity-0"}`}>
                                    <div className="space-y-1 text-[11px] font-mono leading-4">
                                        {item.originalText.trim() && (
                                            <pre className={`whitespace-pre-wrap break-all ${isDark ? "text-red-300" : "text-red-600"}`}>
- {item.originalText.slice(0, 400)}{item.originalText.length > 400 ? "..." : ""}
                                            </pre>
                                        )}
                                        <pre className={`whitespace-pre-wrap break-all ${isDark ? "text-green-300" : "text-green-700"}`}>
+ {item.newText.slice(0, 400)}{item.newText.length > 400 ? "..." : ""}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    if (item.kind === "message") {
                        return (
                            <p key={idx} className={`text-[12px] leading-5 whitespace-pre-wrap ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                                {item.content}
                            </p>
                        );
                    }

                    if (item.kind === "done") {
                        return (
                            <div key={idx} className="text-[12px] leading-5">
                                <p className={`text-[11px] font-semibold mb-1 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                                    Done
                                </p>
                                <p className={isDark ? "text-gray-100" : "text-gray-900"}>{item.summary}</p>
                            </div>
                        );
                    }

                    if (item.kind === "error") {
                        return (
                            <p key={idx} className={`text-[12px] leading-5 ${isDark ? "text-red-300" : "text-red-600"}`}>
                                {item.message}
                            </p>
                        );
                    }

                    return null;
                })}

                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className={`px-3 py-2 border-t ${border} flex-shrink-0 ${surface}`}>
                <div className="flex gap-2">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                run(input);
                            }
                        }}
                        placeholder="Tell the agent what to do..."
                        disabled={running}
                        rows={1}
                        className={`flex-1 text-[12px] px-3 py-2 rounded-md outline-none resize-none transition-all duration-200 leading-5 overflow-hidden ${
                            isDark
                                ? "bg-[#1f1f1f] text-gray-100 border border-[#3e3e3e] focus:border-[#0e639c] placeholder-gray-500"
                                : "bg-white text-gray-800 border border-gray-300 focus:border-[#0078d4] placeholder-gray-400"
                        } ${running ? "opacity-50" : ""}`}
                        style={{ minHeight: 36 }}
                    />
                    {running ? (
                        <button
                            onClick={stop}
                            className="w-9 h-9 flex items-center justify-center rounded-lg bg-red-600 text-white shadow-sm transition-all duration-200 hover:bg-red-700 hover:-translate-y-[1px] self-end"
                            title="Pause agent"
                            aria-label="Pause agent"
                        >
                            <span className="material-symbols-outlined text-[18px] leading-none">stop</span>
                        </button>
                    ) : (
                        <button
                            onClick={() => run(input)}
                            disabled={!input.trim()}
                            className={`w-9 h-9 flex items-center justify-center rounded-lg shadow-sm transition-all duration-200 self-end ${
                                !input.trim() ? "opacity-40 cursor-not-allowed" : "hover:bg-[#005a9e] hover:-translate-y-[1px]"
                            } bg-[#0078d4] text-white`}
                            title="Send"
                            aria-label="Send"
                        >
                            <span className="material-symbols-outlined text-[18px] leading-none">arrow_upward</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
