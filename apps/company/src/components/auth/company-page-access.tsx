"use client";

import type { ReactNode } from "react";
import { useCompanyAuth } from "@/context/company-auth-context";

type CompanyRole = "owner" | "admin" | "member" | "viewer";

interface CompanyPageAccessProps {
    blockedRoles: CompanyRole[];
    children: ReactNode;
    description: string;
    icon?: string;
    title: string;
}

export function CompanyPageAccess({
    blockedRoles,
    children,
    description,
    icon = "lock",
    title,
}: CompanyPageAccessProps) {
    const { company } = useCompanyAuth();

    if (company && blockedRoles.includes(company.role)) {
        return (
            <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
                <div className="mx-auto flex max-w-7xl flex-col gap-8">
                    <section className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-300">
                            <span className="material-symbols-outlined">{icon}</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Company Workspace</p>
                            <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">{title}</h1>
                        </div>
                    </section>

                    <section className="grid min-h-[360px] place-items-center rounded-lg border border-slate-200 bg-white px-6 py-12 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="max-w-xl">
                            <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-300">
                                <span className="material-symbols-outlined text-4xl">lock</span>
                            </span>
                            <h2 className="mt-5 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">You don't have access</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
                        </div>
                    </section>
                </div>
            </main>
        );
    }

    return <>{children}</>;
}
