"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { useTheme } from "next-themes";
import { LatexTemplatePicker } from "@/components/latex-editor/latex-template-picker";

interface Question {
    id: string;
    question: string;
    type: "text" | "choice";
    options?: string[];
}

interface ImproveResumeModalProps {
    isOpen: boolean;
    onClose: () => void;
    resumeId: string;
}

export function ImproveResumeModal({ isOpen, onClose, resumeId }: ImproveResumeModalProps) {
    const router = useRouter();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    const [loadingQuestions, setLoadingQuestions] = useState(true);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    
    const [generatingData, setGeneratingData] = useState(false);
    const [formDataPayload, setFormDataPayload] = useState<any>(null);

    const [submittingTemplate, setSubmittingTemplate] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchQuestions();
        } else {
            // Reset state
            setLoadingQuestions(true);
            setQuestions([]);
            setCurrentIndex(0);
            setAnswers({});
            setGeneratingData(false);
            setFormDataPayload(null);
            setSubmittingTemplate(false);
        }
    }, [isOpen]);

    const fetchQuestions = async () => {
        setLoadingQuestions(true);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;

            const res = await api.post<{ questions: Question[] }>(`/latex-resumes/improve-questions/${resumeId}`, {}, token);
            setQuestions(res.questions || []);
        } catch (err: any) {
            console.error(err);
            alert("Failed to generate improvement questions: " + err.message);
            onClose();
        } finally {
            setLoadingQuestions(false);
        }
    };

    const handleNextQuestion = () => {
        if (currentIndex < questions.length - 1) {
            setCurrentIndex(currentIndex + 1);
        } else {
            generateImprovedData();
        }
    };

    const generateImprovedData = async () => {
        setGeneratingData(true);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) return;

            // Formulate qaPairs
            const qaPairs = questions.map(q => ({
                question: q.question,
                answer: answers[q.id] || ""
            }));

            const res = await api.post<{ formData: any }>(`/latex-resumes/improve-data/${resumeId}`, { qaPairs }, token);
            setFormDataPayload(res.formData);
        } catch (err: any) {
            console.error(err);
            alert("Failed to generate improved resume structure.");
            onClose();
        } finally {
            setGeneratingData(false);
        }
    };

    const handleTemplateAction = async (title: string, templateId: string) => {
        setSubmittingTemplate(true);
        try {
            const supabase = createSupabaseBrowserClient();
            const { data } = await supabase.auth.getSession();
            if (!data.session) return;

            const res = await api.post<{ id: string }>("/latex-resumes", {
                title,
                template: templateId,
                formData: formDataPayload
            }, data.session.access_token);

            onClose();
            router.push(`/resumes/editor/${res.id}`);
        } catch (err) {
            console.error(err);
            alert("Failed to create LaTeX resume");
        } finally {
            setSubmittingTemplate(false);
        }
    };

    if (!isOpen) return null;

    // View: Loading Questions
    if (loadingQuestions) {
        return (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <div className={`relative w-full max-w-lg p-10 flex flex-col items-center justify-center rounded-2xl shadow-2xl animate-in zoom-in-95 fade-in duration-200 ${isDark ? "bg-[#18181A] text-white" : "bg-white text-slate-800"}`}>
                    <div className="size-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                    <h2 className="text-lg font-bold font-nunito">AI Reviewing Analysis...</h2>
                    <p className="text-sm text-slate-500 text-center mt-2">Preparing targeted questions based on your ATS report.</p>
                </div>
            </div>
        );
    }

    // View: Generating Data (After Questions)
    if (generatingData) {
        return (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <div className={`relative w-full max-w-lg p-10 flex flex-col items-center justify-center rounded-2xl shadow-2xl animate-in zoom-in-95 fade-in duration-200 ${isDark ? "bg-[#18181A] text-white" : "bg-white text-slate-800"}`}>
                    <div className="size-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <h2 className="text-lg font-bold font-nunito">Applying Feedback...</h2>
                    <p className="text-sm text-slate-500 text-center mt-2">Weaving your answers into a completely optimized resume structure.</p>
                </div>
            </div>
        );
    }

    // View: Template Picker (After Generating Data)
    if (formDataPayload) {
        return (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
                <div className={`relative w-full max-w-5xl h-[85vh] flex flex-col rounded-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-200 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.3)] border-0 border-b-[12px] ${isDark ? "bg-[#18181A] border-b-black/50" : "bg-white border-b-gray-200/70"}`}>
                    
                    <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 border-slate-100 dark:border-[#333]">
                        <div>
                            <h2 className="text-xl font-bold font-nunito flex items-center gap-2">
                                <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                                Resume Generated! Let's Structure it!
                            </h2>
                            <p className="text-xs text-gray-500">Pick a professional LaTeX template for your new tailored resume.</p>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] transition-colors text-gray-500 cursor-pointer">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar relative">
                        {submittingTemplate && (
                            <div className="absolute inset-0 bg-white/50 dark:bg-black/50 backdrop-blur-sm z-10 flex items-center justify-center">
                                <div className="size-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}
                        <LatexTemplatePicker 
                            actionLabel="Build Improved Resume"
                            onAction={handleTemplateAction} 
                        />
                    </div>
                </div>
            </div>
        );
    }

    // View: QA Loop
    if (questions.length === 0) {
        return (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                <div className={`relative w-full max-w-lg p-10 flex flex-col items-center justify-center rounded-2xl shadow-2xl animate-in zoom-in-95 fade-in duration-200 ${isDark ? "bg-[#18181A] text-white" : "bg-white text-slate-800"}`}>
                    <div className="size-16 bg-emerald-100 flex items-center justify-center rounded-full mb-4">
                        <span className="material-symbols-outlined text-emerald-600 text-3xl">task_alt</span>
                    </div>
                    <h2 className="text-lg font-bold font-nunito">All Good!</h2>
                    <p className="text-sm text-slate-500 text-center mt-2 mb-6">AI found no missing critical sections! Let's jump straight to rebuilding it.</p>
                    <button onClick={generateImprovedData} className="px-6 py-2.5 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors">
                        Proceed to Build
                    </button>
                    <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white cursor-pointer"><span className="material-symbols-outlined">close</span></button>
                </div>
            </div>
        );
    }

    const currentQuestion = questions[currentIndex];
    
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}/>
            <div className={`relative w-full max-w-xl flex flex-col rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-200 ${isDark ? "bg-lc-surface border border-lc-border" : "bg-white"}`}>
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 border-slate-100 dark:border-[#333]">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <span className="material-symbols-outlined text-indigo-500">smart_toy</span>
                            AI Improvement Flow
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] transition-colors text-gray-500 cursor-pointer">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto px-8 py-8">
                    <p className="text-xs uppercase tracking-widest text-indigo-500 font-bold mb-2">Question {currentIndex + 1} of {questions.length}</p>
                    <h3 className={`text-xl font-bold font-nunito mb-6 leading-relaxed ${isDark ? "text-white" : "text-gray-900"}`}>
                        {currentQuestion.question}
                    </h3>

                    {currentQuestion.type === "choice" && currentQuestion.options ? (
                        <div className="flex flex-col gap-3">
                            {currentQuestion.options.map((opt) => (
                                <button
                                    key={opt}
                                    onClick={() => {
                                        setAnswers(prev => ({ ...prev, [currentQuestion.id]: opt }));
                                    }}
                                    className={`px-5 py-4 rounded-xl border text-left font-semibold transition-all ${
                                        answers[currentQuestion.id] === opt
                                            ? "border-primary bg-primary/10 text-primary"
                                            : isDark 
                                                ? "border-[#333] bg-[#1a1a1a] hover:border-gray-500 text-gray-300"
                                                : "border-gray-200 bg-gray-50 hover:border-gray-300 text-gray-700"
                                    }`}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <textarea
                            autoFocus
                            placeholder="Type your answer here..."
                            value={answers[currentQuestion.id] || ""}
                            onChange={(e) => setAnswers(prev => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                            className={`w-full h-32 p-4 rounded-xl border resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ${
                                isDark ? "bg-[#1a1a1a] border-[#333] text-white" : "bg-gray-50 border-gray-200 text-gray-900"
                            }`}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-[#333] bg-gray-50 dark:bg-[#151515] shrink-0">
                    <button 
                        onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                        disabled={currentIndex === 0}
                        className="px-5 py-2 rounded-xl font-semibold text-sm hover:bg-gray-200 dark:hover:bg-[#333] disabled:opacity-30 transition-colors"
                    >
                        Back
                    </button>
                    
                    <button 
                        onClick={handleNextQuestion}
                        disabled={!answers[currentQuestion.id] && currentQuestion.type === "choice"}
                        className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 transition-colors disabled:opacity-50"
                    >
                        {currentIndex === questions.length - 1 ? "Finish & Generate" : "Next"}
                    </button>
                </div>

            </div>
        </div>
    );
}
