"use client";

import { useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

interface Props {
    elements: any[];
}

export default function DiagramViewer({ elements }: Props) {
    const [mounted, setMounted] = useState(false);
    const [isDark, setIsDark] = useState(false);
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

    useEffect(() => {
        setMounted(true);
        // Check dark mode
        const dark = document.documentElement.classList.contains("dark");
        setIsDark(dark);
        
        const observer = new MutationObserver(() => {
            setIsDark(document.documentElement.classList.contains("dark"));
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (apiRef.current && elements) {
            apiRef.current.updateScene({ elements });
        }
    }, [elements]);

    if (!mounted) {
        return (
            <div className="h-64 bg-slate-100 dark:bg-[#1e1e1e] flex items-center justify-center">
                <span className="text-slate-400">Loading diagram...</span>
            </div>
        );
    }

    return (
        <div className="excalidraw-viewer" style={{ height: "300px", width: "100%", position: "relative", overflow: "hidden" }}>
            <Excalidraw
                initialData={{ elements }}
                excalidrawAPI={(api) => {
                    apiRef.current = api;
                }}
                theme={isDark ? "dark" : "light"}
                viewModeEnabled={true}
                UIOptions={{
                    canvasActions: {
                        loadScene: false,
                        export: false,
                        saveToActiveFile: false,
                    },
                }}
                renderTopRightUI={() => null}
            />
            
            <style jsx global>{`
                .excalidraw-viewer .layer-ui__wrapper,
                .excalidraw-viewer .footer-left,
                .excalidraw-viewer section[aria-label="zoom"],
                .excalidraw-viewer [aria-label="zoom"],
                .excalidraw-viewer .ToolIcon__keybinding,
                .excalidraw-viewer .HintViewer,
                .excalidraw-viewer .layer-ui__wrapper__footer-left {
                    display: none !important;
                }
            `}</style>
        </div>
    );
}