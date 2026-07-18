"use client";

import { useTheme } from "next-themes";

interface LatexErrorPanelProps {
    errors: { line: number; message: string; severity: "error" | "warning" }[];
    warnings: string[];
    onClose: () => void;
}

export function LatexErrorPanel({ errors, warnings, onClose }: LatexErrorPanelProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    if (errors.length === 0 && warnings.length === 0) return null;

    return (
        <div
            className={`border-t ${
                isDark ? "bg-[#1e1e1e] border-[#3e3e3e]" : "bg-white border-gray-200"
            }`}
        >
            <div className="flex items-center justify-between px-4 py-1.5">
                <div className="flex items-center gap-3 text-xs">
                    {errors.length > 0 && (
                        <span className="flex items-center gap-1 text-red-500">
                            <span className="material-symbols-outlined text-sm">error</span>
                            {errors.length} error{errors.length !== 1 ? "s" : ""}
                        </span>
                    )}
                    {warnings.length > 0 && (
                        <span className="flex items-center gap-1 text-amber-500">
                            <span className="material-symbols-outlined text-sm">warning</span>
                            {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
                        </span>
                    )}
                </div>
                <button
                    onClick={onClose}
                    className={`w-7 h-7 flex items-center justify-center rounded-md text-xs border transition-all duration-200 hover:-translate-y-[1px] ${
                        isDark
                            ? "text-gray-400 hover:text-gray-200 bg-[#2a2a2a] border-[#3e3e3e] hover:bg-[#333]"
                            : "text-gray-500 hover:text-gray-700 bg-white border-gray-200 hover:bg-gray-100"
                    }`}
                >
                    <span className="material-symbols-outlined text-sm">close</span>
                </button>
            </div>

            <div className="max-h-32 overflow-auto px-4 pb-2 space-y-1">
                {errors.map((err, i) => (
                    <div key={`err-${i}`} className="flex items-start gap-2 text-xs">
                        <span className="material-symbols-outlined text-red-500 text-sm mt-0.5">error</span>
                        <span className={isDark ? "text-gray-300" : "text-gray-700"}>
                            <span className="font-mono text-red-400">Line {err.line}:</span>{" "}
                            {err.message}
                        </span>
                    </div>
                ))}
                {warnings.map((warn, i) => (
                    <div key={`warn-${i}`} className="flex items-start gap-2 text-xs">
                        <span className="material-symbols-outlined text-amber-500 text-sm mt-0.5">warning</span>
                        <span className={isDark ? "text-gray-300" : "text-gray-700"}>{warn}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
