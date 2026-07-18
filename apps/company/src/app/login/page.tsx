"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CompanyEmailVerificationModal } from "@/components/auth/company-email-verification-modal";
import { useCompanyAuth } from "@/context/company-auth-context";

function companyLoginErrorMessage(error: string) {
    if (error === "no_company_access") {
        return "This Google account does not have company workspace access. Use a company owner account, or ask an owner/admin to invite this email to a team.";
    }

    if (error === "company_access_check_failed") {
        return "We could not verify company access right now. Please try again in a moment.";
    }

    if (error === "auth") {
        return "Company login could not be completed. Please try again.";
    }

    return error;
}

function CompanyLoginContent() {
    const [activeTab, setActiveTab] = useState<"login" | "signup">("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [contactName, setContactName] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [formInfo, setFormInfo] = useState<string | null>(null);
    const [showEmailVerification, setShowEmailVerification] = useState(false);
    const [forgotOpen, setForgotOpen] = useState(false);
    const [forgotEmail, setForgotEmail] = useState("");
    const [forgotSubmitting, setForgotSubmitting] = useState(false);
    const [forgotSuccess, setForgotSuccess] = useState(false);
    const [forgotError, setForgotError] = useState<string | null>(null);

    const { signIn, signUp, signInWithGoogle, resetPassword, session, loading, error: authError, clearError } = useCompanyAuth();
    const router = useRouter();
    const searchParams = useSearchParams();

    useEffect(() => {
        if (searchParams.get("tab") === "forgot") {
            setForgotOpen(true);
        }
        if (searchParams.get("tab") === "signup" || searchParams.get("mode") === "signup") {
            setActiveTab("signup");
        }
        const error = searchParams.get("error");
        if (error) {
            clearError();
            setFormInfo(null);
            setFormError(companyLoginErrorMessage(error));
        }
    }, [clearError, searchParams]);

    useEffect(() => {
        if (!loading && session) router.replace("/dashboard");
    }, [session, loading, router]);

    useEffect(() => {
        document.title = activeTab === "signup" ? "Company Sign Up | Practers" : "Company Log In | Practers";
    }, [activeTab]);

    const displayError = formError || authError;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setFormError(null);
        setFormInfo(null);
        clearError();
        setIsSubmitting(true);

        try {
            if (activeTab === "login") {
                await signIn(email, password);
                router.replace("/dashboard");
                return;
            }

            if (!companyName.trim()) {
                setFormError("Company name is required");
                setIsSubmitting(false);
                return;
            }

            const result = await signUp(email, password, companyName, contactName);
            if (result.needsLogin) {
                setActiveTab("login");
                setPassword("");
                setFormInfo(result.message || "Use your existing Practers login to open this company team invite.");
                setIsSubmitting(false);
                return;
            }

            setShowEmailVerification(true);
        } catch {
            setIsSubmitting(false);
            return;
        }

        setIsSubmitting(false);
    };

    const handleForgotPassword = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!forgotEmail.trim()) return;

        setForgotSubmitting(true);
        setForgotError(null);

        try {
            await resetPassword(forgotEmail.trim());
            setForgotSuccess(true);
        } catch (err: any) {
            setForgotError(err?.message || "Failed to send reset email. Please try again.");
        } finally {
            setForgotSubmitting(false);
        }
    };

    const handleGoogleAuth = async () => {
        setFormError(null);
        setFormInfo(null);
        clearError();
        try {
            await signInWithGoogle();
        } catch {
            setIsSubmitting(false);
        }
    };

    const closeForgot = () => {
        setForgotOpen(false);
        setForgotEmail("");
        setForgotSuccess(false);
        setForgotError(null);
    };

    return (
        <>
            <div className="flex min-h-screen w-full flex-col bg-white transition-colors duration-300 dark:bg-[#1a1a1a] lg:flex-row">
                <button
                    onClick={() => router.push("/")}
                    className="fixed left-5 top-5 z-50 flex size-10 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 hover:text-primary/80 dark:hover:bg-primary/20"
                    title="Back"
                >
                    <span className="material-symbols-outlined text-xl">arrow_back</span>
                </button>

                <div className="relative hidden h-screen w-full flex-col justify-center overflow-hidden bg-gradient-to-br from-[#C5D9F7] via-[#E8F0FC] to-[#A8C5F0] px-12 dark:from-[#1a2d4a] dark:via-[#0a0a0a] dark:to-[#1e3a5f] lg:sticky lg:top-0 lg:flex lg:w-1/2 xl:px-24">
                    <div className="relative z-10">
                        <div className="mb-12">
                            <img src="/logo_big.svg" alt="Practers." className="h-16 w-auto" />
                        </div>
                        <h1 className="mb-8 max-w-xl text-4xl font-extrabold leading-[1.15] tracking-tight text-[#1a1a1a] dark:text-white xl:text-5xl">
                            Hire smarter with <span className="text-primary">Practers</span>
                        </h1>
                        <p className="max-w-md text-lg leading-relaxed text-[#5a5a5a] dark:text-neutral-300">
                            Build interview pipelines, standardize evaluations, and surface top talent with AI-powered assessments.
                        </p>
                    </div>
                </div>

                <div className="flex flex-1 items-center justify-center bg-white p-6 dark:bg-[#1a1a1a] sm:p-12 lg:p-16">
                    <div className="w-full max-w-[480px]">
                        <div className="mb-8 flex items-center justify-center lg:hidden">
                            <img src="/logo_big.svg" alt="Practers." className="h-8 w-auto" />
                        </div>

                        <div className="mb-10">
                            <h2 className="mb-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                                {activeTab === "login" ? "Company access" : "Create company account"}
                            </h2>
                            <p className="text-slate-500 dark:text-neutral-400">
                                {activeTab === "login"
                                    ? "Use a company owner account or an invited personal account."
                                    : "Use a work email, or an invited personal email."}
                            </p>
                        </div>

                        {displayError && (
                            <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                                <span className="material-symbols-outlined text-lg text-red-500 dark:text-red-400">error</span>
                                {displayError}
                            </div>
                        )}

                        {formInfo && (
                            <div className="mb-6 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200">
                                <span className="material-symbols-outlined text-lg text-blue-500 dark:text-blue-300">info</span>
                                {formInfo}
                            </div>
                        )}

                        <div className="mb-8 flex border-b border-slate-100 dark:border-lc-border">
                            <button
                                type="button"
                                onClick={() => {
                                    setActiveTab("login");
                                    clearError();
                                    setFormError(null);
                                    setFormInfo(null);
                                }}
                                className={`flex-1 border-b-2 pb-4 text-sm font-bold transition-colors ${
                                    activeTab === "login"
                                        ? "border-primary text-slate-900 dark:text-white"
                                        : "border-transparent text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                                }`}
                            >
                                Login
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setActiveTab("signup");
                                    clearError();
                                    setFormError(null);
                                    setFormInfo(null);
                                }}
                                className={`flex-1 border-b-2 pb-4 text-sm font-bold transition-colors ${
                                    activeTab === "signup"
                                        ? "border-primary text-slate-900 dark:text-white"
                                        : "border-transparent text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                                }`}
                            >
                                Sign Up
                            </button>
                        </div>

                        <div className="mb-8">
                            <button
                                type="button"
                                onClick={handleGoogleAuth}
                                className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-neutral-200 dark:hover:bg-lc-surface/80"
                            >
                                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                        fill="#4285F4"
                                    />
                                    <path
                                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                        fill="#34A853"
                                    />
                                    <path
                                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                                        fill="#FBBC05"
                                    />
                                    <path
                                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                        fill="#EA4335"
                                    />
                                </svg>
                                Continue with Google
                            </button>

                            <div className="relative mt-8 text-center">
                                <div aria-hidden="true" className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-100 dark:border-lc-border" />
                                </div>
                                <span className="relative bg-white px-4 text-xs font-bold uppercase text-slate-400 dark:bg-[#1a1a1a] dark:text-neutral-500">
                                    OR
                                </span>
                            </div>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {activeTab === "signup" && (
                                <>
                                    <Field
                                        id="company-name"
                                        label="Company Name"
                                        value={companyName}
                                        onChange={setCompanyName}
                                        placeholder="Your company"
                                        required
                                    />
                                    <Field
                                        id="contact-name"
                                        label="Contact Name (optional)"
                                        value={contactName}
                                        onChange={setContactName}
                                        placeholder="Hiring manager or admin"
                                    />
                                </>
                            )}

                            <Field
                                id="email"
                                label={activeTab === "login" ? "Email" : "Work or invited email"}
                                type="email"
                                value={email}
                                onChange={setEmail}
                                placeholder={activeTab === "login" ? "name@gmail.com or name@company.com" : "name@company.com or invited@gmail.com"}
                                required
                            />

                            <div>
                                <div className="mb-2 flex justify-between">
                                    <label className="block text-sm font-semibold text-slate-700 dark:text-neutral-300" htmlFor="password">
                                        Password
                                    </label>
                                    {activeTab === "login" && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setForgotEmail(email);
                                                setForgotOpen(true);
                                            }}
                                            className="text-sm font-semibold text-primary hover:underline"
                                        >
                                            Forgot Password?
                                        </button>
                                    )}
                                </div>
                                <input
                                    className="w-full rounded-lg border border-slate-200 bg-transparent px-4 py-3 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-primary dark:border-lc-border dark:bg-lc-surface dark:text-white dark:placeholder:text-neutral-500"
                                    id="password"
                                    placeholder="Password"
                                    type="password"
                                    autoComplete={activeTab === "login" ? "current-password" : "new-password"}
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    required
                                    minLength={6}
                                />
                            </div>

                            <button
                                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#FFE500] py-4 text-sm font-bold text-[#1a1a1a] shadow-lg shadow-[#FFE500]/20 transition hover:bg-[#f5dc00] disabled:cursor-not-allowed disabled:opacity-50"
                                type="submit"
                                disabled={isSubmitting}
                            >
                                {isSubmitting && <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#1a1a1a]/30 border-t-[#1a1a1a]" />}
                                {isSubmitting
                                    ? activeTab === "login"
                                        ? "Signing In..."
                                        : "Creating Account..."
                                    : activeTab === "login"
                                      ? "Sign In"
                                      : "Create Account"}
                            </button>
                        </form>

                        <p className="mt-8 text-center text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
                            Need the candidate app?{" "}
                            <Link className="font-semibold text-primary hover:underline" href="/">
                                Go to Practers
                            </Link>
                        </p>
                    </div>
                </div>
            </div>

            {forgotOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) closeForgot();
                    }}
                >
                    <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                        {forgotSuccess ? (
                            <div className="text-center">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/20">
                                    <span className="material-symbols-outlined text-emerald-500">check</span>
                                </div>
                                <h3 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">Check your inbox</h3>
                                <p className="mb-6 text-sm text-slate-500 dark:text-neutral-400">
                                    We sent a password reset link to <strong>{forgotEmail}</strong>.
                                </p>
                                <button onClick={closeForgot} className="w-full rounded-full bg-[#FFE500] py-3 text-sm font-bold text-[#1a1a1a] transition hover:bg-[#f5dc00]">
                                    Back to Sign In
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="mb-6 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">Reset your password</h3>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">We will send a secure link to your email.</p>
                                    </div>
                                    <button
                                        onClick={closeForgot}
                                        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-lc-bg dark:hover:text-neutral-300"
                                    >
                                        <span className="material-symbols-outlined text-lg">close</span>
                                    </button>
                                </div>

                                {forgotError && (
                                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                                        {forgotError}
                                    </div>
                                )}

                                <form onSubmit={handleForgotPassword} className="space-y-4">
                                    <Field
                                        id="forgot-email"
                                        label="Email Address"
                                        type="email"
                                        value={forgotEmail}
                                        onChange={setForgotEmail}
                                        placeholder="Enter your account email"
                                        required
                                    />
                                    <button
                                        type="submit"
                                        disabled={forgotSubmitting}
                                        className="w-full rounded-full bg-[#FFE500] py-3 text-sm font-bold text-[#1a1a1a] transition hover:bg-[#f5dc00] disabled:opacity-50"
                                    >
                                        {forgotSubmitting ? "Sending..." : "Send Reset Link"}
                                    </button>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            )}

            {showEmailVerification && <CompanyEmailVerificationModal email={email} password={password} />}
        </>
    );
}

function Field({
    id,
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    required = false,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    type?: string;
    required?: boolean;
}) {
    return (
        <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-neutral-300" htmlFor={id}>
                {label}
            </label>
            <input
                id={id}
                type={type}
                placeholder={placeholder}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-transparent px-4 py-3 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-primary dark:border-lc-border dark:bg-lc-surface dark:text-white dark:placeholder:text-neutral-500"
                required={required}
            />
        </div>
    );
}

export default function CompanyLoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-white dark:bg-lc-bg" />}>
            <CompanyLoginContent />
        </Suspense>
    );
}
