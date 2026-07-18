"use client";

import { useRouter } from "next/navigation";


interface PageHeaderProps {
    title?: React.ReactNode;
    titleNode?: React.ReactNode;
    showBack?: boolean;
    backUrl?: string; // Optional custom string url to push to instead of going back in history
    children?: React.ReactNode;
}

export function PageHeader({ title, titleNode, showBack = false, backUrl, children }: PageHeaderProps) {
    const router = useRouter();

    return (
        <header className="flex items-center justify-between px-8 py-5">
            <div className="flex items-center gap-4 ml-2 mt-1">
                {showBack && (
                    <button
                        onClick={() => backUrl ? router.push(backUrl) : router.back()}
                        className="flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover"
                        title="Go back"
                    >
                        <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                )}
                {(title || titleNode) && (
                    <div className="font-nunito text-[20px] font-bold text-slate-800 dark:text-white">
                        {titleNode || title}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-4">
                {children}
            </div>
        </header>
    );
}
