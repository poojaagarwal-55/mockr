"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "next-themes";
import { api } from "@/lib/api";
import { updateLastInterviewDate } from "@/lib/notifications";

export default function InterviewCompletePage() {
    useEffect(() => { 
        document.title = "Interview Complete | Mockr"; 
        // Update last interview date for reminder system
        updateLastInterviewDate();
    }, []);
    const params = useParams();
    const sessionId = params?.sessionId as string;
    const router = useRouter();
    const { session, user } = useAuth();
    const { resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState("Analyzing your interview...");
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const hasRedirected = useRef(false);
    const inFlight = useRef(false);

    const userMetaData = session?.user?.user_metadata || {};
    const displayName = userMetaData.full_name?.split(' ')[0] || userMetaData.name?.split(' ')[0] || user?.fullName?.split(' ')[0] || "there";

    useEffect(() => setMounted(true), []);
    const isDark = mounted && resolvedTheme === "dark";

    const token = session?.access_token;

    // Animated progress milestones (visual only — actual redirect is tied to API)
    useEffect(() => {
        const milestones = [
            { time: 800, prog: 15, text: "Processing interview transcript..." },
            { time: 2500, prog: 30, text: "Evaluating your responses..." },
            { time: 5000, prog: 50, text: "Analyzing skill proficiency..." },
            { time: 8000, prog: 65, text: "Generating detailed feedback..." },
            { time: 12000, prog: 80, text: "Finalizing your report..." },
        ];

        const timers = milestones.map(({ time, prog, text }) =>
            setTimeout(() => {
                setProgress((prev) => Math.max(prev, prog));
                setStatusText(text);
            }, time)
        );

        return () => timers.forEach(clearTimeout);
    }, []);

    // Poll the reports API until the report is ready
    const checkReport = useCallback(async () => {
        if (!token || !sessionId || hasRedirected.current) return;
        // Prevent overlapping requests — skip this tick if a fetch is already in-flight
        if (inFlight.current) return;
        inFlight.current = true;

        try {
            const data = await api.get<any>(`/users/me/reports/${sessionId}`, token);

            // If we get a PENDING status, keep polling
            if ("status" in data && data.status === "PENDING") {
                return;
            }

            // Report is ready — redirect
            if (data && data.id) {
                hasRedirected.current = true;
                setProgress(100);
                setStatusText("Report ready! Redirecting...");
                if (pollRef.current) clearInterval(pollRef.current);
                setTimeout(() => {
                    router.replace(`/reports/${sessionId}`);
                }, 600);
            }
        } catch (err: any) {
            // 409 = interview not yet completed on server side, keep polling
            if (err?.status === 409) return;
            // 404 = report not yet generated, keep polling
            if (err?.status === 404) return;
            // Other errors — keep polling but don't crash
            console.warn("[Complete] Report check error:", err?.message || err);
        } finally {
            inFlight.current = false;
        }
    }, [token, sessionId, router]);

    useEffect(() => {
        if (!token || !sessionId) return;

        // Start polling after a short delay (give the server time to begin generation)
        const startDelay = setTimeout(() => {
            checkReport(); // Initial check
            pollRef.current = setInterval(checkReport, 4000); // Poll every 4 seconds
        }, 2000);

        return () => {
            clearTimeout(startDelay);
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [token, sessionId, checkReport]);

    // Safety: if polling hasn't found a report after 90 seconds, redirect anyway
    useEffect(() => {
        const fallback = setTimeout(() => {
            if (!hasRedirected.current) {
                hasRedirected.current = true;
                setProgress(100);
                setStatusText("Redirecting to report...");
                if (pollRef.current) clearInterval(pollRef.current);
                router.replace(`/reports/${sessionId}`);
            }
        }, 90000);
        return () => clearTimeout(fallback);
    }, [router, sessionId]);

    return (
        <div className="bg-[#f8f7f5] dark:bg-lc-bg min-h-screen flex items-center justify-center relative overflow-hidden">
            {/* Decorative Confetti Dots */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="confetti-dot bg-primary top-1/4 left-1/4" />
                <div className="confetti-dot bg-green-400 top-1/3 right-1/4" style={{ animationDelay: "0.5s" }} />
                <div className="confetti-dot bg-indigo-300 bottom-1/4 left-1/3" style={{ animationDelay: "1s" }} />
                <div className="confetti-dot bg-primary/40 top-10 right-10" style={{ animationDelay: "1.5s" }} />
                <div className="confetti-dot bg-blue-200 bottom-20 right-20" style={{ animationDelay: "2s" }} />
            </div>

            <div className="flex flex-col items-center justify-center px-4 z-10 w-full">
                <div className="flex flex-col max-w-[560px] w-full bg-white dark:bg-lc-surface rounded-xl shadow-xl shadow-primary/5 dark:shadow-black/20 p-12 items-center text-center">
                    {/* Success Icon */}
                    <div className="w-24 h-24 bg-[#ECFDF5] dark:bg-green-500/10 rounded-full flex items-center justify-center mb-8">
                        <span
                            className="material-symbols-outlined text-[48px] text-[#10B981]"
                            style={{
                                fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 48",
                            }}
                        >
                            check_circle
                        </span>
                    </div>

                    {/* Header */}
                    <h1 className="text-slate-900 dark:text-white font-nunito font-bold text-[32px] leading-tight mb-3">
                        Interview Complete
                    </h1>
                    <p className="text-slate-500 dark:text-[#ababab] text-lg font-normal mb-10 max-w-[400px]">
                        Great effort, {displayName}! Your detailed report is being generated.
                    </p>

                    {/* Progress */}
                    <div className="w-full max-w-[400px] flex flex-col gap-4">
                        <div className="flex justify-between items-end mb-1">
                            <p className="text-slate-700 dark:text-[#ccc] text-sm font-medium">
                                {statusText}
                            </p>
                            <p className="text-primary text-sm font-bold">{progress}%</p>
                        </div>
                        <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-lc-hover overflow-hidden relative shimmer">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-primary via-blue-400 to-primary transition-all duration-500 ease-out"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="text-xs text-slate-400 dark:text-[#6b6b6b] mt-1">
                            This usually takes 15–30 seconds. Please don't close this page.
                        </p>
                    </div>

                    {/* Footer Link */}
                    <div className="mt-12">
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="text-primary font-semibold text-base flex items-center gap-2 hover:gap-3 transition-all duration-300 underline decoration-primary/30 underline-offset-4 cursor-pointer"
                        >
                            Return to dashboard
                            <span className="material-symbols-outlined text-sm">arrow_forward</span>
                        </button>
                    </div>
                </div>

                {/* Branding */}
                <div className="mt-8 flex items-center gap-2 opacity-60">
                    <Image src={isDark ? "/logo_big_dark.png" : "/logo_big.png"} alt="Mockr" width={120} height={34} className="h-5 w-auto" />
                </div>
            </div>
        </div>
    );
}
