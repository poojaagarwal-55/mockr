"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { ReportQuestionModal } from "@/components/report-question-modal";
import { AddToSheetModal } from "@/components/add-to-sheet-modal";
import { updateLastQuestionDate } from "@/lib/notifications";

// Helper function to parse and format detailed answer with markdown-like syntax
function FormattedAnswer({ text }: { text: string }) {
    // Remove everything up to and including the first period (full stop)
    let cleanedText = text.trim();
    
    // Find the first period followed by space or newline
    const firstPeriodMatch = cleanedText.match(/^[^.]*\.\s*/);
    if (firstPeriodMatch) {
        cleanedText = cleanedText.substring(firstPeriodMatch[0].length).trim();
    }
    
    // Remove any leading asterisks or special characters
    cleanedText = cleanedText.replace(/^\*+\s*/, '').trim();
    
    // Remove all standalone asterisks
    cleanedText = cleanedText.replace(/^\*+\s*$/gm, '');
    cleanedText = cleanedText.replace(/\s+\*+\s+/g, ' ');
    cleanedText = cleanedText.replace(/^\*+\s+/gm, '');
    
    // Remove standalone hash marks (####) that appear on their own line
    cleanedText = cleanedText.replace(/^#{1,6}\s*$/gm, '');
    
    // Universal pattern: detect any space followed by number and dot (like " 1. ", " 2. ", etc.)
    cleanedText = cleanedText.replace(/\s+(\d+)\.\s+/g, '\n\n$1. ');
    
    // Remove multiple consecutive newlines
    cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');
    
    // Split by double newlines to create paragraphs
    const paragraphs = cleanedText.split('\n\n').filter(p => {
        const trimmed = p.trim();
        // Filter out empty, asterisks, or standalone hashes
        return trimmed && trimmed !== '*' && trimmed !== '**' && !/^\*+$/.test(trimmed) && !/^#{1,6}$/.test(trimmed);
    });
    
    const formatText = (content: string) => {
        // First, replace LaTeX symbols with dollar signs and braces: $\symbol$ or ${\symbol}$
        content = content.replace(/\$\{?\\sigma\}?\$/gi, 'σ');
        content = content.replace(/\$\{?\\Sigma\}?\$/g, 'Σ');
        content = content.replace(/\$\{?\\pi\}?\$/gi, 'π');
        content = content.replace(/\$\{?\\Pi\}?\$/g, 'Π');
        content = content.replace(/\$\{?\\cup\}?\$/gi, '∪');
        content = content.replace(/\$\{?\\cap\}?\$/gi, '∩');
        content = content.replace(/\$\{?\\bowtie\}?\$/gi, '⋈');
        content = content.replace(/\$\{?\\times\}?\$/gi, '×');
        content = content.replace(/\$\{?\\div\}?\$/gi, '÷');
        content = content.replace(/\$\{?\\subset\}?\$/gi, '⊂');
        content = content.replace(/\$\{?\\supset\}?\$/gi, '⊃');
        content = content.replace(/\$\{?\\in\}?\$/gi, '∈');
        content = content.replace(/\$\{?\\notin\}?\$/gi, '∉');
        content = content.replace(/\$\{?\\forall\}?\$/gi, '∀');
        content = content.replace(/\$\{?\\exists\}?\$/gi, '∃');
        content = content.replace(/\$\{?\\emptyset\}?\$/gi, '∅');
        content = content.replace(/\$\{?\\infty\}?\$/gi, '∞');
        content = content.replace(/\$\{?\\leq\}?\$/gi, '≤');
        content = content.replace(/\$\{?\\geq\}?\$/gi, '≥');
        content = content.replace(/\$\{?\\neq\}?\$/gi, '≠');
        content = content.replace(/\$\{?\\approx\}?\$/gi, '≈');
        content = content.replace(/\$\{?\\equiv\}?\$/gi, '≡');
        content = content.replace(/\$\{?\\rightarrow\}?\$/gi, '→');
        content = content.replace(/\$\{?\\leftarrow\}?\$/gi, '←');
        content = content.replace(/\$\{?\\leftrightarrow\}?\$/gi, '↔');
        
        // Then replace without dollar signs (fallback)
        content = content.replace(/\\sigma/gi, 'σ');
        content = content.replace(/\\Sigma/g, 'Σ');
        content = content.replace(/\\pi/gi, 'π');
        content = content.replace(/\\Pi/g, 'Π');
        content = content.replace(/\\cup/gi, '∪');
        content = content.replace(/\\cap/gi, '∩');
        content = content.replace(/\\bowtie/gi, '⋈');
        content = content.replace(/\\times/gi, '×');
        content = content.replace(/\\div/gi, '÷');
        content = content.replace(/\\subset/gi, '⊂');
        content = content.replace(/\\supset/gi, '⊃');
        content = content.replace(/\\in/gi, '∈');
        content = content.replace(/\\notin/gi, '∉');
        content = content.replace(/\\forall/gi, '∀');
        content = content.replace(/\\exists/gi, '∃');
        content = content.replace(/\\emptyset/gi, '∅');
        content = content.replace(/\\infty/gi, '∞');
        content = content.replace(/\\leq/gi, '≤');
        content = content.replace(/\\geq/gi, '≥');
        content = content.replace(/\\neq/gi, '≠');
        content = content.replace(/\\approx/gi, '≈');
        content = content.replace(/\\equiv/gi, '≡');
        content = content.replace(/\\rightarrow/gi, '→');
        content = content.replace(/\\leftarrow/gi, '←');
        content = content.replace(/\\leftrightarrow/gi, '↔');
        
        // Replace **text** with bold
        content = content.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>');
        // Replace *text* with italic
        content = content.replace(/\*(.+?)\*/g, '<em class="italic text-blue-700 dark:text-blue-400">$1</em>');
        // Replace `code` with inline code
        content = content.replace(/`(.+?)`/g, '<code class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-sm font-mono text-blue-600 dark:text-blue-400">$1</code>');
        
        return content;
    };

    return (
        <div className="space-y-6">
            {paragraphs.map((para, idx) => {
                // Check if it's a heading (starts with #)
                if (para.startsWith('#### ')) {
                    return (
                        <p 
                            key={idx} 
                            className="text-slate-900 dark:text-white font-bold text-lg leading-relaxed"
                        >
                            {para.replace('#### ', '')}
                        </p>
                    );
                } else if (para.startsWith('### ')) {
                    return (
                        <h4 key={idx} className="text-lg font-bold text-slate-900 dark:text-white mt-6 mb-3">
                            {para.replace('### ', '')}
                        </h4>
                    );
                } else if (para.startsWith('## ')) {
                    return (
                        <h3 key={idx} className="text-xl font-bold text-slate-900 dark:text-white mt-8 mb-4">
                            {para.replace('## ', '')}
                        </h3>
                    );
                }
                // Check if it's a bullet list
                else if (para.includes('\n- ') || para.startsWith('- ')) {
                    const items = para.split('\n').filter(line => line.trim().startsWith('- '));
                    return (
                        <ul key={idx} className="space-y-3 ml-4">
                            {items.map((item, i) => (
                                <li key={i} className="flex items-start gap-3 text-slate-700 dark:text-slate-300 leading-relaxed">
                                    <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2"></span>
                                    <span dangerouslySetInnerHTML={{ __html: formatText(item.replace(/^- /, '')) }} />
                                </li>
                            ))}
                        </ul>
                    );
                }
                // Check if it's a single numbered item (starts with number.)
                else if (/^\d+\.\s/.test(para)) {
                    const match = para.match(/^(\d+)\.\s([\s\S]+)$/);
                    if (match) {
                        const [, num, content] = match;
                        return (
                            <div key={idx} className="flex items-start gap-3 ml-4">
                                <span className="flex-shrink-0 w-7 h-7 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full flex items-center justify-center text-sm font-semibold">
                                    {num}
                                </span>
                                <p 
                                    className="text-slate-700 dark:text-slate-300 leading-relaxed text-lg flex-1"
                                    dangerouslySetInnerHTML={{ __html: formatText(content) }}
                                />
                            </div>
                        );
                    }
                }
                // Regular paragraph
                return (
                    <p 
                        key={idx} 
                        className="text-slate-700 dark:text-slate-300 leading-relaxed text-lg"
                        dangerouslySetInnerHTML={{ __html: formatText(para) }}
                    />
                );
            })}
        </div>
    );
}

function CSFundamentalsSolveContent() {
    const searchParams = useSearchParams();
    const questionId = searchParams.get("id");
    const sheetId = searchParams.get("sheetId");

    const [question, setQuestion] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showAddToSheet, setShowAddToSheet] = useState(false);
    const [isSolved, setIsSolved] = useState(false);
    const [isMarkingDone, setIsMarkingDone] = useState(false);
    
    // State for navigation from sheet
    const [nextQuestionUrl, setNextQuestionUrl] = useState<string | null>(null);

    useEffect(() => {
        const fetchQuestion = async () => {
            try {
                const supabase = createSupabaseBrowserClient();
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData.session?.access_token;

                const res = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/cs-fundamentals/question/${questionId}`,
                    {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                    }
                );

                const data = await res.json();
                setQuestion(data);
                
                // Check if question is already solved
                if (token) {
                    try {
                        const progressRes = await fetch(
                            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/users/me/progress?questionId=cs-${questionId}`,
                            {
                                headers: { Authorization: `Bearer ${token}` },
                            }
                        );
                        if (progressRes.ok) {
                            const progressData = await progressRes.json();
                            setIsSolved(progressData?.status === "solved");
                        }
                    } catch (err) {
                        console.error("Failed to fetch progress:", err);
                    }
                }
                
                // If we came from a sheet, fetch the sheet to find the next question
                if (sheetId && token && questionId) {
                    try {
                        const sheetRes = await fetch(
                            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/users/me/sheets/${encodeURIComponent(sheetId)}`,
                            {
                                headers: { Authorization: `Bearer ${token}` },
                            }
                        );
                        if (sheetRes.ok) {
                            const sheetData = await sheetRes.json();
                            // Find the current question in the sheet
                            const currentIndex = sheetData.questions.findIndex((q: any) => q.id.endsWith(questionId));
                            if (currentIndex !== -1 && currentIndex < sheetData.questions.length - 1) {
                                const nextQ = sheetData.questions[currentIndex + 1];
                                
                                // Helper to generate the URL (similar to getSolveUrl in sheet logic)
                                const getSolveUrl = (q: any, sId: string): string | null => {
                                    const match = q.id.match(/^(?:cs|dsa|sql|sd)-(.+)$/);
                                    const mongoId = match ? match[1] : null;
                                    if (!mongoId) return null;

                                    const cat = q.category.toLowerCase();
                                    let baseUrl = "";
                                    if (cat === "os" || cat === "cn" || cat === "dbms" || cat === "oops" || cat === "cs_fundamentals") {
                                        baseUrl = `/questions/cs-fundamentals/solve?id=${mongoId}`;
                                    } else if (q.id.startsWith("sql-") || cat === "sql") {
                                        baseUrl = `/questions/sql/solve?id=${mongoId}`;
                                    } else if (cat === "system_design") {
                                        baseUrl = `/questions/system-design/solve?id=${mongoId}`;
                                    } else if (q.id.startsWith("cs-")) {
                                        baseUrl = `/questions/cs-fundamentals/solve?id=${mongoId}`;
                                    } else if (q.id.startsWith("sd-")) {
                                        baseUrl = `/questions/system-design/solve?id=${mongoId}`;
                                    } else if (q.id.startsWith("dsa-") || cat === "coding" || cat === "dsa") {
                                        baseUrl = `/questions/dsa/solve?id=${mongoId}`;
                                    }
                                    
                                    return baseUrl ? `${baseUrl}&sheetId=${sId}` : null;
                                };
                                
                                setNextQuestionUrl(getSolveUrl(nextQ, sheetId));
                            }
                        }
                    } catch (sheetErr) {
                        console.error("Failed to load sheet context:", sheetErr);
                    }
                }

                setLoading(false);
            } catch (err) {
                console.error("Failed to load question:", err);
                setLoading(false);
            }
        };

        if (questionId) {
            fetchQuestion();
        }
    }, [questionId, sheetId]);

    const handleMarkAsDone = async () => {
        if (!questionId || isMarkingDone) return;
        
        setIsMarkingDone(true);
        try {
            const supabase = createSupabaseBrowserClient();
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            
            if (!token) {
                console.error("No auth token available");
                setIsMarkingDone(false);
                return;
            }

            // Toggle between solved and attempted status
            const newStatus = isSolved ? "attempted" : "solved";

            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/users/me/progress`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        questionId: `cs-${questionId}`,
                        status: newStatus,
                    }),
                }
            );

            if (res.ok) {
                setIsSolved(!isSolved);
                if (!isSolved) {
                    updateLastQuestionDate();
                    
                    // Auto-mark as completed in sheet if coming from a sheet
                    if (sheetId && questionId) {
                        try {
                            // Try custom sheet first, then AI-generated sheet
                            try {
                                await fetch(
                                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/custom-sheets/${encodeURIComponent(sheetId)}/progress`,
                                    {
                                        method: "PATCH",
                                        headers: {
                                            "Content-Type": "application/json",
                                            Authorization: `Bearer ${token}`,
                                        },
                                        body: JSON.stringify({
                                            questionId: `cs-${questionId}`,
                                            status: "completed",
                                        }),
                                    }
                                );
                            } catch (customErr) {
                                // If custom sheet fails, try AI-generated sheet
                                await fetch(
                                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/users/me/sheets/${encodeURIComponent(sheetId)}/progress`,
                                    {
                                        method: "PATCH",
                                        headers: {
                                            "Content-Type": "application/json",
                                            Authorization: `Bearer ${token}`,
                                        },
                                        body: JSON.stringify({
                                            questionId: `cs-${questionId}`,
                                            status: "completed",
                                        }),
                                    }
                                );
                            }
                        } catch (sheetErr) {
                            console.error("Failed to update sheet progress:", sheetErr);
                            // Don't block the user experience if sheet update fails
                        }
                    }
                }
            } else {
                console.error("Failed to update question status");
            }
        } catch (err) {
            console.error("Error updating question status:", err);
        } finally {
            setIsMarkingDone(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                    <div className="text-slate-600 dark:text-slate-400">Loading question...</div>
                </div>
            </div>
        );
    }

    if (!question) {
        return (
            <div className="flex items-center justify-center h-screen bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="text-red-600 dark:text-red-400">Question not found</div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-hidden bg-white dark:bg-[#1a1a1a] flex flex-col">
            <div className="flex items-center">
                <PageHeader 
                    title={question.topicName} 
                    showBack={true} 
                    backUrl={sheetId ? `/sheets/${sheetId}` : "/questions/cs-fundamentals"} 
                />
                {isSolved && (
                    <div className="ml-3 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm border border-emerald-200 dark:border-emerald-800/60">
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        Solved
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-6xl mx-auto px-6 py-8 pb-20">
                    {/* Action Buttons Row */}
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                            {/* Removed topic tag since it's already in the header */}
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Add to Sheet Button */}
                            <button
                                onClick={() => setShowAddToSheet(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition-all text-sm font-medium"
                                title="Add to custom sheet"
                            >
                                <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                                <span>Add to Sheet</span>
                            </button>
                            
                            {/* Mark as Done Button */}
                            <button
                                onClick={handleMarkAsDone}
                                disabled={isMarkingDone}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                                    isSolved
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                        : "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300"
                                }`}
                                title={isSolved ? "Mark as undone" : "Mark as done"}
                            >
                                <span className="material-symbols-outlined text-[18px]">check</span>
                                <span>{isSolved ? "Completed" : "Mark as Done"}</span>
                            </button>
                            
                            {/* Report Button */}
                            <ReportQuestionModal
                                questionId={questionId!}
                                questionType="cs_fundamentals"
                                questionTitle={question.question?.slice(0, 120)}
                            />
                        </div>
                    </div>

                    {/* Question Section */}
                    <div className="mb-8">
                        <div className="flex items-start gap-3 mb-6">
                            <span className="text-3xl font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">Q.</span>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white leading-relaxed">
                                {question.question}
                            </h1>
                        </div>
                    </div>

                    {/* Answer Section - GeeksforGeeks Style */}
                    <div>
                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-1 h-8 bg-green-500 rounded-full"></div>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Answer</h2>
                        </div>

                        {/* Answer Content */}
                        <div className="prose prose-slate dark:prose-invert max-w-none">
                            {question.detailedAnswer ? (
                                <div className="text-slate-700 dark:text-slate-300 text-lg">
                                    <FormattedAnswer text={question.detailedAnswer} />
                                </div>
                            ) : question.answer ? (
                                <div className="space-y-4">
                                    <p className="text-slate-700 dark:text-slate-300 text-lg leading-relaxed whitespace-pre-wrap">
                                        {question.answer}
                                    </p>
                                    <div className="mt-8 p-6 bg-slate-50 dark:bg-slate-900/30 rounded-lg text-center">
                                        <span className="material-symbols-outlined text-4xl text-slate-400 dark:text-slate-600 mb-2">article</span>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">Detailed explanation coming soon...</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-8 bg-slate-50 dark:bg-slate-900/30 rounded-lg text-center">
                                    <span className="material-symbols-outlined text-5xl text-slate-400 dark:text-slate-600 mb-3">info</span>
                                    <p className="text-slate-600 dark:text-slate-400">No answer available for this question yet.</p>
                                </div>
                            )}
                        </div>

                        {/* Next Question Button (if from sheet) */}
                        {sheetId && nextQuestionUrl && (
                            <div className="mt-10 pt-6">
                                <Link 
                                    href={nextQuestionUrl}
                                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-base font-semibold transition-all shadow-md hover:shadow-lg"
                                >
                                    <span>Next Question</span>
                                    <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            {/* Add to Sheet Modal */}
            <AddToSheetModal
                isOpen={showAddToSheet}
                onClose={() => setShowAddToSheet(false)}
                questionId={questionId || ""}
                questionType="cs"
                onSuccess={() => {
                    console.log("Question added to sheet successfully");
                }}
            />
        </div>
    );
}

export default function CSFundamentalsSolvePage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center h-screen">
                <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            </div>
        }>
            <CSFundamentalsSolveContent />
        </Suspense>
    );
}
