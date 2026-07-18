"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { fetchWithLimits, isFeatureLimitError } from "@/lib/api-with-limits";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { ClockIcon } from "@/components/icons/clock-icon";

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
    {
        id: "gen_ai_role",
        label: "Gen AI Interview",
        duration: "55 minutes",
        icon: "auto_awesome",
        description: "A GenAI-focused interview covering resume depth, GenAI concepts, live coding, and AI responsibility.",
        details: [
            "Choose which GenAI modules to include; resume deep-dive is calibrated to 10 minutes when enabled",
            "Choose GenAI concept focus areas such as RAG, prompting, evaluation, model selection, MLOps, and transformer internals",
            "GenAI coding remains a live IDE task with AI-tool ownership checks",
            "Responsibility case is calibrated to 5 minutes at the end",
        ],
        bestFor: "Candidates preparing for GenAI engineer interviews.",
    },
    {
        id: "data_science_role",
        label: "Data Science Interview",
        duration: "70 minutes",
        icon: "analytics",
        description: "A data science interview covering project depth, statistics and ML concepts, SQL, coding, and business metrics.",
        details: [
            "Choose which DS modules to include and focus concepts by category",
            "Resume deep-dive probes real DS/ML project ownership, data quality, modeling choices, and business impact",
            "SQL problem sets open in the SQL editor against a realistic business schema",
            "Python/Pandas coding runs in the IDE as a live data analysis task",
            "Business metrics case closes with measurement, experimentation, and trade-off reasoning",
        ],
        bestFor: "Candidates preparing for data science or ML-adjacent interviews.",
    },
    {
        id: "pm_role",
        label: "Product Manager Interview",
        duration: "85 minutes",
        icon: "inventory_2",
        description: "A PM interview covering ownership, product cases, concepts, strategy, and behavioral judgment.",
        details: [
            "Choose which PM modules to include: resume ownership, product case, PM concepts, strategy, and behavioral",
            "Live product case uses a structured notepad and may introduce a constraint mid-session",
            "PM concepts cover metric definition, prioritization, interpretation, and experiment design",
            "Product strategy and behavioral rounds focus on trade-offs, ownership, and cross-functional judgment",
        ],
        bestFor: "Candidates preparing for product management interviews.",
    },
    {
        id: "resume_round",
        label: "Resume Screening Interview",
        duration: "30 minutes",
        icon: "badge",
        description: "A focused resume-based interview that checks how clearly you can explain the claims, projects, experience, education, and skills in your selected resume.",
        details: [
            "Select or upload a resume before starting the round",
            "Project and experience follow-ups focus on your role, decisions, implementation, trade-offs, outcomes, and verification",
            "Expect tough project follow-ups that reveal where your understanding is shallow, unclear, or unsupported",
            "AI-assisted, tutorial, or team-based work should be explained honestly: what you used, changed, verified, and personally owned",
            "Report summarizes screening readiness, strong evidence, weak or unsupported claims, possible resume risks, and answer-bank improvements",
        ],
        bestFor: "Candidates who want to practice defending their resume claims and turn vague resume points into interview-ready stories.",
    },
];


export default function SetupPage() {
    useEffect(() => { document.title = "Interview Setup | Mockr"; }, []);
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { handleFeatureError, UpgradeModal } = useFeatureLimit();

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

    // Add Resume menu
    const [showAddMenu, setShowAddMenu] = useState(false);

    // Resume deletion
    const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);

    // ── Delete an existing resume ─────────────────────────
    const handleDeleteResume = async (e: React.MouseEvent, resumeId: string) => {
        e.stopPropagation(); // don't trigger card select
        if (!confirm("Remove this resume? This cannot be undone.")) return;
        setDeletingResumeId(resumeId);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            await fetch(`${API_BASE}/resumes/${resumeId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            setExistingResumes((prev) => prev.filter((r) => r.id !== resumeId));
            if (resumeId === resumeId) {
                setResumeId(null);
                setResumeAnalysis(null);
            }
        } catch {
            // silently ignore
        } finally {
            setDeletingResumeId(null);
        }
    };

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
                const analyzeRes = await fetchWithLimits(`${API_BASE}/resumes/${result.id}/analyze`, {
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
            } catch (err) {
                // Check if it's a feature limit error
                if (isFeatureLimitError(err)) {
                    handleFeatureError(err, "resume_improve_ai");
                }
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
                const analyzeRes = await fetchWithLimits(`${API_BASE}/resumes/${resumeId}/analyze`, {
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
            // Check if it's a feature limit error
            if (isFeatureLimitError(err)) {
                handleFeatureError(err, "interview_minutes");
            }
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
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Setting up your interview</h2>
                            <p className="text-sm text-slate-500 animate-pulse">{loadingStatus || "Getting ready..."}</p>
                        </div>
                    </div>
                </div>
            )}

            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Interview Setup</h1>} showBack />

            <main className="flex-1 flex flex-col max-w-[1000px] mx-auto w-full py-12 px-4 pb-16 space-y-12">
                {/* Title */}
                <div className="text-left space-y-2">
                    <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                        Set Up Your Interview
                    </h1>
                    <p className="text-slate-500 text-lg">
                        Upload your resume and configure your session
                    </p>
                </div>

                {/* Resume Section */}
                <section className="space-y-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                        1. Select or Upload Resume
                    </h3>

                    <div className="flex gap-6 overflow-x-auto pb-6 pt-2 custom-scrollbar snap-x">
                        {existingResumes.map((r) => (
                            <button
                                key={r.id}
                                onClick={() => selectExistingResume(r)}
                                className={`group relative snap-center flex-none w-[220px] aspect-[4/5] rounded-2xl border-2 p-5 text-left flex flex-col transition-all duration-300 ease-out cursor-pointer hover:-translate-y-3 hover:shadow-xl hover:shadow-primary/10 ${resumeId === r.id
                                    ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                                    : "border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface hover:border-primary/50"
                                }`}
                            >
                                {resumeId === r.id && (
                                    <div className="absolute -top-3 -right-3 size-8 bg-primary rounded-full flex items-center justify-center shadow-lg text-white">
                                        <span className="material-symbols-outlined text-sm">check</span>
                                    </div>
                                )}

                                {/* Delete button — top-left, only visible on hover */}
                                <button
                                    onClick={(e) => handleDeleteResume(e, r.id)}
                                    disabled={deletingResumeId === r.id}
                                    className="absolute top-2 left-2 size-6 rounded-full bg-slate-100 dark:bg-lc-bg border border-slate-200 dark:border-lc-border text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center z-10 cursor-pointer disabled:opacity-50"
                                    title="Remove resume"
                                >
                                    {deletingResumeId === r.id
                                        ? <span className="size-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                                        : <span className="material-symbols-outlined text-[12px]">close</span>
                                    }
                                </button>
                                
                                {/* Preview pseudo-box */}
                                <div className="flex-1 w-full bg-slate-50 dark:bg-lc-bg rounded-lg border border-slate-100 dark:border-lc-border mb-4 overflow-hidden flex flex-col p-2 gap-1 group-hover:scale-105 transition-transform duration-300 shadow-inner">
                                    <div className="h-2 w-1/2 bg-slate-200 dark:bg-lc-border rounded-full mx-auto mt-1 mb-2" />
                                    <div className="h-1 w-full bg-slate-200 dark:bg-lc-border rounded-full" />
                                    <div className="h-1 w-5/6 bg-slate-200 dark:bg-lc-border rounded-full" />
                                    <div className="h-1 w-11/12 bg-slate-200 dark:bg-lc-border rounded-full mt-2" />
                                    <div className="h-1 w-4/5 bg-slate-200 dark:bg-lc-border rounded-full" />
                                </div>

                                <div className="mt-auto group-hover:-translate-y-1 transition-transform duration-300">
                                    <p className="font-bold text-slate-800 dark:text-white truncate" title={r.fileName}>{r.fileName}</p>
                                    <p className="text-[11px] text-slate-400 mt-1 uppercase font-bold tracking-wider">
                                        {new Date(r.uploadedAt).toLocaleDateString()}
                                    </p>
                                    {(r.analysis?.summary?.name || r.analysis?.overallStrength) && (
                                        <div className="flex flex-wrap gap-1 items-center mt-2">
                                            {r.analysis?.summary?.name && (
                                                <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-[10px] font-bold">
                                                    {r.analysis.summary.name.split(" ")[0]}
                                                </span>
                                            )}
                                            {r.analysis?.overallStrength && (
                                                <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded text-[10px] font-bold">
                                                    {r.analysis.overallStrength.split(" ")[0]}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </button>
                        ))}

                        {/* Upload Status */}
                        {uploading && (
                            <div className="flex-none w-[220px] aspect-[4/5] rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center justify-center">
                                <div className="size-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                                <span className="text-sm font-bold text-primary">Uploading...</span>
                            </div>
                        )}
                        
                        {isAnalyzingResume && !uploading && (
                            <div className="flex-none w-[220px] aspect-[4/5] rounded-2xl border-2 border-dashed border-emerald-500/30 bg-emerald-500/5 flex flex-col items-center justify-center">
                                <div className="size-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
                                <span className="text-sm font-bold text-emerald-600">Analyzing...</span>
                            </div>
                        )}

                        {/* Add New Resume Card */}
                        {!uploading && !isAnalyzingResume && (
                            <button
                                onClick={() => setShowAddMenu(true)}
                                className="group snap-center flex-none w-[220px] aspect-[4/5] rounded-2xl border-2 border-dashed border-slate-300 dark:border-lc-border hover:border-primary bg-slate-50 dark:bg-lc-surface flex flex-col items-center justify-center text-center p-6 cursor-pointer transition-all duration-300 ease-out hover:-translate-y-3 hover:shadow-xl hover:shadow-primary/10 hover:bg-primary/5 relative"
                            >
                                <div className="size-14 bg-white dark:bg-lc-bg rounded-full flex items-center justify-center shadow-sm text-slate-400 group-hover:text-primary group-hover:scale-110 transition-all duration-300 mb-4 group-hover:bg-white border border-slate-100 dark:border-lc-border">
                                    <span className="material-symbols-outlined text-3xl">add</span>
                                </div>
                                <span className="font-bold text-slate-600 dark:text-slate-300 group-hover:text-primary transition-colors group-hover:-translate-y-1">Add a new resume</span>
                                {uploadError && (
                                    <span className="absolute bottom-4 left-4 right-4 text-[10px] text-red-500 font-medium">
                                        {uploadError}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                </section>

                {/* Interview Type Section */}
                <section className="space-y-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                        2. Select Interview Type
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {INTERVIEW_TYPES.map((type) => (
                            <button
                                key={type.id}
                                onClick={() => setSelectedType(selectedType === type.id ? "" : type.id)}
                                className={`group relative p-6 rounded-2xl border-2 text-left transition-all duration-300 ease-out cursor-pointer hover:-translate-y-2 hover:shadow-2xl overflow-hidden ${selectedType === type.id
                                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/20"
                                    : "border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface hover:border-primary/50"
                                    }`}
                            >
                                {selectedType === type.id && (
                                    <div className="absolute top-4 right-4">
                                        <span className="material-symbols-outlined text-primary text-xl">
                                            check_circle
                                        </span>
                                    </div>
                                )}
                                
                                <div className="flex items-center gap-3 mb-2 group-hover:scale-105 origin-left transition-transform duration-300">
                                    <div className={`size-12 rounded-xl flex items-center justify-center transition-colors shadow-sm ${selectedType === type.id ? "bg-primary text-white" : "bg-slate-100 dark:bg-lc-bg text-slate-500 group-hover:bg-primary group-hover:text-white"}`}>
                                        <span className="material-symbols-outlined text-2xl">{type.icon}</span>
                                    </div>
                                    <div>
                                        <h4 className="font-bold font-nunito text-lg text-slate-900 dark:text-[#eff1f6]">{type.label}</h4>
                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-lc-bg px-2 py-0.5 rounded-md mt-1">
                                            <ClockIcon size={14} />
                                            {type.duration}
                                        </span>
                                    </div>
                                </div>
                                
                                {/* Expanded content on hover */}
                                <div className="h-0 opacity-0 group-hover:h-auto group-hover:opacity-100 group-hover:mt-4 transition-all duration-300 text-clip overflow-hidden">
                                    <div className="border-t border-slate-100 dark:border-lc-border pt-4">
                                        <p className="text-[13px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed group-hover:translate-y-0 translate-y-2 opacity-0 group-hover:opacity-100 transition-all duration-500 delay-100">
                                            {type.description}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>

                {/* Action Buttons */}
                <div className="flex items-center gap-4 py-8 border-t border-slate-200 dark:border-lc-border mt-auto">
                    <button
                        onClick={() => router.back()}
                        className="group relative flex items-center justify-center font-bold font-nunito px-6 py-3 rounded-xl border border-slate-200 dark:border-lc-border bg-slate-50 dark:bg-lc-bg text-slate-500 hover:text-slate-700 transition-all cursor-pointer w-32"
                    >
                        <span className="group-hover:opacity-0 transition-opacity">Cancel</span>
                        <span className="absolute opacity-0 group-hover:opacity-100 transition-opacity text-xl">😢</span>
                    </button>
                    
                    <div className="flex-1" />
                    
                    {sessionError && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 rounded-lg border border-red-100 dark:border-red-500/20 mr-4">
                            <span className="material-symbols-outlined text-red-500 text-sm">error</span>
                            <span className="text-sm font-medium text-red-600 dark:text-red-400">{sessionError}</span>
                        </div>
                    )}
                    
                    <button
                        onClick={() => { setSessionError(null); startInterview(); }}
                        disabled={starting || !selectedType || uploading || isAnalyzingResume || (!resumeId && selectedType !== "cs_fundamentals" && selectedType !== "behavioural")}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold font-nunito px-10 py-4 rounded-xl shadow-xl shadow-blue-600/20 flex items-center gap-2 transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-600/30 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none text-lg"
                    >
                        Begin Interview
                        <span className="material-symbols-outlined">rocket_launch</span>
                    </button>
                </div>
            </main>

            {/* Add Resume Menu Modal */}
            {showAddMenu && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setShowAddMenu(false)}
                    />
                    <div className="relative w-full max-w-sm bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200 p-6 flex flex-col gap-4">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-nunito font-bold text-lg text-slate-900 dark:text-white">Add a New Resume</h3>
                            <button onClick={() => setShowAddMenu(false)} className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                                <span className="material-symbols-outlined text-lg">close</span>
                            </button>
                        </div>
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

                        <button 
                            onClick={() => {
                                setShowAddMenu(false);
                                fileInputRef.current?.click();
                            }}
                            className="group flex flex-col p-4 rounded-xl border border-slate-200 dark:border-lc-border hover:border-primary hover:bg-primary/5 transition-all text-left cursor-pointer"
                        >
                            <span className="font-bold text-slate-800 dark:text-slate-200 group-hover:text-primary mb-1 flex items-center gap-2">
                                <span className="material-symbols-outlined text-sm">upload_file</span>
                                Upload a new resume
                            </span>
                            <span className="text-xs text-slate-500">From your computer (PDF only)</span>
                        </button>
                        
                        <button 
                            onClick={() => {
                                setShowAddMenu(false);
                                router.push('/resumes');
                            }}
                            className="group flex flex-col p-4 rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all text-left cursor-pointer"
                        >
                            <span className="font-bold text-emerald-800 dark:text-emerald-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-300 mb-1 flex items-center gap-1">
                                <span className="material-symbols-outlined text-sm">auto_awesome</span>
                                Build a resume with latex builder
                            </span>
                            <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70">Use our AI builder to craft a perfect resume</span>
                        </button>
                    </div>
                </div>
            )}

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

            {/* Upgrade Modal */}
            <UpgradeModal />
        </div>
    );
}
