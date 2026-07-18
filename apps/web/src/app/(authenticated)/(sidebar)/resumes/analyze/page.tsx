"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { ROLES } from "@interviewforge/shared";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { fetchWithLimits, isFeatureLimitError } from "@/lib/api-with-limits";

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

export default function AnalyzeResumePage() {
    useEffect(() => { document.title = "Analyze Resume | Mockr"; }, []);
    const router = useRouter();
    
    const { handleFeatureError, UpgradeModal } = useFeatureLimit();

    const [resumes, setResumes] = useState<Resume[]>([]);
    const [loading, setLoading] = useState(true);

    const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
    const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
    const [showAddMenu, setShowAddMenu] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const [atsMode, setAtsMode] = useState<"jd" | "role" | null>(null);
    const [jobText, setJobText] = useState("");
    const [targetRole, setTargetRole] = useState(ROLES[0].label);
    const [analyzing, setAnalyzing] = useState(false);

    const [activeModal, setActiveModal] = useState<"jd" | "role" | null>(null);

    const fetchSignedUrl = async (resumeId: string) => {
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const res = await api.get<{ url: string }>(`/resumes/${resumeId}/download`, token);
            if (res.url) {
                setSignedUrls(prev => ({ ...prev, [resumeId]: res.url }));
            }
        } catch { }
    };

    const fetchResumes = useCallback(async () => {
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;
            const res = await api.get<{ resumes: Resume[] }>("/resumes", token);
            setResumes(res.resumes || []);
            
            // Auto fetch signed urls for all
            res.resumes?.forEach(r => fetchSignedUrl(r.id));
        } catch { } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchResumes(); }, [fetchResumes]);

    const handleFileSelect = (file: File) => {
        if (file.type !== "application/pdf") {
            setUploadError("Only PDF files are accepted"); return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError("Maximum file size is 5MB"); return;
        }
        setUploadError(null);
        uploadResume(file);
    };

    const uploadResume = async (file: File) => {
        setUploading(true);
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
                body: formData
            });
            if (!res.ok) {
                let msg = "Upload failed. Please try again.";
                try {
                    const e = await res.json();
                    if (e?.message) msg = e.message;
                } catch { /* keep default */ }
                throw new Error(msg);
            }

            const result = await res.json();
            if (result.id) {
                const newResume: Resume = { id: result.id, fileName: file.name, fileUrl: "", analysis: null, atsAnalysis: null, uploadedAt: new Date().toISOString() };
                setResumes([newResume, ...resumes]);
                setSelectedResumeId(result.id);
                fetchSignedUrl(result.id);
                setShowAddMenu(false);
            }
        } catch (err: any) {
            setUploadError(err.message);
        } finally {
            setUploading(false);
        }
    };

    const handleAnalyzeATS = async () => {
        if (!selectedResumeId || !atsMode) return;
        setAnalyzing(true);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;

            const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            const res = await fetchWithLimits(`${API_BASE}/resumes/${selectedResumeId}/analyze-ats`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode: atsMode,
                    jobDescription: atsMode === 'jd' ? jobText : undefined,
                    roleId: atsMode === 'role' ? targetRole : undefined
                })
            });
            
            router.push(`/resumes/${selectedResumeId}/ats-report`);
        } catch (err: any) {
            // Check if this is a feature limit error
            if (isFeatureLimitError(err)) {
                handleFeatureError(err, "resume_improve_ai");
            } else {
                alert(err.message || "Failed to analyze ATS for resume");
            }
            setAnalyzing(false);
        }
    };

    const formatDate = (d: string) =>
        new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    // ── Drop Handler ─────────────────────────────────────────
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    };

    // ── Mouse Enter Handler for Cards ─────────────────────────
    const handleCardMouseEnter = (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const fromLeft = x < rect.width / 2;
        e.currentTarget.style.setProperty('--wave-dir', fromLeft ? '1' : '-1');
    };

    return (
        <div className="flex-1 min-h-0 bg-[#FAFBFC] dark:bg-lc-bg flex flex-col relative">
            <PageHeader title={
                <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Analyze Resume</h1>
            } showBack={true} backUrl="/resumes" />

            <main className="flex-1 flex flex-col w-full py-12 px-6 lg:px-8 pb-16 space-y-12 text-left">

                {/* Section 1: Select Resume */}
                <section className="space-y-6">
                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                        Select Resume
                    </h2>

                    <div className="flex gap-6 overflow-x-auto pb-8 pt-6 -mt-6 custom-scrollbar snap-x px-2 -mx-2">
                        {loading && resumes.length === 0 ? (
                            <div className="flex gap-6 animate-pulse">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="w-[320px] aspect-[1/1.414] bg-slate-100 dark:bg-lc-surface rounded-[24px] shrink-0 border-2 border-transparent" />
                                ))}
                            </div>
                        ) : (
                            <>
                                {resumes.map(resume => {
                                    const isSelected = selectedResumeId === resume.id;
                                    const url = signedUrls[resume.id];
                                    
                                    return (
                                        <div
                                            key={resume.id}
                                            onClick={() => setSelectedResumeId(prev => prev === resume.id ? null : resume.id)}
                                            onMouseEnter={handleCardMouseEnter}
                                            className={`group relative snap-center w-[320px] shrink-0 aspect-[1/1.414] rounded-[24px] border-2 text-left flex flex-col transition-all duration-300 ease-out cursor-pointer hover:-translate-y-3 hover:shadow-2xl overflow-hidden before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] before:transition-transform before:duration-700 before:ease-in-out ${isSelected ? 'border-primary shadow-lg shadow-primary/20 bg-primary/5' : 'border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface hover:border-primary/50'}`}
                                        >
                                            {/* Preview Header Overlay */}
                                            <div className={`absolute top-0 inset-x-0 h-24 bg-gradient-to-b ${isSelected ? 'from-primary/30 to-transparent text-primary' : 'from-slate-900/60 to-transparent text-white'} z-10 p-5 flex items-start justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`}>
                                                <div>
                                                    <p className="font-bold font-nunito text-lg truncate drop-shadow-md">{resume.fileName.replace('.pdf', '')}</p>
                                                    <p className="text-xs font-medium opacity-80 drop-shadow-md">{formatDate(resume.uploadedAt)}</p>
                                                </div>
                                            </div>

                                            {isSelected && (
                                                <div className="absolute top-4 right-4 z-20 size-8 bg-primary rounded-full flex items-center justify-center shadow-md animate-in zoom-in spin-in-12 duration-300">
                                                    <span className="material-symbols-outlined text-white text-xl">check</span>
                                                </div>
                                            )}

                                            <div className="absolute inset-0 bg-slate-100 dark:bg-[#0f1115] w-[1190px] h-[1682px] transform scale-[0.2689] origin-top-left pointer-events-none">
                                                {url ? (
                                                <div className="w-full h-full relative pointer-events-none overflow-hidden">
                                                    <div className="absolute inset-0 z-10 pointer-events-none" />
                                                        <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} className="w-full h-full border-none pointer-events-none bg-white" scrolling="no" title={resume.fileName} />
                                                    </div>
                                                ) : (
                                                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                                                        <span className="material-symbols-outlined text-[80px] animate-pulse">description</span>
                                                        <span className="text-4xl font-nunito font-bold">Loading Preview...</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Add New Resume Card */}
                                <div
                                    onClick={() => setShowAddMenu(true)}
                                    onMouseEnter={handleCardMouseEnter}
                                    className="group relative snap-center w-[320px] shrink-0 aspect-[1/1.414] rounded-[24px] border-2 border-dashed border-slate-300 dark:border-white/20 text-left flex flex-col items-center justify-center gap-4 transition-all duration-300 ease-out cursor-pointer hover:-translate-y-3 hover:shadow-xl hover:border-primary hover:bg-primary/5 bg-transparent overflow-hidden before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] before:transition-transform before:duration-700 before:ease-in-out"
                                >
                                    <div className="size-16 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center group-hover:bg-primary group-hover:scale-110 transition-all duration-300 shadow-sm z-10">
                                        <span className="material-symbols-outlined text-3xl text-slate-500 dark:text-slate-300 group-hover:text-white transition-colors">add</span>
                                    </div>
                                    <div className="text-center px-6 z-10">
                                        <h3 className="font-bold font-nunito text-lg text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors">Add a new resume</h3>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </section>

                {/* Section 2: Configure Analysis */}
                <section className="space-y-6 pt-4">
                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                        Configure Analysis
                    </h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative items-start">
                        {/* JD Based Column */}
                        <div className="flex flex-col gap-4">
                            <button
                                onClick={() => {
                                    if (atsMode === 'jd') {
                                        setAtsMode(null);
                                    } else {
                                        setActiveModal('jd');
                                    }
                                }}
                                onMouseEnter={handleCardMouseEnter}
                                className={`relative z-20 p-6 rounded-2xl border-2 text-left flex flex-col gap-3 transition-all duration-300 ease-out cursor-pointer hover:-translate-y-2 hover:shadow-xl overflow-hidden before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] before:transition-transform before:duration-700 before:ease-in-out ${atsMode === 'jd'
                                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/20 ring-4 ring-primary/10"
                                    : "border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface hover:border-primary/50"
                                }`}
                            >
                                {atsMode === 'jd' && (
                                    <div className="absolute top-4 right-4">
                                        <span className="material-symbols-outlined text-primary text-xl">check_circle</span>
                                    </div>
                                )}
                                <div>
                                    <h4 className="font-bold font-nunito text-lg text-slate-900 dark:text-[#eff1f6]">Job Description Based</h4>
                                    <p className="text-sm text-slate-500 mt-1">Analyze your resume directly against the contents of a target job description.</p>
                                </div>
                            </button>
                        </div>

                        {/* Role Based Column */}
                        <div className="flex flex-col gap-4">
                            <button
                                onClick={() => {
                                    if (atsMode === 'role') {
                                        setAtsMode(null);
                                    } else {
                                        setActiveModal('role');
                                    }
                                }}
                                onMouseEnter={handleCardMouseEnter}
                                className={`relative z-20 p-6 rounded-2xl border-2 text-left flex flex-col gap-3 transition-all duration-300 ease-out cursor-pointer hover:-translate-y-2 hover:shadow-xl overflow-hidden before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] before:transition-transform before:duration-700 before:ease-in-out ${atsMode === 'role'
                                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/20 ring-4 ring-primary/10"
                                    : "border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface hover:border-primary/50"
                                }`}
                            >
                                {atsMode === 'role' && (
                                    <div className="absolute top-4 right-4">
                                        <span className="material-symbols-outlined text-primary text-xl">check_circle</span>
                                    </div>
                                )}
                                <div>
                                    <h4 className="font-bold font-nunito text-lg text-slate-900 dark:text-[#eff1f6]">Role Based</h4>
                                    <p className="text-sm text-slate-500 mt-1">Compare your resume against common industry standards for a specific role.</p>
                                </div>
                            </button>
                        </div>

                    </div>
                </section>

                {/* Bottom Action Buttons */}
                <div className="flex items-center gap-4 py-8 mt-auto relative z-10 w-full pt-8">
                    <button
                        onClick={() => { setAtsMode(null); setSelectedResumeId(null); setJobText(""); setTargetRole(ROLES[0].label); }}
                        className="group relative flex flex-1 sm:flex-none items-center justify-center font-bold font-nunito px-6 py-3 sm:py-4 rounded-xl border border-slate-200 dark:border-lc-border bg-slate-50 dark:bg-lc-bg text-slate-500 hover:text-slate-700 transition-all cursor-pointer min-w-32 hover:-translate-y-1"
                    >
                        <span>Cancel</span>
                    </button>
                    
                    <button
                        onClick={handleAnalyzeATS}
                        disabled={analyzing || !selectedResumeId || !atsMode || (atsMode === 'jd' && jobText.length < 50)}
                        className="bg-blue-600 flex-1 sm:flex-none hover:bg-blue-700 text-white font-bold font-nunito px-8 sm:px-10 py-3 sm:py-4 rounded-xl shadow-xl shadow-blue-600/20 flex items-center justify-center gap-2 transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-600/30 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none text-base sm:text-lg"
                    >
                        {analyzing ? (
                            <>
                                <div className="size-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>Analyzing...</span>
                            </>
                        ) : (
                            <span>Run Analyzer</span>
                        )}
                    </button>
                </div>
            </main>

            {/* File input lives outside the modal so closing the modal doesn't unmount it before the picker opens */}
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

            {/* Add Resume Menu Modal */}
            {showAddMenu && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setShowAddMenu(false)}
                    />
                    <div className="relative w-full max-w-2xl bg-white dark:bg-lc-surface rounded-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] dark:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] border border-slate-200/60 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200 p-8 flex flex-col">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="font-nunito font-bold text-2xl text-slate-900 dark:text-white tracking-tight">Add your resume</h3>
                            <button onClick={() => setShowAddMenu(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer bg-slate-100 dark:bg-lc-bg hover:bg-slate-200 dark:hover:bg-slate-800 p-2 rounded-xl">
                                <span className="material-symbols-outlined text-lg">close</span>
                            </button>
                        </div>

                        {uploadError && (
                            <div className="mb-4 text-xs font-medium text-red-500 text-center bg-red-50 dark:bg-red-500/10 py-2 rounded-lg">
                                {uploadError}
                            </div>
                        )}

                        <div className="relative flex flex-col pl-12 py-2 group/modal">
                            {/* Option 1: Upload Area (Bigger) */}
                            <div className="relative mb-6">
                                {/* Continuous Background Line for Top Half gap */}
                                <div className="absolute -left-[40px] top-[-30px] bottom-[-24px] w-[2px] bg-slate-200 dark:bg-slate-700" />
                                
                                {/* Blue Wave Wrapper - stops at connection junction */}
                                <div className="absolute -left-[40px] top-[-30px] bottom-1/2 w-[2px] overflow-hidden z-10">
                                    <div className="absolute inset-0 bg-blue-500 scale-y-0 origin-top group-has-[.group\/upload:hover]/modal:scale-y-100 transition-transform duration-500 ease-in-out" />
                                </div>

                                {/* Green Wave Wrapper - goes entirely past Option 1 down to margin */}
                                <div className="absolute -left-[40px] top-[-30px] bottom-[-24px] w-[2px] overflow-hidden z-10 pointer-events-none">
                                    <div className="absolute inset-0 bg-emerald-500 scale-y-0 origin-top group-has-[.group\/latex:hover]/modal:scale-y-100 transition-transform duration-[300ms] ease-linear" />
                                </div>

                                {/* Horizontal connector to Upload */}
                                <div className="absolute -left-[38px] top-1/2 w-[38px] h-[2px] bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                    {/* Blue wave going right */}
                                    <div className="absolute inset-0 bg-blue-500 -translate-x-full group-has-[.group\/upload:hover]/modal:translate-x-0 transition-transform duration-500 ease-in-out delay-0 group-has-[.group\/upload:hover]/modal:delay-100" />
                                </div>
                                {/* Junction dot */}
                                <div className="absolute -left-[43px] top-1/2 size-[10px] bg-slate-400 dark:bg-slate-500 group-has-[.group\/upload:hover]/modal:bg-blue-500 rounded-full -translate-y-1/2 shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_rgba(15,23,42,1)] z-10 transition-colors duration-500 delay-0 group-has-[.group\/upload:hover]/modal:delay-100" />

                                <div 
                                    className={`relative group/upload w-full p-8 md:p-10 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-lc-bg/20 hover:bg-blue-500/5 transition-all text-center ${uploading ? 'cursor-wait' : 'cursor-pointer'} min-h-[220px] flex flex-col items-center justify-center overflow-hidden`}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => {
                                        if (uploading) return;
                                        fileInputRef.current?.click();
                                    }}
                                >
                                    {/* Wave border effect using absolute pseudo element */}
                                    <div className="absolute inset-[-2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent -translate-x-full group-hover/upload:translate-x-[200%] transition-transform duration-1000 ease-in-out opacity-0 group-hover/upload:opacity-100 delay-200 pointer-events-none" />
                                    {/* Inner white background to cover the solid block from above so only borders glow */}
                                    <div className="absolute inset-[2px] rounded-[14px] bg-slate-50 dark:bg-lc-bg/90 pointer-events-none transition-colors group-hover/upload:bg-blue-50/50 dark:group-hover/upload:bg-blue-900/10" />

                                    {uploading ? (
                                        <div className="relative z-10 size-16 bg-white dark:bg-lc-surface rounded-full flex items-center justify-center shadow-sm text-slate-400 border border-slate-100 dark:border-lc-border">
                                            <div className="size-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                        </div>
                                    ) : (
                                        <div className="relative z-10 size-16 bg-white dark:bg-lc-surface rounded-full flex items-center justify-center shadow-sm text-slate-400 group-hover/upload:text-blue-500 group-hover/upload:scale-110 transition-all duration-500 mb-4 border border-slate-100 dark:border-lc-border">
                                            <span className="material-symbols-outlined text-3xl z-10">cloud_upload</span>
                                            <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl opacity-0 group-hover/upload:opacity-100 transition-opacity duration-500" />
                                        </div>
                                    )}

                                    <h4 className="relative z-10 font-bold text-slate-800 dark:text-slate-200 group-hover/upload:text-blue-500 mb-2 text-lg font-nunito transition-colors">
                                        {uploading ? "Uploading..." : "Upload a PDF Resume"}
                                    </h4>
                                    {!uploading && (
                                        <p className="relative z-10 text-sm text-slate-500 dark:text-slate-400 max-w-[250px] mx-auto leading-relaxed">
                                            Drag and drop your file here, or click to browse from your computer <br/> <span className="text-[10px] opacity-70 mt-2 block">(Max 5MB)</span>
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Option 2: Latex Area */}
                            <div className="relative w-full flex">
                                {/* Background Line bridging to Option 2 center */}
                                <div className="absolute -left-[40px] top-0 bottom-1/2 w-[2px] bg-slate-200 dark:bg-slate-700" />
                                
                                {/* Green Wave Wrapper - second half! Starts delayed to simulate single flowing line */}
                                <div className="absolute -left-[40px] top-0 bottom-1/2 w-[2px] overflow-hidden z-10 pointer-events-none">
                                    <div className="absolute inset-0 bg-emerald-500 scale-y-0 origin-top group-has-[.group\/latex:hover]/modal:scale-y-100 transition-transform duration-[200ms] ease-linear delay-0 group-has-[.group\/latex:hover]/modal:delay-[300ms]" />
                                </div>

                                {/* Horizontal connector to Latex */}
                                <div className="absolute -left-[38px] top-1/2 w-[38px] h-[2px] bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                    <div className="absolute inset-0 bg-emerald-500 -translate-x-full group-has-[.group\/latex:hover]/modal:translate-x-0 transition-transform duration-[300ms] ease-in-out delay-0 group-has-[.group\/latex:hover]/modal:delay-[500ms]" />
                                </div>
                                {/* Node dot */}
                                <div className="absolute -left-[43px] top-1/2 size-[10px] bg-slate-400 dark:bg-slate-500 group-has-[.group\/latex:hover]/modal:bg-emerald-500 rounded-full -translate-y-1/2 shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_rgba(15,23,42,1)] z-10 transition-colors duration-300 delay-0 group-has-[.group\/latex:hover]/modal:delay-[500ms]" />

                                <button 
                                    onClick={() => {
                                        setShowAddMenu(false);
                                        router.push('/resumes?new=true');
                                    }}
                                    className="group/latex relative w-full overflow-hidden p-[2px] rounded-xl bg-slate-200 dark:bg-slate-700 transition-all duration-300 hover:-translate-y-1 active:scale-95 cursor-pointer"
                                >
                                    {/* Wave border effect sweeping across */}
                                    <div className="absolute inset-[-2px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent -translate-x-full group-hover/latex:translate-x-[200%] transition-transform duration-[1000ms] ease-in-out opacity-0 group-hover/latex:opacity-100 delay-0 group-hover/latex:delay-[650ms]" />
                                    
                                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-600 blur-md opacity-0 transition-opacity duration-500" />
                                    
                                    <div className="relative flex items-center gap-3 px-6 py-3.5 bg-white dark:bg-lc-surface rounded-[10px] transition-colors duration-300 z-10 w-full hover:bg-emerald-50/50 dark:hover:bg-lc-surface">
                                        <div className="size-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center group-hover/latex:bg-emerald-100 dark:group-hover/latex:bg-emerald-500/20 transition-colors duration-300">
                                            <span className="material-symbols-outlined text-emerald-500 transition-colors duration-300 text-lg">auto_awesome</span>
                                        </div>
                                        <div className="flex flex-col items-start flex-1 text-left">
                                            <span className="font-bold font-nunito text-slate-800 dark:text-slate-100 transition-colors duration-300 leading-tight">
                                                Build with LaTeX
                                            </span>
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400 transition-colors duration-300">
                                                Use our magical AI builder
                                            </span>
                                        </div>
                                        <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 group-hover/latex:text-emerald-500 ml-3 transition-colors duration-300">arrow_forward</span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ATS Analysis Configuration Modal */}
            {activeModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setActiveModal(null)}
                    />
                    {/* Modal */}
                    <div className="relative w-full max-w-2xl bg-white dark:bg-lc-surface rounded-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] dark:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] border border-slate-200/60 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200 p-8 flex flex-col">
                        {/* Header */}
                        <div className="relative mb-8">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">
                                            {activeModal === 'jd' ? 'Job Description Based' : 'Role Based'}
                                        </h3>
                                        <span className="text-xs font-medium text-slate-500">
                                            {activeModal === 'jd' ? 'Analyze against a specific job description' : 'Analyze against industry standards'}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setActiveModal(null)}
                                    className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-slate-400 text-lg">close</span>
                                </button>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex flex-col flex-1 space-y-6">
                            {activeModal === 'jd' ? (
                                <div className="flex flex-col flex-1">
                                    <div className="flex justify-between items-center mb-3 relative z-10">
                                        <label className="block text-[13px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Paste Job Description</label>
                                        <span className={`text-[11px] font-bold transition-colors ${jobText.length < 50 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                            {jobText.length < 50 ? `${50 - jobText.length} more characters needed` : `${jobText.length} characters`}
                                        </span>
                                    </div>
                                    <textarea
                                        value={jobText}
                                        onChange={e => setJobText(e.target.value)}
                                        placeholder="E.g. We are looking for a Senior Software Engineer with 5+ years of experience in React, Node.js..."
                                        className="w-full min-h-[220px] flex-1 rounded-xl text-sm border-2 border-slate-200 dark:border-lc-border dark:bg-[#0f1115] bg-white text-slate-900 dark:text-[#eff1f6] p-4 outline-none focus:border-primary focus:bg-white dark:focus:bg-[#0f1115] dark:focus:border-primary shadow-sm transition-all resize-none custom-scrollbar relative z-10 placeholder-slate-400 dark:placeholder-white/20"
                                    />
                                </div>
                            ) : (
                                <div className="flex flex-col flex-1">
                                    <label className="block text-[13px] font-bold text-slate-500 dark:text-slate-400 mb-4 relative z-10 uppercase tracking-widest">Select Target Role</label>
                                    
                                    <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto overflow-x-hidden custom-scrollbar p-2 -mx-2 relative z-10">
                                        {ROLES.map(role => (
                                            <div 
                                                key={role.value}
                                                onClick={() => setTargetRole(role.label)}
                                                className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all hover:-translate-y-1 ${targetRole === role.label ? 'border-primary bg-primary/10 shadow-md scale-[1.02]' : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#0f1115] hover:border-primary/40 hover:shadow-sm'}`}
                                            >
                                                <div className="flex flex-col gap-0.5">
                                                    <span className={`font-bold ${targetRole === role.label ? 'text-primary' : 'text-slate-700 dark:text-slate-300'}`}>{role.label}</span>
                                                    <span className="text-xs text-slate-500 line-clamp-1">{role.description}</span>
                                                </div>
                                                {targetRole === role.label && <span className="material-symbols-outlined text-xl text-primary animate-in zoom-in">check_circle</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={() => {
                                    if (activeModal === 'jd' && jobText.length < 50) return;
                                    setAtsMode(activeModal);
                                    setActiveModal(null);
                                }}
                                disabled={activeModal === 'jd' && jobText.length < 50}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold font-nunito py-4 rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer mt-4 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                            >
                                Confirm
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