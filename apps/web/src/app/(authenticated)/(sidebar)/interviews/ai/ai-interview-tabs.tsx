import Link from "next/link";

export function AIInterviewTabs({ active }: { active: "setup" | "reports" }) {
    return (
        <div className="flex items-center gap-5">
            <Link
                href="/interviews/ai"
                className={`text-[28px] font-bold font-nunito tracking-[-0.02em] transition-colors ${
                    active === "setup"
                        ? "text-slate-950 dark:text-white"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
            >
                AI Interview
            </Link>
            <span className="h-8 w-px bg-slate-300 dark:bg-white/15" />
            <Link
                href="/interviews/ai/reports"
                className={`text-[28px] font-bold font-nunito tracking-[-0.02em] transition-colors ${
                    active === "reports"
                        ? "text-slate-950 dark:text-white"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
            >
                Reports
            </Link>
        </div>
    );
}
