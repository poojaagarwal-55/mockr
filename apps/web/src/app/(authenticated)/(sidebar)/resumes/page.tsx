"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { PageHeader } from "@/components/page-header";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { ResumeBuilderModal } from "@/components/latex-editor/resume-builder-modal";

interface ResumeAnalysis {
    overallStrength?: string;
    summary?: {
        name?: string;
        currentRole?: string;
        experience?: string;
        skills?: { category: string; skills: string[] }[];
    };
    strengths?: string[];
    weaknesses?: string[];
    suggestions?: string[];
    score?: number;
}

interface Resume {
    id: string;
    fileName: string;
    fileUrl: string;
    analysis: ResumeAnalysis | null;
    atsAnalysis: any | null;
    uploadedAt: string;
}

interface LatexResumeItem {
    id: string;
    title: string;
    template: string;
    compiledUrl: string | null;
    compiledAt: string | null;
    createdAt: string;
    updatedAt: string;
}

const ROLES = ["Backend SDE", "Frontend SDE", "Fullstack SDE", "Mobile Engineer"];

const RESUME_ANALYZERS = [
    {
        id: "ai",
        label: "Analyze Resume with AI",
        description: "Get instant, deep analysis of your resume formatting, keywords, and impact using our advanced AI to boost your ATS score.",
        href: "/resumes/analyze",
        available: true,
        image: "/resume_ai_doodle.png",
        bgClass: "bg-[#f3f0ff] dark:bg-gradient-to-b dark:from-[#242424] dark:to-[#1a1a1a]",
        badge: null,
    },
    {
        id: "expert",
        label: "Analyze Resume with Professional",
        description: "Connect with an industry expert to deeply review your resume structure, content phrasing, and overall market fit.",
        href: null,
        available: false,
        image: "/resume_expert_doodle.png",
        bgClass: "bg-[#fff4f0] dark:bg-gradient-to-b dark:from-[#242424] dark:to-[#1a1a1a]",
        badge: "Coming Soon",
    },
];

export default function ResumesPage() {
    useEffect(() => { document.title = "Resumes | Mockr"; }, []);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();

    // State
    const [resumes, setResumes] = useState<Resume[]>([]);
    const [latexResumes, setLatexResumes] = useState<LatexResumeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [analyzing, setAnalyzing] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);

    // Modal States
    const [builderOpen, setBuilderOpen] = useState(false);
    const [editingLatexResumeId, setEditingLatexResumeId] = useState<string | null>(null);
    const [builderReturnTo, setBuilderReturnTo] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // Rename state
    const [editingNameId, setEditingNameId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const [renameSaving, setRenameSaving] = useState(false);

    // Preview state — signed URLs for card thumbnails
    const [previewLoading, setPreviewLoading] = useState<string | null>(null);
    const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

    // ── Fetch resumes ────────────────────────────────────────
    const fetchResumes = useCallback(async () => {
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const res = await api.get<{ resumes: Resume[] }>("/resumes", token);
            setResumes(res.resumes || []);
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchResumes();
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            if (params.get("new") === "true") {
                setBuilderOpen(true);
                setEditingLatexResumeId(params.get("editLatexResumeId"));
                setBuilderReturnTo(params.get("returnTo"));
                // optionally remove the query param so refresh doesn't pop it open again
                window.history.replaceState({}, '', window.location.pathname);
            }
        }
    }, [fetchResumes]);

    // Pre-fetch all signed URLs for thumbnails
    useEffect(() => {
        if (resumes.length === 0) return;
        const fetchUrls = async () => {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const results = await Promise.all(
                resumes.map(async (r) => {
                    try {
                        const res = await api.get<{ url: string }>(`/resumes/${r.id}/download`, token);
                        return { id: r.id, url: res.url };
                    } catch {
                        return { id: r.id, url: "" };
                    }
                })
            );
            const urls: Record<string, string> = {};
            results.forEach((r) => { if (r.url) urls[r.id] = r.url; });
            setSignedUrls(urls);
        };
        fetchUrls();
    }, [resumes]);

    // ── Upload ─────────────────────────────────────────────
    const handleFileSelect = (file: File) => {
        if (file.type !== "application/pdf") {
            setUploadError("Only PDF files are accepted");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError("Maximum file size is 5MB");
            return;
        }
        setUploadError(null);
        uploadResume(file);
    };

    const uploadResume = async (file: File) => {
        setUploading(true);
        setUploadError(null);

        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            const formData = new FormData();
            formData.append("file", file);

            const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            const res = await fetch(`${API_BASE}/resumes/upload`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Upload failed");
            }

            const result = await res.json();
            const newResume: Resume = {
                id: result.id,
                fileName: file.name,
                fileUrl: result.fileUrl || "",
                analysis: null,
                atsAnalysis: null,
                uploadedAt: new Date().toISOString(),
            };
            setResumes((prev) => [newResume, ...prev]);
        } catch (err: any) {
            setUploadError(err.message || "Upload failed");
        } finally {
            setUploading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    };

    const handleRename = async (resume: Resume) => {
        const trimmed = editingName.trim();
        const currentName = resume.fileName.replace(/\.pdf$/i, "");
        if (!trimmed || trimmed === currentName) { setEditingNameId(null); setEditingName(""); return; }
        setRenameSaving(true);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const result = await api.patch<{ id: string; fileName: string }>(`/resumes/${resume.id}`, { fileName: trimmed }, token);
            setResumes(prev => prev.map(r => r.id === resume.id ? { ...r, fileName: result.fileName } : r));
            setEditingNameId(null);
            setEditingName("");
        } catch { /* empty */ }
        finally { setRenameSaving(false); }
    };
    // ── Analyze ATS handled in /resumes/analyze ────────────────
    
    // ── Delete ───────────────────────────────────────────────
    const handleDelete = async (id: string) => {
        setDeleting(id);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            await api.delete(`/resumes/${id}`, token);
            setResumes((prev) => prev.filter((r) => r.id !== id));
        } catch (err: any) {
            console.error("Delete failed:", err);
            alert("Delete failed: " + err.message);
        } finally {
            setDeleting(null);
            setDeleteConfirm(null);
        }
    };

    // ── Preview (full-screen) ──────────────────────────────
    const handlePreview = async (resume: Resume) => {
        if (signedUrls[resume.id]) { setPreviewUrl(signedUrls[resume.id]); return; }
        setPreviewLoading(resume.id);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const res = await api.get<{ url: string }>(`/resumes/${resume.id}/download`, token);
            setSignedUrls(prev => ({ ...prev, [resume.id]: res.url }));
            setPreviewUrl(res.url);
        } catch {
            alert("Failed to load preview.");
        } finally {
            setPreviewLoading(null);
        }
    };

    // ── Helpers ──────────────────────────────────────────────
    const formatDate = (d: string) =>
        new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    return (
        <div className="flex-1 overflow-auto">
            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Resumes</h1>} showBack={true} backUrl="/dashboard" />

            <main className="flex-1 flex flex-col items-center py-12 px-4 pb-16">
                <div className="w-full max-w-[1100px] space-y-10">
                    {/* Title */}
                    <div className="text-left space-y-2">
                        <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                            Manage Your Resumes
                        </h1>
                        <p className="text-slate-500 text-base">
                            Upload, preview, and analyze your resumes with AI
                        </p>
                    </div>

                    <div className="w-full">
                        {loading ? (
                            <div className="flex gap-6 pt-2 overflow-x-auto pb-2">
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="w-48 flex flex-col">
                                        <div className="w-48 h-64 rounded-xl bg-slate-100 dark:bg-lc-surface animate-pulse" />
                                        <div className="mt-2 space-y-1.5 px-0.5">
                                            <div className="h-3 bg-slate-100 dark:bg-lc-surface rounded animate-pulse w-3/4" />
                                            <div className="h-2 bg-slate-100 dark:bg-lc-surface rounded animate-pulse w-1/2" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex gap-6 pt-2 overflow-x-auto pb-2">
                            {/* Uploaded resume cards */}
                            {resumes.map((resume) => {
                                const name = resume.fileName.replace(/\.pdf$/i, "");
                                const date = formatDate(resume.uploadedAt);
                                const hasAts = !!resume.atsAnalysis;
                                const atsScore = resume.atsAnalysis?.overallScore;

                                return (
                                    <div key={resume.id} className="group relative w-48 shrink-0 cursor-pointer">
                                        {/* Card — PDF preview centered */}
                                        <div 
                                            onClick={() => handlePreview(resume)}
                                            className="w-48 h-64 rounded-xl border border-slate-200 dark:border-lc-border bg-white shadow-sm overflow-hidden relative transition-all group-hover:shadow-md group-hover:border-primary/40 group-hover:-translate-y-0.5"
                                        >
                                            <div className="absolute inset-0 bg-white" />
                                            {signedUrls[resume.id] ? (
                                                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                                    <iframe
                                                        src={`${signedUrls[resume.id]}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                                        title={name}
                                                        style={{ position: "absolute", top: 0, left: "50%", marginLeft: "-350px", width: "700px", height: "990px", transform: "scale(0.2742)", transformOrigin: "top center", border: "none", background: "white" }}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="absolute inset-0 flex items-center justify-center z-10">
                                                    {previewLoading === resume.id ? (
                                                        <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                                    ) : (
                                                        <span className="material-symbols-outlined text-4xl text-slate-200 dark:text-slate-600">description</span>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* ATS Score badge (if analyzed) */}
                                            {atsScore !== undefined && (
                                                <div className={`absolute top-2 right-2 z-10 px-1.5 py-0.5 text-[9px] font-bold rounded-full ${
                                                    atsScore >= 80 ? 'bg-emerald-100 text-emerald-700' :
                                                    atsScore >= 60 ? 'bg-amber-100 text-amber-700' :
                                                    'bg-red-100 text-red-700'
                                                }`}>
                                                    {atsScore}%
                                                </div>
                                            )}

                                            {/* Gradient + name badge */}
                                            <div className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-white via-white/90 to-transparent z-10" />
                                            <div className="absolute bottom-2 inset-x-0 px-2 text-center z-10">
                                                <p className="text-[10px] font-semibold font-nunito text-slate-700 leading-tight line-clamp-1">{name}</p>
                                                <p className="text-[9px] text-slate-400 mt-0.5">PDF</p>
                                            </div>
                                        </div>

                                        {/* Label + action buttons below card */}
                                        <div className="mt-2 px-0.5">
                                            {editingNameId === resume.id ? (
                                                <div className="flex items-center gap-1 mb-1">
                                                    <input
                                                        autoFocus
                                                        value={editingName}
                                                        onChange={e => setEditingName(e.target.value)}
                                                        onKeyDown={async e => {
                                                            if (e.key === "Enter") await handleRename(resume);
                                                            if (e.key === "Escape") { setEditingNameId(null); setEditingName(""); }
                                                        }}
                                                        onBlur={() => handleRename(resume)}
                                                        disabled={renameSaving}
                                                        maxLength={100}
                                                        className="w-full text-[11px] font-semibold font-nunito text-slate-700 dark:text-[#ccc] bg-transparent border-b border-primary outline-none pb-0.5 truncate"
                                                    />
                                                    {renameSaving && <div className="size-3 border border-primary border-t-transparent rounded-full animate-spin shrink-0" />}
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 mb-1">
                                                    <p className="text-[12px] font-semibold font-nunito text-slate-700 dark:text-[#ccc] truncate flex-1" title={name}>{name}</p>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setEditingNameId(resume.id); setEditingName(name); }}
                                                        className="size-6 flex items-center justify-center rounded-md text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors shrink-0"
                                                        title="Rename"
                                                    >
                                                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                                                    </button>
                                                    <button
                                                        onClick={() => setDeleteConfirm(resume.id)}
                                                        className="size-6 flex items-center justify-center rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0"
                                                        title="Delete"
                                                    >
                                                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete_outline</span>
                                                    </button>
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] text-slate-400 dark:text-slate-500">{date}</p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* LaTeX resume cards */}
                            {latexResumes.map((lr) => (
                                <div key={lr.id} className="group relative w-48 shrink-0 cursor-pointer">
                                    <div
                                        onClick={() => router.push(`/resumes/editor/${lr.id}`)}
                                        className="w-48 h-64 rounded-xl border border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface cursor-pointer overflow-hidden hover:shadow-md hover:border-primary/40 group-hover:-translate-y-0.5 transition-all flex items-center justify-center relative"
                                    >
                                        <div className="flex flex-col items-center gap-2 p-4">
                                            <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                <span className="material-symbols-outlined text-primary text-xl">edit_document</span>
                                            </div>
                                            <p className="text-[11px] font-bold font-nunito text-slate-600 dark:text-[#ccc] text-center line-clamp-2">{lr.title}</p>
                                            <span className="text-[9px] text-slate-400">{lr.template} template</span>
                                        </div>
                                        {lr.compiledUrl && (
                                            <div className="absolute top-2 right-2 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                                                Ready
                                            </div>
                                        )}
                                    </div>
                                    <div className="mt-2 px-0.5">
                                        <div className="flex items-center gap-1 mb-1">
                                            <p className="text-[12px] font-semibold font-nunito text-slate-700 dark:text-[#ccc] truncate flex-1" title={lr.title}>{lr.title}</p>
                                            <button
                                                onClick={() => router.push(`/resumes/editor/${lr.id}`)}
                                                className="size-6 flex items-center justify-center rounded-md text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors shrink-0"
                                                title="Open Editor"
                                            >
                                                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500">LaTeX · {formatDate(lr.updatedAt)}</p>
                                    </div>
                                </div>
                            ))}

                            {/* Upload Box as a card */}
                            <div className="group relative w-48">
                                <div
                                    onDrop={handleDrop}
                                    onDragOver={(e) => e.preventDefault()}
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-48 h-64 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface rounded-xl p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer text-center"
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleFileSelect(file);
                                            e.target.value = "";
                                        }}
                                    />
                                    {uploading ? (
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                            <span className="text-xs font-bold text-primary">Uploading...</span>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="size-10 bg-primary/10 rounded-full flex items-center justify-center mb-3 text-primary">
                                                <span className="material-symbols-outlined text-xl">cloud_upload</span>
                                            </div>
                                            <p className="text-slate-900 dark:text-white font-bold font-nunito text-sm leading-tight mb-1">
                                                Drop your resume
                                            </p>
                                            <p className="text-slate-400 text-[10px] px-2">or click to browse<br/>PDF up to 5MB</p>
                                        </>
                                    )}
                                </div>
                                {uploadError && (
                                    <div className="absolute top-full left-0 right-0 mt-2 p-1.5 bg-red-50 dark:bg-red-500/10 rounded-lg border border-red-100 dark:border-red-500/20 text-center">
                                        <span className="text-[10px] text-red-600 dark:text-red-400 leading-tight block">{uploadError}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                    {/* LaTeX Resume Banner */}
                    {!loading && (
                        <div className="mt-10 bg-[#f8faff] dark:bg-lc-hover rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-sm border-0">
                            <div className="space-y-2 text-center sm:text-left">
                                <h3 className="font-nunito text-xl font-bold text-slate-900 dark:text-white">
                                    LaTeX Resume Builder
                                </h3>
                                <p className="text-sm text-slate-500 dark:text-[#ababab]">
                                    Professional ATS-friendly templates • Instant PDF generation • Export anywhere
                                </p>
                            </div>
                            <button
                                onClick={() => setBuilderOpen(true)}
                                className="shrink-0 px-6 py-3 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold font-nunito transition-colors flex items-center gap-2 shadow-primary/25 shadow-lg"
                            >
                                <span className="material-symbols-outlined text-lg">edit_document</span>
                                Create Resume
                            </button>
                        </div>
                    )}

                    {/* Resume Analyzers Section */}
                    {!loading && (
                        <div className="mt-12">
                            <div className="mb-6">
                                <h2 className="text-[28px] font-bold text-slate-800 dark:text-white font-nunito tracking-[-0.02em] text-left">
                                    Analyze Your Resume
                                </h2>
                                <p className="text-slate-500 dark:text-[#ababab] text-sm mt-1">
                                    Select how you'd like to analyze and improve your resume.
                                </p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {RESUME_ANALYZERS.map((type) => (
                                    <div
                                        key={type.id}
                                        onClick={() => type.available && type.href && router.push(type.href)}
                                        className={`group flex flex-col bg-white dark:bg-lc-surface rounded-2xl overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.1)] border border-slate-100 dark:border-lc-border transition-all duration-200 ${
                                            type.available
                                                ? "cursor-pointer hover:shadow-lg hover:-translate-y-1 hover:border-primary/20"
                                                : "cursor-not-allowed opacity-60"
                                        }`}
                                    >
                                        {/* Image Container Wrapper */}
                                        <div className="p-3 pb-0">
                                            {/* Inner Image Container */}
                                            <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden shadow-inner ring-1 ring-black/5 bg-white">
                                                <Image
                                                    src={type.image}
                                                    alt={type.label}
                                                    fill
                                                    sizes="(max-width: 768px) 100vw, 50vw"
                                                    className="object-contain pointer-events-none scale-110"
                                                />
                                                {/* Coming Soon overlay */}
                                                {type.badge && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-[1px]">
                                                        <span className="text-xs font-bold font-nunito px-3 py-1 rounded-full bg-white/90 text-slate-700 tracking-wide uppercase shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)]">
                                                            {type.badge}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {/* Content Flex Body */}
                                        <div className="p-5 flex flex-col flex-1">
                                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                                {type.label}
                                            </h2>
                                            <p className="text-[12.5px] text-slate-500 dark:text-[#ababab] leading-relaxed mb-3 flex-1">
                                                {type.description}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Resume Reports Section */}
                    {!loading && resumes.some(r => r.atsAnalysis) && (
                        <div className="mt-12">
                            <div className="mb-6">
                                <h2 className="text-[28px] font-bold text-slate-800 dark:text-white font-nunito tracking-[-0.02em] text-left">
                                    Resume Reports
                                </h2>
                                <p className="text-slate-500 dark:text-[#ababab] text-sm mt-1">
                                    Previous ATS analysis results for your uploaded resumes.
                                </p>
                            </div>

                            <div className="flex flex-col gap-3">
                                {resumes.filter(r => r.atsAnalysis).map((resume) => {
                                    const score = resume.atsAnalysis?.overallScore ?? 0;
                                    const name = resume.fileName.replace(/\.pdf$/i, "");
                                    const date = formatDate(resume.uploadedAt);
                                    const contextLabel: string = resume.atsAnalysis?._meta?.contextLabel ?? "ATS Report";
                                    const isJD = resume.atsAnalysis?._meta?.mode === "jd";

                                    return (
                                        <div
                                            key={resume.id}
                                            onClick={() => router.push(`/resumes/${resume.id}/ats-report`)}
                                            className="group relative flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200/50 bg-white p-4 sm:p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-transparent dark:bg-gradient-to-b dark:from-[#242424] dark:to-[#1a1a1a]"
                                        >
                                            <div className="flex items-center gap-4 md:gap-6">
                                                {/* Circular Score Badge — matches interview report style */}
                                                <div className={`relative size-14 md:size-16 shrink-0 rounded-full border-4 flex items-center justify-center ${
                                                    score >= 80
                                                        ? "border-green-50 bg-green-500/10 text-green-600 dark:border-green-900/30 dark:text-green-400"
                                                        : score >= 60
                                                            ? "border-primary/10 bg-primary/10 text-primary dark:border-primary/20"
                                                            : "border-red-50 bg-red-500/10 text-red-600 dark:border-red-900/30 dark:text-red-400"
                                                }`}>
                                                    <span className="font-nunito text-lg md:text-xl font-bold">{score}</span>
                                                </div>

                                                {/* Content */}
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center gap-2.5">
                                                        <span className="material-symbols-outlined text-[18px] md:text-[20px] text-slate-700 dark:text-slate-300">
                                                            assignment
                                                        </span>
                                                        <h3 className="font-nunito text-base md:text-lg font-bold text-slate-900 transition-colors group-hover:text-slate-700 dark:text-white truncate max-w-[150px] sm:max-w-xs">
                                                            {name}
                                                        </h3>
                                                    </div>
                                                    <div className="flex items-center gap-3 pl-1">
                                                        <div className="flex items-center gap-1.5 text-[11px] md:text-xs text-slate-500 dark:text-[#ababab]">
                                                            <span className="material-symbols-outlined text-[13px] md:text-[14px]">schedule</span>
                                                            {date}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-[11px] md:text-xs text-slate-500 dark:text-[#ababab]">
                                                            <span className="material-symbols-outlined text-[13px] md:text-[14px]">{isJD ? "work" : "person"}</span>
                                                            {contextLabel}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Chevron */}
                                            <div className="hidden sm:flex items-center text-slate-300 transition-colors group-hover:text-primary dark:text-[#6b6b6b]">
                                                <span className="material-symbols-outlined text-xl md:text-2xl transition-transform group-hover:translate-x-1">chevron_right</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* ── PDF Preview Modal ───────────────────────────── */}
            {previewUrl && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPreviewUrl(null)} />
                    <div className="relative w-full max-w-3xl h-[85vh] bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden flex flex-col animate-in zoom-in-95 fade-in duration-200">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-lc-border shrink-0">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary">picture_as_pdf</span>
                                <span className="text-sm font-semibold text-slate-800 dark:text-white font-nunito">Resume Preview</span>
                            </div>
                            <button
                                onClick={() => setPreviewUrl(null)}
                                className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-slate-400 text-lg">close</span>
                            </button>
                        </div>
                        <iframe
                            src={previewUrl}
                            className="flex-1 w-full bg-slate-100 dark:bg-lc-bg"
                            title="Resume Preview"
                        />
                    </div>
                </div>
            )}

            {/* ── Delete Confirmation Modal ───────────────────── */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
                    <div className="relative w-full max-w-sm bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                        <div className="p-6 text-center space-y-4">
                            <div className="size-12 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto">
                                <span className="material-symbols-outlined text-red-500 text-2xl">delete</span>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">Delete Resume</h3>
                                <p className="text-sm text-slate-500 mt-1">This action cannot be undone. The resume and its analysis will be permanently removed.</p>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="flex-1 py-2.5 rounded-lg font-bold text-sm text-slate-600 dark:text-[#aaa] border border-slate-200 dark:border-lc-border hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => handleDelete(deleteConfirm)}
                                    disabled={deleting === deleteConfirm}
                                    className="flex-1 py-2.5 rounded-lg font-bold text-sm bg-red-500 hover:bg-red-600 text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {deleting === deleteConfirm ? (
                                        <>
                                            <div className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            Deleting...
                                        </>
                                    ) : (
                                        "Delete"
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            <ResumeBuilderModal
                isOpen={builderOpen}
                onClose={() => {
                    setBuilderOpen(false);
                    if (editingLatexResumeId && builderReturnTo) {
                        router.push(builderReturnTo);
                    }
                    setEditingLatexResumeId(null);
                    setBuilderReturnTo(null);
                }}
                editingResumeId={editingLatexResumeId}
                onExitEditMode={() => {
                    if (editingLatexResumeId && builderReturnTo) {
                        router.push(builderReturnTo);
                    }
                }}
            />
        </div>
    );
}
