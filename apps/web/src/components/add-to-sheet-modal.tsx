"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { createSupabaseBrowserClient } from "@/lib/supabase";

interface CustomSheet {
    id: string;
    name: string;
    description?: string;
    questionCount: number;
    questionIds?: any[];
    createdAt: string;
}

interface AddToSheetModalProps {
    isOpen: boolean;
    onClose: () => void;
    questionId: string | string[];
    questionType?: 'cs' | 'dsa' | 'sql' | 'sd'; // Add question type
    onSuccess?: () => void;
}

export function AddToSheetModal({ isOpen, onClose, questionId, questionType, onSuccess }: AddToSheetModalProps) {
    const { session: authSession } = useAuth();
    const [resolvedToken, setResolvedToken] = useState<string | null>(null);
    const [sheets, setSheets] = useState<CustomSheet[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newSheetName, setNewSheetName] = useState("");
    const [creating, setCreating] = useState(false);
    const [adding, setAdding] = useState(false);
    const [isDuplicate, setIsDuplicate] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Resolve the auth token: prefer the AuthContext session, fall back to
    // Supabase directly (needed in contest-solve which may sit outside AuthProvider).
    useEffect(() => {
        const resolve = async () => {
            if (authSession?.access_token) {
                setResolvedToken(authSession.access_token);
                return;
            }
            try {
                const supabase = createSupabaseBrowserClient();
                const { data } = await supabase.auth.getSession();
                setResolvedToken(data.session?.access_token ?? null);
            } catch {
                setResolvedToken(null);
            }
        };
        resolve();
    }, [authSession]);

    useEffect(() => {
        if (isOpen) {
            fetchSheets();
            setIsDuplicate(false); // Reset duplicate state when modal opens
        }
    }, [isOpen, resolvedToken]);

    const fetchSheets = async () => {
        if (!resolvedToken) return;
        
        setLoading(true);
        setError(null);
        try {
            const response = await api.get<{ success: boolean; data: CustomSheet[] }>(
                "/custom-sheets",
                resolvedToken
            );
            setSheets(response.data);
        } catch (err: any) {
            console.error("Failed to fetch sheets:", err);
            setError("Failed to load sheets");
        } finally {
            setLoading(false);
        }
    };

    const handleCreateSheet = async () => {
        if (!newSheetName.trim() || !resolvedToken) return;

        setCreating(true);
        setError(null);
        try {
            const response = await api.post<{ success: boolean; data: CustomSheet }>(
                "/custom-sheets",
                { name: newSheetName.trim() },
                resolvedToken
            );
            
            // Add the new sheet to the list
            setSheets([response.data, ...sheets]);
            handleSheetSelection(response.data.id);
            setNewSheetName("");
            setShowCreateModal(false);
        } catch (err: any) {
            console.error("Failed to create sheet:", err);
            setError(err.message || "Failed to create sheet");
        } finally {
            setCreating(false);
        }
    };

    const handleSheetSelection = (sheetId: string) => {
        setSelectedSheetId(sheetId);
        setIsDuplicate(false); // Reset duplicate state when selecting a different sheet
        setError(null); // Also reset any errors
    };

    const handleAddToSheet = async () => {
        if (!selectedSheetId || !resolvedToken) return;

        setAdding(true);
        setError(null);
        setIsDuplicate(false);
        try {
            // Handle both single and multiple question IDs
            const questionIds = Array.isArray(questionId) 
                ? questionId 
                : (typeof questionId === 'string' && questionId.includes(',') 
                    ? questionId.split(',').map(id => id.trim()) 
                    : questionId);
            
            // Send both questionId and questionType to the API
            const payload: any = { questionId: questionIds };
            if (questionType) {
                payload.questionType = questionType;
            }
            
            // Use fetch directly to handle the duplicate case more gracefully
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/custom-sheets/${selectedSheetId}/questions`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${resolvedToken}`,
                    },
                    body: JSON.stringify(payload),
                }
            );

            if (response.ok) {
                // Success case
                onSuccess?.();
                onClose();
            } else if (response.status === 400) {
                // Handle duplicate case specifically
                const errorData = await response.json().catch(() => ({}));
                if (errorData.message?.includes("already exists") || errorData.message?.includes("Duplicate") || errorData.error === "Duplicate") {
                    setIsDuplicate(true);
                    setError(null);
                } else {
                    setError(errorData.message || "Failed to add question to sheet");
                }
            } else {
                // Other errors
                const errorData = await response.json().catch(() => ({}));
                setError(errorData.message || "Failed to add question to sheet");
            }
        } catch (err: any) {
            console.error("Network error:", err);
            setError("Network error. Please check your connection and try again.");
        } finally {
            setAdding(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Main Modal */}
            <div className="fixed inset-0 z-[30] flex items-center justify-center p-4 bg-neutral-950/50 dark:bg-black/50 backdrop-blur-sm" onClick={onClose}>
                <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-5">
                        <h3 className="text-[24px] font-bold text-slate-900 dark:text-white">
                            Add to Sheet
                        </h3>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                        {error && (
                            <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                                {error}
                            </div>
                        )}

                        {isDuplicate && (
                            <div className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm text-blue-700 dark:text-blue-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[16px]">info</span>
                                This question is already in the selected sheet. You can add it to other sheets if needed.
                            </div>
                        )}

                        {loading ? (
                            <div className="flex items-center justify-center py-12">
                                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 dark:border-slate-700 border-t-blue-600" />
                            </div>
                        ) : (
                            <>
                                {/* Shared container ensures equal width for all items even with scrollbar */}
                                <div className="overflow-hidden">
                                    {/* Create New Sheet Button */}
                                    <button
                                        onClick={() => setShowCreateModal(true)}
                                        className="w-full mb-4 flex items-center justify-start gap-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 px-4 py-4 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all border-none text-left"
                                    >
                                        <svg className="h-5 w-5 text-slate-900 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                        </svg>
                                        <h4 className="font-semibold text-slate-900 dark:text-white">Create New Sheet</h4>
                                    </button>

                                    {/* Sheets List - Scrollable with fixed height for ~2 items */}
                                    <div className="space-y-2 max-h-[160px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                    {sheets.length === 0 ? (
                                        <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
                                            No sheets yet. Create one to get started!
                                        </div>
                                    ) : (
                                        sheets.map((sheet) => {
                                            const isAlreadyAdded = (() => {
                                                if (!sheet.questionIds) return false;
                                                const qIds = Array.isArray(questionId) ? questionId : (typeof questionId === 'string' && questionId.includes(',') ? questionId.split(',').map(id => id.trim()) : [questionId]);
                                                return qIds.some((qId) => 
                                                    sheet.questionIds?.some((sq: any) => 
                                                        (typeof sq === 'string' && sq === qId) || 
                                                        (typeof sq === 'object' && sq.id === qId)
                                                    )
                                                );
                                            })();

                                            return (
                                                <button
                                                    key={sheet.id}
                                                    disabled={isAlreadyAdded}
                                                    onClick={() => handleSheetSelection(sheet.id)}
                                                    className={`w-full text-left rounded-xl px-4 py-4 transition-all border-none ${
                                                        isAlreadyAdded
                                                            ? "bg-slate-50 dark:bg-slate-800/40 opacity-50 cursor-not-allowed"
                                                            : selectedSheetId === sheet.id
                                                                ? "bg-blue-100 dark:bg-blue-900/40 transform scale-[0.99] shadow-inner"
                                                                : "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30"
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <h4 className="font-semibold text-slate-900 dark:text-white">
                                                                    {sheet.name}
                                                                </h4>
                                                                {isAlreadyAdded && (
                                                                    <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full">
                                                                        Added
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {sheet.description && (
                                                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                                                    {sheet.description}
                                                                </p>
                                                            )}
                                                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                                                {sheet.questionCount} question{sheet.questionCount !== 1 ? "s" : ""}
                                                            </p>
                                                        </div>
                                                        {selectedSheetId === sheet.id && !isAlreadyAdded && (
                                                            <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                            </svg>
                                                        )}
                                                    </div>
                                                </button>
                                            );
                                        })
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 px-6 py-5">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm rounded-full font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-white transition"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAddToSheet}
                            disabled={!selectedSheetId || adding}
                            className="px-6 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                        >
                            {adding && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                            Add to Sheet
                        </button>
                    </div>
                </div>
            </div>

            {/* Create Sheet Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[35] flex items-center justify-center p-4 bg-neutral-950/50 dark:bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
                    <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-3xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-6 py-5">
                            <h3 className="text-[24px] font-bold text-slate-900 dark:text-white">
                                Create New Sheet
                            </h3>
                        </div>

                        <div className="p-6">
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Sheet Name
                            </label>
                            <input
                                type="text"
                                value={newSheetName}
                                onChange={(e) => setNewSheetName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && newSheetName.trim()) {
                                        handleCreateSheet();
                                    }
                                }}
                                placeholder="e.g., Array Problems"
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2 text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition"
                                autoFocus
                            />
                        </div>

                        <div className="flex items-center justify-end gap-3 px-6 py-5">
                            <button
                                onClick={() => {
                                    setShowCreateModal(false);
                                    setNewSheetName("");
                                    setError(null);
                                }}
                                className="px-4 py-2 text-sm rounded-full font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-white transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateSheet}
                                disabled={!newSheetName.trim() || creating}
                                className="px-6 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                            >
                                {creating && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
