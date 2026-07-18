"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";

type Template = { slug: string; name: string; description: string; };

const TEMPLATE_ICONS: Record<string, string> = {
    "classic": "article",
    "two-column": "view_column",
    "minimalist": "crop_din",
    "executive": "work",
};

interface ResumeBuilderModalProps {
    isOpen: boolean;
    onClose: () => void;
    editingResumeId?: string | null;
    onExitEditMode?: () => void;
}

export function ResumeBuilderModal({
    isOpen,
    onClose,
    editingResumeId = null,
    onExitEditMode,
}: ResumeBuilderModalProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const router = useRouter();

    const [templates, setTemplates] = useState<Template[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(true);

    useEffect(() => {
        if (!isOpen) return;
        const fetchTemplates = async () => {
            setLoadingTemplates(true);
            const supabase = createSupabaseBrowserClient();
            const { data } = await supabase.auth.getSession();
            if (!data.session) return;
            try {
                const result = await api.get<{ templates: Template[] }>("/latex-resumes/templates", data.session.access_token);
                setTemplates(result.templates);
            } catch {
                setTemplates([
                    { slug: "classic", name: "The Classic", description: "A clean and timeless single-column resume format" },
                    { slug: "two-column", name: "Two Column Pro", description: "A modern two-column layout highlighting your skills" },
                    { slug: "minimalist", name: "Clean Minimalist", description: "Minimalist and systems-focused design" },
                    { slug: "executive", name: "Executive Split", description: "Professional split layout for executive roles" }
                ]);
            } finally {
                setLoadingTemplates(false);
            }
        };
        fetchTemplates();
    }, [isOpen]);

    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [generatingSummary, setGeneratingSummary] = useState(false);
    const [rephrasing, setRephrasing] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [draftHydrated, setDraftHydrated] = useState(false);
    const [errors, setErrors] = useState<{name?: string, education?: string}>({});
    const [skippedSummary, setSkippedSummary] = useState(false);

    // Form Data State
    const [template, setTemplate] = useState("classic");
    const [personalInfo, setPersonalInfo] = useState({
        name: "", phone: "", email: "", linkedin: "", github: "", portfolio: "", summary: ""
    });
    const [education, setEducation] = useState([
        { institution: "", location: "", degree: "", duration: "", gpa: "" }
    ]);
    const [experience, setExperience] = useState([
        { company: "", location: "", role: "", duration: "", bullets: [""] }
    ]);
    const [projects, setProjects] = useState([
        { name: "", technologies: "", role: "", duration: "", bullets: [""] }
    ]);
    const [skills, setSkills] = useState([
        { category: "Languages", items: "" },
        { category: "Frameworks & Tools", items: "" },
        { category: "Cloud & Databases", items: "" }
    ]);

    const draftStorageKey = (id: string) => `latex-resume-draft:${id}`;

    useEffect(() => {
        if (!isOpen) {
            setDraftHydrated(false);
            return;
        }

        if (!editingResumeId) {
            setStep(1);
            setDraftHydrated(true);
            return;
        }

        setStep(2);

        try {
            const raw = typeof window !== "undefined" ? localStorage.getItem(draftStorageKey(editingResumeId)) : null;
            if (!raw) return;
            const parsed = JSON.parse(raw) as {
                title?: string;
                template?: string;
                formData?: {
                    personalInfo?: typeof personalInfo;
                    education?: typeof education;
                    experience?: typeof experience;
                    projects?: typeof projects;
                    skills?: typeof skills;
                };
            };

            if (parsed.template) setTemplate(parsed.template);
            if (parsed.formData?.personalInfo) setPersonalInfo(parsed.formData.personalInfo);
            if (parsed.formData?.education?.length) setEducation(parsed.formData.education);
            if (parsed.formData?.experience?.length) setExperience(parsed.formData.experience);
            if (parsed.formData?.projects?.length) setProjects(parsed.formData.projects);
            if (parsed.formData?.skills?.length) setSkills(parsed.formData.skills);
        } catch {
            // Ignore malformed drafts
        } finally {
            setDraftHydrated(true);
        }
    }, [isOpen, editingResumeId]);

    useEffect(() => {
        if (!isOpen || !editingResumeId || !draftHydrated || typeof window === "undefined") return;

        const formDataPayload = {
            personalInfo,
            education,
            experience,
            projects,
            skills,
        };

        localStorage.setItem(
            draftStorageKey(editingResumeId),
            JSON.stringify({
                title: "",
                template,
                formData: formDataPayload,
            })
        );
    }, [
        isOpen,
        editingResumeId,
        draftHydrated,
        template,
        personalInfo,
        education,
        experience,
        projects,
        skills,
    ]);

    const [previewTemplate, setPreviewTemplate] = useState<string | null>(null);
    const totalSteps = 6;

    if (!isOpen) return null;

    const handleNext = () => {
        if (step === 2) {
            if (!personalInfo.name.trim()) {
                setErrors({ ...errors, name: "Full Name is required" });
                return;
            }
            setErrors({ ...errors, name: undefined });
            setSkippedSummary(!personalInfo.summary.trim());
        }
        if (step === 3) {
            if (!education.some(e => e.institution.trim())) {
                setErrors({ ...errors, education: "At least one Education institution is required" });
                return;
            }
            setErrors({ ...errors, education: undefined });
        }
        setStep(s => Math.min(totalSteps, s + 1));
    };
    const handleBack = () => {
        if (editingResumeId && step === 2) {
            if (onExitEditMode) {
                onExitEditMode();
            } else {
                onClose();
            }
            return;
        }

        const minStep = editingResumeId ? 2 : 1;
        setStep((s) => Math.max(minStep, s - 1));
    };

    const handleSubmit = async (e?: FormEvent) => {
        if (e) e.preventDefault();
        setSubmitting(true);
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;

        const tmplName = templates.find(t => t.slug === template)?.name || "Resume";

        try {
            const formDataPayload = {
                personalInfo,
                education: education.filter(e => e.institution),
                experience: experience.filter(e => e.company).map(e => ({ ...e, bullets: e.bullets.filter(b => b) })),
                projects: projects.filter(p => p.name).map(p => ({ ...p, bullets: p.bullets.filter(b => b) })),
                skills: skills.filter(s => s.items)
            };

            if (editingResumeId) {
                await api.post(
                    `/latex-resumes/${editingResumeId}/rebuild`,
                    {
                        title: `My ${tmplName}`,
                        template,
                        formData: formDataPayload,
                    },
                    data.session.access_token
                );

                if (typeof window !== "undefined") {
                    localStorage.setItem(
                        draftStorageKey(editingResumeId),
                        JSON.stringify({
                            title: `My ${tmplName}`,
                            template,
                            formData: formDataPayload,
                        })
                    );
                }

                setSubmitting(false);
                onClose();
                router.refresh();
                return;
            }

            const result = await api.post<{ id: string }>(
                "/latex-resumes",
                {
                    title: `My ${tmplName}`,
                    template,
                    formData: formDataPayload
                },
                data.session.access_token
            );

            if (typeof window !== "undefined") {
                localStorage.setItem(
                    draftStorageKey(result.id),
                    JSON.stringify({
                        title: `My ${tmplName}`,
                        template,
                        formData: formDataPayload,
                    })
                );
            }

            router.push(`/resumes/editor/${result.id}`);
        } catch (err) {
            console.error(err);
            alert("Failed to build resume.");
            setSubmitting(false);
        }
    };

    const handleGenerateSummary = async () => {
        setGeneratingSummary(true);
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;

        try {
            const formDataPayload = {
                personalInfo,
                education: education.filter(e => e.institution),
                experience: experience.filter(e => e.company).map(e => ({ ...e, bullets: e.bullets.filter(b => b) })),
                projects: projects.filter(p => p.name).map(p => ({ ...p, bullets: p.bullets.filter(b => b) })),
                skills: skills.filter(s => s.items)
            };

            const result = await api.post<{ summary: string }>(
                "/latex-resumes/generate-summary",
                { formData: formDataPayload },
                data.session.access_token
            );
            
            setPersonalInfo({ ...personalInfo, summary: result.summary });
        } catch (err) {
            console.error(err);
            alert("Failed to generate summary with AI. Please try again.");
        } finally {
            setGeneratingSummary(false);
        }
    };

    const handleRephrase = async () => {
        if (!personalInfo.summary) return;
        setRephrasing(true);
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        try {
            const result = await api.post<{ summary: string }>("/latex-resumes/rephrase-summary", { text: personalInfo.summary }, data.session.access_token);
            setPersonalInfo({ ...personalInfo, summary: result.summary });
        } catch (err) {
            console.error(err);
            alert("Failed to rephrase summary with AI.");
        } finally {
            setRephrasing(false);
        }
    };

    const handleExtractPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setExtracting(true);
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;

        const formData = new FormData();
        formData.append("file", file);

        try {
            const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            const res = await fetch(`${API_BASE}/latex-resumes/extract-from-pdf`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${data.session.access_token}`
                },
                body: formData
            });

            if (!res.ok) {
                let msg = "Failed to extract data from resume. Please verify it is a valid PDF with selectable text.";
                try {
                    const e = await res.json();
                    if (e?.message) msg = e.message;
                } catch { /* keep default */ }
                throw new Error(msg);
            }
            const result = await res.json();

            const ext = result.extraction;
            const personalFilled = ext?.personalInfo && Object.values(ext.personalInfo).some(
                (v) => typeof v === "string" && v.trim().length > 0
            );
            const hasData = ext && (personalFilled || ext.education?.length || ext.experience?.length || ext.projects?.length || ext.skills?.length);

            if (!hasData) {
                alert("We couldn't read any details from that resume. Please try a different, text-based PDF.");
                return;
            }

            if (ext.personalInfo) setPersonalInfo(p => ({ ...p, ...ext.personalInfo }));
            if (ext.education?.length) setEducation(ext.education);
            if (ext.experience?.length) setExperience(ext.experience);
            if (ext.projects?.length) setProjects(ext.projects);
            if (ext.skills?.length) setSkills(ext.skills);
        } catch (err: any) {
            console.error(err);
            alert(err?.message || "Failed to extract data from resume. Please verify it is a valid PDF with selectable text.");
        } finally {
            setExtracting(false);
            e.target.value = ''; // Reset input
        }
    };

    const renderInput = (label: string, value: string, onChange: (val: string) => void, placeholder = "", errorMsg?: string) => (
        <div className="flex flex-col gap-1.5 w-full">
            <label className={`text-xs font-semibold flex justify-between ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                <span>{label}</span>
                {errorMsg && <span className="text-red-500 font-bold">{errorMsg}</span>}
            </label>
            <input 
                type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-colors
                    ${errorMsg ? "border-red-500 focus:ring-red-500/50" : (isDark ? "border-[#3e3e3e] focus:ring-primary/50" : "border-gray-200 focus:ring-primary/50")}
                    ${isDark ? "bg-[#252525] text-white" : "bg-white"}`
                }
            />
        </div>
    );

    const renderTextarea = (label: string, value: string, onChange: (val: string) => void, placeholder = "") => (
        <div className="flex flex-col gap-1.5 w-full">
            <label className={`text-xs font-semibold ${isDark ? "text-gray-300" : "text-gray-700"}`}>{label}</label>
            <textarea 
                value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3}
                className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors
                    ${isDark ? "bg-[#252525] border-[#3e3e3e] text-white" : "bg-white border-gray-200"}`
                }
            />
        </div>
    );

    // Dynamic Lists Actions
    const addEducation = () => setEducation([...education, { institution: "", location: "", degree: "", duration: "", gpa: "" }]);
    const addExperience = () => setExperience([...experience, { company: "", location: "", role: "", duration: "", bullets: [""] }]);
    const addProject = () => setProjects([...projects, { name: "", technologies: "", role: "", duration: "", bullets: [""] }]);
    
    const removeEducation = (index: number) => setEducation(education.filter((_, i) => i !== index));
    const removeExperience = (index: number) => setExperience(experience.filter((_, i) => i !== index));
    const removeProject = (index: number) => setProjects(projects.filter((_, i) => i !== index));

    const renderStepContent = () => {
        switch (step) {
            case 1:
                return (
                    <div className="flex gap-4 overflow-x-auto pb-2 px-1 sm:grid sm:grid-cols-3 sm:gap-6 sm:overflow-visible sm:pb-0 max-w-5xl mx-auto w-full py-4 snap-x">
                        {templates.map((tmpl) => (
                            <div
                                key={tmpl.slug}
                                onClick={() => setTemplate(tmpl.slug)}
                                className={`cursor-pointer group relative text-left rounded-xl border overflow-hidden transition-all flex flex-col flex-none w-[160px] sm:w-auto snap-center ${
                                    template === tmpl.slug 
                                        ? (isDark ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-primary bg-blue-50 ring-2 ring-primary/30")
                                        : (isDark ? "bg-[#1e1e1e] border-[#3e3e3e] hover:border-primary/50" : "bg-white border-gray-200 hover:border-primary/50")
                                }`}
                            >
                                {/* Template Image Preview */}
                                <div className={`relative w-full aspect-[21/29.7] overflow-hidden ${isDark ? "bg-[#111]" : "bg-white"} border-b ${isDark ? "border-[#3e3e3e]" : "border-gray-200"}`}>
                                    {/* Transparent overlay over iframe to catch clicks for the button */}
                                    <div className="absolute inset-0 z-10 bg-transparent" />
                                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                        <iframe 
                                            src={`/templates/${tmpl.slug}.pdf#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} 
                                            title={`${tmpl.name} preview`} 
                                            className="w-full h-full border-0 pointer-events-none scale-[1.14] origin-top bg-white"
                                        />
                                    </div>
                                    {template === tmpl.slug && (
                                        <div className="absolute top-2 right-2 z-20 bg-primary text-white rounded-full p-1 shadow-md">
                                            <span className="material-symbols-outlined text-[16px] block">check_circle</span>
                                        </div>
                                    )}
                                </div>
                                
                                {/* Template Details */}
                                <div className="p-3 flex-1 flex flex-col justify-between">
                                    <div>
                                        <h3 className={`text-[13px] font-semibold mb-0.5 ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                                            {tmpl.name}
                                        </h3>
                                        <p className={`text-[10px] leading-snug ${isDark ? "text-gray-500" : "text-gray-500"}`}>
                                            {tmpl.description}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                );
            case 2:
                return (
                    <div className="space-y-4">
                        <div className={`p-4 rounded-xl border ${isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-indigo-50 border-indigo-100"} flex flex-col gap-2 mb-2`}>
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-indigo-500">document_scanner</span>
                                <h3 className={`text-sm font-bold ${isDark ? "text-gray-200" : "text-gray-800"}`}>Extract Details from Resume</h3>
                            </div>
                            <p className="text-xs text-gray-500 leading-snug">Upload your existing resume to instantly fill out all sections automatically.</p>
                            <label className={`mt-2 flex items-center justify-center px-4 py-2.5 border border-dashed rounded-lg cursor-pointer transition-colors ${extracting ? "opacity-50 pointer-events-none" : ""} ${isDark ? "border-[#444] hover:border-indigo-500/50" : "border-indigo-200 hover:border-indigo-400 bg-white"}`}>
                                {extracting ? (
                                    <span className="text-xs font-semibold text-gray-500 flex items-center gap-2">
                                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> Extracting Data...
                                    </span>
                                ) : (
                                    <span className="text-xs font-semibold text-indigo-600 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[16px]">upload_file</span> Select PDF
                                    </span>
                                )}
                                <input type="file" accept="application/pdf" className="hidden" disabled={extracting} onChange={handleExtractPdf} />
                            </label>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            {renderInput("Full Name", personalInfo.name, (val) => { setPersonalInfo({ ...personalInfo, name: val }); setErrors({...errors, name: undefined}); }, "Jane Doe", errors.name)}
                            {renderInput("Email", personalInfo.email, (val) => setPersonalInfo({ ...personalInfo, email: val }), "jane@example.com")}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {renderInput("Phone", personalInfo.phone, (val) => setPersonalInfo({ ...personalInfo, phone: val }), "+1 (555) 000-0000")}
                            {renderInput("LinkedIn URL", personalInfo.linkedin, (val) => setPersonalInfo({ ...personalInfo, linkedin: val }), "linkedin.com/in/jane")}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {renderInput("GitHub URL", personalInfo.github, (val) => setPersonalInfo({ ...personalInfo, github: val }), "github.com/jane")}
                            {renderInput("Portfolio/Website", personalInfo.portfolio, (val) => setPersonalInfo({ ...personalInfo, portfolio: val }), "janedoe.com")}
                        </div>
                        <div className="flex flex-col gap-1.5 w-full">
                            <label className={`text-xs font-semibold ${isDark ? "text-gray-300" : "text-gray-700"}`}>Professional Summary or Generate with AI at the end</label>
                            <textarea 
                                value={personalInfo.summary} onChange={e => setPersonalInfo({ ...personalInfo, summary: e.target.value })} placeholder="Brief overview of your background and career goals..." rows={3}
                                className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors
                                    ${isDark ? "bg-[#252525] border-[#3e3e3e] text-white" : "bg-white border-gray-200"}`
                                }
                            />
                            <div className="flex justify-end mt-1">
                                <button 
                                    onClick={handleRephrase}
                                    disabled={rephrasing || !personalInfo.summary.trim()}
                                    className={`text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                        !personalInfo.summary.trim() 
                                            ? "text-gray-400 cursor-not-allowed" 
                                            : "text-indigo-500 hover:text-indigo-600"
                                    }`}
                                >
                                    {rephrasing ? (
                                        <><span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>Rephrasing...</>
                                    ) : (
                                        <><span className="material-symbols-outlined text-[14px]">auto_awesome</span>Rephrase with AI</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            case 3:
                return (
                    <div className="space-y-6">
                        {errors.education && <p className="text-red-500 text-xs font-bold">{errors.education}</p>}
                        {education.map((edu, idx) => (
                            <div key={idx} className={`p-4 rounded-xl border relative ${isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-gray-50 border-gray-200"}`}>
                                {education.length > 1 && (
                                    <button onClick={() => removeEducation(idx)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500">
                                        <span className="material-symbols-outlined text-sm">close</span>
                                    </button>
                                )}
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    {renderInput("Institution", edu.institution, (val) => { const n = [...education]; n[idx].institution = val; setEducation(n); setErrors({...errors, education: undefined}); }, "University Name", errors.education ? "Required" : undefined)}
                                    {renderInput("Location", edu.location, (val) => { const n = [...education]; n[idx].location = val; setEducation(n); }, "City, State")}
                                </div>
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    {renderInput("Degree (e.g. BS Computer Science)", edu.degree, (val) => { const n = [...education]; n[idx].degree = val; setEducation(n); }, "B.S. in Computer Science")}
                                    {renderInput("Duration", edu.duration, (val) => { const n = [...education]; n[idx].duration = val; setEducation(n); }, "Aug 2018 - May 2022")}
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    {renderInput("Marks / GPA", edu.gpa, (val) => { const n = [...education]; n[idx].gpa = val; setEducation(n); }, "3.8 / 4.0 or 85%")}
                                </div>
                            </div>
                        ))}
                        <button onClick={addEducation} className="flex items-center gap-2 text-primary font-semibold text-sm hover:underline">
                            <span className="material-symbols-outlined text-base">add_circle</span> Add Education
                        </button>
                    </div>
                );
            case 4:
                return (
                    <div className="space-y-6">
                        {experience.map((exp, idx) => (
                            <div key={idx} className={`p-4 rounded-xl border relative ${isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-gray-50 border-gray-200"}`}>
                                {experience.length > 1 && (
                                    <button onClick={() => removeExperience(idx)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500">
                                        <span className="material-symbols-outlined text-sm">close</span>
                                    </button>
                                )}
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    {renderInput("Company", exp.company, (val) => { const n = [...experience]; n[idx].company = val; setExperience(n); }, "Tech Corp")}
                                    {renderInput("Location", exp.location, (val) => { const n = [...experience]; n[idx].location = val; setExperience(n); }, "City, State")}
                                </div>
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    {renderInput("Role", exp.role, (val) => { const n = [...experience]; n[idx].role = val; setExperience(n); }, "Software Engineer")}
                                    {renderInput("Duration", exp.duration, (val) => { const n = [...experience]; n[idx].duration = val; setExperience(n); }, "June 2022 - Present")}
                                </div>
                                <div className="space-y-2 mt-4">
                                    <label className={`text-xs font-semibold ${isDark ? "text-gray-300" : "text-gray-700"}`}>Bullet Points</label>
                                    {exp.bullets.map((bullet, bIdx) => (
                                        <div key={bIdx} className="flex items-start gap-2">
                                            <span className="mt-2 text-gray-400 text-xs">•</span>
                                            <textarea 
                                                value={bullet} 
                                                onChange={(e) => { const n = [...experience]; n[idx].bullets[bIdx] = e.target.value; setExperience(n); }} 
                                                placeholder="Describe your impact and achievements..." rows={2}
                                                className={`w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors
                                                    ${isDark ? "bg-[#252525] border-[#3e3e3e] text-white" : "bg-white border-gray-200"}`
                                                }
                                            />
                                            <button onClick={() => { const n = [...experience]; n[idx].bullets.splice(bIdx, 1); setExperience(n); }} className="mt-1 text-gray-400 hover:text-red-500">
                                                <span className="material-symbols-outlined text-sm">close</span>
                                            </button>
                                        </div>
                                    ))}
                                    <button onClick={() => { const n = [...experience]; n[idx].bullets.push(""); setExperience(n); }} className="text-[11px] font-semibold text-primary/80 hover:text-primary mt-1">
                                        + Add Bullet
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button onClick={addExperience} className="flex items-center gap-2 text-primary font-semibold text-sm hover:underline">
                            <span className="material-symbols-outlined text-base">add_circle</span> Add Experience
                        </button>
                    </div>
                );
            case 5:
                return (
                    <div className="space-y-6">
                        {projects.map((proj, idx) => (
                            <div key={idx} className={`p-4 rounded-xl border relative ${isDark ? "bg-[#1a1a1a] border-[#333]" : "bg-gray-50 border-gray-200"}`}>
                                {projects.length > 1 && (
                                    <button onClick={() => removeProject(idx)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500">
                                        <span className="material-symbols-outlined text-sm">close</span>
                                    </button>
                                )}
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    {renderInput("Project Name", proj.name, (val) => { const n = [...projects]; n[idx].name = val; setProjects(n); }, "E-Commerce App")}
                                    {renderInput("Technologies", proj.technologies, (val) => { const n = [...projects]; n[idx].technologies = val; setProjects(n); }, "React, Node.js, MongoDB")}
                                </div>
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    {renderInput("Your Role/Affiliation", proj.role, (val) => { const n = [...projects]; n[idx].role = val; setProjects(n); }, "Personal Project")}
                                    {renderInput("Duration", proj.duration, (val) => { const n = [...projects]; n[idx].duration = val; setProjects(n); }, "Fall 2022")}
                                </div>
                                <div className="space-y-2 mt-4">
                                    <label className={`text-xs font-semibold ${isDark ? "text-gray-300" : "text-gray-700"}`}>Bullet Points</label>
                                    {proj.bullets.map((bullet, bIdx) => (
                                        <div key={bIdx} className="flex items-start gap-2">
                                            <span className="mt-2 text-gray-400 text-xs">•</span>
                                            <textarea 
                                                value={bullet} 
                                                onChange={(e) => { const n = [...projects]; n[idx].bullets[bIdx] = e.target.value; setProjects(n); }} 
                                                placeholder="Describe the project and your contributions..." rows={2}
                                                className={`w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors
                                                    ${isDark ? "bg-[#252525] border-[#3e3e3e] text-white" : "bg-white border-gray-200"}`
                                                }
                                            />
                                            <button onClick={() => { const n = [...projects]; n[idx].bullets.splice(bIdx, 1); setProjects(n); }} className="mt-1 text-gray-400 hover:text-red-500">
                                                <span className="material-symbols-outlined text-sm">close</span>
                                            </button>
                                        </div>
                                    ))}
                                    <button onClick={() => { const n = [...projects]; n[idx].bullets.push(""); setProjects(n); }} className="text-[11px] font-semibold text-primary/80 hover:text-primary mt-1">
                                        + Add Bullet
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button onClick={addProject} className="flex items-center gap-2 text-primary font-semibold text-sm hover:underline">
                            <span className="material-symbols-outlined text-base">add_circle</span> Add Project
                        </button>
                    </div>
                );
            case 6:
                return (
                    <div className="space-y-2">
                        <div className="space-y-4">
                            {skills.map((skill, idx) => (
                                <div key={idx} className="grid grid-cols-[1fr_2fr_auto] gap-3 items-start">
                                    {renderInput("Category", skill.category, (val) => { const n = [...skills]; n[idx].category = val; setSkills(n); }, "Languages")}
                                    {renderInput("Skills (comma separated)", skill.items, (val) => { const n = [...skills]; n[idx].items = val; setSkills(n); }, "Python, JavaScript, Go")}
                                    <button onClick={() => setSkills(skills.filter((_, i) => i !== idx))} className="mt-7 text-gray-400 hover:text-red-500">
                                        <span className="material-symbols-outlined text-lg">delete</span>
                                    </button>
                                </div>
                            ))}
                            <button onClick={() => setSkills([...skills, { category: "", items: "" }])} className="flex items-center gap-2 text-primary font-semibold text-sm hover:underline mt-2">
                                <span className="material-symbols-outlined text-base">add_circle</span> Add Skill Category
                            </button>
                        </div>

                        {skippedSummary && (
                            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-[#333]">
                                <h3 className={`text-sm font-bold mb-1 ${isDark ? "text-white" : "text-gray-800"}`}>Professional Summary</h3>
                                <p className="text-xs text-gray-500 mb-4">Generate a professional summary automatically using the details you've provided.</p>
                                
                                <textarea 
                                    value={personalInfo.summary} 
                                    onChange={e => setPersonalInfo({ ...personalInfo, summary: e.target.value })} 
                                    placeholder="Your generated summary will appear here" 
                                    rows={4}
                                    className={`w-full px-3 py-2 rounded-lg border text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors
                                        ${isDark ? "bg-[#252525] border-[#3e3e3e] text-white" : "bg-white border-gray-200"}`
                                    }
                                />
                                <button 
                                    onClick={handleGenerateSummary}
                                    disabled={generatingSummary}
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-semibold text-[11px] shadow-sm transition-colors flex items-center gap-1.5 max-w-max"
                                >
                                    {generatingSummary ? (
                                        <>
                                            <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                                            Generating
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                                            Generate with AI
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                );
        default:
                return null;
        }
    };

    const TITLES = [
        "Choose Template", "Personal Details", "Education", "Experience", "Projects", "Technical Skills"
    ];

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            
            <div className={`relative w-full max-w-5xl h-[85vh] flex flex-col rounded-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-200 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.3)] border-0 border-b-[12px] ${isDark ? "bg-[#18181A] border-b-black/50" : "bg-white border-b-gray-200/70"}`}>
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 border-slate-100 dark:border-[#333]">
                    <div>
                        <h2 className="text-xl font-bold font-nunito">{TITLES[step-1]}</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <p className="text-xs text-gray-500">Step {step} of {totalSteps}</p>
                            <div className="flex gap-1">
                                {Array.from({length: totalSteps}).map((_, i) => (
                                    <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
                                        i + 1 === step ? "w-4 bg-primary" : i + 1 < step ? "w-2 bg-primary/40" : "w-2 bg-gray-200 dark:bg-[#444]"
                                    }`}/>
                                ))}
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] transition-colors text-gray-500">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
                    {renderStepContent()}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-[#333] bg-gray-50 dark:bg-[#1a1a1a] shrink-0">
                    <button 
                        disabled={(editingResumeId ? step === 2 : step === 1) || submitting}
                        onClick={handleBack} 
                        className="px-5 py-2 rounded-xl font-semibold text-sm hover:bg-gray-200 dark:hover:bg-[#333] disabled:opacity-30 transition-colors"
                    >
                        {editingResumeId && step === 2 ? "Back to Editor" : "Back"}
                    </button>
                    
                    <div className="flex items-center gap-3">
                        {step === 1 && (
                            <button
                                onClick={() => setPreviewTemplate(template)}
                                disabled={!template}
                                className="px-5 py-2 border border-slate-200 dark:border-[#444] hover:bg-slate-100 dark:hover:bg-[#333] text-slate-700 dark:text-slate-300 rounded-xl font-bold text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span className="material-symbols-outlined text-[18px]">visibility</span> Preview
                            </button>
                        )}
                        {step < totalSteps ? (
                            <button 
                                onClick={handleNext}
                                className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 transition-colors"
                            >
                                Next
                            </button>
                        ) : (
                            <button 
                                onClick={handleSubmit}
                                disabled={submitting}
                                className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 transition-colors flex items-center gap-2"
                            >
                                {submitting ? (
                                    <>
                                        <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                                        {editingResumeId ? "Updating..." : "Generating..."}
                                    </>
                                ) : (
                                    editingResumeId ? "Update Resume" : "Generate Resume"
                                )}
                            </button>
                        )}
                    </div>
                </div>

            </div>
            
            {/* ── PDF Preview Modal ───────────────────────────── */}
            {previewTemplate && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPreviewTemplate(null)} />
                    <div className="relative w-full max-w-3xl h-[85vh] bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden flex flex-col animate-in zoom-in-95 fade-in duration-200">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-lc-border shrink-0">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary">visibility</span>
                                <span className="text-sm font-semibold text-slate-800 dark:text-white font-nunito">
                                    Preview: {templates.find(t => t.slug === previewTemplate)?.name}
                                </span>
                            </div>
                            <button
                                onClick={() => setPreviewTemplate(null)}
                                className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-slate-400 text-lg">close</span>
                            </button>
                        </div>
                        <div className="flex-1 w-full bg-slate-100 dark:bg-lc-bg p-4 flex justify-center overflow-auto custom-scrollbar relative">
                            {/* Loading spinner behind the iframe */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin opacity-50" />
                            </div>
                            <iframe
                                src={`/templates/${previewTemplate}.pdf`}
                                className="w-full max-w-[850px] aspect-[21/29.7] shadow-xl bg-white border border-slate-200 z-10"
                                title="Resume Template Preview"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
