"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddToSheetModal } from "./add-to-sheet-modal";

interface QuestionListItemProps {
    id: string;
    frontendId: string;
    title: string;
    difficulty: "Easy" | "Medium" | "Hard";
    acceptanceRate: number;
    topics?: string[];
    isSolved?: boolean;
    // Selection props
    isSelectionMode?: boolean;
    isSelected?: boolean;
    onToggleSelection?: (id: string) => void;
    index?: number;
}

export function QuestionListItem({
    id,
    frontendId,
    title,
    difficulty,
    acceptanceRate,
    topics = [],
    isSolved = false,
    isSelectionMode = false,
    isSelected = false,
    onToggleSelection,
    index = 0,
}: QuestionListItemProps) {
    const router = useRouter();
    const [showAddToSheet, setShowAddToSheet] = useState(false);

    const difficultyColors = {
        Easy: "text-emerald-500 dark:text-emerald-400",
        Medium: "text-amber-500 dark:text-amber-400",
        Hard: "text-red-500 dark:text-red-400",
    };

    const difficultyDisplay = {
        Easy: "Easy",
        Medium: "Med",
        Hard: "Hard",
    };

    const handleClick = () => {
        if (isSelectionMode && onToggleSelection) {
            onToggleSelection(id);
        } else {
            router.push(`/questions/dsa/solve?id=${id}`);
        }
    };

    const handleAddToSheet = (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowAddToSheet(true);
    };

    return (
        <>
            <div
                onClick={handleClick}
                className={`group flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors ${
                    index % 2 === 0 
                        ? "bg-slate-50 dark:bg-[#232323] hover:bg-slate-100 dark:hover:bg-[#2a2a2a]"
                        : "bg-white dark:bg-[#282828] hover:bg-slate-50 dark:hover:bg-[#2a2a2a]"
                }`}
            >
                {/* Selection Checkbox or Solved Checkmark */}
                <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                    {isSelectionMode ? (
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isSelected 
                                ? "bg-blue-600 border-blue-600" 
                                : "border-slate-300 dark:border-slate-600 hover:border-blue-500"
                        }`}>
                            {isSelected && (
                                <span className="material-symbols-outlined text-white text-[14px]">check</span>
                            )}
                        </div>
                    ) : isSolved ? (
                        <span className="material-symbols-outlined text-[#52b788] dark:text-[#74c69d] text-[18px]">
                            check
                        </span>
                    ) : (
                        <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-[18px]">
                            radio_button_unchecked
                        </span>
                    )}
                </div>

                {/* Question Number & Title */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                        <span className={`font-medium text-sm flex-shrink-0 ${
                            isSolved 
                                ? "text-slate-700 dark:text-slate-300" 
                                : "text-slate-500 dark:text-slate-400"
                        }`}>
                            {frontendId}.
                        </span>
                        <h3 className={`font-medium truncate ${
                            isSolved 
                                ? "text-slate-900 dark:text-white" 
                                : "text-slate-900 dark:text-white"
                        }`}>
                            {title}
                        </h3>
                    </div>
                </div>

                {/* Add to Sheet Button */}
              
                
                {/* Difficulty Badge */}
                <div className="flex-shrink-0 min-w-[70px] flex items-center justify-center">
                    <span className={`text-sm font-medium ${difficultyColors[difficulty]}`}>
                        {difficultyDisplay[difficulty]}
                    </span>
                </div>
                <button
                    onClick={handleAddToSheet}
                    className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-all flex items-center justify-center"
                    title="Add to custom sheet"
                >
                    <span className="material-symbols-outlined text-[20px]">
                        playlist_add
                    </span>
                </button>
            </div>

            {/* Add to Sheet Modal */}
            <AddToSheetModal
                isOpen={showAddToSheet}
                onClose={() => setShowAddToSheet(false)}
                questionId={id}
                questionType="dsa"
                onSuccess={() => {
                    // Optional: Show success toast
                    console.log("Question added to sheet successfully");
                }}
            />
        </>
    );
}
