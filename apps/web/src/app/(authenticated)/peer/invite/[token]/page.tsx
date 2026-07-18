"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

const levelOptions = [
    { value: "beginner", label: "Beginner" },
    { value: "intermediate", label: "Intermediate" },
    { value: "advanced", label: "Advanced" },
] as const;

const languageOptions = ["python", "javascript", "typescript", "java", "cpp", "go"] as const;

type AcceptResponse = {
    sessionId: string;
    roomId: string;
    myPrepQuestion: {
        title: string;
        difficulty: string;
        category: string;
        practiceUrl: string;
    };
};

export default function PeerInviteAcceptPage() {
    const params = useParams();
    const router = useRouter();
    const { session } = useAuth();

    const token = params?.token as string;

    const [level, setLevel] = useState<(typeof levelOptions)[number]["value"]>("beginner");
    const [preferredLanguage, setPreferredLanguage] = useState<(typeof languageOptions)[number]>("python");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        document.title = "Accept Peer Invite | Mockr";
    }, []);

    const handleAccept = async () => {
        if (!session?.access_token || !token) return;

        setSubmitting(true);
        setError(null);

        try {
            const response = await api.post<AcceptResponse>(
                `/p2p/invites/${token}/accept`,
                {
                    level,
                    preferredLanguage,
                },
                session.access_token
            );

            router.push(`/interviews/peer/session/${response.sessionId}/prep`);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to accept invite";
            setError(message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg">
            <PageHeader title="Accept Peer Invite" showBack backUrl="/interviews/peer" />

            <main className="max-w-3xl mx-auto p-6">
                <section className="bg-white dark:bg-lc-surface border border-slate-100 dark:border-lc-border rounded-2xl p-6 space-y-4">
                    <h1 className="font-nunito text-2xl font-bold text-slate-900 dark:text-white">Join invited session</h1>
                    <p className="text-sm text-slate-500">Pick your level and language. Your prep question will be assigned from MongoDB when you join.</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="flex flex-col gap-2 text-sm">
                            <span>Level</span>
                            <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} className="border rounded-lg px-3 py-2 bg-transparent">
                                {levelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-col gap-2 text-sm">
                            <span>Preferred language</span>
                            <select value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value as typeof preferredLanguage)} className="border rounded-lg px-3 py-2 bg-transparent">
                                {languageOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                        </label>
                    </div>

                    <button onClick={handleAccept} disabled={submitting} className="px-4 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-60">
                        {submitting ? "Joining..." : "Accept Invite"}
                    </button>

                    {error && (
                        <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 text-red-700 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}
