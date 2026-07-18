"use client";

import type { Dispatch, SetStateAction } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SKILLS, normalizeSkillName } from "@interviewforge/shared";
import type {
    Education,
    Experience,
    Featured,
    JobProfile,
    Project,
    ResumeItem,
    Skill,
    UserProfile,
} from "./job-profile-builder";
import { autofillFromResume, extractFields, fetchSpeech, improveText, transcribeAudio, type AutofillProfile, type ImproveField } from "@/lib/job-profile-ai";

function uid() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return Math.random().toString(36).slice(2);
}

const CODING_FIELDS = [
    { key: "leetcodeUrl", label: "LeetCode" },
    { key: "geeksforgeeksUrl", label: "GeeksforGeeks" },
    { key: "codeforcesUrl", label: "Codeforces" },
    { key: "codechefUrl", label: "CodeChef" },
] as const;

type StepKey =
    | "welcome"
    | "handle"
    | "basics"
    | "location"
    | "openTo"
    | "about"
    | "experience"
    | "education"
    | "skills"
    | "projects"
    | "featured"
    | "coding"
    | "resume"
    | "github"
    | "done";

const STEPS: { key: StepKey; title: string; icon: string; optional?: boolean }[] = [
    { key: "welcome", title: "Welcome", icon: "waving_hand" },
    { key: "handle", title: "Unlock your profile link", icon: "link" },
    { key: "basics", title: "Make your first impression", icon: "person" },
    { key: "location", title: "Put yourself on the map", icon: "location_on" },
    { key: "openTo", title: "Set your target", icon: "ads_click" },
    { key: "about", title: "Tell your story", icon: "auto_stories" },
    { key: "experience", title: "Prove your experience", icon: "work" },
    { key: "education", title: "Add your roots", icon: "school" },
    { key: "skills", title: "Add your superpowers", icon: "bolt" },
    { key: "projects", title: "Show your best work", icon: "rocket_launch" },
    { key: "featured", title: "Pin a highlight", icon: "star", optional: true },
    { key: "coding", title: "Unlock recruiter trust", icon: "verified" },
    { key: "resume", title: "Arm recruiters with your resume", icon: "description" },
    { key: "github", title: "Connect your code", icon: "code" },
    { key: "done", title: "You're hire-ready", icon: "emoji_events" },
];


/** A recruiter-facing completeness score (0-100), weighted by what matters. */
function computeMatchScore(
    profile: JobProfile,
    usernameReady: boolean,
    hasAvatar: boolean,
    githubConnected: boolean
): number {
    const hasCoding = CODING_FIELDS.some((f) => ((profile[f.key] as string) || "").trim());
    const parts: [boolean, number][] = [
        [usernameReady, 8],
        [hasAvatar, 5],
        [Boolean((profile.headline || "").trim()), 8],
        [Boolean((profile.city || "").trim()), 3],
        [Boolean((profile.country || "").trim()), 2],
        [Boolean((profile.industry || "").trim()), 4],
        [Boolean((profile.openTo || "").trim()), 6],
        [Boolean((profile.about || "").trim()), 12],
        [(profile.experiences?.length ?? 0) > 0, 14],
        [(profile.education?.length ?? 0) > 0, 8],
        [(profile.skills?.length ?? 0) >= 3, 10],
        [(profile.projects?.length ?? 0) > 0, 12],
        [(profile.featured?.length ?? 0) > 0, 4],
        [hasCoding, 6],
        [Boolean(profile.selectedResumeId), 8],
        [githubConnected, 6],
    ];
    const total = parts.reduce((sum, [, w]) => sum + w, 0);
    const earned = parts.reduce((sum, [ok, w]) => sum + (ok ? w : 0), 0);
    return Math.round((earned / total) * 100);
}

// ── Voice guide hook (Grok TTS speak + Deepgram STT listen) ─────────────────
function useVoiceGuide(token: string | undefined, enabled: boolean) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const urlRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const [speaking, setSpeaking] = useState(false);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
        }
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        }
        setSpeaking(false);
    }, []);

    const speak = useCallback(
        async (text: string) => {
            if (!enabled || !token || !text.trim()) return;
            stop();
            const controller = new AbortController();
            abortRef.current = controller;
            try {
                const url = await fetchSpeech(text, token, controller.signal);
                if (controller.signal.aborted) {
                    URL.revokeObjectURL(url);
                    return;
                }
                urlRef.current = url;
                const audio = new Audio(url);
                audioRef.current = audio;
                audio.onended = () => setSpeaking(false);
                audio.onpause = () => setSpeaking(false);
                setSpeaking(true);
                await audio.play().catch(() => setSpeaking(false));
            } catch {
                setSpeaking(false);
            }
        },
        [enabled, token, stop]
    );

    useEffect(() => () => stop(), [stop]);

    return { speak, stop, speaking };
}

// ── Hands-free dictation (auto-listen → AI extraction → fill every field) ────
type VoiceFieldMeta = { label: string; hint?: string; set: (v: string) => void };

const DictationCtx = createContext<{
    register: (key: string, meta: VoiceFieldMeta) => void;
    unregister: (key: string) => void;
    listening: boolean;
    filledKeys: string[];
} | null>(null);

function useDictation(
    token: string | undefined,
    onResult: (text: string) => void,
    onSpeechEnd: (hadSpeech: boolean) => void
) {
    const [listening, setListening] = useState(false);
    const [working, setWorking] = useState(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const hadSpeechRef = useRef(false);
    const onResultRef = useRef(onResult);
    const onSpeechEndRef = useRef(onSpeechEnd);
    onResultRef.current = onResult;
    onSpeechEndRef.current = onSpeechEnd;

    const cleanupAudio = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        ctxRef.current?.close().catch(() => {});
        ctxRef.current = null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    }, []);

    const stop = useCallback(() => {
        if (recorderRef.current && recorderRef.current.state === "recording") recorderRef.current.stop();
    }, []);

    const start = useCallback(async () => {
        if (!token || recorderRef.current?.state === "recording") return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
            const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
            recorderRef.current = recorder;
            chunksRef.current = [];
            hadSpeechRef.current = false;
            recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
            recorder.onstop = async () => {
                cleanupAudio();
                setListening(false);
                const hadSpeech = hadSpeechRef.current;
                const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
                recorderRef.current = null;
                if (!hadSpeech || blob.size < 1400) {
                    onSpeechEndRef.current(false);
                    return;
                }
                setWorking(true);
                try {
                    const text = await transcribeAudio(blob, token);
                    if (text) onResultRef.current(text);
                } catch {
                    /* silent — user can type */
                } finally {
                    setWorking(false);
                    onSpeechEndRef.current(true);
                }
            };
            recorder.start();
            setListening(true);

            // Silence detection: stop after ~1.3s of quiet once speech was heard,
            // or after 7s if the user never speaks.
            const audioCtx = new AudioContext();
            ctxRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            const data = new Uint8Array(analyser.fftSize);
            let silenceStart: number | null = null;
            let waitStart: number | null = null;
            const tick = () => {
                analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (let i = 0; i < data.length; i++) {
                    const x = (data[i] - 128) / 128;
                    sum += x * x;
                }
                const rms = Math.sqrt(sum / data.length);
                const now = performance.now();
                if (rms > 0.035) {
                    hadSpeechRef.current = true;
                    silenceStart = null;
                    waitStart = null;
                } else if (hadSpeechRef.current) {
                    if (silenceStart == null) silenceStart = now;
                    else if (now - silenceStart > 1300) {
                        stop();
                        return;
                    }
                } else {
                    if (waitStart == null) waitStart = now;
                    else if (now - waitStart > 7000) {
                        stop();
                        return;
                    }
                }
                rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
        } catch {
            cleanupAudio();
            setListening(false);
        }
    }, [token, stop, cleanupAudio]);

    useEffect(
        () => () => {
            stop();
            cleanupAudio();
        },
        [stop, cleanupAudio]
    );

    return { start, stop, listening, working };
}

// ── Reusable inputs ─────────────────────────────────────────────────────────
const inputClass =
    "w-full rounded-2xl border-0 bg-[#f4f6fb] px-4 py-3.5 text-slate-950 outline-none ring-1 ring-transparent transition-all placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-primary/15 focus:shadow-[0_10px_30px_-10px_rgba(74,124,255,0.4)] dark:bg-lc-hover dark:text-white";

/**
 * Registers a field so the hands-free AI can drop the right value into it.
 * When you speak one sentence, the extractor decides which field each value
 * belongs to; this hook is how a field says "I'm `city`, here's my setter".
 */
function useVoiceField(key: string | undefined, label: string, onChange: (v: string) => void, hint?: string) {
    const ctx = useContext(DictationCtx);
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    });
    useEffect(() => {
        if (!ctx || !key) return;
        ctx.register(key, { label, hint, set: (v) => onChangeRef.current(v) });
        return () => ctx.unregister(key);
    }, [ctx, key, label, hint]);
    const filled = Boolean(key && ctx?.filledKeys.includes(key));
    return { filled };
}

function TextInput({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    maxLength,
    autoFocus,
    voiceKey,
    voiceHint,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
    maxLength?: number;
    autoFocus?: boolean;
    voiceKey?: string;
    voiceHint?: string;
}) {
    const { filled } = useVoiceField(voiceKey, label, onChange, voiceHint);
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoFocus={autoFocus}
                placeholder={placeholder}
                maxLength={maxLength}
                className={`${inputClass} ${filled ? "border-emerald-400 ring-4 ring-emerald-400/20" : ""}`}
            />
        </label>
    );
}

function AiTextArea({
    label,
    value,
    onChange,
    placeholder,
    field,
    context,
    token,
    maxLength = 1200,
    autoFocus,
    voiceKey,
    voiceHint,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    field: ImproveField;
    context?: string;
    token?: string;
    maxLength?: number;
    autoFocus?: boolean;
    voiceKey?: string;
    voiceHint?: string;
}) {
    const [busy, setBusy] = useState(false);
    const [previous, setPrevious] = useState<string | null>(null);
    const [error, setError] = useState("");
    const { filled } = useVoiceField(voiceKey, label, onChange, voiceHint);

    const improve = async () => {
        if (!token || !value.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
            const improved = await improveText(field, value, token, context);
            setPrevious(value);
            onChange(improved);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not improve right now.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <label className="block">
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
                <div className="flex items-center gap-1.5">
                    {previous !== null && (
                        <button
                            type="button"
                            onClick={() => {
                                onChange(previous);
                                setPrevious(null);
                            }}
                            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-lc-hover"
                        >
                            <span className="material-symbols-outlined text-[16px]">undo</span>
                            Undo
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={improve}
                        disabled={busy || !value.trim() || !token}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#4A7CFF,#7c6fff)] px-3 text-xs font-bold text-white shadow-sm transition-transform hover:scale-[1.03] disabled:opacity-50"
                    >
                        <span className={`material-symbols-outlined text-[16px] ${busy ? "animate-spin" : ""}`}>
                            {busy ? "progress_activity" : "auto_awesome"}
                        </span>
                        {busy ? "Polishing" : "Improve with AI"}
                    </button>
                </div>
            </div>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoFocus={autoFocus}
                placeholder={placeholder}
                rows={5}
                maxLength={maxLength}
                className={`${inputClass} ${filled ? "border-emerald-400 ring-4 ring-emerald-400/20" : ""}`}
            />
            <div className="mt-1 flex justify-between text-xs">
                <span className="text-red-500">{error}</span>
                <span className="text-slate-400">{value.length}/{maxLength}</span>
            </div>
        </label>
    );
}

function ItemChip({
    title,
    subtitle,
    onEdit,
    onRemove,
    editing,
}: {
    title: string;
    subtitle?: string;
    onEdit?: () => void;
    onRemove: () => void;
    editing?: boolean;
}) {
    return (
        <div
            className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 transition-all ${
                editing
                    ? "bg-primary/[0.06] shadow-[0_12px_34px_-14px_rgba(74,124,255,0.5)]"
                    : "bg-emerald-50 shadow-[0_12px_34px_-16px_rgba(16,185,129,0.5)] dark:bg-emerald-400/10"
            }`}
        >
            <div className="min-w-0">
                <p className={`truncate font-bold ${editing ? "text-primary" : "text-emerald-900 dark:text-emerald-200"}`}>{title || "Untitled"}</p>
                {subtitle && <p className={`truncate text-sm ${editing ? "text-primary/70" : "text-emerald-700/80 dark:text-emerald-300/70"}`}>{subtitle}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {onEdit && (
                    <button
                        type="button"
                        onClick={onEdit}
                        aria-label="Edit"
                        title="Edit"
                        className="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-primary dark:text-slate-300 dark:hover:bg-lc-hover"
                    >
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                )}
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label="Remove"
                    title="Remove"
                    className="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-slate-300 dark:hover:bg-lc-hover"
                >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </div>
    );
}

// ── Resume autofill ─────────────────────────────────────────────────────────
function applyAutofillToProfile(setProfile: Dispatch<SetStateAction<JobProfile>>, p: AutofillProfile): string {
    setProfile((cur) => {
        const next: JobProfile = { ...cur };
        const setStr = (key: keyof JobProfile, value?: string) => {
            if (value) (next as Record<string, unknown>)[key as string] = value;
        };
        setStr("headline", p.headline);
        setStr("industry", p.industry);
        setStr("city", p.city);
        setStr("country", p.country);
        setStr("about", p.about);
        setStr("openTo", p.openTo);
        setStr("leetcodeUrl", p.leetcodeUrl);
        setStr("geeksforgeeksUrl", p.geeksforgeeksUrl);
        setStr("codeforcesUrl", p.codeforcesUrl);
        setStr("codechefUrl", p.codechefUrl);
        if (p.skills?.length) next.skills = p.skills.map((name) => ({ id: uid(), name, context: "" })).slice(0, 50);
        if (p.experiences?.length)
            next.experiences = p.experiences
                .map((e) => ({ id: uid(), title: e.title, company: e.company, employmentType: e.employmentType, startDate: e.startDate, endDate: e.endDate, location: e.location, locationType: "", description: e.description, logoUrl: "" }))
                .slice(0, 20);
        if (p.education?.length)
            next.education = p.education
                .map((e) => ({ id: uid(), school: e.school, degree: e.degree, field: e.field, startDate: e.startDate, endDate: e.endDate, logoUrl: "" }))
                .slice(0, 20);
        if (p.projects?.length)
            next.projects = p.projects
                .map((pr) => ({ id: uid(), title: pr.title, role: pr.role, startDate: pr.startDate, endDate: pr.endDate, description: pr.description, technologies: pr.technologies || [], imageUrl: "" }))
                .slice(0, 30);
        return next;
    });

    const parts: string[] = [];
    if (p.experiences?.length) parts.push(`${p.experiences.length} role${p.experiences.length > 1 ? "s" : ""}`);
    if (p.education?.length) parts.push(`${p.education.length} education`);
    if (p.projects?.length) parts.push(`${p.projects.length} project${p.projects.length > 1 ? "s" : ""}`);
    if (p.skills?.length) parts.push(`${p.skills.length} skills`);
    return parts.length
        ? `Imported ${parts.join(" · ")}. Step through to review, then publish.`
        : "Imported your details. Step through to review, then publish.";
}

function ResumeAutofill({ token, setProfile }: { token?: string; setProfile: Dispatch<SetStateAction<JobProfile>> }) {
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");
    const [error, setError] = useState("");

    const onFile = async (file?: File) => {
        if (!file || !token) return;
        setBusy(true);
        setError("");
        setMsg("");
        try {
            const p = await autofillFromResume(file, token);
            setMsg(applyAutofillToProfile(setProfile, p));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not read that resume");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mt-7 w-full max-w-lg rounded-[1.5rem] bg-primary/5 p-5 shadow-[0_18px_50px_-22px_rgba(74,124,255,0.55)]">
            <div className="flex flex-wrap items-center gap-3">
                <label
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-3xl bg-gradient-to-r from-[#4A7CFF] to-[#6B9FFF] px-6 py-3 text-sm font-extrabold text-white shadow-[0_8px_30px_rgba(74,124,255,.3)] transition-all duration-200 hover:-translate-y-0.5 ${busy ? "opacity-70" : ""}`}
                >
                    <span className={`material-symbols-outlined text-[20px] ${busy ? "animate-spin" : ""}`}>{busy ? "progress_activity" : "upload_file"}</span>
                    {busy ? "Reading your resume…" : "Autofill with resume"}
                    <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy || !token} onChange={(e) => onFile(e.target.files?.[0])} />
                </label>
                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">PDF only</span>
            </div>
            {msg && (
                <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    {msg}
                </p>
            )}
            {error && <p className="mt-3 text-sm font-semibold text-red-500">{error}</p>}
        </div>
    );
}

// ── Main onboarding component ───────────────────────────────────────────────
export function JobProfileOnboarding({
    user,
    profile,
    setProfile,
    resumes,
    token,
    usernameDraft,
    setUsernameDraft,
    usernameStatus,
    usernameReady,
    onSaveUsername,
    onUploadImage,
    onUploadAvatar,
    onUploadResume,
    onUserAvatarChange,
    githubConnected,
    githubConnecting,
    onConnectGitHub,
    saving,
    onFinish,
    onSkipToReview,
}: {
    user: UserProfile | null;
    profile: JobProfile;
    setProfile: Dispatch<SetStateAction<JobProfile>>;
    resumes: ResumeItem[];
    token?: string;
    usernameDraft: string;
    setUsernameDraft: (v: string) => void;
    usernameStatus: string;
    usernameReady: boolean;
    onSaveUsername: () => void;
    onUploadImage: (file: File) => Promise<string>;
    onUploadAvatar: (file: File) => Promise<string>;
    onUploadResume: (file: File) => Promise<ResumeItem>;
    onUserAvatarChange: (avatarUrl: string) => void;
    githubConnected: boolean;
    githubConnecting: boolean;
    onConnectGitHub: () => void;
    saving: boolean;
    onFinish: () => void;
    onSkipToReview: () => void;
}) {
    const firstName = (user?.fullName || "there").trim().split(/\s+/)[0] || "there";
    const [stepIndex, setStepIndex] = useState(0);
    const [voiceOn, setVoiceOn] = useState(true);
    const [localResumes, setLocalResumes] = useState<ResumeItem[]>(resumes);
    const [uploading, setUploading] = useState<string | null>(null);

    const [handsFree, setHandsFree] = useState(false);
    const [filledKeys, setFilledKeys] = useState<string[]>([]);
    const [voiceFieldCount, setVoiceFieldCount] = useState(0);
    const [extracting, setExtracting] = useState(false);

    const step = STEPS[stepIndex];
    const { speak, stop, speaking } = useVoiceGuide(token, voiceOn);

    const guideLine = useMemo(() => guideFor(step.key, firstName), [step.key, firstName]);

    // Registry of the current step's voice-fillable fields + hands-free plumbing.
    const fieldsRef = useRef<Map<string, VoiceFieldMeta>>(new Map());
    const handsFreeRef = useRef(handsFree);
    handsFreeRef.current = handsFree;
    const speakingRef = useRef(speaking);
    speakingRef.current = speaking;
    const tokenRef = useRef(token);
    tokenRef.current = token;
    const startRef = useRef<() => void>(() => {});
    const filledTimer = useRef<number | null>(null);

    // Give the AI a brain: one spoken sentence → the right value in each field.
    const handleTranscript = async (transcript: string) => {
        const entries = [...fieldsRef.current.entries()];
        if (!entries.length || !tokenRef.current) return;
        const fields = entries.map(([key, m]) => ({ key, label: m.label, hint: m.hint }));
        setExtracting(true);
        try {
            const values = await extractFields(transcript, fields, tokenRef.current);
            const keys = Object.keys(values);
            keys.forEach((k) => fieldsRef.current.get(k)?.set(values[k]));
            if (keys.length) {
                setFilledKeys(keys);
                if (filledTimer.current) window.clearTimeout(filledTimer.current);
                filledTimer.current = window.setTimeout(() => setFilledKeys([]), 1800);
            }
        } catch {
            /* ignore — user can type instead */
        } finally {
            setExtracting(false);
        }
    };

    const dictation = useDictation(
        token,
        (text) => {
            void handleTranscript(text);
        },
        (hadSpeech) => {
            // Re-arm so the user can keep adding; stops on its own when quiet.
            if (hadSpeech && handsFreeRef.current && !speakingRef.current && fieldsRef.current.size > 0) {
                window.setTimeout(() => startRef.current(), 900);
            }
        }
    );
    startRef.current = dictation.start;

    const register = useCallback((key: string, meta: VoiceFieldMeta) => {
        fieldsRef.current.set(key, meta);
        setVoiceFieldCount(fieldsRef.current.size);
    }, []);
    const unregister = useCallback((key: string) => {
        fieldsRef.current.delete(key);
        setVoiceFieldCount(fieldsRef.current.size);
    }, []);

    const dictationValue = useMemo(
        () => ({ register, unregister, listening: dictation.listening, filledKeys }),
        [register, unregister, dictation.listening, filledKeys]
    );

    const canVoice = voiceFieldCount > 0;

    // Speak the guide line whenever the step changes (or voice re-enabled).
    useEffect(() => {
        if (voiceOn) speak(guideLine);
        else stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stepIndex, voiceOn]);

    // Once the guide stops talking, auto-open the mic for the whole step.
    useEffect(() => {
        if (!handsFree) {
            dictation.stop();
            return;
        }
        if (!speaking && canVoice && !dictation.listening && !dictation.working && !extracting) {
            dictation.start();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speaking, handsFree, stepIndex, voiceFieldCount]);

    // Job Match Score — a live recruiter-readiness meter that ticks up as the
    // user fills things in, with a "35% → 42%" pop each time a step adds value.
    const matchScore = computeMatchScore(profile, usernameReady, Boolean(user?.avatarUrl), githubConnected);
    const stepStartScoreRef = useRef(matchScore);
    const [scorePop, setScorePop] = useState<{ from: number; to: number } | null>(null);
    const scorePopTimer = useRef<number | null>(null);

    useEffect(() => {
        // Reset the baseline whenever a new step begins.
        stepStartScoreRef.current = matchScore;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stepIndex]);

    const leaveStep = () => {
        stop();
        dictation.stop();
    };
    const advance = (delta: number) => {
        const from = stepStartScoreRef.current;
        const to = matchScore;
        if (delta > 0 && to > from) {
            if (scorePopTimer.current) window.clearTimeout(scorePopTimer.current);
            setScorePop({ from, to });
            scorePopTimer.current = window.setTimeout(() => setScorePop(null), 3000);
        }
        leaveStep();
        setStepIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
    };
    const goNext = () => advance(1);
    const goBack = () => advance(-1);

    const doUpload = async (kind: string, fn: () => Promise<void>) => {
        setUploading(kind);
        try {
            await fn();
        } catch (err) {
            window.alert(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(null);
        }
    };

    return (
        <DictationCtx.Provider value={dictationValue}>
        <div className="relative min-h-full overflow-hidden bg-gradient-to-br from-[#FAFBFC] via-white to-[#eaf2ff] dark:from-lc-bg dark:via-lc-bg dark:to-lc-bg">
            <style>{`
                @keyframes pq-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
                @keyframes pq-fade { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes pq-slide { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: translateX(0); } }
                @keyframes pq-ring { 0% { transform: scale(.9); opacity: .7; } 70% { transform: scale(1.6); opacity: 0; } 100% { opacity: 0; } }
                @keyframes pq-pop { 0% { opacity: 0; transform: translateY(6px) scale(.94); } 60% { transform: translateY(-2px) scale(1.03); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes pq-pulse { 0%,100% { opacity: .5; } 50% { opacity: .9; } }
            `}</style>

            {/* soft glow blobs — matches the app onboarding backdrop */}
            <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-70 blur-3xl dark:opacity-20" style={{ background: "radial-gradient(circle, rgba(74,124,255,.35), transparent 70%)" }} />
            <div className="pointer-events-none absolute -right-40 top-8 h-[520px] w-[520px] rounded-full opacity-60 blur-3xl dark:opacity-20" style={{ background: "radial-gradient(circle, rgba(124,111,255,.35), transparent 70%)" }} />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 h-[380px] w-[380px] rounded-full opacity-50 blur-3xl dark:opacity-10" style={{ background: "radial-gradient(circle, rgba(255,229,100,.22), transparent 70%)" }} />

            <div className="relative z-10 mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6">
                {/* Progress dots */}
                <div className="mb-6 flex items-center gap-4">
                    <div className="flex flex-1 flex-wrap items-center gap-1.5">
                        {STEPS.map((s, i) => (
                            <span
                                key={s.key}
                                className={`h-2 rounded-full transition-all duration-300 ${
                                    i === stepIndex ? "w-8 bg-primary" : i < stepIndex ? "w-2 bg-primary/50" : "w-2 bg-slate-200 dark:bg-lc-hover"
                                }`}
                            />
                        ))}
                    </div>
                    <span className="shrink-0 text-sm font-bold text-slate-500 dark:text-slate-400">{stepIndex + 1}/{STEPS.length}</span>
                    <button
                        type="button"
                        onClick={onSkipToReview}
                        className="shrink-0 rounded-full px-3 py-1.5 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-lc-hover"
                    >
                        Skip to editor
                    </button>
                </div>

                <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
                    {/* Guide / avatar */}
                    <aside className="lg:sticky lg:top-6 lg:self-start">
                        <div className="rounded-[2rem] bg-white p-5 shadow-[0_24px_70px_-22px_rgba(20,40,80,0.2)] dark:bg-lc-surface">
                            <div className="relative mx-auto flex h-52 w-full items-end justify-center">
                                <div
                                    className={`pointer-events-none absolute bottom-3 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full blur-3xl transition-colors duration-500 ${
                                        dictation.listening ? "bg-red-400/40" : speaking ? "bg-[#75f0c6]/50" : "bg-primary/25"
                                    }`}
                                    style={{ animation: "pq-pulse 3s ease-in-out infinite" }}
                                />
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src="/ai_interview_doodle_v2.png"
                                    alt="Your profile guide"
                                    className="relative h-52 w-auto object-contain object-bottom drop-shadow-2xl"
                                    style={{ animation: "pq-float 5s ease-in-out infinite" }}
                                />
                            </div>

                            {/* Job Match Score meter */}
                            <div className="relative mt-1 rounded-2xl bg-[#f4f6fb] p-4 dark:bg-lc-hover/50">
                                <div className="flex items-end justify-between">
                                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-primary/70">Job Match Score</span>
                                    <span className="font-nunito text-2xl font-extrabold leading-none text-primary">{matchScore}%</span>
                                </div>
                                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-primary/10">
                                    <div
                                        className="h-full rounded-full bg-[linear-gradient(90deg,#4A7CFF,#7c6fff)]"
                                        style={{ width: `${matchScore}%`, transition: "width .8s cubic-bezier(.22,1,.36,1)" }}
                                    />
                                </div>
                                {scorePop && (
                                    <div
                                        key={`${scorePop.from}-${scorePop.to}`}
                                        className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-extrabold text-white shadow"
                                        style={{ animation: "pq-pop .5s ease-out" }}
                                    >
                                        <span className="material-symbols-outlined text-[15px]">trending_up</span>
                                        {scorePop.from}% → {scorePop.to}%
                                    </div>
                                )}
                            </div>

                            {/* Guide speech bubble */}
                            <div
                                key={step.key}
                                className="mt-3 rounded-2xl bg-[#f4f6fb] p-4 text-slate-800 dark:bg-lc-hover/50 dark:text-slate-100"
                                style={{ animation: "pq-fade .4s ease-out" }}
                            >
                                <div className="mb-1 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-primary">
                                    <span className="material-symbols-outlined text-[16px]">graphic_eq</span>
                                    Your guide
                                </div>
                                <p className="text-[15px] font-semibold leading-snug">{guideLine}</p>
                            </div>

                            {/* Live mic status */}
                            <div className="mt-3 flex min-h-[36px] items-center justify-center">
                                {extracting ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-extrabold text-primary">
                                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                                        Sorting your answer…
                                    </span>
                                ) : dictation.working ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-extrabold text-primary">
                                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                                        Understanding…
                                    </span>
                                ) : dictation.listening ? (
                                    <button
                                        type="button"
                                        onClick={() => dictation.stop()}
                                        className="relative inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1.5 text-xs font-extrabold text-white shadow"
                                    >
                                        <span className="relative flex h-2.5 w-2.5">
                                            <span className="absolute inline-flex h-full w-full rounded-full bg-white" style={{ animation: "pq-ring 1.4s ease-out infinite" }} />
                                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                                        </span>
                                        Listening — say it all
                                    </button>
                                ) : canVoice ? (
                                    <button
                                        type="button"
                                        onClick={() => dictation.start()}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-extrabold text-white shadow-sm transition-transform hover:scale-[1.03]"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">mic</span>
                                        Talk to fill
                                    </button>
                                ) : null}
                            </div>
                            {canVoice && !dictation.listening && !extracting && (
                                <p className="mt-2 text-center text-[11px] font-semibold text-slate-400">
                                    Say everything in one go — I&rsquo;ll put each part in the right box.
                                </p>
                            )}

                            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setHandsFree((v) => !v)}
                                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                                        handsFree ? "bg-primary text-white" : "bg-slate-100 text-slate-700 hover:bg-primary/10 hover:text-primary dark:bg-lc-hover dark:text-slate-200"
                                    }`}
                                    title="When on, the mic opens automatically after each question — just speak your answers."
                                >
                                    <span className="material-symbols-outlined text-[18px]">{handsFree ? "record_voice_over" : "mic"}</span>
                                    {handsFree ? "Hands-free on" : "Hands-free"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setVoiceOn((v) => !v)}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-primary/10 hover:text-primary dark:bg-lc-hover dark:text-slate-200"
                                >
                                    <span className="material-symbols-outlined text-[18px]">{voiceOn ? "volume_up" : "volume_off"}</span>
                                    {voiceOn ? "Voice on" : "Voice off"}
                                </button>
                            </div>
                        </div>
                    </aside>

                    {/* Step content */}
                    <section
                        key={step.key}
                        className="min-w-0 rounded-[2rem] bg-white p-6 shadow-[0_24px_70px_-24px_rgba(20,40,80,0.18)] dark:bg-lc-surface sm:p-8"
                        style={{ animation: "pq-slide .4s cubic-bezier(.22,1,.36,1)" }}
                    >
                        <StepContent
                            stepKey={step.key}
                            firstName={firstName}
                            user={user}
                            profile={profile}
                            setProfile={setProfile}
                            token={token}
                            usernameDraft={usernameDraft}
                            setUsernameDraft={setUsernameDraft}
                            usernameStatus={usernameStatus}
                            usernameReady={usernameReady}
                            onSaveUsername={onSaveUsername}
                            onUploadImage={onUploadImage}
                            onUploadAvatar={onUploadAvatar}
                            onUploadResume={onUploadResume}
                            onUserAvatarChange={onUserAvatarChange}
                            localResumes={localResumes}
                            setLocalResumes={setLocalResumes}
                            uploading={uploading}
                            doUpload={doUpload}
                            githubConnected={githubConnected}
                            githubConnecting={githubConnecting}
                            onConnectGitHub={onConnectGitHub}
                            saving={saving}
                            onFinish={onFinish}
                        />

                        {step.key !== "done" && (
                            <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5 dark:border-lc-border">
                                <button
                                    type="button"
                                    onClick={goBack}
                                    disabled={stepIndex === 0}
                                    className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-lc-hover"
                                >
                                    <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                                    Back
                                </button>
                                <button
                                    type="button"
                                    onClick={goNext}
                                    disabled={step.key === "handle" && !usernameReady}
                                    className="group inline-flex items-center gap-2 rounded-3xl bg-gradient-to-r from-[#4A7CFF] to-[#6B9FFF] px-7 py-3 text-sm font-extrabold text-white shadow-[0_8px_30px_rgba(74,124,255,.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(74,124,255,.5)] active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0"
                                >
                                    {step.optional ? "Skip / Continue" : "Continue"}
                                    <span className="material-symbols-outlined text-[20px] transition-transform group-hover:translate-x-1">arrow_forward</span>
                                </button>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
        </DictationCtx.Provider>
    );
}

function guideFor(key: StepKey, name: string): string {
    switch (key) {
        case "welcome":
            return `Hi ${name}! I'm your profile guide. Let's build a job-ready profile together — I'll ask a few quick questions, you can type or just talk to me. Ready?`;
        case "handle":
            return "First, let's claim your public handle. This becomes your shareable profile link that recruiters can open.";
        case "basics":
            return "Let's make a strong first impression. Add a photo and a punchy headline — hit Improve with AI if you want me to polish it.";
        case "location":
            return "Where are you based, and what industry are you targeting? This helps recruiters find you.";
        case "openTo":
            return "What roles are you open to? Tell me the kind of work you're chasing next.";
        case "about":
            return "Now your story. Write a few lines about yourself — or drop some rough notes and I'll turn them into a clean summary.";
        case "experience":
            return "Let's add your experience — internships, jobs, freelance, anything real. Add as many as you like.";
        case "education":
            return "Add your education — college, bootcamp, or your most relevant learning.";
        case "skills":
            return "Time for your superpowers. Add the skills you want recruiters to search for.";
        case "projects":
            return "Show your best work. Add projects you're proud of — I can polish each description for you.";
        case "featured":
            return "Any highlights to pin? A launch, an award, or a write-up. This one's optional.";
        case "coding":
            return "Let's prove you can code. Drop links to your LeetCode, Codeforces, or other profiles.";
        case "resume":
            return "Attach your resume so recruiters can grab it in one click.";
        case "github":
            return "Last mission — connect GitHub so we can showcase and analyze your real code later.";
        case "done":
            return `Amazing work, ${name}! Your profile is ready to compete. Let's take a look at how recruiters will see it.`;
        default:
            return "";
    }
}

type StepContentProps = {
    stepKey: StepKey;
    firstName: string;
    user: UserProfile | null;
    profile: JobProfile;
    setProfile: Dispatch<SetStateAction<JobProfile>>;
    token?: string;
    usernameDraft: string;
    setUsernameDraft: (v: string) => void;
    usernameStatus: string;
    usernameReady: boolean;
    onSaveUsername: () => void;
    onUploadImage: (file: File) => Promise<string>;
    onUploadAvatar: (file: File) => Promise<string>;
    onUploadResume: (file: File) => Promise<ResumeItem>;
    onUserAvatarChange: (avatarUrl: string) => void;
    localResumes: ResumeItem[];
    setLocalResumes: Dispatch<SetStateAction<ResumeItem[]>>;
    uploading: string | null;
    doUpload: (kind: string, fn: () => Promise<void>) => Promise<void>;
    githubConnected: boolean;
    githubConnecting: boolean;
    onConnectGitHub: () => void;
    saving: boolean;
    onFinish: () => void;
};

function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <div className="mb-6">
            <h2 className="font-nunito text-3xl font-extrabold tracking-tight text-primary sm:text-[32px]">{title}</h2>
            {subtitle && <p className="mt-2 text-lg text-slate-500 dark:text-slate-300">{subtitle}</p>}
        </div>
    );
}

function StepContent(props: StepContentProps) {
    const { stepKey, profile, setProfile, token } = props;
    const patch = (p: Partial<JobProfile>) => setProfile((cur) => ({ ...cur, ...p }));

    switch (stepKey) {
        case "welcome":
            return (
                <div className="flex min-h-[280px] flex-col items-start justify-center">
                    <h2 className="font-nunito text-4xl font-extrabold tracking-tight text-primary sm:text-5xl">
                        Let&rsquo;s build your job-ready profile
                    </h2>
                    <p className="mt-3 max-w-lg text-lg text-slate-600 dark:text-slate-300">
                        No boring form. I&rsquo;ll walk you through it one question at a time — talk to me or type, and use
                        <span className="font-bold text-primary"> Improve with AI</span> whenever you want polished wording.
                    </p>
                    <ResumeAutofill token={token} setProfile={setProfile} />
                </div>
            );

        case "handle":
            return (
                <div>
                    <Heading title="Unlock your profile link" subtitle="This is your public, shareable profile URL." />
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex-1">
                            <TextInput
                                label="Username"
                                value={props.usernameDraft}
                                onChange={(v) => props.setUsernameDraft(v.toLowerCase())}
                                placeholder="your-name"
                                maxLength={32}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={props.onSaveUsername}
                            disabled={props.usernameDraft.trim().length < 3}
                            className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                        >
                            Save handle
                        </button>
                    </div>
                    {props.usernameStatus && <p className="mt-2 text-sm font-semibold text-primary">{props.usernameStatus}</p>}
                    {props.usernameReady && (
                        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                            <span className="material-symbols-outlined text-[18px]">check_circle</span>
                            Handle locked in — you&rsquo;re good to continue.
                        </p>
                    )}
                </div>
            );

        case "basics":
            return (
                <div className="space-y-5">
                    <Heading title="Make your first impression" subtitle="A face and a headline recruiters remember." />
                    <div className="flex items-center gap-4 rounded-2xl bg-[#f4f6fb] p-4 dark:bg-lc-hover/40">
                        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-2xl font-bold text-white">
                            {props.user?.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={props.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                                (props.firstName[0] || "P").toUpperCase()
                            )}
                        </div>
                        <label className="flex-1">
                            <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">Profile photo</span>
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) props.doUpload("avatar", async () => props.onUserAvatarChange(await props.onUploadAvatar(file)));
                                }}
                                className="w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:font-bold file:text-white"
                            />
                            {props.uploading === "avatar" && <span className="text-sm font-semibold text-primary">Uploading…</span>}
                        </label>
                    </div>
                    <TextInput
                        label="Pronouns (optional)"
                        value={profile.pronouns || ""}
                        onChange={(v) => patch({ pronouns: v })}
                        placeholder="she/her, he/him, they/them"
                        maxLength={40}
                    />
                    <AiTextArea
                        label="Headline"
                        field="headline"
                        value={profile.headline || ""}
                        onChange={(v) => patch({ headline: v })}
                        placeholder="e.g. Final-year CS student · React & Node · building AI side-projects"
                        maxLength={220}
                        token={token}
                        voiceKey="headline"
                        voiceHint="a one-line professional headline / tagline"
                        autoFocus
                    />
                </div>
            );

        case "location":
            return (
                <div className="space-y-5">
                    <Heading title="Put yourself on the map" subtitle="Location and industry help recruiters match you." />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <TextInput label="City" value={profile.city || ""} onChange={(v) => patch({ city: v })} placeholder="Bengaluru" maxLength={120} voiceKey="city" voiceHint="the city they live in" autoFocus />
                        <TextInput label="Country" value={profile.country || ""} onChange={(v) => patch({ country: v })} placeholder="India" maxLength={120} voiceKey="country" voiceHint="the country" />
                        <TextInput label="Industry" value={profile.industry || ""} onChange={(v) => patch({ industry: v })} placeholder="Software / Fintech" maxLength={120} voiceKey="industry" voiceHint="the industry / domain, e.g. fintech, SaaS, healthcare" />
                        <TextInput label="Postal code (optional)" value={profile.postalCode || ""} onChange={(v) => patch({ postalCode: v })} placeholder="560001" maxLength={20} voiceKey="postalCode" voiceHint="postal / PIN code, digits only" />
                        <TextInput label="Profile language" value={profile.profileLanguage || "English"} onChange={(v) => patch({ profileLanguage: v })} maxLength={60} voiceKey="profileLanguage" voiceHint="preferred language" />
                    </div>
                </div>
            );

        case "openTo":
            return (
                <div className="space-y-5">
                    <Heading title="Set your target" subtitle="The roles you're open to, and an optional cover banner." />
                    <AiTextArea
                        label="Open to roles"
                        field="headline"
                        value={profile.openTo || ""}
                        onChange={(v) => patch({ openTo: v })}
                        placeholder="Frontend Engineer, Full-Stack roles, SDE internships"
                        maxLength={180}
                        token={token}
                        voiceKey="openTo"
                        voiceHint="the roles / job titles they want"
                        autoFocus
                    />
                    <label className="block">
                        <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">Cover image (optional)</span>
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) props.doUpload("cover", async () => patch({ coverImageUrl: await props.onUploadImage(file) }));
                            }}
                            className="w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:font-bold file:text-white"
                        />
                        {profile.coverImageUrl && (
                            <div className="mt-3 h-24 overflow-hidden rounded-2xl shadow-[0_10px_30px_-12px_rgba(20,40,80,0.25)]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={profile.coverImageUrl} alt="" className="h-full w-full object-cover" />
                            </div>
                        )}
                        {props.uploading === "cover" && <span className="text-sm font-semibold text-primary">Uploading…</span>}
                    </label>
                </div>
            );

        case "about":
            return (
                <div className="space-y-5">
                    <Heading title="Tell your story" subtitle="A short, human summary. Rough notes are fine — Improve with AI will shape them." />
                    <AiTextArea
                        label="About you"
                        field="about"
                        value={profile.about || ""}
                        onChange={(v) => patch({ about: v })}
                        placeholder="Who you are, what you're great at, and what you want next…"
                        maxLength={2600}
                        token={token}
                        voiceKey="about"
                        voiceHint="a summary about themselves"
                        autoFocus
                    />
                </div>
            );

        case "experience":
            return <ExperienceStep profile={profile} setProfile={setProfile} token={token} />;
        case "education":
            return <EducationStep profile={profile} setProfile={setProfile} token={token} />;
        case "skills":
            return <SkillsStep profile={profile} setProfile={setProfile} token={token} />;
        case "projects":
            return <ProjectsStep profile={profile} setProfile={setProfile} token={token} />;
        case "featured":
            return <FeaturedStep profile={profile} setProfile={setProfile} token={token} onUploadImage={props.onUploadImage} />;

        case "coding":
            return (
                <div className="space-y-5">
                    <Heading title="Unlock recruiter trust" subtitle="Add at least one coding profile — it powers Quick Apply later." />
                    {CODING_FIELDS.map((item) => (
                        <TextInput
                            key={item.key}
                            label={`${item.label} URL`}
                            value={(profile[item.key] as string) || ""}
                            onChange={(v) => patch({ [item.key]: v } as Partial<JobProfile>)}
                            placeholder={`https://${item.label.toLowerCase()}.com/u/you`}
                            maxLength={500}
                        />
                    ))}
                </div>
            );

        case "resume":
            return (
                <div className="space-y-4">
                    <Heading title="Arm recruiters with your resume" subtitle="One-click download for recruiters." />
                    <label className="block">
                        <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">Upload PDF</span>
                        <input
                            type="file"
                            accept="application/pdf,.pdf"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file)
                                    props.doUpload("resume", async () => {
                                        const resume = await props.onUploadResume(file);
                                        props.setLocalResumes((cur) => [resume, ...cur.filter((r) => r.id !== resume.id)]);
                                        patch({ selectedResumeId: resume.id });
                                    });
                            }}
                            className="w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:font-bold file:text-white"
                        />
                        {props.uploading === "resume" && <span className="text-sm font-semibold text-primary">Uploading…</span>}
                    </label>
                    {props.localResumes.map((resume) => (
                        <label key={resume.id} className="flex items-center gap-3 rounded-2xl bg-[#f4f6fb] p-4 dark:bg-lc-hover/40">
                            <input
                                type="radio"
                                checked={profile.selectedResumeId === resume.id}
                                onChange={() => patch({ selectedResumeId: resume.id })}
                            />
                            <span className="font-semibold text-slate-900 dark:text-white">{resume.fileName}</span>
                        </label>
                    ))}
                </div>
            );

        case "github":
            return (
                <div className="space-y-5">
                    <Heading title="Connect your code" subtitle="Optional, but recruiters trust real code." />
                    <button
                        type="button"
                        onClick={props.onConnectGitHub}
                        disabled={props.githubConnecting || props.githubConnected}
                        className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-all ${
                            props.githubConnected
                                ? "bg-emerald-50 text-emerald-700 shadow-[0_12px_34px_-16px_rgba(16,185,129,0.5)] dark:bg-emerald-400/10 dark:text-emerald-300"
                                : "bg-slate-900 text-white shadow-[0_14px_34px_-14px_rgba(15,23,42,0.6)] hover:-translate-y-0.5 dark:bg-white dark:text-slate-900"
                        }`}
                    >
                        <span className="material-symbols-outlined text-[20px]">{props.githubConnected ? "check_circle" : "code"}</span>
                        {props.githubConnecting ? "Connecting…" : props.githubConnected ? "GitHub connected" : "Connect GitHub"}
                    </button>
                </div>
            );

        case "done":
            return (
                <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                    <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#4A7CFF] to-[#7c6fff] text-white shadow-xl">
                        <span className="material-symbols-outlined text-[44px]">emoji_events</span>
                    </div>
                    <h2 className="mt-5 font-nunito text-3xl font-extrabold tracking-tight text-primary">Your profile is ready to compete 🎉</h2>
                    <p className="mt-2 max-w-md text-lg text-slate-600 dark:text-slate-300">
                        Publish it and preview exactly how recruiters will see you.
                    </p>
                    <button
                        type="button"
                        onClick={props.onFinish}
                        disabled={props.saving}
                        className="group mt-7 inline-flex items-center gap-2 rounded-3xl bg-gradient-to-r from-[#4A7CFF] to-[#6B9FFF] px-8 py-3.5 text-base font-extrabold text-white shadow-[0_8px_30px_rgba(74,124,255,.35)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(74,124,255,.5)] disabled:opacity-60"
                    >
                        <span className="material-symbols-outlined text-[22px]">visibility</span>
                        {props.saving ? "Publishing…" : "See how recruiters view this"}
                    </button>
                </div>
            );

        default:
            return null;
    }
}

// ── Repeatable step sub-components ───────────────────────────────────────────
function ExperienceStep({ profile, setProfile, token }: { profile: JobProfile; setProfile: Dispatch<SetStateAction<JobProfile>>; token?: string }) {
    const blank: Experience = { id: uid(), title: "", company: "", employmentType: "", startDate: "", endDate: "", location: "", locationType: "", description: "", logoUrl: "" };
    const [draft, setDraft] = useState<Experience>(blank);
    const [editingId, setEditingId] = useState<string | null>(null);

    const startEdit = (item: Experience) => {
        setDraft({ ...item });
        setEditingId(item.id);
    };
    const cancelEdit = () => {
        setDraft({ ...blank, id: uid() });
        setEditingId(null);
    };
    const save = () => {
        if (!draft.title.trim() || !draft.company.trim()) return;
        setProfile((cur) => {
            const list = cur.experiences || [];
            const next = editingId ? list.map((e) => (e.id === editingId ? draft : e)) : [...list, draft];
            return { ...cur, experiences: next.slice(0, 20) };
        });
        setDraft({ ...blank, id: uid() });
        setEditingId(null);
    };
    const remove = (id: string) => {
        setProfile((cur) => ({ ...cur, experiences: (cur.experiences || []).filter((e) => e.id !== id) }));
        if (editingId === id) cancelEdit();
    };

    return (
        <div className="space-y-5">
            <Heading title="Prove your experience" subtitle="Add each role. Improve with AI cleans up the description." />
            {(profile.experiences || []).map((e) => (
                <ItemChip key={e.id} title={e.title} subtitle={[e.company, e.employmentType].filter(Boolean).join(" · ")} editing={editingId === e.id} onEdit={() => startEdit(e)} onRemove={() => remove(e.id)} />
            ))}
            <div className="space-y-4 rounded-[1.5rem] bg-[#f4f6fb] p-5 shadow-[inset_0_1px_2px_rgba(20,40,80,0.04)] dark:bg-lc-hover/40">
                <div className="grid gap-4 sm:grid-cols-2">
                    <TextInput label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} placeholder="Software Engineer Intern" maxLength={160} voiceKey="title" voiceHint="the job title / role" autoFocus />
                    <TextInput label="Company" value={draft.company} onChange={(v) => setDraft({ ...draft, company: v })} placeholder="Acme Inc." maxLength={160} voiceKey="company" voiceHint="the company / organisation name" />
                    <TextInput label="Employment type" value={draft.employmentType || ""} onChange={(v) => setDraft({ ...draft, employmentType: v })} placeholder="Internship" maxLength={80} voiceKey="employmentType" voiceHint="full-time, internship, freelance, etc." />
                    <TextInput label="Location" value={draft.location || ""} onChange={(v) => setDraft({ ...draft, location: v })} placeholder="Remote" maxLength={160} voiceKey="location" voiceHint="where the role was based, or remote" />
                    <TextInput label="Start" type="date" value={draft.startDate} onChange={(v) => setDraft({ ...draft, startDate: v })} />
                    <TextInput label="End (blank = present)" type="date" value={draft.endDate || ""} onChange={(v) => setDraft({ ...draft, endDate: v })} />
                </div>
                <AiTextArea
                    label="What you did"
                    field="experience"
                    value={draft.description || ""}
                    onChange={(v) => setDraft({ ...draft, description: v })}
                    context={`${draft.title} at ${draft.company}`}
                    placeholder="Rough notes are fine — I'll turn them into crisp, impact-first bullets."
                    maxLength={1200}
                    token={token}
                    voiceKey="description"
                    voiceHint="what they did / responsibilities"
                />
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={save}
                        disabled={!draft.title.trim() || !draft.company.trim()}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_30px_-12px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                    >
                        <span className="material-symbols-outlined text-[20px]">{editingId ? "check" : "add"}</span>
                        {editingId ? "Save changes" : "Add this experience"}
                    </button>
                    {editingId && (
                        <button type="button" onClick={cancelEdit} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-lc-hover">
                            Cancel
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function EducationStep({ profile, setProfile }: { profile: JobProfile; setProfile: Dispatch<SetStateAction<JobProfile>>; token?: string }) {
    const blank: Education = { id: uid(), school: "", degree: "", field: "", startDate: "", endDate: "", logoUrl: "" };
    const [draft, setDraft] = useState<Education>(blank);
    const [editingId, setEditingId] = useState<string | null>(null);

    const startEdit = (item: Education) => {
        setDraft({ ...item });
        setEditingId(item.id);
    };
    const cancelEdit = () => {
        setDraft({ ...blank, id: uid() });
        setEditingId(null);
    };
    const save = () => {
        if (!draft.school.trim() || !draft.degree.trim()) return;
        setProfile((cur) => {
            const list = cur.education || [];
            const next = editingId ? list.map((e) => (e.id === editingId ? draft : e)) : [...list, draft];
            return { ...cur, education: next.slice(0, 20) };
        });
        setDraft({ ...blank, id: uid() });
        setEditingId(null);
    };
    const remove = (id: string) => {
        setProfile((cur) => ({ ...cur, education: (cur.education || []).filter((e) => e.id !== id) }));
        if (editingId === id) cancelEdit();
    };

    return (
        <div className="space-y-5">
            <Heading title="Add your roots" subtitle="College, bootcamp, or most relevant learning." />
            {(profile.education || []).map((e) => (
                <ItemChip key={e.id} title={e.school} subtitle={[e.degree, e.field].filter(Boolean).join(" · ")} editing={editingId === e.id} onEdit={() => startEdit(e)} onRemove={() => remove(e.id)} />
            ))}
            <div className="space-y-4 rounded-[1.5rem] bg-[#f4f6fb] p-5 shadow-[inset_0_1px_2px_rgba(20,40,80,0.04)] dark:bg-lc-hover/40">
                <TextInput label="School" value={draft.school} onChange={(v) => setDraft({ ...draft, school: v })} placeholder="IIT Delhi" maxLength={180} voiceKey="school" voiceHint="school / college / university name" autoFocus />
                <div className="grid gap-4 sm:grid-cols-2">
                    <TextInput label="Degree" value={draft.degree} onChange={(v) => setDraft({ ...draft, degree: v })} placeholder="B.Tech" maxLength={180} voiceKey="degree" voiceHint="the degree, e.g. B.Tech, MBA" />
                    <TextInput label="Field" value={draft.field || ""} onChange={(v) => setDraft({ ...draft, field: v })} placeholder="Computer Science" maxLength={180} voiceKey="field" voiceHint="field of study / major" />
                    <TextInput label="Start" type="date" value={draft.startDate} onChange={(v) => setDraft({ ...draft, startDate: v })} />
                    <TextInput label="End" type="date" value={draft.endDate || ""} onChange={(v) => setDraft({ ...draft, endDate: v })} />
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={save}
                        disabled={!draft.school.trim() || !draft.degree.trim()}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_30px_-12px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                    >
                        <span className="material-symbols-outlined text-[20px]">{editingId ? "check" : "add"}</span>
                        {editingId ? "Save changes" : "Add this education"}
                    </button>
                    {editingId && (
                        <button type="button" onClick={cancelEdit} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-lc-hover">
                            Cancel
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function SkillsStep({ profile, setProfile }: { profile: JobProfile; setProfile: Dispatch<SetStateAction<JobProfile>>; token?: string }) {
    const [input, setInput] = useState("");
    const skills = profile.skills || [];

    const add = (raw: string) => {
        const name = raw.replace(/\s+/g, " ").trim();
        if (!name) return;
        if (skills.some((s) => normalizeSkillName(s.name) === normalizeSkillName(name))) {
            setInput("");
            return;
        }
        setProfile((cur) => ({ ...cur, skills: [...(cur.skills || []), { id: uid(), name, context: "" } as Skill].slice(0, 50) }));
        setInput("");
    };
    const remove = (id: string) => setProfile((cur) => ({ ...cur, skills: (cur.skills || []).filter((s) => s.id !== id) }));

    const suggestions = DEFAULT_SKILLS.filter(
        (s) => (!input || normalizeSkillName(s).includes(normalizeSkillName(input))) && !skills.some((sk) => normalizeSkillName(sk.name) === normalizeSkillName(s))
    ).slice(0, 10);

    return (
        <div className="space-y-5">
            <Heading title="Add your superpowers" subtitle="Add at least 3 skills recruiters can search for." />
            <div className="flex items-center gap-2">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            add(input);
                        }
                    }}
                    placeholder="Type a skill and press Enter"
                    maxLength={80}
                    className={inputClass}
                />
                <button type="button" onClick={() => add(input)} disabled={!input.trim()} className="rounded-2xl bg-primary px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_30px_-12px_rgba(74,124,255,0.6)] disabled:opacity-50">
                    Add
                </button>
            </div>
            {skills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {skills.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => remove(s.id)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary"
                        >
                            {s.name}
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    ))}
                </div>
            )}
            {suggestions.length > 0 && (
                <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Popular picks</p>
                    <div className="flex flex-wrap gap-2">
                        {suggestions.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => add(s)}
                                className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-primary/10 hover:text-primary dark:bg-lc-hover dark:text-slate-200"
                            >
                                + {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function ProjectsStep({ profile, setProfile, token }: { profile: JobProfile; setProfile: Dispatch<SetStateAction<JobProfile>>; token?: string }) {
    const blank: Project = { id: uid(), title: "", role: "", startDate: "", endDate: "", description: "", technologies: [], imageUrl: "" };
    const [draft, setDraft] = useState<Project>(blank);
    const [tech, setTech] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);

    const startEdit = (item: Project) => {
        setDraft({ ...item });
        setTech((item.technologies || []).join(", "));
        setEditingId(item.id);
    };
    const cancelEdit = () => {
        setDraft({ ...blank, id: uid() });
        setTech("");
        setEditingId(null);
    };
    const save = () => {
        if (!draft.title.trim()) return;
        const technologies = tech.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20);
        const item = { ...draft, technologies };
        setProfile((cur) => {
            const list = cur.projects || [];
            const next = editingId ? list.map((p) => (p.id === editingId ? item : p)) : [...list, item];
            return { ...cur, projects: next.slice(0, 30) };
        });
        setDraft({ ...blank, id: uid() });
        setTech("");
        setEditingId(null);
    };
    const remove = (id: string) => {
        setProfile((cur) => ({ ...cur, projects: (cur.projects || []).filter((p) => p.id !== id) }));
        if (editingId === id) cancelEdit();
    };

    return (
        <div className="space-y-5">
            <Heading title="Show your best work" subtitle="Add projects worth showing. I'll polish each description." />
            {(profile.projects || []).map((p) => (
                <ItemChip key={p.id} title={p.title} subtitle={p.role || (p.technologies || []).join(", ")} editing={editingId === p.id} onEdit={() => startEdit(p)} onRemove={() => remove(p.id)} />
            ))}
            <div className="space-y-4 rounded-[1.5rem] bg-[#f4f6fb] p-5 shadow-[inset_0_1px_2px_rgba(20,40,80,0.04)] dark:bg-lc-hover/40">
                <div className="grid gap-4 sm:grid-cols-2">
                    <TextInput label="Project title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} placeholder="Realtime chat app" maxLength={160} voiceKey="title" voiceHint="the project name" autoFocus />
                    <TextInput label="Your role" value={draft.role || ""} onChange={(v) => setDraft({ ...draft, role: v })} placeholder="Solo builder" maxLength={120} voiceKey="role" voiceHint="their role on the project" />
                    <TextInput label="Start" type="date" value={draft.startDate || ""} onChange={(v) => setDraft({ ...draft, startDate: v })} />
                    <TextInput label="End" type="date" value={draft.endDate || ""} onChange={(v) => setDraft({ ...draft, endDate: v })} />
                </div>
                <AiTextArea
                    label="Description"
                    field="project"
                    value={draft.description || ""}
                    onChange={(v) => setDraft({ ...draft, description: v })}
                    context={draft.title}
                    placeholder="What it does, the problem it solves, and your role."
                    maxLength={1200}
                    token={token}
                    voiceKey="description"
                    voiceHint="what the project does and their role"
                />
                <TextInput label="Technologies (comma separated)" value={tech} onChange={setTech} placeholder="React, Node, PostgreSQL" maxLength={300} voiceKey="technologies" voiceHint="tech stack / tools used, comma separated" />
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={save}
                        disabled={!draft.title.trim()}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_30px_-12px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                    >
                        <span className="material-symbols-outlined text-[20px]">{editingId ? "check" : "add"}</span>
                        {editingId ? "Save changes" : "Add this project"}
                    </button>
                    {editingId && (
                        <button type="button" onClick={cancelEdit} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-lc-hover">
                            Cancel
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function FeaturedStep({
    profile,
    setProfile,
    token,
    onUploadImage,
}: {
    profile: JobProfile;
    setProfile: Dispatch<SetStateAction<JobProfile>>;
    token?: string;
    onUploadImage: (file: File) => Promise<string>;
}) {
    const blank: Featured = { id: uid(), title: "", description: "", imageUrl: "", linkUrl: "" };
    const [draft, setDraft] = useState<Featured>(blank);
    const [uploading, setUploading] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    const startEdit = (item: Featured) => {
        setDraft({ ...item });
        setEditingId(item.id);
    };
    const cancelEdit = () => {
        setDraft({ ...blank, id: uid() });
        setEditingId(null);
    };
    const save = () => {
        if (!draft.title.trim()) return;
        setProfile((cur) => {
            const list = cur.featured || [];
            const next = editingId ? list.map((f) => (f.id === editingId ? draft : f)) : [...list, draft];
            return { ...cur, featured: next.slice(0, 12) };
        });
        setDraft({ ...blank, id: uid() });
        setEditingId(null);
    };
    const remove = (id: string) => {
        setProfile((cur) => ({ ...cur, featured: (cur.featured || []).filter((f) => f.id !== id) }));
        if (editingId === id) cancelEdit();
    };

    return (
        <div className="space-y-5">
            <Heading title="Pin your highlights" subtitle="Optional — a launch, an award, a write-up." />
            {(profile.featured || []).map((f) => (
                <ItemChip key={f.id} title={f.title} subtitle={f.description || undefined} editing={editingId === f.id} onEdit={() => startEdit(f)} onRemove={() => remove(f.id)} />
            ))}
            <div className="space-y-4 rounded-[1.5rem] bg-[#f4f6fb] p-5 shadow-[inset_0_1px_2px_rgba(20,40,80,0.04)] dark:bg-lc-hover/40">
                <TextInput label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} placeholder="Won Best Hack @ HackX" maxLength={160} voiceKey="title" voiceHint="the highlight title" autoFocus />
                <AiTextArea
                    label="Description"
                    field="featured"
                    value={draft.description || ""}
                    onChange={(v) => setDraft({ ...draft, description: v })}
                    context={draft.title}
                    placeholder="A crisp line or two."
                    maxLength={500}
                    token={token}
                    voiceKey="description"
                    voiceHint="a short description of the highlight"
                />
                <TextInput label="Link (optional)" value={draft.linkUrl || ""} onChange={(v) => setDraft({ ...draft, linkUrl: v })} placeholder="https://…" maxLength={500} />
                <label className="block">
                    <span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">Image (optional)</span>
                    <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setUploading(true);
                            try {
                                setDraft((d) => ({ ...d, imageUrl: "" }));
                                const url = await onUploadImage(file);
                                setDraft((d) => ({ ...d, imageUrl: url }));
                            } catch (err) {
                                window.alert(err instanceof Error ? err.message : "Upload failed");
                            } finally {
                                setUploading(false);
                            }
                        }}
                        className="w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:font-bold file:text-white"
                    />
                    {uploading && <span className="text-sm font-semibold text-primary">Uploading…</span>}
                </label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={save}
                        disabled={!draft.title.trim()}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_30px_-12px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                    >
                        <span className="material-symbols-outlined text-[20px]">{editingId ? "check" : "add"}</span>
                        {editingId ? "Save changes" : "Add highlight"}
                    </button>
                    {editingId && (
                        <button type="button" onClick={cancelEdit} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-lc-hover">
                            Cancel
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
