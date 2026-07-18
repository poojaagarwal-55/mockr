"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

interface Props {
    isDark: boolean;
    initialElements?: any[];
    onSceneChange?: (elements: any[]) => void;
}

// Embeds Excalidraw with its default drawing toolbar (matches what's
// shown in the live System Design interview). No custom header bar —
// the canvas fills the whole panel.
export default function SystemDesignScratchpad({ isDark, initialElements, onSceneChange }: Props) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const hasLoadedInitialSceneRef = useRef(false);
    const initialData = useMemo(
        () => (initialElements?.length ? { elements: initialElements } : undefined),
        [initialElements]
    );

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

    useEffect(() => {
        if (!mounted || hasLoadedInitialSceneRef.current || !initialElements?.length || !apiRef.current) return;
        try {
            (apiRef.current as any).updateScene({ elements: initialElements });
            hasLoadedInitialSceneRef.current = true;
        } catch {}
    }, [initialElements, mounted]);

    if (!mounted) return null;

    return (
        <div className="excalidraw-wrapper" style={{ height: "100%", width: "100%", position: "relative", overflow: "hidden" }}>
            <Excalidraw
                excalidrawAPI={(api) => {
                    apiRef.current = api;
                }}
                initialData={initialData}
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

            <style jsx global>{`
                .excalidraw-wrapper .library-button,
                .excalidraw-wrapper [aria-label="Library"],
                .excalidraw-wrapper [title="Library"],
                .excalidraw-wrapper .ToolIcon__library,
                .excalidraw-wrapper button[data-testid="toolbar-library"] {
                    display: none !important;
                }

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
                .excalidraw-wrapper a[href*="discord.com"] {
                    display: none !important;
                }

                /* Move the bottom-left footer (hamburger menu, zoom controls,
                   undo/redo) to a vertical strip on the LEFT side of the
                   canvas — same controls, just reoriented. */
                .excalidraw-wrapper .layer-ui__wrapper__footer-left,
                .excalidraw-wrapper section[aria-label="zoom"],
                .excalidraw-wrapper section[aria-label="Footer"] .Stack_horizontal:has([aria-label*="Undo"]),
                .excalidraw-wrapper section[aria-label="Footer"] .Stack_horizontal:has([aria-label*="Zoom"]) {
                    flex-direction: column !important;
                }

                .excalidraw-wrapper .layer-ui__wrapper__footer-left {
                    position: absolute !important;
                    left: 0.5rem !important;
                    top: 50% !important;
                    bottom: auto !important;
                    transform: translateY(-50%) !important;
                    flex-direction: column !important;
                    gap: 0.5rem !important;
                    align-items: flex-start !important;
                }

                .excalidraw-wrapper .layer-ui__wrapper__footer-left .Stack,
                .excalidraw-wrapper .layer-ui__wrapper__footer-left .Stack_horizontal {
                    flex-direction: column !important;
                    gap: 0.4rem !important;
                }

                /* Background pill for the zoom group becomes vertical too */
                .excalidraw-wrapper .layer-ui__wrapper__footer-left .ToolIcon__keybinding,
                .excalidraw-wrapper .layer-ui__wrapper__footer-left .HintViewer {
                    display: none !important;
                }
            `}</style>
        </div>
    );
}
