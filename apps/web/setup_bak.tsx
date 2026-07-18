"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";

const INTERVIEW_TYPES = [
    {
        id: "full_interview",
        label: "Full Interview",
        duration: "60 minutes",
        icon: "assignment",
        description: "A comprehensive end-to-end mock interview that mirrors a real tech interview experience.",
        details: [
            "Starts with introductions and resume-based questions (5-8 min)",
            "Moves to a live coding problem with an integrated IDE",
            "Covers CS fundamentals and system design concepts",
            "Ends with a closing round where you can ask questions",
            "Receive a detailed performance report with scores across all areas",
        ],
        bestFor: "Candidates preparing for on-site or final-round interviews at top tech companies.",
    },
    {
        id: "coding",
        label: "Coding",
        duration: "40 minutes",
        icon: "code",
        description: "A focused Data Structures & Algorithms coding round with a live collaborative IDE.",
        details: [
            "Receive an algorithmic problem tailored to your level",
            "Code your solution in a full-featured IDE with 40+ languages",
            "The AI interviewer guides you through hints and follow-ups",
            "Discuss time & space complexity after solving",
            "Get feedback on code quality, efficiency, and problem-solving approach",
        ],
        bestFor: "Sharpening your DSA skills and practicing under timed pressure.",
    },
    {
        id: "cs_fundamentals",
        label: "CS Fundamentals",
        duration: "25 minutes",
        icon: "school",
        description: "A rapid-fire round covering core Computer Science concepts and theory.",
        details: [
            "Topics include OS, DBMS, Networking, and OOP",
            "Questions adapt based on your role and experience level",
            "Mix of conceptual and scenario-based questions",
            "Tests depth of understanding, not just memorization",
            "Great for brushing up on fundamentals before interviews",
        ],
        bestFor: "Candidates who want to solidify their CS theory knowledge.",
    },
    {
        id: "system_design",
        label: "System Design",
        duration: "30 minutes",
        icon: "hub",
        description: "Design scalable systems from scratch with an AI interviewer guiding the discussion.",
        details: [
            "Receive a real-world system design problem (e.g., design Twitter, URL shortener)",
            "Walk through requirements gathering and scope definition",
            "Discuss high-level architecture, database choices, and trade-offs",
            "Dive into scaling strategies, caching, and load balancing",
            "Get evaluated on communication, structure, and technical depth",
        ],
        bestFor: "Senior engineers and anyone targeting SDE2+ roles at top companies.",
    },
    {
        id: "behavioural",
        label: "Behavioural",
        duration: "20 minutes",
        icon: "psychology",
        description: "Practice answering behavioural and leadership questions using the STAR method.",
        details: [
            "Questions based on Amazon LP-style and Google behavioural patterns",
            "Practice structuring answers with Situation, Task, Action, Result",
            "Covers teamwork, conflict resolution, ownership, and leadership",
            "AI provides feedback on clarity, structure, and impact of your stories",
            "Tailored to your experience level and target role",
        ],
        bestFor: "Anyone who struggles with the \"Tell me about a time...\" questions.",
    },
];


export default function SetupPage() {
    useEffect(() => { document.title = "Interview Setup | Practers"; }, []);
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form state
    const [selectedType, setSelectedType] = useState("");

    // Resume state
    const [resumeFile, setResumeFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [resumeAnalysis, setResumeAnalysis] = useState<any>(null);
    const [resumeId, setResumeId] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [isAnalyzingResume, setIsAnalyzingResume] = useState(false);

    // Existing resumes
    const [existingResumes, setExistingResumes] = useState<any[]>([]);
    const [loadingResumes, setLoadingResumes] = useState(true);

    // Session creation state
    const [starting, setStarting] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);

    // Info modal
    const [infoModalType, setInfoModalType] = useState<string | null>(null);
    const infoType = INTERVIEW_TYPES.find((t) => t.id === infoModalType);

    // ── Fetch existing resumes on mount ───────────────────
    useEffect(() => {
        (async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) return;
                const res = await api.get<{ resumes: any[] }>("/resumes", token);
                setExistingResumes(res.resumes || []);
            } catch {
                // silently fail — user can still upload
            } finally {
                setLoadingResumes(false);
            }
        })();
    }, []);

    // ── Select an existing resume ─────────────────────────
    const selectExistingResume = (resume: any) => {
        if (resumeId === resume.id) {
            setResumeId(null);
            setResumeAnalysis(null);
        } else {
            setResumeId(resume.id);
            setResumeAnalysis(resume.analysis || null);
        }
        setResumeFile(null);
        setUploadError(null);
    };

    // ── Upload Resume ────────────────────────────────────────
    const handleFileSelect = (file: File) => {
        if (file.type !== "application/pdf") {
            setUploadError("Only PDF files are accepted");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError("Maximum file size is 5MB");
            return;
        }
        setResumeFile(file);
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
            setResumeId(result.id);
            setResumeAnalysis(null);
            // Add to existing resumes list so it shows up in the picker
            setExistingResumes((prev) => [
                { id: result.id, fileName: file.name, analysis: null, uploadedAt: new Date().toISOString() },
                ...prev,
            ]);

            // Automatically trigger resume analysis after upload
            setUploading(false);
            setIsAnalyzingResume(true);
            try {
                const analyzeRes = await fetch(`${API_BASE}/resumes/${result.id}/analyze`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (analyzeRes.ok) {
                    const analyzeResult = await analyzeRes.json();
                    setResumeAnalysis(analyzeResult.analysis);
                    setExistingResumes((prev) =>
                        prev.map((r) => (r.id === result.id ? { ...r, analysis: analyzeResult.analysis } : r))
                    );
                }
            } catch {
                // Analysis failed, but upload succeeded — user can still proceed
            } finally {
                setIsAnalyzingResume(false);
            }
            return;
        } catch (err: any) {
            setUploadError(err.message || "Failed to upload resume");
            setUploading(false);
        }
    };

    // ── Start Interview ──────────────────────────────────────
    const startInterview = async () => {
        // Block if upload or analysis is still in progress
        if (uploading || isAnalyzingResume) {
            setSessionError("Please wait for resume processing to complete");
            return;
        }

        setStarting(true);
        setSessionError(null);

        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            // If a resume is selected but not yet analyzed, run analysis first
            if (resumeId && !resumeAnalysis) {
                setLoadingStatus("Analyzing your resume...");
                const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
                const analyzeRes = await fetch(`${API_BASE}/resumes/${resumeId}/analyze`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!analyzeRes.ok) {
                    const err = await analyzeRes.json().catch(() => ({}));
                    throw new Error(err.message || "Failed to analyze resume");
                }

                const analyzeResult = await analyzeRes.json();
                setResumeAnalysis(analyzeResult.analysis);

                // Update local list so future selections skip analysis
                setExistingResumes((prev) =>
                    prev.map((r) => (r.id === resumeId ? { ...r, analysis: analyzeResult.analysis } : r))
                );
            }

            setLoadingStatus("Preparing your interview...");

            const session = await api.post<{ id: string }>(
                "/interviews",
                {
                    mode: "mock",
                    resumeId: resumeId || undefined,
                    type: selectedType,
                    difficulty: "Medium",
                    language: "Python",
                },
                token
            );

            setLoadingStatus("Launching interview room...");
            router.push(`/room/${session.id}`);
        } catch (err: any) {
            setSessionError(err.message || "Failed to create session");
            setStarting(false);
            setLoadingStatus(null);
        }
    };

    // ── Drop Handler ─────────────────────────────────────────
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    };

    return (
        <div className="flex-1 overflow-auto">
            {/* Full-screen loading overlay */}
            {starting && (
                <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-white dark:bg-lc-bg">
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative">
                            <div className="size-16 border-[3px] border-slate-200 dark:border-lc-border rounded-full" />
                            <div className="absolute inset-0 size-16 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                        <div className="text-center space-y-2">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white font-nunito">Setting up your interview</h2>
                            <p className="text-sm text-slate-500 animate-pulse">{loadingStatus || "Getting ready..."}</p>
                        </div>
                    </div>
                </div>
            )}

            <PageHeader title="Interview Setup" showBack />

            <main className="flex-1 flex flex-col items-center py-12 px-4 pb-16">
                <div className="w-full max-w-[680px] space-y-8">
                    {/* Title */}
                    <div className="text-center space-y-2">
                        <h1 className="font-nunito text-[28px] font-bold text-slate-900 dark:text-white leading-tight">
                            Set Up Your Interview
                        </h1>
                        <p className="text-slate-500 text-base">
                            Upload your resume and configure your session
                        </p>
                    </div>

                    {/* Resume Section */}
                    <section className="bg-white dark:bg-lc-surface rounded-xl p-6 shadow-sm border border-slate-100 dark:border-lc-border space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Resume
                        </h3>

                        {/* Existing Resumes Picker */}
                        {!loadingResumes && existingResumes.length > 0 && !resumeFile && (
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500">Use a previously uploaded resume</label>
                                <div className="space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar">
                                    {existingResumes.map((r) => (
                                        <button
                                            key={r.id}
                                            onClick={() => selectExistingResume(r)}
                                                className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${resumeId === r.id
                                                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                                                    : "border-slate-100 dark:border-lc-border hover:border-emerald-400"
                                                }`}
                                        >
                                            <span className="material-symbols-outlined text-primary text-lg">description</span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-700 dark:text-[#ccc] truncate">{r.fileName}</p>
                                                <p className="text-[10px] text-slate-400">
                                                    {r.analysis?.summary?.name || "Resume"}
                                                    {r.analysis?.overallStrength && ` · ${r.analysis.overallStrength}`}
                                                    {" · "}{new Date(r.uploadedAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                            {resumeId === r.id && (
                                                <span className="material-symbols-outlined text-emerald-500 text-lg">check_circle</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center gap-3 pt-1">
                                    <div className="flex-1 h-px bg-slate-200 dark:bg-lc-border" />
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">or upload new</span>
                                    <div className="flex-1 h-px bg-slate-200 dark:bg-lc-border" />
                                </div>
                            </div>
                        )}

                        {/* Dropzone */}
                        <div
                            onDrop={handleDrop}
                            onDragOver={(e) => e.preventDefault()}
                            onClick={() => fileInputRef.current?.click()}
                            className="group relative flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-lc-border bg-[#F9FAFB] dark:bg-lc-bg rounded-xl py-10 px-6 hover:border-primary/50 transition-colors cursor-pointer"
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleFileSelect(file);
                                }}
                            />
                            <div className="size-12 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
                                <span className="material-symbols-outlined text-2xl">cloud_upload</span>
                            </div>
                            <div className="text-center">
                                <p className="text-slate-900 dark:text-[#eff1f6] font-semibold font-nunito">
                                    Drop your resume here, or <span className="text-primary">browse</span>
                                </p>
                                <p className="text-slate-400 text-sm mt-1">PDF up to 5MB</p>
                            </div>
                        </div>

                        {/* Upload Status */}
                        {(uploading || isAnalyzingResume) && (
                            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/20">
                                <div className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <span className="text-sm font-medium text-primary">
                                    {uploading ? "Uploading resume..." : "Analyzing resume..."}
                                </span>
                            </div>
                        )}

                        {uploadError && (
                            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 rounded-lg border border-red-100 dark:border-red-500/20">
                                <span className="material-symbols-outlined text-red-500 text-sm">error</span>
                                <span className="text-sm text-red-600 dark:text-red-400">{uploadError}</span>
                            </div>
                        )}

                        {/* Uploaded Resume */}
                        {resumeFile && !uploading && !uploadError && (
                            <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-500/10 rounded-lg border border-green-100 dark:border-green-500/20">
                                <div className="flex items-center gap-3">
                                    {isAnalyzingResume ? (
                                        <div className="size-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <span className="material-symbols-outlined text-green-600">check_circle</span>
                                    )}
                                    <div>
                                        <p className="text-sm font-medium text-slate-700 dark:text-[#ccc]">{resumeFile.name}</p>
                                        <p className="text-xs text-green-600">
                                            {isAnalyzingResume ? "Analyzing..." : resumeAnalysis ? "Analysis complete" : "Uploaded"}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setResumeFile(null);
                                        setResumeAnalysis(null);
                                        setResumeId(null);
                                    }}
                                    className="text-slate-400 hover:text-red-500 cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-sm">close</span>
                                </button>
                            </div>
                        )}

                    </section>

                    {/* Configuration */}
                    <section className="bg-white dark:bg-lc-surface rounded-xl p-6 shadow-sm border border-slate-100 dark:border-lc-border space-y-6">

                        {/* Interview Type */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                Interview Type
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                                {INTERVIEW_TYPES.map((type) => (
                                    <button
                                        key={type.id}
                                        onClick={() => setSelectedType(selectedType === type.id ? "" : type.id)}
                                        className={`relative flex flex-col items-start p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${selectedType === type.id
                                            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                                            : "border-slate-100 dark:border-lc-border bg-white dark:bg-lc-hover hover:border-emerald-400"
                                            }`}
                                    >
                                        {selectedType === type.id && (
                                            <span className="material-symbols-outlined absolute top-3 right-3 text-emerald-500 text-lg">
                                                check_circle
                                            </span>
                                        )}
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`material-symbols-outlined text-lg ${selectedType === type.id ? "text-emerald-500" : "text-slate-400"}`}>{type.icon}</span>
                                            <span className="font-medium font-nunito text-slate-900 dark:text-[#eff1f6]">{type.label}</span>
                                        </div>
                                        <div className="flex items-center justify-between w-full">
                                            <span className="text-xs text-slate-500">{type.duration}</span>
                                            <span
                                                onClick={(e) => { e.stopPropagation(); setInfoModalType(type.id); }}
                                                className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-blue-500 hover:text-blue-600 transition-colors"
                                            >
                                                Know more <span className="material-symbols-outlined text-[12px]">chevron_right</span>
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>


                    </section>
                    {/* Action Buttons */}
                    <div className="flex items-center justify-end pt-2">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => router.back()}
                                className="text-slate-500 font-bold font-nunito px-4 py-2 hover:bg-slate-50 dark:hover:bg-lc-hover rounded-lg transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            {sessionError && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-500/10 rounded-lg border border-red-100 dark:border-red-500/20">
                                    <span className="material-symbols-outlined text-red-500 text-sm">error</span>
                                    <span className="text-sm text-red-600 dark:text-red-400">{sessionError}</span>
                                </div>
                            )}
                            {(uploading || isAnalyzingResume) && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-100 dark:border-blue-500/20">
                                    <div className="size-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                    <span className="text-sm text-blue-600 dark:text-blue-400">
                                        {uploading ? "Uploading resume..." : "Analyzing resume..."}
                                    </span>
                                </div>
                            )}
                            <button
                                onClick={() => { setSessionError(null); startInterview(); }}
                                disabled={starting || !selectedType || uploading || isAnalyzingResume}
                                className="bg-[#FFE500] hover:bg-[#f5dc00] text-[#1a1a1a] font-bold font-nunito px-8 py-3 rounded-lg shadow-lg shadow-[#FFE500]/20 flex items-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Begin Interview{" "}
                                <span className="material-symbols-outlined">arrow_forward</span>
                            </button>
                        </div>
                    </div>
                </div>
            </main>

            {/* Interview Type Info Modal */}
            {infoType && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setInfoModalType(null)}
                    />
                    {/* Modal */}
                    <div className="relative w-full max-w-lg bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                        {/* Header */}
                        <div className="relative px-6 pt-6 pb-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-primary text-xl">{infoType.icon}</span>
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">{infoType.label}</h3>
                                        <span className="text-xs font-medium text-slate-500">{infoType.duration}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setInfoModalType(null)}
                                    className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-slate-400 text-lg">close</span>
                                </button>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="px-6 pb-6 space-y-5">
                            <p className="text-sm text-slate-600 dark:text-[#ababab] leading-relaxed">
                                {infoType.description}
                            </p>

                            <div className="space-y-2.5">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">What to expect</h4>
                                <ul className="space-y-2">
                                    {infoType.details.map((detail, i) => (
                                        <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-[#ccc]">
                                            <span className="material-symbols-outlined text-primary text-[16px] mt-0.5 shrink-0">check_circle</span>
                                            {detail}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="p-3 bg-primary/5 rounded-lg border border-primary/10">
                                <div className="flex items-start gap-2">
                                    <span className="material-symbols-outlined text-primary text-[16px] mt-0.5 shrink-0">lightbulb</span>
                                    <div>
                                        <span className="text-xs font-bold text-primary">Best for</span>
                                        <p className="text-xs text-slate-600 dark:text-[#ababab] mt-0.5">{infoType.bestFor}</p>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => { setSelectedType(infoType.id); setInfoModalType(null); }}
                                className="w-full bg-[#FFE500] hover:bg-[#f5dc00] text-[#1a1a1a] font-bold font-nunito py-3 rounded-lg shadow-lg shadow-[#FFE500]/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                            >
                                Select {infoType.label}
                                <span className="material-symbols-outlined text-lg">arrow_forward</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
