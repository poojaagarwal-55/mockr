import type { InterviewStage, InterviewType } from "@interviewforge/shared";
import {
    buildSystemDiagramContext,
    hasMeaningfulDiagram,
} from "../canvas-diagram-context.js";
import type { ResumeAgendaState, ResumeProbeState } from "../interview-runtime-types.js";
import { buildResumeAgendaPromptBlock } from "../resume-agenda-state.js";

export interface PromptBuilderContext {
    interviewType: InterviewType;
    moduleConfig?: any;
    role: string;
    level: string;
    stage: InterviewStage;
    resumeSummary: any | null;
    currentQuestionTitle: string | null;
    codeSnapshot: string | null;
    codeLanguage: string | null;
    sqlSnapshot?: string | null;
    sqlQuestionDescription?: string | null;
    sqlRoundCompleted?: boolean;
    rubricLite?: any | null;
    canvasSnapshot?: any | null;
    notepadSnapshot?: string | null;
    prefetchedCSQuestions?: Map<string, Array<{ questionId: string; questionText: string; referenceAnswer: string }>>;
    prefetchedSDQuestion?: { id: string; title: string; problemStatement: string; rubricLite?: any } | null;
    prefetchedDSAQuestion?: {
        id: string;
        title: string;
        problemMd?: string;
        difficulty?: string;
        examples?: Array<{ input?: unknown; output?: unknown; explanation?: unknown }>;
    } | null;
    askedQuestionIds?: Set<string>; // Track which questions have been asked
    /** Explicit phase tracking: DBMS → SQL → OS → CN → OOPS */
    currentFundamentalsPhase?: string;
    resumeProbeState?: ResumeProbeState;
    resumeAgendaState?: ResumeAgendaState;
    // Gen AI Role prefetched data
    prefetchedGenAIConceptQuestions?: Array<{
        questionId: string;
        subtopic: string;
        questionText: string;
        /** Concise reference answer — LLM evaluation only, never revealed */
        referenceAnswer: string;
        // detailedAnswer intentionally absent — post-session reports only
        difficulty: string;
    }>;
    prefetchedGenAICodingQuestion?: {
        questionId: string;
        title: string;
        taskType: string;
        problemStatement: string;
        starterCode?: string;
        sampleTestCases: Array<{ id: string; description: string; input: string; expectedOutput: string }>;
        conciseSolution?: string;
        evaluationCriteria: string;
        mutationQuestions: string[];
        hints: string[];
        // detailedSolution intentionally absent — post-session reports only
        difficulty: string;
    } | null;
    prefetchedGenAISystemDesignQuestion?: {
        questionId: string;
        category: string;
        title: string;
        problemStatement: string;
        difficulty: string;
        rubricLite: {
            requiredComponents: string[];
            keyTradeoffs: string[];
            antiPatterns: string[];
            probeQuestions: string[];
        };
        // rubricFull intentionally absent here — post-session reports only
    } | null;
    // Data Science Role prefetched data
    prefetchedDSConceptQuestions?: Array<{
        questionId: string;
        topic: string;
        category: string;
        difficulty: string;
        question: string;
        referenceAnswer: string;
        followUpChain?: string[];
        redFlags?: string[];
    }>;
    prefetchedDSSQLQuestion?: {
        questionId: string;
        title: string;
        description: string;
        schema: string;
        examples: { input: any; output: any; explanation?: string }[];
        testCases: { id: number | string; label: string; input: any; expected_output: any }[];
        hiddenTestCases: { id: string; label: string; expected_output: any; wrapper_code: string }[];
        solution: string;
        judge0LanguageId: number;
        wrapperCode: string;
    } | null;
    prefetchedDSCodingQuestion?: {
        questionId: string;
        title: string;
        difficulty: string;
        category: string;
        description: string;
        datasetUrl: string;
        starterCode: string;
        solution: string;
        conciseSolution?: string;
        sampleTestCases: Array<{ id: string; description: string; input: string; output: string }>;
        hints: string[];
        probingQuestions: string[];
        interviewNotes?: string;
        metadata: any;
    } | null;
    // Product Manager Role prefetched data
    prefetchedPMCaseQuestion?: {
        questionId: string;
        title: string;
        scenario: string;
        constraintInjection: string;
        evaluationGuide: string;
        redFlags: string[];
        successSignals: string[];
        difficulty: string;
    } | null;
    prefetchedPMConceptQuestions?: Array<{
        questionId: string;
        subtopic: string;
        question: string;
        scenarioContext?: string;
        evaluationGuide: string;
        redFlags: string[];
        successSignals: string[];
        difficulty: string;
    }>;
    prefetchedPMStrategyQuestion?: {
        questionId: string;
        title: string;
        scenario: string;
        devilsAdvocateProbes: string[];
        evaluationGuide: string;
        redFlags: string[];
        successSignals: string[];
        difficulty: string;
    } | null;
    prefetchedProblemSolvingCaseQuestion?: {
        questionId: string;
        title: string;
        caseType: string;
        difficulty: string;
        prompt: string;
        candidateInstructions: string;
        assumptions: string[];
        decompositionPrompts: string[];
        hintLadder: string[];
        followUps: string[];
        twist: { prompt: string; expectedAdaptation: string };
        convictionProbes: string[];
        referenceSolution: string;
        evaluationGuide: string;
        redFlags: string[];
        successSignals: string[];
    } | null;
}

export function buildInterviewConfigurationBlock(input: {
    label: string;
    role: string;
    level: string;
    stage: InterviewStage;
    stages: InterviewStage[];
}): string {
    return `## Interview Configuration
- **Interview Type**: ${input.label}
- **Role**: ${input.role}
- **Level**: ${input.level}
- **Current Stage**: ${input.stage}
- **Stage Flow**: ${input.stages.join(" → ")}`;
}

function buildResumeContext(summary: any, context?: Pick<PromptBuilderContext, "interviewType" | "stage">): string {
    const parts: string[] = ["## Candidate's Resume Summary"];
    const isResumeRound = context?.interviewType === "resume_round";
    const stage = context?.stage;
    const includeSkills = !isResumeRound || stage === "RESUME_SKILLS" || stage === "RESUME_PROJECTS";
    const includeProjects = !isResumeRound || stage === "RESUME_PROJECTS";
    const includeExperience = !isResumeRound || stage === "RESUME_EXPERIENCE";
    const includeLeadership =
        !isResumeRound ||
        stage === "RESUME_RESPONSIBILITY" ||
        stage === "RESUME_EXPERIENCE";
    const includeRedFlags = !isResumeRound || stage === "RESUME_PROJECTS" || stage === "RESUME_EXPERIENCE";
    parts.push("**CRITICAL: This resume is for YOUR reference only — use it to ask informed questions. NEVER use it to generate the candidate's answer. If the candidate says 'Hello' or gives a non-answer, do NOT use this resume to fabricate their introduction or response. The candidate speaks for themselves. Only reference details listed below; never invent projects, companies, technologies, or experiences.**");

    if (summary.name) parts.push(`- **Name**: ${summary.name}`);
    if (summary.currentRole) parts.push(`- **Current Role**: ${summary.currentRole}`);
    if (summary.currentCompany) parts.push(`- **Company**: ${summary.currentCompany}`);
    if (summary.totalYearsExperience != null) {
        parts.push(`- **Experience**: ${summary.totalYearsExperience} years`);
    }

    if (includeSkills && summary.skills?.length) {
        parts.push("\n### Skills");
        for (const group of summary.skills) {
            parts.push(`- **${group.category}**: ${group.skills.join(", ")}`);
        }
    }

    const visibleProjects = getRoleFilteredResumeProjects(summary.projects, context);
    if (includeProjects && visibleProjects?.length) {
        parts.push("\n### Projects");
        if (context?.interviewType === "data_science_role" && context.stage === "INTRO") {
            parts.push("_Role filter active: showing only Data Science/ML/RAG/data-relevant projects for the intro deep dive._");
        } else if (context?.interviewType === "gen_ai_role" && context.stage === "INTRO") {
            parts.push("_Role filter active: showing only GenAI/LLM/RAG/agentic projects for the intro deep dive._");
        }
        for (const proj of visibleProjects) {
            const techStack = Array.isArray(proj.techStack || proj.technologies || proj.skills)
                ? (proj.techStack || proj.technologies || proj.skills).join(", ")
                : "";
            parts.push(`- **${proj.name || proj.title || "Project"}**: ${proj.description || proj.summary || ""}${techStack ? ` [${techStack}]` : ""}`);
        }
    } else if (includeProjects && context?.interviewType === "data_science_role" && context.stage === "INTRO") {
        parts.push("\n### Projects");
        parts.push("_Role filter active: no clear Data Science/ML/RAG/data project was detected. Do not open with a generic full-stack project._");
    } else if (includeProjects && context?.interviewType === "gen_ai_role" && context.stage === "INTRO") {
        parts.push("\n### Projects");
        parts.push("_Role filter active: no clear GenAI/LLM/RAG/agentic project was detected. Do not open with a generic non-GenAI project._");
    }

    if (includeExperience && summary.experience?.length) {
        parts.push("\n### Experience");
        for (const exp of summary.experience) {
            parts.push(`- **${exp.role}** at ${exp.company} (${exp.duration})`);
        }
    }

    const leadershipEntries = [
        ...(Array.isArray(summary.positionsOfResponsibility) ? summary.positionsOfResponsibility : []),
        ...(Array.isArray(summary.leadership) ? summary.leadership : []),
        ...(Array.isArray(summary.responsibilities) ? summary.responsibilities : []),
        ...(Array.isArray(summary.achievements) ? summary.achievements : []),
    ];
    if (includeLeadership && leadershipEntries.length) {
        parts.push("\n### Leadership and Responsibility");
        for (const item of leadershipEntries) {
            if (typeof item === "string") {
                parts.push(`- ${item}`);
            } else {
                const title = item.title || item.role || item.position || item.name || "Responsibility";
                const org = item.organization || item.company || item.context || "";
                const detail = item.description || item.summary || item.details || "";
                parts.push(`- **${title}**${org ? ` at ${org}` : ""}${detail ? `: ${detail}` : ""}`);
            }
        }
    }

    if (isResumeRound && stage === "RESUME_RESPONSIBILITY" && !leadershipEntries.length) {
        parts.push("\n### Leadership and Responsibility");
        parts.push("- No explicit leadership/responsibility entries were extracted. Ask one brief confirmation question, then move forward if declined.");
    }

    if (includeRedFlags && summary.redFlags?.length) {
        parts.push(`\n### Areas to Probe\n${summary.redFlags.map((f: string) => `- ${f}`).join("\n")}`);
    }

    return parts.join("\n");
}

function buildNoResumeContext(): string {
    return `## No Resume Provided
The candidate did not attach a resume to this session. Do NOT assume or invent details about their background.
Rely on what they say and ask open-ended questions to learn their experience.`;
}

function shouldIncludeResumeContext(context: PromptBuilderContext): boolean {
    const resumeRoundStages = new Set<InterviewStage>([
        "RESUME_STUDIES",
        "RESUME_PROJECTS",
        "RESUME_EXPERIENCE",
        "RESUME_RESPONSIBILITY",
        "RESUME_SKILLS",
    ]);
    if (context.interviewType === "resume_round") return resumeRoundStages.has(context.stage);
    if (context.stage !== "INTRO") return false;
    return new Set<InterviewType>([
        "full_interview",
        "system_design",
        "gen_ai_role",
        "data_science_role",
        "pm_role",
    ]).has(context.interviewType);
}

function truncateText(value: string, maxChars: number): string {
    const trimmed = value.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, maxChars)}... [truncated ${trimmed.length - maxChars} chars]`;
}

function boundedCodeExcerpt(value: string, maxChars = 5000): string {
    const normalized = value.replace(/\r\n/g, "\n");
    if (normalized.length <= maxChars) return normalized;
    const tail = normalized.slice(-maxChars);
    const firstNewline = tail.indexOf("\n");
    const excerpt = firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail;
    return `// Earlier code omitted from live prompt. Showing latest ${excerpt.length} chars.\n${excerpt}`;
}

function projectText(project: any): string {
    const techStack = Array.isArray(project?.techStack || project?.technologies || project?.skills)
        ? (project.techStack || project.technologies || project.skills).join(" ")
        : "";
    return [
        project?.name,
        project?.title,
        project?.description,
        project?.summary,
        project?.details,
        techStack,
    ]
        .filter(Boolean)
        .join(" ")
        .normalize("NFKC")
        .toLowerCase();
}

function dataScienceProjectScore(project: any): number {
    const text = projectText(project);
    let score = 0;
    if (/\b(copy[- ]?move|forgery|deepfake|computer vision|image|video|resnet|vit|cnn|transformer|classification|detection|segmentation)\b/i.test(text)) score += 8;
    if (/\b(autoencoder|anomaly|forecast|recommendation|clustering|regression|time series|predictive|machine learning|deep learning|model training|tensorflow|keras|pytorch|scikit|sklearn)\b/i.test(text)) score += 7;
    if (/\b(rag|retrieval|embedding|vector|semantic search|chunking|document processing|nlp|llm evaluation)\b/i.test(text)) score += 5;
    if (/\b(data pipeline|etl|analytics|metrics|experiment|a\/b|ab test|dashboard|pandas|numpy|sql|dataset|features?|labels?|validation|accuracy|f1|auc|precision|recall)\b/i.test(text)) score += 4;
    if (/\b(next\.?js|react|fastify|websocket|socket\.io|monaco|frontend|backend|full[- ]?stack|auth|payment|ui)\b/i.test(text) && score === 0) score -= 4;
    return score;
}

function genAIProjectScore(project: any): number {
    const text = projectText(project);
    let score = 0;
    if (/\b(genai|generative ai|llm|large language model|rag|retrieval|embedding|vector|semantic search|prompt|prompting|agentic|agent|tool call|hallucination|fine[- ]?tuning|gemini|openai|gpt|claude|llama|grok|xai)\b/i.test(text)) score += 8;
    if (/\b(ai tutor|ai interview|mock interview|voice interview|stt|tts|speech[- ]?to[- ]?text|text[- ]?to[- ]?speech|deepgram|transcription|report generation|document analysis|contract analysis)\b/i.test(text)) score += 5;
    if (/\b(copy[- ]?move|forgery|deepfake|autoencoder|smart farm|tensorflow|keras|pytorch|resnet|vit|cnn)\b/i.test(text) && score === 0) score -= 3;
    return score;
}

function getRoleFilteredResumeProjects(
    projects: any[] | undefined,
    context?: Pick<PromptBuilderContext, "interviewType" | "stage">
): any[] | undefined {
    if (!Array.isArray(projects) || context?.stage !== "INTRO") return projects;

    if (context.interviewType === "data_science_role") {
        const scored = projects
            .map((project, index) => ({ project, index, score: dataScienceProjectScore(project) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.index - b.index);
        return scored.length ? scored.map((entry) => entry.project) : [];
    }

    if (context.interviewType === "gen_ai_role") {
        const scored = projects
            .map((project, index) => ({ project, index, score: genAIProjectScore(project) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.index - b.index);
        return scored.length ? scored.map((entry) => entry.project) : [];
    }

    return projects;
}

function buildResumeProbeLadderContext(context: PromptBuilderContext): string | null {
    const resumeHeavyTypes = new Set(["full_interview", "gen_ai_role", "data_science_role"]);
    const isResumeRoundProjects = false;
    const isResumeHeavyIntro = context.stage === "INTRO" && resumeHeavyTypes.has(context.interviewType);
    if (!isResumeHeavyIntro && !isResumeRoundProjects) return null;

    const state = context.resumeProbeState || {
        currentDepth: "overview",
        consecutiveWeakAnswers: 0,
        completedDepths: [],
    };

    const filteredProjects = getRoleFilteredResumeProjects(context.resumeSummary?.projects, context);
    const projects = Array.isArray(filteredProjects)
        ? filteredProjects
            .map((project: any) => project?.name)
            .filter((name: any): name is string => typeof name === "string" && name.trim().length > 0)
        : [];

    const lines: string[] = ["## Resume Project Probe Ladder"];
    lines.push("Use this ladder for project/resume follow-ups. Ask exactly ONE question at a time.");
    lines.push("Before asking the next resume/project question after a candidate answer, silently call record_resume_probe with the depth you just evaluated.");
    lines.push("Only increase depth after a strong answer. If the answer is partial, stay at the same depth and ask one clarifying question. If it is weak, do not increase difficulty; ask an easier same-depth question or move to another listed project.");
    lines.push("Never invent resume details. Web search may give public context for technologies, companies, or public projects, but it must not be treated as proof that the candidate personally built anything beyond the resume and their own answers.");
    lines.push("");
    lines.push(`Current allowed depth: ${state.currentDepth}`);
    lines.push(`Active project: ${state.activeProjectName || "choose the most relevant listed project"}`);
    lines.push(`Last answer quality: ${state.lastAnswerQuality || "none yet"}`);
    lines.push(`Last asked project/depth: ${state.lastAskedProjectName || "none"} / ${state.lastAskedDepth || "none"}`);
    lines.push(`Consecutive weak answers: ${state.consecutiveWeakAnswers}`);
    lines.push(`Completed depths: ${state.completedDepths.length ? state.completedDepths.join(", ") : "none"}`);
    lines.push(`Already asked project-depth pairs: ${state.askedProbeKeys?.length ? state.askedProbeKeys.join(", ") : "none"}`);
    lines.push(`Saturated projects: ${state.saturatedProjects?.length ? state.saturatedProjects.join(", ") : "none"}`);
    if (projects.length > 0) {
        const label = context.interviewType === "data_science_role"
            ? "Allowed Data Science/ML projects"
            : context.interviewType === "gen_ai_role"
                ? "Allowed GenAI projects"
                : "Listed projects";
        lines.push(`${label}: ${projects.join(", ")}`);
        if (isResumeRoundProjects) {
            const maxDeep: number = projects.length >= 3 ? 2 : projects.length;
            const maxRapid: number = projects.length >= 6 ? 3 : projects.length >= 3 ? 2 : 0;
            lines.push(`Standalone resume screening project cap: deep-dive at most ${maxDeep} project${maxDeep === 1 ? "" : "s"} by default; rapid-scan at most ${maxRapid} remaining project${maxRapid === 1 ? "" : "s"}. Do not attempt to deeply cover every project.`);
        }
    } else if (context.interviewType === "data_science_role") {
        lines.push("Allowed Data Science/ML projects: none detected. Do not start from a generic full-stack project. Ask a data-focused scenario or ask how a listed product would be instrumented only if needed.");
    } else if (context.interviewType === "gen_ai_role") {
        lines.push("Allowed GenAI projects: none detected. Do not start from a generic non-GenAI project. Use the GenAI scenario fallback from the stage instructions.");
    }
    lines.push("");
    lines.push("Depth meanings:");
    lines.push("- overview: what the project is, what problem it solves, who uses it.");
    lines.push("- motivation: why this project was built, constraints, goals, and success criteria.");
    lines.push("- ownership: what the candidate personally implemented, decisions they owned, team boundaries.");
    lines.push("- implementation: architecture, data flow, APIs, database/schema, model/pipeline, important modules.");
    lines.push("- tradeoffs: alternatives considered, why this stack/design, cost/latency/complexity choices.");
    lines.push("- failure_depth: bugs, bottlenecks, incidents, evaluation gaps, scaling or reliability issues.");
    lines.push("- senior_depth: redesign at larger scale, security, observability, maintainability, migration strategy.");
    lines.push("");
    lines.push("Hard repetition rule: do not ask another question whose project-depth pair is already listed above. If an overview/users/problem question was already asked for a project, never ask that overview again; either go one allowed step deeper, ask one clarifier at the same depth that covers a NEW detail, or pivot away.");
    lines.push("Saturation rule: if a project is saturated, do not return to it later in the INTRO. Move on or transition.");

    return lines.join("\n");
}

function buildPMResumeProbeContext(context: PromptBuilderContext): string | null {
    if (context.interviewType !== "pm_role" || context.stage !== "INTRO") return null;

    const state = context.resumeProbeState || {
        currentDepth: "overview",
        consecutiveWeakAnswers: 0,
        completedDepths: [],
    };
    const projects = Array.isArray(context.resumeSummary?.projects)
        ? context.resumeSummary.projects
            .map((project: any) => project?.name || project?.title)
            .filter((name: any): name is string => typeof name === "string" && name.trim().length > 0)
        : [];

    const lines: string[] = ["## PM Resume/Product Ownership Probe Guide"];
    lines.push("This is a product-management resume deep dive, not an engineering implementation interview.");
    lines.push("Use the candidate's resume only to choose product/product-like work to examine. Ask exactly ONE question at a time.");
    lines.push("Before asking the next product-resume question after a candidate answer, silently call record_resume_probe with the closest depth mapping below.");
    lines.push("Use strong answerQuality for concrete PM evidence: owned decision scope, user/customer problem, prioritization reasoning, metrics, launch/adoption outcome, stakeholder conflict, or clear retrospective learning.");
    lines.push("Do not downgrade good PM answers merely because they lack APIs, databases, architecture, code, or implementation details.");
    lines.push("");
    lines.push(`Current allowed depth: ${state.currentDepth}`);
    lines.push(`Active product/project: ${state.activeProjectName || "choose the most PM-relevant listed product/project"}`);
    lines.push(`Last answer quality: ${state.lastAnswerQuality || "none yet"}`);
    lines.push(`Last asked product/depth: ${state.lastAskedProjectName || "none"} / ${state.lastAskedDepth || "none"}`);
    lines.push(`Consecutive weak answers: ${state.consecutiveWeakAnswers}`);
    lines.push(`Completed depths: ${state.completedDepths.length ? state.completedDepths.join(", ") : "none"}`);
    lines.push(`Already asked product-depth pairs: ${state.askedProbeKeys?.length ? state.askedProbeKeys.join(", ") : "none"}`);
    lines.push(`Saturated products: ${state.saturatedProjects?.length ? state.saturatedProjects.join(", ") : "none"}`);
    if (projects.length > 0) {
        lines.push(`Listed products/projects: ${projects.join(", ")}`);
    }
    lines.push("");
    lines.push("PM depth mapping for record_resume_probe:");
    lines.push("- overview: what the product/project is, who uses it, and what user/customer problem it solves.");
    lines.push("- motivation: why this product/feature mattered, target user pain, goals, constraints, and success criteria.");
    lines.push("- ownership: candidate's personal decision authority, product scope, roadmap/prioritization ownership, stakeholder boundaries.");
    lines.push("- implementation: product execution process, discovery, launch plan, experiment design, rollout, instrumentation, or cross-functional execution. Do not turn this into code/architecture trivia.");
    lines.push("- tradeoffs: roadmap cuts, prioritization trade-offs, metric trade-offs, business/user/engineering compromise, what they said no to and why.");
    lines.push("- failure_depth: missed metric, failed launch, stakeholder conflict, adoption issue, bad assumption, churn/conversion/retention miss, or lesson learned.");
    lines.push("- senior_depth: what they would change at larger scale, market/strategy risk, platform/product operating model, long-term metric design, or org/stakeholder alignment.");
    lines.push("");
    lines.push("Hard repetition rule: do not ask another question whose product-depth pair is already listed in 'Already asked product-depth pairs'. If an overview/users/problem or motivation/goals question was already asked for a product, NEVER ask that same rung again — either go one allowed step deeper, ask ONE clarifier at the same depth that covers a genuinely NEW detail, or pivot to another product. Move forward through the depths only; do not walk back down to a rung you already covered for this product.");
    lines.push("Saturation rule: if a product is saturated (listed under 'Saturated products'), do not return to it later in the INTRO. Move on to another product or transition.");
    lines.push("Product focus rule: deep-dive at most 2 products/projects. If two follow-ups still show weak ownership, mark that product saturated and pivot or transition.");
    lines.push("Best next question shape: make it specific to the product, then ask for decision, metric, trade-off, conflict, or retrospective evidence.");

    return lines.join("\n");
}

function buildCurrentQuestionContext(context: PromptBuilderContext): string | null {
    const isSDIntroLeak = context.interviewType === "system_design" && context.stage === "INTRO";
    if (!context.currentQuestionTitle || isSDIntroLeak) {
        return null;
    }

    return `## Current Question
The candidate is currently working on: "${context.currentQuestionTitle}"`;
}

function buildSystemDesignQuestionContext(context: PromptBuilderContext): string | null {
    if (!context.prefetchedSDQuestion || context.stage !== "SYSTEM_DESIGN") {
        return null;
    }

    const sd = context.prefetchedSDQuestion;
    return `## YOUR DESIGN PROBLEM - USE THIS EXACT PROBLEM
You have ONE pre-assigned design problem for this session.
The server already introduced this problem and opened the whiteboard.
Do NOT re-introduce it. Do NOT invent or substitute a different problem.

**Problem Title:** ${sd.title}
**Problem Statement:** ${sd.problemStatement}
**Question ID:** \`${sd.id}\``;
}

function buildRubricContext(context: PromptBuilderContext): string | null {
    if (!context.rubricLite || context.stage !== "SYSTEM_DESIGN") {
        return null;
    }

    const rubric = context.rubricLite;
    const rubricLines: string[] = ["## System Design Rubric (use this to guide probing)"];

    if (rubric.requiredComponents?.length) {
        rubricLines.push(`**Required Components**: ${rubric.requiredComponents.join(", ")}`);
    }
    if (rubric.keyTradeoffs?.length) {
        rubricLines.push(`**Key Trade-offs to Probe**: ${rubric.keyTradeoffs.join(", ")}`);
    }
    if (rubric.antiPatterns?.length) {
        rubricLines.push(`**Anti-patterns (red flags)**: ${rubric.antiPatterns.join(", ")}`);
    }
    if (rubric.followUpTriggers?.length) {
        rubricLines.push("**Conditional Follow-ups**:");
        for (const trigger of rubric.followUpTriggers) {
            rubricLines.push(`- ${trigger.condition}: \"${trigger.question}\"`);
        }
    }

    return rubricLines.join("\n");
}

function buildCSQuestionBankContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "FUNDAMENTALS" || !context.prefetchedCSQuestions || context.prefetchedCSQuestions.size === 0) {
        return null;
    }

    const askedIds = context.askedQuestionIds || new Set<string>();

    const fundamentalsOptions = context.moduleConfig?.stageOptions?.FUNDAMENTALS || {};
    const requestedTopics = Array.isArray(fundamentalsOptions.topics)
        ? fundamentalsOptions.topics.filter((topic: unknown): topic is string => typeof topic === "string")
        : ["DBMS", "OS", "CN", "OOPS"];
    const availableTheoryPhases = requestedTopics
        .filter((topic) => context.prefetchedCSQuestions?.has(topic));
    const includeSQL = fundamentalsOptions.includeSQL !== false;

    // Full internal order including optional SQL after the first selected theory topic.
    const FULL_PHASE_ORDER = [
        ...availableTheoryPhases.slice(0, 1),
        ...(includeSQL ? ["SQL"] : []),
        ...availableTheoryPhases.slice(1),
    ];
    // Theory-only topics (have question bank entries)
    const THEORY_PHASES = availableTheoryPhases;

    // Use explicit topic tracking from session state, defaulting to the first
    // selected topic. This matters for modular sessions like OOPS-only.
    const configuredCurrentPhase = context.currentFundamentalsPhase;
    const currentPhase = configuredCurrentPhase === "CLOSING"
        ? "CLOSING"
        : configuredCurrentPhase && FULL_PHASE_ORDER.includes(configuredCurrentPhase)
        ? configuredCurrentPhase
        : FULL_PHASE_ORDER[0] || availableTheoryPhases[0] || "CLOSING";
    const currentPhaseIdx = FULL_PHASE_ORDER.indexOf(currentPhase as any);

    const lines: string[] = ["## QUESTION BANK — CS Fundamentals"];
    lines.push(`MANDATORY INTERNAL ORDER: ${FULL_PHASE_ORDER.join(" -> ")}. DO NOT SKIP OR REORDER.`);
    lines.push(`Active CS topics for this session: ${availableTheoryPhases.join(", ")}.${includeSQL ? " SQL round is enabled." : " SQL round is disabled."}`);
    lines.push(`MANDATORY ORDER: ${FULL_PHASE_ORDER.join(" -> ")}. You MUST follow this exact order.`);
    lines.push(`Before each theory question, call record_question using the exact ID.`);
    lines.push("");

    lines.push("Candidate-facing speech must not mention phase names, stage names, QUESTION BANK, configuration, selected topics, or internal ordering.");
    lines.push("");

    // --- Current item is SQL ---
    if (currentPhase === "SQL") {
        lines.push("**CURRENT ITEM: SQL (mandatory)**");
        lines.push("Do not call fetch_question for SQL. Call open_sql_editor once; the server displays the prefetched DB SQL question before discussion.");
        lines.push("Candidate-facing speech: say only that a SQL problem is open and ask them to walk through their approach after reading it.");
        lines.push("Do NOT say phrases like 'since we are in CS Fundamentals', 'phase', 'configured', 'selected', 'QUESTION BANK', or 'SQL round'.");
        lines.push("");
        lines.push(`**NEXT INTERNAL ITEM: ${FULL_PHASE_ORDER[currentPhaseIdx + 1] || "CLOSING"} (after SQL is complete)**`);
        return lines.join("\n");
    }

    // --- Current item is a theory topic ---
    if (THEORY_PHASES.includes(currentPhase as any)) {
        const questions = context.prefetchedCSQuestions.get(currentPhase) || [];
        const allCurrentPhaseAsked = questions.length > 0 && questions.every(q => askedIds.has(q.questionId));

        // Find next internal item label
        const nextPhaseIdx = currentPhaseIdx + 1;
        const nextPhase = nextPhaseIdx < FULL_PHASE_ORDER.length ? FULL_PHASE_ORDER[nextPhaseIdx] : null;

        lines.push(`**CURRENT TOPIC: ${currentPhase}** - YOU MUST STAY ON THIS TOPIC`);
        if (nextPhase) {
            lines.push(`**NEXT INTERNAL ITEM: ${nextPhase} (only after ${currentPhase} is complete)**`);
        }
        lines.push("");

        if (allCurrentPhaseAsked) {
            lines.push(`**All ${currentPhase} main questions have been asked.**`);
            lines.push("Do NOT ask another main theory question from memory or from a different topic.");
            lines.push("If a final follow-up is still needed, ask at most one concise follow-up tied to the last answer.");
            lines.push("Then move to the next configured activity silently via tools where applicable, using natural candidate-facing wording only.");
            lines.push("If you are still probing the candidate's last answer, CONTINUE probing.");
            lines.push("If moving on, use at most one short natural bridge. Do not say 'next fundamentals topic'.");
        }
        lines.push("");

        // Show only the next unasked question. This keeps prompts smaller and prevents the model from reusing already-asked bank questions.
        if (questions.length > 0) {
            const nextQuestion = questions.find((q) => !askedIds.has(q.questionId));
            const askedCount = questions.filter((q) => askedIds.has(q.questionId)).length;
            lines.push(`### ${currentPhase} progress`);
            lines.push(`Main questions completed: ${askedCount}/${questions.length}.`);
            if (nextQuestion) {
                lines.push("### NEXT MAIN QUESTION TO ASK");
                lines.push(`  - ID: ${nextQuestion.questionId}`);
                lines.push(`  - Text: ${nextQuestion.questionText}`);
                const answer = nextQuestion.referenceAnswer.length > 120
                    ? `${nextQuestion.referenceAnswer.slice(0, 120)}...`
                    : nextQuestion.referenceAnswer;
                lines.push(`  - *(Reference Answer - evaluation only, NEVER reveal):* ${answer}`);
            } else {
                lines.push(`No unasked ${currentPhase} main questions remain.`);
            }
        }

        // OPTIMIZATION: Don't show next item questions - they're not needed until we get there
        // This significantly reduces prompt size and improves latency
        // The AI will see them when it transitions to that phase

        return lines.join("\n");
    }

    // Fallback: all items complete
    lines.push("**All main CS Fundamentals questions have been asked.**");
    lines.push("If depth probing is still in progress, CONTINUE. Do NOT prepend transition phrases.");
    lines.push("Once probing is truly complete, call transition_stage to CLOSING.");
    return lines.join("\n");
}

function buildDSAQuestionBankContext(context: PromptBuilderContext): string | null {
    if (!context.prefetchedDSAQuestion || context.stage !== "DSA") {
        return null;
    }

    const dsa = context.prefetchedDSAQuestion;
    const problemMd = truncateText(dsa.problemMd || "", 5000);
    const firstExample = Array.isArray(dsa.examples) && dsa.examples.length > 0
        ? (() => {
            const example = dsa.examples![0]!;
            const input = typeof example.input === "string" ? example.input : JSON.stringify(example.input);
            const output = typeof example.output === "string" ? example.output : JSON.stringify(example.output);
            const explanation = typeof example.explanation === "string" ? example.explanation : JSON.stringify(example.explanation);
            return [
                "Example 1:",
                input && input !== "undefined" ? `Input: ${truncateText(input, 800)}` : null,
                output && output !== "undefined" ? `Output: ${truncateText(output, 400)}` : null,
                explanation && explanation !== "undefined" ? `Explanation: ${truncateText(explanation, 900)}` : null,
            ].filter(Boolean).join("\n");
        })()
        : "";
    const codingLockInstruction = context.interviewType === "coding"
        ? `CODING INTERVIEW LOCK:\n- This session has exactly one coding problem.\n- Do not fetch or rotate to another problem.`
        : "";

    return `## QUESTION BANK - DSA Problem
MANDATORY: Problem is pre-loaded. Do NOT call fetch_question.
Use the exact problem statement below as ground truth. Do NOT infer semantics from the title. If your understanding conflicts with the statement/examples, the statement/examples win.
Call open_ide immediately with:

**Question ID:** ${dsa.id}
**Title:** ${dsa.title}
${problemMd ? `\n### Exact problem statement\n${problemMd}` : ""}
${firstExample ? `\n### First example\n${firstExample}` : ""}
${codingLockInstruction}`;
}

function buildCodeContext(context: PromptBuilderContext): string | null {
    if (!context.codeSnapshot || context.stage !== "DSA") {
        return null;
    }

    const code = boundedCodeExcerpt(context.codeSnapshot);
    return `## Candidate's Current Code (${context.codeLanguage || "unknown"})
\`\`\`${context.codeLanguage || ""}
${code}
\`\`\`

Reference the visible code naturally. If an earlier helper may be omitted, ask a targeted clarification instead of assuming it.`;
}

function buildSQLProblemContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "FUNDAMENTALS" || !context.sqlQuestionDescription) {
        return null;
    }

    return `## Active SQL Problem
This is the exact problem the candidate is solving now:
${context.sqlQuestionDescription}`;
}

function buildSQLQueryContext(context: PromptBuilderContext): string | null {
    if (!context.sqlSnapshot || context.stage !== "FUNDAMENTALS") {
        return null;
    }

    const query = truncateText(context.sqlSnapshot, 2500);
    return `## Candidate's Current SQL Query
\`\`\`sql
${query}
\`\`\``;
}

function buildSQLCompletedContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "FUNDAMENTALS" || !context.sqlRoundCompleted) {
        return null;
    }

return `## SQL Round Already Completed
SQL round was already completed or intentionally skipped.
Do NOT return to SQL. Continue with the next configured item.`;
}

function buildCanvasContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "SYSTEM_DESIGN") {
        return null;
    }
    if (!context.canvasSnapshot || !hasMeaningfulDiagram(context.canvasSnapshot)) {
        return [
            "## Whiteboard Context",
            "No visible candidate-written diagram, labels, notes, or requirements have been supplied yet.",
            "Do NOT claim to see anything on the whiteboard/scratchpad.",
            "If the candidate asks what is written, say that you do not see any written content yet.",
        ].join("\n");
    }

    return buildSystemDiagramContext(context.canvasSnapshot);
}

// ── GenAI Role Context Builders ─────────────────────────────

function buildGenAIConceptBankContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "GEN_AI_CONCEPTS") return null;
    const questions = context.prefetchedGenAIConceptQuestions;
    if (!questions || questions.length === 0) return null;

    const lines: string[] = ["## QUESTION BANK — GenAI Concepts"];
    lines.push("⚠️ Select 3–4 questions most relevant to this candidate. Do NOT ask all 7.");
    lines.push("⚠️ ONLY ask questions listed here. Do NOT invent GenAI concept questions.");
    lines.push("⚠️ Reference answers are for your silent evaluation ONLY. NEVER reveal them.");
    lines.push("⚠️ Call record_question silently before presenting each question.");
    lines.push("");

    const bySubtopic = new Map<string, typeof questions>();
    for (const q of questions) {
        if (!bySubtopic.has(q.subtopic)) bySubtopic.set(q.subtopic, []);
        bySubtopic.get(q.subtopic)!.push(q);
    }

    for (const [subtopic, qs] of bySubtopic) {
        lines.push(`### ${subtopic}`);
        for (const q of qs) {
            lines.push(`**ID:** ${q.questionId}`);
            lines.push(`**Q:** ${q.questionText}`);
            const answer = q.referenceAnswer.length > 150
                ? `${q.referenceAnswer.slice(0, 150)}...`
                : q.referenceAnswer;
            lines.push(`**Ref Answer (evaluation only):** ${answer}`);
            lines.push("");
        }
    }

    return lines.join("\n");
}

function buildGenAICodingTaskContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "GEN_AI_CODING") return null;
    const task = context.prefetchedGenAICodingQuestion;
    if (!task) return null;

    const lines: string[] = ["## ⚠️ YOUR CODING TASK"];
    lines.push(`**ID (pass this to open_ide as questionId):** ${task.questionId}`);
    lines.push(`**Title:** ${task.title}`);
    lines.push(`**Task Type:** ${task.taskType}`);
    lines.push(`**Difficulty:** ${task.difficulty}`);
    lines.push("");
    lines.push("### Evaluation Criteria (LLM-only, NEVER reveal)");
    lines.push(task.evaluationCriteria);
    lines.push("");
    if (task.hints.length > 0) {
        lines.push("### Hints (give PROGRESSIVELY when candidate is stuck — start with hint 1, then 2, etc.)");
        lines.push("Call give_hint tool. NEVER give all hints at once.");
        task.hints.forEach((h, i) => lines.push(`Hint ${i + 1}: ${h}`));
        lines.push("");
    }
    if (task.mutationQuestions.length > 0) {
        lines.push("### Mutation Questions (ask 1–2 AFTER candidate runs tests successfully)");
        task.mutationQuestions.forEach((mq, i) => lines.push(`${i + 1}. ${mq}`));
    }
    lines.push("");
    const compactReference = task.conciseSolution || task.evaluationCriteria;
    lines.push("### Compact Reference Answer (LLM-only, NEVER reveal or hint directly)");
    lines.push(compactReference);
    return lines.join("\n");
}

// ── Data Science Role Context Builders ─────────────────────────

function buildDSConceptBankContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "DS_CONCEPTS") return null;
    const questions = context.prefetchedDSConceptQuestions;
    if (!questions || questions.length === 0) return null;

    const lines: string[] = ["## [DS CONCEPT BANK] — Statistics & ML Reasoning Questions"];
    lines.push("⚠️ Ask ONLY the questions listed here. Do NOT invent DS questions from memory.");
    lines.push("⚠️ Reference answers are for your SILENT evaluation ONLY. NEVER reveal them.");
    lines.push("⚠️ Ask 4–5 questions from this bank — skip any that have been naturally covered.");
    lines.push("⚠️ Before asking each question, call record_question with its exact questionFundamentalId.");
    lines.push("");

    const byTopic = new Map<string, typeof questions>();
    for (const q of questions) {
        const key = q.topic || q.category || "General";
        if (!byTopic.has(key)) byTopic.set(key, []);
        byTopic.get(key)!.push(q);
    }

    for (const [topic, qs] of byTopic) {
        lines.push(`### ${topic}`);
        for (const q of qs) {
            lines.push(`**Question ID:** \`${q.questionId}\``);
            lines.push(`**Q (${q.difficulty}):** ${q.question}`);
            lines.push(`**Ref Answer (evaluation only):** ${q.referenceAnswer.slice(0, 200)}${q.referenceAnswer.length > 200 ? '...' : ''}`);
            if (q.redFlags && q.redFlags.length > 0) {
                lines.push(`**Red Flags:** ${q.redFlags.join(" | ")}`);
            }
            lines.push("");
        }
    }

    return lines.join("\n");
}

function buildDSSQLQuestionContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "DS_SQL") return null;
    const sql = context.prefetchedDSSQLQuestion;
    if (!sql) return null;

    const lines: string[] = ["## [DS SQL QUESTION] — SQL Problem Set"];
    lines.push(`**Title:** ${sql.title}`);
    lines.push("");
    lines.push("### Problem Description (introduce this conversationally)");
    lines.push(sql.description);
    lines.push("");

    if (sql.schema) {
        lines.push("### Schema");
        lines.push(sql.schema);
        lines.push("");
    }

    if (sql.examples && sql.examples.length > 0) {
        lines.push("### Example");
        const ex = sql.examples[0];
        lines.push(`Input: ${JSON.stringify(ex.input, null, 2)}`);
        lines.push(`Output: ${JSON.stringify(ex.output, null, 2)}`);
        if (ex.explanation) lines.push(`Explanation: ${ex.explanation}`);
        lines.push("");
    }

    lines.push("### Solution (LLM-only — NEVER reveal or hint at this)");
    lines.push(sql.solution);

    return lines.join("\n");
}

function buildDSCodingTaskContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "DS_CODING") return null;
    const task = context.prefetchedDSCodingQuestion;
    if (!task) return null;

    const lines: string[] = ["## [DS CODING TASK] — Python/Pandas Analysis Task"];
    lines.push(`**Title:** ${task.title}  |  **Difficulty:** ${task.difficulty}`);
    lines.push("");
    lines.push("### Problem Statement (present conversationally, mention variable name `result`)");
    lines.push(task.description);
    lines.push("");
    if (task.probingQuestions && task.probingQuestions.length > 0) {
        lines.push("### Probing Questions (ask opportunistically as they code)");
        task.probingQuestions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
        lines.push("");
    }
    if (task.interviewNotes) {
        lines.push("### Interview Notes (LLM-only, NEVER reveal)");
        lines.push(task.interviewNotes);
        lines.push("");
    }
    if (task.conciseSolution) {
        lines.push("### Concise Solution Grounding (LLM-only, NEVER reveal or hint)");
        lines.push(task.conciseSolution);
    }
    return lines.join("\n");
}

function buildDSCodingCodeContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "DS_CODING" || !context.codeSnapshot) return null;
    const code = boundedCodeExcerpt(context.codeSnapshot);
    return `## Candidate's Current Python Code
\`\`\`python
${code}
\`\`\`

Observe their approach — ask probing questions from the task context, do not give hints.`;
}

function buildGenAICodingCodeContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "GEN_AI_CODING" || !context.codeSnapshot) return null;
    const code = boundedCodeExcerpt(context.codeSnapshot);
    return `## Candidate's Current Code (${context.codeLanguage || "unknown"})
\`\`\`${context.codeLanguage || ""}
${code}
\`\`\`

Use this to ask targeted questions. Reference specific sections, not the full code.`;
}

function buildGenAISystemDesignContext(context: PromptBuilderContext): string | null {
    if (context.stage !== "GEN_AI_SYSTEM_DESIGN") return null;
    const task = context.prefetchedGenAISystemDesignQuestion;
    if (!task) return null;

    const r = task.rubricLite;
    const lines: string[] = ["## ⚠️ YOUR DESIGN PROBLEM — GenAI System Architecture"];
    lines.push(`**Title:** ${task.title}  |  **Category:** ${task.category}  |  **Difficulty:** ${task.difficulty}`);
    lines.push("");
    lines.push("### Problem Statement (displayed to candidate in left panel)");
    lines.push("Present this conversationally in 2–3 sentences. Do NOT read verbatim.");
    lines.push(task.problemStatement);
    lines.push("");

    if (r.requiredComponents?.length) {
        lines.push("### Required Components (evaluate silently — NEVER list these to candidate)");
        r.requiredComponents.forEach(c => lines.push(`- ${c}`));
        lines.push("");
    }

    if (r.keyTradeoffs?.length) {
        lines.push("### Key Tradeoffs to Listen For (silent evaluation)");
        r.keyTradeoffs.forEach(t => lines.push(`- ${t}`));
        lines.push("");
    }

    if (r.antiPatterns?.length) {
        lines.push("### Anti-Patterns / Red Flags (note silently)");
        r.antiPatterns.forEach(a => lines.push(`- ${a}`));
        lines.push("");
    }

    if (r.probeQuestions?.length) {
        lines.push("### Probe Questions — Phase B Deep Dive (ask ONE at a time)");
        r.probeQuestions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    }

    return lines.join("\n");
}

function buildPMCaseContext(context: PromptBuilderContext): string | null {
    if (context.interviewType !== "pm_role" || context.stage !== "PM_CASE") return null;
    const task = context.prefetchedPMCaseQuestion;
    if (!task) return null;

    const lines: string[] = ["## YOUR CASE SCENARIO - Product Case"];
    lines.push(`ID: ${task.questionId}`);
    lines.push(`Title: ${task.title}`);
    lines.push(`Difficulty: ${task.difficulty}`);
    lines.push("");
    lines.push("### Scenario (present verbatim)");
    lines.push(task.scenario);
    lines.push("");
    lines.push("### Constraint Injection (use mid-case)");
    lines.push(task.constraintInjection);
    lines.push("");
    lines.push("### Evaluation Guide (silent only, compact)");
    lines.push(truncateText(task.evaluationGuide, 700));
    if (task.redFlags?.length) {
        lines.push("");
        lines.push("### Red Flags (silent only)");
        task.redFlags.forEach((flag) => lines.push(`- ${flag}`));
    }
    if (task.successSignals?.length) {
        lines.push("");
        lines.push("### Success Signals (silent only)");
        task.successSignals.forEach((signal) => lines.push(`- ${signal}`));
    }

    return lines.join("\n");
}

function buildPMConceptBankContext(context: PromptBuilderContext): string | null {
    if (context.interviewType !== "pm_role" || context.stage !== "PM_CONCEPTS") return null;
    const questions = context.prefetchedPMConceptQuestions || [];
    if (questions.length === 0) return null;

    const lines: string[] = ["## PM CONCEPT BANK - Ask ONLY These DB Questions"];
    lines.push("Do not invent or substitute PM concept questions. Ask at least 3 and at most 4 from this bank before transitioning.");
    lines.push("");
    questions.forEach((q, idx) => {
        lines.push(`### ${idx + 1}. ${q.subtopic} | ${q.difficulty} | ID: ${q.questionId}`);
        if (q.scenarioContext) {
            lines.push(`Context: ${q.scenarioContext}`);
        }
        lines.push(`Question: ${q.question}`);
        lines.push(`Evaluation Guide (silent only): ${truncateText(q.evaluationGuide, 350)}`);
        if (q.redFlags?.length) lines.push(`Red Flags (silent only): ${q.redFlags.join("; ")}`);
        if (q.successSignals?.length) lines.push(`Success Signals (silent only): ${q.successSignals.join("; ")}`);
        lines.push("");
    });

    return lines.join("\n");
}

function buildPMStrategyContext(context: PromptBuilderContext): string | null {
    if (context.interviewType !== "pm_role" || context.stage !== "PM_STRATEGY") return null;
    const task = context.prefetchedPMStrategyQuestion;
    if (!task) return null;

    const lines: string[] = ["## YOUR STRATEGY SCENARIO - Product Strategy"];
    lines.push(`ID: ${task.questionId}`);
    lines.push(`Title: ${task.title}`);
    lines.push(`Difficulty: ${task.difficulty}`);
    lines.push("");
    lines.push("### Scenario (present from DB)");
    lines.push(task.scenario);
    lines.push("");
    if (task.devilsAdvocateProbes?.length) {
        lines.push("### Devil's Advocate Probes (ask one at a time)");
        task.devilsAdvocateProbes.forEach((probe) => lines.push(`- ${probe}`));
        lines.push("");
    }
    lines.push("### Evaluation Guide (silent only, compact)");
    lines.push(truncateText(task.evaluationGuide, 700));
    if (task.redFlags?.length) lines.push(`Red Flags (silent only): ${task.redFlags.join("; ")}`);
    if (task.successSignals?.length) lines.push(`Success Signals (silent only): ${task.successSignals.join("; ")}`);

    return lines.join("\n");
}

function buildNotepadContext(context: PromptBuilderContext): string | null {
    const supportsNotepad =
        (context.interviewType === "pm_role" && context.stage === "PM_CASE") ||
        (context.interviewType === "problem_solving_case" && context.stage === "PROBLEM_SOLVING");
    if (!supportsNotepad) {
        return null;
    }
    // Ground truth, always. When the candidate has typed nothing (or only markup/
    // whitespace), we say so explicitly instead of omitting the block — omitting it
    // left the model free to invent notepad content because the stage prompt still
    // told it to probe "what they wrote". A short "Nothing written currently." keeps
    // the model honest without nudging it to tell the candidate to skip writing.
    const emptyBlock = `## Candidate's Live Notepad Snapshot\nNothing written currently.`;
    const snapshot = (context.notepadSnapshot || "").trim();
    if (!snapshot) return emptyBlock;
    const plainText = snapshot
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (!plainText) return emptyBlock;
    const truncated = truncateText(plainText, 1800);

    return `## Candidate's Live Notepad Snapshot
This is the latest readable text from the candidate's notepad — it IS the ground truth of what they have written. Reference only what actually appears here; never guess or invent notepad content. Use it to understand their structure and probe their thinking. Do not read it aloud verbatim.

\`\`\`text
${truncated}
\`\`\``;
}

function buildProblemSolvingCaseContext(context: PromptBuilderContext): string | null {
    if (context.interviewType !== "problem_solving_case" || context.stage !== "PROBLEM_SOLVING") return null;
    const task = context.prefetchedProblemSolvingCaseQuestion;
    if (!task) return null;

    const lines: string[] = ["## Problem-Solving Case Bank - Use ONLY This Assigned Case"];
    lines.push("You have exactly one DB-prefetched case. Do not invent a different puzzle, variant, hint, twist, or follow-up.");
    lines.push("Do not reveal the evaluation guide, red flags, or success signals.");
    lines.push(`Question ID: ${task.questionId}`);
    lines.push(`Title: ${task.title}`);
    lines.push(`Case Type: ${task.caseType}`);
    lines.push(`Difficulty: ${task.difficulty}`);
    lines.push("");
    lines.push("### Candidate-Facing Case Prompt");
    lines.push(task.prompt);
    lines.push("");
    lines.push("### Candidate Instructions");
    lines.push(task.candidateInstructions);
    if (task.assumptions.length) {
        lines.push("");
        lines.push("### Assumptions To Listen For");
        task.assumptions.forEach((item) => lines.push(`- ${item}`));
    }
    if (task.decompositionPrompts.length) {
        lines.push("");
        lines.push("### Decomposition Prompts - Ask One At A Time");
        task.decompositionPrompts.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    }
    if (task.hintLadder.length) {
        lines.push("");
        lines.push("### Hint Ladder - Give Progressively Only When Stuck");
        task.hintLadder.forEach((item, index) => lines.push(`Hint ${index + 1}: ${item}`));
    }
    if (task.followUps.length) {
        lines.push("");
        lines.push("### Follow-Ups - Ask Opportunistically");
        task.followUps.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    }
    lines.push("");
    lines.push("### Required Twist/Add-On");
    lines.push(task.twist.prompt);
    lines.push(`Expected adaptation (silent): ${task.twist.expectedAdaptation}`);
    if (task.convictionProbes.length) {
        lines.push("");
        lines.push("### Conviction Probes");
        task.convictionProbes.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    }
    lines.push("");
    lines.push("### Evaluation Guide - Silent Only, Compact");
    lines.push(truncateText(task.evaluationGuide, 800));
    lines.push("");
    lines.push("### Reference Solution - Silent Only");
    lines.push(task.referenceSolution);
    if (task.redFlags.length) {
        lines.push("");
        lines.push("### Red Flags - Silent Only");
        task.redFlags.forEach((item) => lines.push(`- ${item}`));
    }
    if (task.successSignals.length) {
        lines.push("");
        lines.push("### Success Signals - Silent Only");
        task.successSignals.forEach((item) => lines.push(`- ${item}`));
    }

    return lines.join("\n");
}

export function buildStaticContextBlocks(context: PromptBuilderContext): string[] {
    const blocks: Array<string | null> = [
        shouldIncludeResumeContext(context)
            ? (context.resumeSummary ? buildResumeContext(context.resumeSummary, context) : buildNoResumeContext())
            : null,
        context.interviewType === "resume_round"
            ? buildResumeAgendaPromptBlock(context.resumeAgendaState)
            : null,
        buildPMResumeProbeContext(context),
        buildResumeProbeLadderContext(context),
        buildSystemDesignQuestionContext(context),
        buildRubricContext(context),
        buildCurrentQuestionContext(context),
        buildCSQuestionBankContext(context),
        buildDSAQuestionBankContext(context),
        buildGenAIConceptBankContext(context),
        buildGenAICodingTaskContext(context),
        buildGenAISystemDesignContext(context),
        // DS Role
        buildDSConceptBankContext(context),
        buildDSSQLQuestionContext(context),
        buildDSCodingTaskContext(context),
        // PM Role
        buildPMCaseContext(context),
        buildPMConceptBankContext(context),
        buildPMStrategyContext(context),
        buildProblemSolvingCaseContext(context),
    ];

    return blocks.filter((block): block is string => Boolean(block && block.trim()));
}

export function buildDynamicContextBlocks(context: PromptBuilderContext): string[] {
    const blocks: Array<string | null> = [
        buildCodeContext(context),
        buildSQLProblemContext(context),
        buildSQLQueryContext(context),
        buildSQLCompletedContext(context),
        buildCanvasContext(context),
        buildGenAICodingCodeContext(context),
        buildDSCodingCodeContext(context),
        buildNotepadContext(context),
    ];

    return blocks.filter((block): block is string => Boolean(block && block.trim()));
}



