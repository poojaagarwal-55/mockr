"use client";

/**
 * Agent V2 modals:
 *   - ArtifactDetailModal — fetches /users/me/tutor/artifacts/:id and
 *     renders the right body for question_sheet / action_plan / quiz.
 *   - ProfileSetupModal — clean 4-field wizard that PUTs the user's
 *     prep goals so the agent's recommendations are grounded in real
 *     targets (company / role / level / deadline / hours).
 *
 * Style guide: blue (#4A7CFF) + white, no borders, rounded-2xl/3xl,
 * soft shadows, ample whitespace. Dark-mode parallel uses lc-surface.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────
// Shared shell
// ─────────────────────────────────────────────────────────────────

function ModalShell({
    children,
    onClose,
    maxWidth = "max-w-2xl",
}: {
    children: React.ReactNode;
    onClose: () => void;
    maxWidth?: string;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-[600] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm dark:bg-black/70"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className={`relative w-full ${maxWidth} max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-[0_20px_70px_-20px_rgba(74,124,255,0.35)] dark:bg-lc-surface dark:shadow-black/40`}
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:bg-lc-hover dark:text-slate-300 dark:hover:bg-lc-elevated dark:hover:text-white"
                >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
                {children}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// Artifact detail modal
// ─────────────────────────────────────────────────────────────────

type ArtifactDetail = {
    id: string;
    type: string;
    title: string;
    content: any;
    meta: any;
    status: string;
    createdAt: string;
    updatedAt: string;
};

type SheetQuestion = {
    id: string;
    slug: string | null;
    title: string;
    difficulty: string;
    topics?: string[];
    focusMatch?: string[];
};

type PlanWeek = {
    weekNumber: number;
    title: string;
    goals: string[];
    topics: string[];
    estimatedHours: number;
    milestone: string | null;
};

type QuizItem = {
    id: string;
    format: "mcq" | "short_answer";
    prompt: string;
    choices?: string[];
    correctIndex?: number;
    expectedAnswer?: string;
    explanation: string;
    difficulty: string;
};

const TYPE_META: Record<string, { icon: string; label: string }> = {
    question_sheet: { icon: "list_alt", label: "Practice sheet" },
    action_plan: { icon: "calendar_month", label: "Action plan" },
    quiz: { icon: "quiz", label: "Quiz" },
    study_note: { icon: "menu_book", label: "Study note" },
};

export function ArtifactDetailModal({
    artifactId,
    token,
    onClose,
}: {
    artifactId: string;
    token: string;
    onClose: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        api
            .get<{ artifact: ArtifactDetail }>(`/users/me/tutor/artifacts/${artifactId}`, token)
            .then((res) => {
                if (cancelled) return;
                setArtifact(res.artifact);
            })
            .catch((err: any) => {
                if (cancelled) return;
                setError(err?.message || "Failed to load artifact");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [artifactId, token]);

    const meta = artifact ? TYPE_META[artifact.type] ?? { icon: "description", label: "Artifact" } : null;

    return (
        <ModalShell onClose={onClose} maxWidth="max-w-3xl">
            {/* Header */}
            <div className="bg-gradient-to-br from-primary/8 to-transparent px-7 pb-5 pt-7">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_6px_18px_-4px_rgba(74,124,255,0.55)]">
                        <span className="material-symbols-outlined text-[22px]">{meta?.icon ?? "description"}</span>
                    </div>
                    <div className="min-w-0 flex-1 pr-10">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                            {meta?.label ?? "Artifact"}
                        </p>
                        <h2 className="mt-0.5 text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                            {artifact?.title ?? "Loading…"}
                        </h2>
                        {artifact && (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Created {formatRelative(artifact.createdAt)}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="max-h-[68vh] overflow-y-auto px-7 pb-7 pt-2">
                {loading && <ArtifactSkeleton />}
                {error && !loading && (
                    <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
                        {error}
                    </div>
                )}
                {!loading && !error && artifact && (
                    <>
                        {artifact.type === "question_sheet" && <QuestionSheetBody content={artifact.content} />}
                        {artifact.type === "action_plan" && <ActionPlanBody content={artifact.content} />}
                        {artifact.type === "quiz" && <QuizBody content={artifact.content} />}
                        {artifact.type === "study_note" && <GenericJSONBody content={artifact.content} />}
                        {!["question_sheet", "action_plan", "quiz", "study_note"].includes(artifact.type) && (
                            <GenericJSONBody content={artifact.content} />
                        )}
                    </>
                )}
            </div>
        </ModalShell>
    );
}

function ArtifactSkeleton() {
    return (
        <div className="space-y-3 pt-2">
            <div className="h-4 w-3/4 animate-pulse rounded-full bg-slate-100 dark:bg-lc-hover" />
            <div className="h-4 w-1/2 animate-pulse rounded-full bg-slate-100 dark:bg-lc-hover" />
            <div className="mt-5 h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-lc-hover" />
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-lc-hover" />
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-lc-hover" />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// Bodies — one per artifact type
// ─────────────────────────────────────────────────────────────────

function QuestionSheetBody({ content }: { content: any }) {
    const questions: SheetQuestion[] = Array.isArray(content?.questions) ? content.questions : [];
    const focusTopics: string[] = Array.isArray(content?.focusTopics) ? content.focusTopics : [];
    const estimatedHours = typeof content?.estimatedHours === "number" ? content.estimatedHours : null;

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
                <Pill>{questions.length} question{questions.length === 1 ? "" : "s"}</Pill>
                {focusTopics.slice(0, 4).map((t) => (
                    <Pill key={t} tone="muted">
                        {prettyTopic(t)}
                    </Pill>
                ))}
            </div>

            <ul className="space-y-2.5">
                {questions.map((q, idx) => (
                    <li
                        key={q.id ?? idx}
                        className="group flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 transition-colors hover:bg-primary/5 dark:bg-lc-hover dark:hover:bg-lc-elevated"
                    >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-extrabold text-primary dark:bg-lc-bg dark:text-primary">
                            {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                {q.title}
                            </p>
                            {q.topics && q.topics.length > 0 && (
                                <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                                    {q.topics.slice(0, 4).join(" · ")}
                                </p>
                            )}
                        </div>
                        <DifficultyBadge value={q.difficulty} />
                    </li>
                ))}
                {questions.length === 0 && (
                    <li className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-lc-hover dark:text-slate-400">
                        No questions in this sheet.
                    </li>
                )}
            </ul>
        </div>
    );
}

function ActionPlanBody({ content }: { content: any }) {
    const weeks: PlanWeek[] = Array.isArray(content?.weeks) ? content.weeks : [];
    const summary = typeof content?.summary === "string" ? content.summary : null;
    const priorityFocus = typeof content?.priorityFocus === "string" ? content.priorityFocus : null;
    const targetCompany = typeof content?.targetCompany === "string" ? content.targetCompany : null;
    const totalHours = typeof content?.totalHours === "number" ? content.totalHours : null;
    const weeksUntilDeadline = typeof content?.weeksUntilDeadline === "number" ? content.weeksUntilDeadline : null;

    return (
        <div className="space-y-5">
            {(targetCompany || totalHours || weeksUntilDeadline) && (
                <div className="flex flex-wrap items-center gap-2">
                    {targetCompany && <Pill icon="apartment">{targetCompany}</Pill>}
                    {weeksUntilDeadline !== null && (
                        <Pill icon="event">
                            {weeksUntilDeadline} week{weeksUntilDeadline === 1 ? "" : "s"}
                        </Pill>
                    )}
                    {totalHours !== null && <Pill icon="schedule">{totalHours}h total</Pill>}
                </div>
            )}

            {summary && (
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{summary}</p>
            )}

            {priorityFocus && (
                <div className="rounded-2xl bg-primary/8 px-4 py-3 dark:bg-primary/15">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                        Priority focus
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {priorityFocus}
                    </p>
                </div>
            )}

            <ol className="space-y-3">
                {weeks.map((week) => (
                    <li
                        key={week.weekNumber}
                        className="rounded-2xl bg-slate-50 px-5 py-4 dark:bg-lc-hover"
                    >
                        <div className="mb-2 flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary text-xs font-extrabold text-white shadow-[0_4px_12px_-4px_rgba(74,124,255,0.6)]">
                                W{week.weekNumber}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-extrabold text-slate-900 dark:text-white">
                                    {week.title}
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    ~{week.estimatedHours}h
                                </p>
                            </div>
                        </div>

                        {week.goals.length > 0 && (
                            <ul className="mt-2 space-y-1.5 pl-12">
                                {week.goals.map((g, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                        <span>{g}</span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {week.topics.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5 pl-12">
                                {week.topics.slice(0, 6).map((t) => (
                                    <span
                                        key={t}
                                        className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-lc-bg dark:text-slate-300"
                                    >
                                        {prettyTopic(t)}
                                    </span>
                                ))}
                            </div>
                        )}

                        {week.milestone && (
                            <div className="mt-3 rounded-xl bg-white px-3 py-2 dark:bg-lc-bg">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                                    Milestone
                                </p>
                                <p className="mt-0.5 text-xs text-slate-700 dark:text-slate-300">
                                    {week.milestone}
                                </p>
                            </div>
                        )}
                    </li>
                ))}
                {weeks.length === 0 && (
                    <li className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-lc-hover dark:text-slate-400">
                        No weeks in this plan.
                    </li>
                )}
            </ol>
        </div>
    );
}

function QuizBody({ content }: { content: any }) {
    const items: QuizItem[] = Array.isArray(content?.items) ? content.items : [];
    const summary = typeof content?.summary === "string" ? content.summary : null;
    const topic = typeof content?.topic === "string" ? content.topic : null;

    const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Record<string, number>>({});

    const reveal = (id: string) => {
        setRevealedIds((s) => {
            const next = new Set(s);
            next.add(id);
            return next;
        });
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
                {topic && <Pill>{prettyTopic(topic)}</Pill>}
                <Pill icon="quiz">{items.length} question{items.length === 1 ? "" : "s"}</Pill>
            </div>

            {summary && (
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{summary}</p>
            )}

            <ol className="space-y-4">
                {items.map((item, idx) => {
                    const revealed = revealedIds.has(item.id);
                    const userChoice = selected[item.id];
                    return (
                        <li
                            key={item.id ?? idx}
                            className="rounded-2xl bg-slate-50 px-5 py-4 dark:bg-lc-hover"
                        >
                            <div className="mb-3 flex items-start gap-3">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary text-xs font-extrabold text-white">
                                    {idx + 1}
                                </div>
                                <p className="text-sm font-semibold leading-6 text-slate-900 dark:text-white">
                                    {item.prompt}
                                </p>
                            </div>

                            {item.format === "mcq" && Array.isArray(item.choices) && (
                                <div className="space-y-2 pl-10">
                                    {item.choices.map((choice, ci) => {
                                        const isSelected = userChoice === ci;
                                        const isCorrect = revealed && item.correctIndex === ci;
                                        const isWrongPick = revealed && isSelected && item.correctIndex !== ci;
                                        return (
                                            <button
                                                key={ci}
                                                type="button"
                                                onClick={() => {
                                                    setSelected((s) => ({ ...s, [item.id]: ci }));
                                                    reveal(item.id);
                                                }}
                                                disabled={revealed}
                                                className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                                                    isCorrect
                                                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200"
                                                        : isWrongPick
                                                            ? "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-200"
                                                            : isSelected
                                                                ? "bg-primary/12 text-primary"
                                                                : "bg-white text-slate-700 hover:bg-primary/8 dark:bg-lc-bg dark:text-slate-300 dark:hover:bg-lc-elevated"
                                                }`}
                                            >
                                                <span
                                                    className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${
                                                        isCorrect
                                                            ? "bg-emerald-500 text-white"
                                                            : isWrongPick
                                                                ? "bg-red-500 text-white"
                                                                : "bg-slate-200 text-slate-600 dark:bg-lc-hover dark:text-slate-300"
                                                    }`}
                                                >
                                                    {String.fromCharCode(65 + ci)}
                                                </span>
                                                <span className="flex-1">{choice}</span>
                                                {isCorrect && (
                                                    <span className="material-symbols-outlined text-[15px] text-emerald-600 dark:text-emerald-300">
                                                        check_circle
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {item.format === "short_answer" && (
                                <div className="pl-10">
                                    {!revealed ? (
                                        <button
                                            type="button"
                                            onClick={() => reveal(item.id)}
                                            className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary/8 dark:bg-lc-bg"
                                        >
                                            Reveal answer
                                        </button>
                                    ) : (
                                        <div className="rounded-xl bg-white px-3 py-2.5 dark:bg-lc-bg">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                                                Expected answer
                                            </p>
                                            <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                                                {item.expectedAnswer ?? "—"}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {revealed && item.explanation && (
                                <div className="ml-10 mt-3 rounded-xl bg-primary/6 px-3 py-2.5 dark:bg-primary/12">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                                        Why
                                    </p>
                                    <p className="mt-0.5 text-xs leading-5 text-slate-700 dark:text-slate-200">
                                        {item.explanation}
                                    </p>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

function GenericJSONBody({ content }: { content: any }) {
    return (
        <pre className="overflow-x-auto rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-700 dark:bg-lc-hover dark:text-slate-300">
            {JSON.stringify(content, null, 2)}
        </pre>
    );
}

// ─────────────────────────────────────────────────────────────────
// Profile setup modal
// ─────────────────────────────────────────────────────────────────

type ProfileFormState = {
    targetCompany: string;
    targetRole: string;
    targetLevel: string;
    targetDate: string; // yyyy-mm-dd
    hoursPerWeek: string;
    preferredLanguage: string;
};

const LEVEL_OPTIONS = ["Intern", "Entry", "Junior", "Mid", "Senior", "Staff", "Principal"];
const LANG_OPTIONS = ["Python", "JavaScript", "TypeScript", "Java", "C++", "Go", "Rust"];

export function ProfileSetupModal({
    token,
    onClose,
    onSaved,
    initialProfile,
}: {
    token: string;
    onClose: () => void;
    onSaved: (profile?: ProfileFormState) => void;
    initialProfile?: Partial<ProfileFormState> | null;
}) {
    const [form, setForm] = useState<ProfileFormState>({
        targetCompany: initialProfile?.targetCompany ?? "",
        targetRole: initialProfile?.targetRole ?? "",
        targetLevel: initialProfile?.targetLevel ?? "",
        targetDate: initialProfile?.targetDate ? initialProfile.targetDate.slice(0, 10) : "",
        hoursPerWeek: initialProfile?.hoursPerWeek ?? "",
        preferredLanguage: initialProfile?.preferredLanguage ?? "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const update = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        if (submitting) return;
        setError(null);
        setSubmitting(true);
        try {
            const hours = form.hoursPerWeek.trim();
            const payload: Record<string, unknown> = {
                targetCompany: form.targetCompany.trim() || null,
                targetRole: form.targetRole.trim() || null,
                targetLevel: form.targetLevel.trim() || null,
                targetDate: form.targetDate ? new Date(form.targetDate).toISOString() : null,
                hoursPerWeek: hours ? Math.max(1, Math.min(80, parseInt(hours, 10) || 0)) : null,
                preferredLanguage: form.preferredLanguage.trim() || null,
            };
            await api.put("/users/me/tutor/profile", payload, token);
            onSaved(form);
            onClose();
        } catch (err: any) {
            setError(err?.message || "Failed to save");
        } finally {
            setSubmitting(false);
        }
    };

    const allEmpty =
        !form.targetCompany.trim() &&
        !form.targetRole.trim() &&
        !form.targetLevel.trim() &&
        !form.targetDate &&
        !form.hoursPerWeek.trim() &&
        !form.preferredLanguage.trim();

    return (
        <ModalShell onClose={onClose} maxWidth="max-w-xl">
            <div className="bg-gradient-to-br from-primary/10 to-transparent px-7 pb-5 pt-7">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_6px_18px_-4px_rgba(74,124,255,0.55)]">
                        <span className="material-symbols-outlined text-[22px]">target</span>
                    </div>
                    <div className="min-w-0 flex-1 pr-10">
                        <h2 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                            What are you preparing for?
                        </h2>
                    </div>
                </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-7 pb-2 pt-4">
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Target company">
                        <CleanInput
                            value={form.targetCompany}
                            onChange={(v) => update("targetCompany", v)}
                            placeholder="Enter your target company"
                        />
                    </Field>
                    <Field label="Target role">
                        <CleanInput
                            value={form.targetRole}
                            onChange={(v) => update("targetRole", v)}
                            placeholder="Enter your target role"
                        />
                    </Field>

                    <Field label="Level">
                        <CleanSelect
                            value={form.targetLevel}
                            onChange={(v) => update("targetLevel", v)}
                            options={LEVEL_OPTIONS}
                            placeholder="Choose level"
                        />
                    </Field>
                    <Field label="Preferred language">
                        <CleanSelect
                            value={form.preferredLanguage}
                            onChange={(v) => update("preferredLanguage", v)}
                            options={LANG_OPTIONS}
                            placeholder="Choose language"
                        />
                    </Field>

                    <Field label="Deadline" hint="When you want to be ready">
                        <CleanInput
                            type="date"
                            value={form.targetDate}
                            onChange={(v) => update("targetDate", v)}
                            placeholder=""
                        />
                    </Field>
                    <Field label="Hours per week" hint="Realistic study time">
                        <CleanInput
                            type="number"
                            value={form.hoursPerWeek}
                            onChange={(v) => update("hoursPerWeek", v)}
                            placeholder="8"
                            min={1}
                            max={80}
                        />
                    </Field>
                </div>

                {error && (
                    <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
                        {error}
                    </p>
                )}
            </div>

            <div className="flex items-center justify-end gap-2 px-7 pb-7 pt-4">
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full px-5 py-2 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-lc-hover"
                >
                    Skip for now
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={submitting || allEmpty}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2 text-sm font-bold text-white shadow-[0_8px_22px_-6px_rgba(74,124,255,0.7)] transition-all hover:-translate-y-px hover:shadow-[0_10px_28px_-6px_rgba(74,124,255,0.8)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                    {submitting ? (
                        <>
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                            Saving…
                        </>
                    ) : (
                        <>
                            Save goals
                            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                        </>
                    )}
                </button>
            </div>
        </ModalShell>
    );
}

// ─────────────────────────────────────────────────────────────────
// Form primitives
// ─────────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                {label}
            </span>
            {children}
            {hint && (
                <span className="text-[10.5px] text-slate-400 dark:text-slate-500">{hint}</span>
            )}
        </label>
    );
}

function CleanInput({
    value,
    onChange,
    placeholder,
    type = "text",
    min,
    max,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
    min?: number;
    max?: number;
}) {
    return (
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            type={type}
            min={min}
            max={max}
            className="w-full rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition-colors focus:bg-primary/8 focus:outline-none dark:bg-lc-hover dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-lc-elevated"
        />
    );
}

function CleanSelect({
    value,
    onChange,
    options,
    placeholder,
}: {
    value: string;
    onChange: (v: string) => void;
    options: string[];
    placeholder?: string;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full appearance-none rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-medium text-slate-900 transition-colors focus:bg-primary/8 focus:outline-none dark:bg-lc-hover dark:text-white dark:focus:bg-lc-elevated"
        >
            <option value="">{placeholder ?? "Select"}</option>
            {options.map((o) => (
                <option key={o} value={o}>
                    {o}
                </option>
            ))}
        </select>
    );
}

// ─────────────────────────────────────────────────────────────────
// Small reusable visual atoms
// ─────────────────────────────────────────────────────────────────

function Pill({
    icon,
    children,
    tone = "primary",
}: {
    icon?: string;
    children: React.ReactNode;
    tone?: "primary" | "muted";
}) {
    const toneClass =
        tone === "primary"
            ? "bg-primary/10 text-primary"
            : "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300";
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${toneClass}`}
        >
            {icon && (
                <span className="material-symbols-outlined text-[13px] leading-none">{icon}</span>
            )}
            {children}
        </span>
    );
}

function DifficultyBadge({ value }: { value: string }) {
    const v = value.toLowerCase();
    const tone =
        v === "easy"
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300"
            : v === "hard"
                ? "bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300";
    return (
        <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${tone}`}
        >
            {v || "medium"}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function prettyTopic(t: string): string {
    return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRelative(iso: string): string {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return iso;
    const diff = Date.now() - t;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
