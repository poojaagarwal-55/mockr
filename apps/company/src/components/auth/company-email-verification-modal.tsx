"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api } from "@/lib/api";

interface CompanyEmailVerificationModalProps {
    email: string;
    password: string;
    onClose?: () => void;
}

export function CompanyEmailVerificationModal({
    email,
    password,
    onClose,
}: CompanyEmailVerificationModalProps) {
    const { signIn } = useCompanyAuth();
    const router = useRouter();
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resending, setResending] = useState(false);
    const otpSentRef = useRef(false);

    useEffect(() => {
        if (otpSentRef.current) return;
        otpSentRef.current = true;

        api.post("/companies/verification/email/send-public", { email }).catch((err: any) => {
            setError(err.message || "Failed to send verification code");
            otpSentRef.current = false;
        });
    }, [email]);

    const handleVerify = async (event: React.FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setError(null);

        try {
            await api.post("/companies/verification/email/verify-public", { email, code });
            await signIn(email, password);
            router.replace("/dashboard");
        } catch (err: any) {
            setError(err.message || "Verification failed");
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        setResending(true);
        setError(null);

        try {
            await api.post("/companies/verification/email/send-public", { email });
        } catch (err: any) {
            setError(err.message || "Failed to resend code");
        } finally {
            setResending(false);
        }
    };

    const handleSkip = async () => {
        if (process.env.NODE_ENV !== "development") return;

        setLoading(true);
        setError(null);

        try {
            await api.post("/companies/verification/email/verify-public", {
                email,
                code: "000000",
                devSkip: true,
            });
            await signIn(email, password);
            router.replace("/dashboard");
        } catch (err: any) {
            setError(err.message || "Sign in failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-900 dark:text-white">
                            Verify your email
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            We sent a 6-digit code to <strong>{email}</strong>.
                        </p>
                    </div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-lc-hover"
                        >
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    )}
                </div>

                {error && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                        {error}
                    </div>
                )}

                <form onSubmit={handleVerify} className="space-y-4">
                    <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Verification Code
                        </label>
                        <input
                            type="text"
                            value={code}
                            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                            placeholder="000000"
                            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-center font-mono text-2xl tracking-widest text-slate-900 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-lc-border dark:bg-lc-bg dark:text-white"
                            maxLength={6}
                            required
                            autoFocus
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || code.length !== 6}
                        className="w-full rounded-full bg-primary py-3 font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading ? "Verifying..." : "Verify Email"}
                    </button>
                </form>

                <div className="mt-4 text-center">
                    <button
                        onClick={handleResend}
                        disabled={resending}
                        className="text-sm font-semibold text-primary hover:underline disabled:opacity-50"
                    >
                        {resending ? "Sending..." : "Resend Code"}
                    </button>

                    {process.env.NODE_ENV === "development" && (
                        <>
                            <span className="mx-2 text-slate-400">/</span>
                            <button
                                onClick={handleSkip}
                                disabled={loading}
                                className="text-sm font-semibold text-amber-600 hover:underline disabled:opacity-50 dark:text-amber-400"
                            >
                                Skip dev check
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
