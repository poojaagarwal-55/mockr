"use client";

import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";

interface LatexToolbarProps {
    resumeId: string;
    title: string;
    onTitleChange: (title: string) => void;
    onCompile: () => void;
    compiling: boolean;
    onDownload: () => void;
    onEditDetails: () => void;
    onAiToggle: () => void;
    aiOpen: boolean;
    hasCompiledPdf: boolean;
    mobileTab?: "editor" | "preview" | "ai";
}

export function LatexToolbar({
    resumeId,
    title,
    onTitleChange,
    onCompile,
    compiling,
    onDownload,
    onEditDetails,
    onAiToggle,
    aiOpen,
    hasCompiledPdf,
    mobileTab,
}: LatexToolbarProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const router = useRouter();

    void resumeId;

    return (
        <div
            className={`flex items-center justify-between px-4 py-2 border-b ${
                isDark ? "bg-[#1e1e1e] border-[#3e3e3e]" : "bg-white border-gray-200"
            }`}
        >
            {/* Left: Back + Title */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => router.push("/resumes")}
                    className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                        isDark
                            ? "text-slate-400 hover:text-white hover:bg-lc-hover"
                            : "text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                    }`}
                    title="Go back"
                >
                    <span className="material-symbols-outlined text-lg">arrow_back</span>
                </button>

                <div className={`w-px h-5 ${isDark ? "bg-[#3e3e3e]" : "bg-gray-200"}`} />

                <span className="material-symbols-outlined text-lg text-[#4A7CFF]">description</span>

                <input
                    type="text"
                    value={title}
                    onChange={(e) => onTitleChange(e.target.value)}
                    className={`text-sm font-medium bg-transparent border-0 outline-none px-1 py-0.5 rounded ${
                        isDark
                            ? "text-gray-200 focus:bg-[#282828]"
                            : "text-gray-800 focus:bg-gray-100"
                    }`}
                    style={{ minWidth: 100, maxWidth: 300 }}
                />
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
                {/* Compile PDF — shown on desktop always; on mobile only on "editor" tab */}
                <div className={mobileTab === "preview" || mobileTab === "ai" ? "hidden md:flex" : "flex"}>
                    <button
                        onClick={onCompile}
                        disabled={compiling}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all duration-200 ${
                            compiling
                                ? "opacity-50 cursor-not-allowed"
                                : isDark
                                    ? "bg-[#4A7CFF] text-white hover:bg-[#3a6cef] hover:-translate-y-[1px]"
                                    : "bg-blue-500 text-white hover:bg-blue-600 hover:-translate-y-[1px]"
                        }`}
                    >
                        {compiling ? (
                            <>Compiling...</>
                        ) : (
                            <>Compile PDF</>
                        )}
                    </button>
                </div>

                {/* Download PDF — shown on desktop always; on mobile only on "preview" tab */}
                <div className={mobileTab === "editor" || mobileTab === "ai" ? "hidden md:flex" : "flex"}>
                    <button
                        onClick={onDownload}
                        disabled={!hasCompiledPdf}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all duration-200 ${
                            hasCompiledPdf
                                ? isDark
                                    ? "bg-[#2a2a2a] text-gray-200 hover:bg-[#333] border border-[#3e3e3e] hover:-translate-y-[1px]"
                                    : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200 hover:-translate-y-[1px]"
                                : "opacity-40 cursor-not-allowed bg-transparent"
                        } ${isDark ? "text-gray-400" : "text-gray-500"}`}
                        title={hasCompiledPdf ? "Download compiled PDF" : "Compile first to download"}
                    >
                        Download PDF
                    </button>
                </div>

                {/* Edit Details — desktop only */}
                <div className="hidden md:flex">
                    <button
                        onClick={onEditDetails}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all duration-200 ${
                            isDark
                                ? "bg-[#2a2a2a] text-gray-200 hover:bg-[#333] border border-[#3e3e3e] hover:-translate-y-[1px]"
                                : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200 hover:-translate-y-[1px]"
                        }`}
                    >
                        Edit Details
                    </button>
                </div>

                {/* AI Toggle — desktop only (mobile uses tab bar) */}
                <div className="hidden md:flex">
                    <button
                        onClick={onAiToggle}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all duration-200 ${
                            aiOpen
                                ? "bg-[#4A7CFF] text-white"
                                : isDark
                                    ? "bg-[#2a2a2a] text-gray-200 hover:bg-[#333] border border-[#3e3e3e] hover:-translate-y-[1px]"
                                    : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200 hover:-translate-y-[1px]"
                        }`}
                    >
                        AI Assistant
                    </button>
                </div>
            </div>
        </div>
    );
}
