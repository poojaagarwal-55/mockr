"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CheckCircle2, ShieldAlert, Wifi } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type ValidationState =
    | { status: "checking" }
    | {
        status: "valid";
        assessmentId: string;
        expiresAt: string;
        durationMinutes?: number;
        assessment?: {
            title?: string;
            instructions?: string;
            questions?: Array<{
                id: string;
                text: string;
                type?: string | null;
                difficulty?: string | null;
                timeLimitMinutes?: number | null;
                aiInterviewEnabled?: boolean;
            }>;
        } | null;
    }
    | { status: "invalid"; message: string };

export default function SecureOaSessionPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const sessionId = params.sessionId as string;
    const token = searchParams.get("token") || "";
    const [state, setState] = useState<ValidationState>({ status: "checking" });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const validationUrl = useMemo(() => {
        const url = new URL(`/secure-oa/sessions/${sessionId}/validate`, `${getApiBaseUrl()}/`);
        url.searchParams.set("token", token);
        return url.toString();
    }, [sessionId, token]);

    useEffect(() => {
        let cancelled = false;

        const validate = async () => {
            try {
                const response = await fetch(validationUrl, { credentials: "include" });
                const body = await response.json().catch(() => ({}));
                if (cancelled) return;

                if (!response.ok) {
                    setState({ status: "invalid", message: "This Secure OA link is invalid or expired." });
                    return;
                }

                setState({
                    status: "valid",
                    assessmentId: body.assessmentId,
                    expiresAt: body.expiresAt,
                    durationMinutes: body.durationMinutes,
                    assessment: body.assessment || null,
                });
            } catch {
                if (!cancelled) {
                    setState({ status: "invalid", message: "Could not validate this Secure OA session." });
                }
            }
        };

        validate();
        return () => {
            cancelled = true;
        };
    }, [validationUrl]);

    async function sendTelemetry(type: "exam_started" | "exam_submitted") {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return;
        await fetch(`${getApiBaseUrl()}/secure-oa/sessions/${sessionId}/telemetry`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
            },
            credentials: "include",
            body: JSON.stringify({
                type,
                occurredAt: new Date().toISOString(),
            }),
        });
    }

    useEffect(() => {
        if (state.status !== "valid") return;
        void sendTelemetry("exam_started");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.status]);

    async function submitAssessment() {
        if (submitting || submitted) return;
        setSubmitting(true);
        try {
            await sendTelemetry("exam_submitted");
            setSubmitted(true);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="min-h-screen bg-slate-950 text-white">
            <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
                <header className="flex items-center justify-between border-b border-white/10 pb-5">
                    <div>
                        <p className="text-sm uppercase tracking-[0.18em] text-emerald-300">InterviewForge</p>
                        <h1 className="mt-2 text-3xl font-bold">Secure OA Test Assessment</h1>
                    </div>
                    <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
                        Secure Browser Mode
                    </div>
                </header>

                <section className="grid flex-1 gap-6 py-8 lg:grid-cols-[1fr_320px]">
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
                        {state.status === "checking" && (
                            <div className="flex h-full min-h-[420px] items-center justify-center text-slate-300">
                                Validating secure session...
                            </div>
                        )}

                        {state.status === "invalid" && (
                            <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center">
                                <ShieldAlert className="mb-4 h-12 w-12 text-red-300" />
                                <h2 className="text-2xl font-semibold">Session Blocked</h2>
                                <p className="mt-2 max-w-md text-slate-300">{state.message}</p>
                            </div>
                        )}

                        {state.status === "valid" && (
                            <div>
                                <div className="mb-6 flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-emerald-100">
                                    <CheckCircle2 className="h-5 w-5" />
                                    Session verified. Lockdown and proctoring are controlled by the desktop app.
                                </div>
                                <h2 className="text-2xl font-semibold">{state.assessment?.title || "Sample Coding Assessment"}</h2>
                                {state.assessment?.instructions && <p className="mt-3 text-slate-300">{state.assessment.instructions}</p>}
                                <div className="mt-8 space-y-5">
                                    {(state.assessment?.questions?.length ? state.assessment.questions : [{ id: "sample", text: "Implement a function that returns the sum of two integers.", timeLimitMinutes: 30 }]).map((question, index) => (
                                        <div key={question.id} className="rounded-lg bg-slate-900 p-5">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="font-mono text-sm text-slate-400">Question {index + 1}</p>
                                                    <p className="mt-2 text-lg">{question.text}</p>
                                                </div>
                                                <span className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300">{question.timeLimitMinutes || 0}m</span>
                                            </div>
                                            <textarea
                                                className="mt-5 h-48 w-full resize-none rounded-lg border border-white/10 bg-black p-4 font-mono text-sm text-slate-100 outline-none focus:border-emerald-400"
                                                defaultValue={index === 0 ? `function solve() {\n  // Write your answer here\n}` : ""}
                                            />
                                        </div>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    onClick={submitAssessment}
                                    disabled={submitting || submitted}
                                    className="mt-6 rounded-lg bg-emerald-400 px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {submitted ? "Submitted" : submitting ? "Submitting..." : "Submit OA"}
                                </button>
                            </div>
                        )}
                    </div>

                    <aside className="space-y-4">
                        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                            <p className="text-sm text-slate-400">Session ID</p>
                            <p className="mt-1 break-all font-mono text-sm">{sessionId}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                            <p className="text-sm text-slate-400">Status</p>
                            <div className="mt-2 flex items-center gap-2">
                                <Wifi className="h-4 w-4 text-emerald-300" />
                                <span>{state.status === "valid" ? "Connected" : state.status === "checking" ? "Checking" : "Blocked"}</span>
                            </div>
                        </div>
                        {state.status === "valid" && (
                            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                                <p className="text-sm text-slate-400">Assessment</p>
                                <p className="mt-1 font-medium">{state.assessmentId}</p>
                                <p className="mt-4 text-sm text-slate-400">Duration</p>
                                <p className="mt-1 text-sm">{state.durationMinutes || 0} minutes</p>
                                <p className="mt-4 text-sm text-slate-400">Expires</p>
                                <p className="mt-1 text-sm">{new Date(state.expiresAt).toLocaleString()}</p>
                            </div>
                        )}
                    </aside>
                </section>
            </div>
        </main>
    );
}
