"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
    type TechnicalAssignmentRecord,
    type TechnicalAssignmentSubmission,
} from "@/lib/technical-assignments";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError } from "@/lib/api";
import { companyRoundMonitorPath } from "@/lib/company-round-navigation";

type NextRoundPipeline = "ai_interview" | "mock_oa" | "technical_assignment" | "final_interview";

const nextRoundPipelineOptions: Array<{ value: NextRoundPipeline; title: string; icon: string; description: string }> = [
    { value: "ai_interview", title: "AI interview", icon: "mic", description: "Automated structured interview round." },
    { value: "mock_oa", title: "Online assessment", icon: "quiz", description: "Secure question-bank OA round." },
    { value: "technical_assignment", title: "Technical assignment", icon: "construction", description: "Another project assignment round." },
    { value: "final_interview", title: "Direct final interview", icon: "groups", description: "Move directly to human interview." },
];

const nextRoundPipelineLabel: Record<NextRoundPipeline, string> = {
    ai_interview: "Set up AI interview",
    mock_oa: "Set up OA",
    technical_assignment: "Set up technical assignment",
    final_interview: "Set up final interview",
};

function asPipeline(value?: string | null): NextRoundPipeline | null {
    return value === "ai_interview" || value === "mock_oa" || value === "technical_assignment" || value === "final_interview"
        ? value
        : null;
}

function timeRemaining(closesAt: string) {
    const ms = new Date(closesAt).getTime() - Date.now();
    if (ms <= 0) return "Closed";
    const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return `${days}d ${hours}h ${minutes}m left`;
}

function compactDuration(value?: string | null) {
    if (!value) return "";
    const clean = value.trim().toLowerCase();
    const days = Number.parseInt(clean.match(/(\d+)\s*(?:d|day|days)\b/)?.[1] || "", 10);
    const hours = Number.parseInt(clean.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/)?.[1] || "", 10);
    const minutes = Number.parseInt(clean.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/)?.[1] || "", 10);
    const numbers = clean.match(/\d+(?:\.\d+)?/g)?.map((item) => Number.parseFloat(item)).filter(Number.isFinite) || [];

    if (Number.isFinite(days) || Number.isFinite(hours) || Number.isFinite(minutes)) {
        return `${Number.isFinite(days) ? days : 0}d ${Number.isFinite(hours) ? hours : 0}h ${Number.isFinite(minutes) ? minutes : 0}m`;
    }

    const amount = Math.max(...numbers, 0);
    if (!amount) return value || "";
    const totalMinutes = /\b(day|days)\b/.test(clean)
        ? amount * 1440
        : /\b(min|mins|minute|minutes)\b/.test(clean)
            ? amount
            : amount * 60;
    const rounded = Math.max(0, Math.round(totalMinutes));
    return `${Math.floor(rounded / 1440)}d ${Math.floor((rounded % 1440) / 60)}h ${rounded % 60}m`;
}

function isClosed(record: TechnicalAssignmentRecord) {
    return new Date(record.closesAt).getTime() <= Date.now();
}

function formatDate(value: string) {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function submissionMoved(submission: TechnicalAssignmentSubmission) {
    return Boolean(submission.roundAdvanced || submission.roundNextRoundMovedAt);
}

function assignmentNextPipeline(assignment: TechnicalAssignmentRecord) {
    return asPipeline(assignment.jobNextRoundType)
        || asPipeline(assignment.submissions.find(submissionMoved)?.roundNextRoundType)
        || asPipeline(assignment.submissions.find(submissionMoved)?.nextRoundType);
}

function assignmentMonitorPipeline(assignment: TechnicalAssignmentRecord) {
    const current = asPipeline(assignment.jobCurrentRoundType);
    if (current) return current;

    const next = assignmentNextPipeline(assignment);
    if (next && next !== "technical_assignment" && assignment.submissions.some(submissionMoved)) {
        return next;
    }

    return null;
}

function SubmissionReportModal({
    assignment,
    submission,
    onClose,
}: {
    assignment: TechnicalAssignmentRecord;
    submission: TechnicalAssignmentSubmission;
    onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 z-[160] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-lc-border">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Assignment report</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{submission.candidateName}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{assignment.config.title}</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close report">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                        <main className="space-y-5">
                            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-elevated">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Overall assignment score</p>
                                    <p className="mt-1 font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">{submission.score}/100</p>
                                </div>
                                <a href={submission.repoUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-full border border-primary/20 px-4 py-2 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                                    Open repository
                                </a>
                            </section>
                            <section className="rounded-lg border border-slate-200 p-5 dark:border-lc-border">
                                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Evaluator summary</h3>
                                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{submission.report.summary}</p>
                            </section>
                            <div className="grid gap-5 md:grid-cols-2">
                                <section className="rounded-lg border border-slate-200 p-5 dark:border-lc-border">
                                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Strengths</h3>
                                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                        {submission.report.strengths.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                                    </ul>
                                </section>
                                <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-300/30 dark:bg-amber-300/10">
                                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Watchouts</h3>
                                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-amber-800 dark:text-amber-100">
                                        {submission.report.risks.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                                    </ul>
                                </section>
                            </div>
                            <section className="rounded-lg border border-slate-200 p-5 dark:border-lc-border">
                                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Rubric breakdown</h3>
                                <div className="mt-4 space-y-3">
                                    {submission.report.rubric.map((item) => (
                                        <div key={item.label}>
                                            <div className="flex justify-between text-xs font-extrabold text-slate-500 dark:text-slate-400">
                                                <span>{item.label}</span>
                                                <span>{item.score}/100 - weight {item.weight}%</span>
                                            </div>
                                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-lc-hover">
                                                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </main>
                </div>
            </div>
        </div>
    );
}

function AssignmentCard({
    assignment,
    onOpen,
    onSubmissions,
    onMove,
    onSetupRound,
}: {
    assignment: TechnicalAssignmentRecord;
    onOpen: (assignment: TechnicalAssignmentRecord) => void;
    onSubmissions: (assignment: TechnicalAssignmentRecord) => void;
    onMove: (assignment: TechnicalAssignmentRecord) => void;
    onSetupRound: (assignment: TechnicalAssignmentRecord) => void;
}) {
    const closed = isClosed(assignment);
    const evaluated = assignment.submissions.filter((submission) => submission.status === "evaluated").length;
    const moved = assignment.submissions.filter(submissionMoved).length;
    const nextRoundType = assignmentNextPipeline(assignment);
    const monitorRoundType = assignmentMonitorPipeline(assignment);
    const hasMovedCandidates = moved > 0;
    const hasSubmissions = assignment.submissions.length > 0;
    const canSetupNextRound = closed && hasMovedCandidates && nextRoundType && !monitorRoundType;
    const canManageNextRound = closed && hasSubmissions;
    const monitorLabel = hasMovedCandidates && monitorRoundType ? "Monitor next round" : hasMovedCandidates ? "Update next round" : "Shortlist next round";
    const monitorIcon = hasMovedCandidates && monitorRoundType ? "monitoring" : hasMovedCandidates ? "edit_note" : "trending_flat";
    return (
        <article
            role="button"
            tabIndex={0}
            onClick={() => onOpen(assignment)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(assignment);
                }
            }}
            className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-surface"
        >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <p className={`text-xs font-extrabold uppercase tracking-[0.16em] ${closed ? "text-slate-400" : "text-emerald-500"}`}>{closed ? "Closed assignment" : "Live assignment"}</p>
                    <h3 className="mt-2 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{assignment.config.title}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{assignment.jobTitle} - {assignment.companyName}</p>
                    <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{assignment.config.overview}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[360px]">
                    <span className={`rounded-lg px-3 py-2 text-center text-xs font-extrabold ${closed ? "bg-slate-100 text-slate-500 dark:bg-lc-hover dark:text-slate-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"}`}>
                        {timeRemaining(assignment.closesAt)}
                    </span>
                    <span className="rounded-lg bg-primary/10 px-3 py-2 text-center text-xs font-extrabold text-primary">{assignment.submissions.length} submitted</span>
                    <span className="rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{evaluated} evaluated</span>
                    {closed && moved > 0 && <span className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">{moved} advanced</span>}
                </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-lc-border">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onSubmissions(assignment);
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white"
                >
                    <span className="material-symbols-outlined text-[18px]">folder_managed</span>
                    Submitted assignments
                </button>
                {closed && canManageNextRound && (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onMove(assignment);
                        }}
                        className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-extrabold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${hasMovedCandidates && monitorRoundType ? "bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-600" : hasMovedCandidates ? "border border-amber-300/60 bg-amber-400/10 text-amber-700 shadow-none hover:bg-amber-400 hover:text-slate-950 dark:border-amber-300/30 dark:text-amber-200" : "bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-600"}`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{monitorIcon}</span>
                        {monitorLabel}
                    </button>
                )}
                {closed && canSetupNextRound && (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onSetupRound(assignment);
                        }}
                        className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                    >
                        <span className="material-symbols-outlined text-[18px]">construction</span>
                        {nextRoundPipelineLabel[nextRoundType]}
                    </button>
                )}
                {!closed && (
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Shortlisting unlocks after the deadline closes.</span>
                )}
                {closed && !hasSubmissions && (
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">No submitted assignments to shortlist yet.</span>
                )}
            </div>
        </article>
    );
}

function linesFromText(value?: string | null) {
    return String(value || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function AssignmentTextBlock({ title, text }: { title: string; text?: string | null }) {
    if (!text?.trim()) return null;
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">{text}</p>
        </section>
    );
}

function AssignmentListBlock({ title, text }: { title: string; text?: string | null }) {
    const lines = linesFromText(text);
    if (!lines.length) return null;
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {lines.map((line, index) => <li key={`${title}-${index}-${line}`}>{line}</li>)}
            </ul>
        </section>
    );
}

function AssignmentRubricBlock({ assignment }: { assignment: TechnicalAssignmentRecord }) {
    const rows = [
        ["Functionality", assignment.config.functionalityWeight],
        ["Architecture", assignment.config.architectureWeight],
        ["Code quality", assignment.config.codeQualityWeight],
        ["Documentation", assignment.config.documentationWeight],
        ["Testing", assignment.config.testingWeight],
        ["Product thinking", assignment.config.productThinkingWeight],
        ["Security", assignment.config.securityWeight],
    ];
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Evaluation rubric</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {rows.map(([label, weight]) => (
                    <div key={label} className="rounded-lg bg-slate-50 p-3 dark:bg-lc-hover">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
                        <p className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">{weight || "0"}%</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

function AssignmentDetailModal({
    assignment,
    onClose,
}: {
    assignment: TechnicalAssignmentRecord;
    onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Assignment details</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{assignment.config.title}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{timeRemaining(assignment.closesAt)} - closes {formatDate(assignment.closesAt)}</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close assignment">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-5">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-lg bg-slate-50 p-3 dark:bg-lc-hover">
                                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Time remaining</p>
                                    <p className="mt-1 font-extrabold text-slate-950 dark:text-white">{timeRemaining(assignment.closesAt)}</p>
                                </div>
                                <div className="rounded-lg bg-slate-50 p-3 dark:bg-lc-hover">
                                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Expected effort</p>
                                    <p className="mt-1 font-extrabold text-slate-950 dark:text-white">{compactDuration(assignment.config.estimatedHours) || "Not set"}</p>
                                </div>
                                <div className="rounded-lg bg-slate-50 p-3 dark:bg-lc-hover">
                                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Submissions</p>
                                    <p className="mt-1 font-extrabold text-slate-950 dark:text-white">{assignment.submissions.length} received</p>
                                </div>
                            </div>
                        </section>
                        <AssignmentTextBlock title="What is being assessed" text={assignment.config.overview} />
                        <AssignmentTextBlock title="Scenario" text={assignment.config.scenario} />
                        <AssignmentListBlock title="Tasks" text={assignment.config.tasks} />
                        <AssignmentTextBlock title="Starter context and mock data" text={assignment.config.starterContext} />
                        <div className="grid gap-5 lg:grid-cols-2">
                            <AssignmentTextBlock title="Allowed stack" text={assignment.config.allowedStack} />
                            <AssignmentListBlock title="Constraints" text={assignment.config.constraints} />
                            <AssignmentListBlock title="Required deliverables" text={assignment.config.deliverables} />
                            <AssignmentTextBlock title="Submission instructions" text={assignment.config.submissionInstructions} />
                        </div>
                        <AssignmentListBlock title="Thinking questions" text={assignment.config.thinkingQuestions} />
                        <AssignmentTextBlock title="Deadline and late policy" text={assignment.config.deadlinePolicy} />
                        <AssignmentRubricBlock assignment={assignment} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function AssignmentSubmissionsModal({
    assignment,
    onClose,
}: {
    assignment: TechnicalAssignmentRecord;
    onClose: () => void;
}) {
    const [selectedSubmission, setSelectedSubmission] = useState<TechnicalAssignmentSubmission | null>(null);
    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Submitted assignments</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{assignment.config.title}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{assignment.submissions.length} submitted - {assignment.submissions.filter((submission) => submission.status === "evaluated").length} evaluated</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close submitted assignments">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                    <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                        {assignment.submissions.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center dark:border-lc-border dark:bg-lc-elevated">
                                <span className="material-symbols-outlined text-4xl text-slate-400">hourglass_empty</span>
                                <p className="mt-3 font-bold text-slate-700 dark:text-slate-200">No submissions yet</p>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Candidate submissions and generated reports will appear here after they submit their assignment.</p>
                            </div>
                        ) : (
                            <div className="grid gap-3">
                                {assignment.submissions.map((submission) => (
                                    <button key={submission.id} type="button" onClick={() => setSelectedSubmission(submission)} className="rounded-lg border border-slate-200 p-4 text-left transition hover:border-primary/40 dark:border-lc-border">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate font-bold text-slate-950 dark:text-white">{submission.candidateName}</p>
                                                <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Submitted {formatDate(submission.submittedAt)}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">{submission.score}/100</span>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>
            {selectedSubmission && (
                <SubmissionReportModal
                    assignment={assignment}
                    submission={selectedSubmission}
                    onClose={() => setSelectedSubmission(null)}
                />
            )}
        </div>
    );
}

function AssignmentNextRoundModal({
    assignment,
    onClose,
    onSubmit,
    saving,
}: {
    assignment: TechnicalAssignmentRecord;
    onClose: () => void;
    onSubmit: (payload: { applicationIds: string[]; pipelineType: NextRoundPipeline }) => Promise<boolean>;
    saving: boolean;
}) {
    const rankedSubmissions = useMemo(
        () => [...assignment.submissions]
            .filter((submission) => submission.applicationId)
            .sort((first, second) => second.score - first.score),
        [assignment.submissions]
    );
    const defaultTopCount = Math.min(3, rankedSubmissions.filter((submission) => !submissionMoved(submission)).length);
    const lockedIds = useMemo(
        () => new Set(rankedSubmissions.filter(submissionMoved).map((submission) => submission.id)),
        [rankedSubmissions]
    );
    const [topCount, setTopCount] = useState(defaultTopCount);
    const [manualIds, setManualIds] = useState<string[]>([]);
    const [pipelineType, setPipelineType] = useState<NextRoundPipeline>(assignmentNextPipeline(assignment) || "ai_interview");
    const topIds = useMemo(
        () => new Set(rankedSubmissions.filter((submission) => !submissionMoved(submission)).slice(0, topCount).map((submission) => submission.id)),
        [rankedSubmissions, topCount]
    );
    const selectedIds = useMemo(() => {
        const ids = new Set<string>(manualIds);
        topIds.forEach((id) => ids.add(id));
        lockedIds.forEach((id) => ids.add(id));
        return ids;
    }, [lockedIds, manualIds, topIds]);
    const selectedApplicationIds = rankedSubmissions
        .filter((submission) => selectedIds.has(submission.id) && submission.applicationId)
        .map((submission) => submission.applicationId!)
        .filter(Boolean);
    const newSelectedCount = rankedSubmissions
        .filter((submission) => selectedIds.has(submission.id) && !submissionMoved(submission) && submission.applicationId)
        .length;
    const isUpdate = lockedIds.size > 0;

    function toggleManual(id: string) {
        if (lockedIds.has(id)) return;
        setManualIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    }

    async function submit() {
        const moved = await onSubmit({ applicationIds: selectedApplicationIds, pipelineType });
        if (moved) onClose();
    }

    return (
        <div className="fixed inset-0 z-[160] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-lc-border">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{isUpdate ? "Update next round" : "Next round"}</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{assignment.config.title}</h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{isUpdate ? "Keep advanced candidates locked, add more candidates, or switch the next pipeline." : "Select candidates using assignment scores, add manual picks, then choose the next pipeline."}</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close next round">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
                        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-elevated">
                            <label className="block">
                                <span className="text-sm font-extrabold text-slate-800 dark:text-white">Shortlist top assignment scores</span>
                                <input
                                    type="number"
                                    min={0}
                                    max={rankedSubmissions.length}
                                    value={topCount}
                                    onChange={(event) => setTopCount(Math.max(0, Math.min(rankedSubmissions.length, Number.parseInt(event.target.value, 10) || 0)))}
                                    className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                />
                            </label>
                            <p className="mt-2 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
                                Already advanced candidates stay locked. The top count is based only on this assignment score.
                            </p>
                            <div className="mt-5 space-y-3">
                                <p className="text-sm font-extrabold text-slate-800 dark:text-white">Pipeline</p>
                                {nextRoundPipelineOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setPipelineType(option.value)}
                                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${pipelineType === option.value ? "border-primary bg-primary/10" : "border-slate-200 bg-white hover:border-primary/30 dark:border-lc-border dark:bg-lc-surface"}`}
                                    >
                                        <span className="material-symbols-outlined text-[22px] text-primary">{option.icon}</span>
                                        <span>
                                            <span className="block text-sm font-extrabold text-slate-950 dark:text-white">{option.title}</span>
                                            <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{option.description}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-lc-border dark:bg-lc-surface">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Submitted candidates</h3>
                                    <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{selectedApplicationIds.length} selected, {newSelectedCount} new candidate(s) will advance.</p>
                                </div>
                            </div>
                            <div className="mt-4 grid gap-2">
                                {rankedSubmissions.length ? rankedSubmissions.map((submission, index) => {
                                    const locked = lockedIds.has(submission.id);
                                    const selected = selectedIds.has(submission.id);
                                    const topPick = topIds.has(submission.id);
                                    return (
                                        <div
                                            key={submission.id}
                                            className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${selected ? "border-primary/50 bg-primary/5" : "border-slate-200 hover:border-primary/30 dark:border-lc-border"}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selected}
                                                disabled={topPick || locked}
                                                onChange={() => toggleManual(submission.id)}
                                                className="size-4 accent-primary disabled:opacity-60"
                                            />
                                            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                                                {submission.avatarUrl ? <img src={submission.avatarUrl} alt="" className="h-full w-full object-cover" /> : submission.candidateName.slice(0, 2).toUpperCase()}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-extrabold text-slate-950 dark:text-white">{submission.candidateName}</span>
                                                <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Rank #{index + 1} - Assignment {submission.score}/100</span>
                                            </span>
                                            {topPick && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold text-primary">Top pick</span>}
                                            {locked && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">Already advanced</span>}
                                        </div>
                                    );
                                }) : (
                                    <div className="rounded-lg border border-dashed border-slate-200 p-6 text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                        No submitted assignments can advance yet.
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-lc-border">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Selected candidates receive the same next-round notification used by Jobs.</p>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={saving || selectedApplicationIds.length === 0}
                        className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-full bg-emerald-500 px-5 text-sm font-extrabold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {saving ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <span className="material-symbols-outlined text-[20px]">trending_flat</span>}
                        {isUpdate ? "Update next round" : "Shortlist for next round"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function TechnicalAssignmentDashboard() {
    const router = useRouter();
    const { company, session } = useCompanyAuth();
    const canManageHiring = company?.role === "owner" || company?.role === "admin";
    const [assignments, setAssignments] = useState<TechnicalAssignmentRecord[]>([]);
    const [selectedAssignment, setSelectedAssignment] = useState<TechnicalAssignmentRecord | null>(null);
    const [submissionsAssignment, setSubmissionsAssignment] = useState<TechnicalAssignmentRecord | null>(null);
    const [nextRoundAssignment, setNextRoundAssignment] = useState<TechnicalAssignmentRecord | null>(null);
    const [assignmentTab, setAssignmentTab] = useState<"live" | "closed">("live");
    const [loading, setLoading] = useState(true);
    const [moving, setMoving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadAssignments = useCallback(async (showLoading: boolean) => {
        if (!session?.access_token) {
            setAssignments([]);
            setLoading(false);
            return;
        }

        if (showLoading) setLoading(true);
        try {
            const payload = await api.get<{ assignments: TechnicalAssignmentRecord[] }>(
                "/companies/technical-assignments",
                session.access_token
            );
            setAssignments(payload.assignments || []);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load technical assignments.");
        } finally {
            setLoading(false);
        }
    }, [session?.access_token]);

    useEffect(() => {
        let mounted = true;
        let interval: number | null = null;
        loadAssignments(true);
        interval = window.setInterval(() => {
            if (mounted) void loadAssignments(false);
        }, 60_000);
        return () => {
            mounted = false;
            if (interval) window.clearInterval(interval);
        };
    }, [loadAssignments]);

    function hiringAccessMessage(action: string) {
        return `You don't have access to ${action}. Ask a company owner or admin to do this.`;
    }

    function requireHiringAccess(action: string) {
        if (canManageHiring) return true;
        setError(hiringAccessMessage(action));
        window.scrollTo({ top: 0, behavior: "smooth" });
        return false;
    }

    async function moveAssignmentNextRound(payload: { applicationIds: string[]; pipelineType: NextRoundPipeline }) {
        if (!session?.access_token || !nextRoundAssignment) return false;
        if (!canManageHiring) {
            setError(hiringAccessMessage("update the next round"));
            return false;
        }
        setMoving(true);
        setError(null);
        try {
            await api.post(
                `/companies/jobs/${nextRoundAssignment.jobId}/applications/next-round`,
                {
                    topCount: 0,
                    applicationIds: payload.applicationIds,
                    pipelineType: payload.pipelineType,
                    sourceAssignmentId: nextRoundAssignment.id,
                },
                session.access_token
            );
            await loadAssignments(false);
            const monitorPath = companyRoundMonitorPath(payload.pipelineType);
            if (monitorPath && payload.pipelineType !== "technical_assignment") {
                setNextRoundAssignment(null);
                router.push(monitorPath);
            }
            return true;
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to move candidates to the next round.");
            return false;
        } finally {
            setMoving(false);
        }
    }

    function setupRoundFromAssignment(assignment: TechnicalAssignmentRecord) {
        if (!requireHiringAccess("set up the next round")) return;
        const monitorPath = companyRoundMonitorPath(assignmentMonitorPipeline(assignment));
        if (monitorPath) {
            router.push(monitorPath);
            return;
        }

        if (assignmentNextPipeline(assignment) === "technical_assignment") {
            const params = new URLSearchParams({
                setupTechnicalJob: assignment.jobId,
                sourceAssignmentId: assignment.id,
            });
            router.push(`/jobs?${params.toString()}`);
            return;
        }

        const nextPath = companyRoundMonitorPath(assignmentNextPipeline(assignment));
        if (nextPath) {
            router.push(nextPath);
            return;
        }

        setNextRoundAssignment(assignment);
    }

    const { liveAssignments, closedAssignments } = useMemo(() => {
        const live = assignments
            .filter((assignment) => !isClosed(assignment))
            .sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime());
        const closed = assignments
            .filter(isClosed)
            .sort((a, b) => new Date(b.closesAt).getTime() - new Date(a.closesAt).getTime());
        return { liveAssignments: live, closedAssignments: closed };
    }, [assignments]);
    const visibleAssignments = assignmentTab === "live" ? liveAssignments : closedAssignments;

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-8">
                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">assignment_turned_in</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Company Workspace</p>
                            <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">Assessments</h1>
                        </div>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">Monitor live technical assignments, candidate submissions, generated project reports, and closed assessment rounds.</p>
                </section>

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                        {error}
                    </div>
                )}

                {loading ? (
                    <section className="grid min-h-[320px] place-items-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    </section>
                ) : assignments.length === 0 ? (
                    <section className="rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <span className="material-symbols-outlined text-5xl text-slate-400">assignment_add</span>
                        <h2 className="mt-4 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">No assignments created yet</h2>
                        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">Go to Jobs, choose a role that is in technical assignment setup, and save the assignment brief. It will appear here instantly.</p>
                    </section>
                ) : (
                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="inline-flex rounded-full bg-slate-100 p-1 dark:bg-lc-hover">
                                <button
                                    type="button"
                                    onClick={() => setAssignmentTab("live")}
                                    className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-extrabold transition ${assignmentTab === "live" ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20" : "text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"}`}
                                >
                                    Live
                                    <span className={`rounded-full px-2 py-0.5 text-xs ${assignmentTab === "live" ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"}`}>{liveAssignments.length}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAssignmentTab("closed")}
                                    className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-extrabold transition ${assignmentTab === "closed" ? "bg-primary text-white shadow-sm shadow-primary/20" : "text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"}`}
                                >
                                    Closed
                                    <span className={`rounded-full px-2 py-0.5 text-xs ${assignmentTab === "closed" ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600 dark:bg-lc-surface dark:text-slate-300"}`}>{closedAssignments.length}</span>
                                </button>
                            </div>
                            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                                {assignmentTab === "live" ? "Open rounds sorted by nearest deadline." : "Completed or expired rounds stay available for review."}
                            </p>
                        </div>

                        <div className={`mt-5 grid gap-4 ${assignmentTab === "closed" ? "opacity-90" : ""}`}>
                            {visibleAssignments.length ? visibleAssignments.map((assignment) => (
                                <AssignmentCard
                                    key={assignment.id}
                                    assignment={assignment}
                                    onOpen={setSelectedAssignment}
                                    onSubmissions={setSubmissionsAssignment}
                                    onMove={(nextAssignment) => {
                                        if (!requireHiringAccess("update the next round")) return;
                                        const hasMovedCandidates = nextAssignment.submissions.some(submissionMoved);
                                        const monitorPath = hasMovedCandidates
                                            ? companyRoundMonitorPath(assignmentMonitorPipeline(nextAssignment))
                                            : null;
                                        if (monitorPath) {
                                            router.push(monitorPath);
                                            return;
                                        }
                                        setNextRoundAssignment(nextAssignment);
                                    }}
                                    onSetupRound={setupRoundFromAssignment}
                                />
                            )) : (
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm font-semibold text-slate-500 dark:border-lc-border dark:bg-lc-elevated dark:text-slate-400">
                                    {assignmentTab === "live" ? "No live assignments right now." : "Closed assignments will appear here after deadlines pass."}
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </div>
            {selectedAssignment && (
                <AssignmentDetailModal assignment={selectedAssignment} onClose={() => setSelectedAssignment(null)} />
            )}
            {submissionsAssignment && (
                <AssignmentSubmissionsModal assignment={submissionsAssignment} onClose={() => setSubmissionsAssignment(null)} />
            )}
            {nextRoundAssignment && (
                <AssignmentNextRoundModal
                    assignment={nextRoundAssignment}
                    onClose={() => setNextRoundAssignment(null)}
                    onSubmit={moveAssignmentNextRound}
                    saving={moving}
                />
            )}
        </main>
    );
}
