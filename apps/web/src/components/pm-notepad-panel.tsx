"use client";

import { useEffect, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

interface PMNotepadPanelProps {
    /** Initial markdown-like content to pre-populate the editor */
    initialContent: string;
    /** Called on every content change — use for autosave to session state */
    onContentChange?: (html: string) => void;
    /** Called when the close button is clicked */
    onClose?: () => void;
    /** Optional topic label shown in the header */
    topic?: string;
    isDark?: boolean;
}

export default function PMNotepadPanel({
    initialContent,
    onContentChange,
    onClose,
    topic = "Product Case",
    isDark = false,
}: PMNotepadPanelProps) {
    const editor = useEditor({
        extensions: [StarterKit],
        content: initialContent,
        editorProps: {
            attributes: {
                class: [
                    "prose prose-sm max-w-none focus:outline-none",
                    "min-h-[300px] px-4 py-3",
                    isDark
                        ? "prose-invert text-slate-200"
                        : "text-slate-800",
                ].join(" "),
            },
        },
        onUpdate: ({ editor }) => {
            onContentChange?.(editor.getHTML());
        },
    });

    // Update content when initialContent prop changes (e.g. template loaded)
    useEffect(() => {
        if (editor && initialContent && editor.isEmpty) {
            editor.commands.setContent(initialContent);
        }
    }, [editor, initialContent]);

    // Update editor classes when isDark changes
    useEffect(() => {
        if (editor) {
            editor.setOptions({
                editorProps: {
                    attributes: {
                        class: [
                            "prose prose-sm max-w-none focus:outline-none",
                            "min-h-[300px] px-4 py-3",
                            isDark
                                ? "prose-invert text-slate-200"
                                : "text-slate-800",
                        ].join(" "),
                    },
                },
            });
        }
    }, [editor, isDark]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            // Allow Tab for indentation inside the editor
            if (e.key === "Tab") {
                e.preventDefault();
                editor?.commands.insertContent("    ");
            }
        },
        [editor]
    );

    return (
        <div
            className="flex flex-col h-full overflow-hidden bg-white dark:bg-lc-surface"
            role="region"
            aria-label="PM Notepad"
        >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface px-4 h-12 shrink-0">
                <div className="flex items-center gap-2">
                    <span
                        className="material-symbols-outlined text-[18px] text-violet-500"
                        aria-hidden="true"
                    >
                        edit_note
                    </span>
                    <span className="text-sm font-bold text-slate-700 dark:text-white">
                        {topic}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 uppercase tracking-wide">
                        Notepad
                    </span>
                </div>

                {onClose && (
                    <button
                        onClick={onClose}
                        className="flex items-center justify-center size-7 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors"
                        aria-label="Close notepad"
                    >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                            close
                        </span>
                    </button>
                )}
            </div>

            {/* Minimal toolbar */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-100 dark:border-lc-border bg-slate-50 dark:bg-lc-bg shrink-0">
                <button
                    onClick={() => editor?.chain().focus().toggleBold().run()}
                    className={[
                        "px-2 py-1 text-xs font-bold rounded transition-colors",
                        editor?.isActive("bold")
                            ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300"
                            : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-lc-hover",
                    ].join(" ")}
                    aria-label="Bold"
                    aria-pressed={editor?.isActive("bold")}
                >
                    B
                </button>
                <button
                    onClick={() => editor?.chain().focus().toggleItalic().run()}
                    className={[
                        "px-2 py-1 text-xs italic rounded transition-colors",
                        editor?.isActive("italic")
                            ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300"
                            : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-lc-hover",
                    ].join(" ")}
                    aria-label="Italic"
                    aria-pressed={editor?.isActive("italic")}
                >
                    I
                </button>
                <div className="w-px h-4 bg-slate-200 dark:bg-lc-border mx-1" aria-hidden="true" />
                <button
                    onClick={() => editor?.chain().focus().toggleBulletList().run()}
                    className={[
                        "px-2 py-1 text-xs rounded transition-colors",
                        editor?.isActive("bulletList")
                            ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300"
                            : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-lc-hover",
                    ].join(" ")}
                    aria-label="Bullet list"
                    aria-pressed={editor?.isActive("bulletList")}
                >
                    • List
                </button>
                <button
                    onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                    className={[
                        "px-2 py-1 text-xs rounded transition-colors",
                        editor?.isActive("heading", { level: 2 })
                            ? "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300"
                            : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-lc-hover",
                    ].join(" ")}
                    aria-label="Heading"
                    aria-pressed={editor?.isActive("heading", { level: 2 })}
                >
                    H2
                </button>
                <div className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
                    Autosaved
                </div>
            </div>

            {/* Editor area */}
            <div
                className="flex-1 overflow-y-auto"
                onKeyDown={handleKeyDown}
            >
                <EditorContent
                    editor={editor}
                    className="h-full"
                />
            </div>
        </div>
    );
}
