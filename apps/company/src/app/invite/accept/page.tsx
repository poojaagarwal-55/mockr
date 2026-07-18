"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError } from "@/lib/api";

type AcceptState = "checking" | "signed_out" | "accepted" | "error";

function inviteLoginHref(token: string, mode?: "signup") {
    const params = new URLSearchParams({ invite: token });
    if (mode) params.set("mode", mode);
    return `/login?${params.toString()}`;
}

function AcceptTeamInviteInner() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { session, loading } = useCompanyAuth();
    const token = searchParams.get("token") || "";
    const [state, setState] = useState<AcceptState>("checking");
    const [message, setMessage] = useState("Checking your invitation...");

    useEffect(() => {
        if (!token) {
            setState("error");
            setMessage("This invitation link is missing a token.");
            return;
        }

        if (loading) return;

        if (!session?.access_token) {
            setState("signed_out");
            setMessage("Sign in with the invited email to accept this company team invitation.");
            return;
        }

        let cancelled = false;
        const accessToken = session.access_token;

        async function acceptInvite() {
            setState("checking");
            setMessage("Accepting your invitation...");

            try {
                await api.post(`/team-invitations/${token}/accept`, {}, accessToken);
                if (cancelled) return;
                setState("accepted");
                setMessage("Invitation accepted. Opening your team workspace...");
                window.setTimeout(() => router.replace("/team"), 900);
            } catch (err) {
                if (cancelled) return;
                const errorMessage = err instanceof ApiError ? err.message : "This invitation could not be accepted.";
                setState("error");
                setMessage(errorMessage);
            }
        }

        acceptInvite();

        return () => {
            cancelled = true;
        };
    }, [loading, router, session?.access_token, token]);

    return (
        <main className="grid min-h-screen place-items-center bg-[#FAFBFC] px-4 py-10 dark:bg-lc-bg">
            <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-3xl">
                        {state === "accepted" ? "check_circle" : state === "error" ? "error" : "group_add"}
                    </span>
                </div>
                <h1 className="mt-5 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Team invitation</h1>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{message}</p>

                {state === "checking" && (
                    <div className="mx-auto mt-6 h-9 w-9 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                )}

                {state === "signed_out" && (
                    <div className="mt-6 grid gap-3">
                        <Link href={inviteLoginHref(token)} className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-bold text-white transition hover:bg-primary-dark">
                            Login
                        </Link>
                        <Link href={inviteLoginHref(token, "signup")} className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 px-5 text-sm font-bold text-slate-700 transition hover:border-primary/40 hover:text-primary dark:border-lc-border dark:text-slate-200">
                            Sign up with invited email
                        </Link>
                    </div>
                )}

                {state === "error" && (
                    <div className="mt-6 grid gap-3">
                        <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-bold text-white transition hover:bg-primary-dark">
                            Open company login
                        </Link>
                    </div>
                )}
            </section>
        </main>
    );
}

function AcceptTeamInviteFallback() {
    return (
        <main className="grid min-h-screen place-items-center bg-[#FAFBFC] px-4 py-10 dark:bg-lc-bg">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        </main>
    );
}

export default function AcceptTeamInvitePage() {
    return (
        <Suspense fallback={<AcceptTeamInviteFallback />}>
            <AcceptTeamInviteInner />
        </Suspense>
    );
}
