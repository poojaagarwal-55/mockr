"use client";

import { useEffect, useState } from "react";

interface PttOnboardingTooltipProps {
    show: boolean;
    onDismiss: () => void;
}

export function PttOnboardingTooltip({ show, onDismiss }: PttOnboardingTooltipProps) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (show) {
            setVisible(true);
            const timer = setTimeout(() => {
                setVisible(false);
                setTimeout(onDismiss, 300); // Wait for fade out animation
            }, 8000);

            return () => clearTimeout(timer);
        }
    }, [show, onDismiss]);

    if (!show) return null;

    return (
        <div
            className={`absolute top-20 right-4 z-50 max-w-sm bg-blue-600 dark:bg-blue-700 text-white rounded-lg shadow-xl p-4 transition-opacity duration-300 ${
                visible ? "opacity-100" : "opacity-0"
            }`}
        >
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">keyboard</span>
                </div>
                <div className="flex-1">
                    <h3 className="font-bold text-[15px] mb-1">Push-to-Talk Enabled</h3>
                    <p className="text-[13px] leading-relaxed opacity-95">
                        Hold <kbd className="px-1.5 py-0.5 bg-white/30 rounded text-[12px] font-mono">spacebar</kbd> to unmute and speak. 
                        Release to mute and let the AI respond. No manual mute needed!
                    </p>
                </div>
                <button
                    onClick={() => {
                        setVisible(false);
                        setTimeout(onDismiss, 300);
                    }}
                    className="flex-shrink-0 text-white/80 hover:text-white transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </div>
    );
}
