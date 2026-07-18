"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import type { LatexAiChatMessage, LatexAiSuggestion } from "@interviewforge/shared";
import { useBilling } from "@/hooks/use-billing";
import {
    UpgradeModal,
    copyFromUpgradeError,
    shouldShowUpgradeForError,
} from "@/components/upgrade-modal";

interface LatexAiSidebarProps {
    resumeId: string;
    latexSource: string;
    token: string;
    onApplySuggestions: (suggestions: LatexAiSuggestion[]) => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";

export function LatexAiSidebar({
    resumeId,
    latexSource,
    token,
    onApplySuggestions,
}: LatexAiSidebarProps) {
    const { resolvedTheme } = useTheme();
    const { snapshot: billingSnapshot } = useBilling();
    const isDark = resolvedTheme === "dark";
    const [messages, setMessages] = useState<LatexAiChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [upgradeCopy, setUpgradeCopy] = useState<string | undefined>();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const sendMessage = async (action: "chat" | "suggest" | "fix", chatMessage?: string) => {
        if (action === "chat" && !chatMessage?.trim()) return;

        setLoading(true);

        if (action === "chat" && chatMessage) {
            setMessages((prev) => [
                ...prev,
                { role: "user", content: chatMessage, timestamp: new Date().toISOString() },
            ]);
            setInput("");
        }

        try {
            const res = await fetch(`${API_BASE}/latex-resumes/${resumeId}/ai`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action,
                    fullSource: latexSource,
                    ...(action === "chat" && { chatMessage }),
                }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => null);
                if (shouldShowUpgradeForError(body)) {
                    setUpgradeCopy(copyFromUpgradeError(body));
                    setUpgradeOpen(true);
                    return;
                }
                throw new Error("AI request failed");
            }

            const data = await res.json();

            const suggestions: LatexAiSuggestion[] = data.suggestions || (data.replacement ? [{
                id: crypto.randomUUID(),
                type: "rewrite" as const,
                description: "AI rewrite",
                replacement: data.replacement,
            }] : []);

            // Auto-apply all suggestions directly into the editor
            if (suggestions.length > 0) {
                onApplySuggestions(suggestions);
            }

            const assistantMessage: LatexAiChatMessage = {
                role: "assistant",
                content: data.message || (action === "suggest" ? "Applied suggestions to your resume:" : action === "fix" ? "Applied fixes to your resume:" : ""),
                suggestions,
                timestamp: new Date().toISOString(),
            };

            setMessages((prev) => [...prev, assistantMessage]);
        } catch (err) {
            if (shouldShowUpgradeForError(err instanceof Error ? err.message : err)) {
                setUpgradeCopy(copyFromUpgradeError(err instanceof Error ? err.message : err));
                setUpgradeOpen(true);
            }
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    content: "Sorry, I encountered an error. Please try again.",
                    timestamp: new Date().toISOString(),
                },
            ]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`flex flex-col h-full ${isDark ? "bg-[#1e1e1e]" : "bg-white"}`}>
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
            {/* Header */}
            <div className={`px-4 py-3 border-b ${isDark ? "border-[#3e3e3e]" : "border-gray-200"}`}>
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#4A7CFF] text-lg">auto_awesome</span>
                    <span className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                        AI Assistant
                    </span>
                </div>
                <p className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                    Ask for help with your resume
                </p>
            </div>

            {/* Quick Actions */}
            <div className={`px-4 py-2 border-b flex gap-2 ${isDark ? "border-[#3e3e3e]" : "border-gray-200"}`}>
                <button
                    onClick={() => sendMessage("suggest")}
                    disabled={loading}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        isDark
                            ? "bg-[#282828] text-gray-300 hover:bg-[#333] border border-[#3e3e3e]"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200"
                    } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                    Suggest Improvements
                </button>
                <button
                    onClick={() => sendMessage("fix")}
                    disabled={loading}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        isDark
                            ? "bg-[#282828] text-gray-300 hover:bg-[#333] border border-[#3e3e3e]"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200"
                    } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                    Fix Errors
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
                {messages.length === 0 && (
                    <div className={`text-center py-8 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                        <span className="material-symbols-outlined text-3xl block mb-2">chat</span>
                        <p className="text-xs">
                            Ask me to improve your resume, fix LaTeX issues, or suggest changes.
                        </p>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`${msg.role === "user" ? "ml-6" : "mr-2"}`}>
                        <div
                            className={`rounded-lg px-3 py-2 text-sm ${
                                msg.role === "user"
                                    ? isDark
                                        ? "bg-[#4A7CFF] text-white ml-auto"
                                        : "bg-blue-500 text-white ml-auto"
                                    : isDark
                                        ? "bg-[#282828] text-gray-300"
                                        : "bg-gray-100 text-gray-700"
                            }`}
                            style={msg.role === "user" ? { marginLeft: "auto", maxWidth: "85%" } : { maxWidth: "95%" }}
                        >
                            {msg.content && <p className="whitespace-pre-wrap text-xs">{msg.content}</p>}
                        </div>

                        {/* Suggestions */}
                        {msg.suggestions && msg.suggestions.length > 0 && (
                            <div className="mt-2 space-y-2">
                                {msg.suggestions.map((sug) => (
                                    <div
                                        key={sug.id}
                                        className={`rounded-lg border p-2.5 ${
                                            isDark ? "border-[#3e3e3e] bg-[#252525]" : "border-gray-200 bg-gray-50"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <p className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                                                {sug.description}
                                            </p>
                                            <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-500">
                                                <span className="material-symbols-outlined text-xs">check</span>
                                                Applied
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {loading && (
                    <div className="flex items-center gap-2 text-xs text-[#4A7CFF]">
                        <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                        Thinking...
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className={`px-4 py-3 border-t ${isDark ? "border-[#3e3e3e]" : "border-gray-200"}`}>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage("chat", input);
                            }
                        }}
                        placeholder="Ask about your resume..."
                        disabled={loading}
                        className={`flex-1 text-sm px-3 py-2 rounded-lg outline-none transition-colors ${
                            isDark
                                ? "bg-[#282828] text-gray-200 border border-[#3e3e3e] focus:border-[#4A7CFF] placeholder-gray-600"
                                : "bg-gray-100 text-gray-800 border border-gray-200 focus:border-blue-400 placeholder-gray-400"
                        }`}
                    />
                    <button
                        onClick={() => sendMessage("chat", input)}
                        disabled={loading || !input.trim()}
                        className={`px-3 py-2 rounded-lg transition-colors ${
                            !input.trim() || loading
                                ? "opacity-40 cursor-not-allowed"
                                : "hover:bg-[#3a6cef]"
                        } bg-[#4A7CFF] text-white`}
                    >
                        <span className="material-symbols-outlined text-sm">send</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
