"use client";
import { useEffect } from "react";

import { Code2, Database, Network, BookOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";

interface QuestionCategory {
    id: string;
    title: string;
    description: string;
    icon: any;
    color: string;
    bgGradient: string;
    route: string;
    count?: number;
}

const categories: QuestionCategory[] = [
    {
        id: "dsa",
        title: "Data Structures & Algorithms",
        description: "Master coding interviews with curated DSA problems",
        icon: Code2,
        color: "text-blue-600",
        bgGradient: "from-blue-500 to-cyan-500",
        route: "/questions/dsa",
    },
    {
        id: "sql",
        title: "SQL",
        description: "Practice database queries and SQL problem solving",
        icon: Database,
        color: "text-green-600",
        bgGradient: "from-green-500 to-emerald-500",
        route: "/questions/sql",
    },
    {
        id: "system-design",
        title: "System Design",
        description: "Learn to design scalable systems and architectures",
        icon: Network,
        color: "text-purple-600",
        bgGradient: "from-purple-500 to-pink-500",
        route: "/questions/system-design",
    },
    {
        id: "cs-fundamentals",
        title: "CS Fundamentals",
        description: "Strengthen your knowledge in OS, DBMS, Networks & OOP",
        icon: BookOpen,
        color: "text-orange-600",
        bgGradient: "from-orange-500 to-red-500",
        route: "/questions/cs-fundamentals",
    },
];

export default function QuestionsLandingPage() {
    useEffect(() => { document.title = "Questions | Mockr"; }, []);
    const router = useRouter();

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg flex flex-col">
            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Questions</h1>} showBack={true} backUrl="/dashboard" />
            
            <main className="flex-1 flex flex-col items-center py-12 px-4">
                <div className="w-full max-w-6xl">
                    {/* Header */}
                    <div className="mb-10">
                        <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                            Practice Questions
                        </h1>
                        <p className="text-slate-500 dark:text-[#ababab] text-sm mt-1.5">
                            Select a category to start practicing and ace your interviews.
                        </p>
                    </div>

                    {/* Categories Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-6">
                        {categories.map((category) => {
                            const IconCmp = category.icon;
                            return (
                                <div
                                    key={category.id}
                                    onClick={() => router.push(category.route)}
                                    className="group flex flex-col bg-white dark:bg-lc-surface rounded-2xl overflow-hidden shadow-[0_0_16px_rgba(0,0,0,0.04)] dark:shadow-[0_0_16px_rgba(0,0,0,0.2)] transition-all duration-200 cursor-pointer hover:shadow-[0_0_24px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_0_24px_rgba(0,0,0,0.3)] hover:-translate-y-1 text-left min-h-[220px]"
                                >
                                    <div className="p-8 flex flex-col flex-1">
                                        <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-500/15 flex items-center justify-center shadow-sm mb-6 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3 shrink-0">
                                            <IconCmp className="text-blue-500 dark:text-blue-400 w-7 h-7" strokeWidth={2.5} />
                                        </div>
                                        <h2 className="text-[20px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight mb-2.5">
                                            {category.title}
                                        </h2>
                                        <p className="text-[14px] text-slate-500 dark:text-[#ababab] leading-relaxed flex-1">
                                            {category.description}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </main>
        </div>
    );
}