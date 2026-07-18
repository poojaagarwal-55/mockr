"use client";

import { useRef, useEffect, useCallback } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useTheme } from "next-themes";
import { registerLatexLanguage, getLatexThemeRules } from "./latex-language";

interface LatexSourceEditorProps {
    value: string;
    onChange: (value: string) => void;
    onAiRewrite?: (selectedText: string) => void;
    onAiFix?: () => void;
    errors?: { line: number; message: string; severity: "error" | "warning" }[];
    highlightRanges?: { startLine: number; endLine: number }[];
    onClearHighlights?: () => void;
}

let languageRegistered = false;

export function LatexSourceEditor({
    value,
    onChange,
    onAiRewrite,
    onAiFix,
    errors,
    highlightRanges,
    onClearHighlights,
}: LatexSourceEditorProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);
    const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

    const handleMount: OnMount = useCallback(
        (editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;

            // Register LaTeX language once
            if (!languageRegistered) {
                registerLatexLanguage(monaco);
                languageRegistered = true;
            }

            // Define custom themes with LaTeX token colors
            monaco.editor.defineTheme("latex-dark", {
                base: "vs-dark",
                inherit: true,
                rules: getLatexThemeRules(true),
                colors: {
                    "editor.background": "#1a1a1a",
                    "editor.foreground": "#d4d4d4",
                },
            });

            monaco.editor.defineTheme("latex-light", {
                base: "vs",
                inherit: true,
                rules: getLatexThemeRules(false),
                colors: {},
            });

            editor.updateOptions({
                theme: isDark ? "latex-dark" : "latex-light",
            });

            // Add context menu actions for AI
            if (onAiRewrite) {
                editor.addAction({
                    id: "latex-ai-rewrite",
                    label: "Rewrite with AI",
                    contextMenuGroupId: "9_ai",
                    contextMenuOrder: 1,
                    run: (ed) => {
                        const selection = ed.getSelection();
                        if (selection) {
                            const text = ed.getModel()?.getValueInRange(selection);
                            if (text) onAiRewrite(text);
                        }
                    },
                });
            }

            if (onAiFix) {
                editor.addAction({
                    id: "latex-ai-fix",
                    label: "Fix Errors with AI",
                    contextMenuGroupId: "9_ai",
                    contextMenuOrder: 2,
                    run: () => onAiFix(),
                });
            }
        },
        [isDark, onAiRewrite, onAiFix]
    );

    // Update theme when dark mode changes
    useEffect(() => {
        if (monacoRef.current) {
            monacoRef.current.editor.setTheme(isDark ? "latex-dark" : "latex-light");
        }
    }, [isDark]);

    // Set error markers
    useEffect(() => {
        if (!monacoRef.current || !editorRef.current) return;

        const model = editorRef.current.getModel();
        if (!model) return;

        const lineCount = model.getLineCount();

        const markers: Monaco.editor.IMarkerData[] = (errors || [])
            .filter((err) => Number.isFinite(err.line) && err.line > 0)
            .map((err) => {
                const safeLine = Math.max(1, Math.min(lineCount, err.line));

                return {
                    severity:
                        err.severity === "error"
                            ? monacoRef.current!.MarkerSeverity.Error
                            : monacoRef.current!.MarkerSeverity.Warning,
                    startLineNumber: safeLine,
                    startColumn: 1,
                    endLineNumber: safeLine,
                    endColumn: model.getLineMaxColumn(safeLine),
                    message: err.message,
                };
            });

        monacoRef.current.editor.setModelMarkers(model, "latex-compiler", markers);
    }, [errors]);

    // Apply AI change highlights
    useEffect(() => {
        if (!editorRef.current || !monacoRef.current) return;

        decorationsRef.current?.clear();
        decorationsRef.current = null;

        if (!highlightRanges || highlightRanges.length === 0) return;

        const decorations: Monaco.editor.IModelDeltaDecoration[] = highlightRanges.map((range) => ({
            range: new monacoRef.current!.Range(range.startLine, 1, range.endLine, Number.MAX_SAFE_INTEGER),
            options: {
                isWholeLine: true,
                className: "ai-change-highlight",
                linesDecorationsClassName: "ai-change-gutter",
                overviewRulerColor: "#22c55e",
                overviewRulerLane: monacoRef.current!.editor.OverviewRulerLane.Left,
            },
        }));

        decorationsRef.current = editorRef.current.createDecorationsCollection(decorations);
    }, [highlightRanges]);

    return (
        <Editor
            defaultLanguage="latex"
            value={value}
            onChange={(v) => {
                onChange(v ?? "");
                if (onClearHighlights && decorationsRef.current) onClearHighlights();
            }}
            onMount={handleMount}
            theme={isDark ? "latex-dark" : "latex-light"}
            options={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 14,
                lineHeight: 22,
                minimap: { enabled: false },
                wordWrap: "on",
                lineNumbers: "on",
                renderLineHighlight: "line",
                scrollBeyondLastLine: false,
                padding: { top: 12 },
                automaticLayout: true,
                tabSize: 2,
                suggestOnTriggerCharacters: true,
                smoothScrolling: true,
                mouseWheelScrollSensitivity: 1,
                scrollbar: {
                    verticalScrollbarSize: 7,
                    horizontalScrollbarSize: 7,
                    arrowSize: 0,
                    useShadows: false,
                },
            }}
        />
    );
}
