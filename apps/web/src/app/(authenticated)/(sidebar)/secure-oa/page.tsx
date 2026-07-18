"use client";

import { useState } from "react";
import { Download, MonitorCheck, ShieldCheck, Activity, ExternalLink, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { getApiBaseUrl } from "@/lib/api";

type LaunchSession = {
    sessionId: string;
    expiresAt: string;
    launchUrl: string;
    protocolUrl: string;
    configUrl: string;
};

type FlowStatus = "idle" | "creating" | "launching" | "needs-install" | "downloading" | "ready" | "error";

type DownloadOption = {
    label: string;
    url: string;
};

export default function SecureOaPage() {
    const [session, setSession] = useState<LaunchSession | null>(null);
    const [status, setStatus] = useState<FlowStatus>("idle");
    const [error, setError] = useState<string | null>(null);
    const [autoDownloadAttempted, setAutoDownloadAttempted] = useState(false);

    const downloadOptions: Record<string, DownloadOption> = {
        windows: {
            label: "Download SecureExamBrowser (Windows)",
            url: "https://github.com/PushpenderIndia/SecureExamBrowser/releases/latest/download/SecureExamBrowser.exe",
        },
        linux: {
            label: "Download SecureExamBrowser (Linux)",
            url: "https://github.com/PushpenderIndia/SecureExamBrowser/releases/latest/download/SecureExamBrowser-linux",
        },
        macArm: {
            label: "Download SecureExamBrowser (macOS Apple Silicon)",
            url: "https://github.com/PushpenderIndia/SecureExamBrowser/releases/latest/download/SecureExamBrowser-macos-arm64.zip",
        },
        macIntel: {
            label: "Download SecureExamBrowser (macOS Intel)",
            url: "https://github.com/PushpenderIndia/SecureExamBrowser/releases/latest/download/SecureExamBrowser-macos-intel.zip",
        },
    };

    const preferredDownload = (() => {
        if (typeof navigator === "undefined") return downloadOptions.windows;
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes("win")) return downloadOptions.windows;
        if (ua.includes("mac")) {
            const isAppleSilicon = ua.includes("arm") || ua.includes("aarch64");
            return isAppleSilicon ? downloadOptions.macArm : downloadOptions.macIntel;
        }
        if (ua.includes("linux")) return downloadOptions.linux;
        return downloadOptions.windows;
    })();

    const getAccessToken = async () => {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
    };

    const createLaunchSession = async () => {
        setStatus("creating");
        setError(null);

        try {
            const token = await getAccessToken();
            if (!token) throw new Error("Please sign in again to start a Secure OA.");

            const response = await fetch(`${getApiBaseUrl()}/secure-oa/sessions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                credentials: "include",
                body: JSON.stringify({
                    assessmentId: "secure-oa-smoke-test",
                    jobId: "test-job",
                    companyId: "test-company",
                    durationMinutes: 75,
                }),
            });

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.message || "Could not create Secure OA session.");
            }

            const payload = (await response.json()) as LaunchSession;
            setSession(payload);
            setStatus("ready");
            return payload;
        } catch (err: any) {
            setError(err.message || "Could not create Secure OA session.");
            setStatus("error");
            return null;
        }
    };

    const triggerAppDownload = (url: string) => {
        setStatus("downloading");
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.rel = "noreferrer";
        anchor.download = "";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => {
            setStatus("needs-install");
        }, 300);
    };

    const attemptProtocolLaunch = (protocolUrl: string) => {
        setStatus("launching");
        let opened = false;

        const markOpened = () => {
            opened = true;
            setStatus("ready");
        };

        const handleBlur = () => markOpened();
        const handleVisibility = () => {
            if (document.hidden) {
                markOpened();
            }
        };

        window.addEventListener("blur", handleBlur, { once: true });
        document.addEventListener("visibilitychange", handleVisibility);

        window.location.href = protocolUrl;

        window.setTimeout(() => {
            window.removeEventListener("blur", handleBlur);
            document.removeEventListener("visibilitychange", handleVisibility);

            if (!opened) {
                setStatus("needs-install");
                if (!autoDownloadAttempted) {
                    setAutoDownloadAttempted(true);
                    triggerAppDownload(preferredDownload.url);
                }
            }
        }, 1200);
    };

    const handleStart = async () => {
        if (status === "creating" || status === "launching" || status === "downloading") return;
        setError(null);

        const activeSession = session ?? (await createLaunchSession());
        if (!activeSession) return;

        attemptProtocolLaunch(activeSession.protocolUrl);
    };

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="mb-8 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-slate-950 dark:text-white">Secure OA</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Standalone desktop assessment launch flow</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <Card>
                    <CardHeader>
                        <CardTitle>Start Secure Online Assessment</CardTitle>
                        <CardDescription>
                            Creates a temporary Secure OA session and launches the SecureExamBrowser desktop app. If the app is not installed,
                            we will prompt a download so you can install it and try again.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                <MonitorCheck className="mb-3 h-5 w-5 text-slate-600 dark:text-slate-300" />
                                <p className="font-semibold">Desktop lockdown</p>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Uses the separate secure browser app.</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                <ShieldCheck className="mb-3 h-5 w-5 text-slate-600 dark:text-slate-300" />
                                <p className="font-semibold">Signed session</p>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Identity is derived from the verified session.</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                <Activity className="mb-3 h-5 w-5 text-slate-600 dark:text-slate-300" />
                                <p className="font-semibold">Telemetry ready</p>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Events post to Secure OA endpoints.</p>
                            </div>
                        </div>

                        {error && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                                {error}
                            </div>
                        )}

                        {status === "needs-install" && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                                SecureExamBrowser is not installed yet. Download and install it, then click Start OA again to open the app.
                            </div>
                        )}

                        <div className="flex flex-wrap gap-3">
                            <Button onClick={handleStart} disabled={status === "creating" || status === "launching" || status === "downloading"} size="lg" className="gap-2">
                                <Rocket className="h-4 w-4" />
                                {status === "creating"
                                    ? "Creating session..."
                                    : status === "launching"
                                      ? "Opening app..."
                                      : "Start OA"}
                            </Button>
                            {(status === "needs-install" || status === "downloading") && (
                                <Button
                                    onClick={() => triggerAppDownload(preferredDownload.url)}
                                    disabled={status === "downloading"}
                                    variant="outline"
                                    size="lg"
                                    className="gap-2"
                                >
                                    <Download className="h-4 w-4" />
                                    {status === "downloading" ? "Downloading..." : preferredDownload.label}
                                </Button>
                            )}
                            {session && (
                                <Button variant="ghost" size="lg" className="gap-2" onClick={() => window.open(session.launchUrl, "_blank")}>
                                    <span>
                                        Open Web Preview <ExternalLink className="ml-2 inline h-4 w-4" />
                                    </span>
                                </Button>
                            )}
                        </div>

                        {status === "needs-install" && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                Other downloads: {" "}
                                <a className="underline" href={downloadOptions.windows.url}>
                                    Windows
                                </a>
                                {" | "}
                                <a className="underline" href={downloadOptions.linux.url}>
                                    Linux
                                </a>
                                {" | "}
                                <a className="underline" href={downloadOptions.macArm.url}>
                                    macOS Apple Silicon
                                </a>
                                {" | "}
                                <a className="underline" href={downloadOptions.macIntel.url}>
                                    macOS Intel
                                </a>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Session</CardTitle>
                        <CardDescription>Current smoke-test launch state.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {session ? (
                            <div className="space-y-3 text-sm">
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Session ID</p>
                                    <p className="break-all font-mono text-slate-900 dark:text-slate-100">{session.sessionId}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Expires</p>
                                    <p className="font-medium text-slate-900 dark:text-slate-100">{new Date(session.expiresAt).toLocaleString()}</p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 dark:text-slate-400">No Secure OA session created yet.</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
