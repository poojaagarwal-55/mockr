"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";

interface Question {
    id: string;
    title?: string;
    question?: string;
    difficulty?: string;
    topic?: string;
    topicName?: string;
    preview?: string;
    slug?: string;
}

interface CustomSheetCreationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (sheetId: string) => void;
}

type QuestionType = 'dsa' | 'cs' | 'sql' | 'sd';

const TAB_CONFIG = {
    dsa: { label: 'DSA', endpoint: '/ide/questions', type: 'dsa' as QuestionType },
    cs: { label: 'CS Fundamentals', endpoint: '/cs-fundamentals/questions', type: 'cs' as QuestionType },
    sql: { label: 'SQL', endpoint: '/ide/sql/questions', type: 'sql' as QuestionType },
    sd: { label: 'System Design', endpoint: '/system-design/questions', type: 'sd' as QuestionType }
};

export function CustomSheetCreationModal({ isOpen, onClose, onSuccess }: CustomSheetCreationModalProps) {
    const { session } = useAuth();
    const [step, setStep] = useState<'name' | 'questions'>('name');
    const [sheetName, setSheetName] = useState("");
    const [activeTab, setActiveTab] = useState<QuestionType>('dsa');
    const [questions, setQuestions] = useState<Record<QuestionType, Question[]>>({
        dsa: [],
        cs: [],
        sql: [],
        sd: []
    });
    const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadedTabs, setLoadedTabs] = useState<Set<QuestionType>>(new Set());
    const [hasMore, setHasMore] = useState<Record<QuestionType, boolean>>({
        dsa: true,
        cs: true,
        sql: true,
        sd: true
    });
    const [currentPage, setCurrentPage] = useState<Record<QuestionType, number>>({
        dsa: 1,
        cs: 1,
        sql: 1,
        sd: 1
    });

    // Reset state when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setStep('name');
            setSheetName("");
            setActiveTab('dsa');
            setSelectedQuestions(new Set());
            setError(null);
            setLoadedTabs(new Set());
            setQuestions({ dsa: [], cs: [], sql: [], sd: [] });
            setCurrentPage({ dsa: 1, cs: 1, sql: 1, sd: 1 });
            setHasMore({ dsa: true, cs: true, sql: true, sd: true });
        }
    }, [isOpen]);

    // Load questions for active tab
    useEffect(() => {
        if (step === 'questions' && !loadedTabs.has(activeTab)) {
            fetchQuestions(activeTab);
        }
    }, [step, activeTab, loadedTabs]);

    const fetchQuestions = async (type: QuestionType, page: number = 1) => {
        if (!session?.access_token) return;

        const isLoadingMore = page > 1;
        if (isLoadingMore) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }

        try {
            const config = TAB_CONFIG[type];
            const limit = 50;
            
            let formattedQuestions: Question[] = [];
            let totalCount = 0;
            
            if (type === 'dsa') {
                // DSA uses /ide/questions and returns { success: boolean, data: { questions: [...], pagination: {...} } }
                const response = await api.get<any>(`${config.endpoint}?limit=${limit}&page=${page}`, session.access_token);
                if (response.success && response.data?.questions) {
                    formattedQuestions = response.data.questions.map((q: any) => ({
                        id: q.id,
                        title: q.title,
                        difficulty: q.difficulty,
                        preview: q.title
                    }));
                    totalCount = response.data.pagination?.total || formattedQuestions.length;
                }
            } else if (type === 'cs') {
                // CS Fundamentals uses fetch directly and returns { success: boolean, data: { questions: [...], pagination: {...} } }
                const res = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}${config.endpoint}?limit=${limit}&page=${page}`,
                    { headers: { Authorization: `Bearer ${session.access_token}` } }
                );
                const response = await res.json();
                if (response.success && response.data?.questions) {
                    formattedQuestions = response.data.questions.map((q: any) => ({
                        id: q.id,
                        title: q.question,
                        topic: q.topic,
                        topicName: q.topicName,
                        preview: q.preview || q.question
                    }));
                    totalCount = response.data.pagination?.total || formattedQuestions.length;
                }
            } else if (type === 'sql') {
                // SQL uses fetch directly and returns { success: boolean, data: { questions: [...], pagination: {...} } }
                const res = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}${config.endpoint}?limit=${limit}&page=${page}`,
                    { headers: { Authorization: `Bearer ${session.access_token}` } }
                );
                const response = await res.json();
                if (response.success && response.data?.questions) {
                    formattedQuestions = response.data.questions.map((q: any) => ({
                        id: q.id,
                        title: q.title,
                        difficulty: q.difficulty,
                        preview: q.description || q.title
                    }));
                    totalCount = response.data.pagination?.total || formattedQuestions.length;
                }
            } else if (type === 'sd') {
                // System Design uses fetch directly and returns { success: boolean, data: { questions: [...], pagination: {...} } }
                const res = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}${config.endpoint}?limit=${limit}&page=${page}`,
                    { headers: { Authorization: `Bearer ${session.access_token}` } }
                );
                const response = await res.json();
                if (response.success && response.data?.questions) {
                    formattedQuestions = response.data.questions.map((q: any) => ({
                        id: q.id,
                        title: q.title,
                        difficulty: q.difficulty,
                        preview: q.preview || q.title
                    }));
                    totalCount = response.data.pagination?.total || formattedQuestions.length;
                }
            }

            setQuestions(prev => ({
                ...prev,
                [type]: isLoadingMore ? [...prev[type], ...formattedQuestions] : formattedQuestions
            }));
            
            setCurrentPage(prev => ({
                ...prev,
                [type]: page
            }));
            
            // Check if there are more questions to load
            const currentTotal = isLoadingMore ? questions[type].length + formattedQuestions.length : formattedQuestions.length;
            setHasMore(prev => ({
                ...prev,
                [type]: currentTotal < totalCount && formattedQuestions.length === limit
            }));
            
            if (!isLoadingMore) {
                setLoadedTabs(prev => new Set([...prev, type]));
            }
        } catch (err: any) {
            console.error(`Failed to fetch ${type} questions:`, err);
            setError(`Failed to load ${TAB_CONFIG[type].label} questions`);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const loadMoreQuestions = () => {
        const nextPage = currentPage[activeTab] + 1;
        fetchQuestions(activeTab, nextPage);
    };

    const handleNameSubmit = () => {
        if (!sheetName.trim()) return;
        setStep('questions');
        // Load DSA questions by default
        if (!loadedTabs.has('dsa')) {
            fetchQuestions('dsa');
        }
    };

    const toggleQuestion = (questionId: string) => {
        const newSelected = new Set(selectedQuestions);
        if (newSelected.has(questionId)) {
            newSelected.delete(questionId);
        } else {
            newSelected.add(questionId);
        }
        setSelectedQuestions(newSelected);
    };

    const handleCreateSheet = async () => {
        console.log("handleCreateSheet called");
        console.log("Session:", !!session?.access_token);
        console.log("Sheet name:", sheetName.trim());
        console.log("Selected questions:", selectedQuestions.size);
        
        if (!session?.access_token) {
            setError("No authentication token found");
            return;
        }
        
        if (!sheetName.trim()) {
            setError("Sheet name is required");
            return;
        }
        
        if (selectedQuestions.size === 0) {
            setError("Please select at least one question");
            return;
        }

        setCreating(true);
        setError(null);

        try {
            console.log("Creating sheet with name:", sheetName.trim());
            
            // Create the sheet first
            const createResponse = await api.post<{ success: boolean; data: { id: string } }>(
                "/custom-sheets",
                { name: sheetName.trim() },
                session.access_token
            );

            console.log("Sheet creation response:", createResponse);

            if (!createResponse.success || !createResponse.data?.id) {
                throw new Error("Failed to create sheet - invalid response");
            }

            const sheetId = createResponse.data.id;
            console.log("Created sheet with ID:", sheetId);

            // Add selected questions to the sheet
            const questionsByType: Record<QuestionType, string[]> = {
                dsa: [],
                cs: [],
                sql: [],
                sd: []
            };

            // Group selected questions by type
            console.log("Grouping questions by type...");
            for (const questionId of selectedQuestions) {
                let found = false;
                for (const [type, questionList] of Object.entries(questions)) {
                    if (questionList.some(q => q.id === questionId)) {
                        questionsByType[type as QuestionType].push(questionId);
                        console.log(`Added question ${questionId} to type ${type}`);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.warn(`Question ${questionId} not found in any type`);
                }
            }

            console.log("Questions by type:", questionsByType);

            // Add questions by type
            for (const [type, questionIds] of Object.entries(questionsByType)) {
                if (questionIds.length > 0) {
                    console.log(`Adding ${questionIds.length} questions of type ${type}`);
                    const addResponse = await api.post(
                        `/custom-sheets/${sheetId}/questions`,
                        { 
                            questionId: questionIds,
                            questionType: type
                        },
                        session.access_token
                    );
                    console.log(`Add questions response for ${type}:`, addResponse);
                }
            }

            console.log("Sheet created successfully, calling onSuccess");
            onSuccess?.(sheetId);
            onClose();
        } catch (err: any) {
            console.error("Failed to create sheet:", err);
            setError(err.message || "Failed to create sheet");
        } finally {
            setCreating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
            <div 
                className="w-full max-w-4xl max-h-[90vh] rounded-3xl border border-slate-200/80 bg-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[#161616] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-700">
                    <div>
                        <h3 className="text-[24px] font-bold text-slate-900 dark:text-white">
                            {step === 'name' ? 'Create Custom Sheet' : `Add Questions to "${sheetName}"`}
                        </h3>
                        {step === 'questions' && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                Select questions to add to your custom sheet
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-all"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden">
                    {step === 'name' ? (
                        <div className="p-6">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Sheet Name
                            </label>
                            <input
                                type="text"
                                value={sheetName}
                                onChange={(e) => setSheetName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && sheetName.trim()) {
                                        handleNameSubmit();
                                    }
                                }}
                                placeholder="e.g., Array Problems, System Design Practice"
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition"
                                autoFocus
                            />
                            {error && (
                                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col h-full max-h-[600px]">
                            {/* Tabs */}
                            <div className="flex border-b border-slate-200 dark:border-slate-700 px-6 flex-shrink-0">
                                {Object.entries(TAB_CONFIG).map(([key, config]) => (
                                    <button
                                        key={key}
                                        onClick={() => setActiveTab(key as QuestionType)}
                                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                                            activeTab === key
                                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                                        }`}
                                    >
                                        {config.label}
                                    </button>
                                ))}
                            </div>

                            {/* Questions List */}
                            <div className="flex-1 overflow-hidden">
                                {loading ? (
                                    <div className="flex items-center justify-center py-12">
                                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 dark:border-slate-700 border-t-blue-600" />
                                    </div>
                                ) : (
                                    <div className="h-full p-6">
                                        <div 
                                            className="h-80 overflow-y-auto custom-scrollbar"
                                        >
                                            <style dangerouslySetInnerHTML={{
                                                __html: `
                                                    .custom-scrollbar::-webkit-scrollbar {
                                                        width: 6px;
                                                    }
                                                    .custom-scrollbar::-webkit-scrollbar-track {
                                                        background: transparent;
                                                    }
                                                    .custom-scrollbar::-webkit-scrollbar-thumb {
                                                        background-color: #cbd5e1;
                                                        border-radius: 3px;
                                                    }
                                                    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                                                        background-color: #94a3b8;
                                                    }
                                                    .dark .custom-scrollbar::-webkit-scrollbar-thumb {
                                                        background-color: #64748b;
                                                    }
                                                    .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                                                        background-color: #475569;
                                                    }
                                                `
                                            }} />
                                            <div className="space-y-3 pr-2">
                                                {questions[activeTab].map((question) => {
                                                    const isSelected = selectedQuestions.has(question.id);
                                                    return (
                                                        <div
                                                            key={question.id}
                                                            onClick={() => toggleQuestion(question.id)}
                                                            className={`p-4 rounded-lg border cursor-pointer transition-all ${
                                                                isSelected
                                                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                                            }`}
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 flex-shrink-0 ${
                                                                    isSelected
                                                                        ? 'border-blue-500 bg-blue-500'
                                                                        : 'border-slate-300 dark:border-slate-600'
                                                                }`}>
                                                                    {isSelected && (
                                                                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                        </svg>
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <h4 className="font-medium text-slate-900 dark:text-white truncate">
                                                                        {question.title}
                                                                    </h4>
                                                                    {question.preview && question.preview !== question.title && (
                                                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                                            {question.preview}
                                                                        </p>
                                                                    )}
                                                                    <div className="flex items-center gap-2 mt-2">
                                                                        {question.difficulty && (
                                                                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                                                                question.difficulty.toLowerCase() === 'easy'
                                                                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                                                                                    : question.difficulty.toLowerCase() === 'medium'
                                                                                    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400'
                                                                                    : 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                                                                            }`}>
                                                                                {question.difficulty}
                                                                            </span>
                                                                        )}
                                                                        {question.topicName && (
                                                                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                                                {question.topicName}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {questions[activeTab].length === 0 && !loading && (
                                                    <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                                                        No questions available
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {/* Load More Button */}
                                        {hasMore[activeTab] && questions[activeTab].length > 0 && (
                                            <div className="mt-4 text-center">
                                                <button
                                                    onClick={loadMoreQuestions}
                                                    disabled={loadingMore}
                                                    className="px-6 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 mx-auto"
                                                >
                                                    {loadingMore ? (
                                                        <>
                                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 dark:border-slate-600 border-t-blue-600" />
                                                            Loading...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="material-symbols-outlined text-[18px]">expand_more</span>
                                                            Load More Questions
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Error Display */}
                {error && (
                    <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                            {error}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-4">
                        {step === 'questions' && (
                            <>
                                <button
                                    onClick={() => setStep('name')}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
                                >
                                    ← Back
                                </button>
                                <span className="text-sm text-slate-500 dark:text-slate-400">
                                    {selectedQuestions.size} question{selectedQuestions.size !== 1 ? 's' : ''} selected
                                </span>
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
                        >
                            Cancel
                        </button>
                        {step === 'name' ? (
                            <button
                                onClick={handleNameSubmit}
                                disabled={!sheetName.trim()}
                                className="px-6 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            >
                                Next
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    console.log("Create Sheet button clicked");
                                    handleCreateSheet();
                                }}
                                disabled={selectedQuestions.size === 0 || creating}
                                className="px-6 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                            >
                                {creating && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                                Create Sheet
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}