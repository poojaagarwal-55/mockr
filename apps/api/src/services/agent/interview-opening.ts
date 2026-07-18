import type { InterviewStage, InterviewType } from "@interviewforge/shared";

const STAGE_LABELS: Record<string, string> = {
    INTRO: "introductory context",
    DSA: "live coding",
    FUNDAMENTALS: "CS fundamentals",
    SYSTEM_DESIGN: "system design",
    BEHAVIOURAL: "behavioral questions",
    GEN_AI_CONCEPTS: "GenAI fundamentals",
    GEN_AI_CODING: "GenAI coding",
    GEN_AI_SYSTEM_DESIGN: "GenAI system design",
    DS_CONCEPTS: "data science concepts",
    DS_SQL: "SQL",
    DS_CODING: "Python/Pandas data analysis",
    DS_BUSINESS_CASE: "business metrics case",
    PM_CASE: "product case",
    PM_CONCEPTS: "product concepts",
    PM_STRATEGY: "product strategy",
    PM_BEHAVIORAL: "PM behavioral questions",
    PROBLEM_SOLVING: "problem-solving case",
    RESUME_STUDIES: "studies and education",
    RESUME_PROJECTS: "project deep dives",
    RESUME_EXPERIENCE: "work experience and internships",
    RESUME_RESPONSIBILITY: "positions of responsibility",
    RESUME_SKILLS: "skills, resume claims, AI usage, and role fit",
    CLOSING: "wrap-up",
};

function humanList(items: string[]): string {
    if (items.length <= 1) return items[0] || "";
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function describeStage(stage: InterviewStage, moduleConfig?: any): string {
    const options = moduleConfig?.stageOptions?.[stage] || {};
    const topics = Array.isArray(options.topics) && options.topics.length > 0
        ? options.topics.map(String)
        : [];
    const subtopics = Array.isArray(options.subtopics) && options.subtopics.length > 0
        ? options.subtopics.map(String)
        : [];

    if (stage === "FUNDAMENTALS") {
        const selected = topics.length ? topics : ["core CS topics"];
        const sqlText = options.includeSQL === false ? "" : " plus SQL";
        return `${humanList(selected)}${sqlText}`;
    }

    if (stage === "DS_CONCEPTS" && topics.length) {
        return `data science concepts around ${humanList(topics)}`;
    }

    if (stage === "GEN_AI_CONCEPTS" && subtopics.length) {
        return `GenAI fundamentals around ${humanList(subtopics)}`;
    }

    if (stage === "DSA") {
        const difficulty = typeof options.difficulty === "string" ? options.difficulty : "";
        const topicText = topics.length ? ` on ${humanList(topics)}` : "";
        return `${difficulty ? `${difficulty.toLowerCase()} ` : ""}live coding${topicText}`;
    }

    return STAGE_LABELS[stage] || stage.toLowerCase().replace(/_/g, " ");
}

export function buildInterviewOpeningMessage(input: {
    interviewType: InterviewType;
    role?: string | null;
    level?: string | null;
    stageOrder: InterviewStage[];
    moduleConfig?: any;
}): string {
    if (input.interviewType === "system_design") {
        return [
            "Welcome. Today this will be a focused system design interview.",
            "We will briefly use your background to calibrate architecture, scaling, and trade-off discussion, then move into the design problem.",
            "I'll keep it structured and move one step at a time. Let's begin.",
        ].join(" ");
    }

    if (input.interviewType === "resume_round") {
        return [
            "Welcome. Today this will be a focused, in-depth resume screening round.",
            "I will go claim by claim, verify what you personally did, and pressure-test the strongest and weakest parts of your resume.",
            "We'll keep it structured and move one step at a time. Let's begin.",
        ].join(" ");
    }

    const practiceStages = input.stageOrder.filter((stage) => stage !== "CLOSING");
    const modules = practiceStages.map((stage) => describeStage(stage, input.moduleConfig));
    const plan = humanList(modules) || "this interview";

    return [
        `Welcome. Today we'll focus on ${plan}.`,
        "I'll keep it structured and move one step at a time. Let's begin.",
    ].join(" ");
}
