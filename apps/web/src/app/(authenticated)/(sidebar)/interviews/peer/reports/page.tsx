"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import ReportsListPage from "@/components/reports-list-page";

const PEER_REPORT_TYPE_CARDS = [
    {
        type: "coding",
        title: "Coding",
        subtitle: "Peer-to-peer coding interview reports with feedback from your matched candidate.",
        illustration: "/coding_interview_CardPanel.png",
        bgClass: "bg-gradient-to-r from-sky-100 via-sky-200 to-sky-300 dark:from-sky-900/50 dark:via-sky-800/50 dark:to-sky-950/70",
        accentClass: "from-sky-600 to-sky-700",
    },
];

type PendingReport = {
    sessionId: string;
    generatedAt: string;
};

function PeerInterviewTabs({ active }: { active: "setup" | "reports" }) {
    return (
        <div className="flex items-center gap-5">
            <Link
                href="/interviews/peer"
                className={`text-[28px] font-bold font-nunito tracking-[-0.02em] transition-colors ${
                    active === "setup"
                        ? "text-slate-950 dark:text-white"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
            >
                Peer Interview
            </Link>
            <span className="h-8 w-px bg-slate-300 dark:bg-white/15" />
            <Link
                href="/interviews/peer/reports"
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

function PendingBanner({ items }: { items: PendingReport[] }) {
    if (items.length === 0) return null;

    return (
        <div className="px-4 xl:px-0">
            <div className="bg-slate-100 dark:bg-white/[0.04] rounded-2xl px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                    <span className="material-symbols-outlined text-slate-500 dark:text-slate-400 text-[20px]">schedule</span>
                    <h3 className="text-[15px] font-bold text-slate-700 dark:text-slate-200">
                        Waiting for peer feedback ({items.length})
                    </h3>
                </div>
                <div className="space-y-2">
                    {items.map((r) => (
                        <div
                            key={r.sessionId}
                            className="flex items-center justify-between gap-4 bg-white dark:bg-lc-surface rounded-xl px-4 py-3"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span className="material-symbols-outlined text-slate-400 text-[18px] shrink-0">code</span>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                                        Coding Interview
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {new Date(r.generatedAt).toLocaleDateString(undefined, {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                        })}
                                    </p>
                                </div>
                            </div>
                            <Link
                                href={`/interviews/peer/session/${r.sessionId}/report`}
                                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-slate-200 transition-colors"
                            >
                                View
                            </Link>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function PeerReportsPage() {
    const { session } = useAuth();
    const [pendingReports, setPendingReports] = useState<PendingReport[]>([]);

    useEffect(() => {
        if (!session?.access_token) return;
        api.get<{ reports: unknown[]; pendingReports: PendingReport[] }>("/p2p/me/reports", session.access_token)
            .then((data) => setPendingReports(data.pendingReports || []))
            .catch(() => {});
    }, [session?.access_token]);

    return (
        <ReportsListPage
            documentTitle="Peer Reports | Mockr"
            headerTitleNode={<PeerInterviewTabs active="reports" />}
            backUrl="/interviews"
            reportsEndpoint="/p2p/me/reports"
            reportTypeCards={PEER_REPORT_TYPE_CARDS}
            getTypeHref={(type) => `/interviews/peer/reports/type/${encodeURIComponent(type)}`}
            getReportHref={(report) => `/interviews/peer/session/${report.sessionId}/report`}
            topBannerNode={<PendingBanner items={pendingReports} />}
        />
    );
}
