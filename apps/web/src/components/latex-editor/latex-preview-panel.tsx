"use client";

import { useCallback, useRef, useState } from "react";
import { useTheme } from "next-themes";

interface LatexPreviewPanelProps {
    compiling: boolean;
    compiledPdfUrl?: string | null;
    previewVersion?: number;
}

export function LatexPreviewPanel({
    compiling,
    compiledPdfUrl,
    previewVersion = 0,
}: LatexPreviewPanelProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const viewportRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [zoomAnchor, setZoomAnchor] = useState({ x: 0.5, y: 0.5 });

    const MIN_ZOOM = 1;
    const MAX_ZOOM = 2.5;
    const ZOOM_STEP = 0.2;
    const PAN_STEP = 90;

    const getPdfEmbedUrl = useCallback((url: string) => {
        const cleanUrl = url.split("#")[0];
        return `${cleanUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=1`;
    }, []);

    const clampScroll = useCallback((viewport: HTMLDivElement, left: number, top: number) => {
        const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
        const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

        return {
            left: Math.max(0, Math.min(maxLeft, left)),
            top: Math.max(0, Math.min(maxTop, top)),
        };
    }, []);

    const handleSetAnchor = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const rect = viewport.getBoundingClientRect();
        const anchorX = (event.clientX - rect.left) / rect.width;
        const anchorY = (event.clientY - rect.top) / rect.height;

        setZoomAnchor({
            x: Math.max(0, Math.min(1, anchorX)),
            y: Math.max(0, Math.min(1, anchorY)),
        });
    }, []);

    const changeZoom = useCallback((direction: "in" | "out") => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const nextZoom = direction === "in"
            ? Math.min(MAX_ZOOM, Number((zoom + ZOOM_STEP).toFixed(2)))
            : Math.max(MIN_ZOOM, Number((zoom - ZOOM_STEP).toFixed(2)));

        if (nextZoom === zoom) return;

        const anchorPxX = zoomAnchor.x * viewport.clientWidth;
        const anchorPxY = zoomAnchor.y * viewport.clientHeight;

        const contentX = viewport.scrollLeft + anchorPxX;
        const contentY = viewport.scrollTop + anchorPxY;

        const nextScrollLeft = (contentX / zoom) * nextZoom - anchorPxX;
        const nextScrollTop = (contentY / zoom) * nextZoom - anchorPxY;

        setZoom(nextZoom);

        requestAnimationFrame(() => {
            const target = viewportRef.current;
            if (!target) return;

            const clamped = clampScroll(target, nextScrollLeft, nextScrollTop);
            target.scrollTo({ left: clamped.left, top: clamped.top, behavior: "auto" });
        });
    }, [clampScroll, zoom, zoomAnchor.x, zoomAnchor.y]);

    const movePreview = useCallback((dx: number, dy: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const clamped = clampScroll(
            viewport,
            viewport.scrollLeft + dx,
            viewport.scrollTop + dy
        );

        viewport.scrollTo({ left: clamped.left, top: clamped.top, behavior: "smooth" });
    }, [clampScroll]);

    const moveButtonClass = "h-8 w-8 grid place-items-center text-black leading-none";
    const moveIconClass = "material-symbols-outlined text-[24px] leading-none";

    return (
        <div className="h-full overflow-hidden relative">
            <div
                ref={viewportRef}
                className="h-full overflow-auto monaco-like-scrollbar"
                onMouseDown={handleSetAnchor}
            >
                {compiling ? (
                    <div className={`flex items-center justify-center h-full ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                        <div className="text-center">
                            <span className="material-symbols-outlined text-4xl mb-3 block animate-spin text-blue-500">progress_activity</span>
                            <p className="text-sm font-medium">Compiling PDF Preview...</p>
                        </div>
                    </div>
                ) : compiledPdfUrl ? (
                    <div
                        className="origin-top-left"
                        style={{
                            width: `${zoom * 100}%`,
                            height: `${zoom * 100}%`,
                            minWidth: "100%",
                            minHeight: "100%",
                        }}
                    >
                        <iframe
                            key={`${compiledPdfUrl}-${previewVersion}`}
                            src={getPdfEmbedUrl(compiledPdfUrl)}
                            className="w-full h-full border-0"
                            scrolling="no"
                            title="Compiled PDF"
                        />
                    </div>
                ) : (
                    <div className={`flex items-center justify-center h-full ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                        <div className="text-center">
                            <span className="material-symbols-outlined text-4xl mb-2 block">picture_as_pdf</span>
                            <p className="text-sm">Compile PDF to see the preview</p>
                        </div>
                    </div>
                )}
            </div>

            {compiledPdfUrl && !compiling && (
                <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                    <div className={`flex items-center rounded-lg border backdrop-blur-sm ${
                        isDark ? "border-white/15 bg-black/45" : "border-black/10 bg-white/90"
                    }`}>
                        <button
                            type="button"
                            onClick={() => changeZoom("out")}
                            className={`h-8 w-8 grid place-items-center transition-colors ${
                                isDark ? "text-gray-200 hover:bg-white/10" : "text-gray-700 hover:bg-black/5"
                            }`}
                            title="Zoom out"
                            aria-label="Zoom out"
                        >
                            <span className="material-symbols-outlined text-[18px]">remove</span>
                        </button>
                        <div className={`px-2 text-xs font-medium min-w-[52px] text-center ${isDark ? "text-gray-200" : "text-gray-700"}`}>
                            {Math.round(zoom * 100)}%
                        </div>
                        <button
                            type="button"
                            onClick={() => changeZoom("in")}
                            className={`h-8 w-8 grid place-items-center transition-colors ${
                                isDark ? "text-gray-200 hover:bg-white/10" : "text-gray-700 hover:bg-black/5"
                            }`}
                            title="Zoom in"
                            aria-label="Zoom in"
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                    </div>
                </div>
            )}

            {compiledPdfUrl && !compiling && zoom > 1 && (
                <div className="absolute right-3 top-14 z-10 grid grid-cols-3 grid-rows-3 gap-1 select-none">
                    <div className="h-8 w-8" aria-hidden="true" />
                    <button
                        type="button"
                        onClick={() => movePreview(0, -PAN_STEP)}
                        className={`${moveButtonClass} row-start-1 col-start-2`}
                        title="Move up"
                        aria-label="Move up"
                    >
                        <span className={moveIconClass}>expand_less</span>
                    </button>
                    <div className="h-8 w-8" aria-hidden="true" />
                    <button
                        type="button"
                        onClick={() => movePreview(-PAN_STEP, 0)}
                        className={`${moveButtonClass} row-start-2 col-start-1`}
                        title="Move left"
                        aria-label="Move left"
                    >
                        <span className={`${moveIconClass} -rotate-90`}>expand_less</span>
                    </button>
                    <div className="h-8 w-8" aria-hidden="true" />
                    <button
                        type="button"
                        onClick={() => movePreview(PAN_STEP, 0)}
                        className={`${moveButtonClass} row-start-2 col-start-3`}
                        title="Move right"
                        aria-label="Move right"
                    >
                        <span className={`${moveIconClass} rotate-90`}>expand_less</span>
                    </button>
                    <div className="h-8 w-8" aria-hidden="true" />
                    <button
                        type="button"
                        onClick={() => movePreview(0, PAN_STEP)}
                        className={`${moveButtonClass} row-start-3 col-start-2`}
                        title="Move down"
                        aria-label="Move down"
                    >
                        <span className={`${moveIconClass} rotate-180`}>expand_less</span>
                    </button>
                    <div className="h-8 w-8" aria-hidden="true" />
                </div>
            )}
        </div>
    );
}
