"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

interface ScratchpadPanelProps {
    isDark: boolean;
    topic?: string;
    initialContent?: string;
    remainingSeconds?: number;
    /** Called when the scene changes — parent can use this to send canvas data to the server */
    onSceneChange?: (elements: any[]) => void;
}

export default function ScratchpadPanel({
    isDark,
    topic,
    initialContent,
    remainingSeconds,
    onSceneChange,
}: ScratchpadPanelProps) {
    // Track mounted state to avoid SSR hydration mismatch
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);

    const handleSceneChange = useCallback(
        (elements: readonly any[]) => {
            if (!onSceneChange) return;

            const meaningful = Array.from(elements || []).filter(
                (el: any) => !el?.isDeleted && el?.type !== "selection"
            );
            onSceneChange(meaningful);
        },
        [onSceneChange]
    );

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Whiteboard toolbar header — minimal */}
            <div className="flex items-center border-b border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface px-4 h-12 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-blue-500">
                        draw
                    </span>
                    <span className="text-sm font-bold text-slate-700 dark:text-white">
                        Whiteboard
                    </span>
                </div>
            </div>

            {/* Excalidraw Canvas */}
            <div className="excalidraw-wrapper" style={{ flex: 1, position: "relative", overflow: "hidden" }}>
                {mounted && (
                    <Excalidraw
                        excalidrawAPI={(api) => {
                            excalidrawApiRef.current = api;
                        }}
                        theme={isDark ? "dark" : "light"}
                        onChange={handleSceneChange}
                        UIOptions={{
                            canvasActions: {
                                loadScene: false,
                                export: false,
                                saveToActiveFile: false,
                            },
                            tools: {
                                image: false,
                            },
                        }}
                        renderTopRightUI={() => null}
                    />
                )}
            </div>

            <style jsx global>{`
                /* Hide Excalidraw external library / publish buttons */
                .excalidraw-wrapper .library-button,
                .excalidraw-wrapper [aria-label="Library"],
                .excalidraw-wrapper [title="Library"],
                .excalidraw-wrapper .ToolIcon__library,
                .excalidraw-wrapper button[data-testid="toolbar-library"] {
                    display: none !important;
                }

                /* Hide Excalidraw social/community links */
                .excalidraw-wrapper .HelpDialog__section:has(a[href*="github.com/excalidraw"]),
                .excalidraw-wrapper .HelpDialog__section:has(a[href*="x.com/excalidraw"]),
                .excalidraw-wrapper .HelpDialog__section:has(a[href*="twitter.com/excalidraw"]),
                .excalidraw-wrapper .HelpDialog__section:has(a[href*="discord.gg"]),
                .excalidraw-wrapper .HelpDialog__section:has(a[href*="discord.com"]) {
                    display: none !important;
                }

                .excalidraw-wrapper .dropdown-menu-group:has(a[href*="github.com/excalidraw"]),
                .excalidraw-wrapper .dropdown-menu-group:has(a[href*="x.com/excalidraw"]),
                .excalidraw-wrapper .dropdown-menu-group:has(a[href*="twitter.com/excalidraw"]),
                .excalidraw-wrapper .dropdown-menu-group:has(a[href*="discord.gg"]),
                .excalidraw-wrapper .dropdown-menu-group:has(a[href*="discord.com"]) {
                    display: none !important;
                }

                .excalidraw-wrapper a[href*="github.com/excalidraw"],
                .excalidraw-wrapper a[href*="x.com/excalidraw"],
                .excalidraw-wrapper a[href*="twitter.com/excalidraw"],
                .excalidraw-wrapper a[href*="discord.gg"],
                .excalidraw-wrapper a[href*="discord.com"],
                .excalidraw-wrapper a[href*="discord.gg/excalidraw"],
                .excalidraw-wrapper a[href*="discord.com/invite"] {
                    display: none !important;
                }
            `}</style>
        </div>
    );
}
