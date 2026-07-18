import { prisma } from "../../../lib/prisma.js";
import type { TutorToolRunInput } from "../tool-types.js";
import { buildEffectiveInterviewConfig } from "../module-context.js";

const STAGE_ALIASES: Record<string, string[]> = {
    INTRO: ["intro", "introduction", "resume", "background"],
    DSA: ["dsa", "coding", "algorithm", "leetcode", "graph", "dp", "binary search", "code"],
    FUNDAMENTALS: ["fundamentals", "cs", "os", "operating system", "cn", "network", "dbms", "oops", "sql"],
    SYSTEM_DESIGN: ["system design", "architecture", "scalability", "scale"],
    BEHAVIOURAL: ["behavioural", "behavioral", "star", "leadership", "conflict"],
    GEN_AI_CONCEPTS: ["genai", "gen ai", "llm", "rag", "prompting", "model evaluation"],
    GEN_AI_CODING: ["genai coding", "ai coding"],
    GEN_AI_SYSTEM_DESIGN: ["genai system design", "ai system design"],
    DS_CONCEPTS: ["data science", "statistics", "machine learning", "ml"],
    DS_SQL: ["ds sql", "data science sql", "sql"],
    DS_CODING: ["ds coding", "data science coding", "pandas", "python"],
    DS_BUSINESS_CASE: ["business case", "metrics case", "business metrics"],
    PM_CASE: ["pm case", "product case", "circles"],
    PM_CONCEPTS: ["pm concepts", "product metrics", "product sense"],
    PM_STRATEGY: ["strategy", "product strategy"],
    PM_BEHAVIORAL: ["pm behavioral", "pm behavioural"],
    PROBLEM_SOLVING: ["problem solving", "case", "analytical"],
    RESUME_STUDIES: ["education", "studies", "degree", "college"],
    RESUME_PROJECTS: ["project", "projects"],
    RESUME_EXPERIENCE: ["experience", "work experience", "internship"],
    RESUME_RESPONSIBILITY: ["responsibility", "por", "position of responsibility"],
    RESUME_SKILLS: ["skills", "claims", "tools"],
};

function inferRequestedStage(message: string, enabledStages: string[]): string | null {
    const lower = message.toLowerCase();
    const explicit = enabledStages.find((stage) => lower.includes(stage.toLowerCase()));
    if (explicit) return explicit;

    const candidates = enabledStages
        .filter((stage) => stage !== "CLOSING")
        .map((stage) => ({
            stage,
            matched: (STAGE_ALIASES[stage] || []).some((alias) => lower.includes(alias)),
        }))
        .filter((item) => item.matched);

    if (candidates.length === 1) return candidates[0].stage;

    if (lower.includes("sql")) {
        if (enabledStages.includes("DS_SQL")) return "DS_SQL";
        if (enabledStages.includes("FUNDAMENTALS")) return "FUNDAMENTALS";
    }

    return null;
}

function clipTranscript(full: string): { transcript: string; clipped: boolean } {
    const maxChars = 6500;
    if (full.length <= maxChars) return { transcript: full, clipped: false };

    const head = full.slice(0, 2800).trimEnd();
    const tail = full.slice(-3200).trimStart();
    return {
        transcript: `${head}\n...[stage middle omitted]...\n${tail}`,
        clipped: true,
    };
}

export async function runGetReportStageTranscriptContextTool(input: TutorToolRunInput) {
    const report = input.context?.report;
    const session = report?.session;
    if (!report?.sessionId || !session?.type) {
        return {
            transcriptAvailable: false,
            reason: "missing_report_context",
            transcript: "",
        };
    }

    const effectiveConfig = buildEffectiveInterviewConfig(session.type, session.moduleConfig ?? null);
    const availableStages = (effectiveConfig.enabledStages || []).filter((stage: string) => stage !== "CLOSING");
    const requestedStage = inferRequestedStage(input.message || "", availableStages);

    if (!requestedStage) {
        return {
            transcriptAvailable: false,
            reason: "stage_not_clear",
            availableStages,
            guidance: "Ask the user which interview stage they want reviewed, or answer from the report summary.",
            transcript: "",
        };
    }

    const messages = await prisma.sessionMessage.findMany({
        where: {
            sessionId: report.sessionId,
            stage: requestedStage,
            role: { in: ["user", "assistant"] },
        },
        orderBy: { createdAt: "asc" },
        select: {
            role: true,
            content: true,
            createdAt: true,
        },
        take: 80,
    });

    const full = messages
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n");
    const clipped = clipTranscript(full);

    return {
        transcriptAvailable: messages.length > 0,
        stage: requestedStage,
        availableStages,
        messageCount: messages.length,
        excerptPolicy: clipped.clipped ? "stage_head_tail_6500" : "stage_full",
        transcript: clipped.transcript,
    };
}
