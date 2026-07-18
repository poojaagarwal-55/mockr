"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { LatexEditorLayout } from "@/components/latex-editor/latex-editor-layout";

interface LatexResumeData {
    id: string;
    title: string;
    latexSource: string;
    template: string;
    compiledUrl: string | null;
    compiledAt: string | null;
}

export default function LatexEditorPage() {
    useEffect(() => { document.title = "Resume Editor | Mockr"; }, []);
    const params = useParams();
    const router = useRouter();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const resumeId = params.id as string;

    const [resume, setResume] = useState<LatexResumeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchResume = async () => {
            const supabase = createSupabaseBrowserClient();
            const { data } = await supabase.auth.getSession();
            if (!data.session) {
                router.push("/login");
                return;
            }

            try {
                const result = await api.get<LatexResumeData>(
                    `/latex-resumes/${resumeId}`,
                    data.session.access_token
                );
                setResume(result);
            } catch {
                setError("Resume not found");
            } finally {
                setLoading(false);
            }
        };

        fetchResume();
    }, [resumeId, router]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <span className="material-symbols-rounded text-4xl animate-spin text-[#4A7CFF] block mb-3">
                        progress_activity
                    </span>
                    <p className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        Loading editor...
                    </p>
                </div>
            </div>
        );
    }

    if (error || !resume) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <span className="material-symbols-rounded text-4xl text-red-500 block mb-3">
                        error
                    </span>
                    <p className={`text-sm mb-4 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                        {error || "Resume not found"}
                    </p>
                    <button
                        onClick={() => router.push("/resumes")}
                        className="px-4 py-2 rounded-lg text-sm bg-[#4A7CFF] text-white hover:bg-[#3a6cef] transition-colors"
                    >
                        Back to Resumes
                    </button>
                </div>
            </div>
        );
    }

    return (
        <LatexEditorLayout
            resumeId={resume.id}
            initialTitle={resume.title}
            initialSource={resume.latexSource}
            initialCompiledUrl={resume.compiledUrl}
        />
    );
}
