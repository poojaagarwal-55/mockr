"use client";
import { useEffect } from "react";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { PageHeader } from "@/components/page-header";

const INTERVIEW_TYPES = [
    {
        id: "ai",
        label: "AI Interview",
        description: "Practice with an intelligent AI interviewer that adapts in real-time. Get instant feedback on your answers, coding, and communication skills.",
        tags: ["Full Interview", "Coding", "Behavioral", "System Design"],
        href: "/interviews/ai",
        available: true,
        image: "/ai_interview_doodle_v2.png",
        bgClass: "bg-[#eaf2ff] dark:bg-gradient-to-b dark:from-[#242424] dark:to-[#1a1a1a]",
        badge: null,
    },
    {
        id: "peer",
        label: "Peer to Peer",
        description: "Interview with a fellow candidate. Take turns as interviewer and interviewee to sharpen your skills together.",
        tags: ["Live Session", "Collaborative", "Real Feedback"],
        href: "/interviews/peer",
        available: true,
        image: "/peer_interview_doodle.png",
        bgClass: "bg-[#eff4ff] dark:bg-gradient-to-b dark:from-[#242424] dark:to-[#1a1a1a]",
        badge: null,
    },
    {
        id: "expert",
        label: "With Expert",
        description: "Book a session with a seasoned interviewer from top tech companies. Get mentorship and actionable guidance.",
        tags: ["1-on-1 Session", "Industry Expert", "Mentorship"],
        href: null,
        available: false,
        image: "/expert_interview_doodle.png",
        bgClass: "bg-[#f3f7ff] dark:bg-gradient-to-b dark:from-[#242424] dark:to-[#1a1a1a]",
        badge: "Coming Soon",
    },
];

export default function InterviewsPage() {
    useEffect(() => { document.title = "Interviews | Mockr"; }, []);
    const router = useRouter();

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg flex flex-col">
            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Interviews</h1>} showBack={true} backUrl="/dashboard" />

            <main className="flex-1 flex flex-col items-center py-12 px-4">
                <div className="w-full max-w-6xl">

                    {/* Header */}
                    <div className="mb-10">
                        <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                            Choose Interview Type
                        </h1>
                        <p className="text-slate-500 dark:text-[#ababab] text-sm mt-1.5">
                            Select how you&apos;d like to practice your interview skills.
                        </p>
                    </div>

                    {/* Cards Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {INTERVIEW_TYPES.map((type) => (
                            <div
                                key={type.id}
                                onClick={() => type.available && type.href && router.push(type.href)}
                                className={`group flex flex-col bg-white dark:bg-lc-surface rounded-2xl overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.1)] border border-slate-100 dark:border-lc-border transition-all duration-200 ${type.available
                                    ? "cursor-pointer hover:shadow-lg hover:-translate-y-1 hover:border-primary/20"
                                    : "cursor-not-allowed opacity-60"
                                    }`}
                            >
                                <div className="p-3 pb-0">
                                    {/* Inner Image Container */}
                                    <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden shadow-inner ring-1 ring-black/5 bg-white">
                                        <Image
                                            src={type.image}
                                            alt={type.label}
                                            fill
                                            sizes="(max-width: 768px) 100vw, 33vw"
                                            className={`pointer-events-none ${type.id === 'ai'
                                                ? 'object-cover object-top scale-[1.15] origin-top'
                                                : 'object-cover object-[50%_35%]'
                                                }`}
                                        />
                                        {/* Coming Soon overlay */}
                                        {type.badge && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-[1px]">
                                                <span className="text-xs font-bold font-nunito px-3 py-1 rounded-full bg-white/90 text-slate-700 tracking-wide uppercase shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)]">
                                                    {type.badge}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Content Flex Body */}
                                <div className="p-5 flex flex-col flex-1">
                                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                        {type.label}
                                    </h2>
                                    <p className="text-[12.5px] text-slate-500 dark:text-[#ababab] leading-relaxed mb-3 flex-1">
                                        {type.description}
                                    </p>
                                    <div className="flex flex-wrap gap-1.5 mt-auto">
                                        {type.tags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-lc-hover text-slate-500 dark:text-[#888]"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                </div>
            </main>
        </div>
    );
}
