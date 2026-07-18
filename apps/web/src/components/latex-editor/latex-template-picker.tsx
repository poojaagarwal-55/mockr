"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";

type Template = { slug: string; name: string; description: string; };

interface LatexTemplatePickerProps {
    actionLabel: string;
    onAction: (title: string, templateSlug: string) => void;
}

export function LatexTemplatePicker({ actionLabel, onAction }: LatexTemplatePickerProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    const [templates, setTemplates] = useState<Template[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(true);
    const [template, setTemplate] = useState("classic");

    useEffect(() => {
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
    }, []);

    if (loadingTemplates) {
        return (
            <div className="flex justify-center py-20">
                <div className="size-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 max-w-4xl mx-auto w-full py-4 flex-1">
                {templates.map((tmpl) => (
                    <button
                        key={tmpl.slug}
                        onClick={() => setTemplate(tmpl.slug)}
                        className={`group relative text-left rounded-xl border overflow-hidden transition-all flex flex-col ${
                            template === tmpl.slug 
                                ? (isDark ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-primary bg-blue-50 ring-2 ring-primary/30")
                                : (isDark ? "bg-[#1e1e1e] border-[#3e3e3e] hover:border-primary/50" : "bg-white border-gray-200 hover:border-primary/50")
                        }`}
                    >
                        <div className={`relative w-full aspect-[21/29.7] overflow-hidden ${isDark ? "bg-[#111]" : "bg-white"} border-b ${isDark ? "border-[#3e3e3e]" : "border-gray-200"}`}>
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
                        
                        <div className="p-3 flex-1 flex flex-col">
                            <h3 className={`text-[13px] font-semibold mb-0.5 ${isDark ? "text-gray-200" : "text-gray-800"}`}>
                                {tmpl.name}
                            </h3>
                            <p className={`text-[10px] leading-snug ${isDark ? "text-gray-500" : "text-gray-500"}`}>
                                {tmpl.description}
                            </p>
                        </div>
                    </button>
                ))}
            </div>

            <div className="flex justify-end pt-6 mt-4 border-t border-slate-100 dark:border-[#333]">
                <button 
                    onClick={() => onAction("My Improved Resume", template)}
                    className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 transition-colors"
                >
                    {actionLabel}
                </button>
            </div>
        </div>
    );
}
