"use client";
import { useEffect } from "react";

import { PageHeader } from "@/components/page-header";

export default function DangerPage() {
    useEffect(() => { document.title = "Danger Zone | Mockr"; }, []);
    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg flex flex-col">
            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Danger Zone</h1>} showBack backUrl="/settings" />

            <main className="flex-1 flex flex-col items-center py-10 px-4">
                <div className="w-full max-w-[800px] space-y-6">
                    <div className="bg-white dark:bg-lc-surface rounded-2xl p-8 border border-red-200 dark:border-red-900/30 shadow-sm">
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Delete Account</h2>
                        <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm max-w-lg">
                            Once you delete your account, there is no going back. Please be certain. All your interview records, feedback reports, and resumes will be permanently deleted.
                        </p>

                        <button className="px-5 py-2.5 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-500 border border-red-200 dark:border-red-500/20 rounded-lg font-bold text-sm hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
                            Permanently Delete Account
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}
