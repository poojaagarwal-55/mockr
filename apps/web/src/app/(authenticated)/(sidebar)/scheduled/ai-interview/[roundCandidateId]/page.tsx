"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ScheduledAiInterviewRedirectPage() {
    const params = useParams<{ roundCandidateId: string }>();
    const router = useRouter();

    useEffect(() => {
        if (!params.roundCandidateId) return;
        router.replace(`/screening-room/${encodeURIComponent(params.roundCandidateId)}`);
    }, [params.roundCandidateId, router]);

    return (
        <main className="grid min-h-full place-items-center px-6 py-16 text-center">
            <div>
                <p className="text-sm font-bold uppercase tracking-[0.22em] text-blue-500">AI interview</p>
                <h1 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">Opening secure room</h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    Redirecting you to the full-screen screening interview.
                </p>
            </div>
        </main>
    );
}
