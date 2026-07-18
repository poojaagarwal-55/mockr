"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ProctoringEventInput, ProctoringEventType } from "@interviewforge/shared";
import { api, ApiError } from "@/lib/api";
import { createProctoringClient, type ProctoringClient, type ProctoringClientStatus, type RulesPublic } from "@/lib/proctoring/client";

type OaQuestion = {
    id: string;
    questionId?: string;
    text: string;
    type?: string | null;
    difficulty?: string | null;
    timeLimitMinutes?: number | null;
    aiInterviewEnabled?: boolean;
    orderIndex?: number;
};

type ScheduledOnlineAssessmentRound = {
    id: string;
    roundId: string;
    status: string;
    job: {
        title: string;
        companyName: string;
        location?: string | null;
    };
    onlineAssessment?: {
        id: string;
        roundId: string;
        title: string;
        startAt?: string | null;
        endAt?: string | null;
        durationMinutes?: number | null;
        questionCount?: number | null;
        instructions?: string | null;
        candidateMessage?: string | null;
        requireSecureBrowser?: boolean;
        questions?: OaQuestion[];
    } | null;
};

type StartResponse = {
    sessionId: string;
    rulesPublic: RulesPublic;
};

type ToastItem = {
    id: number;
    message: string;
};

type CandidateIdentity = {
    name: string;
    email: string;
    phone: string;
};

type SecureOaIdeMessage =
    | {
        type: "secure-oa:code-change";
        sessionId?: string;
        questionId?: string;
        code?: string;
        language?: string;
    }
    | {
        type: "secure-oa:violation";
        sessionId?: string;
        questionId?: string;
        reason?: string;
        violationCount?: number;
        threshold?: number;
        code?: string;
        language?: string;
    }
    | {
        type: "secure-oa:auto-submit";
        sessionId?: string;
        questionId?: string;
        reason?: string;
        violationCount?: number;
        code?: string;
        language?: string;
    }
    | {
        type: "secure-oa:submit-request";
        sessionId?: string;
        questionId?: string;
        code?: string;
        language?: string;
    };

const warningEventTypes = new Set<ProctoringEventType>([
    "face_absent",
    "face_multiple",
    "face_looking_away",
    "object_detected",
    "tab_hidden",
    "window_blur",
    "fullscreen_exit",
    "devtools_opened",
    "copy",
    "paste",
    "cut",
    "webcam_revoked",
    "webcam_stream_ended",
    "heartbeat_gap",
    "multi_session_attempt",
    "network_disconnect",
]);

const toastCopy: Partial<Record<ProctoringEventType, string>> = {
    face_absent: "Please face the camera.",
    face_multiple: "Only one person should be visible. The assessment will end if this continues.",
    object_detected: "Object detected in camera view. Capturing this frame for review.",
    tab_hidden: "Stay on this tab. Switching tabs is being recorded.",
    fullscreen_exit: "Fullscreen is required. Returning to fullscreen...",
    devtools_opened: "Developer tools are not allowed during the assessment.",
    paste: "Large pasted content may be flagged in your integrity report.",
};

const HEADSET_LABEL_RE = /(headset|headphone|headphones|earphone|earphones|earbud|earbuds|airpods|buds|bluetooth|noise)/i;
const LOCAL_AUTO_SUBMIT_LIMIT = 5;

const SecureOaContestIde = dynamic(
    () => import("@/app/(authenticated)/(sidebar)/contests/[id]/solve/[questionId]/contest-solve").then((mod) => mod.SolvePageContent),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-full min-h-[520px] items-center justify-center bg-white text-sm font-bold text-slate-500 dark:bg-lc-bg dark:text-slate-300">
                Loading coding workspace...
            </div>
        ),
    }
);

const SecureOaSqlIde = dynamic(
    () => import("@/app/secure-oa/ide/[questionId]/sql-solve").then((mod) => mod.SecureOaSqlIde),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-full min-h-[520px] items-center justify-center bg-white text-sm font-bold text-slate-500 dark:bg-lc-bg dark:text-slate-300">
                Loading SQL workspace...
            </div>
        ),
    }
);

function formatDuration(minutes?: number | null) {
    const total = Math.max(0, Number(minutes || 0));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatWindow(value?: string | null) {
    if (!value) return "Not scheduled";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not scheduled";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function terminationMessage(reason: string) {
    if (reason === "webcam_revoked") {
        return "Camera access was lost during the assessment. The assessment cannot continue without camera access.";
    }
    if (reason === "multi_session_conflict" || reason === "multi_session_attempt") {
        return "We detected another session of this assessment in a different tab or on another device.";
    }
    if (reason === "manual_company") {
        return "Your assessment was ended by the company.";
    }
    return "We detected activity that does not meet the integrity requirements for this assessment. Your responses up to this point have been saved.";
}

function violationLabel(reason: string) {
    return reason.replace(/^auto_/, "").replace(/_/g, " ");
}

function decodeCandidateIdentity(token: string): CandidateIdentity {
    try {
        const normalized = token.replace(/^Bearer\s+/i, "");
        const base64 = normalized.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") || "";
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
        const payload = JSON.parse(atob(padded));
        const metadata = payload.user_metadata || {};
        return {
            name: metadata.full_name || metadata.name || "Candidate",
            email: payload.email || metadata.email || "",
            phone: payload.phone || metadata.phone || "",
        };
    } catch {
        return { name: "Candidate", email: "", phone: "" };
    }
}

function displayIdentity(identity: CandidateIdentity) {
    return [identity.email, identity.phone].filter(Boolean).join("  ");
}

function formatClock(totalSeconds: number) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return hours ? `${String(hours).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

function questionSeconds(question: OaQuestion | null, assessmentMinutes?: number | null, questionCount?: number | null) {
    if (!question) return 0;
    const configuredMinutes = Number(question.timeLimitMinutes || 0);
    if (configuredMinutes > 0) return Math.max(30, Math.round(configuredMinutes * 60));
    const fallbackMinutes = Number(assessmentMinutes || 0) / Math.max(1, Number(questionCount || 1));
    return Math.max(60, Math.round((fallbackMinutes || 30) * 60));
}

function resolveIdeQuestionId(question: OaQuestion) {
    if (question.questionId) return question.questionId;
    const parts = question.id.split(":");
    return parts[parts.length - 1] || question.id;
}

function normalizedQuestionType(question: OaQuestion) {
    const explicitType = String(question.type || "").trim().toLowerCase();
    if (explicitType) return explicitType;
    const keyParts = String(question.id || "").split(":").map((part) => part.trim().toLowerCase());
    if (keyParts.includes("sql")) return "sql";
    return "dsa";
}

function canUseContestIde(question: OaQuestion) {
    const normalizedType = normalizedQuestionType(question);
    return Boolean(question.questionId || question.id) && ["dsa", "coding", "backend", "frontend", "genai"].includes(normalizedType);
}

function canUseSqlIde(question: OaQuestion) {
    const normalizedType = normalizedQuestionType(question);
    return Boolean(question.questionId || question.id) && ["sql", "database", "dbms"].includes(normalizedType);
}

async function clientFingerprint() {
    if (typeof window === "undefined" || !crypto.subtle) return undefined;
    const raw = [
        navigator.userAgent,
        `${window.screen.width}x${window.screen.height}`,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    ].join("|");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ProctoredOnlineAssessmentFlow({
    round,
    token,
    onExit,
    onSubmitted,
}: {
    round: ScheduledOnlineAssessmentRound;
    token: string;
    onExit: () => void;
    onSubmitted: () => void;
}) {
    const assessment = round.onlineAssessment!;
    const identity = useMemo(() => decodeCandidateIdentity(token), [token]);
    const previewRef = useRef<HTMLVideoElement | null>(null);
    const previewStreamRef = useRef<MediaStream | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const [gateState, setGateState] = useState<"intro" | "checking" | "error" | "started">("intro");
    const [error, setError] = useState("");
    const [started, setStarted] = useState<StartResponse | null>(null);
    const [cameraReady, setCameraReady] = useState(false);
    const [audioReady, setAudioReady] = useState(false);
    const [screenReady, setScreenReady] = useState(false);
    const [fullscreenReady, setFullscreenReady] = useState(false);
    const [headsetName, setHeadsetName] = useState("");

    useEffect(() => {
        return () => {
            previewStreamRef.current?.getTracks().forEach((track) => track.stop());
            audioStreamRef.current?.getTracks().forEach((track) => track.stop());
            screenStreamRef.current?.getTracks().forEach((track) => track.stop());
        };
    }, []);

    function stopGateMedia({ keepScreen = false }: { keepScreen?: boolean } = {}) {
        previewStreamRef.current?.getTracks().forEach((track) => track.stop());
        previewStreamRef.current = null;
        audioStreamRef.current?.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
        if (!keepScreen) {
            screenStreamRef.current?.getTracks().forEach((track) => track.stop());
            screenStreamRef.current = null;
            setScreenReady(false);
        }
        setCameraReady(false);
        setAudioReady(false);
        setFullscreenReady(false);
        setHeadsetName("");
    }

    async function requestFullscreen() {
        if (document.fullscreenElement) return;
        await document.documentElement.requestFullscreen();
    }

    function assertDesktopDevice() {
        if (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)) {
            throw new Error("This assessment must be attempted on a desktop or laptop. Mobile devices are not allowed.");
        }
    }

    async function requestCameraPreview() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        previewStreamRef.current = stream;
        if (previewRef.current) {
            previewRef.current.srcObject = stream;
            await previewRef.current.play().catch(() => { });
        }
        setCameraReady(true);
    }

    async function requestHeadsetAudio() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioStreamRef.current = stream;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((device) => device.kind === "audioinput");
        const audioOutputs = devices.filter((device) => device.kind === "audiooutput");
        const track = stream.getAudioTracks()[0];
        const selected = audioInputs.find((device) => device.deviceId === track?.getSettings?.().deviceId) || audioInputs[0];
        const selectedInputLabel = selected?.label || track?.label || "";
        const detectedHeadsetDevice = [selectedInputLabel, ...audioInputs.map((device) => device.label), ...audioOutputs.map((device) => device.label)]
            .filter(Boolean)
            .find((label) => HEADSET_LABEL_RE.test(label));

        if (!detectedHeadsetDevice) {
            stream.getTracks().forEach((item) => item.stop());
            audioStreamRef.current = null;
            throw new Error("Please connect and select wired or Bluetooth earbuds/headset before starting this OA.");
        }
        setHeadsetName(`Detected ${detectedHeadsetDevice}. Microphone access is ready.`);
        setAudioReady(true);
    }

    async function requestScreenShare() {
        const getDisplayMedia = (navigator.mediaDevices as MediaDevices & {
            getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
        }).getDisplayMedia;
        if (!getDisplayMedia) {
            throw new Error("Screen sharing is required, but this browser does not support it. Please use Chrome or Edge.");
        }
        const stream = await getDisplayMedia.call(navigator.mediaDevices, {
            video: true,
            audio: false,
        });
        const [track] = stream.getVideoTracks();
        const settings = track?.getSettings?.() as MediaTrackSettings & { displaySurface?: string };
        if (settings?.displaySurface && settings.displaySurface !== "monitor") {
            stream.getTracks().forEach((item) => item.stop());
            throw new Error("Please share your entire screen, not a tab or application window.");
        }
        screenStreamRef.current = stream;
        setScreenReady(true);
    }

    async function begin() {
        if (gateState === "checking") return;
        setGateState("checking");
        setError("");
        try {
            assertDesktopDevice();
            await requestCameraPreview();
        } catch (err) {
            stopGateMedia();
            setGateState("error");
            setError(err instanceof Error ? err.message : "Camera access is required. Please enable camera permissions in your browser and try again.");
            return;
        }

        try {
            await requestHeadsetAudio();
        } catch (err) {
            stopGateMedia();
            setGateState("error");
            setError(err instanceof Error ? err.message : "Earbuds/headset microphone access is required before starting this OA.");
            return;
        }

        try {
            await requestScreenShare();
        } catch (err) {
            stopGateMedia();
            setGateState("error");
            setError(err instanceof Error ? err.message : "Screen sharing is required. Please share your full screen to continue.");
            return;
        }

        try {
            await requestFullscreen();
            setFullscreenReady(true);
        } catch {
            stopGateMedia();
            setGateState("error");
            setError("Fullscreen is required to begin. Please allow fullscreen and try again.");
            return;
        }

        try {
            const payload = await api.post<StartResponse>(`/secure-oa/sessions/${round.roundId}/start`, {
                client_fingerprint: await clientFingerprint(),
                user_agent: navigator.userAgent,
            }, token);
            previewStreamRef.current?.getTracks().forEach((track) => track.stop());
            previewStreamRef.current = null;
            audioStreamRef.current?.getTracks().forEach((track) => track.stop());
            audioStreamRef.current = null;
            setStarted(payload);
            setGateState("started");
        } catch (err) {
            stopGateMedia();
            if (document.fullscreenElement) {
                void document.exitFullscreen().catch(() => { });
            }
            const apiBody = err instanceof ApiError ? (err.body as any) : {};
            const code = apiBody?.code || "";
            const sessionStatus = apiBody?.sessionStatus || "";
            setGateState("error");
            setError(
                code === "multi_session_attempt"
                    ? "Another assessment session is active in another tab or device. Please close other sessions and try again."
                    : code === "secure_oa_already_submitted" || sessionStatus === "submitted"
                        ? "This assessment has already been submitted."
                        : code === "secure_oa_session_closed" || code === "session_not_active" || ["terminated", "abandoned"].includes(sessionStatus)
                            ? "Your previous assessment session ended unexpectedly. Please contact your recruiter to request a new attempt."
                    : err instanceof ApiError
                        ? err.message
                        : "Could not start this online assessment."
            );
        }
    }

    if (started && gateState === "started") {
        return (
            <ProctoredAssessmentSession
                round={round}
                sessionId={started.sessionId}
                rulesPublic={started.rulesPublic}
                token={token}
                identity={identity}
                screenStream={screenStreamRef.current}
                onExit={onExit}
                onSubmitted={onSubmitted}
            />
        );
    }

    return (
        <div className="fixed inset-0 z-[180] bg-slate-100 text-slate-950 dark:bg-lc-bg dark:text-white">
            <div className="mx-auto flex h-full max-w-[1800px] flex-col bg-white shadow-2xl dark:bg-lc-bg">
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                    <div className="flex items-center gap-4">
                        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 font-nunito text-lg font-black text-primary">P</div>
                        <div>
                            <p className="font-nunito text-base font-extrabold leading-tight">{assessment.title}</p>
                            <p className="text-xs font-bold leading-tight text-slate-500 dark:text-slate-400">{round.job.companyName} - Secure online assessment</p>
                        </div>
                    </div>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-extrabold text-slate-600 dark:border-lc-border dark:text-slate-300">Round information</span>
                </header>

                <section className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
                    <div className="overflow-y-auto p-5 pr-6 lg:p-7 lg:pr-8">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">System permissions setup</p>
                        <h1 className="mt-1 font-nunito text-3xl font-extrabold leading-tight">System Permissions Setup</h1>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Activate checks that maintain the integrity of your test.</p>

                        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                            <PermissionStep complete icon="devices" title="Desktop device check" body="Verifies the assessment is being attempted on a laptop or desktop." />
                            <PermissionStep complete={cameraReady} active={!cameraReady} icon="videocam" title="Camera access" body="Required for face verification and object detection during the assessment." />
                            <PermissionStep complete={audioReady} active={cameraReady && !audioReady} icon="mic" title="Earbuds and microphone check" body={headsetName || "Connect wired or Bluetooth earbuds/headset before starting. Built-in microphone is not accepted."} />
                            <PermissionStep complete={screenReady} active={audioReady && !screenReady} icon="screen_share" title="Screen sharing access" body="Required to track the assessment screen. We do not store full screen video in the database." />
                            <PermissionStep complete={fullscreenReady} active={screenReady && !fullscreenReady} icon="fullscreen" title="Fullscreen mode" body="Locks the assessment into fullscreen. Exits count as integrity warnings." />
                        </div>

                        <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                            <p className="font-extrabold text-slate-900 dark:text-white">Please note,</p>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                <li>You are attempting this assessment on a desktop/laptop, not a mobile device.</li>
                                <li>Mockr can access camera snapshots, proctoring events, and screen-share status for integrity review.</li>
                                <li>Phones, books, extra laptops, multiple faces, developer tools, or tab switching count as warnings.</li>
                                <li>At {LOCAL_AUTO_SUBMIT_LIMIT} warnings, the assessment submits automatically.</li>
                            </ul>
                        </div>
                    </div>

                    <aside className="overflow-y-auto border-t border-slate-200 p-6 dark:border-lc-border lg:border-l lg:border-t-0">
                        <h2 className="flex items-center gap-2 font-nunito text-2xl font-extrabold leading-tight">
                            <span className="material-symbols-outlined text-primary">tips_and_updates</span>
                            Important Instructions
                        </h2>
                        <div className="mt-6 grid gap-4 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                            <InstructionBlock title="For Camera and Face Verification" items={[
                                "Use good lighting and keep your face clearly visible.",
                                "Only one person should be visible in the frame.",
                                "Phone, book, TV, or another laptop in frame will count as an integrity warning.",
                            ]} />
                            <InstructionBlock title="For Audio and Earbuds" items={[
                                "Connect wired or Bluetooth earbuds/headset before starting.",
                                "Select the headset microphone in your browser prompt.",
                                "This gate is required for upcoming AI-interview follow-up rounds.",
                            ]} />
                            <InstructionBlock title="For Screen Sharing and Fullscreen" items={[
                                "Share your full screen, not another tab or window.",
                                "Do not stop screen sharing during the assessment.",
                                "Do not exit fullscreen or switch applications.",
                            ]} />
                        </div>
                    </aside>
                </section>

                <footer className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-t border-slate-200 px-6 pl-24 dark:border-lc-border">
                    <button type="button" onClick={onExit} className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 px-5 text-sm font-extrabold text-slate-600 hover:border-primary hover:text-primary dark:border-lc-border dark:text-slate-300">
                        Cancel
                    </button>
                    <div className="flex min-w-0 flex-1 flex-col">
                        {error ? (
                            <p className="text-sm font-bold text-red-600 dark:text-red-300">{error}</p>
                        ) : (
                            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{cameraReady && audioReady && screenReady && fullscreenReady ? "All checks passed. You can start the assessment." : "Click the button to run all required checks."}</p>
                        )}
                        <p className="truncate text-xs font-semibold text-slate-400">{displayIdentity(identity) || identity.name}</p>
                    </div>
                    <button
                        type="button"
                        onClick={begin}
                        disabled={gateState === "checking"}
                        className="inline-flex h-11 min-w-[220px] items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-extrabold text-white shadow-lg shadow-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className="material-symbols-outlined text-[18px]">verified_user</span>
                        {gateState === "checking" ? "Checking..." : cameraReady && audioReady && screenReady && fullscreenReady ? "I understand, proceed" : "Run system checks"}
                    </button>
                </footer>

                <div className={`fixed bottom-20 right-6 z-[185] overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-2xl transition ${cameraReady ? "w-64 opacity-100" : "pointer-events-none w-64 opacity-0"} dark:border-lc-border`}>
                    <video ref={previewRef} muted playsInline className="aspect-[16/10] w-full object-cover" />
                    <div className="flex items-center justify-between bg-slate-950 px-3 py-2 text-xs font-extrabold text-white">
                        <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-400" /> Camera ready</span>
                        <span>{identity.name}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PermissionStep({ complete, active, icon, title, body }: { complete: boolean; active?: boolean; icon: string; title: string; body: string }) {
    return (
        <div className={`flex min-h-[92px] gap-4 border-b border-slate-200 p-4 last:border-b-0 dark:border-lc-border ${active ? "bg-primary/5 ring-1 ring-inset ring-primary" : ""}`}>
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-full border ${complete ? "border-emerald-500 text-emerald-600" : active ? "border-primary text-primary" : "border-slate-200 bg-slate-50 text-slate-500 dark:border-lc-border dark:bg-lc-hover"}`}>
                <span className="material-symbols-outlined block translate-y-px text-[22px] leading-none">
                    {complete ? "check" : icon}
                </span>
            </span>
            <div className="min-w-0 pt-1">
                <p className="font-nunito text-base font-extrabold">{title}</p>
                <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{body}</p>
            </div>
        </div>
    );
}

function InstructionBlock({ title, items }: { title: string; items: string[] }) {
    return (
        <div>
            <p className="font-extrabold text-slate-900 dark:text-white">{title}</p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
                {items.map((item) => <li key={item}>{item}</li>)}
            </ul>
        </div>
    );
}

function ProctoredAssessmentSession({
    round,
    sessionId,
    rulesPublic,
    token,
    identity,
    screenStream,
    onExit,
    onSubmitted,
}: {
    round: ScheduledOnlineAssessmentRound;
    sessionId: string;
    rulesPublic: RulesPublic;
    token: string;
    identity: CandidateIdentity;
    screenStream: MediaStream | null;
    onExit: () => void;
    onSubmitted: () => void;
}) {
    const assessment = round.onlineAssessment!;
    const questions = useMemo(
        () => [...(assessment.questions || [])].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
        [assessment.questions]
    );
    const editorRootRef = useRef<HTMLDivElement | null>(null);
    const clientRef = useRef<ProctoringClient | null>(null);
    const thumbnailRef = useRef<HTMLVideoElement | null>(null);
    const thumbnailStreamRef = useRef<MediaStream | null>(null);
    const toastThrottleRef = useRef<Record<string, number>>({});
    const questionStartedAtRef = useRef(Date.now());
    const [status, setStatus] = useState<ProctoringClientStatus>("starting");
    const [queueSize, setQueueSize] = useState(0);
    const [warnings, setWarnings] = useState(0);
    const [localViolationCount, setLocalViolationCount] = useState(0);
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [terminatedReason, setTerminatedReason] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [answerLanguages, setAnswerLanguages] = useState<Record<string, string>>({});
    const [timeSpentByQuestion, setTimeSpentByQuestion] = useState<Record<string, number>>({});
    const [questionRemaining, setQuestionRemaining] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [previewCollapsed, setPreviewCollapsed] = useState(false);
    const [ideViolationCount, setIdeViolationCount] = useState(0);
    const [screenShareLive, setScreenShareLive] = useState(Boolean(screenStream?.active));
    const [questionSidebarCollapsed, setQuestionSidebarCollapsed] = useState(false);
    const activeQuestion = questions[activeIndex] || null;
    const activeUsesContestIde = activeQuestion ? canUseContestIde(activeQuestion) : false;
    const activeUsesSqlIde = activeQuestion ? canUseSqlIde(activeQuestion) : false;
    const activeUsesEmbeddedIde = activeUsesContestIde || activeUsesSqlIde;
    const currentWarningBudget = Math.max(warnings + localViolationCount, ideViolationCount);

    useEffect(() => {
        const startPreview = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                thumbnailStreamRef.current = stream;
                if (thumbnailRef.current) {
                    thumbnailRef.current.srcObject = stream;
                    await thumbnailRef.current.play().catch(() => { });
                }
            } catch {
                // The proctoring client owns the required camera path; this thumbnail is best-effort.
            }
        };
        void startPreview();
        return () => {
            thumbnailStreamRef.current?.getTracks().forEach((track) => track.stop());
        };
    }, []);

    useEffect(() => {
        if (!editorRootRef.current || clientRef.current) return;
        const client = createProctoringClient({
            onQueueSizeChange: setQueueSize,
        });
        clientRef.current = client;
        const offStatus = client.onStatusChange(setStatus);
        const offTerminate = client.onTerminate((reason) => {
            setTerminatedReason(reason);
            setStatus("terminated");
        });
        const offEvent = client.onEvent((event) => {
            if (warningEventTypes.has(event.event_type)) {
                setWarnings((value) => value + 1);
            }
            maybeToast(event);
            if (event.event_type === "fullscreen_exit") {
                void document.documentElement.requestFullscreen().catch(() => { });
            }
        });

        client.start({
            sessionId,
            jwt: token,
            rulesPublic,
            editorRoot: editorRootRef.current,
        }).catch(() => {
            setTerminatedReason("webcam_revoked");
            setStatus("terminated");
        });

        return () => {
            offStatus();
            offTerminate();
            offEvent();
            void client.stop();
            clientRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, token, rulesPublic.heartbeat_interval_ms, rulesPublic.snapshot_interval_ms]);

    useEffect(() => {
        if (!screenStream) return;
        const [track] = screenStream.getVideoTracks();
        if (!track) return;
        setScreenShareLive(track.readyState === "live");
        const handleEnded = () => {
            setScreenShareLive(false);
            recordLocalViolation("screen_share_stopped");
        };
        track.addEventListener("ended", handleEnded);
        return () => track.removeEventListener("ended", handleEnded);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screenStream]);

    useEffect(() => {
        if (!activeQuestion) {
            setQuestionRemaining(0);
            return;
        }
        const total = questionSeconds(activeQuestion, assessment.durationMinutes, questions.length || assessment.questionCount);
        questionStartedAtRef.current = Date.now();
        setQuestionRemaining(total);
        const timer = window.setInterval(() => {
            const elapsed = Math.floor((Date.now() - questionStartedAtRef.current) / 1000);
            const remaining = Math.max(0, total - elapsed);
            setQuestionRemaining(remaining);
            if (remaining <= 0) {
                window.clearInterval(timer);
                void handleQuestionTimeExpired();
            }
        }, 1000);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeQuestion?.id]);

    useEffect(() => {
        if (currentWarningBudget >= LOCAL_AUTO_SUBMIT_LIMIT && !submitting && !terminatedReason) {
            pushToast(`Integrity warning limit reached. Submitting assessment automatically.`);
            void submit();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentWarningBudget, submitting, terminatedReason]);

    useEffect(() => {
        const handler = (event: BeforeUnloadEvent) => {
            if (status !== "running" || submitting) return;
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [status, submitting]);

    useEffect(() => {
        const handler = (event: MessageEvent<SecureOaIdeMessage>) => {
            if (event.origin !== window.location.origin) return;
            const message = event.data;
            if (!message || message.sessionId !== sessionId || !message.questionId) return;

            if ("code" in message && typeof message.code === "string") {
                setAnswers((current) => ({ ...current, [message.questionId!]: message.code || "" }));
            }
            if ("language" in message && typeof message.language === "string") {
                setAnswerLanguages((current) => ({ ...current, [message.questionId!]: message.language || "" }));
            }

            if (message.type === "secure-oa:violation") {
                setIdeViolationCount(message.violationCount || 0);
                const threshold = message.threshold || 5;
                pushToast(`Integrity warning ${message.violationCount || 1}/${threshold}. ${violationLabel(message.reason || "policy_violation")}`);
            }

            if (message.type === "secure-oa:auto-submit" || message.type === "secure-oa:submit-request") {
                void submit();
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, questions, submitting, terminatedReason]);

    function maybeToast(event: ProctoringEventInput) {
        const message = event.event_type === "object_detected"
            ? `Object detected (${Math.round(event.payload.confidence * 100)}%). Capturing this frame for review.`
            : toastCopy[event.event_type];
        if (!message) return;
        const now = Date.now();
        const last = toastThrottleRef.current[event.event_type] || 0;
        if (now - last < 15_000) return;
        toastThrottleRef.current[event.event_type] = now;
        pushToast(message);
    }

    function pushToast(message: string) {
        const now = Date.now();
        const id = now + Math.random();
        setToasts((current) => [{ id, message }, ...current].slice(0, 3));
        window.setTimeout(() => {
            setToasts((current) => current.filter((toast) => toast.id !== id));
        }, 5000);
    }

    function recordLocalViolation(reason: string) {
        setLocalViolationCount((current) => {
            const next = current + 1;
            pushToast(`Integrity warning ${Math.min(next, LOCAL_AUTO_SUBMIT_LIMIT)}/${LOCAL_AUTO_SUBMIT_LIMIT}. ${violationLabel(reason)}`);
            return next;
        });
    }

    function timeSpentSnapshot() {
        const next = { ...timeSpentByQuestion };
        const current = questions[activeIndex];
        if (current) {
            const elapsed = Math.max(0, Math.round((Date.now() - questionStartedAtRef.current) / 1000));
            const limit = questionSeconds(current, assessment.durationMinutes, questions.length || assessment.questionCount);
            next[current.id] = Math.min(limit, (next[current.id] || 0) + elapsed);
        }
        return next;
    }

    function goToQuestion(index: number) {
        if (index === activeIndex || index < 0 || index >= questions.length) return;
        const spent = timeSpentSnapshot();
        setTimeSpentByQuestion(spent);
        setActiveIndex(index);
    }

    async function handleQuestionTimeExpired() {
        const current = questions[activeIndex];
        if (!current || submitting || terminatedReason) return;
        const spent = timeSpentSnapshot();
        setTimeSpentByQuestion(spent);
        if (activeIndex < questions.length - 1) {
            pushToast(`Time is over for Question ${activeIndex + 1}. Moving to the next question.`);
            setActiveIndex((index) => Math.min(index + 1, questions.length - 1));
            return;
        }
        pushToast("Time is over for the final question. Submitting assessment.");
        await submit();
    }

    async function submit() {
        if (submitting || terminatedReason) return;
        setSubmitting(true);
        setSubmitError("");
        try {
            const spentSnapshot = timeSpentSnapshot();
            setTimeSpentByQuestion(spentSnapshot);
            const answerPayload = questions.map((question) => ({
                questionId: question.id,
                answer: answers[question.id] || "",
                language: answerLanguages[question.id] || null,
                timeSpentSeconds: spentSnapshot[question.id] || 0,
            }));
            await clientRef.current?.stop();
            await api.post(`/secure-oa/sessions/${sessionId}/submit`, { answers: answerPayload }, token);
            onSubmitted();
            onExit();
        } catch (err) {
            const code = err instanceof ApiError ? (err.body as any)?.code : "";
            const sessionStatus = err instanceof ApiError ? (err.body as any)?.sessionStatus : "";
            if (code === "session_not_active" && sessionStatus === "submitted") {
                onSubmitted();
                onExit();
                return;
            }
            if (code === "session_not_active") {
                setTerminatedReason("auto_rule_violation");
                setStatus("terminated");
                return;
            }
            setSubmitError(err instanceof ApiError ? err.message : "Could not submit this assessment.");
            setSubmitting(false);
        }
    }

    if (terminatedReason) {
        return <TerminationScreen reason={terminatedReason} onExit={onExit} />;
    }

    const monitoringLabel = queueSize > 20 ? "Connection unstable" : status === "running" ? "Monitoring active" : status === "starting" ? "Starting..." : "Monitoring paused";
    const monitoringColor = queueSize > 20 ? "bg-amber-400" : status === "running" ? "bg-emerald-400" : "bg-slate-400";

    return (
        <div className="fixed inset-0 z-[180] bg-[#FAFBFC] text-slate-950 dark:bg-lc-bg dark:text-white">
            <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">{assessment.title}</p>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{formatDuration(assessment.durationMinutes)} - {questions.length || assessment.questionCount || 0} questions</p>
                </div>
                <div className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-700 dark:bg-lc-hover dark:text-slate-200 sm:flex">
                    <span className={`size-2 rounded-full ${monitoringColor}`} />
                    {monitoringLabel}
                </div>
                <div className="flex items-center gap-2">
                    <span className={`hidden rounded-full px-3 py-1.5 text-xs font-extrabold sm:inline-flex ${screenShareLive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-200"}`}>
                        Screen {screenShareLive ? "shared" : "stopped"}
                    </span>
                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                        Warnings {Math.min(currentWarningBudget, LOCAL_AUTO_SUBMIT_LIMIT)}{currentWarningBudget > LOCAL_AUTO_SUBMIT_LIMIT ? "+" : ""} / {LOCAL_AUTO_SUBMIT_LIMIT}
                    </span>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={submitting}
                        className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className="material-symbols-outlined text-[18px]">send</span>
                        {submitting ? "Submitting..." : "Submit"}
                    </button>
                </div>
            </header>

            <div className="flex h-12 items-center justify-center border-b border-primary/20 bg-primary/10 px-4 text-sm font-extrabold text-primary">
                <span className="material-symbols-outlined mr-2 text-[18px]">timer</span>
                Question {activeQuestion ? activeIndex + 1 : 0} Time Left&nbsp;
                <span className="font-mono text-base">{formatClock(questionRemaining)}</span>
            </div>

            {queueSize > 20 && (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
                    Connection unstable. Your work is saved locally and will sync when the connection recovers.
                </div>
            )}

            <div className={`relative grid h-[calc(100vh-6.5rem)] overflow-hidden transition-[grid-template-columns] duration-200 ${questionSidebarCollapsed ? "lg:grid-cols-[76px_minmax(0,1fr)]" : "lg:grid-cols-[290px_minmax(0,1fr)]"}`}>
                <WatermarkOverlay text={displayIdentity(identity) || identity.name} />
                <aside className="hidden overflow-y-auto border-r border-slate-200 bg-white p-3 dark:border-lc-border dark:bg-lc-surface lg:block">
                    <div className={`flex items-center ${questionSidebarCollapsed ? "justify-center" : "justify-between gap-3"}`}>
                        {!questionSidebarCollapsed && (
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Questions</p>
                        )}
                        <button
                            type="button"
                            onClick={() => setQuestionSidebarCollapsed((value) => !value)}
                            aria-label={questionSidebarCollapsed ? "Expand questions sidebar" : "Collapse questions sidebar"}
                            className="grid size-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:border-primary/40 hover:text-primary dark:border-lc-border dark:text-slate-300"
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                {questionSidebarCollapsed ? "chevron_right" : "chevron_left"}
                            </span>
                        </button>
                    </div>

                    {questionSidebarCollapsed ? (
                        <div className="mt-4 grid justify-items-center gap-2">
                            {questions.length ? questions.map((question, index) => (
                                <button
                                    key={question.id}
                                    type="button"
                                    onClick={() => goToQuestion(index)}
                                    title={`Question ${index + 1}: ${question.text}`}
                                    className={`grid size-11 place-items-center rounded-xl border text-sm font-extrabold transition ${index === activeIndex ? "border-primary bg-primary text-white shadow-lg shadow-primary/20" : "border-slate-200 text-slate-600 hover:border-primary/40 hover:text-primary dark:border-lc-border dark:text-slate-300"}`}
                                >
                                    {index + 1}
                                </button>
                            )) : (
                                <div className="grid size-11 place-items-center rounded-xl border border-dashed border-slate-200 text-xs font-bold text-slate-400 dark:border-lc-border">
                                    0
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="mt-4 grid gap-2">
                            {questions.length ? questions.map((question, index) => (
                                <button
                                    key={question.id}
                                    type="button"
                                    onClick={() => goToQuestion(index)}
                                    className={`rounded-lg border p-3 text-left transition ${index === activeIndex ? "border-primary bg-primary/5" : "border-slate-200 hover:border-primary/40 dark:border-lc-border"}`}
                                >
                                    <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-primary">Question {index + 1}</span>
                                    <span className="mt-1 block line-clamp-2 text-sm font-extrabold">{question.text}</span>
                                    <span className="mt-2 flex flex-wrap gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                        <span>{formatDuration(question.timeLimitMinutes)}</span>
                                        {normalizedQuestionType(question) === "sql" && <span className="text-teal-600 dark:text-teal-300">SQL</span>}
                                        {question.aiInterviewEnabled && <span className="text-emerald-600 dark:text-emerald-300">AI follow-up</span>}
                                    </span>
                                </button>
                            )) : (
                                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                    The company did not publish question metadata.
                                </div>
                            )}
                        </div>
                    )}
                </aside>

                <main ref={editorRootRef} className={activeUsesEmbeddedIde ? "overflow-hidden bg-white dark:bg-lc-bg" : "overflow-y-auto p-4 sm:p-6"}>
                    <section className={activeUsesEmbeddedIde ? "h-full" : "mx-auto max-w-5xl"}>
                        {activeQuestion ? (
                            <div className={activeUsesEmbeddedIde ? "h-full bg-white dark:bg-lc-bg" : "rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface"}>
                                {activeUsesContestIde ? (
                                    <SecureOaContestIde
                                        key={`${sessionId}-${activeQuestion.id}`}
                                        questionId={resolveIdeQuestionId(activeQuestion)}
                                        contestId={`secure-oa-${sessionId}`}
                                        mode="secure_oa"
                                        oaSessionId={sessionId}
                                        oaQuestionKey={activeQuestion.id}
                                        autoSubmitLimit={LOCAL_AUTO_SUBMIT_LIMIT}
                                        embedded
                                    />
                                ) : activeUsesSqlIde ? (
                                    <SecureOaSqlIde
                                        key={`${sessionId}-${activeQuestion.id}`}
                                        questionId={resolveIdeQuestionId(activeQuestion)}
                                        oaSessionId={sessionId}
                                        oaQuestionKey={activeQuestion.id}
                                    />
                                ) : (
                                    <>
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Question {activeIndex + 1}</p>
                                                <h1 className="mt-2 font-nunito text-2xl font-extrabold">{activeQuestion.text}</h1>
                                                <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                    {activeQuestion.type || "OA"}{activeQuestion.difficulty ? ` - ${activeQuestion.difficulty}` : ""} - {formatDuration(activeQuestion.timeLimitMinutes)}
                                                </p>
                                            </div>
                                            {activeQuestion.aiInterviewEnabled && (
                                                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                                                    AI follow-up after this question
                                                </span>
                                            )}
                                        </div>
                                        <textarea
                                            value={answers[activeQuestion.id] || ""}
                                            onChange={(event) => setAnswers((current) => ({ ...current, [activeQuestion.id]: event.target.value }))}
                                            className="mt-6 min-h-[430px] w-full resize-y rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-50 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border"
                                            spellCheck={false}
                                            placeholder="Write your solution, SQL, explanation, or system-design answer here."
                                        />
                                        <div className="mt-4 flex flex-wrap justify-between gap-3">
                                            <button type="button" onClick={() => goToQuestion(Math.max(0, activeIndex - 1))} disabled={activeIndex === 0} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-extrabold text-slate-600 disabled:opacity-40 dark:border-lc-border dark:text-slate-300">
                                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                                Previous
                                            </button>
                                            <button type="button" onClick={() => goToQuestion(Math.min(questions.length - 1, activeIndex + 1))} disabled={activeIndex >= questions.length - 1} className="inline-flex h-10 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 text-sm font-extrabold text-primary disabled:opacity-40">
                                                Next
                                                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                                            </button>
                                        </div>
                                    </>
                                )}
                                {submitError && <p className="mt-4 text-sm font-bold text-red-600 dark:text-red-300">{submitError}</p>}
                            </div>
                        ) : (
                            <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed border-slate-200 bg-white text-center dark:border-lc-border dark:bg-lc-surface">
                                <div>
                                    <span className="material-symbols-outlined text-5xl text-slate-300">quiz</span>
                                    <h2 className="mt-3 font-nunito text-2xl font-extrabold">Assessment shell ready</h2>
                                    <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">No question metadata is available for this OA yet.</p>
                                </div>
                            </div>
                        )}
                    </section>
                </main>
            </div>

            <div className={`fixed bottom-5 right-5 z-30 ${previewCollapsed ? "" : "w-44"}`}>
                {previewCollapsed ? (
                    <button type="button" onClick={() => setPreviewCollapsed(false)} className="grid size-12 place-items-center rounded-full bg-slate-950 text-white shadow-xl">
                        <span className="material-symbols-outlined">videocam</span>
                    </button>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-emerald-300 bg-slate-950 shadow-2xl ring-4 ring-emerald-400/20">
                        <div className="flex items-center justify-between px-3 py-2 text-xs font-extrabold text-white">
                            <span className="flex items-center gap-2"><span className="size-2 animate-pulse rounded-full bg-emerald-400" /> Camera</span>
                            <button type="button" onClick={() => setPreviewCollapsed(true)} aria-label="Collapse camera preview">
                                <span className="material-symbols-outlined text-[16px]">close_fullscreen</span>
                            </button>
                        </div>
                        <video ref={thumbnailRef} muted playsInline className="aspect-[4/3] w-full bg-black object-cover" />
                    </div>
                )}
            </div>

            <div className="fixed right-5 top-20 z-40 grid max-w-sm gap-2">
                {toasts.map((toast) => (
                    <div key={toast.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-xl dark:border-lc-border dark:bg-lc-surface dark:text-slate-100">
                        {toast.message}
                    </div>
                ))}
            </div>
        </div>
    );
}

function WatermarkOverlay({ text }: { text: string }) {
    if (!text) return null;
    const items = Array.from({ length: 40 });
    return (
        <div className="pointer-events-none absolute inset-0 z-10 grid grid-cols-4 gap-x-10 gap-y-8 overflow-hidden p-8 opacity-[0.09]">
            {items.map((_, index) => (
                <span
                    key={index}
                    className="select-none whitespace-pre-line text-center text-sm font-extrabold leading-6 text-slate-700 dark:text-white"
                    style={{ transform: "rotate(-18deg)" }}
                >
                    {text}
                </span>
            ))}
        </div>
    );
}

function TerminationScreen({ reason, onExit }: { reason: string; onExit: () => void }) {
    return (
        <div className="fixed inset-0 z-[190] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
            <section className="w-full max-w-xl rounded-xl border border-red-200 bg-white p-8 text-center shadow-2xl dark:border-red-400/30 dark:bg-lc-surface">
                <span className="material-symbols-outlined mx-auto grid size-16 place-items-center rounded-full bg-red-50 text-4xl text-red-600 dark:bg-red-400/10 dark:text-red-300">cancel</span>
                <h1 className="mt-5 font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">Your assessment has ended.</h1>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{terminationMessage(reason)}</p>
                <p className="mt-4 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                    If you believe this was a mistake, please contact your recruiter. Do not start the assessment again; it will not be accepted.
                </p>
                <button type="button" onClick={onExit} className="mt-7 inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-extrabold text-white shadow-lg shadow-primary/20">
                    Return to dashboard
                </button>
            </section>
        </div>
    );
}
