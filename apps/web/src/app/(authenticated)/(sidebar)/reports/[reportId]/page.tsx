"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { INTERVIEW_TYPE_MAP } from "@interviewforge/shared";
import { notifyReportGenerated } from "@/lib/notifications";

type RubricScore = {
    category: string;
    score: number;
    feedback?: string;
};

type QuestionRubricBreakdown = {
    category: string;
    score: number;
    feedback?: string;
};

type QuestionItem = {
    id: string;
    title: string;
    category: string;
    difficulty: string;
    score?: number | null;
    aiNotes?: string | null;
    finalCode?: string | null;
    codeLanguage?: string | null;
    userTranscript?: string | null;
    sampleAnswer?: string | null;
    sampleDiagramUrl?: string | null;
    rubricBreakdown?: QuestionRubricBreakdown[] | null;
};

type ImprovementItem = {
    step?: number;
    title: string;
    desc: string;
};

type WeaknessItem = {
    category: string;
    score: number;
    feedback: string;
};

type SectionFeedback = {
    section?: string;
    stage?: string;
    feedback?: string;
    summary?: string;
    score?: number;
    details?: string;
};

type CompetencyStrength = "top" | "above_avg" | "average" | "below_avg" | "not_observed";

type CompetencyScore = {
    id: string;
    label: string;
    score: number;           // 0-10
    evidence: string;
    analysis: string;
    tip: string;
    strength: CompetencyStrength;
};

type StudentCompetencyScore = CompetencyScore & {
    sourceIds: string[];
};

type ReportDetails = {
    id: string;
    sessionId: string;
    overallScore: number;
    rubricScores: RubricScore[];
    sectionFeedback: SectionFeedback[];
    strengths: string[];
    improvements: Array<string | ImprovementItem>;
    competencyScores?: CompetencyScore[] | null;
    competencyTrend?: Record<string, number | null> | null;
    benchmark?: {
        percentile?: number;
        totalCandidates?: number;
        message?: string;
    } | null;
    generatedAt: string;
    session: {
        id: string;
        type: string;
        role: string;
        level: string;
        createdAt: string;
        completedAt?: string | null;
        questions: QuestionItem[];
    };
};

function isNonFindingFeedback(value: string): boolean {
    const text = value.trim().toLowerCase();
    if (!text) return true;
    return (
        /\binsufficient\s+(transcript\s+)?evidence\b/.test(text) ||
        /\bnot enough\s+(information|evidence|data)\b/.test(text) ||
        /\bno\s+(clear|specific|meaningful|substantive)?\s*(strengths?|weakness(?:es)?|improvements?|evidence)\b/.test(text) ||
        /\bunable to (determine|assess|evaluate|identify)\b/.test(text) ||
        /\bcannot (determine|assess|evaluate|identify)\b/.test(text) ||
        /\bcould not (determine|assess|evaluate|identify)\b/.test(text) ||
        /\black of engagement\b/.test(text) ||
        /\bcomplete lack of engagement\b/.test(text) ||
        /\brepeated skipped questions?\b/.test(text) ||
        /\brefusals? to answer\b/.test(text)
    );
}

const CATEGORY_META: Record<string, { label: string; icon: string; badgeBg: string; iconColor: string }> = {
    problem_solving: {
        label: "Problem Solving",
        icon: "psychology",
        badgeBg: "bg-indigo-100 dark:bg-indigo-500/20",
        iconColor: "text-indigo-600 dark:text-indigo-300",
    },
    code_quality: {
        label: "Code Quality",
        icon: "code",
        badgeBg: "bg-emerald-100 dark:bg-emerald-500/20",
        iconColor: "text-emerald-600 dark:text-emerald-300",
    },
    communication: {
        label: "Communication",
        icon: "forum",
        badgeBg: "bg-blue-100 dark:bg-blue-500/20",
        iconColor: "text-blue-600 dark:text-blue-300",
    },
    cs_knowledge: {
        label: "CS Knowledge",
        icon: "school",
        badgeBg: "bg-cyan-100 dark:bg-cyan-500/20",
        iconColor: "text-cyan-700 dark:text-cyan-300",
    },
    speed: {
        label: "Speed & Efficiency",
        icon: "speed",
        badgeBg: "bg-amber-100 dark:bg-amber-500/20",
        iconColor: "text-amber-700 dark:text-amber-300",
    },
    system_design: {
        label: "System Design",
        icon: "hub",
        badgeBg: "bg-violet-100 dark:bg-violet-500/20",
        iconColor: "text-violet-700 dark:text-violet-300",
    },
    leadership_and_initiative: {
        label: "Leadership & Initiative",
        icon: "military_tech",
        badgeBg: "bg-rose-100 dark:bg-rose-500/20",
        iconColor: "text-rose-700 dark:text-rose-300",
    },
    conflict_resolution: {
        label: "Conflict Resolution",
        icon: "handshake",
        badgeBg: "bg-orange-100 dark:bg-orange-500/20",
        iconColor: "text-orange-700 dark:text-orange-300",
    },
    adaptability: {
        label: "Pivot Instinct",
        icon: "autorenew",
        badgeBg: "bg-sky-100 dark:bg-sky-500/20",
        iconColor: "text-sky-700 dark:text-sky-300",
    },
    teamwork: {
        label: "Teamwork",
        icon: "groups",
        badgeBg: "bg-teal-100 dark:bg-teal-500/20",
        iconColor: "text-teal-700 dark:text-teal-300",
    },
    genai_fundamentals: {
        label: "GenAI Fundamentals",
        icon: "auto_awesome",
        badgeBg: "bg-fuchsia-100 dark:bg-fuchsia-500/20",
        iconColor: "text-fuchsia-700 dark:text-fuchsia-300",
    },
    ai_ethics: {
        label: "AI Responsibility",
        icon: "policy",
        badgeBg: "bg-rose-100 dark:bg-rose-500/20",
        iconColor: "text-rose-700 dark:text-rose-300",
    },
    ai_tool_proficiency: {
        label: "AI Tool Proficiency",
        icon: "build",
        badgeBg: "bg-lime-100 dark:bg-lime-500/20",
        iconColor: "text-lime-700 dark:text-lime-300",
    },
    logical_reasoning: {
        label: "Logical Reasoning",
        icon: "schema",
        badgeBg: "bg-purple-100 dark:bg-purple-500/20",
        iconColor: "text-purple-700 dark:text-purple-300",
    },
    hint_absorption: {
        label: "Hint Absorption",
        icon: "lightbulb",
        badgeBg: "bg-yellow-100 dark:bg-yellow-500/20",
        iconColor: "text-yellow-700 dark:text-yellow-300",
    },
    conviction_under_pressure: {
        label: "Conviction Under Pressure",
        icon: "verified",
        badgeBg: "bg-slate-100 dark:bg-slate-500/20",
        iconColor: "text-slate-700 dark:text-slate-300",
    },
};

const DEFAULT_SIGNAL_LABELS = new Set([
    "Conviction & Drive",
    "Problem Deconstruction",
    "Clarifying Before Acting",
    "Adaptability",
    "Applied Knowledge",
    "Coachability",
]);

const SIGNAL_LABELS_BY_TYPE: Record<string, Set<string>> = {
    behavioural: new Set([
        "Ownership & Initiative",
        "STAR Structure",
        "Impact & Reflection",
        "Adaptability",
        "Specific Evidence",
        "Coachability",
    ]),
    behavioral: new Set([
        "Ownership & Initiative",
        "STAR Structure",
        "Impact & Reflection",
        "Adaptability",
        "Specific Evidence",
        "Coachability",
    ]),
    resume_round: new Set([
        "Claim Ownership",
        "Evidence Strength",
        "Project Depth",
        "AI Ownership Clarity",
        "Professional Framing",
        "Role Fit Signal",
    ]),
};

function formatCategory(category: string): string {
    const meta = CATEGORY_META[category];
    if (meta) return meta.label;
    if (category === "genai_concepts") return "GenAI Fundamentals";
    if (category === "genai_coding") return "Coding";
    if (category === "genai_system_design") return "System Design";
    return category.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function getGrade(score: number): string {
    if (score >= 90) return "A";
    if (score >= 80) return "B+";
    if (score >= 70) return "B";
    if (score >= 60) return "C";
    return "D";
}

function getScoreColor(score: number): string {
    if (score >= 7.5) return "text-emerald-600 dark:text-emerald-300";
    if (score >= 5) return "text-amber-600 dark:text-amber-300";
    return "text-red-600 dark:text-red-300";
}

function getScoreBarColor(score: number): string {
    if (score >= 7.5) return "bg-emerald-500";
    if (score >= 5) return "bg-amber-500";
    return "bg-red-500";
}

function getPerformanceRubricScores(report: ReportDetails): RubricScore[] {
    const configuredCategories = INTERVIEW_TYPE_MAP[report.session.type as keyof typeof INTERVIEW_TYPE_MAP]?.scoringCategories || [];
    const signalLabels = SIGNAL_LABELS_BY_TYPE[report.session.type] || DEFAULT_SIGNAL_LABELS;
    const expectedCategories = configuredCategories.filter((category) => !signalLabels.has(formatCategory(category)));
    const existingByCategory = new Map(report.rubricScores.map((score) => [score.category, score]));

    if (expectedCategories.length === 0) return report.rubricScores;

    return expectedCategories.map((category) => {
        const existing = existingByCategory.get(category);
        return existing || {
            category,
            score: 0,
            feedback: "This rubric was not present in the generated report.",
        };
    });
}

function getCompetencyStrengthMeta(strength: CompetencyStrength): { label: string; badgeBg: string; badgeText: string; barColor: string } {
    switch (strength) {
        case "top": return { label: "Strong", badgeBg: "bg-emerald-100 dark:bg-emerald-500/20", badgeText: "text-emerald-700 dark:text-emerald-300", barColor: "bg-emerald-500" };
        case "above_avg": return { label: "Growing", badgeBg: "bg-blue-100 dark:bg-blue-500/20", badgeText: "text-blue-700 dark:text-blue-300", barColor: "bg-blue-500" };
        case "average": return { label: "Steady", badgeBg: "bg-amber-100 dark:bg-amber-500/20", badgeText: "text-amber-700 dark:text-amber-300", barColor: "bg-amber-500" };
        case "below_avg": return { label: "Focus", badgeBg: "bg-orange-100 dark:bg-orange-500/20", badgeText: "text-orange-700 dark:text-orange-300", barColor: "bg-orange-500" };
        default: return { label: "Not shown yet", badgeBg: "bg-slate-100 dark:bg-slate-700/40", badgeText: "text-slate-500 dark:text-slate-400", barColor: "bg-slate-300 dark:bg-slate-600" };
    }
}

const STUDENT_COMPETENCY_GROUPS: Array<{
    id: string;
    label: string;
    sourceIds: string[];
    fallbackTip: string;
}> = [
        {
            id: "ownership_initiative",
            label: "Conviction & Drive",
            sourceIds: ["ownership_initiative", "conviction_under_uncertainty"],
            fallbackTip: "Use more first-person action language: what you decided, owned, and delivered.",
        },
        {
            id: "structured_thinking",
            label: "Problem Deconstruction",
            sourceIds: ["structured_thinking", "structured_debugging", "first_principles", "optimization_instinct"],
            fallbackTip: "Pause for a quick plan before answering: break the problem into steps, then solve.",
        },
        {
            id: "clarifying_before_acting",
            label: "Clarifying Before Acting",
            sourceIds: ["clarifying_before_acting", "spec_questioning"],
            fallbackTip: "Ask one clarifying question before jumping into your answer or solution.",
        },
        {
            id: "adaptability",
            label: "Adaptability",
            sourceIds: ["adaptability"],
            fallbackTip: "When given feedback or a new constraint, say how your approach changes.",
        },
        {
            id: "depth_of_experience",
            label: "Applied Knowledge",
            sourceIds: ["depth_of_experience", "resume_depth"],
            fallbackTip: "For each project, explain why you made choices, tradeoffs, and measurable impact.",
        },
        {
            id: "coachability",
            label: "Coachability",
            sourceIds: ["coachability", "hint_absorption"],
            fallbackTip: "When the interviewer hints, acknowledge it and update your answer out loud.",
        },
    ];

const BEHAVIOURAL_COMPETENCY_GROUPS: Array<{
    id: string;
    label: string;
    sourceIds: string[];
    fallbackTip: string;
}> = [
        {
            id: "ownership_initiative",
            label: "Ownership & Initiative",
            sourceIds: ["ownership_initiative", "conviction_under_uncertainty"],
            fallbackTip: "Use a specific STAR story and make your personal responsibility clear: what you owned, decided, and followed through on.",
        },
        {
            id: "structured_thinking",
            label: "STAR Structure",
            sourceIds: ["structured_thinking", "structured_debugging", "first_principles", "optimization_instinct"],
            fallbackTip: "Structure the answer as Situation, Task, Action, and Result so the interviewer can follow the story.",
        },
        {
            id: "clarifying_before_acting",
            label: "Impact & Reflection",
            sourceIds: ["clarifying_before_acting", "spec_questioning"],
            fallbackTip: "Close each story with what changed, what you learned, and what you would do differently next time.",
        },
        {
            id: "adaptability",
            label: "Adaptability",
            sourceIds: ["adaptability"],
            fallbackTip: "When given feedback or a new constraint, say how your approach changes.",
        },
        {
            id: "depth_of_experience",
            label: "Specific Evidence",
            sourceIds: ["depth_of_experience", "resume_depth"],
            fallbackTip: "Use concrete personal actions, outcomes, learning, and reflection instead of broad claims.",
        },
        {
            id: "coachability",
            label: "Coachability",
            sourceIds: ["coachability", "hint_absorption"],
            fallbackTip: "When the interviewer hints, acknowledge it and update your answer out loud.",
        },
    ];

const RESUME_COMPETENCY_GROUPS: Array<{
    id: string;
    label: string;
    sourceIds: string[];
    fallbackTip: string;
}> = [
        {
            id: "claim_ownership",
            label: "Claim Ownership",
            sourceIds: ["claim_ownership", "project_ownership"],
            fallbackTip: "For every resume item, separate exactly what you personally built, decided, changed, or verified.",
        },
        {
            id: "evidence_strength",
            label: "Evidence Strength",
            sourceIds: ["evidence_strength", "impact_evidence", "claim_confidence"],
            fallbackTip: "Back each claim with concrete proof: implementation detail, metric, user, test, deployment, or outcome.",
        },
        {
            id: "project_depth",
            label: "Project Depth",
            sourceIds: ["project_depth", "technical_depth", "depth_of_experience"],
            fallbackTip: "Prepare each project through what, why, ownership, architecture, implementation, evidence, and rebuild.",
        },
        {
            id: "ai_ownership_clarity",
            label: "AI Ownership Clarity",
            sourceIds: ["ai_ownership_clarity", "ai_contribution_clarity"],
            fallbackTip: "State what AI generated, what you changed or rejected, and how you verified correctness.",
        },
        {
            id: "professional_framing",
            label: "Professional Framing",
            sourceIds: ["professional_framing", "communication"],
            fallbackTip: "Describe users and stakeholders respectfully, and reframe weak claims without sounding defensive.",
        },
        {
            id: "role_fit_signal",
            label: "Role Fit Signal",
            sourceIds: ["role_fit_signal", "role_fit"],
            fallbackTip: "Pick two strongest resume proof points and connect them directly to your target role.",
        },
    ];

function strengthFromScore(score: number, observed: boolean): CompetencyStrength {
    if (!observed) return "not_observed";
    if (score >= 8) return "top";
    if (score >= 6) return "above_avg";
    if (score >= 4) return "average";
    return "below_avg";
}

function normalizeCompetencyTip(groupId: string, tip: string, fallbackTip: string): string {
    if (
        groupId === "clarifying_before_acting" &&
        /\btechnical example\b|\bclarifying question\b|\bbefore writing (?:any )?code\b/i.test(tip)
    ) {
        return fallbackTip;
    }
    return tip || fallbackTip;
}

function normalizeStudentCompetencies(
    raw: CompetencyScore[] | null | undefined,
    groups = STUDENT_COMPETENCY_GROUPS
): StudentCompetencyScore[] {
    const rows = Array.isArray(raw) ? raw : [];
    return groups.map((group) => {
        const matches = rows.filter((item) => group.sourceIds.includes(item.id));
        const observed = matches.filter((item) => item.strength !== "not_observed");
        const scored = observed.length > 0 ? observed : matches;
        const score = scored.length > 0
            ? Math.round(scored.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / scored.length)
            : 0;
        const evidenceSource = observed.find((item) => item.evidence?.trim()) || matches.find((item) => item.evidence?.trim());
        const tipSource = [...matches].sort((a, b) => (a.score || 0) - (b.score || 0)).find((item) => item.tip?.trim());
        return {
            id: group.id,
            label: group.label,
            sourceIds: group.sourceIds,
            score,
            strength: strengthFromScore(score, observed.length > 0),
            evidence: evidenceSource?.evidence || "",
            analysis: evidenceSource?.analysis || "",
            tip: normalizeCompetencyTip(group.id, tipSource?.tip || "", group.fallbackTip),
        };
    });
}

function getPriorityColor(step: number): string {
    if (step === 1) return "bg-red-500";
    if (step === 2) return "bg-amber-500";
    return "bg-primary";
}

function normalizeKey(value?: string): string {
    return (value || "")
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/[^a-z0-9\s]/g, "")
        .trim();
}

function toDisplayCategory(value: string): string {
    if (value === "genai_concepts") return "GenAI Fundamentals";
    if (value === "genai_coding") return "Coding";
    if (value === "genai_system_design") return "System Design";
    if (value === "cs_fundamentals") return "CS Fundamentals";
    return value.replace(/_/g, " ");
}

function resolveRoleLabel(interviewType?: string, storedRole?: string): string {
    if (interviewType === "data_science_role") return "Data Scientist";
    if (interviewType === "pm_role") return "Product Manager";
    if (interviewType === "gen_ai_role") return "Gen AI Interview";
    if (interviewType === "problem_solving_case") return "Problem Solving Interview";
    if (interviewType === "resume_round") return "Resume Screening Interview";
    return storedRole || "SDE";
}

function resolveQuestionTitle(question: QuestionItem, idx: number): string {
    const title = (question.title || "").trim();
    if (!title || title.toLowerCase() === "unknown question") return `Question ${idx + 1}`;
    return title;
}

function resolveCategory(question: QuestionItem, interviewType?: string): string {
    const category = (question.category || "").trim().toLowerCase();
    if (!category || category === "unknown category" || category === "unknown_category") return "general";
    if (interviewType === "gen_ai_role" && category === "cs_fundamentals") return "genai_concepts";
    return category;
}

type ConversationTurn = { role: "interviewer" | "candidate"; content: string };

function parseConversationExchange(userTranscript: string | null | undefined): ConversationTurn[] | null {
    if (!userTranscript) return null;
    try {
        const parsed = JSON.parse(userTranscript);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].role) {
            return parsed as ConversationTurn[];
        }
    } catch { }
    // Legacy plain text — split by double newline into individual candidate turns
    const messages = userTranscript.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
    if (messages.length === 0) return null;
    return messages.map(content => ({ role: "candidate" as const, content }));
}

function ConversationExchange({ turns }: { turns: ConversationTurn[] }) {
    return (
        <div className="space-y-2">
            {turns.map((turn, i) => (
                <div key={i} className={`rounded-lg px-3 py-2.5 text-sm leading-relaxed ${turn.role === "interviewer"
                    ? "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-400 border-l-2 border-slate-300 dark:border-slate-600"
                    : "bg-blue-50/60 text-slate-700 dark:bg-blue-500/10 dark:text-slate-200 border-l-2 border-blue-300 dark:border-blue-500/40"
                    }`}>
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-widest opacity-60">
                        {turn.role === "interviewer" ? "Interviewer" : "You"}
                    </p>
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                </div>
            ))}
        </div>
    );
}

function VerdictBadge({ score }: { score: number }) {
    if (score >= 80) return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold" style={{ background: "#dbeafe", color: "#1a4f8a" }}>Verdict: Strong Yes</span>
    );
    if (score >= 60) return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold" style={{ background: "#dcfce7", color: "#2e6b35" }}>Verdict: Weak Yes</span>
    );
    if (score >= 40) return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold" style={{ background: "#fef3c7", color: "#8a5a00" }}>Verdict: Weak No</span>
    );
    return (
        <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold" style={{ background: "#fee2e2", color: "#a32d2d" }}>Verdict: Strong No</span>
    );
}

function QuickStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-white/30 dark:border-lc-border bg-white dark:bg-lc-hover px-3.5 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-white">{value}</p>
        </div>
    );
}

function normalizeReportText(content: string): string {
    return content
        .replace(/\*\*([^*\n]+)\*\*/g, "$1")
        .replace(/^\s*[-*]\s+/gm, "")
        .trim();
}

function FormattedReportText({ content }: { content: string }) {
    const lines = content.split(/\n/);

    return (
        <>
            {lines.map((line, index) => {
                const match = line.match(/^(\s*(?:\d+\.\s*)?)([^:\n]{2,90}:)(\s*)(.*)$/);
                if (!match) {
                    return (
                        <span key={index}>
                            {line}
                            {index < lines.length - 1 ? "\n" : ""}
                        </span>
                    );
                }

                const [, prefix, label, gap, rest] = match;
                return (
                    <span key={index}>
                        {prefix}
                        <strong className="font-bold text-slate-800 dark:text-slate-100">{label}</strong>
                        {gap}
                        {rest}
                        {index < lines.length - 1 ? "\n" : ""}
                    </span>
                );
            })}
        </>
    );
}

function LazyTextField({
    content,
    type = "text",
    containerClass = "",
    textClass = "",
    language = ""
}: {
    content: string,
    type?: "text" | "code",
    containerClass?: string,
    textClass?: string,
    language?: string
}) {
    const [expanded, setExpanded] = useState(false);
    const limit = 400;
    const normalizedContent = type === "code" ? content : normalizeReportText(content);
    const isLong = normalizedContent.length > limit;

    const displayContent = !isLong || expanded ? normalizedContent : normalizedContent.slice(0, limit) + "...";

    return (
        <div className="relative w-full">
            {type === "code" ? (
                <pre className={`overflow-x-auto rounded-xl border border-slate-200/80 bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 dark:from-[#2a2a2a] dark:via-[#222222] dark:to-[#1a1a1a] dark:border-white/10 px-4 py-3 text-xs leading-relaxed text-slate-800 dark:text-slate-200 ${containerClass}`}>
                    <code>{displayContent}</code>
                </pre>
            ) : (
                <div className={`whitespace-pre-wrap ${containerClass} ${textClass}`}>
                    <FormattedReportText content={displayContent} />
                </div>
            )}

            {isLong && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="mt-2 flex w-max items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:text-[#6C63FF] dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-[#B7B2FF]"
                >
                    {expanded ? "Show Less" : "Load More"}
                    <span className="material-symbols-outlined text-[14px]">
                        {expanded ? "expand_less" : "expand_more"}
                    </span>
                </button>
            )}
        </div>
    );
}

export default function ReportPage() {
    useEffect(() => { document.title = "Report | Mockr"; }, []);
    const params = useParams();
    const reportId = params?.reportId as string;
    const router = useRouter();
    const { session: authSession } = useAuth();

    const [backUrl, setBackUrl] = useState("/reports");

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const fromParam = searchParams.get("from");
        if (fromParam && fromParam.startsWith("/reports/")) {
            setBackUrl(fromParam);
        }
    }, []);

    const [report, setReport] = useState<ReportDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isPending, setIsPending] = useState(false);
    const [refreshTick, setRefreshTick] = useState(0);
    const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);
    const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

    // ── Recording state ──────────────────────────────────────
    type RecordingInfo = {
        playbackUrl: string;
        durationSec: number | null;
        mimeType: string;
        expiresAt: string | null;
    };
    const [recording, setRecording] = useState<RecordingInfo | null>(null);
    const [recordingStatus, setRecordingStatus] = useState<"idle" | "loading" | "ready" | "expired" | "none">("idle");

    useEffect(() => {
        const token = authSession?.access_token;
        if (!reportId || !token) return;

        let isMounted = true;
        // Skip the full loading skeleton when we're already in the pending/polling state —
        // that prevents the UI from flickering back to the skeleton on every poll tick.
        if (!isPending) {
            setLoading(true);
        }
        setError(null);

        api.get<ReportDetails | { status: "PENDING"; message: string }>(`/users/me/reports/${reportId}`, token)
            .then((data) => {
                if (!isMounted) return;
                if ("status" in data && data.status === "PENDING") {
                    setIsPending(true);
                    setLoading(false);
                    return;
                }
                setIsPending(false);
                console.log("[ReportDebug] Raw API response:", JSON.stringify((data as any)._debug, null, 2));
                setReport(data as ReportDetails);
            })
            .catch((err: any) => {
                if (!isMounted) return;
                if (err?.status === 409 && err?.body?.status === "INTERVIEW_NOT_COMPLETED") {
                    setIsPending(true);
                    setError(null);
                    return;
                }
                if (err?.status === 500 && typeof err?.body?.message === "string") {
                    setError(err.body.message);
                    return;
                }
                setError(err?.message || "Failed to load report");
            })
            .finally(() => {
                if (!isMounted) return;
                setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [reportId, authSession?.access_token, refreshTick]);

    // Auto-poll when report is pending
    useEffect(() => {
        if (!isPending || report) return;

        const interval = setInterval(() => {
            setRefreshTick((n) => n + 1);
        }, 5000);

        return () => clearInterval(interval);
    }, [isPending, report]);

    useEffect(() => {
        if (report) {
            setIsPending(false);

            // Send notification when report is first loaded
            // Check if we've already notified for this report
            const notifiedKey = `report_notified_${report.id}`;
            if (!localStorage.getItem(notifiedKey)) {
                notifyReportGenerated(`/reports/${report.sessionId}`);
                localStorage.setItem(notifiedKey, 'true');
            }

            // Fetch recording if available
            const token = authSession?.access_token;
            if (token && report.session?.id) {
                setRecordingStatus("loading");
                api.get<any>(`/interviews/${report.session.id}/recording`, token)
                    .then((data) => {
                        setRecording({
                            playbackUrl: data.playbackUrl,
                            durationSec: data.durationSec ?? null,
                            mimeType: data.mimeType ?? "video/webm",
                            expiresAt: data.expiresAt ?? null,
                        });
                        setRecordingStatus("ready");
                    })
                    .catch((err: any) => {
                        if (err?.status === 410) {
                            setRecordingStatus("expired");
                        } else {
                            // 404 = no recording, 409 = still uploading, 403 = not premium
                            setRecordingStatus("none");
                        }
                    });
            }
        }
    }, [report, authSession?.access_token]);

    const normalizedImprovements = useMemo(() => {
        if (!report) return [] as ImprovementItem[];
        return report.improvements.map((item, idx) => {
            if (typeof item === "string") {
                return { step: idx + 1, title: `Improvement ${idx + 1}`, desc: item };
            }
            return {
                step: item.step ?? idx + 1,
                title: item.title,
                desc: item.desc,
            };
        }).filter((item) => item.desc?.trim() && !isNonFindingFeedback(`${item.title}\n${item.desc}`));
    }, [report]);

    const normalizedWeaknesses = useMemo(() => {
        if (!report) return [] as WeaknessItem[];
        return getPerformanceRubricScores(report)
            .filter((item) => Number(item.score) < 70)
            .filter((item) => !isNonFindingFeedback(item.feedback || ""))
            .sort((a, b) => a.score - b.score)
            .slice(0, 3)
            .map((item) => ({
                category: item.category,
                score: Math.round(item.score),
                feedback: item.feedback?.trim() || `Needs improvement in ${formatCategory(item.category).toLowerCase()}.`,
            }));
    }, [report]);

    const normalizedStrengths = useMemo(() => {
        if (!report) return [] as string[];
        return report.strengths
            .map((item) => String(item || "").trim())
            .filter((item) => item && !isNonFindingFeedback(item));
    }, [report]);

    const studentCompetencies = useMemo(() => {
        if (!report) return [] as StudentCompetencyScore[];
        const isBehaviouralReport = report.session.type === "behavioural" || report.session.type === "behavioral";
        return normalizeStudentCompetencies(
            report.competencyScores,
            report.session.type === "resume_round"
                ? RESUME_COMPETENCY_GROUPS
                : isBehaviouralReport
                    ? BEHAVIOURAL_COMPETENCY_GROUPS
                    : STUDENT_COMPETENCY_GROUPS
        );
    }, [report]);

    const competencyHighlights = useMemo(() => {
        const observed = studentCompetencies.filter((item) => item.strength !== "not_observed");
        const strongest = observed.length > 0
            ? [...observed].sort((a, b) => b.score - a.score)[0]
            : null;
        const focus = observed.length > 0
            ? [...observed].sort((a, b) => a.score - b.score)[0]
            : null;
        const notShown = studentCompetencies.find((item) => item.strength === "not_observed") || null;
        return { strongest, focus, notShown };
    }, [studentCompetencies]);

    const selectedSignal = useMemo(() => {
        return studentCompetencies.find((item) => item.id === selectedSignalId) || null;
    }, [studentCompetencies, selectedSignalId]);

    const questionBreakdownMode = (report?.session as any)?.questionBreakdownMode || "question";
    const showQuestionBreakdown = questionBreakdownMode === "question";
    const isResumeRound = report?.session.type === "resume_round";
    const isBehaviouralRound = report?.session.type === "behavioural" || report?.session.type === "behavioral";

    useEffect(() => {
        if (!showQuestionBreakdown || !report?.session.questions?.length) {
            setOpenQuestionId(null);
            return;
        }
        setOpenQuestionId((current) => current ?? report.session.questions[0].id);
    }, [report, showQuestionBreakdown]);

    useEffect(() => {
        if (studentCompetencies.length === 0) {
            setSelectedSignalId(null);
        }
        // Panel starts closed — user clicks a card to open it
    }, [studentCompetencies]);

    // Rotating status messages for pending state
    const pendingMessages = [
        "Analyzing your interview transcript...",
        "Evaluating your responses against rubrics...",
        "Generating detailed feedback...",
        "Almost there — finalizing your report...",
    ];
    const pendingMsgIndex = Math.min(Math.floor(refreshTick / 2), pendingMessages.length - 1);

    if (loading) {
        return (
            <div className="flex-1 overflow-auto dark:bg-lc-bg">
                <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Interview Report</h1>} showBack backUrl={backUrl} />
                <main className="p-8 max-w-6xl">
                    <div className="h-56 rounded-2xl bg-slate-100 dark:bg-lc-hover animate-pulse mb-8" />
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                        {Array.from({ length: 5 }).map((_, idx) => (
                            <div key={idx} className="h-40 rounded-xl bg-slate-100 dark:bg-lc-hover animate-pulse" />
                        ))}
                    </div>
                </main>
            </div>
        );
    }

    if (isPending && !report) {
        return (
            <div className="flex-1 overflow-auto dark:bg-lc-bg">
                <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Interview Report</h1>} showBack backUrl={backUrl} />
                <main className="p-8 max-w-4xl">
                    <div className="bg-white dark:bg-lc-surface rounded-xl border border-slate-200 dark:border-lc-border p-12 text-center">
                        <div className="relative mx-auto size-14 mb-6">
                            <div className="size-14 border-4 border-slate-200 dark:border-lc-border rounded-full" />
                            <div className="absolute inset-0 size-14 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Generating your report</h2>
                        <p className="text-slate-500 dark:text-[#ababab] mt-2 transition-all duration-300">
                            {pendingMessages[pendingMsgIndex]}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-[#6b6b6b] mt-4">
                            This usually takes 15–30 seconds. The page will update automatically.
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    if (error || !report) {
        return (
            <div className="flex-1 overflow-auto dark:bg-lc-bg">
                <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Interview Report</h1>} showBack backUrl={backUrl} />
                <main className="p-8 max-w-4xl">
                    <div className="bg-white dark:bg-lc-surface rounded-xl border border-slate-200 dark:border-lc-border p-8 text-center">
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Unable to load report</h2>
                        <p className="text-slate-500 dark:text-[#ababab] mt-2">{error || "Report not found."}</p>
                    </div>
                </main>
            </div>
        );
    }

    const interviewTypeLabel = INTERVIEW_TYPE_MAP[report.session.type as keyof typeof INTERVIEW_TYPE_MAP]?.label || report.session.type;
    // Convert /100 score to /10
    const overallScore10 = Math.round((report.overallScore / 10) * 10) / 10;
    const overallScore = Math.round(report.overallScore); // keep for legacy compat
    const generatedDate = new Date(report.generatedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });

    // Duration from session
    const durationMin = report.session.completedAt && report.session.createdAt
        ? Math.round((new Date(report.session.completedAt).getTime() - new Date(report.session.createdAt).getTime()) / 60000)
        : null;

    const percentile = report.benchmark?.percentile;

    const performanceRubricScores = getPerformanceRubricScores(report);
    const sortedRubricScores = [...performanceRubricScores].sort((a, b) => b.score - a.score);
    const bestCategory = sortedRubricScores[0];
    const worstCategory = [...sortedRubricScores].reverse()[0];
    const weakAreas = [...performanceRubricScores]
        .filter((item) => Number(item.score) < 70)
        .filter((item) => !isNonFindingFeedback(item.feedback || ""))
        .sort((a, b) => a.score - b.score)
        .slice(0, 2);

    const findSectionFeedbackForQuestion = (question: QuestionItem): string | null => {
        if (!report.sectionFeedback.length) return null;

        const qCategory = normalizeKey(question.category);
        const qTitle = normalizeKey(question.title);

        const match = report.sectionFeedback.find((section) => {
            const key = normalizeKey(section.section || section.stage);
            if (!key) return false;
            if (qCategory && (key.includes(qCategory) || qCategory.includes(key))) return true;
            if (!qTitle) return false;
            return qTitle.split(" ").filter(Boolean).slice(0, 3).some((token) => token.length > 3 && key.includes(token));
        });

        return match?.feedback || match?.summary || match?.details || null;
    };

    return (
        <div className="flex-1 overflow-auto dark:bg-lc-bg">
            <PageHeader
                showBack
                backUrl={backUrl}
                titleNode={
                    <div className="flex flex-col gap-1.5">
                        <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Interview Report</h1>
                        <div className="flex items-center gap-4 flex-wrap font-normal" style={{ fontSize: "12px", color: "#6b7280" }}>
                            <span>Interview Type: <span className="font-bold text-slate-800 dark:text-white">{interviewTypeLabel}</span></span>
                            <span>Date: <span className="font-bold text-slate-800 dark:text-white">{generatedDate}</span></span>
                            {durationMin != null && durationMin > 0 && (
                                <span>Duration: <span className="font-bold text-slate-800 dark:text-white">{durationMin} min</span></span>
                            )}
                        </div>
                    </div>
                }
            />

            <main className="p-8 max-w-6xl">
                {/* ── Hero Box ── */}
                <section className="mb-8 overflow-hidden rounded-2xl p-8 relative bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 dark:from-[#2a2a2a] dark:via-[#222222] dark:to-[#1a1a1a] border border-slate-200/80 dark:border-white/10 transition-all duration-300 hover:shadow-[0_15px_40px_rgba(0,0,0,0.12)] hover:-translate-y-1 hover:scale-[1.005]">
                    <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Overall Performance</p>
                            <div className="flex flex-wrap items-baseline gap-3">
                                <span className="text-7xl font-bold font-nunito text-slate-900 dark:text-white">{overallScore10}</span>
                                <span className="text-2xl font-semibold text-slate-600 dark:text-slate-400">/10</span>
                            </div>

                            <div className="mt-4 w-full max-w-sm">
                                <div className="relative h-2 overflow-hidden rounded-full bg-blue-200/60 dark:bg-slate-700">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${Math.max(0, Math.min(100, overallScore))}%`,
                                            background: "#6C63FF",
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Verdict — separated below the bar */}
                            <div className="mt-4">
                                <VerdictBadge score={overallScore} />
                            </div>

                            {typeof percentile === "number" && (
                                <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                                    Better than {percentile}% of candidates at this level
                                </p>
                            )}
                        </div>

                        {/* 2×2 stat tiles */}
                        <div className="grid w-full max-w-md grid-cols-2 gap-3">
                            <QuickStat
                                label={isResumeRound ? "Coverage" : isBehaviouralRound ? "Stories" : "Questions"}
                                value={showQuestionBreakdown ? `${report.session.questions.length}` : isResumeRound ? "Resume-based" : isBehaviouralRound ? "Story-based" : "Section-based"}
                            />
                            <QuickStat label="Role" value={resolveRoleLabel(report.session.type, report.session.role)} />
                            <QuickStat label="Best Category" value={bestCategory ? formatCategory(bestCategory.category) : "N/A"} />
                            <QuickStat label="Weakest" value={worstCategory ? formatCategory(worstCategory.category) : "N/A"} />
                        </div>
                    </div>
                </section>

                {!isResumeRound && (
                    <section className="mb-8 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Performance Breakdown</h2>
                        <div className="mt-4 space-y-3">
                            {sortedRubricScores.map((cat) => {
                                const score10 = Math.round((cat.score / 10) * 10) / 10;
                                const score = cat.score; // raw /100 for bar width and color thresholds
                                return (
                                    <div
                                        key={cat.category}
                                        className="grid items-center gap-x-5 gap-y-2 sm:grid-cols-[minmax(150px,240px)_minmax(180px,1fr)_72px]"
                                    >
                                        <span className="min-w-0 text-sm font-semibold leading-5 text-slate-600 dark:text-slate-300">
                                            {formatCategory(cat.category)}
                                        </span>
                                        <div className="h-2.5 min-w-0 overflow-hidden rounded-full bg-slate-100 dark:bg-lc-hover">
                                            <div
                                                className={`h-full rounded-full ${getScoreBarColor(score / 10)}`}
                                                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                                            />
                                        </div>
                                        <span className={`text-right text-sm font-bold tabular-nums ${getScoreColor(score / 10)}`}>{score10}/10</span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── Behavioural Competency Scores ── */}
                {studentCompetencies.length > 0 && (
                    <section className="mb-8 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="mb-5">
                            <h2 className="font-nunito text-[18px] font-bold tracking-tight text-slate-800 dark:text-white">{isResumeRound ? "Resume Signals" : "Interview Signals"}</h2>
                            <p className="mt-0.5 text-sm text-slate-500 dark:text-[#ababab]">
                                {isResumeRound
                                    ? "Evidence patterns observed across your resume answers."
                                    : isBehaviouralRound
                                        ? "Behavioural patterns observed across your STAR answers."
                                        : "Interview habits observed across your technical performance."}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                            {studentCompetencies.map((comp) => {
                                const meta = getCompetencyStrengthMeta(comp.strength);
                                const isObserved = comp.strength !== "not_observed";
                                const isSelected = selectedSignalId === comp.id;
                                const ownDelta = report.competencyTrend?.[comp.id];
                                const legacyDeltas = comp.sourceIds
                                    .map((id) => report.competencyTrend?.[id])
                                    .filter((value): value is number => typeof value === "number");
                                const delta = typeof ownDelta === "number"
                                    ? ownDelta
                                    : legacyDeltas.length > 0
                                        ? Math.round(legacyDeltas.reduce((sum, value) => sum + value, 0) / legacyDeltas.length)
                                        : null;
                                const hasTrend = delta !== null;
                                const trendPositive = hasTrend && delta > 0;
                                const trendFlat = hasTrend && delta === 0;

                                return (
                                    <button
                                        key={comp.id}
                                        type="button"
                                        onClick={() => setSelectedSignalId(isSelected ? null : comp.id)}
                                        aria-pressed={isSelected}
                                        className={`group flex min-h-36 flex-col gap-4 rounded-xl border p-4 text-left transition-all duration-200 dark:border-lc-border ${
                                            isSelected
                                                ? "border-slate-400 bg-slate-50 shadow-md dark:border-slate-400 dark:bg-lc-hover"
                                                : isObserved
                                                    ? "border-slate-100 bg-white hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 dark:bg-lc-surface dark:hover:bg-lc-hover dark:hover:border-slate-500"
                                                    : "border-dashed border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm hover:-translate-y-0.5 dark:bg-lc-surface dark:hover:bg-lc-hover"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-sm font-bold leading-tight text-slate-900 dark:text-white">{comp.label}</p>
                                            <span className={`text-lg font-bold tabular-nums ${isObserved ? getScoreColor(comp.score) : "text-slate-300 dark:text-slate-600"}`}>
                                                {isObserved ? `${comp.score}` : "0"}<span className="text-xs font-normal text-slate-400">/10</span>
                                            </span>
                                        </div>

                                        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{comp.tip}</p>
                                    </button>
                                );
                            })}
                        </div>

                        {selectedSignal && (() => {
                            // Parse evidence into bullet points (split by sentence)
                            const sentences = selectedSignal.evidence
                                ? selectedSignal.evidence
                                    .split(/(?<=[.!?])\s+/)
                                    .map((s) => s.trim())
                                    .filter((s) => s.length > 10)
                                : [];

                            return (
                                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                                    {/* Panel header */}
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <p className="text-base font-bold text-slate-900 dark:text-white">{selectedSignal.label}</p>
                                            <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                                selectedSignal.strength === "not_observed"
                                                    ? "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                                                    : `${getCompetencyStrengthMeta(selectedSignal.strength).badgeBg} ${getCompetencyStrengthMeta(selectedSignal.strength).badgeText}`
                                            }`}>
                                                {selectedSignal.strength === "not_observed" ? "Not shown in this interview" : getCompetencyStrengthMeta(selectedSignal.strength).label}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedSignalId(null)}
                                            className="flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-lc-hover dark:hover:text-white"
                                            aria-label="Close"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">close</span>
                                        </button>
                                    </div>

                                    <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 dark:border-lc-border dark:bg-lc-hover">
                                        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Card Guidance</p>
                                        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{selectedSignal.tip}</p>
                                    </div>

                                    {/* Two-column body */}
                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                        {/* Left: Key Observations */}
                                        <div>
                                            <p className="mb-2 text-sm font-bold text-slate-800 dark:text-white">Key Observations</p>
                                            {sentences.length > 0 ? (
                                                <ul className="space-y-1.5">
                                                    {sentences.map((s, i) => (
                                                        <li key={i} className="flex items-start gap-2">
                                                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
                                                            <span className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{s}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 italic">No transcript evidence captured for this signal in this session.</p>
                                            )}
                                        </div>

                                        {/* Right: Insights & Analysis */}
                                        <div>
                                            <p className="mb-2 text-sm font-bold text-slate-800 dark:text-white">Insights &amp; Analysis</p>
                                            {selectedSignal.analysis ? (
                                                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{selectedSignal.analysis}</p>
                                            ) : (
                                                <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 italic">This signal was not observed in the session — no analysis available.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </section>
                )}

                <section className="mb-8 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <div className="border-b border-slate-100 p-6 dark:border-lc-border">
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                            {isResumeRound ? "Resume Screening Interview Analysis" : isBehaviouralRound ? "Behavioral Story Analysis" : "Question Breakdown"}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-[#ababab]">
                            {showQuestionBreakdown
                                ? `${report.session.questions.length} questions, click to expand details`
                                : isResumeRound
                                    ? "This interview is summarized by verified claims, unverified claims, resume risks, and answer quality."
                                    : isBehaviouralRound
                                        ? "This interview is summarized by STAR story quality, ownership evidence, impact, reflection, and communication."
                                        : "This interview is summarized by major evaluation areas instead of individual questions."}
                        </p>
                    </div>

                    {!showQuestionBreakdown ? (
                        <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
                            {report.sectionFeedback.length > 0 ? report.sectionFeedback.map((section, idx) => {
                                const title = section.section || section.stage || `Section ${idx + 1}`;
                                const body = section.feedback || section.summary || section.details || "";
                                const isSummary = normalizeKey(title).includes("screening summary");
                                return (
                                    <div key={`${title}-${idx}`} className={`rounded-xl border p-4 ${
                                        isSummary
                                            ? "border-indigo-100 bg-indigo-50/60 dark:border-indigo-500/15 dark:bg-indigo-500/5"
                                            : "border-slate-100 bg-white dark:border-lc-border dark:bg-lc-surface"
                                    }`}>
                                        <p className="text-sm font-bold text-slate-900 dark:text-white">{title}</p>
                                        <LazyTextField
                                            content={body || "No feedback generated for this section."}
                                            containerClass="mt-2"
                                            textClass="text-sm leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap"
                                        />
                                    </div>
                                );
                            }) : (
                                <p className="text-sm text-slate-500 dark:text-[#ababab]">No section analysis was generated.</p>
                            )}
                        </div>
                    ) : report.session.questions.length === 0 ? (
                        <div className="p-6 text-sm text-slate-500 dark:text-[#ababab]">
                            No questions were attempted in this interview yet.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-lc-border">
                            {report.session.questions.map((question, idx) => {
                                const displayTitle = resolveQuestionTitle(question, idx);
                                const displayCategory = resolveCategory(question, report.session.type);
                                const isOpen = openQuestionId === question.id;
                                const qScore = question.score != null ? Math.round(question.score) : null;
                                const qScore10 = qScore != null ? Math.round((qScore / 10) * 10) / 10 : null;
                                const scoreColor = qScore == null ? "text-slate-400 dark:text-[#ababab]" : getScoreColor(qScore / 10);
                                const borderColor =
                                    qScore == null
                                        ? "border-slate-200 dark:border-lc-border"
                                        : qScore >= 75
                                            ? "border-emerald-400"
                                            : qScore >= 50
                                                ? "border-amber-400"
                                                : "border-red-400";
                                const fallbackSectionFeedback = findSectionFeedbackForQuestion(question);

                                return (
                                    <div key={question.id} className={`border-l-4 ${borderColor}`}>
                                        <button
                                            onClick={() => setOpenQuestionId(isOpen ? null : question.id)}
                                            className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-lc-hover"
                                        >
                                            <div className="flex items-center gap-4">
                                                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                                                    {idx + 1}
                                                </span>
                                                <div>
                                                    <p className="text-sm font-semibold leading-snug text-slate-900 dark:text-white">{displayTitle}</p>
                                                    <div className="mt-1 flex items-center gap-2">
                                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:bg-lc-hover">
                                                            {toDisplayCategory(displayCategory)}
                                                        </span>
                                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-[#ababab]">
                                                            {question.difficulty}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-3">
                                                {qScore != null ? (
                                                    <span className={`text-lg font-bold ${scoreColor}`}>{qScore}/100</span>
                                                ) : (
                                                    <span className={`text-sm font-semibold ${scoreColor}`}>Not scored</span>
                                                )}
                                                <span className={`material-symbols-outlined text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}>
                                                    expand_more
                                                </span>
                                            </div>
                                        </button>

                                        {isOpen ? (
                                            <div className="space-y-5 border-t border-slate-100 px-5 pb-6 dark:border-lc-border">
                                                {/* User's submitted code (coding questions) */}
                                                {question.finalCode ? (
                                                    <div>
                                                        <div className="mb-2 flex items-center gap-2">
                                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-[#ababab]">Your Code</p>
                                                            {question.codeLanguage && (
                                                                <span className="rounded-full bg-indigo-100 dark:bg-indigo-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                                                                    {question.codeLanguage}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <LazyTextField content={question.finalCode} type="code" language={question.codeLanguage || undefined} />
                                                    </div>
                                                ) : null}

                                                {question.sampleAnswer ? (() => {
                                                    // Detect if the sample answer looks like code
                                                    // (has keywords, indentation typical of source code)
                                                    const looksLikeCode =
                                                        question.category === "coding" ||
                                                        question.category === "genai_coding" ||
                                                        /^(class |def |function |int |void |public |import |from |SELECT |#include)/.test(question.sampleAnswer.trimStart());
                                                    return (
                                                        <div>
                                                            <div className="mb-2 flex items-center gap-2">
                                                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-[#ababab]">Sample Answer</p>
                                                                {looksLikeCode && question.codeLanguage && (
                                                                    <span className="rounded-full bg-indigo-100 dark:bg-indigo-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                                                                        {question.codeLanguage}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {looksLikeCode ? (
                                                                <LazyTextField content={question.sampleAnswer} type="code" language={question.codeLanguage || undefined} />
                                                            ) : (
                                                                <LazyTextField content={question.sampleAnswer} containerClass="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 dark:border-emerald-500/15 dark:bg-emerald-500/5" textClass="text-sm leading-relaxed text-slate-600 dark:text-slate-300" />
                                                            )}
                                                            {question.sampleDiagramUrl && (
                                                                <div className="mt-4">
                                                                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-[#ababab]">Reference Architecture</p>
                                                                    <div className="rounded-xl border border-slate-200 dark:border-lc-border overflow-hidden bg-white dark:bg-lc-surface">
                                                                        <img
                                                                            src={question.sampleDiagramUrl}
                                                                            alt="Reference architecture diagram"
                                                                            className="w-full h-auto object-contain"
                                                                            loading="lazy"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })() : null}

                                                {question.aiNotes ? (
                                                    <div>
                                                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-[#ababab]">AI Feedback</p>
                                                        <LazyTextField content={question.aiNotes} textClass="text-sm leading-relaxed text-slate-600 dark:text-slate-300" />
                                                    </div>
                                                ) : null}

                                                {!question.aiNotes && fallbackSectionFeedback ? (
                                                    <div>
                                                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-[#ababab]">Stage Feedback</p>
                                                        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{fallbackSectionFeedback}</p>
                                                    </div>
                                                ) : null}

                                                {question.rubricBreakdown && question.rubricBreakdown.length > 0 ? (
                                                    <div>
                                                        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-[#ababab]">How You Scored</p>
                                                        <div className="space-y-3">
                                                            {question.rubricBreakdown.map((rb) => {
                                                                const rbScore = rb.score;
                                                                const rbScore10 = Math.round((rbScore / 10) * 10) / 10;
                                                                return (
                                                                    <div key={rb.category}>
                                                                        <div className="mb-1 flex items-center justify-between text-xs">
                                                                            <span className="font-semibold text-slate-600 dark:text-slate-300">
                                                                                {formatCategory(rb.category)}
                                                                            </span>
                                                                            <span className="font-bold text-slate-700 dark:text-white">{rbScore10}/10</span>
                                                                        </div>
                                                                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-lc-hover">
                                                                            <div
                                                                                className={`h-full rounded-full ${getScoreBarColor(rbScore)}`}
                                                                                style={{ width: `${Math.max(0, Math.min(100, rbScore))}%` }}
                                                                            />
                                                                        </div>
                                                                        {rb.feedback ? (
                                                                            <p className="mt-1 text-[11px] text-slate-400 dark:text-[#ababab]">{rb.feedback}</p>
                                                                        ) : null}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                            Strengths
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                                {normalizedStrengths.length}
                            </span>
                        </h2>
                        {normalizedStrengths.length > 0 ? (
                            <div className="mt-4 space-y-3">
                                {normalizedStrengths.map((strength, idx) => (
                                    <div
                                        key={`${idx}-${strength}`}
                                        className="flex items-start gap-3 rounded-xl border border-emerald-100/60 bg-emerald-50/70 p-3 dark:border-emerald-500/10 dark:bg-emerald-500/5"
                                    >
                                        <span className="material-symbols-outlined mt-0.5 text-sm text-emerald-500">check_circle</span>
                                        <p className="text-sm text-slate-700 dark:text-slate-300">{strength}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-4 text-sm text-slate-500 dark:text-[#ababab]">No strengths were generated for this report.</p>
                        )}
                    </section>

                    <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                            Weaknesses
                            <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                                {normalizedWeaknesses.length}
                            </span>
                        </h2>
                        {normalizedWeaknesses.length > 0 ? (
                            <div className="mt-4 space-y-3">
                                {normalizedWeaknesses.map((item) => (
                                    <div
                                        key={item.category}
                                        className="rounded-xl border border-rose-100/60 bg-rose-50/60 p-3 dark:border-rose-500/10 dark:bg-rose-500/5"
                                    >
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {formatCategory(item.category)}
                                            </p>
                                            <span className={`text-xs font-bold ${getScoreColor(item.score / 10)}`}>
                                                {Math.round((item.score / 10) * 10) / 10}/10
                                            </span>
                                        </div>
                                        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{item.feedback}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-4 text-sm text-slate-500 dark:text-[#ababab]">No weaknesses were generated for this report.</p>
                        )}
                    </section>

                    <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Improvement Plan</h2>
                        {normalizedImprovements.length > 0 ? (
                            <div className="space-y-4">
                                {normalizedImprovements.map((item) => {
                                    const step = item.step ?? 3;
                                    return (
                                        <div key={`${item.step}-${item.title}`} className="rounded-xl border border-slate-100 p-4 dark:border-lc-border">
                                            <div className="mb-2 flex items-center gap-3">
                                                <div
                                                    className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${getPriorityColor(step)}`}
                                                >
                                                    {step}
                                                </div>
                                                <p className="text-sm font-bold text-slate-900 dark:text-[#eff1f6]">{item.title}</p>
                                            </div>
                                            <p className="pl-11 text-xs leading-relaxed text-slate-500 dark:text-[#ababab]">{item.desc}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 dark:text-[#ababab]">No specific improvement actions were generated.</p>
                        )}
                    </section>
                </div>

                <section className="mb-2 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Recommended Next Steps</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-[#ababab]">
                        Focus on your two weakest rubric areas in the next practice session.
                    </p>
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        {weakAreas.map((area) => (
                            <button
                                key={area.category}
                                onClick={() => router.push("/interviews/ai")}
                                className="group flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-slate-200 p-5 text-left transition-colors hover:border-primary/40 dark:border-lc-border"
                            >
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-[#ababab]">Needs work</p>
                                    <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatCategory(area.category)}</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-[#ababab]">Score: {Math.round(area.score)}/100</p>
                                </div>
                                <span className="material-symbols-outlined text-primary transition-transform group-hover:translate-x-1">
                                    arrow_forward
                                </span>
                            </button>
                        ))}
                    </div>
                </section>

                {/* ── Session Recording ── */}
                {recordingStatus === "ready" && recording && (
                    <section className="mt-8 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-lc-border">
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight">Session Recording</h2>
                            <div className="flex items-center gap-2">
                                {recording.durationSec != null && (
                                    <span className="rounded-full bg-slate-100 dark:bg-lc-hover px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                                        Duration: {Math.floor(recording.durationSec / 60)}:{String(recording.durationSec % 60).padStart(2, "0")}
                                    </span>
                                )}
                                {recording.expiresAt && (
                                    <span className="rounded-full bg-slate-100 dark:bg-lc-hover px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                                        Expires {new Date(recording.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="p-4">
                            <video
                                src={recording.playbackUrl}
                                controls
                                preload="metadata"
                                className="w-full rounded-xl bg-black"
                                style={{ maxHeight: "480px" }}
                            >
                                Your browser does not support video playback.
                            </video>
                        </div>
                    </section>
                )}

                {recordingStatus === "expired" && (
                    <section className="mt-8 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-slate-400 text-[20px]">videocam_off</span>
                            <div>
                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Recording Expired</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500">This recording has been automatically deleted per your plan's retention policy.</p>
                            </div>
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
