"use client";

import { useEffect, useState } from "react";

interface LiveTranscriptPreviewProps {
    text: string;
    isActive: boolean;
}

export function LiveTranscriptPreview({ text, isActive }: LiveTranscriptPreviewProps) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isActive && text.trim()) {
            setVisible(true);
        } else {
            // Fade out after a short delay when speech stops
            const timer = setTimeout(() => setVisible(false), 500);
            return () => clearTimeout(timer);
        }
    }, [isActive, text]);

    if (!visible || !text.trim()) {
        return null;
    }

    return (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 max-w-2xl w-full px-4 pointer-events-none">
            <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
                            You're saying...
                        </p>
                        <p className="text-base text-slate-900 dark:text-slate-100 leading-relaxed">
                            {text}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
