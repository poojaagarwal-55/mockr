"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type CandidateJob = {
    id: string;
    companyName: string;
    companyLogoUrl?: string | null;
    title: string;
    location?: string | null;
    workMode?: string | null;
    employmentType?: string | null;
    roleType?: string | null;
    travel?: string | null;
    openings?: number;
    experienceLevel?: string | null;
    compensationType?: string | null;
    compensation?: string | null;
    duration?: string | null;
    timeCommitment?: string | null;
    applicationDeadline?: string | null;
    skills?: string[];
    companyOverview?: string | null;
    aboutRole?: string | null;
    responsibilities?: string[];
    requirements?: string[];
    benefits?: string[];
    applicationNote?: string | null;
    publishedAt?: string | null;
    createdAt: string;
    applied?: boolean;
};

type JobsResponse = {
    jobs: CandidateJob[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
};

type CodingProfiles = {
    leetcodeUrl?: string | null;
    geeksforgeeksUrl?: string | null;
    codeforcesUrl?: string | null;
    codechefUrl?: string | null;
};

type ApplicationReadiness = {
    profileReady: boolean;
    githubConnected: boolean;
    githubUsername?: string | null;
    codingProfiles: CodingProfiles;
    hasCodingProfile: boolean;
};

type GitHubRepo = {
    id: string;
    nodeId?: string | null;
    name: string;
    fullName: string;
    htmlUrl?: string | null;
    description?: string | null;
    fork: boolean;
    private: boolean;
    language?: string | null;
    defaultBranch?: string | null;
    updatedAt?: string | null;
    pushedAt?: string | null;
    stars?: number;
};

type ApplyStep = "idle" | "profile" | "github" | "coding" | "projects" | "submitting" | "success" | "error";

function formatDate(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

function deadlineExpired(value?: string | null) {
    if (!value) return false;
    const deadline = new Date(value);
    if (Number.isNaN(deadline.getTime())) return false;
    deadline.setHours(23, 59, 59, 999);
    return deadline.getTime() < Date.now();
}

function daysLeft(value?: string | null) {
    if (!value) return "";
    const deadline = new Date(value);
    if (Number.isNaN(deadline.getTime())) return "";
    deadline.setHours(23, 59, 59, 999);
    const diff = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
    if (diff < 0) return "Closed";
    if (diff === 0) return "Last day";
    return `${diff} day${diff === 1 ? "" : "s"} left`;
}

function compactWorkMode(job: CandidateJob) {
    return [job.workMode, job.location].filter(Boolean).join(" | ");
}

function splitVisibleSkills(skills?: string[]) {
    const clean = (skills || []).filter(Boolean);
    return {
        visible: clean.slice(0, 3),
        extra: Math.max(clean.length - 3, 0),
    };
}

function isGitHubReconnectError(error: unknown) {
    if (!(error instanceof ApiError)) return false;
    const body = error.body as { error?: string; message?: string } | undefined;
    return error.status === 409 && (
        body?.error === "GitHub Required" ||
        /github/i.test(body?.message || error.message)
    );
}

function DetailPill({ icon, children }: { icon: string; children: string }) {
    if (!children) return null;
    return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            <span className="material-symbols-outlined text-[18px] text-slate-600 dark:text-slate-400">{icon}</span>
            {children}
        </span>
    );
}

function JobLogo({ job, size = "large" }: { job: CandidateJob; size?: "large" | "small" }) {
    if (!job.companyLogoUrl) return null;
    return (
        <div className={`${size === "large" ? "size-20" : "size-14"} grid shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-elevated`}>
            <img src={job.companyLogoUrl} alt="" className="h-full w-full object-contain p-2" />
        </div>
    );
}

function JobCard({ job, onOpen }: { job: CandidateJob; onOpen: () => void }) {
    const posted = formatDate(job.publishedAt || job.createdAt);
    const remaining = daysLeft(job.applicationDeadline);
    const { visible, extra } = splitVisibleSkills(job.skills);
    const workMode = compactWorkMode(job);
    const tags = [job.roleType, job.compensationType === "Not disclosed" ? "" : job.compensationType, job.duration].filter(Boolean);
    const compensation = job.compensation?.trim();

    return (
        <article
            onClick={onOpen}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md dark:border-lc-border dark:bg-lc-surface"
        >
            <div className="flex gap-5">
                <div className="min-w-0 flex-1">
                    <h2 className="font-nunito text-2xl font-extrabold leading-tight text-slate-950 dark:text-white">
                        {job.title}
                    </h2>
                    <p className="mt-1 text-lg font-medium text-slate-900 dark:text-slate-200">{job.companyName}</p>

                    {(job.experienceLevel || job.employmentType || workMode) && (
                        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                            <DetailPill icon="business_center">{job.experienceLevel || ""}</DetailPill>
                            <DetailPill icon="schedule">{job.employmentType || ""}</DetailPill>
                            <DetailPill icon="location_on">{workMode}</DetailPill>
                        </div>
                    )}

                    {(visible.length > 0 || extra > 0) && (
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-800 dark:text-slate-300">
                            {visible.map((skill, index) => (
                                <span key={skill} className="inline-flex items-center gap-3">
                                    <span>{skill}</span>
                                    {index < visible.length - 1 && <span className="text-slate-300">/</span>}
                                </span>
                            ))}
                            {extra > 0 && <span>+{extra}</span>}
                        </div>
                    )}

                    {tags.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-2">
                            {tags.map((tag) => (
                                <span key={tag} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <JobLogo job={job} />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-5 text-sm font-medium text-sky-800 dark:text-sky-300">
                    {posted && <span>Posted {posted}</span>}
                    {remaining && (
                        <span className="inline-flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[18px]">hourglass_top</span>
                            {remaining}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    {compensation && (
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-extrabold text-slate-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
                            {compensation}
                        </span>
                    )}
                    <button
                        type="button"
                        aria-label="Share job"
                        onClick={(event) => event.stopPropagation()}
                        className="grid size-10 place-items-center rounded-full text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover"
                    >
                        <span className="material-symbols-outlined">share</span>
                    </button>
                    <button
                        type="button"
                        aria-label="Save job"
                        onClick={(event) => event.stopPropagation()}
                        className="grid size-10 place-items-center rounded-full text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover"
                    >
                        <span className="material-symbols-outlined">favorite</span>
                    </button>
                </div>
            </div>
        </article>
    );
}

function TextBlock({ title, text }: { title: string; text?: string | null }) {
    if (!text?.trim()) return null;
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="border-l-4 border-primary pl-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-700 dark:text-slate-300">{text}</p>
        </section>
    );
}

function ListBlock({ title, items }: { title: string; items?: string[] }) {
    const clean = (items || []).filter(Boolean);
    if (!clean.length) return null;
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="border-l-4 border-primary pl-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-sm leading-7 text-slate-700 dark:text-slate-300">
                {clean.map((item) => (
                    <li key={item}>{item}</li>
                ))}
            </ul>
        </section>
    );
}

function InfoCard({ icon, title, lines }: { icon: string; title: string; lines: Array<string | null | undefined> }) {
    const clean = lines.filter(Boolean) as string[];
    if (!clean.length) return null;
    return (
        <div className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <span className="material-symbols-outlined">{icon}</span>
            </span>
            <div>
                <p className="font-bold text-slate-950 dark:text-white">{title}</p>
                {clean.map((line, index) => (
                    <p key={`${line}-${index}`} className="mt-1 text-sm text-slate-600 dark:text-slate-300">{line}</p>
                ))}
            </div>
        </div>
    );
}

function CodingProfileField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="https://..."
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-950 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
            />
        </label>
    );
}

function ApplyModal({
    job,
    step,
    error,
    repos,
    selectedRepoIds,
    codingDraft,
    onCodingDraftChange,
    onClose,
    onCreateProfile,
    onConnectGithub,
    onSaveCodingProfiles,
    onToggleRepo,
    onSubmit,
}: {
    job: CandidateJob;
    step: ApplyStep;
    error: string;
    repos: GitHubRepo[];
    selectedRepoIds: string[];
    codingDraft: Required<Record<keyof CodingProfiles, string>>;
    onCodingDraftChange: (next: Required<Record<keyof CodingProfiles, string>>) => void;
    onClose: () => void;
    onCreateProfile: () => void;
    onConnectGithub: () => void;
    onSaveCodingProfiles: () => void;
    onToggleRepo: (repo: GitHubRepo) => void;
    onSubmit: () => void;
}) {
    const selectedCount = selectedRepoIds.length;

    return (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-lc-border">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Quick Apply</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{job.title}</h2>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    {step === "profile" && (
                        <div className="rounded-xl bg-slate-50 p-5 dark:bg-lc-hover">
                            <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Create your recruiter profile first</h3>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                Your public job profile is shared with recruiters when you apply, so finish that once before using Quick Apply.
                            </p>
                            <button type="button" onClick={onCreateProfile} className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white">Create profile</button>
                        </div>
                    )}

                    {step === "github" && (
                        <div className="rounded-xl bg-slate-50 p-5 dark:bg-lc-hover">
                            <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Connect GitHub</h3>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                Connect GitHub so you can choose the projects you want to share with recruiters for this application.
                            </p>
                            {error && (
                                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
                                    {error}
                                </p>
                            )}
                            <button type="button" onClick={onConnectGithub} className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white">Connect GitHub</button>
                        </div>
                    )}

                    {step === "coding" && (
                        <div className="space-y-4">
                            <div>
                                <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Add at least one coding profile</h3>
                                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    Add only the platforms below. We save these to your recruiter profile for future applications.
                                </p>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <CodingProfileField label="LeetCode" value={codingDraft.leetcodeUrl} onChange={(value) => onCodingDraftChange({ ...codingDraft, leetcodeUrl: value })} />
                                <CodingProfileField label="GeeksForGeeks" value={codingDraft.geeksforgeeksUrl} onChange={(value) => onCodingDraftChange({ ...codingDraft, geeksforgeeksUrl: value })} />
                                <CodingProfileField label="Codeforces" value={codingDraft.codeforcesUrl} onChange={(value) => onCodingDraftChange({ ...codingDraft, codeforcesUrl: value })} />
                                <CodingProfileField label="CodeChef" value={codingDraft.codechefUrl} onChange={(value) => onCodingDraftChange({ ...codingDraft, codechefUrl: value })} />
                            </div>
                            <button type="button" onClick={onSaveCodingProfiles} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white">Save and continue</button>
                        </div>
                    )}

                    {step === "projects" && (
                        <div className="space-y-4">
                            <div>
                                <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Select up to 3 best projects</h3>
                                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    Choose the repositories that best represent the work you want recruiters to review.
                                </p>
                            </div>
                            <div className="grid max-h-[430px] gap-3 overflow-y-auto pr-1">
                                {repos.map((repo) => {
                                    const selected = selectedRepoIds.includes(repo.fullName);
                                    const disabled = !selected && selectedCount >= 3;
                                    return (
                                        <button
                                            type="button"
                                            key={repo.fullName}
                                            onClick={() => onToggleRepo(repo)}
                                            disabled={disabled}
                                            className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                                selected
                                                    ? "border-primary bg-primary/5"
                                                    : "border-slate-200 hover:border-primary/40 dark:border-lc-border dark:hover:border-primary/50"
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="font-bold text-slate-950 dark:text-white">{repo.fullName}</p>
                                                    {repo.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{repo.description}</p>}
                                                </div>
                                                <span className={`material-symbols-outlined ${selected ? "text-primary" : "text-slate-300"}`}>{selected ? "check_circle" : "radio_button_unchecked"}</span>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                                                {repo.language && <span>{repo.language}</span>}
                                                {repo.fork && <span className="text-amber-600 dark:text-amber-300">Fork</span>}
                                                {repo.private && <span>Private</span>}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            <button type="button" onClick={onSubmit} disabled={!selectedCount} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                                Apply with {selectedCount} project{selectedCount === 1 ? "" : "s"}
                            </button>
                        </div>
                    )}

                    {step === "submitting" && (
                        <div className="grid min-h-[260px] place-items-center">
                            <div className="text-center">
                                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                                <p className="mt-4 text-sm font-semibold text-slate-600 dark:text-slate-300">Submitting your application...</p>
                            </div>
                        </div>
                    )}

                    {step === "success" && (
                        <div className="rounded-xl bg-emerald-50 p-5 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200">
                            <h3 className="font-nunito text-xl font-extrabold">Application submitted</h3>
                            <p className="mt-2 text-sm leading-6">Your recruiter profile and selected projects were shared with the hiring team.</p>
                        </div>
                    )}

                    {step === "error" && (
                        <div className="rounded-xl bg-red-50 p-5 text-red-700 dark:bg-red-400/10 dark:text-red-300">
                            <h3 className="font-nunito text-xl font-extrabold">Could not apply</h3>
                            <p className="mt-2 text-sm leading-6">{error}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function JobDetailModal({
    job,
    onClose,
    applied,
    onApply,
}: {
    job: CandidateJob;
    onClose: () => void;
    applied: boolean;
    onApply: () => void;
}) {
    const expired = deadlineExpired(job.applicationDeadline);
    const remaining = daysLeft(job.applicationDeadline);
    const location = compactWorkMode(job);
    const tags = [job.experienceLevel, job.employmentType, job.roleType, job.compensationType, job.duration].filter(Boolean);

    return (
        <div className="fixed inset-0 z-[120] bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6">
            <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-lc-border dark:bg-lc-surface">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{job.workMode || "Opening"}</p>
                        <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{job.title}</h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-lc-hover"
                        aria-label="Close job details"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="grid flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_320px]">
                    <main className="space-y-5">
                        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <div className="flex items-start justify-between gap-5">
                                <div className="min-w-0">
                                    <div className="mb-5 flex flex-wrap gap-2">
                                        {tags.map((tag) => (
                                            <span key={tag} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                    <h1 className="font-nunito text-3xl font-extrabold leading-tight text-slate-950 dark:text-white">{job.title}</h1>
                                    <p className="mt-2 text-lg font-semibold text-slate-700 dark:text-slate-200">{job.companyName}</p>
                                    {location && (
                                        <p className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                                            <span className="material-symbols-outlined text-[20px] text-primary">location_on</span>
                                            {location}
                                        </p>
                                    )}
                                </div>
                                <JobLogo job={job} />
                            </div>

                            {(job.skills || []).length > 0 && (
                                <div className="mt-5 flex flex-wrap gap-2">
                                    {(job.skills || []).map((skill) => (
                                        <span key={skill} className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary">{skill}</span>
                                    ))}
                                </div>
                            )}
                        </section>

                        <TextBlock title="About the company" text={job.companyOverview} />
                        <TextBlock title="Details" text={job.aboutRole} />
                        <ListBlock title="Responsibilities" items={job.responsibilities} />
                        <ListBlock title="Requirements" items={job.requirements} />
                        <ListBlock title="Benefits" items={job.benefits} />
                        <TextBlock title="Application note" text={job.applicationNote} />

                        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <h3 className="border-l-4 border-primary pl-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Additional information</h3>
                            <div className="mt-5 grid gap-3 md:grid-cols-2">
                                <InfoCard icon="pin_drop" title="Job location" lines={[job.location, job.workMode]} />
                                <InfoCard icon="work_history" title="Work detail" lines={[job.timeCommitment, job.duration, job.travel]} />
                                <InfoCard icon="schedule" title="Job type" lines={[job.employmentType, job.roleType]} />
                                <InfoCard icon="payments" title="Compensation" lines={[job.compensationType, job.compensation]} />
                            </div>
                        </section>
                    </main>

                    <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <div className="bg-slate-950 px-5 py-3 text-sm font-extrabold text-white dark:bg-lc-elevated">
                                {remaining || "Open now"}
                            </div>
                            <div className="p-5">
                                <div className="flex gap-3">
                                    <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                                        <span className="material-symbols-outlined">waving_hand</span>
                                    </span>
                                    <div>
                                        <p className="font-bold text-slate-950 dark:text-white">Hi Welcome!</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">Use your Mockr profile to apply.</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={onApply}
                                    disabled={expired || applied}
                                    className="mt-5 h-12 w-full rounded-full bg-primary text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none dark:disabled:bg-lc-hover dark:disabled:text-slate-400"
                                >
                                    {expired ? "Applications closed" : applied ? "Applied" : "Quick Apply"}
                                </button>
                                {job.openings ? (
                                    <p className="mt-4 text-center text-sm font-semibold text-slate-600 dark:text-slate-300">{job.openings} opening{job.openings === 1 ? "" : "s"}</p>
                                ) : null}
                            </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Posting summary</h3>
                            <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                                {formatDate(job.publishedAt || job.createdAt) && <p>Posted {formatDate(job.publishedAt || job.createdAt)}</p>}
                                {formatDate(job.applicationDeadline) && <p>Deadline {formatDate(job.applicationDeadline)}</p>}
                                {job.travel && <p>Travel {job.travel}</p>}
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}

export function JobBoard() {
    const { session, loading } = useAuth();
    const token = session?.access_token;
    const [jobs, setJobs] = useState<CandidateJob[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [selectedJob, setSelectedJob] = useState<CandidateJob | null>(null);
    const [appliedJobIds, setAppliedJobIds] = useState<string[]>([]);
    const [applyJob, setApplyJob] = useState<CandidateJob | null>(null);
    const [applyStep, setApplyStep] = useState<ApplyStep>("idle");
    const [applyError, setApplyError] = useState("");
    const [oauthNotice, setOauthNotice] = useState("");
    const savedProviderTokenRef = useRef<string | null>(null);
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [selectedRepos, setSelectedRepos] = useState<GitHubRepo[]>([]);
    const [codingDraft, setCodingDraft] = useState<Required<Record<keyof CodingProfiles, string>>>({
        leetcodeUrl: "",
        geeksforgeeksUrl: "",
        codeforcesUrl: "",
        codechefUrl: "",
    });

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
            setOauthNotice("GitHub is already linked to this account. Refresh GitHub access so we can store a fresh repo token for Quick Apply.");
        } else if (errorDescription) {
            setOauthNotice(errorDescription.replace(/\+/g, " "));
        }

        if (hasOAuthParams) {
            window.history.replaceState(null, "", window.location.pathname);
        }
    }, []);

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

        api.post("/github/integration", {
            accessToken: providerToken,
            refreshToken: (session as any).provider_refresh_token || null,
            scopes,
            githubUserId: String(identityData.provider_id || identityData.sub || github.id || ""),
            githubUsername: identityData.user_name || identityData.preferred_username || identityData.name || null,
        }, token)
            .then(() => setOauthNotice(""))
            .catch((err) => {
                if (err instanceof ApiError && err.status === 429) {
                    setOauthNotice("");
                    return;
                }
                savedProviderTokenRef.current = null;
                setOauthNotice(err instanceof ApiError ? err.message : "GitHub connected, but token storage failed. Please reconnect GitHub.");
            });
    }, [session, token]);

    useEffect(() => {
        if (loading) return;
        if (!token) {
            setIsLoading(false);
            return;
        }

        let mounted = true;
        const controller = new AbortController();
        setIsLoading(true);
        setError(null);

        const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
        api
            .get<JobsResponse>(`/jobs${params}`, token)
            .then((data) => {
                if (mounted) {
                    setJobs(data.jobs);
                    setAppliedJobIds(data.jobs.filter((job) => job.applied).map((job) => job.id));
                }
            })
            .catch((err) => {
                if (controller.signal.aborted || !mounted) return;
                setError(err instanceof ApiError ? err.message : "Failed to load jobs.");
            })
            .finally(() => {
                if (mounted) setIsLoading(false);
            });

        return () => {
            mounted = false;
            controller.abort();
        };
    }, [loading, token, query]);

    async function loadRepos() {
        if (!token) return;
        setApplyStep("projects");
        setApplyError("");
        try {
            const payload = await api.get<{ repos: GitHubRepo[] }>("/jobs/github/repos", token);
            setRepos(payload.repos || []);
        } catch (err) {
            if (isGitHubReconnectError(err)) {
                setApplyError(err instanceof ApiError ? err.message : "");
                setApplyStep("github");
                return;
            }
            throw err;
        }
    }

    async function beginQuickApply(job: CandidateJob) {
        if (!token) return;
        setApplyJob(job);
        setSelectedRepos([]);
        setRepos([]);
        setApplyError("");
        setApplyStep("submitting");

        try {
            const readiness = await api.get<ApplicationReadiness>(`/jobs/${job.id}/application-readiness`, token);
            setCodingDraft({
                leetcodeUrl: readiness.codingProfiles.leetcodeUrl || "",
                geeksforgeeksUrl: readiness.codingProfiles.geeksforgeeksUrl || "",
                codeforcesUrl: readiness.codingProfiles.codeforcesUrl || "",
                codechefUrl: readiness.codingProfiles.codechefUrl || "",
            });
            if (!readiness.profileReady) {
                setApplyStep("profile");
                return;
            }
            if (!readiness.githubConnected) {
                setApplyStep("github");
                return;
            }
            if (!readiness.hasCodingProfile) {
                setApplyStep("coding");
                return;
            }
            await loadRepos();
        } catch (err) {
            if (isGitHubReconnectError(err)) {
                setApplyError(err instanceof ApiError ? err.message : "");
                setApplyStep("github");
                return;
            }
            setApplyError(err instanceof ApiError ? err.message : "Could not prepare Quick Apply.");
            setApplyStep("error");
        }
    }

    function connectGithub() {
        const supabase = createSupabaseBrowserClient();
        const hasGithubIdentity = Boolean(session?.user?.identities?.some((identity) => identity.provider === "github"));
        const options = {
            redirectTo: `${window.location.origin}/jobs`,
            scopes: "repo read:user user:email",
            queryParams: {
                prompt: "consent",
            },
        } as any;
        const request = hasGithubIdentity
            ? supabase.auth.signInWithOAuth({
                provider: "github",
                options,
            })
            : supabase.auth.linkIdentity({
                provider: "github",
                options,
            });

        request.then(({ data, error }) => {
            if (error) {
                if (applyJob) {
                    setApplyError(error.message);
                    setApplyStep("github");
                } else {
                    setOauthNotice(error.message);
                }
                return;
            }
            const redirectUrl = (data as { url?: string } | null)?.url;
            if (redirectUrl) window.location.assign(redirectUrl);
        });
    }

    async function saveCodingProfilesAndContinue() {
        if (!token) return;
        const hasOne = Object.values(codingDraft).some((value) => value.trim());
        if (!hasOne) {
            setApplyError("Add at least one coding profile.");
            setApplyStep("error");
            return;
        }
        try {
            setApplyStep("submitting");
            await api.patch("/job-profiles/coding-profiles", codingDraft, token);
            await loadRepos();
        } catch (err) {
            if (isGitHubReconnectError(err)) {
                setApplyError(err instanceof ApiError ? err.message : "");
                setApplyStep("github");
                return;
            }
            setApplyError(err instanceof ApiError ? err.message : "Could not save coding profiles.");
            setApplyStep("error");
        }
    }

    function toggleRepo(repo: GitHubRepo) {
        setSelectedRepos((current) => {
            if (current.some((item) => item.fullName === repo.fullName)) {
                return current.filter((item) => item.fullName !== repo.fullName);
            }
            if (current.length >= 3) return current;
            return [...current, repo];
        });
    }

    async function submitQuickApply() {
        if (!token || !applyJob || selectedRepos.length === 0) return;
        setApplyStep("submitting");
        setApplyError("");
        try {
            await api.post(`/jobs/${applyJob.id}/apply`, {
                selectedProjects: selectedRepos,
                codingProfiles: codingDraft,
            }, token);
            setAppliedJobIds((current) => current.includes(applyJob.id) ? current : [...current, applyJob.id]);
            setApplyStep("success");
        } catch (err) {
            if (isGitHubReconnectError(err)) {
                setApplyError(err instanceof ApiError ? err.message : "");
                setApplyStep("github");
                return;
            }
            setApplyError(err instanceof ApiError ? err.message : "Could not submit application.");
            setApplyStep("error");
        }
    }

    const content = useMemo(() => {
        if (isLoading) {
            return (
                <div className="grid min-h-[360px] place-items-center rounded-xl border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                    <div className="h-11 w-11 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                </div>
            );
        }

        if (error) {
            return (
                <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    {error}
                </div>
            );
        }

        if (jobs.length === 0) {
            return (
                <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center dark:border-lc-border dark:bg-lc-surface">
                    <div>
                        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined text-4xl">work</span>
                        </div>
                        <h2 className="mt-5 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">No jobs available</h2>
                        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                            New openings from companies will appear here once they publish roles.
                        </p>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-4">
                {jobs.map((job) => (
                    <JobCard key={job.id} job={job} onOpen={() => setSelectedJob(job)} />
                ))}
            </div>
        );
    }, [error, isLoading, jobs]);

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
                <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Opportunities</p>
                        <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">Jobs</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Explore openings posted by companies hiring through Mockr.
                        </p>
                    </div>
                    <div className="relative w-full md:w-80">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400">search</span>
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search jobs"
                            className="h-12 w-full rounded-full border border-slate-200 bg-white pl-10 pr-4 text-sm font-medium text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-surface dark:text-white"
                        />
                    </div>
                </section>

                {oauthNotice && (
                    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
                        <span>{oauthNotice}</span>
                        <button
                            type="button"
                            onClick={connectGithub}
                            className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-white"
                        >
                            Refresh GitHub access
                        </button>
                    </div>
                )}

                {content}
            </div>

            {selectedJob && (
                <JobDetailModal
                    job={selectedJob}
                    onClose={() => setSelectedJob(null)}
                    applied={appliedJobIds.includes(selectedJob.id)}
                    onApply={() => beginQuickApply(selectedJob)}
                />
            )}
            {applyJob && applyStep !== "idle" && (
                <ApplyModal
                    job={applyJob}
                    step={applyStep}
                    error={applyError}
                    repos={repos}
                    selectedRepoIds={selectedRepos.map((repo) => repo.fullName)}
                    codingDraft={codingDraft}
                    onCodingDraftChange={setCodingDraft}
                    onClose={() => {
                        setApplyJob(null);
                        setApplyStep("idle");
                    }}
                    onCreateProfile={() => window.location.assign("/job-profile")}
                    onConnectGithub={connectGithub}
                    onSaveCodingProfiles={saveCodingProfilesAndContinue}
                    onToggleRepo={toggleRepo}
                    onSubmit={submitQuickApply}
                />
            )}
        </main>
    );
}
