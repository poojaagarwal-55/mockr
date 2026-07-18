"use client";

import Link from "next/link";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_SKILLS, normalizeSkillName } from "@interviewforge/shared";
import { api, ApiError, getApiBaseUrl } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { JobProfileOnboarding } from "./job-profile-onboarding";
import { improveText, type ImproveField } from "@/lib/job-profile-ai";

export type Experience = {
    id: string;
    title: string;
    company: string;
    employmentType?: string | null;
    startDate: string;
    endDate?: string | null;
    location?: string | null;
    locationType?: string | null;
    description?: string | null;
    logoUrl?: string | null;
};

export type Education = {
    id: string;
    school: string;
    degree: string;
    field?: string | null;
    startDate: string;
    endDate?: string | null;
    logoUrl?: string | null;
};

export type Skill = {
    id: string;
    name: string;
    context?: string | null;
};

export type Featured = {
    id: string;
    title: string;
    description?: string | null;
    imageUrl?: string | null;
    linkUrl?: string | null;
};

export type Project = {
    id: string;
    title: string;
    role?: string | null;
    startDate: string;
    endDate?: string | null;
    description?: string | null;
    technologies?: string[] | null;
    imageUrl?: string | null;
};

export type JobProfile = {
    profileLanguage: string;
    pronouns?: string | null;
    headline?: string | null;
    industry?: string | null;
    city?: string | null;
    country?: string | null;
    postalCode?: string | null;
    about?: string | null;
    openTo?: string | null;
    coverImageUrl?: string | null;
    selectedResumeId?: string | null;
    leetcodeUrl?: string | null;
    geeksforgeeksUrl?: string | null;
    codeforcesUrl?: string | null;
    codechefUrl?: string | null;
    experiences: Experience[];
    education: Education[];
    skills: Skill[];
    featured: Featured[];
    projects: Project[];
    isPublished: boolean;
};

export type UserProfile = {
    id: string;
    fullName: string;
    email: string;
    username?: string | null;
    avatarUrl?: string | null;
    location?: string | null;
    website?: string | null;
    githubUrl?: string | null;
    linkedinUrl?: string | null;
    skills?: string[];
    workExperience?: any[] | null;
    education?: any[] | null;
};

export type ResumeItem = {
    id: string;
    fileName: string;
    uploadedAt: string;
    previewUrl?: string | null;
};

type SkillSuggestion = {
    id: string;
    name: string;
    normalizedName: string;
    source: string;
    usageCount: number;
};

type ApiPayload = {
    user: UserProfile;
    profile: Partial<JobProfile> | null;
    resume?: ResumeItem | null;
};

type GitHubIntegrationPayload = {
    connected: boolean;
    integration: {
        githubUserId?: string | null;
        githubUsername?: string | null;
        scopes?: string[];
        connectedAt?: string;
        lastSyncedAt?: string | null;
        revokedAt?: string | null;
    } | null;
};

const DEFAULT_COVER =
    "linear-gradient(135deg, #13213d 0%, #1f66ff 42%, #75f0c6 100%)";

const emptyProfile: JobProfile = {
    profileLanguage: "English",
    pronouns: "",
    headline: "",
    industry: "",
    city: "",
    country: "",
    postalCode: "",
    about: "",
    openTo: "",
    coverImageUrl: "",
    selectedResumeId: "",
    leetcodeUrl: "",
    geeksforgeeksUrl: "",
    codeforcesUrl: "",
    codechefUrl: "",
    experiences: [],
    education: [],
    skills: [],
    featured: [],
    projects: [],
    isPublished: false,
};

export function normalizeJobProfile(profile?: Partial<JobProfile> | null): JobProfile {
    return {
        ...emptyProfile,
        ...profile,
        experiences: Array.isArray(profile?.experiences) ? profile.experiences : [],
        education: Array.isArray(profile?.education) ? profile.education : [],
        skills: Array.isArray(profile?.skills) ? profile.skills : [],
        featured: Array.isArray(profile?.featured) ? profile.featured : [],
        projects: Array.isArray(profile?.projects) ? profile.projects : [],
        profileLanguage: profile?.profileLanguage || "English",
        leetcodeUrl: profile?.leetcodeUrl || "",
        geeksforgeeksUrl: profile?.geeksforgeeksUrl || "",
        codeforcesUrl: profile?.codeforcesUrl || "",
        codechefUrl: profile?.codechefUrl || "",
        isPublished: Boolean(profile?.isPublished),
    };
}

type StoredJobProfileDraft = {
    profile: JobProfile;
    usernameDraft: string;
    updatedAt: number;
};

function draftStorageKey(userId?: string | null) {
    return userId ? `practers:job-profile-draft:${userId}` : null;
}

function readStoredProfileDraft(userId?: string | null): StoredJobProfileDraft | null {
    const key = draftStorageKey(userId);
    if (!key || typeof window === "undefined") return null;

    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredJobProfileDraft;
        if (!parsed?.profile || typeof parsed.updatedAt !== "number") return null;
        return {
            ...parsed,
            profile: normalizeJobProfile(parsed.profile),
        };
    } catch {
        return null;
    }
}

function writeStoredProfileDraft(userId: string, profile: JobProfile, usernameDraft: string) {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(
        `practers:job-profile-draft:${userId}`,
        JSON.stringify({
            profile,
            usernameDraft,
            updatedAt: Date.now(),
        })
    );
}

function clearStoredProfileDraft(userId?: string | null) {
    const key = draftStorageKey(userId);
    if (!key || typeof window === "undefined") return;
    window.localStorage.removeItem(key);
}

function canonicalizeDraftValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalizeDraftValue);
    if (!value || typeof value !== "object") return value ?? "";

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== "id")
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonicalizeDraftValue(item)])
    );
}

function profileDraftSnapshot(profile: JobProfile) {
    return JSON.stringify(canonicalizeDraftValue(normalizeJobProfile(profile)));
}

function hasMeaningfulDraftChanges(
    profile: JobProfile,
    usernameDraft: string,
    savedProfileSnapshot: string | null,
    savedUsername: string
) {
    if (!savedProfileSnapshot) return false;
    return profileDraftSnapshot(profile) !== savedProfileSnapshot || usernameDraft !== savedUsername;
}

function id() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return Math.random().toString(36).slice(2);
}

function monthRange(start: string, end?: string | null) {
    if (!start) return "";
    return `${start}${end ? ` - ${end}` : " - Present"}`;
}

function initials(name: string) {
    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "P";
}

function profileFromPayload(payload: ApiPayload | null, fallbackUser: UserProfile | null): { user: UserProfile | null; profile: JobProfile } {
    const user = payload?.user ?? fallbackUser;
    const baseName = user?.fullName ?? "";
    const nameParts = baseName.trim().split(/\s+/);
    const fallbackProfile = {
        ...emptyProfile,
        headline: "",
        city: user?.location ?? "",
        about: "",
        skills: (user?.skills ?? []).slice(0, 8).map((name) => ({ id: id(), name, context: "" })),
        experiences: Array.isArray(user?.workExperience)
            ? user!.workExperience!.slice(0, 4).map((entry: any) => ({
                id: entry.id || id(),
                title: entry.title || "",
                company: entry.company || "",
                employmentType: "",
                startDate: entry.startDate || "",
                endDate: entry.endDate || "",
                location: "",
                locationType: "",
                description: entry.description || "",
                logoUrl: "",
            }))
            : [],
        education: Array.isArray(user?.education)
            ? user!.education!.slice(0, 4).map((entry: any) => ({
                id: entry.id || id(),
                school: entry.institution || "",
                degree: entry.degree || "",
                field: entry.field || "",
                startDate: entry.startDate || "",
                endDate: entry.endDate || "",
                logoUrl: "",
            }))
            : [],
    };

    return {
        user: user
            ? {
                ...user,
                fullName: user.fullName || `${nameParts[0] ?? ""} ${nameParts.slice(1).join(" ")}`.trim(),
            }
            : null,
        profile: normalizeJobProfile({
            ...fallbackProfile,
            ...payload?.profile,
            experiences: payload?.profile?.experiences ?? fallbackProfile.experiences,
            education: payload?.profile?.education ?? fallbackProfile.education,
            skills: payload?.profile?.skills ?? fallbackProfile.skills,
            featured: payload?.profile?.featured ?? [],
            projects: payload?.profile?.projects ?? [],
        }),
    };
}

function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className="h-10 w-10 rounded-full grid place-items-center text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-lc-hover transition-colors"
        >
            <span className="material-symbols-outlined text-[24px]">{icon}</span>
        </button>
    );
}

function InlineEditButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className="absolute right-3 top-3 h-9 w-9 rounded-full bg-white/95 text-slate-700 shadow-sm ring-1 ring-slate-200 opacity-100 transition-opacity hover:bg-slate-50 focus:opacity-100 dark:bg-lc-surface dark:text-white dark:ring-lc-border dark:hover:bg-lc-hover sm:opacity-0 sm:group-hover:opacity-100"
        >
            <span className="material-symbols-outlined text-[20px]">edit</span>
        </button>
    );
}

function NoticeModal({
    title,
    message,
    tone = "info",
    onClose,
}: {
    title: string;
    message: string;
    tone?: "info" | "success" | "error";
    onClose: () => void;
}) {
    const icon = tone === "success" ? "check_circle" : tone === "error" ? "error" : "info";
    const iconClass = tone === "success" ? "text-emerald-500" : tone === "error" ? "text-red-500" : "text-primary";
    return (
        <div className="fixed inset-0 z-[140] grid place-items-center bg-slate-950/50 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <div className="flex items-start gap-4">
                    <span className={`material-symbols-outlined text-[32px] ${iconClass}`}>{icon}</span>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-extrabold text-slate-950 dark:text-white font-nunito">{title}</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{message}</p>
                    </div>
                </div>
                <div className="mt-6 flex justify-end">
                    <button type="button" onClick={onClose} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white">
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}

function SectionCard({
    title,
    action,
    children,
}: {
    title: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="rounded-[1.5rem] bg-white shadow-[0_18px_50px_-24px_rgba(20,40,80,0.16)] dark:bg-lc-surface">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
                <h2 className="text-[22px] font-bold text-slate-950 dark:text-white font-nunito">{title}</h2>
                <div className="flex items-center gap-1">{action}</div>
            </div>
            <div className="px-5 pb-5">{children}</div>
        </section>
    );
}

function LogoMark({ src, label }: { src?: string | null; label: string }) {
    if (src) {
        return (
            // Dynamic company logos can come from many domains; avoid next/image host coupling here.
            <img
                src={src}
                alt=""
                className="h-12 w-12 rounded-md object-cover border border-slate-200 dark:border-lc-border"
            />
        );
    }

    return (
        <div className="h-12 w-12 rounded-md bg-slate-100 dark:bg-lc-hover grid place-items-center text-slate-700 dark:text-slate-200 font-bold">
            {initials(label)}
        </div>
    );
}

const CODING_PROFILE_ITEMS = [
    { key: "leetcodeUrl", label: "LeetCode", host: "leetcode.com" },
    { key: "geeksforgeeksUrl", label: "GeeksForGeeks", host: "geeksforgeeks.org" },
    { key: "codeforcesUrl", label: "Codeforces", host: "codeforces.com" },
    { key: "codechefUrl", label: "CodeChef", host: "codechef.com" },
] as const;

function getCodingProfileUrl(profile: JobProfile, key: typeof CODING_PROFILE_ITEMS[number]["key"]) {
    return profile[key] || "";
}

function codingProfileCount(profile: JobProfile) {
    return CODING_PROFILE_ITEMS.filter((item) => getCodingProfileUrl(profile, item.key).trim()).length;
}

export function ProfilePreview({
    user,
    profile,
    resumes,
    onEdit,
    onConnectGitHub,
    githubConnected = false,
    githubConnecting = false,
    readonly = false,
}: {
    user: UserProfile | null;
    profile: JobProfile;
    resumes: ResumeItem[];
    onEdit?: (section: EditSection, itemId?: string) => void;
    onConnectGitHub?: () => void;
    githubConnected?: boolean;
    githubConnecting?: boolean;
    readonly?: boolean;
}) {
    const fullName = user?.fullName || "Your name";
    const profileUrl = user?.username ? `/profile/${user.username}` : "/profile/your-username";
    const [profileOrigin, setProfileOrigin] = useState("");
    const projects = profile.projects ?? [];
    const experiences = profile.experiences ?? [];
    const education = profile.education ?? [];
    const skills = profile.skills ?? [];
    const featured = profile.featured ?? [];
    const selectedResume = resumes.find((resume) => resume.id === profile.selectedResumeId);

    useEffect(() => {
        setProfileOrigin(window.location.origin);
    }, []);

    return (
        <div className="space-y-5">
            <main className="space-y-5">
                <section className="rounded-[1.5rem] bg-white shadow-[0_18px_50px_-24px_rgba(20,40,80,0.16)] overflow-hidden dark:bg-lc-surface">
                    <div
                        className="relative h-[220px] bg-cover bg-center"
                        style={profile.coverImageUrl ? { backgroundImage: `url(${profile.coverImageUrl})` } : { background: DEFAULT_COVER }}
                    >
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.35),transparent_26%),linear-gradient(120deg,rgba(15,23,42,.18),rgba(15,23,42,.45))]" />
                        {!readonly && onEdit && (
                            <div className="absolute right-5 top-5">
                                <IconButton icon="edit" label="Edit cover" onClick={() => onEdit("intro")} />
                            </div>
                        )}
                    </div>

                    <div className="relative px-5 pb-6 pt-20">
                        <div className="absolute -top-20 left-5 h-36 w-36 rounded-full border-4 border-white dark:border-lc-surface bg-white dark:bg-lc-surface overflow-hidden shadow-lg">
                            {user?.avatarUrl ? (
                                <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <div className="h-full w-full bg-primary text-white grid place-items-center text-4xl font-bold">{initials(fullName)}</div>
                            )}
                            {!readonly && onEdit && (
                                <button
                                    type="button"
                                    aria-label="Edit profile photo"
                                    title="Edit profile photo"
                                    onClick={() => onEdit("intro")}
                                    className="absolute bottom-2 right-2 h-9 w-9 rounded-full bg-white text-slate-700 shadow-lg grid place-items-center hover:bg-slate-50 dark:bg-lc-surface dark:text-white dark:hover:bg-lc-hover"
                                >
                                    <span className="material-symbols-outlined text-[20px]">edit</span>
                                </button>
                            )}
                        </div>
                        {!readonly && onEdit && (
                            <div className="absolute right-5 top-5">
                                <IconButton icon="edit" label="Edit intro" onClick={() => onEdit("intro")} />
                            </div>
                        )}

                        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="text-[34px] leading-tight font-extrabold text-slate-950 dark:text-white font-nunito">{fullName}</h1>
                                    {profile.pronouns && <span className="text-base text-slate-500 dark:text-slate-400">{profile.pronouns}</span>}
                                </div>
                                <p className="mt-2 max-w-3xl text-[18px] leading-snug text-slate-900 dark:text-slate-100">{profile.headline || "Add a headline that tells recruiters what you do best."}</p>
                                <p className="mt-2 text-[15px] text-slate-500 dark:text-slate-400">
                                    {[profile.city, profile.country].filter(Boolean).join(", ") || user?.location || "Add your location"}
                                    {user?.linkedinUrl && (
                                        <>
                                            <span> · </span>
                                            <a className="font-semibold text-primary" href={user.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>
                                        </>
                                    )}
                                </p>
                                <p className="mt-3 text-primary font-bold">Open to: {profile.openTo || "Add roles you are open to"}</p>
                                <div className="mt-5 flex flex-wrap gap-3">
                                    {!readonly && (
                                        <>
                                            <Link href={profileUrl} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20">
                                                View public profile
                                            </Link>
                                            <button type="button" onClick={() => onEdit?.("resume")} className="rounded-full border border-primary px-5 py-2.5 text-sm font-bold text-primary hover:bg-primary/5">
                                                Attach resume
                                            </button>
                                        </>
                                    )}
                                    {readonly && selectedResume?.previewUrl && (
                                        <a
                                            href={selectedResume.previewUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20"
                                        >
                                            Preview resume
                                        </a>
                                    )}
                                    {!readonly && onConnectGitHub && (
                                        <button
                                            type="button"
                                            onClick={onConnectGitHub}
                                            disabled={githubConnecting}
                                            className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-60 ${
                                                githubConnected
                                                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
                                                    : "border border-slate-300 text-slate-800 hover:bg-slate-50 dark:border-lc-border dark:text-slate-100 dark:hover:bg-lc-hover"
                                            }`}
                                            title="Connect GitHub with repo access so projects, commits, contributors, and code can be analyzed later."
                                        >
                                            <span className="material-symbols-outlined text-[18px]">{githubConnected ? "check_circle" : "code"}</span>
                                            {githubConnecting ? "Connecting..." : githubConnected ? "GitHub connected" : "Connect GitHub"}
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3 text-sm">
                                <div className="rounded-2xl bg-[#f4f6fb] p-4 dark:bg-lc-hover">
                                    <p className="font-bold text-slate-950 dark:text-white">Recruiter URL</p>
                                    <p className="mt-1 break-all text-primary font-semibold">{profileOrigin ? `${profileOrigin}${profileUrl}` : profileUrl}</p>
                                </div>
                                <div className="rounded-2xl bg-[#f4f6fb] p-4 dark:bg-lc-hover">
                                    <p className="font-bold text-slate-950 dark:text-white">Featured resume</p>
                                    {selectedResume?.previewUrl ? (
                                        <a
                                            href={selectedResume.previewUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-1 inline-flex max-w-full break-all font-semibold text-primary hover:underline"
                                        >
                                            {selectedResume.fileName}
                                        </a>
                                    ) : (
                                        <p className="mt-1 text-slate-600 dark:text-slate-300">{selectedResume?.fileName || "No resume selected"}</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <SectionCard title="About" action={!readonly && onEdit ? <IconButton icon="edit" label="Edit about" onClick={() => onEdit("about")} /> : null}>
                    <p className="whitespace-pre-line text-[16px] leading-7 text-slate-800 dark:text-slate-200">
                        {profile.about || "Add a tight, human summary that makes the recruiter understand your strengths, projects, and what you want next."}
                    </p>
                </SectionCard>

                <SectionCard title="Featured" action={!readonly && onEdit ? <IconButton icon="add" label="Add featured" onClick={() => onEdit("featured")} /> : null}>
                    {featured.length ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            {featured.map((item) => (
                                <article
                                    key={item.id}
                                    className="group relative overflow-hidden rounded-2xl bg-white shadow-[0_12px_34px_-18px_rgba(20,40,80,0.22)] dark:bg-lc-surface"
                                >
                                    {!readonly && onEdit && <InlineEditButton label={`Edit ${item.title}`} onClick={() => onEdit("featured", item.id)} />}
                                    <div className="h-40 bg-slate-100 dark:bg-lc-hover">
                                        {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="h-full grid place-items-center text-primary"><span className="material-symbols-outlined text-[48px]">workspaces</span></div>}
                                    </div>
                                    <div className="p-4">
                                        <h3 className="font-bold text-slate-950 dark:text-white">{item.title}</h3>
                                        {item.description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.description}</p>}
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl bg-[#f4f6fb] p-5 text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                            Add projects, launches, writing, certificates, or portfolio media.
                        </div>
                    )}
                </SectionCard>

                <SectionCard title="Projects" action={!readonly && onEdit ? <IconButton icon="add" label="Add project" onClick={() => onEdit("projects")} /> : null}>
                    {projects.length ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            {projects.map((project) => (
                                <article key={project.id} className="group relative overflow-hidden rounded-2xl bg-white shadow-[0_12px_34px_-18px_rgba(20,40,80,0.22)] dark:bg-lc-surface">
                                    {!readonly && onEdit && <InlineEditButton label={`Edit ${project.title}`} onClick={() => onEdit("projects", project.id)} />}
                                    <div className="h-44 bg-slate-100 dark:bg-lc-hover">
                                        {project.imageUrl ? (
                                            <img src={project.imageUrl} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="h-full grid place-items-center text-primary">
                                                <span className="material-symbols-outlined text-[48px]">deployed_code</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <h3 className="font-bold text-lg text-slate-950 dark:text-white">{project.title}</h3>
                                                {project.role && <p className="text-sm font-semibold text-primary">{project.role}</p>}
                                            </div>
                                            {project.startDate && <p className="text-sm text-slate-500 dark:text-slate-400">{monthRange(project.startDate, project.endDate)}</p>}
                                        </div>
                                        {project.description && <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-700 dark:text-slate-300">{project.description}</p>}
                                        {project.technologies?.length ? (
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                {project.technologies.slice(0, 6).map((tech) => (
                                                    <span key={tech} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-lc-hover dark:text-slate-200">{tech}</span>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl bg-[#f4f6fb] p-5 text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                            Add apps, tools, hackathon builds, open-source work, or case-study projects.
                        </div>
                    )}
                </SectionCard>

                <SectionCard title="Experience" action={!readonly && onEdit ? <IconButton icon="add" label="Add experience" onClick={() => onEdit("experience")} /> : null}>
                    <div className="space-y-5">
                        {experiences.length ? experiences.map((entry, index) => (
                            <div key={entry.id} className={`group relative flex gap-4 rounded-lg ${index > 0 ? "border-t border-slate-200 pt-5 dark:border-lc-border" : ""}`}>
                                {!readonly && onEdit && <InlineEditButton label={`Edit ${entry.title}`} onClick={() => onEdit("experience", entry.id)} />}
                                <LogoMark src={entry.logoUrl} label={entry.company} />
                                <div className="min-w-0">
                                    <h3 className="font-bold text-lg text-slate-950 dark:text-white">{entry.title}</h3>
                                    <p className="text-slate-800 dark:text-slate-200">{entry.company}{entry.employmentType ? ` · ${entry.employmentType}` : ""}</p>
                                    <p className="text-slate-500 dark:text-slate-400">{monthRange(entry.startDate, entry.endDate)}</p>
                                    {(entry.location || entry.locationType) && <p className="text-slate-500 dark:text-slate-400">{[entry.location, entry.locationType].filter(Boolean).join(" · ")}</p>}
                                    {entry.description && <p className="mt-3 whitespace-pre-line text-slate-700 dark:text-slate-300">{entry.description}</p>}
                                </div>
                            </div>
                        )) : (
                            <p className="text-slate-600 dark:text-slate-300">Add internships, campus roles, freelance work, open-source contributions, or startup experience.</p>
                        )}
                    </div>
                </SectionCard>

                <SectionCard title="Education" action={!readonly && onEdit ? <IconButton icon="add" label="Add education" onClick={() => onEdit("education")} /> : null}>
                    <div className="space-y-5">
                        {education.length ? education.map((entry, index) => (
                            <div key={entry.id} className={`group relative flex gap-4 rounded-lg ${index > 0 ? "border-t border-slate-200 pt-5 dark:border-lc-border" : ""}`}>
                                {!readonly && onEdit && <InlineEditButton label={`Edit ${entry.school}`} onClick={() => onEdit("education", entry.id)} />}
                                <LogoMark src={entry.logoUrl} label={entry.school} />
                                <div>
                                    <h3 className="font-bold text-lg text-slate-950 dark:text-white">{entry.school}</h3>
                                    <p className="text-slate-800 dark:text-slate-200">{[entry.degree, entry.field].filter(Boolean).join(" in ")}</p>
                                    <p className="text-slate-500 dark:text-slate-400">{monthRange(entry.startDate, entry.endDate)}</p>
                                </div>
                            </div>
                        )) : (
                            <p className="text-slate-600 dark:text-slate-300">Add your college, bootcamp, or most relevant education.</p>
                        )}
                    </div>
                </SectionCard>

                <SectionCard title="Skills" action={!readonly && onEdit ? <><IconButton icon="add" label="Add skill" onClick={() => onEdit("skills")} /><IconButton icon="edit" label="Edit skills" onClick={() => onEdit("skills")} /></> : null}>
                    {skills.length ? (
                        <div className="flex flex-wrap gap-2.5">
                            {skills.map((skill) => (
                                <span
                                    key={skill.id}
                                    title={skill.context || undefined}
                                    className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-primary/10 to-[#7c6fff]/10 px-4 py-2 text-[15px] font-bold text-primary shadow-[0_8px_20px_-12px_rgba(74,124,255,0.5)] transition-transform hover:-translate-y-0.5 dark:from-primary/15 dark:to-[#7c6fff]/15"
                                >
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                                    {skill.name}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-slate-600 dark:text-slate-300">Add the skills recruiters should search for.</p>
                    )}
                </SectionCard>

                <SectionCard title="Coding profiles" action={!readonly && onEdit ? <IconButton icon="edit" label="Edit coding profiles" onClick={() => onEdit("codingProfiles")} /> : null}>
                    {codingProfileCount(profile) ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                            {CODING_PROFILE_ITEMS.map((item) => {
                                const url = getCodingProfileUrl(profile, item.key);
                                if (!url) return null;
                                return (
                                    <a
                                        key={item.key}
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center justify-between rounded-2xl bg-[#f4f6fb] p-4 font-bold text-slate-900 transition-all hover:bg-primary/5 hover:text-primary dark:bg-lc-hover dark:text-white"
                                    >
                                        <span>{item.label}</span>
                                        <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                                    </a>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-slate-600 dark:text-slate-300">Add at least one coding profile before using Quick Apply.</p>
                    )}
                </SectionCard>
            </main>
        </div>
    );
}

export type EditSection = "username" | "intro" | "about" | "experience" | "education" | "skills" | "featured" | "projects" | "resume" | "codingProfiles";

function Field({
    label,
    value,
    onChange,
    textarea = false,
    maxLength,
    inputType = "text",
    improveField,
    improveContext,
    token,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    textarea?: boolean;
    maxLength?: number;
    inputType?: string;
    improveField?: ImproveField;
    improveContext?: string;
    token?: string;
}) {
    const className = "mt-1 w-full rounded-xl border-0 bg-[#f4f6fb] px-4 py-2.5 text-slate-950 outline-none ring-1 ring-transparent transition-all focus:bg-white focus:ring-4 focus:ring-primary/15 dark:bg-lc-hover dark:text-white";
    const canImprove = Boolean(improveField && token);
    const [improving, setImproving] = useState(false);
    const [previous, setPrevious] = useState<string | null>(null);
    const [improveError, setImproveError] = useState("");

    const runImprove = async () => {
        if (!improveField || !token || !value.trim() || improving) return;
        setImproving(true);
        setImproveError("");
        try {
            const improved = await improveText(improveField, value, token, improveContext);
            setPrevious(value);
            onChange(improved);
        } catch (err) {
            setImproveError(err instanceof Error ? err.message : "Could not improve right now.");
        } finally {
            setImproving(false);
        }
    };

    return (
        <label className="block">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</span>
                {canImprove && (
                    <div className="flex items-center gap-1.5">
                        {previous !== null && (
                            <button
                                type="button"
                                onClick={() => { onChange(previous); setPrevious(null); }}
                                className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-lc-hover"
                            >
                                <span className="material-symbols-outlined text-[15px]">undo</span>
                                Undo
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={runImprove}
                            disabled={improving || !value.trim()}
                            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#4A7CFF,#7c6fff)] px-2.5 text-xs font-bold text-white shadow-sm transition-transform hover:scale-[1.03] disabled:opacity-50"
                        >
                            <span className={`material-symbols-outlined text-[15px] ${improving ? "animate-spin" : ""}`}>{improving ? "progress_activity" : "auto_awesome"}</span>
                            {improving ? "Polishing" : "Improve with AI"}
                        </button>
                    </div>
                )}
            </div>
            {textarea ? (
                <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} rows={8} className={className} />
            ) : (
                <input type={inputType} value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} className={className} />
            )}
            <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-xs text-red-500">{improveError}</span>
                {maxLength && <span className="block text-right text-xs text-slate-400">{value.length}/{maxLength}</span>}
            </div>
        </label>
    );
}

function cleanSkillName(name: string): string {
    return name.replace(/\s+/g, " ").trim();
}

function dateInputValue(value?: string | null): string {
    if (!value) return "";
    const trimmed = value.trim();
    const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;
    const isoMonth = /^(\d{4})-(\d{2})$/;
    const dayFirst = /^(\d{2})-(\d{2})-(\d{4})$/;
    if (isoDate.test(trimmed)) return trimmed;
    const monthMatch = trimmed.match(isoMonth);
    if (monthMatch) return `${monthMatch[1]}-${monthMatch[2]}-01`;
    const dayMatch = trimmed.match(dayFirst);
    if (dayMatch) return `${dayMatch[3]}-${dayMatch[2]}-${dayMatch[1]}`;
    return "";
}

function fallbackSkillSuggestions(query: string): SkillSuggestion[] {
    const normalized = normalizeSkillName(query);
    return DEFAULT_SKILLS
        .filter((skill) => !normalized || normalizeSkillName(skill).includes(normalized))
        .slice(0, 10)
        .map((skill) => ({
            id: normalizeSkillName(skill),
            name: skill,
            normalizedName: normalizeSkillName(skill),
            source: "seed",
            usageCount: 0,
        }));
}

function EditModal({
    section,
    itemId,
    user,
    onUserAvatarChange,
    profile,
    setProfile,
    usernameDraft,
    setUsernameDraft,
    usernameStatus,
    onSaveUsername,
    token,
    onCreateSkill,
    onUploadImage,
    onUploadAvatar,
    onUploadResume,
    resumes,
    onClose,
}: {
    section: EditSection;
    itemId?: string | null;
    user: UserProfile | null;
    onUserAvatarChange: (avatarUrl: string) => void;
    profile: JobProfile;
    setProfile: Dispatch<SetStateAction<JobProfile>>;
    usernameDraft: string;
    setUsernameDraft: (value: string) => void;
    usernameStatus: string;
    onSaveUsername: () => void;
    token?: string;
    onCreateSkill: (skillName: string) => Promise<void>;
    onUploadImage: (file: File) => Promise<string>;
    onUploadAvatar: (file: File) => Promise<string>;
    onUploadResume: (file: File) => Promise<ResumeItem>;
    resumes: ResumeItem[];
    onClose: () => void;
}) {
    const safeProfile = normalizeJobProfile(profile);
    const [experience, setExperience] = useState<Experience>(
        safeProfile.experiences.find((item) => item.id === itemId) || { id: id(), title: "", company: "", employmentType: "", startDate: "", endDate: "", location: "", locationType: "", description: "", logoUrl: "" }
    );
    const [education, setEducation] = useState<Education>(
        safeProfile.education.find((item) => item.id === itemId) || { id: id(), school: "", degree: "", field: "", startDate: "", endDate: "", logoUrl: "" }
    );
    const [skillName, setSkillName] = useState("");
    const [draftSkills, setDraftSkills] = useState<Skill[]>(safeProfile.skills);
    const [skillSuggestions, setSkillSuggestions] = useState<SkillSuggestion[]>(fallbackSkillSuggestions(""));
    const [skillSaving, setSkillSaving] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [uploadingResume, setUploadingResume] = useState(false);
    const [localResumes, setLocalResumes] = useState<ResumeItem[]>(resumes);
    const [profileOrigin, setProfileOrigin] = useState("");
    const [featured, setFeatured] = useState<Featured>(
        safeProfile.featured.find((item) => item.id === itemId) || { id: id(), title: "", description: "", imageUrl: "", linkUrl: "" }
    );
    const [project, setProject] = useState<Project>(
        safeProfile.projects.find((item) => item.id === itemId) || { id: id(), title: "", role: "", startDate: "", endDate: "", description: "", technologies: [], imageUrl: "" }
    );

    useEffect(() => {
        setProfileOrigin(window.location.origin);
    }, []);

    const updateExperienceDraft = (next: Experience) => {
        setExperience(next);
        const hasContent = [next.title, next.company, next.employmentType, next.startDate, next.endDate, next.location, next.locationType, next.description].some(Boolean);
        if (!hasContent) return;
        const rest = profile.experiences.filter((item) => item.id !== next.id);
        setProfile({ ...profile, experiences: [next, ...rest].slice(0, 20) });
    };

    const updateEducationDraft = (next: Education) => {
        setEducation(next);
        const hasContent = [next.school, next.degree, next.field, next.startDate, next.endDate].some(Boolean);
        if (!hasContent) return;
        const rest = profile.education.filter((item) => item.id !== next.id);
        setProfile({ ...profile, education: [next, ...rest].slice(0, 20) });
    };

    const updateFeaturedDraft = (next: Featured) => {
        setFeatured(next);
        const hasContent = [next.title, next.description, next.imageUrl, next.linkUrl].some(Boolean);
        if (!hasContent) return;
        const rest = profile.featured.filter((item) => item.id !== next.id);
        setProfile({ ...profile, featured: [next, ...rest].slice(0, 12) });
    };

    const updateProjectDraft = (next: Project) => {
        const normalized = {
            ...next,
            technologies: (next.technologies || []).map(cleanSkillName).filter(Boolean).slice(0, 20),
        };
        setProject(normalized);
        const hasContent = Boolean(normalized.title) && [normalized.role, normalized.startDate, normalized.endDate, normalized.description, normalized.imageUrl, ...(normalized.technologies || [])].some(Boolean);
        if (!hasContent) return;
        const rest = profile.projects.filter((item) => item.id !== normalized.id);
        setProfile({ ...profile, projects: [normalized, ...rest].slice(0, 30) });
    };

    useEffect(() => {
        if (section !== "skills") return;
        const handle = window.setTimeout(() => {
            const fallback = fallbackSkillSuggestions(skillName);
            if (!token) {
                setSkillSuggestions(fallback);
                return;
            }

            api.get<{ skills: SkillSuggestion[] }>(`/skills?q=${encodeURIComponent(skillName)}&limit=10`, token)
                .then((res) => setSkillSuggestions(res.skills.length ? res.skills : fallback))
                .catch(() => setSkillSuggestions(fallback));
        }, 180);

        return () => window.clearTimeout(handle);
    }, [section, skillName, token]);

    const addDraftSkill = async (rawName: string) => {
        const cleaned = cleanSkillName(rawName);
        if (!cleaned) return;

        const alreadyAdded = draftSkills.some((skill) => normalizeSkillName(skill.name) === normalizeSkillName(cleaned));
        const nextSkills = alreadyAdded ? draftSkills : [...draftSkills, { id: id(), name: cleaned, context: "" }].slice(0, 50);
        setDraftSkills(nextSkills);
        setProfile({ ...profile, skills: nextSkills });
        setSkillName("");

        setSkillSaving(true);
        await onCreateSkill(cleaned).catch(() => {});
        setSkillSaving(false);
    };

    const removeDraftSkill = (skillId: string) => {
        const nextSkills = draftSkills.filter((item) => item.id !== skillId);
        setDraftSkills(nextSkills);
        setProfile({ ...profile, skills: nextSkills });
    };

    const uploadProfileImage = async (file: File, applyUrl: (fileUrl: string) => void) => {
        setUploadingImage(true);
        try {
            const fileUrl = await onUploadImage(file);
            applyUrl(fileUrl);
        } catch (err) {
            window.alert(err instanceof Error ? err.message : "Image upload failed");
        } finally {
            setUploadingImage(false);
        }
    };

    const uploadAvatarImage = async (file: File) => {
        setUploadingAvatar(true);
        try {
            const avatarUrl = await onUploadAvatar(file);
            onUserAvatarChange(avatarUrl);
        } catch (err) {
            window.alert(err instanceof Error ? err.message : "Profile photo upload failed");
        } finally {
            setUploadingAvatar(false);
        }
    };

    const save = async () => {
        if (section === "experience" && experience.title && experience.company) {
            const rest = profile.experiences.filter((item) => item.id !== experience.id);
            setProfile({ ...profile, experiences: [experience, ...rest] });
        }
        if (section === "education" && education.school && education.degree) {
            const rest = profile.education.filter((item) => item.id !== education.id);
            setProfile({ ...profile, education: [education, ...rest] });
        }
        if (section === "skills" && skillName.trim()) {
            await addDraftSkill(skillName);
        }
        if (section === "skills") {
            const finalSkills = skillName.trim()
                ? [...draftSkills, { id: id(), name: cleanSkillName(skillName), context: "" }]
                    .filter((skill, index, all) => all.findIndex((item) => normalizeSkillName(item.name) === normalizeSkillName(skill.name)) === index)
                    .slice(0, 50)
                : draftSkills;
            setProfile({ ...profile, skills: finalSkills });
        }
        if (section === "featured" && featured.title) {
            const rest = profile.featured.filter((item) => item.id !== featured.id);
            setProfile({ ...profile, featured: [featured, ...rest] });
        }
        if (section === "projects" && project.title) {
            const rest = profile.projects.filter((item) => item.id !== project.id);
            setProfile({ ...profile, projects: [project, ...rest] });
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[120] bg-slate-950/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-[2rem] sm:rounded-[2rem] bg-white dark:bg-lc-surface shadow-[0_30px_80px_-20px_rgba(20,40,80,0.4)]">
                <div className="sticky top-0 bg-white/95 dark:bg-lc-surface/95 backdrop-blur border-b border-slate-200 dark:border-lc-border px-6 py-4 flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-slate-950 dark:text-white font-nunito">
                        {section === "username" ? "Public profile URL" : section === "resume" ? "Featured resume" : section === "projects" ? "Edit project" : section === "codingProfiles" ? "Coding profiles" : `Edit ${section}`}
                    </h2>
                    <IconButton icon="close" label="Close" onClick={onClose} />
                </div>

                <div className="p-6 space-y-5">
                    {section === "username" && (
                        <>
                            <Field label="Username" value={usernameDraft} onChange={setUsernameDraft} maxLength={32} />
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                {profileOrigin ? `${profileOrigin}/profile/${usernameDraft || "username"}` : `/profile/${usernameDraft || "username"}`}
                            </p>
                            {usernameStatus && <p className="text-sm font-semibold text-primary">{usernameStatus}</p>}
                            <button
                                type="button"
                                onClick={onSaveUsername}
                                disabled={usernameDraft.trim().length < 3}
                                className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                            >
                                Save username
                            </button>
                        </>
                    )}

                    {section === "intro" && (
                        <>
                            <div className="flex items-center gap-4 rounded-2xl bg-[#f4f6fb] p-4 dark:bg-lc-hover">
                                <div className="h-20 w-20 rounded-full overflow-hidden bg-primary text-white grid place-items-center text-2xl font-bold shrink-0">
                                    {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(user?.fullName || "P")}
                                </div>
                                <label className="block flex-1">
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Profile photo</span>
                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (!file) return;
                                            uploadAvatarImage(file);
                                        }}
                                        className="mt-1 w-full rounded-xl border-0 bg-[#f4f6fb] px-4 py-2.5 text-slate-950 outline-none file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-bold file:text-white dark:bg-lc-hover dark:text-white"
                                    />
                                    {uploadingAvatar && <span className="mt-2 block text-sm font-semibold text-primary">Uploading profile photo...</span>}
                                </label>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Full name" value={user?.fullName || ""} onChange={() => {}} />
                                <Field label="Pronouns" value={profile.pronouns || ""} onChange={(v) => setProfile({ ...profile, pronouns: v })} maxLength={40} />
                            </div>
                            <Field label="Headline" value={profile.headline || ""} onChange={(v) => setProfile({ ...profile, headline: v })} maxLength={220} improveField="headline" token={token} />
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Industry" value={profile.industry || ""} onChange={(v) => setProfile({ ...profile, industry: v })} maxLength={120} />
                                <Field label="Profile language" value={profile.profileLanguage} onChange={(v) => setProfile({ ...profile, profileLanguage: v })} maxLength={60} />
                                <Field label="City" value={profile.city || ""} onChange={(v) => setProfile({ ...profile, city: v })} maxLength={120} />
                                <Field label="Country" value={profile.country || ""} onChange={(v) => setProfile({ ...profile, country: v })} maxLength={120} />
                            </div>
                            <Field label="Open to" value={profile.openTo || ""} onChange={(v) => setProfile({ ...profile, openTo: v })} maxLength={180} />
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cover image</span>
                                <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (!file) return;
                                        uploadProfileImage(file, (fileUrl) => setProfile((current) => ({ ...current, coverImageUrl: fileUrl })));
                                    }}
                                    className="mt-1 w-full rounded-xl border-0 bg-[#f4f6fb] px-4 py-2.5 text-slate-950 outline-none file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-bold file:text-white dark:bg-lc-hover dark:text-white"
                                />
                                {profile.coverImageUrl && (
                                    <div className="mt-3 h-28 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-lc-border dark:bg-lc-hover">
                                        <img src={profile.coverImageUrl} alt="" className="h-full w-full object-cover" />
                                    </div>
                                )}
                                {uploadingImage && <span className="mt-2 block text-sm font-semibold text-primary">Uploading image...</span>}
                            </label>
                        </>
                    )}

                    {section === "about" && (
                        <Field label="About" value={profile.about || ""} onChange={(v) => setProfile({ ...profile, about: v })} textarea maxLength={2600} improveField="about" token={token} />
                    )}

                    {section === "experience" && (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Title" value={experience.title} onChange={(v) => updateExperienceDraft({ ...experience, title: v })} maxLength={160} />
                                <Field label="Company" value={experience.company} onChange={(v) => updateExperienceDraft({ ...experience, company: v })} maxLength={160} />
                                <Field label="Employment type" value={experience.employmentType || ""} onChange={(v) => updateExperienceDraft({ ...experience, employmentType: v })} maxLength={80} />
                                <Field label="Location" value={experience.location || ""} onChange={(v) => updateExperienceDraft({ ...experience, location: v })} maxLength={160} />
                                <Field label="Start" inputType="date" value={dateInputValue(experience.startDate)} onChange={(v) => updateExperienceDraft({ ...experience, startDate: v })} />
                                <Field label="End" inputType="date" value={dateInputValue(experience.endDate)} onChange={(v) => updateExperienceDraft({ ...experience, endDate: v })} />
                            </div>
                            <Field label="Description" value={experience.description || ""} onChange={(v) => updateExperienceDraft({ ...experience, description: v })} textarea maxLength={1200} improveField="experience" improveContext={`${experience.title} at ${experience.company}`} token={token} />
                        </>
                    )}

                    {section === "education" && (
                        <>
                            <Field label="School" value={education.school} onChange={(v) => updateEducationDraft({ ...education, school: v })} maxLength={180} />
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Degree" value={education.degree} onChange={(v) => updateEducationDraft({ ...education, degree: v })} maxLength={180} />
                                <Field label="Field" value={education.field || ""} onChange={(v) => updateEducationDraft({ ...education, field: v })} maxLength={180} />
                                <Field label="Start" inputType="date" value={dateInputValue(education.startDate)} onChange={(v) => updateEducationDraft({ ...education, startDate: v })} />
                                <Field label="End" inputType="date" value={dateInputValue(education.endDate)} onChange={(v) => updateEducationDraft({ ...education, endDate: v })} />
                            </div>
                        </>
                    )}

                    {section === "skills" && (
                        <>
                            <div>
                                <label className="block">
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Skill</span>
                                    <input
                                        value={skillName}
                                        onChange={(event) => setSkillName(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                addDraftSkill(skillName);
                                            }
                                        }}
                                        maxLength={80}
                                        className="mt-1 w-full rounded-xl border-0 bg-[#f4f6fb] px-4 py-2.5 text-slate-950 outline-none ring-1 ring-transparent transition-all focus:bg-white focus:ring-4 focus:ring-primary/15 dark:bg-lc-hover dark:text-white"
                                    />
                                    <span className="mt-1 block text-right text-xs text-slate-400">{skillName.length}/80</span>
                                </label>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {skillSuggestions.map((skill) => {
                                        const selected = normalizeSkillName(skill.name) === normalizeSkillName(skillName);
                                        return (
                                            <button
                                                type="button"
                                                key={skill.id}
                                                onClick={() => addDraftSkill(skill.name)}
                                                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                                                    selected
                                                        ? "bg-primary text-white"
                                                        : "bg-slate-100 text-slate-700 hover:bg-primary/10 hover:text-primary dark:bg-lc-hover dark:text-slate-200"
                                                }`}
                                            >
                                                {skill.name}
                                            </button>
                                        );
                                    })}
                                    {skillName.trim() && !skillSuggestions.some((skill) => normalizeSkillName(skill.name) === normalizeSkillName(skillName)) && (
                                        <button
                                            type="button"
                                            onClick={() => addDraftSkill(skillName)}
                                            className="rounded-full border border-primary px-3 py-1.5 text-sm font-bold text-primary"
                                        >
                                            Add &quot;{cleanSkillName(skillName)}&quot;
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {draftSkills.map((skill) => (
                                    <button
                                        type="button"
                                        key={skill.id}
                                        onClick={() => removeDraftSkill(skill.id)}
                                        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm dark:border-lc-border dark:bg-lc-hover dark:text-slate-100"
                                    >
                                        <span>{skill.name}</span>
                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                    </button>
                                ))}
                            </div>
                            {skillSaving && <p className="text-sm font-semibold text-primary">Saving skill...</p>}
                        </>
                    )}

                    {section === "featured" && (
                        <>
                            <Field label="Title" value={featured.title} onChange={(v) => updateFeaturedDraft({ ...featured, title: v })} maxLength={160} />
                            <Field label="Description" value={featured.description || ""} onChange={(v) => updateFeaturedDraft({ ...featured, description: v })} textarea maxLength={500} improveField="featured" improveContext={featured.title} token={token} />
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Featured image</span>
                                <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (!file) return;
                                        uploadProfileImage(file, (fileUrl) => updateFeaturedDraft({ ...featured, imageUrl: fileUrl }));
                                    }}
                                    className="mt-1 w-full rounded-xl border-0 bg-[#f4f6fb] px-4 py-2.5 text-slate-950 outline-none file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-bold file:text-white dark:bg-lc-hover dark:text-white"
                                />
                                {featured.imageUrl && (
                                    <div className="mt-3 h-32 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-lc-border dark:bg-lc-hover">
                                        <img src={featured.imageUrl} alt="" className="h-full w-full object-cover" />
                                    </div>
                                )}
                                {uploadingImage && <span className="mt-2 block text-sm font-semibold text-primary">Uploading image...</span>}
                            </label>
                        </>
                    )}

                    {section === "projects" && (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Project title" value={project.title} onChange={(v) => updateProjectDraft({ ...project, title: v })} maxLength={160} />
                                <Field label="Your role" value={project.role || ""} onChange={(v) => updateProjectDraft({ ...project, role: v })} maxLength={120} />
                                <Field label="Start" inputType="date" value={dateInputValue(project.startDate)} onChange={(v) => updateProjectDraft({ ...project, startDate: v })} />
                                <Field label="End" inputType="date" value={dateInputValue(project.endDate)} onChange={(v) => updateProjectDraft({ ...project, endDate: v })} />
                            </div>
                            <Field label="Description" value={project.description || ""} onChange={(v) => updateProjectDraft({ ...project, description: v })} textarea maxLength={1200} improveField="project" improveContext={project.title} token={token} />
                            <Field
                                label="Technologies"
                                value={(project.technologies || []).join(", ")}
                                onChange={(v) => updateProjectDraft({ ...project, technologies: v.split(",").map((item) => item.trim()).filter(Boolean) })}
                                maxLength={300}
                            />
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Project image</span>
                                <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (!file) return;
                                        uploadProfileImage(file, (fileUrl) => updateProjectDraft({ ...project, imageUrl: fileUrl }));
                                    }}
                                    className="mt-1 w-full rounded-xl border-0 bg-[#f4f6fb] px-4 py-2.5 text-slate-950 outline-none file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-bold file:text-white dark:bg-lc-hover dark:text-white"
                                />
                                {project.imageUrl && (
                                    <div className="mt-3 h-36 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-lc-border dark:bg-lc-hover">
                                        <img src={project.imageUrl} alt="" className="h-full w-full object-cover" />
                                    </div>
                                )}
                                {uploadingImage && <span className="mt-2 block text-sm font-semibold text-primary">Uploading image...</span>}
                            </label>
                        </>
                    )}

                    {section === "resume" && (
                        <div className="space-y-4">
                            <label className="block">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Upload resume PDF</span>
                                <input
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    onChange={async (event) => {
                                        const file = event.target.files?.[0];
                                        if (!file) return;
                                        setUploadingResume(true);
                                        try {
                                            const resume = await onUploadResume(file);
                                            setLocalResumes((current) => [resume, ...current.filter((item) => item.id !== resume.id)]);
                                            setProfile({ ...profile, selectedResumeId: resume.id });
                                        } catch (err) {
                                            window.alert(err instanceof Error ? err.message : "Resume upload failed");
                                        } finally {
                                            setUploadingResume(false);
                                        }
                                    }}
                                    className="mt-1 w-full rounded-xl border-0 bg-[#f4f6fb] px-4 py-2.5 text-slate-950 outline-none file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-bold file:text-white dark:bg-lc-hover dark:text-white"
                                />
                                {uploadingResume && <span className="mt-2 block text-sm font-semibold text-primary">Uploading resume...</span>}
                            </label>

                            {localResumes.length ? localResumes.map((resume) => (
                                <label key={resume.id} className="flex items-center gap-3 rounded-2xl bg-[#f4f6fb] p-4 dark:bg-lc-hover">
                                    <input
                                        type="radio"
                                        checked={profile.selectedResumeId === resume.id}
                                        onChange={() => setProfile({ ...profile, selectedResumeId: resume.id })}
                                    />
                                    <span className="font-semibold text-slate-900 dark:text-white">{resume.fileName}</span>
                                </label>
                            )) : (
                                <p className="text-slate-600 dark:text-slate-300">No resumes uploaded yet.</p>
                            )}
                        </div>
                    )}

                    {section === "codingProfiles" && (
                        <div className="space-y-4">
                            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                                Add links for the coding platforms you use. You do not need all four, but Quick Apply needs at least one.
                            </p>
                            {CODING_PROFILE_ITEMS.map((item) => (
                                <Field
                                    key={item.key}
                                    label={`${item.label} profile URL`}
                                    value={getCodingProfileUrl(profile, item.key)}
                                    onChange={(value) => setProfile({ ...profile, [item.key]: value })}
                                    maxLength={500}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {section !== "username" && (
                    <div className="sticky bottom-0 bg-white/95 dark:bg-lc-surface/95 backdrop-blur border-t border-slate-200 dark:border-lc-border px-6 py-4 flex justify-end">
                        <button
                            type="button"
                            onClick={save}
                            disabled={skillSaving || uploadingImage || uploadingAvatar || uploadingResume}
                            className="rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                        >
                            {skillSaving || uploadingImage || uploadingAvatar || uploadingResume ? "Uploading..." : "Save"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function JobProfileBuilder() {
    const { user: authUser, session, loading: authLoading } = useAuth();
    const [user, setUser] = useState<UserProfile | null>(null);
    const [profile, setProfile] = useState<JobProfile>(emptyProfile);
    const [resumes, setResumes] = useState<ResumeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [editSection, setEditSection] = useState<EditSection | null>(null);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [githubConnecting, setGithubConnecting] = useState(false);
    const [githubIntegration, setGithubIntegration] = useState<GitHubIntegrationPayload | null>(null);
    const [notice, setNotice] = useState<{ title: string; message: string; tone?: "info" | "success" | "error" } | null>(null);
    const [mode, setMode] = useState<"onboarding" | "review">("review");
    const modeInitialized = useRef(false);
    const savedProviderTokenRef = useRef<string | null>(null);
    const [usernameDraft, setUsernameDraft] = useState("");
    const [usernameStatus, setUsernameStatus] = useState("");
    const skipNextDraftWrite = useRef(false);
    const loadedProfileKey = useRef<string | null>(null);
    const hasHydratedProfile = useRef(false);
    const savedProfileSnapshotRef = useRef<string | null>(null);
    const savedUsernameRef = useRef("");

    const token = session?.access_token;
    const authUserId = authUser?.id;
    const githubIdentity = session?.user?.identities?.find((identity) => identity.provider === "github") as any;
    const githubConnected = Boolean(githubIntegration?.connected || githubIdentity);

    useEffect(() => {
        document.title = "Create Profile | Mockr";
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const errorCode = params.get("error_code") || hashParams.get("error_code");
        const errorDescription = params.get("error_description") || hashParams.get("error_description");
        const hasOAuthParams = Boolean(
            params.get("error") ||
            params.get("error_code") ||
            params.get("error_description") ||
            hashParams.get("error") ||
            hashParams.get("error_code") ||
            hashParams.get("error_description")
        );

        if (errorCode === "identity_already_exists") {
            setGithubIntegration((current) => current || { connected: true, integration: null });
            setNotice({
                title: "GitHub already connected",
                message: "This GitHub account is already linked. You can continue using it for project analysis.",
                tone: "success",
            });
        } else if (errorDescription) {
            setNotice({
                title: "GitHub connection issue",
                message: errorDescription.replace(/\+/g, " "),
                tone: "error",
            });
        }

        if (hasOAuthParams) {
            window.history.replaceState(null, "", window.location.pathname);
        }
    }, []);

    useEffect(() => {
        if (authLoading) return;
        if (!token) {
            setLoading(false);
            return;
        }
        const loadKey = `${authUserId || "pending"}:${token.slice(0, 16)}`;
        if (loadedProfileKey.current === loadKey && hasHydratedProfile.current) return;
        loadedProfileKey.current = loadKey;

        let mounted = true;
        if (!hasHydratedProfile.current) {
            setLoading(true);
        }

        Promise.all([
            api.get<ApiPayload>("/job-profiles/me", token),
            api.get<{ resumes: ResumeItem[] }>("/resumes", token).catch(() => ({ resumes: [] })),
            api.get<GitHubIntegrationPayload>("/github/integration", token).catch(() => ({ connected: false, integration: null })),
        ])
            .then(([payload, resumePayload, githubPayload]) => {
                if (!mounted) return;
                const resolved = profileFromPayload(payload, authUser as any);
                const storedDraft = readStoredProfileDraft(resolved.user?.id);
                const savedUsername = resolved.user?.username ?? "";
                const savedProfileSnapshot = profileDraftSnapshot(resolved.profile);
                const shouldRestoreDraft = Boolean(
                    storedDraft &&
                    hasMeaningfulDraftChanges(
                        storedDraft.profile,
                        storedDraft.usernameDraft ?? savedUsername,
                        savedProfileSnapshot,
                        savedUsername
                    )
                );
                savedProfileSnapshotRef.current = savedProfileSnapshot;
                savedUsernameRef.current = savedUsername;
                if (storedDraft && !shouldRestoreDraft) clearStoredProfileDraft(resolved.user?.id);
                setUser(resolved.user);
                setProfile(shouldRestoreDraft && storedDraft ? storedDraft.profile : resolved.profile);
                setUsernameDraft(shouldRestoreDraft && storedDraft ? storedDraft.usernameDraft : savedUsername);
                setResumes(resumePayload.resumes || []);
                setGithubIntegration(githubPayload);
                if (shouldRestoreDraft && !hasHydratedProfile.current) setMessage("Unsaved draft restored.");
                hasHydratedProfile.current = true;
            })
            .catch(() => {
                if (!mounted) return;
                const resolved = profileFromPayload(null, authUser as any);
                const storedDraft = readStoredProfileDraft(resolved.user?.id);
                const savedUsername = resolved.user?.username ?? "";
                const savedProfileSnapshot = profileDraftSnapshot(resolved.profile);
                const shouldRestoreDraft = Boolean(
                    storedDraft &&
                    hasMeaningfulDraftChanges(
                        storedDraft.profile,
                        storedDraft.usernameDraft ?? savedUsername,
                        savedProfileSnapshot,
                        savedUsername
                    )
                );
                savedProfileSnapshotRef.current = savedProfileSnapshot;
                savedUsernameRef.current = savedUsername;
                if (storedDraft && !shouldRestoreDraft) clearStoredProfileDraft(resolved.user?.id);
                setUser(resolved.user);
                setProfile(shouldRestoreDraft && storedDraft ? storedDraft.profile : resolved.profile);
                setUsernameDraft(shouldRestoreDraft && storedDraft ? storedDraft.usernameDraft : savedUsername);
                if (shouldRestoreDraft && !hasHydratedProfile.current) setMessage("Unsaved draft restored.");
                hasHydratedProfile.current = true;
            })
            .finally(() => mounted && setLoading(false));
        return () => { mounted = false; };
    }, [authLoading, token, authUserId]);

    useEffect(() => {
        if (!token || !session) return;
        const providerToken = (session as any).provider_token as string | undefined;
        if (!providerToken || savedProviderTokenRef.current === providerToken) return;

        const identities = (session.user?.identities || []) as any[];
        const github = identities.find((identity) => identity.provider === "github");
        if (!github) return;

        savedProviderTokenRef.current = providerToken;
        const identityData = github.identity_data || {};
        const scopes = typeof (session as any).provider_token_scope === "string"
            ? (session as any).provider_token_scope.split(/[,\s]+/).filter(Boolean)
            : ["repo", "read:user", "user:email"];

        api.post<GitHubIntegrationPayload>("/github/integration", {
            accessToken: providerToken,
            refreshToken: (session as any).provider_refresh_token || null,
            scopes,
            githubUserId: String(identityData.provider_id || identityData.sub || github.id || ""),
            githubUsername: identityData.user_name || identityData.preferred_username || identityData.name || null,
        }, token)
            .then((payload) => {
                setGithubIntegration(payload);
                setMessage("GitHub connected. We can use this later to analyze repositories, commits, contributors, and code quality.");
            })
            .catch((err) => {
                savedProviderTokenRef.current = null;
                setMessage(err instanceof ApiError ? err.message : "GitHub connected, but token storage failed.");
            });
    }, [session, token]);

    useEffect(() => {
        if (loading || !user?.id) return;
        if (skipNextDraftWrite.current) {
            skipNextDraftWrite.current = false;
            return;
        }

        const handle = window.setTimeout(() => {
            if (!hasMeaningfulDraftChanges(profile, usernameDraft, savedProfileSnapshotRef.current, savedUsernameRef.current)) {
                clearStoredProfileDraft(user.id);
                return;
            }
            writeStoredProfileDraft(user.id, profile, usernameDraft);
        }, 250);

        return () => window.clearTimeout(handle);
    }, [loading, profile, user?.id, usernameDraft]);

    useEffect(() => {
        if (loading || !user?.id) return;

        const persistDraft = () => {
            if (!hasMeaningfulDraftChanges(profile, usernameDraft, savedProfileSnapshotRef.current, savedUsernameRef.current)) {
                clearStoredProfileDraft(user.id);
                return;
            }
            writeStoredProfileDraft(user.id, profile, usernameDraft);
        };
        const persistWhenHidden = () => {
            if (document.visibilityState === "hidden") persistDraft();
        };

        document.addEventListener("visibilitychange", persistWhenHidden);
        window.addEventListener("pagehide", persistDraft);
        return () => {
            document.removeEventListener("visibilitychange", persistWhenHidden);
            window.removeEventListener("pagehide", persistDraft);
        };
    }, [loading, profile, user?.id, usernameDraft]);

    useEffect(() => {
        if (!token || !usernameDraft || usernameDraft.length < 3 || usernameDraft === user?.username) {
            setUsernameStatus("");
            return;
        }
        const handle = window.setTimeout(() => {
            api.get<{ available: boolean; username: string }>(`/job-profiles/username/${encodeURIComponent(usernameDraft)}`, token)
                .then((res) => setUsernameStatus(res.available ? `${res.username} is available` : `${res.username} is taken`))
                .catch((err) => setUsernameStatus(err instanceof ApiError ? err.message : "Could not check this username"));
        }, 450);
        return () => window.clearTimeout(handle);
    }, [token, usernameDraft, user?.username]);

    const usernameReady = Boolean(user?.username) && usernameDraft === user?.username;

    // First-time visitors (no published profile) land in the guided flow;
    // returning users go straight to the review/editor.
    useEffect(() => {
        if (loading || modeInitialized.current) return;
        modeInitialized.current = true;
        setMode(profile.isPublished ? "review" : "onboarding");
    }, [loading, profile.isPublished]);

    const saveProfile = async (nextProfile = profile) => {
        if (!token) return;
        if (!usernameReady) {
            setMessage("Save a unique username before saving your public profile.");
            setEditingItemId(null);
            setEditSection("username");
            return;
        }
        const profileToSave = { ...nextProfile, isPublished: true };
        setSaving(true);
        setMessage("");
        try {
            const payload = await api.put<{ profile: JobProfile }>("/job-profiles/me", profileToSave, token);
            const savedProfile = normalizeJobProfile({ ...profileToSave, ...payload.profile });
            savedProfileSnapshotRef.current = profileDraftSnapshot(savedProfile);
            savedUsernameRef.current = usernameDraft;
            skipNextDraftWrite.current = true;
            clearStoredProfileDraft(user?.id);
            setProfile(savedProfile);
            setMessage("Profile saved.");
        } catch (err) {
            setMessage(err instanceof ApiError ? err.message : "Could not save profile.");
        } finally {
            setSaving(false);
        }
    };

    const saveUsername = async () => {
        if (!token) return;
        try {
            const result = await api.patch<{ username: string }>("/job-profiles/username", { username: usernameDraft }, token);
            savedUsernameRef.current = result.username;
            if (!hasMeaningfulDraftChanges(profile, result.username, savedProfileSnapshotRef.current, savedUsernameRef.current)) {
                skipNextDraftWrite.current = true;
                clearStoredProfileDraft(user?.id);
            }
            setUser((current) => current ? { ...current, username: result.username } : current);
            setUsernameDraft(result.username);
            setUsernameStatus("Username saved.");
            setMessage("Username saved. You can now save your public profile.");
        } catch (err) {
            setUsernameStatus(err instanceof ApiError ? err.message : "Could not save username.");
        }
    };

    const createSkillSuggestion = async (skillName: string) => {
        if (!token) return;
        await api.post("/skills", { name: skillName }, token);
    };

    const uploadProfileImage = async (file: File) => {
        if (!token) throw new Error("Missing session");
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`${getApiBaseUrl()}/job-profiles/assets`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
            credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || payload.error || "Image upload failed");
        }
        return payload.fileUrl as string;
    };

    const uploadResume = async (file: File): Promise<ResumeItem> => {
        if (!token) throw new Error("Missing session");
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`${getApiBaseUrl()}/resumes/upload`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
            credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || payload.error || "Resume upload failed");
        }
        const resume = {
            id: payload.id,
            fileName: payload.fileName || file.name,
            uploadedAt: payload.uploadedAt || new Date().toISOString(),
        };
        setResumes((current) => [resume, ...current.filter((item) => item.id !== resume.id)]);
        return resume;
    };

    const uploadAvatar = async (file: File): Promise<string> => {
        if (!token) throw new Error("Missing session");
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`${getApiBaseUrl()}/users/me/avatar`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
            credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || payload.error || "Profile photo upload failed");
        }
        const avatarUrl = payload.avatarUrl as string;
        setUser((current) => current ? { ...current, avatarUrl } : current);
        return avatarUrl;
    };

    const openEditor = (section: EditSection, itemId?: string) => {
        setEditingItemId(itemId ?? null);
        setEditSection(section);
    };

    const connectGitHub = async () => {
        setGithubConnecting(true);
        setMessage("");
        try {
            const supabase = createSupabaseBrowserClient();
            const { data, error } = await supabase.auth.linkIdentity({
                provider: "github",
                options: {
                    redirectTo: `${window.location.origin}/job-profile`,
                    scopes: "repo read:user user:email",
                },
            });
            if (error) throw error;

            const redirectUrl = (data as { url?: string } | null)?.url;
            if (redirectUrl) {
                window.location.assign(redirectUrl);
                return;
            }

            setMessage("GitHub connection started. Complete the GitHub consent screen to continue.");
            setGithubConnecting(false);
        } catch (err) {
            setMessage(err instanceof Error ? err.message : "Could not start GitHub connection.");
            setGithubConnecting(false);
        }
    };

    if (loading || authLoading) {
        return (
            <div className="min-h-[70vh] grid place-items-center">
                <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-full bg-gradient-to-br from-[#FAFBFC] via-white to-[#eef3fb] dark:bg-lc-bg pb-10">
            {mode === "onboarding" ? (
                <JobProfileOnboarding
                    user={user}
                    profile={profile}
                    setProfile={setProfile}
                    resumes={resumes}
                    token={token}
                    usernameDraft={usernameDraft}
                    setUsernameDraft={(value) => setUsernameDraft(value.toLowerCase())}
                    usernameStatus={usernameStatus}
                    usernameReady={usernameReady}
                    onSaveUsername={saveUsername}
                    onUploadImage={uploadProfileImage}
                    onUploadAvatar={uploadAvatar}
                    onUploadResume={uploadResume}
                    onUserAvatarChange={(avatarUrl) => setUser((current) => current ? { ...current, avatarUrl } : current)}
                    githubConnected={githubConnected}
                    githubConnecting={githubConnecting}
                    onConnectGitHub={connectGitHub}
                    saving={saving}
                    onFinish={async () => {
                        await saveProfile();
                        setMode("review");
                        if (typeof window !== "undefined") window.scrollTo({ top: 0 });
                    }}
                    onSkipToReview={() => setMode("review")}
                />
            ) : (
            <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6 py-6">
                <div className="mb-5 rounded-[1.5rem] bg-white p-5 shadow-[0_18px_50px_-24px_rgba(20,40,80,0.16)] dark:bg-lc-surface">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h1 className="text-[30px] font-extrabold text-slate-950 dark:text-white font-nunito">Create your recruiter profile</h1>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" onClick={() => setMode("onboarding")} className="inline-flex items-center gap-1.5 rounded-full border border-primary px-5 py-2.5 text-sm font-bold text-primary hover:bg-primary/5">
                                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                                Guided setup
                            </button>
                            <button type="button" onClick={() => saveProfile()} disabled={saving || !usernameReady} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                                {saving ? "Saving..." : "Save changes"}
                            </button>
                        </div>
                    </div>
                    {!usernameReady && (
                        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                            <span>Save a unique username first so your profile has a stable public URL.</span>
                            <button type="button" onClick={() => openEditor("username")} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-amber-700 shadow-sm dark:bg-lc-hover dark:text-amber-100">
                                Set username
                            </button>
                        </div>
                    )}
                    {message && <p className="mt-3 text-sm font-semibold text-primary">{message}</p>}
                </div>

                <ProfilePreview
                    user={user}
                    profile={profile}
                    resumes={resumes}
                    onEdit={openEditor}
                    onConnectGitHub={connectGitHub}
                    githubConnected={githubConnected}
                    githubConnecting={githubConnecting}
                />
            </div>
            )}

            {editSection && (
                <EditModal
                    key={`${editSection}:${editingItemId ?? "new"}`}
                    section={editSection}
                    itemId={editingItemId}
                    user={user}
                    onUserAvatarChange={(avatarUrl) => setUser((current) => current ? { ...current, avatarUrl } : current)}
                    profile={profile}
                    setProfile={setProfile}
                    usernameDraft={usernameDraft}
                    setUsernameDraft={(value) => setUsernameDraft(value.toLowerCase())}
                    usernameStatus={usernameStatus}
                    onSaveUsername={saveUsername}
                    token={token}
                    onCreateSkill={createSkillSuggestion}
                    onUploadImage={uploadProfileImage}
                    onUploadAvatar={uploadAvatar}
                    onUploadResume={uploadResume}
                    resumes={resumes}
                    onClose={() => {
                        setEditSection(null);
                        setEditingItemId(null);
                    }}
                />
            )}
            {notice && (
                <NoticeModal
                    title={notice.title}
                    message={notice.message}
                    tone={notice.tone}
                    onClose={() => setNotice(null)}
                />
            )}
        </div>
    );
}

export function PublicJobProfile({ username }: { username: string }) {
    const { session, loading } = useAuth();
    const [payload, setPayload] = useState<ApiPayload | null>(null);
    const [failed, setFailed] = useState(false);
    const [profileLoading, setProfileLoading] = useState(true);

    useEffect(() => {
        if (loading) return;
        if (!session?.access_token) {
            setProfileLoading(false);
            return;
        }

        let mounted = true;
        setProfileLoading(true);
        setFailed(false);
        setPayload(null);

        api.get<ApiPayload>(`/job-profiles/by-username/${encodeURIComponent(username)}`, session.access_token)
            .then((data) => {
                if (mounted) setPayload(data);
            })
            .catch(() => {
                if (mounted) setFailed(true);
            })
            .finally(() => {
                if (mounted) setProfileLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [loading, session?.access_token, username]);

    const resolved = profileFromPayload(payload, null);

    if (loading || profileLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-lc-bg grid place-items-center px-4">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">Loading profile...</p>
                </div>
            </div>
        );
    }

    if (!session?.access_token && !loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-lc-bg grid place-items-center px-4">
                <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <h1 className="text-3xl font-extrabold text-slate-950 dark:text-white font-nunito">Profile preview is protected</h1>
                    <p className="mt-3 text-slate-600 dark:text-slate-300">The public URL shape is ready at /profile/{username}. Open recruiter access after the public-read policy is finalized.</p>
                    <Link href="/login" className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white">Sign in</Link>
                </div>
            </div>
        );
    }

    if (failed) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-lc-bg grid place-items-center px-4">
                <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <h1 className="text-3xl font-extrabold text-slate-950 dark:text-white font-nunito">Profile not found</h1>
                    <p className="mt-3 text-slate-600 dark:text-slate-300">This profile may still be a draft.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-lc-bg">
            <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6 py-6">
                <ProfilePreview user={resolved.user} profile={resolved.profile} resumes={payload?.resume ? [payload.resume] : []} readonly />
                <p className="mt-6 text-center text-xs text-slate-400">Data served by {getApiBaseUrl()}</p>
            </div>
        </div>
    );
}
