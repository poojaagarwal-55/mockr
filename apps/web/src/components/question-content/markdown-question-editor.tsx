"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { RichQuestionContent } from "./rich-question-content";

type MarkdownQuestionEditorProps = {
    value: string;
    onChange: (value: string) => void;
    label?: ReactNode;
    required?: boolean;
    rows?: number;
    placeholder?: string;
    uploadEnabled?: boolean;
    previewEnabled?: boolean;
};

type UploadedQuestionImage = {
    id: string;
    url: string;
    alt: string;
    markdown: string;
};

type DraggedGalleryImage = {
    rowIndex: number;
    imageIndex: number;
};

function makeImageId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fileNameToAlt(filename: string) {
    return filename
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w\s-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "question image";
}

type PendingUpload = { file: File; type: "single" | "gallery"; rowOverride?: number };

export function MarkdownQuestionEditor({
    value,
    onChange,
    label,
    required,
    rows = 12,
    placeholder = "Write with Markdown. Use $n^2$ for inline math, $$...$$ for formulas, and the image buttons to insert diagrams or layouts.",
    uploadEnabled = true,
    previewEnabled = true,
}: MarkdownQuestionEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const galleryFileInputRef = useRef<HTMLInputElement | null>(null);
    const [isPreviewOpen, setIsPreviewOpen] = useState(true);
    const [pendingFile, setPendingFile] = useState<PendingUpload | null>(null);
    const [resizeWidth, setResizeWidth] = useState<string>("");
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [galleryRows, setGalleryRows] = useState<UploadedQuestionImage[][]>([[]]);
    const [targetGalleryRow, setTargetGalleryRow] = useState(0);
    const [draggedImage, setDraggedImage] = useState<DraggedGalleryImage | null>(null);

    const insertText = (text: string, selectionOffset = text.length) => {
        const textarea = textareaRef.current;
        if (!textarea) {
            onChange(`${value}${text}`);
            return;
        }

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
        onChange(nextValue);

        requestAnimationFrame(() => {
            textarea.focus();
            const cursor = start + selectionOffset;
            textarea.setSelectionRange(cursor, cursor);
        });
    };

    const insertBlock = (block: string) => {
        const prefix = value.trim() ? "\n\n" : "";
        insertText(`${prefix}${block}\n\n`);
    };

    const uploadImage = async (file: File, targetWidth?: number): Promise<UploadedQuestionImage> => {
        if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
            throw new Error("Upload a PNG, JPEG, or WebP image.");
        }

        if (file.size > 5 * 1024 * 1024) {
            throw new Error("Image must be under 5MB.");
        }

        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
            throw new Error("Please sign in again before uploading images.");
        }

        let uploadBlob: Blob;
        if (targetWidth && targetWidth > 0) {
            uploadBlob = await new Promise<Blob>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    if (width > targetWidth) {
                        height = Math.round((height * targetWidth) / width);
                        width = targetWidth;
                    }
                    const canvas = document.createElement("canvas");
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) return reject(new Error("Canvas not supported"));
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error("Failed to create blob"));
                    }, file.type, 0.9);
                };
                img.onerror = () => reject(new Error("Invalid image"));
                img.src = URL.createObjectURL(file);
            });
        } else {
            uploadBlob = new Blob([await file.arrayBuffer()], { type: file.type });
        }
        
        const formData = new FormData();
        formData.append("image", uploadBlob, file.name);

        const result = await apiFetch<{ url: string; markdown?: string; alt?: string }>(
            "/contest-question-assets/images",
            {
                method: "POST",
                body: formData,
                token,
            }
        );

        const alt = result.alt || fileNameToAlt(file.name);
        const markdown = result.markdown || `![${alt}](${result.url})`;
        return {
            id: makeImageId(),
            url: result.url,
            alt,
            markdown,
        };
    };

    const handleUpload = (file: File | null | undefined) => {
        if (!file) return;
        setPendingFile({ file, type: "single" });
        setResizeWidth("");
    };

    const handleGalleryUpload = (file: File | null | undefined, rowOverride?: number) => {
        if (!file) return;
        setPendingFile({ file, type: "gallery", rowOverride });
        setResizeWidth("");
    };

    const processPendingUpload = async () => {
        if (!pendingFile) return;
        const { file, type, rowOverride } = pendingFile;
        const targetWidth = parseInt(resizeWidth, 10) || undefined;
        setPendingFile(null);

        setError(null);
        setIsUploading(true);
        try {
            const image = await uploadImage(file, targetWidth);
            if (type === "single") {
                let md = image.markdown;
                if (targetWidth && !md.includes("|width=")) {
                    md = md.replace("](", `|width=${targetWidth}](`);
                }
                insertText(`\n\n${md}\n\n`);
            } else {
                setGalleryRows((current) => {
                    const rowsCopy = current.length ? current.map((row) => [...row]) : [[]];
                    const wantedRow = typeof rowOverride === "number" ? rowOverride : targetGalleryRow;
                    const rowIndex = Math.max(0, Math.min(wantedRow, rowsCopy.length - 1));
                    rowsCopy[rowIndex] = [...rowsCopy[rowIndex], image];
                    return rowsCopy;
                });
            }
        } catch (uploadError: any) {
            setError(uploadError?.message || "Failed to upload image.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
            if (galleryFileInputRef.current) galleryFileInputRef.current.value = "";
        }
    };

    const addGalleryRow = () => {
        setGalleryRows((current) => [...current, []]);
    };

    const removeGalleryRow = (rowIndex: number) => {
        setGalleryRows((current) => {
            const nextRows = current.filter((_, index) => index !== rowIndex);
            return nextRows.length ? nextRows : [[]];
        });
    };

    const removeGalleryImage = (rowIndex: number, imageIndex: number) => {
        setGalleryRows((current) => {
            const nextRows = current.map((row) => [...row]);
            nextRows[rowIndex]?.splice(imageIndex, 1);
            return nextRows.length ? nextRows : [[]];
        });
    };

    const moveGalleryImage = (toRowIndex: number, toImageIndex?: number) => {
        if (!draggedImage) return;

        setGalleryRows((current) => {
            const nextRows = current.map((row) => [...row]);
            const sourceRow = nextRows[draggedImage.rowIndex];
            if (!sourceRow) return current;
            const [image] = sourceRow.splice(draggedImage.imageIndex, 1);
            if (!image) return current;

            if (!nextRows[toRowIndex]) nextRows[toRowIndex] = [];
            const targetRow = nextRows[toRowIndex];
            const targetIndex = typeof toImageIndex === "number" ? Math.max(0, Math.min(toImageIndex, targetRow.length)) : targetRow.length;
            targetRow.splice(targetIndex, 0, image);

            return nextRows.filter((row, index) => row.length > 0 || index === toRowIndex || nextRows.length === 1);
        });
        setDraggedImage(null);
    };

    const handleGalleryDrop = (event: DragEvent, rowIndex: number, imageIndex?: number) => {
        event.preventDefault();
        event.stopPropagation();
        const droppedFile = event.dataTransfer.files?.[0];
        if (droppedFile) {
            void handleGalleryUpload(droppedFile, rowIndex);
            return;
        }
        moveGalleryImage(rowIndex, imageIndex);
    };

    const insertGallery = () => {
        const filledRows = galleryRows
            .map((row) => row.filter(Boolean))
            .filter((row) => row.length > 0);

        if (!filledRows.length) {
            setError("Add at least one image before inserting an image layout.");
            return;
        }

        const body = filledRows
            .map((row) => row.map((image) => `![${image.alt}](${image.url})`).join("\n"))
            .join("\n---\n");

        insertBlock(`:::gallery\n${body}\n:::`);
        setGalleryOpen(false);
        setGalleryRows([[]]);
    };

    return (
        <div className="space-y-3">
            {label && (
                <div className="block text-sm font-extrabold text-gray-700 dark:text-slate-100">
                    {label} {required && <span className="text-red-500">*</span>}
                </div>
            )}

            <div className="overflow-hidden rounded-xl border border-gray-300 bg-white dark:border-lc-border dark:bg-lc-input">
                <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-slate-50 px-3 py-2 dark:border-lc-border dark:bg-[#242424]">
                    <button
                        type="button"
                        onClick={() => insertText("$x$", 2)}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                    >
                        Inline math
                    </button>
                    <button
                        type="button"
                        onClick={() => insertText("\n$$\nformula\n$$\n", 4)}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                    >
                        Formula
                    </button>
                    <button
                        type="button"
                        onClick={() => insertText("`code`", 1)}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                    >
                        Code
                    </button>
                    <button
                        type="button"
                        onClick={() => insertBlock(":::note Key observation\nWrite the main idea or a useful invariant here.\n:::")}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                    >
                        Note
                    </button>
                    <button
                        type="button"
                        onClick={() => insertBlock(":::warning Edge case\nMention a tricky case, overflow risk, or boundary condition here.\n:::")}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                    >
                        Edge case
                    </button>
                    <button
                        type="button"
                        onClick={() => insertBlock(":::io Input format\n- First line: integer `n`\n- Second line: `n` space-separated integers\n\nOutput one integer: the required answer.\n:::")}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                    >
                        I/O block
                    </button>
                    <button
                        type="button"
                        onClick={() => insertBlock(":::complexity Expected solution\nTime: $O(n log n)$\n\nSpace: $O(1)$\n:::")}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                    >
                        Complexity
                    </button>
                    <button
                        type="button"
                        onClick={() => insertBlock(":::figure Diagram\nUpload or paste an image inside this block, then add a short caption.\n:::")}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#333333] dark:hover:text-white"
                    >
                        Figure
                    </button>
                    {uploadEnabled && (
                        <>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploading}
                                className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-primary transition hover:bg-primary/10 disabled:cursor-wait disabled:opacity-60"
                            >
                                {isUploading ? "Uploading..." : "Insert image"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setGalleryOpen((current) => !current)}
                                disabled={isUploading}
                                className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-primary transition hover:bg-primary/10 disabled:cursor-wait disabled:opacity-60"
                            >
                                Image layout
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={(event) => handleUpload(event.target.files?.[0])}
                            />
                            <input
                                ref={galleryFileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={(event) => handleGalleryUpload(event.target.files?.[0])}
                            />
                        </>
                    )}
                    {previewEnabled && (
                        <button
                            type="button"
                            onClick={() => setIsPreviewOpen((current) => !current)}
                            className="ml-auto rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-500 transition hover:bg-white hover:text-slate-950 dark:text-slate-400 dark:hover:bg-[#333333] dark:hover:text-white"
                        >
                            {isPreviewOpen ? "Hide preview" : "Show preview"}
                        </button>
                    )}
                </div>
                {pendingFile && (
                <div className="flex flex-wrap items-center gap-3 rounded-t-xl bg-primary/5 px-4 py-3 border-b border-primary/10">
                    <span className="text-sm font-extrabold text-primary">Image Options:</span>
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 max-w-[200px] truncate">{pendingFile.file.name}</span>
                    <input 
                        type="number" 
                        value={resizeWidth}
                        onChange={(e) => setResizeWidth(e.target.value)}
                        placeholder="Max width (px, optional)" 
                        className="ml-auto w-48 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold dark:border-[#333] dark:bg-[#111] dark:text-white"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') processPendingUpload(); }}
                    />
                    <button 
                        type="button" 
                        onClick={() => {
                            setPendingFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                            if (galleryFileInputRef.current) galleryFileInputRef.current.value = "";
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-slate-500 hover:bg-slate-200 dark:hover:bg-[#333]"
                    >
                        Cancel
                    </button>
                    <button 
                        type="button" 
                        onClick={processPendingUpload}
                        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-extrabold text-white hover:bg-primary/90"
                    >
                        Upload
                    </button>
                </div>
            )}
            <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    required={required}
                    rows={rows}
                    className="block w-full resize-y bg-transparent px-4 py-3 font-mono text-sm leading-6 text-gray-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
                    placeholder={placeholder}
                />
            </div>

            {uploadEnabled && galleryOpen && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-lc-border dark:bg-[#202020]">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                Image layout
                            </div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                                Build rows, drag images between rows, then insert one layout block.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={addGalleryRow}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-extrabold text-slate-700 transition hover:bg-white dark:border-lc-border dark:text-slate-200 dark:hover:bg-[#2b2b2b]"
                            >
                                Add row
                            </button>
                            <button
                                type="button"
                                onClick={insertGallery}
                                className="rounded-lg bg-primary px-4 py-2 text-sm font-extrabold text-white transition hover:bg-primary/90"
                            >
                                Insert layout
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {galleryRows.map((row, rowIndex) => (
                            <div
                                key={rowIndex}
                                className="rounded-xl border border-dashed border-slate-300 bg-white p-3 dark:border-lc-border dark:bg-[#181818]"
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleGalleryDrop(event, rowIndex)}
                            >
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                        Row {rowIndex + 1}
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTargetGalleryRow(rowIndex);
                                                galleryFileInputRef.current?.click();
                                            }}
                                            disabled={isUploading}
                                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60 dark:bg-[#2b2b2b] dark:text-slate-200 dark:hover:bg-[#333333]"
                                        >
                                            {isUploading && targetGalleryRow === rowIndex ? "Uploading..." : "Add image"}
                                        </button>
                                        {galleryRows.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeGalleryRow(rowIndex)}
                                                className="rounded-lg px-2 py-1.5 text-xs font-extrabold text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
                                                aria-label={`Remove image row ${rowIndex + 1}`}
                                            >
                                                Remove row
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {row.length > 0 ? (
                                    <div
                                        className="grid gap-3"
                                        style={{ gridTemplateColumns: `repeat(${Math.min(row.length, 4)}, minmax(0, 1fr))` }}
                                    >
                                        {row.map((image, imageIndex) => (
                                            <div
                                                key={image.id}
                                                draggable
                                                onDragStart={() => setDraggedImage({ rowIndex, imageIndex })}
                                                onDragEnd={() => setDraggedImage(null)}
                                                onDragOver={(event) => event.preventDefault()}
                                                onDrop={(event) => handleGalleryDrop(event, rowIndex, imageIndex)}
                                                className="group relative cursor-grab overflow-hidden rounded-lg border border-slate-200 bg-slate-50 active:cursor-grabbing dark:border-lc-border dark:bg-[#242424]"
                                                title="Drag to move this image"
                                            >
                                                <img
                                                    src={image.url}
                                                    alt={image.alt}
                                                    className="h-32 w-full object-contain"
                                                />
                                                <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                                    <span className="truncate">{image.alt}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeGalleryImage(rowIndex, imageIndex)}
                                                        className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                                                        aria-label={`Remove ${image.alt}`}
                                                    >
                                                        <span className="material-symbols-outlined block text-[16px] leading-none">close</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTargetGalleryRow(rowIndex);
                                            galleryFileInputRef.current?.click();
                                        }}
                                        className="flex min-h-28 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm font-extrabold text-slate-500 transition hover:border-primary hover:text-primary dark:border-lc-border dark:text-slate-400"
                                    >
                                        Drop images here or click to upload
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                    {error}
                </div>
            )}

            {previewEnabled && isPreviewOpen && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-[#1f1f1f]">
                    <div className="mb-3 text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        Live preview
                    </div>
                    <RichQuestionContent
                        content={value}
                        emptyState={
                            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                                Preview appears as you write.
                            </p>
                        }
                    />
                </div>
            )}
        </div>
    );
}
