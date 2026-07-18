"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api, getApiBaseUrl } from "@/lib/api";
import { fetchWithLimits, isFeatureLimitError } from "@/lib/api-with-limits";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useBilling } from "@/hooks/use-billing";
import { UpgradeModal } from "@/components/upgrade-modal";
import { ClockIcon } from "@/components/icons/clock-icon";
import {
    INTERVIEW_TYPE_MAP,
    interviewCreditCost,
    type InterviewCostKey,
    type InterviewStage,
} from "@interviewforge/shared";

type ModuleOption = {
    stage: InterviewStage;
    label: string;
    description: string;
    minutes: number;
    icon: string;
    optional?: boolean;
    hidden?: boolean;
};

type CsJourneyStep = "resume" | "focus" | "sql" | "settings";
type CsEditModal = CsJourneyStep | null;
type FullJourneyStep = "resume" | "modules" | "coding" | "cs" | "sql" | "settings";
type FullEditModal = FullJourneyStep | null;
type CodingJourneyStep = "modules" | "focus" | "settings";
type CodingEditModal = CodingJourneyStep | null;
type GenAiJourneyStep = "resume" | "modules" | "question" | "settings";
type GenAiEditModal = GenAiJourneyStep | null;
type RoleJourneyType = "data_science_role" | "pm_role";
type RoleJourneyStep = "resume" | "modules" | "question" | "settings";
type RoleEditModal = RoleJourneyStep | null;
type SimpleJourneyType = "problem_solving_case" | "resume_round";
type SimpleJourneyStep = "resume" | "modules";
type SimpleEditModal = SimpleJourneyStep | null;
type ShortJourneyType = "system_design" | "behavioural";
type ShortJourneyStep = "resume" | "modules" | "settings";
type ShortEditModal = ShortJourneyStep | null;

const MODULE_OPTIONS: Partial<Record<InterviewCostKey, ModuleOption[]>> = {
    full_interview: [
        { stage: "INTRO", label: "Resume deep-dive", description: "Projects, background, and role-fit evidence.", minutes: 7, icon: "badge", optional: true },
        { stage: "DSA", label: "Coding", description: "Live DSA problem solving in the IDE.", minutes: 30, icon: "code" },
        { stage: "FUNDAMENTALS", label: "CS + SQL", description: "Core CS topics and optional SQL editor round.", minutes: 20, icon: "school" },
        { stage: "CLOSING", label: "Wrap-up", description: "Final feedback and next-step guidance.", minutes: 3, icon: "flag" },
    ],
    coding: [
        { stage: "DSA", label: "Coding", description: "Focused DSA problem solving in the IDE.", minutes: 40, icon: "code" },
    ],
    cs_fundamentals: [
        { stage: "INTRO", label: "Warm-up", description: "Quick context before fundamentals.", minutes: 2, icon: "waving_hand", optional: true, hidden: true },
        { stage: "FUNDAMENTALS", label: "CS fundamentals interview", description: "OS, DBMS, networks, OOP, and SQL reasoning.", minutes: 20, icon: "school" },
        { stage: "CLOSING", label: "Wrap-up", description: "Final feedback and next-step guidance.", minutes: 3, icon: "flag" },
    ],
    system_design: [
        { stage: "INTRO", label: "Warm-up", description: "Calibrate the problem space.", minutes: 2, icon: "waving_hand", optional: true, hidden: true },
        { stage: "SYSTEM_DESIGN", label: "System design", description: "Requirements, architecture, scale, and trade-offs.", minutes: 25, icon: "hub" },
        { stage: "CLOSING", label: "Wrap-up", description: "Final feedback and next-step guidance.", minutes: 3, icon: "flag" },
    ],
    behavioural: [
        { stage: "INTRO", label: "Warm-up", description: "Set background context.", minutes: 2, icon: "waving_hand", optional: true, hidden: true },
        { stage: "BEHAVIOURAL", label: "Behavioural", description: "STAR stories, ownership, conflict, and teamwork.", minutes: 15, icon: "psychology" },
        { stage: "CLOSING", label: "Wrap-up", description: "Final feedback and next-step guidance.", minutes: 3, icon: "flag" },
    ],
    gen_ai_role: [
        { stage: "INTRO", label: "Resume deep-dive", description: "AI project ownership and production choices.", minutes: 10, icon: "badge", optional: true },
        { stage: "GEN_AI_CONCEPTS", label: "GenAI concepts", description: "RAG, prompting, evals, models, and deployment.", minutes: 10, icon: "auto_awesome" },
        { stage: "GEN_AI_CODING", label: "GenAI coding", description: "Live AI engineering task in the IDE.", minutes: 25, icon: "code" },
        { stage: "CLOSING", label: "Responsibility case", description: "AI safety and responsible product decisions.", minutes: 5, icon: "verified" },
    ],
    data_science_role: [
        { stage: "INTRO", label: "Resume deep-dive", description: "Data/ML project ownership and business impact.", minutes: 10, icon: "badge", optional: true },
        { stage: "DS_CONCEPTS", label: "Stats + ML", description: "Statistics, ML, and modeling judgment.", minutes: 15, icon: "analytics" },
        { stage: "DS_SQL", label: "SQL", description: "Business questions translated into SQL.", minutes: 15, icon: "database" },
        { stage: "DS_CODING", label: "Python/Pandas", description: "Live data analysis coding task.", minutes: 20, icon: "code" },
        { stage: "DS_BUSINESS_CASE", label: "Metrics case", description: "Metrics, experiments, and business trade-offs.", minutes: 10, icon: "monitoring" },
    ],
    pm_role: [
        { stage: "INTRO", label: "Resume ownership", description: "Connect resume experience to product impact.", minutes: 18, icon: "badge", optional: true },
        { stage: "PM_CASE", label: "Product case", description: "Structure cases, clarify goals, and prioritize.", minutes: 22, icon: "inventory_2" },
        { stage: "PM_CONCEPTS", label: "PM concepts", description: "Metrics, prioritization, and experimentation.", minutes: 18, icon: "schema" },
        { stage: "PM_STRATEGY", label: "Strategy", description: "Market reasoning and strategic trade-offs.", minutes: 18, icon: "conversion_path" },
        { stage: "PM_BEHAVIORAL", label: "Behavioural", description: "Leadership, launches, and cross-functional stories.", minutes: 14, icon: "psychology" },
    ],
    problem_solving_case: [
        { stage: "PROBLEM_SOLVING", label: "Problem-solving", description: "Structured reasoning, hints, twists, and conviction.", minutes: 25, icon: "extension" },
        { stage: "CLOSING", label: "Wrap-up", description: "Final feedback and next-step guidance.", minutes: 3, icon: "flag" },
    ],
    resume_round: [
        { stage: "RESUME_STUDIES", label: "Opening Calibration", description: "Brief background and target-role context.", minutes: 1, icon: "school", hidden: true },
        { stage: "RESUME_PROJECTS", label: "Projects Verification", description: "Claims, skills, AI usage, architecture, trade-offs, and impact.", minutes: 18, icon: "workspaces" },
        { stage: "RESUME_EXPERIENCE", label: "Experience Evidence", description: "Shipped work, responsibility, and outcomes.", minutes: 5, icon: "business_center", optional: true },
        { stage: "RESUME_RESPONSIBILITY", label: "Leadership Evidence", description: "Initiative, accountability, influence, and results.", minutes: 3, icon: "groups", optional: true },
        { stage: "RESUME_SKILLS", label: "Fit & Communication", description: "Role alignment, self-awareness, and proof-point synthesis.", minutes: 4, icon: "fact_check" },
        { stage: "CLOSING", label: "Wrap-up", description: "Risks, proof points, and next preparation actions.", minutes: 2, icon: "flag" },
    ],
};

const DSA_TOPICS = [
    "Array",
    "String",
    "Hash Table",
    "Dynamic Programming",
    "Two Pointers",
    "Linked List",
    "Binary Search",
    "Tree",
    "Graph",
    "Stack",
    "Greedy",
    "Backtracking",
    "Math",
    "Bit Manipulation",
];
const DSA_TOPIC_DESCRIPTIONS: Record<string, string> = {
    Array: "Indexing, scans, windows, and in-place updates.",
    String: "Parsing, matching, substrings, and character counts.",
    "Hash Table": "Lookup design, frequency maps, and collision-free reasoning.",
    "Dynamic Programming": "States, transitions, memoization, and tabulation.",
    "Two Pointers": "Sorted scans, sliding ranges, and pair constraints.",
    "Linked List": "Pointers, reversals, cycles, and list surgery.",
    "Binary Search": "Monotonic checks, boundaries, and search space design.",
    Tree: "Traversal, recursion, depth, and ancestor reasoning.",
    Graph: "BFS, DFS, connectivity, shortest paths, and cycles.",
    Stack: "Monotonic stacks, parsing, and nested state.",
    Greedy: "Local choices, exchange arguments, and scheduling.",
    Backtracking: "Search trees, pruning, combinations, and constraints.",
    Math: "Number theory, combinatorics, and careful edge cases.",
    "Bit Manipulation": "Masks, toggles, XOR patterns, and binary state.",
};
const CS_TOPICS = ["DBMS", "OS", "CN", "OOPS"];
const GENAI_SUBTOPICS = ["RAGPipeline", "PromptEngineering", "Evaluation", "ModelSelection", "MLOps", "TransformerInternals"];
const GENAI_SUBTOPIC_DESCRIPTIONS: Record<string, string> = {
    RAGPipeline: "Retrieval flow, chunking, embeddings, and grounding.",
    PromptEngineering: "Prompt patterns, guardrails, and prompt testing.",
    Evaluation: "Quality metrics, eval sets, and regression checks.",
    ModelSelection: "Trade-offs across latency, quality, and cost.",
    MLOps: "Deployment, monitoring, versioning, and iteration loops.",
    TransformerInternals: "Attention, tokens, context windows, and architecture basics.",
};
const DS_CONCEPT_CATEGORIES = ["statistics", "ml_fundamentals", "tabular_techniques", "deep_learning", "probabilistic_models", "reinforcement_learning"];
const DS_CONCEPT_DESCRIPTIONS: Record<string, string> = {
    statistics: "Probability, inference, sampling, and hypothesis tests.",
    ml_fundamentals: "Bias-variance, validation, features, and metrics.",
    tabular_techniques: "Cleaning, encoding, feature engineering, and model choice.",
    deep_learning: "Neural nets, optimization, regularization, and architectures.",
    probabilistic_models: "Bayes, uncertainty, distributions, and graphical intuition.",
    reinforcement_learning: "Rewards, policies, exploration, and value functions.",
};

const LEVEL_OPTIONS = [
    { value: "Junior", label: "Entry Level" },
    { value: "Mid", label: "Mid-level" },
    { value: "Senior", label: "Senior-level" },
] as const;

const QUESTION_COUNT_OPTIONS = [
    { value: 1, label: "1 question per topic", description: "Quick pass" },
    { value: 2, label: "2 questions per topic", description: "Balanced depth" },
    { value: 3, label: "3 questions per topic", description: "Deeper drill" },
] as const;

type InterviewLevel = (typeof LEVEL_OPTIONS)[number]["value"];

const MAX_ESTIMATED_MINUTES = 90;
const SQL_ESTIMATED_MINUTES = 10;

function roundEstimate(minutes: number) {
    if (minutes <= 0) return 0;
    return Math.min(MAX_ESTIMATED_MINUTES, Math.max(5, Math.round(minutes / 5) * 5));
}

function clampEstimate(minutes: number, min: number, max: number) {
    return Math.max(min, Math.min(max, minutes));
}

function applyResumeAwareCap(nonResumeMinutes: number, resumeMinutes: number, includeResume: boolean) {
    if (resumeMinutes <= 0) return roundEstimate(nonResumeMinutes);
    const cappedNonResumeMinutes = Math.min(nonResumeMinutes, MAX_ESTIMATED_MINUTES - resumeMinutes);
    return roundEstimate(cappedNonResumeMinutes + (includeResume ? resumeMinutes : 0));
}

function scrollElementToBottom(element: HTMLDivElement | null) {
    if (!element) return;
    element.scrollTop = element.scrollHeight;
}

function calculateEstimatedMinutes({
    selectedType,
    selectedModules,
    enabledStageSet,
    resumeId,
    dsaTopics,
    csTopics,
    includeSqlRound,
    questionCountPerTopic,
    genAIConcepts,
    dsConcepts,
}: {
    selectedType: InterviewCostKey | null;
    selectedModules: ModuleOption[];
    enabledStageSet: Set<InterviewStage>;
    resumeId: string | null;
    dsaTopics: string[];
    csTopics: string[];
    includeSqlRound: boolean;
    questionCountPerTopic: number;
    genAIConcepts: string[];
    dsConcepts: string[];
}) {
    if (!selectedType) return 0;

    const hasStage = (stage: InterviewStage) => enabledStageSet.has(stage);
    const moduleMinutes = (stage: InterviewStage) => selectedModules.find((module) => module.stage === stage)?.minutes ?? 0;
    const questionMinutes = 5;
    const fullInterviewQuestionMinutes = 3;
    const fixedModuleTotal = selectedModules
        .filter((module) => enabledStageSet.has(module.stage) && !isInternalStage(selectedType, module.stage))
        .reduce((sum, module) => sum + module.minutes, 0);

    let minutes = 0;

    if (selectedType === "full_interview") {
        const resumeMinutes = 10;
        if (hasStage("DSA")) minutes += 40;
        if (hasStage("FUNDAMENTALS")) {
            const topicCount = Math.max(1, csTopics.length);
            minutes += clampEstimate(topicCount * questionCountPerTopic * fullInterviewQuestionMinutes, 10, 36);
            if (includeSqlRound) minutes += SQL_ESTIMATED_MINUTES;
        }
        if (hasStage("CLOSING")) minutes += moduleMinutes("CLOSING") || 5;
        return applyResumeAwareCap(minutes, resumeMinutes, Boolean(resumeId && hasStage("INTRO")));
    }

    if (selectedType === "cs_fundamentals") {
        const topicCount = Math.max(1, csTopics.length);
        minutes += clampEstimate(topicCount * questionCountPerTopic * questionMinutes, 10, 60);
        if (includeSqlRound) minutes += SQL_ESTIMATED_MINUTES;
        if (hasStage("CLOSING")) minutes += moduleMinutes("CLOSING") || 5;
        return roundEstimate(minutes);
    }

    if (selectedType === "coding") {
        return roundEstimate(clampEstimate(38 + Math.min(dsaTopics.length, 5), 35, 50));
    }

    if (selectedType === "gen_ai_role") {
        const resumeMinutes = moduleMinutes("INTRO");
        if (hasStage("GEN_AI_CONCEPTS")) minutes += clampEstimate(12 + Math.min(genAIConcepts.length, 4), 10, 20);
        if (hasStage("GEN_AI_CODING")) minutes += clampEstimate(28, 25, 35);
        if (hasStage("CLOSING")) minutes += moduleMinutes("CLOSING") || 10;
        return applyResumeAwareCap(minutes, resumeMinutes, Boolean(resumeId && hasStage("INTRO")));
    }

    if (selectedType === "data_science_role") {
        const resumeMinutes = moduleMinutes("INTRO");
        if (hasStage("DS_CONCEPTS")) minutes += clampEstimate(15 + Math.min(dsConcepts.length, 4), 15, 25);
        if (hasStage("DS_SQL")) minutes += clampEstimate(14, 12, 18);
        if (hasStage("DS_CODING")) minutes += clampEstimate(24, 20, 32);
        if (hasStage("DS_BUSINESS_CASE")) minutes += clampEstimate(12, 10, 16);
        return applyResumeAwareCap(minutes, resumeMinutes, Boolean(resumeId && hasStage("INTRO")));
    }

    if (selectedType === "pm_role") {
        const resumeMinutes = moduleMinutes("INTRO");
        if (hasStage("PM_CASE")) minutes += clampEstimate(24, 20, 30);
        if (hasStage("PM_CONCEPTS")) minutes += clampEstimate(18, 15, 25);
        if (hasStage("PM_STRATEGY")) minutes += clampEstimate(18, 15, 25);
        if (hasStage("PM_BEHAVIORAL")) minutes += clampEstimate(15, 12, 20);
        return applyResumeAwareCap(minutes, resumeMinutes, Boolean(resumeId && hasStage("INTRO")));
    }

    if (selectedType === "system_design") return roundEstimate(clampEstimate(38, 35, 50));
    if (selectedType === "behavioural") return roundEstimate(clampEstimate(22, 20, 30));
    if (selectedType === "problem_solving_case") return roundEstimate(25);
    if (selectedType === "resume_round") return roundEstimate(fixedModuleTotal);

    return roundEstimate(fixedModuleTotal);
}

type StoredCsJourney = {
    previewReady?: boolean;
    journeyStep?: CsJourneyStep;
    resumeId?: string | null;
    topics?: string[];
    includeSqlRound?: boolean;
    questionCountPerTopic?: number;
    level?: InterviewLevel;
};

type StoredFullJourney = {
    previewReady?: boolean;
    journeyStep?: FullJourneyStep;
    resumeId?: string | null;
    enabledStages?: InterviewStage[];
    dsaTopics?: string[];
    csTopics?: string[];
    includeSqlRound?: boolean;
    questionCountPerTopic?: number;
    level?: InterviewLevel;
};

type StoredCodingJourney = {
    previewReady?: boolean;
    journeyStep?: CodingJourneyStep;
    enabledStages?: InterviewStage[];
    dsaTopics?: string[];
    level?: InterviewLevel;
};

type StoredGenAiJourney = {
    previewReady?: boolean;
    journeyStep?: GenAiJourneyStep;
    resumeId?: string | null;
    enabledStages?: InterviewStage[];
    genAIConcepts?: string[];
    level?: InterviewLevel;
};

type StoredRoleJourney = {
    previewReady?: boolean;
    journeyStep?: RoleJourneyStep;
    resumeId?: string | null;
    enabledStages?: InterviewStage[];
    dsConcepts?: string[];
    level?: InterviewLevel;
};

type StoredSimpleJourney = {
    previewReady?: boolean;
    journeyStep?: SimpleJourneyStep;
    resumeId?: string | null;
    enabledStages?: InterviewStage[];
};

type StoredShortJourney = {
    previewReady?: boolean;
    journeyStep?: ShortJourneyStep;
    resumeId?: string | null;
    enabledStages?: InterviewStage[];
    level?: InterviewLevel;
};

const CS_JOURNEY_STORAGE_KEY = "mockr-cs-fundamentals-customize";
const FULL_JOURNEY_STORAGE_KEY = "mockr-full-interview-customize";
const CODING_JOURNEY_STORAGE_KEY = "mockr-coding-customize";
const GEN_AI_JOURNEY_STORAGE_KEY = "mockr-gen-ai-customize";
const ROLE_JOURNEY_STORAGE_PREFIX = "mockr-role-interview-customize";
const SIMPLE_JOURNEY_STORAGE_PREFIX = "mockr-simple-interview-customize";
const SHORT_JOURNEY_STORAGE_PREFIX = "mockr-short-interview-customize";

const isShortJourneyType = (type: InterviewCostKey | null): type is ShortJourneyType => type === "system_design" || type === "behavioural";
const isRoleJourneyType = (type: InterviewCostKey | null): type is RoleJourneyType => type === "data_science_role" || type === "pm_role";
const isSimpleJourneyType = (type: InterviewCostKey | null): type is SimpleJourneyType => type === "problem_solving_case" || type === "resume_round";

const getShortJourneyStorageKey = (type: ShortJourneyType) => `${SHORT_JOURNEY_STORAGE_PREFIX}-${type}`;
const getRoleJourneyStorageKey = (type: RoleJourneyType) => `${ROLE_JOURNEY_STORAGE_PREFIX}-${type}`;
const getSimpleJourneyStorageKey = (type: SimpleJourneyType) => `${SIMPLE_JOURNEY_STORAGE_PREFIX}-${type}`;

const getSimpleJourneySteps = (type: SimpleJourneyType): SimpleJourneyStep[] => type === "resume_round"
    ? ["resume", "modules"]
    : ["modules"];

const getShortJourneySteps = (type: ShortJourneyType): ShortJourneyStep[] => type === "system_design"
    ? ["resume", "settings"]
    : ["resume"];

const readStoredCsJourney = (): StoredCsJourney | null => {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.sessionStorage.getItem(CS_JOURNEY_STORAGE_KEY);
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === "object" ? parsed as StoredCsJourney : null;
    } catch {
        return null;
    }
};

const readStoredFullJourney = (): StoredFullJourney | null => {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.sessionStorage.getItem(FULL_JOURNEY_STORAGE_KEY);
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === "object" ? parsed as StoredFullJourney : null;
    } catch {
        return null;
    }
};

const readStoredCodingJourney = (): StoredCodingJourney | null => {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.sessionStorage.getItem(CODING_JOURNEY_STORAGE_KEY);
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === "object" ? parsed as StoredCodingJourney : null;
    } catch {
        return null;
    }
};

const readStoredGenAiJourney = (): StoredGenAiJourney | null => {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.sessionStorage.getItem(GEN_AI_JOURNEY_STORAGE_KEY);
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === "object" ? parsed as StoredGenAiJourney : null;
    } catch {
        return null;
    }
};

const readStoredRoleJourney = (type: RoleJourneyType): StoredRoleJourney | null => {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.sessionStorage.getItem(getRoleJourneyStorageKey(type));
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === "object" ? parsed as StoredRoleJourney : null;
    } catch {
        return null;
    }
};

const readStoredSimpleJourney = (type: SimpleJourneyType): StoredSimpleJourney | null => {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.sessionStorage.getItem(getSimpleJourneyStorageKey(type));
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === "object" ? parsed as StoredSimpleJourney : null;
    } catch {
        return null;
    }
};

const readStoredShortJourney = (type: ShortJourneyType): StoredShortJourney | null => {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.sessionStorage.getItem(getShortJourneyStorageKey(type));
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === "object" ? parsed as StoredShortJourney : null;
    } catch {
        return null;
    }
};

const getStoredCsTopics = () => {
    const topics = readStoredCsJourney()?.topics;
    if (!Array.isArray(topics)) return CS_TOPICS;
    const next = topics.filter((topic) => (CS_TOPICS as readonly string[]).includes(topic));
    return next.length > 0 ? next : CS_TOPICS;
};

const getStoredFullCsTopics = () => {
    const topics = readStoredFullJourney()?.csTopics;
    if (!Array.isArray(topics)) return CS_TOPICS;
    const next = topics.filter((topic) => (CS_TOPICS as readonly string[]).includes(topic));
    return next.length > 0 ? next : CS_TOPICS;
};

const getStoredFullDsaTopics = () => {
    const topics = readStoredFullJourney()?.dsaTopics;
    if (!Array.isArray(topics)) return [];
    return topics.filter((topic) => (DSA_TOPICS as readonly string[]).includes(topic));
};

const getStoredFullJourneyStep = (): FullJourneyStep => {
    const step = readStoredFullJourney()?.journeyStep;
    return step === "resume" || step === "modules" || step === "coding" || step === "cs" || step === "sql" || step === "settings" ? step : "resume";
};

const getStoredFullQuestionCount = () => {
    const count = readStoredFullJourney()?.questionCountPerTopic;
    return count === 1 || count === 2 || count === 3 ? count : 2;
};

const getStoredFullLevel = (): InterviewLevel => {
    const level = readStoredFullJourney()?.level;
    return LEVEL_OPTIONS.some((option) => option.value === level) ? level as InterviewLevel : "Mid";
};

const getStoredFullStages = () => {
    const storedStages = readStoredFullJourney()?.enabledStages;
    if (!Array.isArray(storedStages)) return null;
    const allowedStages = new Set((MODULE_OPTIONS.full_interview || []).map((module) => module.stage));
    const next = storedStages.filter((stage) => allowedStages.has(stage));
    const hasPractice = next.some((stage) => !isInternalStage("full_interview", stage) && stage !== "CLOSING");
    return hasPractice ? next : null;
};

const getStoredCodingDsaTopics = () => {
    const topics = readStoredCodingJourney()?.dsaTopics;
    if (!Array.isArray(topics)) return [];
    return topics.filter((topic) => (DSA_TOPICS as readonly string[]).includes(topic));
};

const getStoredCodingJourneyStep = (): CodingJourneyStep => {
    const step = readStoredCodingJourney()?.journeyStep;
    return step === "settings" ? "settings" : "focus";
};

const getStoredCodingLevel = (): InterviewLevel => {
    const level = readStoredCodingJourney()?.level;
    return LEVEL_OPTIONS.some((option) => option.value === level) ? level as InterviewLevel : "Mid";
};

const getStoredCodingStages = () => {
    const storedStages = readStoredCodingJourney()?.enabledStages;
    if (!Array.isArray(storedStages)) return null;
    const allowedStages = new Set((MODULE_OPTIONS.coding || []).map((module) => module.stage));
    const next = storedStages.filter((stage) => allowedStages.has(stage));
    const hasPractice = next.some((stage) => !isInternalStage("coding", stage) && stage !== "CLOSING");
    return hasPractice ? next : null;
};

const getStoredGenAiConcepts = () => {
    const topics = readStoredGenAiJourney()?.genAIConcepts;
    if (!Array.isArray(topics)) return [];
    return topics.filter((topic) => (GENAI_SUBTOPICS as readonly string[]).includes(topic));
};

const getStoredGenAiJourneyStep = (): GenAiJourneyStep => {
    const step = readStoredGenAiJourney()?.journeyStep;
    return step === "resume" || step === "modules" || step === "question" || step === "settings" ? step : "resume";
};

const getStoredGenAiLevel = (): InterviewLevel => {
    const level = readStoredGenAiJourney()?.level;
    return LEVEL_OPTIONS.some((option) => option.value === level) ? level as InterviewLevel : "Mid";
};

const getStoredGenAiStages = () => {
    const storedStages = readStoredGenAiJourney()?.enabledStages;
    if (!Array.isArray(storedStages)) return null;
    const allowedStages = new Set((MODULE_OPTIONS.gen_ai_role || []).map((module) => module.stage));
    const next = storedStages.filter((stage) => allowedStages.has(stage));
    const hasPractice = next.some((stage) => !isInternalStage("gen_ai_role", stage) && stage !== "CLOSING");
    const hasRequired = next.includes("CLOSING");
    return hasPractice && hasRequired ? next : null;
};

const getStoredRoleDsConcepts = (type: RoleJourneyType) => {
    const topics = readStoredRoleJourney(type)?.dsConcepts;
    if (!Array.isArray(topics)) return [];
    return topics.filter((topic) => (DS_CONCEPT_CATEGORIES as readonly string[]).includes(topic));
};

const getStoredRoleJourneyStep = (type: RoleJourneyType): RoleJourneyStep => {
    const step = readStoredRoleJourney(type)?.journeyStep;
    if (type === "pm_role" && step === "question") return "settings";
    return step === "resume" || step === "modules" || step === "question" || step === "settings" ? step : "resume";
};

const getStoredRoleLevel = (type: RoleJourneyType): InterviewLevel => {
    const level = readStoredRoleJourney(type)?.level;
    return LEVEL_OPTIONS.some((option) => option.value === level) ? level as InterviewLevel : "Mid";
};

const getStoredRoleStages = (type: RoleJourneyType) => {
    const storedStages = readStoredRoleJourney(type)?.enabledStages;
    if (!Array.isArray(storedStages)) return null;
    const allowedStages = new Set((MODULE_OPTIONS[type] || []).map((module) => module.stage));
    const next = storedStages.filter((stage) => allowedStages.has(stage));
    const hasPractice = next.some((stage) => !isInternalStage(type, stage) && stage !== "CLOSING");
    return hasPractice ? next : null;
};

const getStoredSimpleJourneyStep = (type: SimpleJourneyType): SimpleJourneyStep => {
    const step = readStoredSimpleJourney(type)?.journeyStep;
    return getSimpleJourneySteps(type).includes(step as SimpleJourneyStep) ? step as SimpleJourneyStep : getSimpleJourneySteps(type)[0];
};

const getStoredSimpleStages = (type: SimpleJourneyType) => {
    const storedStages = readStoredSimpleJourney(type)?.enabledStages;
    if (!Array.isArray(storedStages)) return null;
    const allowedStages = new Set((MODULE_OPTIONS[type] || []).map((module) => module.stage));
    const next = storedStages.filter((stage) => allowedStages.has(stage));
    const hasPractice = next.some((stage) => !isInternalStage(type, stage) && stage !== "CLOSING");
    return hasPractice ? next : null;
};

const getStoredShortJourneyStep = (type: ShortJourneyType): ShortJourneyStep => {
    const step = readStoredShortJourney(type)?.journeyStep;
    return getShortJourneySteps(type).includes(step as ShortJourneyStep) ? step as ShortJourneyStep : "resume";
};

const getStoredShortLevel = (type: ShortJourneyType): InterviewLevel => {
    const level = readStoredShortJourney(type)?.level;
    return LEVEL_OPTIONS.some((option) => option.value === level) ? level as InterviewLevel : "Mid";
};

const getStoredShortStages = (type: ShortJourneyType) => {
    const storedStages = readStoredShortJourney(type)?.enabledStages;
    if (!Array.isArray(storedStages)) return null;
    const allowedStages = new Set((MODULE_OPTIONS[type] || []).map((module) => module.stage));
    const next = storedStages.filter((stage) => allowedStages.has(stage));
    const hasPractice = next.some((stage) => !isInternalStage(type, stage) && stage !== "CLOSING");
    return hasPractice ? next : null;
};

const getStoredCsJourneyStep = (): CsJourneyStep => {
    const step = readStoredCsJourney()?.journeyStep;
    return step === "resume" || step === "focus" || step === "sql" || step === "settings" ? step : "resume";
};

const getStoredCsQuestionCount = () => {
    const count = readStoredCsJourney()?.questionCountPerTopic;
    return count === 1 || count === 2 || count === 3 ? count : 2;
};

const getStoredCsLevel = (): InterviewLevel => {
    const level = readStoredCsJourney()?.level;
    return LEVEL_OPTIONS.some((option) => option.value === level) ? level as InterviewLevel : "Mid";
};

function isInternalStage(type: string | null, stage: InterviewStage) {
    if (type === "resume_round" && stage === "RESUME_STUDIES") return true;
    if (
        stage === "INTRO" &&
        (type === "cs_fundamentals" || type === "system_design" || type === "behavioural")
    ) return true;
    return stage === "CLOSING" && type !== "gen_ai_role";
}

function isRequiredStage(type: string | null, stage: InterviewStage) {
    return stage === "PM_BEHAVIORAL" || (type === "gen_ai_role" && stage === "CLOSING");
}

function isLockedStage(type: string | null, stage: InterviewStage) {
    return isInternalStage(type, stage) || isRequiredStage(type, stage);
}

function toggleValue<T>(values: T[], value: T) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function toggleRequiredValue<T>(values: T[], value: T) {
    if (values.includes(value) && values.length <= 1) return values;
    return toggleValue(values, value);
}

function titleCase(value: string) {
    return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDSConceptLabel(value: string) {
    if (value === "ml_fundamentals") return "ML Fundamentals";
    return titleCase(value);
}

function formatFocusLabel(value: string) {
    const knownLabels: Record<string, string> = {
        RAGPipeline: "RAG Pipeline",
        PromptEngineering: "Prompt Engineering",
        ModelSelection: "Model Selection",
        TransformerInternals: "Transformer Internals",
        MLOps: "MLOps",
    };
    if (knownLabels[value]) return knownLabels[value];
    return titleCase(value.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function CustomizeInterviewContent() {
    const router = useRouter();
    const params = useSearchParams();
    const { handleFeatureError, UpgradeModal: FeatureLimitModal } = useFeatureLimit();
    const { snapshot, loading: billingLoading } = useBilling();

    const rawType = params.get("type") as InterviewCostKey | null;
    const selectedType = rawType && INTERVIEW_TYPE_MAP[rawType] ? rawType : null;
    const initialResumeId = params.get("resumeId");

    const selectedTypeInfo = selectedType ? INTERVIEW_TYPE_MAP[selectedType] : null;
    const isCsFundamentals = selectedType === "cs_fundamentals";
    const isFullInterview = selectedType === "full_interview";
    const isCodingInterview = selectedType === "coding";
    const isGenAiInterview = selectedType === "gen_ai_role";
    const isDataScienceInterview = selectedType === "data_science_role";
    const isRoleJourneyInterview = isRoleJourneyType(selectedType);
    const isSimpleJourneyInterview = isSimpleJourneyType(selectedType);
    const isShortJourneyInterview = isShortJourneyType(selectedType);
    const selectedModules = useMemo(() => selectedType ? MODULE_OPTIONS[selectedType] || [] : [], [selectedType]);
    const [enabledStages, setEnabledStages] = useState<InterviewStage[]>(() => isFullInterview ? getStoredFullStages() || [] : isCodingInterview ? getStoredCodingStages() || [] : isGenAiInterview ? getStoredGenAiStages() || [] : isRoleJourneyType(selectedType) ? getStoredRoleStages(selectedType) || [] : isSimpleJourneyType(selectedType) ? getStoredSimpleStages(selectedType) || [] : isShortJourneyType(selectedType) ? getStoredShortStages(selectedType) || [] : []);
    const [dsaTopics, setDsaTopics] = useState<string[]>(() => isFullInterview ? getStoredFullDsaTopics() : isCodingInterview ? getStoredCodingDsaTopics() : []);
    const [csTopics, setCsTopics] = useState<string[]>(() => isCsFundamentals ? getStoredCsTopics() : isFullInterview ? getStoredFullCsTopics() : CS_TOPICS);
    const [includeSqlRound, setIncludeSqlRound] = useState(() => isCsFundamentals ? readStoredCsJourney()?.includeSqlRound ?? true : isFullInterview ? readStoredFullJourney()?.includeSqlRound ?? true : true);
    const [questionCountPerTopic, setQuestionCountPerTopic] = useState(() => isCsFundamentals ? getStoredCsQuestionCount() : isFullInterview ? getStoredFullQuestionCount() : 2);
    const [genAIConcepts, setGenAIConcepts] = useState<string[]>(() => isGenAiInterview ? getStoredGenAiConcepts() : []);
    const [dsConcepts, setDsConcepts] = useState<string[]>(() => isRoleJourneyType(selectedType) ? getStoredRoleDsConcepts(selectedType) : []);
    const [level, setLevel] = useState<InterviewLevel>(() => isCsFundamentals ? getStoredCsLevel() : isFullInterview ? getStoredFullLevel() : isCodingInterview ? getStoredCodingLevel() : isGenAiInterview ? getStoredGenAiLevel() : isRoleJourneyType(selectedType) ? getStoredRoleLevel(selectedType) : isShortJourneyType(selectedType) ? getStoredShortLevel(selectedType) : "Mid");
    const [resumeAnalysis, setResumeAnalysis] = useState<any>(null);
    const [resumeId, setResumeId] = useState<string | null>(() => initialResumeId || (isCsFundamentals ? readStoredCsJourney()?.resumeId ?? null : isFullInterview ? readStoredFullJourney()?.resumeId ?? null : isGenAiInterview ? readStoredGenAiJourney()?.resumeId ?? null : isRoleJourneyType(selectedType) ? readStoredRoleJourney(selectedType)?.resumeId ?? null : isSimpleJourneyType(selectedType) ? readStoredSimpleJourney(selectedType)?.resumeId ?? null : isShortJourneyType(selectedType) ? readStoredShortJourney(selectedType)?.resumeId ?? null : null));
    const [existingResumes, setExistingResumes] = useState<any[]>([]);
    const [loadingResumes, setLoadingResumes] = useState(true);
    const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
    const [uploadingResume, setUploadingResume] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [moduleWarning, setModuleWarning] = useState<string | null>(null);
    const [showAddResume, setShowAddResume] = useState(false);
    const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [csJourneyStep, setCsJourneyStep] = useState<CsJourneyStep>(() => isCsFundamentals ? getStoredCsJourneyStep() : "resume");
    const [csPreviewReady, setCsPreviewReady] = useState(() => Boolean(isCsFundamentals && readStoredCsJourney()?.previewReady));
    const [csEditModal, setCsEditModal] = useState<CsEditModal>(null);
    const [csJourneyRestored, setCsJourneyRestored] = useState(false);
    const [fullJourneyStep, setFullJourneyStep] = useState<FullJourneyStep>(() => isFullInterview ? getStoredFullJourneyStep() : "resume");
    const [fullPreviewReady, setFullPreviewReady] = useState(() => Boolean(isFullInterview && readStoredFullJourney()?.previewReady));
    const [fullEditModal, setFullEditModal] = useState<FullEditModal>(null);
    const [fullJourneyRestored, setFullJourneyRestored] = useState(false);
    const [codingJourneyStep, setCodingJourneyStep] = useState<CodingJourneyStep>(() => isCodingInterview ? getStoredCodingJourneyStep() : "focus");
    const [codingPreviewReady, setCodingPreviewReady] = useState(() => Boolean(isCodingInterview && readStoredCodingJourney()?.previewReady));
    const [codingEditModal, setCodingEditModal] = useState<CodingEditModal>(null);
    const [codingJourneyRestored, setCodingJourneyRestored] = useState(false);
    const [genAiJourneyStep, setGenAiJourneyStep] = useState<GenAiJourneyStep>(() => isGenAiInterview ? getStoredGenAiJourneyStep() : "resume");
    const [genAiPreviewReady, setGenAiPreviewReady] = useState(() => Boolean(isGenAiInterview && readStoredGenAiJourney()?.previewReady));
    const [genAiEditModal, setGenAiEditModal] = useState<GenAiEditModal>(null);
    const [genAiJourneyRestored, setGenAiJourneyRestored] = useState(false);
    const [roleJourneyStep, setRoleJourneyStep] = useState<RoleJourneyStep>(() => isRoleJourneyType(selectedType) ? getStoredRoleJourneyStep(selectedType) : "resume");
    const [rolePreviewReady, setRolePreviewReady] = useState(() => Boolean(isRoleJourneyType(selectedType) && readStoredRoleJourney(selectedType)?.previewReady));
    const [roleEditModal, setRoleEditModal] = useState<RoleEditModal>(null);
    const [roleJourneyRestored, setRoleJourneyRestored] = useState(false);
    const [simpleJourneyStep, setSimpleJourneyStep] = useState<SimpleJourneyStep>(() => isSimpleJourneyType(selectedType) ? getStoredSimpleJourneyStep(selectedType) : "modules");
    const [simplePreviewReady, setSimplePreviewReady] = useState(() => Boolean(isSimpleJourneyType(selectedType) && readStoredSimpleJourney(selectedType)?.previewReady));
    const [simpleEditModal, setSimpleEditModal] = useState<SimpleEditModal>(null);
    const [simpleJourneyRestored, setSimpleJourneyRestored] = useState(false);
    const [shortJourneyStep, setShortJourneyStep] = useState<ShortJourneyStep>(() => isShortJourneyType(selectedType) ? getStoredShortJourneyStep(selectedType) : "resume");
    const [shortPreviewReady, setShortPreviewReady] = useState(() => Boolean(isShortJourneyType(selectedType) && readStoredShortJourney(selectedType)?.previewReady));
    const [shortEditModal, setShortEditModal] = useState<ShortEditModal>(null);
    const [shortJourneyRestored, setShortJourneyRestored] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const problemSolvingWarmupStartedRef = useRef(false);

    useEffect(() => {
        document.title = "Customize Interview | Mockr";
    }, []);

    useEffect(() => {
        if (!selectedType) {
            setEnabledStages([]);
            return;
        }
        if (selectedType === "full_interview") {
            setEnabledStages(getStoredFullStages() || (MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
            return;
        }
        if (selectedType === "coding") {
            setEnabledStages(getStoredCodingStages() || (MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
            return;
        }
        if (selectedType === "gen_ai_role") {
            setEnabledStages(getStoredGenAiStages() || (MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
            return;
        }
        if (isRoleJourneyType(selectedType)) {
            setEnabledStages(getStoredRoleStages(selectedType) || (MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
            return;
        }
        if (selectedType === "problem_solving_case") {
            setEnabledStages((MODULE_OPTIONS.problem_solving_case || []).map((module) => module.stage));
            return;
        }
        if (isSimpleJourneyType(selectedType)) {
            setEnabledStages(getStoredSimpleStages(selectedType) || (MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
            return;
        }
        if (isShortJourneyType(selectedType)) {
            setEnabledStages(getStoredShortStages(selectedType) || (MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
            return;
        }
        setEnabledStages((MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
    }, [selectedType]);

    useEffect(() => {
        if ((isCsFundamentals || isFullInterview || isGenAiInterview || isRoleJourneyInterview || isSimpleJourneyInterview || isShortJourneyInterview) && !initialResumeId) return;
        setResumeId(initialResumeId);
    }, [initialResumeId, isCsFundamentals, isFullInterview, isGenAiInterview, isRoleJourneyInterview, isSimpleJourneyInterview, isShortJourneyInterview]);

    useEffect(() => {
        if (!isCsFundamentals) {
            setCsJourneyRestored(false);
            return;
        }

        const stored = readStoredCsJourney();
        if (stored) {
            const storedTopics = Array.isArray(stored.topics)
                ? stored.topics.filter((topic) => (CS_TOPICS as readonly string[]).includes(topic))
                : [];
            const storedStep = stored.journeyStep;

            setCsPreviewReady(Boolean(stored.previewReady));
            setCsJourneyStep(storedStep === "resume" || storedStep === "focus" || storedStep === "sql" || storedStep === "settings" ? storedStep : "resume");
            if (!initialResumeId) setResumeId(stored.resumeId ?? null);
            setCsTopics(storedTopics.length > 0 ? storedTopics : CS_TOPICS);
            setIncludeSqlRound(typeof stored.includeSqlRound === "boolean" ? stored.includeSqlRound : true);
            setQuestionCountPerTopic(stored.questionCountPerTopic === 1 || stored.questionCountPerTopic === 2 || stored.questionCountPerTopic === 3 ? stored.questionCountPerTopic : 2);
            setLevel(LEVEL_OPTIONS.some((option) => option.value === stored.level) ? stored.level as InterviewLevel : "Mid");
        }
        setCsJourneyRestored(true);
    }, [initialResumeId, isCsFundamentals]);

    useEffect(() => {
        if (!isCsFundamentals || !csJourneyRestored || typeof window === "undefined") return;
        window.sessionStorage.setItem(CS_JOURNEY_STORAGE_KEY, JSON.stringify({
            previewReady: csPreviewReady,
            journeyStep: csJourneyStep,
            resumeId,
            topics: csTopics,
            includeSqlRound,
            questionCountPerTopic,
            level,
        }));
    }, [csJourneyRestored, csJourneyStep, csPreviewReady, csTopics, includeSqlRound, isCsFundamentals, level, questionCountPerTopic, resumeId]);

    useEffect(() => {
        if (!isFullInterview) {
            setFullJourneyRestored(false);
            return;
        }

        const stored = readStoredFullJourney();
        if (stored) {
            const storedStep = stored.journeyStep;
            const storedStages = getStoredFullStages();
            setFullPreviewReady(Boolean(stored.previewReady));
            setFullJourneyStep(storedStep === "resume" || storedStep === "modules" || storedStep === "coding" || storedStep === "cs" || storedStep === "sql" || storedStep === "settings" ? storedStep : "resume");
            if (!initialResumeId) setResumeId(stored.resumeId ?? null);
            if (storedStages) setEnabledStages(storedStages);
            setDsaTopics(getStoredFullDsaTopics());
            setCsTopics(getStoredFullCsTopics());
            setIncludeSqlRound(typeof stored.includeSqlRound === "boolean" ? stored.includeSqlRound : true);
            setQuestionCountPerTopic(stored.questionCountPerTopic === 1 || stored.questionCountPerTopic === 2 || stored.questionCountPerTopic === 3 ? stored.questionCountPerTopic : 2);
            setLevel(LEVEL_OPTIONS.some((option) => option.value === stored.level) ? stored.level as InterviewLevel : "Mid");
        }
        setFullJourneyRestored(true);
    }, [initialResumeId, isFullInterview]);

    useEffect(() => {
        if (!isFullInterview || !fullJourneyRestored || typeof window === "undefined") return;
        window.sessionStorage.setItem(FULL_JOURNEY_STORAGE_KEY, JSON.stringify({
            previewReady: fullPreviewReady,
            journeyStep: fullJourneyStep,
            resumeId,
            enabledStages,
            dsaTopics,
            csTopics,
            includeSqlRound,
            questionCountPerTopic,
            level,
        }));
    }, [csTopics, dsaTopics, enabledStages, fullJourneyRestored, fullJourneyStep, fullPreviewReady, includeSqlRound, isFullInterview, level, questionCountPerTopic, resumeId]);

    useEffect(() => {
        if (!isCodingInterview) {
            setCodingJourneyRestored(false);
            return;
        }

        const stored = readStoredCodingJourney();
        if (stored) {
            const storedStep = stored.journeyStep;
            const storedStages = getStoredCodingStages();
            setCodingPreviewReady(Boolean(stored.previewReady));
            setCodingJourneyStep(storedStep === "settings" ? "settings" : "focus");
            if (storedStages) setEnabledStages(storedStages);
            setDsaTopics(getStoredCodingDsaTopics());
            setLevel(LEVEL_OPTIONS.some((option) => option.value === stored.level) ? stored.level as InterviewLevel : "Mid");
        }
        setCodingJourneyRestored(true);
    }, [isCodingInterview]);

    useEffect(() => {
        if (!isCodingInterview || !codingJourneyRestored || typeof window === "undefined") return;
        window.sessionStorage.setItem(CODING_JOURNEY_STORAGE_KEY, JSON.stringify({
            previewReady: codingPreviewReady,
            journeyStep: codingJourneyStep,
            enabledStages,
            dsaTopics,
            level,
        }));
    }, [codingJourneyRestored, codingJourneyStep, codingPreviewReady, dsaTopics, enabledStages, isCodingInterview, level]);

    useEffect(() => {
        if (!isGenAiInterview) {
            setGenAiJourneyRestored(false);
            return;
        }

        const stored = readStoredGenAiJourney();
        if (stored) {
            const storedStep = stored.journeyStep;
            const storedStages = getStoredGenAiStages();
            setGenAiPreviewReady(Boolean(stored.previewReady));
            setGenAiJourneyStep(storedStep === "resume" || storedStep === "modules" || storedStep === "question" || storedStep === "settings" ? storedStep : "resume");
            if (!initialResumeId) setResumeId(stored.resumeId ?? null);
            if (storedStages) setEnabledStages(storedStages);
            setGenAIConcepts(getStoredGenAiConcepts());
            setLevel(LEVEL_OPTIONS.some((option) => option.value === stored.level) ? stored.level as InterviewLevel : "Mid");
        }
        setGenAiJourneyRestored(true);
    }, [initialResumeId, isGenAiInterview]);

    useEffect(() => {
        if (!isGenAiInterview || !genAiJourneyRestored || typeof window === "undefined") return;
        window.sessionStorage.setItem(GEN_AI_JOURNEY_STORAGE_KEY, JSON.stringify({
            previewReady: genAiPreviewReady,
            journeyStep: genAiJourneyStep,
            resumeId,
            enabledStages,
            genAIConcepts,
            level,
        }));
    }, [enabledStages, genAIConcepts, genAiJourneyRestored, genAiJourneyStep, genAiPreviewReady, isGenAiInterview, level, resumeId]);

    useEffect(() => {
        if (!isRoleJourneyType(selectedType)) {
            setRoleJourneyRestored(false);
            return;
        }

        const stored = readStoredRoleJourney(selectedType);
        if (stored) {
            const storedStages = getStoredRoleStages(selectedType);
            setRolePreviewReady(Boolean(stored.previewReady));
            setRoleJourneyStep(getStoredRoleJourneyStep(selectedType));
            if (!initialResumeId) setResumeId(stored.resumeId ?? null);
            if (storedStages) setEnabledStages(storedStages);
            setDsConcepts(getStoredRoleDsConcepts(selectedType));
            setLevel(LEVEL_OPTIONS.some((option) => option.value === stored.level) ? stored.level as InterviewLevel : "Mid");
        }
        setRoleJourneyRestored(true);
    }, [initialResumeId, selectedType]);

    useEffect(() => {
        if (!isRoleJourneyType(selectedType) || !roleJourneyRestored || typeof window === "undefined") return;
        window.sessionStorage.setItem(getRoleJourneyStorageKey(selectedType), JSON.stringify({
            previewReady: rolePreviewReady,
            journeyStep: roleJourneyStep,
            resumeId,
            enabledStages,
            dsConcepts,
            level,
        }));
    }, [dsConcepts, enabledStages, level, resumeId, roleJourneyRestored, roleJourneyStep, rolePreviewReady, selectedType]);

    useEffect(() => {
        if (!isSimpleJourneyType(selectedType)) {
            setSimpleJourneyRestored(false);
            return;
        }

        if (selectedType === "problem_solving_case") {
            if (typeof window !== "undefined") {
                window.sessionStorage.removeItem(getSimpleJourneyStorageKey(selectedType));
            }
            setSimplePreviewReady(false);
            setSimpleJourneyStep("modules");
            setSimpleEditModal(null);
            setResumeId(null);
            setResumeAnalysis(null);
            setEnabledStages((MODULE_OPTIONS.problem_solving_case || []).map((module) => module.stage));
            setSimpleJourneyRestored(true);
            return;
        }

        const stored = readStoredSimpleJourney(selectedType);
        if (stored) {
            const storedStages = getStoredSimpleStages(selectedType);
            setSimplePreviewReady(Boolean(stored.previewReady));
            setSimpleJourneyStep(getStoredSimpleJourneyStep(selectedType));
            if (!initialResumeId) setResumeId(stored.resumeId ?? null);
            if (storedStages) setEnabledStages(storedStages);
        }
        setSimpleJourneyRestored(true);
    }, [initialResumeId, selectedType]);

    useEffect(() => {
        if (!isSimpleJourneyType(selectedType) || !simpleJourneyRestored || typeof window === "undefined") return;
        if (selectedType === "problem_solving_case") {
            window.sessionStorage.removeItem(getSimpleJourneyStorageKey(selectedType));
            return;
        }
        window.sessionStorage.setItem(getSimpleJourneyStorageKey(selectedType), JSON.stringify({
            previewReady: simplePreviewReady,
            journeyStep: simpleJourneyStep,
            resumeId,
            enabledStages,
        }));
    }, [enabledStages, resumeId, selectedType, simpleJourneyRestored, simpleJourneyStep, simplePreviewReady]);

    useEffect(() => {
        if (!isShortJourneyType(selectedType)) {
            setShortJourneyRestored(false);
            return;
        }

        const stored = readStoredShortJourney(selectedType);
        if (stored) {
            const storedStep = stored.journeyStep;
            const storedStages = getStoredShortStages(selectedType);
            setShortPreviewReady(Boolean(stored.previewReady));
            setShortJourneyStep(getShortJourneySteps(selectedType).includes(storedStep as ShortJourneyStep) ? storedStep as ShortJourneyStep : "resume");
            if (!initialResumeId) setResumeId(stored.resumeId ?? null);
            if (storedStages) setEnabledStages(storedStages);
            setLevel(LEVEL_OPTIONS.some((option) => option.value === stored.level) ? stored.level as InterviewLevel : "Mid");
        }
        setShortJourneyRestored(true);
    }, [initialResumeId, selectedType]);

    useEffect(() => {
        if (!isShortJourneyType(selectedType) || !shortJourneyRestored || typeof window === "undefined") return;
        window.sessionStorage.setItem(getShortJourneyStorageKey(selectedType), JSON.stringify({
            previewReady: shortPreviewReady,
            journeyStep: shortJourneyStep,
            resumeId,
            enabledStages,
            level,
        }));
    }, [enabledStages, level, resumeId, selectedType, shortJourneyRestored, shortJourneyStep, shortPreviewReady]);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) return;
                const res = await api.get<{ resumes: any[] }>("/resumes", token);
                setExistingResumes(res.resumes || []);
                const resume = res.resumes?.find((item: any) => item.id === resumeId);
                setResumeAnalysis(resume?.analysis || null);

                if (res.resumes?.length) {
                    const urls: Record<string, string> = {};
                    await Promise.all(res.resumes.map(async (item: any) => {
                        try {
                            const urlRes = await api.get<{ url: string }>(`/resumes/${item.id}/download`, token);
                            urls[item.id] = urlRes.url;
                        } catch {
                            // Preview is nice to have, but selection still works without it.
                        }
                    }));
                    setSignedUrls(urls);
                }
            } catch {
                setResumeAnalysis(null);
                setExistingResumes([]);
            } finally {
                setLoadingResumes(false);
            }
        })();
    }, [resumeId]);

    const effectiveEnabledStages = resumeId ? enabledStages : enabledStages.filter((stage) => stage !== "INTRO");
    const enabledStageSet = new Set(effectiveEnabledStages);
    const isResumeScreening = selectedType === "resume_round";
    const visibleModules = selectedModules.filter((module) => !module.hidden && !isInternalStage(selectedType, module.stage) && (resumeId || module.stage !== "INTRO"));
    const visibleSelectedModules = visibleModules.filter((module) => enabledStageSet.has(module.stage));
    const selectedPracticeCount = isResumeScreening
        ? 1
        : selectedModules.filter((module) => !isInternalStage(selectedType, module.stage) && module.stage !== "CLOSING" && enabledStageSet.has(module.stage)).length;
    const fullHasCodingModule = isFullInterview && enabledStageSet.has("DSA");
    const fullHasCsModule = isFullInterview && enabledStageSet.has("FUNDAMENTALS");
    const genAiHasQuestionModule = isGenAiInterview && enabledStageSet.has("GEN_AI_CONCEPTS");
    const roleHasQuestionModule = isDataScienceInterview && enabledStageSet.has("DS_CONCEPTS");
    const estimatedMinutes = calculateEstimatedMinutes({
        selectedType,
        selectedModules,
        enabledStageSet,
        resumeId,
        dsaTopics,
        csTopics,
        includeSqlRound,
        questionCountPerTopic,
        genAIConcepts,
        dsConcepts,
    });
    const resumeModuleEnabled = Boolean(resumeId && enabledStageSet.has("INTRO")) || selectedType === "resume_round";
    const canUseResume = selectedModules.some((module) => module.stage === "INTRO") || selectedType === "resume_round";
    const showSessionSettings = selectedType !== "problem_solving_case" &&
        selectedType !== "behavioural" &&
        selectedType !== "resume_round";
    const hasQuestionFocusControls = enabledStageSet.has("DSA") ||
        enabledStageSet.has("FUNDAMENTALS") ||
        enabledStageSet.has("GEN_AI_CONCEPTS") ||
        enabledStageSet.has("DS_CONCEPTS");
    const selectedCost = selectedType ? interviewCreditCost(selectedType) : 0;
    const walletTotal = snapshot?.wallet.total ?? 0;
    const hasInsufficientCredits = Boolean(selectedType && snapshot && walletTotal < estimatedMinutes);
    const summaryCountLabel = isResumeScreening
        ? `${visibleSelectedModules.length} section${visibleSelectedModules.length === 1 ? "" : "s"} present - about ${estimatedMinutes} min`
        : `${selectedPracticeCount} module${selectedPracticeCount === 1 ? "" : "s"} selected - about ${estimatedMinutes} min`;
    const selectedResume = existingResumes.find((resume) => resume.id === resumeId);

    const toggleStage = (stage: InterviewStage) => {
        if (isLockedStage(selectedType, stage)) return;
        setModuleWarning(null);
        if (stage === "INTRO" && resumeId && enabledStageSet.has("INTRO")) {
            setModuleWarning("This module stays enabled while a resume is selected. Skip or clear the resume first.");
            return;
        }
        setEnabledStages((prev) => {
            const next = prev.includes(stage)
                ? prev.filter((item) => item !== stage)
                : [...prev, stage];
            const order = selectedModules.map((module) => module.stage);
            const ordered = order.filter((item) => next.includes(item));
            const hasPractice = ordered.some((item) => !isInternalStage(selectedType, item) && item !== "CLOSING");
            return hasPractice ? ordered : prev;
        });
    };

    const selectExistingResume = (resume: any) => {
        if (resumeId === resume.id) {
            setResumeId(null);
            setResumeAnalysis(null);
        } else {
            setResumeId(resume.id);
            setResumeAnalysis(resume.analysis || null);
            if (selectedModules.some((module) => module.stage === "INTRO")) {
                setEnabledStages((prev) => prev.includes("INTRO") ? prev : [...prev, "INTRO"]);
            }
        }
        setUploadError(null);
        setModuleWarning(null);
    };

    const handleFileSelect = (file: File) => {
        if (file.type !== "application/pdf") {
            setUploadError("Only PDF files are accepted.");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError("Maximum file size is 5MB.");
            return;
        }
        uploadResume(file);
    };

    const uploadResume = async (file: File) => {
        setUploadingResume(true);
        setUploadError(null);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            const formData = new FormData();
            formData.append("file", file);
            const res = await fetch(`${getApiBaseUrl()}/resumes/upload`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Upload failed");
            }

            const result = await res.json();
            const uploadedResume = { id: result.id, fileName: file.name, analysis: null, uploadedAt: new Date().toISOString() };
            setExistingResumes((prev) => [uploadedResume, ...prev]);
            setResumeId(result.id);
            setResumeAnalysis(null);
            if (selectedModules.some((module) => module.stage === "INTRO")) {
                setEnabledStages((prev) => prev.includes("INTRO") ? prev : [...prev, "INTRO"]);
            }
            setModuleWarning(null);
            setShowAddResume(false);

            try {
                const urlRes = await api.get<{ url: string }>(`/resumes/${result.id}/download`, token);
                setSignedUrls((prev) => ({ ...prev, [result.id]: urlRes.url }));
            } catch {
                // Ignore missing preview URL.
            }
        } catch (err: any) {
            setUploadError(err.message || "Failed to upload resume");
        } finally {
            setUploadingResume(false);
        }
    };

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    };

    const handleCardMouseEnter = (event: React.MouseEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        event.currentTarget.style.setProperty("--wave-dir", x < rect.width / 2 ? "1" : "-1");
    };

    const renderResumePreviewControls = ({
        allowSkip,
        skipDescription,
        uploadDescription = "Drop your resume or click to browse. PDF up to 5MB.",
    }: {
        allowSkip: boolean;
        skipDescription?: string;
        uploadDescription?: string;
    }) => (
        <div className="space-y-3">
            {loadingResumes ? (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm font-semibold text-slate-500 dark:border-lc-border dark:bg-lc-bg dark:text-slate-400">
                    Loading your resumes...
                </div>
            ) : (
                <div className="flex gap-4 overflow-x-auto px-1 pb-2 pt-1 custom-scrollbar">
                    {allowSkip && (
                        <button
                            type="button"
                            onClick={() => {
                                setResumeId(null);
                                setResumeAnalysis(null);
                                setEnabledStages((prev) => prev.filter((stage) => stage !== "INTRO"));
                                setModuleWarning(null);
                            }}
                            className={`flex h-[260px] w-[200px] shrink-0 flex-col justify-between rounded-2xl border p-3 text-left transition-all ${
                                !resumeId
                                    ? "border-transparent bg-blue-50 ring-2 ring-blue-500/20 dark:bg-blue-500/20 dark:ring-blue-400/25"
                                    : "border-slate-200 bg-white hover:border-blue-300 hover:shadow-md dark:border-lc-border dark:bg-lc-surface"
                            }`}
                        >
                            <span className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center dark:border-lc-border dark:bg-lc-bg">
                                <span className="flex size-12 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm dark:bg-lc-surface dark:text-slate-300">
                                    <span className="material-symbols-outlined text-[26px]">block</span>
                                </span>
                                <span className="mt-4 text-base font-extrabold text-slate-950 dark:text-white">Skip resume</span>
                                {skipDescription && (
                                    <span className="mt-1.5 text-xs leading-4 text-slate-500 dark:text-slate-400">{skipDescription}</span>
                                )}
                            </span>
                            <span className="mt-3 truncate text-sm font-extrabold text-slate-800 dark:text-slate-200">No resume</span>
                        </button>
                    )}

                    {existingResumes.map((resume) => {
                        const selected = resumeId === resume.id;
                        const previewUrl = signedUrls[resume.id];
                        return (
                            <div
                                key={resume.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => selectExistingResume(resume)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        selectExistingResume(resume);
                                    }
                                }}
                                className={`relative flex h-[260px] w-[200px] shrink-0 flex-col rounded-2xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:bg-lc-surface ${
                                    selected
                                        ? "border-transparent bg-blue-50 ring-2 ring-blue-500/25 dark:bg-blue-500/20"
                                        : "border-slate-200 hover:border-blue-300 dark:border-lc-border"
                                }`}
                            >
                                {selected && (
                                    <span className="absolute right-2.5 top-2.5 z-20 flex size-7 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/25">
                                        <span className="material-symbols-outlined text-[16px]">check</span>
                                    </span>
                                )}
                                <span className="relative m-2.5 mb-0 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-lc-border">
                                    {previewUrl ? (
                                        <iframe
                                            src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                            className="pointer-events-none h-[360%] w-full -translate-y-2 border-0 bg-white"
                                            scrolling="no"
                                            tabIndex={-1}
                                        />
                                    ) : (
                                        <span className="flex h-full w-full flex-col justify-start gap-2 p-4 text-slate-300 dark:text-slate-600">
                                            <span className="mx-auto mb-2 h-2 w-20 rounded-full bg-current" />
                                            <span className="h-1.5 w-full rounded-full bg-current opacity-80" />
                                            <span className="h-1.5 w-5/6 rounded-full bg-current opacity-70" />
                                            <span className="h-1.5 w-4/5 rounded-full bg-current opacity-70" />
                                            <span className="mt-3 h-1.5 w-full rounded-full bg-current opacity-80" />
                                            <span className="h-1.5 w-3/4 rounded-full bg-current opacity-70" />
                                            <span className="h-1.5 w-5/6 rounded-full bg-current opacity-70" />
                                        </span>
                                    )}
                                </span>
                                <span className="px-4 py-3">
                                    <span className="block truncate text-sm font-extrabold text-slate-800 dark:text-slate-100" title={resume.fileName}>
                                        {resume.fileName || "Resume"}
                                    </span>
                                    <span className="mt-0.5 block text-xs font-semibold text-slate-400 dark:text-slate-500">PDF</span>
                                </span>
                            </div>
                        );
                    })}

                    <button
                        type="button"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-[260px] w-[200px] shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-200 bg-white p-5 text-center transition-all hover:border-blue-400 hover:bg-blue-50/50 dark:border-blue-500/30 dark:bg-lc-surface dark:hover:bg-blue-500/10"
                    >
                        {uploadingResume ? (
                            <>
                                <span className="size-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                                <span className="mt-5 text-base font-extrabold text-slate-950 dark:text-white">Uploading...</span>
                            </>
                        ) : (
                            <>
                                <span className="flex size-14 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                                    <span className="material-symbols-outlined text-[32px]">cloud_upload</span>
                                </span>
                                <span className="mt-5 text-base font-extrabold text-slate-950 dark:text-white">Drop your resume</span>
                                <span className="mt-2 text-sm font-semibold leading-5 text-slate-500 dark:text-slate-400">{uploadDescription}</span>
                            </>
                        )}
                    </button>
                </div>
            )}
            {uploadError && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                    {uploadError}
                </div>
            )}
        </div>
    );

    const handleDeleteResume = async (resumeIdToDelete: string) => {
        setDeletingResumeId(resumeIdToDelete);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            const res = await fetch(`${getApiBaseUrl()}/resumes/${resumeIdToDelete}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Failed to delete resume");
            }

            setExistingResumes((prev) => prev.filter((resume) => resume.id !== resumeIdToDelete));
            setSignedUrls((prev) => {
                const next = { ...prev };
                delete next[resumeIdToDelete];
                return next;
            });
            if (resumeId === resumeIdToDelete) {
                setResumeId(null);
                setResumeAnalysis(null);
            }
            setDeleteConfirmId(null);
        } catch (err: any) {
            setUploadError(err.message || "Failed to delete resume");
        } finally {
            setDeletingResumeId(null);
        }
    };

    const buildModuleConfig = () => {
        if (!selectedType || selectedModules.length === 0) return undefined;
        if (selectedType === "resume_round") return undefined;
        const disabledStages = selectedModules
            .map((module) => module.stage)
            .filter((stage) => !enabledStageSet.has(stage));
        const defaultStages = selectedModules.map((module) => module.stage);
        const stageOptions: Record<string, any> = {};

        if (enabledStageSet.has("DSA") && dsaTopics.length > 0) {
            stageOptions.DSA = { topics: dsaTopics };
        }

        if (enabledStageSet.has("FUNDAMENTALS")) {
            stageOptions.FUNDAMENTALS = {
                topics: csTopics,
                includeSQL: includeSqlRound,
                questionCountPerTopic,
            };
        }

        if (enabledStageSet.has("GEN_AI_CONCEPTS") && genAIConcepts.length > 0) {
            stageOptions.GEN_AI_CONCEPTS = { subtopics: genAIConcepts };
        }

        if (enabledStageSet.has("DS_CONCEPTS") && dsConcepts.length > 0) {
            stageOptions.DS_CONCEPTS = { topics: dsConcepts };
        }

        return {
            version: 1,
            enabledStages: effectiveEnabledStages,
            disabledStages,
            source: JSON.stringify(effectiveEnabledStages) === JSON.stringify(defaultStages) && Object.keys(stageOptions).length === 0 ? "default" : "custom",
            stageOptions,
        };
    };

    const startInterview = async () => {
        if (!selectedType || !selectedTypeInfo) {
            router.replace("/interviews/ai");
            return;
        }

        if (selectedPracticeCount === 0) {
            setSessionError("Choose at least one module for this interview.");
            return;
        }

        if (enabledStageSet.has("FUNDAMENTALS") && csTopics.length === 0) {
            setSessionError("Choose at least one CS fundamentals topic, or disable the CS + SQL module.");
            return;
        }

        if (selectedType === "resume_round" && !resumeId) {
            setSessionError("Select or upload a resume before starting Resume Screening Interview.");
            return;
        }

        if (hasInsufficientCredits) {
            setSessionError(`${selectedTypeInfo?.label || "This interview"} needs ${estimatedMinutes} minute${estimatedMinutes === 1 ? "" : "s"}. You have ${walletTotal}.`);
            setUpgradeOpen(true);
            return;
        }

        setStarting(true);
        setSessionError(null);

        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            if (resumeModuleEnabled && resumeId && !resumeAnalysis) {
                setLoadingStatus("Analyzing your resume...");
                const analyzeRes = await fetchWithLimits(`${getApiBaseUrl()}/resumes/${resumeId}/analyze`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!analyzeRes.ok) {
                    const err = await analyzeRes.json().catch(() => ({}));
                    throw new Error(err.message || "Failed to analyze resume");
                }
                const analyzeResult = await analyzeRes.json();
                setResumeAnalysis(analyzeResult.analysis);
            }

            setLoadingStatus("Preparing your interview...");
            const session = await api.post<{ id: string }>(
                "/interviews",
                {
                    mode: "mock",
                    resumeId: resumeModuleEnabled ? resumeId || undefined : undefined,
                    type: selectedType,
                    difficulty: level,
                    level,
                    language: "Python",
                    moduleConfig: buildModuleConfig(),
                    estimatedMinutes,
                },
                token
            );

            setLoadingStatus("Launching interview room...");
            router.push(`/room/${session.id}`);
        } catch (err: any) {
            if (isFeatureLimitError(err)) {
                handleFeatureError(err, "interview_minutes");
            }
            setSessionError(err.message || "Failed to create session");
            setStarting(false);
            setLoadingStatus(null);
        }
    };

    const continueToWarmup = () => {
        if (!selectedType || !selectedTypeInfo) {
            router.replace("/interviews/ai");
            return;
        }

        if (selectedPracticeCount === 0) {
            setSessionError("Choose at least one module for this interview.");
            return;
        }

        if (enabledStageSet.has("FUNDAMENTALS") && csTopics.length === 0) {
            setSessionError("Choose at least one CS fundamentals topic, or disable the CS + SQL module.");
            return;
        }

        if (selectedType === "resume_round" && !resumeId) {
            setSessionError("Select or upload a resume before starting Resume Screening Interview.");
            return;
        }

        if (hasInsufficientCredits) {
            setSessionError(`${selectedTypeInfo?.label || "This interview"} needs ${estimatedMinutes} minute${estimatedMinutes === 1 ? "" : "s"}. You have ${walletTotal}.`);
            setUpgradeOpen(true);
            return;
        }

        const configKey = `interview-warmup-${Date.now()}`;
        const selectedSummaryModules = visibleSelectedModules.map((module) => ({
            stage: module.stage,
            label: module.label,
            minutes: module.minutes,
            icon: module.icon,
        }));

        window.sessionStorage.setItem(configKey, JSON.stringify({
            type: selectedType,
            typeLabel: selectedTypeInfo.label,
            resumeId,
            resumeModuleEnabled,
            hasResumeAnalysis: Boolean(resumeAnalysis),
            level,
            language: "Python",
            moduleConfig: buildModuleConfig(),
            modules: selectedSummaryModules,
            estimatedMinutes,
            selectedCost,
        }));

        const nextParams = new URLSearchParams({ type: selectedType, configKey });
        if (resumeId) nextParams.set("resumeId", resumeId);
        // problem_solving_case is a pass-through: this page only renders a spinner and
        // auto-redirects here. Use replace so it doesn't stay in history and bounce the
        // user forward again when they press back from warm-up.
        if (selectedType === "problem_solving_case") {
            router.replace(`/interviews/ai/warm-up?${nextParams.toString()}`);
        } else {
            router.push(`/interviews/ai/warm-up?${nextParams.toString()}`);
        }
    };

    useEffect(() => {
        if (selectedType !== "problem_solving_case") {
            problemSolvingWarmupStartedRef.current = false;
            return;
        }
        if (!simpleJourneyRestored || billingLoading || starting || !selectedTypeInfo || selectedPracticeCount === 0) return;
        if (problemSolvingWarmupStartedRef.current) return;

        const showWarning = hasInsufficientCredits;
        if (showWarning) return;

        problemSolvingWarmupStartedRef.current = true;
        continueToWarmup();
    }, [billingLoading, selectedPracticeCount, selectedType, selectedTypeInfo, simpleJourneyRestored, starting, hasInsufficientCredits]);

    const renderCsStepPill = (step: CsJourneyStep, label: string, index: number) => {
        const order: CsJourneyStep[] = ["resume", "focus", "sql", "settings"];
        const activeIndex = order.indexOf(csJourneyStep);
        const stepIndex = order.indexOf(step);
        const isActive = step === csJourneyStep && !csPreviewReady;
        const isDone = csPreviewReady || stepIndex < activeIndex;

        return (
            <button
                key={step}
                type="button"
                onClick={() => {
                    setCsPreviewReady(false);
                    setCsJourneyStep(step);
                }}
                className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                        ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm shadow-blue-600/10 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200"
                        : isDone
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                            : "border-slate-200 bg-white text-slate-500 dark:border-lc-border dark:bg-lc-surface dark:text-slate-400"
                }`}
            >
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isDone ? "bg-emerald-600 text-white" : isActive ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-lc-bg"
                }`}>
                    {index}
                </span>
                <span className="truncate text-xs font-bold sm:text-sm">{label}</span>
            </button>
        );
    };

    const renderCsResumeControls = () => renderResumePreviewControls({
        allowSkip: true,
        skipDescription: "Start with a clean CS Fundamentals round.",
        uploadDescription: "Drop your resume or click to browse. PDF up to 5MB.",
    });

    const renderCsFocusControls = () => (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
                {CS_TOPICS.map((topic) => {
                    const active = csTopics.includes(topic);
                    const disabled = active && csTopics.length <= 1;
                    const descriptions: Record<string, string> = {
                        DBMS: "Transactions, indexes, normalization, and SQL reasoning.",
                        OS: "Processes, memory, scheduling, and concurrency.",
                        CN: "HTTP, TCP/IP, DNS, latency, and network basics.",
                        OOPS: "Classes, inheritance, design principles, and patterns.",
                    };
                    return (
                        <TopicChoiceCard
                            key={topic}
                            title={topic}
                            description={descriptions[topic]}
                            selected={active}
                            disabled={disabled}
                            onClick={() => setCsTopics((prev) => toggleRequiredValue(prev, topic))}
                        />
                    );
                })}
            </div>
            <div className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <span className="block text-[15px] font-bold text-slate-900 dark:text-white">Questions per topic</span>
                <div className="mt-4">
                    <PopupSelect
                        ariaLabel="Questions per topic"
                        options={QUESTION_COUNT_OPTIONS}
                        value={questionCountPerTopic}
                        onChange={(value) => setQuestionCountPerTopic(Number(value))}
                    />
                </div>
            </div>
        </div>
    );

    const renderCsSqlControls = () => (
        <div className="space-y-3">
            <ChoiceCard
                title="Include SQL"
                description="Add a SQL reasoning pass to the CS Fundamentals session."
                selected={includeSqlRound}
                onClick={() => setIncludeSqlRound(true)}
            />
            <ChoiceCard
                title="Exclude SQL"
                description="Keep the session focused on core CS topics only."
                selected={!includeSqlRound}
                onClick={() => setIncludeSqlRound(false)}
            />
        </div>
    );

    const renderFullSqlControls = () => (
        <div className="space-y-3">
            <ChoiceCard
                title="Include SQL"
                description="Add SQL reasoning to the full interview."
                selected={includeSqlRound}
                onClick={() => setIncludeSqlRound(true)}
            />
            <ChoiceCard
                title="Exclude SQL"
                description="Keep the full interview focused on resume, coding, and CS fundamentals."
                selected={!includeSqlRound}
                onClick={() => setIncludeSqlRound(false)}
            />
        </div>
    );

    const renderCsSettingsControls = () => (
        <div className="space-y-3">
            {LEVEL_OPTIONS.map((option) => (
                <ChoiceCard
                    key={option.value}
                    title={option.label}
                    description={option.value === "Junior" ? "Foundational checks with gentle depth." : option.value === "Mid" ? "Balanced interview depth." : "Sharper follow-ups and senior-level trade-offs."}
                    selected={level === option.value}
                    onClick={() => setLevel(option.value)}
                />
            ))}
        </div>
    );

    const renderFullStepPill = (step: FullJourneyStep, label: string, index: number) => {
        const order: FullJourneyStep[] = ["resume", "modules", "coding", "cs", "sql", "settings"];
        const activeIndex = order.indexOf(fullJourneyStep);
        const stepIndex = order.indexOf(step);
        const isActive = step === fullJourneyStep && !fullPreviewReady;
        const isDone = fullPreviewReady || stepIndex < activeIndex;

        return (
            <button
                key={step}
                type="button"
                onClick={() => {
                    setFullPreviewReady(false);
                    setFullJourneyStep(step);
                }}
                className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                        ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm shadow-blue-600/10 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200"
                        : isDone
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                            : "border-slate-200 bg-white text-slate-500 dark:border-lc-border dark:bg-lc-surface dark:text-slate-400"
                }`}
            >
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isDone ? "bg-emerald-600 text-white" : isActive ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-lc-bg"
                }`}>
                    {index}
                </span>
                <span className="truncate text-xs font-bold sm:text-sm">{label}</span>
            </button>
        );
    };

    const renderFullModuleControls = () => (
        <div className="space-y-3">
            {moduleWarning && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                    {moduleWarning}
                </div>
            )}
            {visibleModules.map((module) => {
                const selected = enabledStageSet.has(module.stage);
                const disabled = isLockedStage(selectedType, module.stage);
                return (
                    <ChoiceCard
                        key={module.stage}
                        title={module.label}
                        description={module.description}
                        selected={selected}
                        disabled={disabled}
                        onClick={() => toggleStage(module.stage)}
                    />
                );
            })}
        </div>
    );

    const renderFullResumeControls = () => renderResumePreviewControls({
        allowSkip: true,
        skipDescription: "Run the SDE interview without a resume.",
        uploadDescription: "Drop your resume or click to browse. PDF up to 5MB.",
    });

    const renderFullCodingControls = () => (
        <div className="grid gap-3 sm:grid-cols-2">
            {DSA_TOPICS.map((topic) => (
                <ChoiceCard
                    key={topic}
                    title={topic}
                    description={DSA_TOPIC_DESCRIPTIONS[topic]}
                    selected={dsaTopics.includes(topic)}
                    compact
                    onClick={() => setDsaTopics((prev) => toggleValue(prev, topic))}
                />
            ))}
        </div>
    );

    const renderFullCsControls = () => (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
                {CS_TOPICS.map((topic) => {
                    const active = csTopics.includes(topic);
                    const disabled = active && csTopics.length <= 1;
                    const descriptions: Record<string, string> = {
                        DBMS: "Transactions, indexes, normalization, and SQL reasoning.",
                        OS: "Processes, memory, scheduling, and concurrency.",
                        CN: "HTTP, TCP/IP, DNS, latency, and network basics.",
                        OOPS: "Classes, inheritance, design principles, and patterns.",
                    };
                    return (
                        <TopicChoiceCard
                            key={topic}
                            title={topic}
                            description={descriptions[topic]}
                            selected={active}
                            disabled={disabled}
                            onClick={() => setCsTopics((prev) => toggleRequiredValue(prev, topic))}
                        />
                    );
                })}
            </div>
            <div className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <span className="block text-[15px] font-bold text-slate-900 dark:text-white">Questions per topic</span>
                <div className="mt-4">
                    <PopupSelect
                        ariaLabel="Questions per topic"
                        options={QUESTION_COUNT_OPTIONS}
                        value={questionCountPerTopic}
                        onChange={(value) => setQuestionCountPerTopic(Number(value))}
                    />
                </div>
            </div>
        </div>
    );

    const renderFullPreview = () => (
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-slate-100 dark:divide-lc-border">
            <ReviewField title="Resume" compact onEdit={() => setFullEditModal("resume")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {selectedResume ? selectedResume.fileName || "Selected resume" : "No resume selected"}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {selectedResume ? "This resume will be available during the interview." : "No resume will be used."}
                </p>
            </ReviewField>
            <ReviewField title="Modules" compact onEdit={() => setFullEditModal("modules")}>
                <div className="flex flex-wrap gap-2">
                    {visibleSelectedModules.map((module) => (
                        <span key={module.stage} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-lc-bg dark:text-slate-300">
                            {module.label}
                        </span>
                    ))}
                </div>
            </ReviewField>
            {fullHasCodingModule && (
                <ReviewField title="Coding Topics" compact onEdit={() => setFullEditModal("coding")}>
                    {dsaTopics.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {dsaTopics.map((topic) => (
                                <span key={topic} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                                    {topic}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Default coding coverage</p>
                    )}
                </ReviewField>
            )}
            {fullHasCsModule && (
                <>
                    <ReviewField title="CS Topics" compact onEdit={() => setFullEditModal("cs")}>
                        <div className="flex flex-wrap gap-2">
                            {csTopics.map((topic) => (
                                <span key={topic} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                                    {topic}
                                </span>
                            ))}
                        </div>
                        <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {questionCountPerTopic} question{questionCountPerTopic === 1 ? "" : "s"} per topic
                        </p>
                    </ReviewField>
                    <ReviewField title="SQL Round" compact onEdit={() => setFullEditModal("sql")}>
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                            {includeSqlRound ? "included" : "excluded"}
                        </p>
                    </ReviewField>
                </>
            )}
            <ReviewField title="Difficulty" compact onEdit={() => setFullEditModal("settings")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {LEVEL_OPTIONS.find((option) => option.value === level)?.label || level}
                </p>
            </ReviewField>
        </div>
    );

    const renderCodingStepPill = (step: CodingJourneyStep, label: string, index: number) => {
        const order: CodingJourneyStep[] = ["modules", "focus", "settings"];
        const activeIndex = order.indexOf(codingJourneyStep);
        const stepIndex = order.indexOf(step);
        const isActive = step === codingJourneyStep && !codingPreviewReady;
        const isDone = codingPreviewReady || stepIndex < activeIndex;

        return (
            <button
                key={step}
                type="button"
                onClick={() => {
                    setCodingPreviewReady(false);
                    setCodingJourneyStep(step);
                }}
                className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                        ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm shadow-blue-600/10 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200"
                        : isDone
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                            : "border-slate-200 bg-white text-slate-500 dark:border-lc-border dark:bg-lc-surface dark:text-slate-400"
                }`}
            >
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isDone ? "bg-emerald-600 text-white" : isActive ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-lc-bg"
                }`}>
                    {index}
                </span>
                <span className="truncate text-xs font-bold sm:text-sm">{label}</span>
            </button>
        );
    };

    const renderCodingModuleControls = () => (
        <div className="space-y-3">
            {visibleModules.map((module) => (
                <ChoiceCard
                    key={module.stage}
                    title={module.label}
                    description={module.description}
                    selected={enabledStageSet.has(module.stage)}
                    onClick={() => toggleStage(module.stage)}
                />
            ))}
        </div>
    );

    const renderCodingFocusControls = () => (
        <div className="grid gap-3 sm:grid-cols-2">
            {DSA_TOPICS.map((topic) => (
                <ChoiceCard
                    key={topic}
                    title={topic}
                    description={DSA_TOPIC_DESCRIPTIONS[topic]}
                    selected={dsaTopics.includes(topic)}
                    compact
                    onClick={() => setDsaTopics((prev) => toggleValue(prev, topic))}
                />
            ))}
        </div>
    );

    const renderCodingPreview = () => (
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-slate-100 dark:divide-lc-border">
            <ReviewField title="Module" compact>
                <div className="flex flex-wrap gap-2">
                    {visibleSelectedModules.map((module) => (
                        <span key={module.stage} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-lc-bg dark:text-slate-300">
                            {module.label}
                        </span>
                    ))}
                </div>
            </ReviewField>
            <ReviewField title="Question Focus" compact onEdit={() => setCodingEditModal("focus")}>
                {dsaTopics.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {dsaTopics.map((topic) => (
                            <span key={topic} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                                {topic}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Default coding coverage</p>
                )}
            </ReviewField>
            <ReviewField title="Difficulty" compact onEdit={() => setCodingEditModal("settings")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {LEVEL_OPTIONS.find((option) => option.value === level)?.label || level}
                </p>
            </ReviewField>
        </div>
    );

    const renderShortStepPill = (step: ShortJourneyStep, label: string, index: number) => {
        const shortType = isShortJourneyType(selectedType) ? selectedType : "system_design";
        const order = getShortJourneySteps(shortType);
        const activeIndex = order.indexOf(shortJourneyStep);
        const stepIndex = order.indexOf(step);
        const isActive = step === shortJourneyStep && !shortPreviewReady;
        const isDone = shortPreviewReady || stepIndex < activeIndex;

        return (
            <button
                key={step}
                type="button"
                onClick={() => {
                    setShortPreviewReady(false);
                    setShortJourneyStep(step);
                }}
                className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                        ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm shadow-blue-600/10 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200"
                        : isDone
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                            : "border-slate-200 bg-white text-slate-500 dark:border-lc-border dark:bg-lc-surface dark:text-slate-400"
                }`}
            >
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isDone ? "bg-emerald-600 text-white" : isActive ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-lc-bg"
                }`}>
                    {index}
                </span>
                <span className="truncate text-xs font-bold sm:text-sm">{label}</span>
            </button>
        );
    };

    const renderShortResumeControls = () => renderResumePreviewControls({
        allowSkip: true,
        skipDescription: "Run this interview without a resume.",
        uploadDescription: "Drop your resume or click to browse. PDF up to 5MB.",
    });

    const renderRequiredResumeControls = () => renderResumePreviewControls({
        allowSkip: false,
        uploadDescription: "Drop your resume or click to browse. PDF up to 5MB.",
    });

    const renderShortModuleControls = () => (
        <div className="space-y-3">
            {visibleModules.map((module) => (
                <ChoiceCard
                    key={module.stage}
                    title={module.label}
                    description={module.description}
                    selected={enabledStageSet.has(module.stage)}
                    onClick={() => toggleStage(module.stage)}
                />
            ))}
        </div>
    );

    const renderShortPreview = () => {
        const showDifficulty = selectedType === "system_design";

        return (
            <div className="flex min-h-0 flex-1 flex-col divide-y divide-slate-100 dark:divide-lc-border">
                <ReviewField title="Resume" compact onEdit={() => setShortEditModal("resume")}>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                        {selectedResume ? selectedResume.fileName || "Selected resume" : "No resume selected"}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {selectedResume ? "This resume will be available during the interview." : "No resume will be used."}
                    </p>
                </ReviewField>
                {isShortJourneyType(selectedType) && (
                    <ReviewField title="Module" compact>
                        <div className="flex flex-wrap gap-2">
                            {visibleSelectedModules.map((module) => (
                                <span key={module.stage} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-lc-bg dark:text-slate-300">
                                {module.label}
                                </span>
                            ))}
                        </div>
                    </ReviewField>
                )}
                {showDifficulty && (
                    <ReviewField title="Difficulty" compact onEdit={() => setShortEditModal("settings")}>
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                            {LEVEL_OPTIONS.find((option) => option.value === level)?.label || level}
                        </p>
                    </ReviewField>
                )}
            </div>
        );
    };

    const renderGenAiModuleControls = () => (
        <div className="space-y-3">
            {moduleWarning && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                    {moduleWarning}
                </div>
            )}
            {visibleModules.map((module) => {
                const selected = enabledStageSet.has(module.stage);
                const disabled = isLockedStage(selectedType, module.stage);
                return (
                    <ChoiceCard
                        key={module.stage}
                        title={module.label}
                        description={module.description}
                        selected={selected}
                        disabled={disabled}
                        onClick={() => toggleStage(module.stage)}
                    />
                );
            })}
        </div>
    );

    const renderGenAiQuestionControls = () => (
        <div className="grid gap-3 sm:grid-cols-2">
            {GENAI_SUBTOPICS.map((topic) => (
                <ChoiceCard
                    key={topic}
                    title={formatFocusLabel(topic)}
                    description={GENAI_SUBTOPIC_DESCRIPTIONS[topic]}
                    selected={genAIConcepts.includes(topic)}
                    compact
                    onClick={() => setGenAIConcepts((prev) => toggleValue(prev, topic))}
                />
            ))}
        </div>
    );

    const renderGenAiPreview = () => (
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-slate-100 dark:divide-lc-border">
            <ReviewField title="Resume" compact onEdit={() => setGenAiEditModal("resume")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {selectedResume ? selectedResume.fileName || "Selected resume" : "No resume selected"}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {selectedResume ? "This resume will be available during the interview." : "No resume will be used."}
                </p>
            </ReviewField>
            <ReviewField title="Modules" compact onEdit={() => setGenAiEditModal("modules")}>
                <div className="flex flex-wrap gap-2">
                    {visibleSelectedModules.map((module) => (
                        <span key={module.stage} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-lc-bg dark:text-slate-300">
                            {module.label}
                        </span>
                    ))}
                </div>
            </ReviewField>
            {genAiHasQuestionModule && (
                <ReviewField title="Question Focus" compact onEdit={() => setGenAiEditModal("question")}>
                    {genAIConcepts.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {genAIConcepts.map((topic) => (
                                <span key={topic} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                                    {formatFocusLabel(topic)}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Default GenAI coverage</p>
                    )}
                </ReviewField>
            )}
            <ReviewField title="Difficulty" compact onEdit={() => setGenAiEditModal("settings")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {LEVEL_OPTIONS.find((option) => option.value === level)?.label || level}
                </p>
            </ReviewField>
        </div>
    );

    const renderRoleModuleControls = () => (
        <div className="space-y-3">
            {moduleWarning && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                    {moduleWarning}
                </div>
            )}
            {visibleModules.map((module) => {
                const selected = enabledStageSet.has(module.stage);
                const disabled = isLockedStage(selectedType, module.stage);
                return (
                    <ChoiceCard
                        key={module.stage}
                        title={module.label}
                        description={module.description}
                        selected={selected}
                        disabled={disabled}
                        onClick={() => toggleStage(module.stage)}
                    />
                );
            })}
        </div>
    );

    const renderRoleQuestionControls = () => (
        <div className="grid gap-3 sm:grid-cols-2">
            {DS_CONCEPT_CATEGORIES.map((topic) => (
                <ChoiceCard
                    key={topic}
                    title={formatDSConceptLabel(topic)}
                    description={DS_CONCEPT_DESCRIPTIONS[topic]}
                    selected={dsConcepts.includes(topic)}
                    compact
                    onClick={() => setDsConcepts((prev) => toggleValue(prev, topic))}
                />
            ))}
        </div>
    );

    const renderRolePreview = () => (
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-slate-100 dark:divide-lc-border">
            <ReviewField title="Resume" compact onEdit={() => setRoleEditModal("resume")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {selectedResume ? selectedResume.fileName || "Selected resume" : "No resume selected"}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {selectedResume ? "This resume will be available during the interview." : "No resume will be used."}
                </p>
            </ReviewField>
            <ReviewField title="Modules" compact onEdit={() => setRoleEditModal("modules")}>
                <div className="flex flex-wrap gap-2">
                    {visibleSelectedModules.map((module) => (
                        <span key={module.stage} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-lc-bg dark:text-slate-300">
                            {module.label}
                        </span>
                    ))}
                </div>
            </ReviewField>
            {roleHasQuestionModule && (
                <ReviewField title="Question Focus" compact onEdit={() => setRoleEditModal("question")}>
                    {dsConcepts.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {dsConcepts.map((topic) => (
                                <span key={topic} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                                    {formatDSConceptLabel(topic)}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Default data science coverage</p>
                    )}
                </ReviewField>
            )}
            <ReviewField title="Difficulty" compact onEdit={() => setRoleEditModal("settings")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {LEVEL_OPTIONS.find((option) => option.value === level)?.label || level}
                </p>
            </ReviewField>
        </div>
    );

    const renderSimpleModuleControls = () => (
        <div className="space-y-3">
            {visibleModules.map((module) => {
                const selected = enabledStageSet.has(module.stage);
                const disabled = selectedType === "problem_solving_case" || isLockedStage(selectedType, module.stage);
                return (
                    <ChoiceCard
                        key={module.stage}
                        title={module.label}
                        description={module.description}
                        selected={selected}
                        disabled={disabled}
                        onClick={() => toggleStage(module.stage)}
                    />
                );
            })}
        </div>
    );

    const renderSimplePreview = () => (
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-slate-100 dark:divide-lc-border">
            {selectedType === "resume_round" && (
                <ReviewField title="Resume" compact onEdit={() => setSimpleEditModal("resume")}>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                        {selectedResume ? selectedResume.fileName || "Selected resume" : "No resume selected"}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        Resume Screening requires a resume before the interview can begin.
                    </p>
                </ReviewField>
            )}
            <ReviewField title={selectedType === "resume_round" ? "Sections" : "Module"} compact>
                <div className="flex flex-wrap gap-2">
                    {visibleSelectedModules.map((module) => (
                        <span key={module.stage} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-lc-bg dark:text-slate-300">
                            {module.label}
                        </span>
                    ))}
                </div>
            </ReviewField>
        </div>
    );

    const renderCsPreview = () => (
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-slate-100 dark:divide-lc-border">
            <ReviewField title="Resume" onEdit={() => setCsEditModal("resume")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {selectedResume ? selectedResume.fileName || "Selected resume" : "No resume selected"}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {selectedResume ? "This resume will be available during warm-up." : "No resume will be used for this CS session."}
                </p>
            </ReviewField>
            <ReviewField title="Question Focus" onEdit={() => setCsEditModal("focus")}>
                <div className="flex flex-wrap gap-2">
                    {csTopics.map((topic) => (
                        <span key={topic} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                            {topic}
                        </span>
                    ))}
                </div>
                <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {questionCountPerTopic} question{questionCountPerTopic === 1 ? "" : "s"} per topic
                </p>
            </ReviewField>
            <ReviewField title="SQL Round" onEdit={() => setCsEditModal("sql")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {includeSqlRound ? "included" : "excluded"}
                </p>
            </ReviewField>
            <ReviewField title="Difficulty" onEdit={() => setCsEditModal("settings")}>
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                    {LEVEL_OPTIONS.find((option) => option.value === level)?.label || level}
                </p>
            </ReviewField>
        </div>
    );

    const resetCsJourneyAndReturn = () => {
        if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(CS_JOURNEY_STORAGE_KEY);
        }
        setCsPreviewReady(false);
        setCsJourneyStep("resume");
        setCsEditModal(null);
        setResumeId(null);
        setResumeAnalysis(null);
        setCsTopics(CS_TOPICS);
        setIncludeSqlRound(true);
        setQuestionCountPerTopic(2);
        setLevel("Mid");
        setSessionError(null);
        setUploadError(null);
        router.push("/interviews/ai");
    };

    const goBackInCsJourney = () => {
        if (csPreviewReady) {
            resetCsJourneyAndReturn();
            return;
        }
        if (csJourneyStep === "resume") {
            resetCsJourneyAndReturn();
            return;
        }
        if (csJourneyStep === "focus") {
            setCsJourneyStep("resume");
            return;
        }
        if (csJourneyStep === "sql") {
            setCsJourneyStep("focus");
            return;
        }
        setCsJourneyStep("sql");
    };

    const goForwardInCsJourney = () => {
        setSessionError(null);
        if (csPreviewReady) {
            if (hasInsufficientCredits) {
                setUpgradeOpen(true);
                return;
            }
            continueToWarmup();
            return;
        }
        if (csJourneyStep === "resume") {
            setCsJourneyStep("focus");
            return;
        }
        if (csJourneyStep === "focus") {
            setCsJourneyStep("sql");
            return;
        }
        if (csJourneyStep === "sql") {
            setCsJourneyStep("settings");
            return;
        }
        setCsPreviewReady(true);
    };

    const csPrimaryActionLabel = csPreviewReady
        ? hasInsufficientCredits ? "Buy minutes" : "Start"
        : csJourneyStep === "settings" ? "Review" : "Next";

    const resetFullJourneyAndReturn = () => {
        if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(FULL_JOURNEY_STORAGE_KEY);
        }
        setFullPreviewReady(false);
        setFullJourneyStep("resume");
        setFullEditModal(null);
        setResumeId(null);
        setResumeAnalysis(null);
        setEnabledStages((MODULE_OPTIONS.full_interview || []).map((module) => module.stage));
        setDsaTopics([]);
        setCsTopics(CS_TOPICS);
        setIncludeSqlRound(true);
        setQuestionCountPerTopic(2);
        setLevel("Mid");
        setSessionError(null);
        setUploadError(null);
        router.push("/interviews/ai");
    };

    const goBackInFullJourney = () => {
        if (fullPreviewReady) {
            resetFullJourneyAndReturn();
            return;
        }
        if (fullJourneyStep === "resume") {
            resetFullJourneyAndReturn();
            return;
        }
        if (fullJourneyStep === "modules") {
            setFullJourneyStep("resume");
            return;
        }
        if (fullJourneyStep === "coding") {
            setFullJourneyStep("modules");
            return;
        }
        if (fullJourneyStep === "cs") {
            setFullJourneyStep(fullHasCodingModule ? "coding" : "modules");
            return;
        }
        if (fullJourneyStep === "sql") {
            setFullJourneyStep("cs");
            return;
        }
        if (fullHasCsModule) {
            setFullJourneyStep("sql");
            return;
        }
        setFullJourneyStep(fullHasCodingModule ? "coding" : "modules");
    };

    const goForwardInFullJourney = () => {
        setSessionError(null);
        if (fullPreviewReady) {
            if (hasInsufficientCredits) {
                setUpgradeOpen(true);
                return;
            }
            continueToWarmup();
            return;
        }
        if (fullJourneyStep === "resume") {
            setFullJourneyStep("modules");
            return;
        }
        if (fullJourneyStep === "modules") {
            if (selectedPracticeCount === 0) {
                setSessionError("Choose at least one module for this interview.");
                return;
            }
            if (fullHasCodingModule) {
                setFullJourneyStep("coding");
                return;
            }
            if (fullHasCsModule) {
                setFullJourneyStep("cs");
                return;
            }
            setFullJourneyStep("settings");
            return;
        }
        if (fullJourneyStep === "coding") {
            setFullJourneyStep(fullHasCsModule ? "cs" : "settings");
            return;
        }
        if (fullJourneyStep === "cs") {
            setFullJourneyStep("sql");
            return;
        }
        if (fullJourneyStep === "sql") {
            setFullJourneyStep("settings");
            return;
        }
        if (selectedPracticeCount === 0) {
            setSessionError("Choose at least one module for this interview.");
            return;
        }
        setFullPreviewReady(true);
    };

    const fullPrimaryActionLabel = fullPreviewReady
        ? hasInsufficientCredits ? "Buy minutes" : "Start"
        : fullJourneyStep === "settings" ? "Review" : "Next";

    const saveFullEditModal = () => {
        if (fullEditModal === "modules") {
            if (fullHasCodingModule) {
                setFullEditModal("coding");
                return;
            }
            if (fullHasCsModule) {
                setFullEditModal("cs");
                return;
            }
        }
        if (fullEditModal === "coding" && fullHasCsModule) {
            setFullEditModal("cs");
            return;
        }
        if (fullEditModal === "cs" && fullHasCsModule) {
            setFullEditModal("sql");
            return;
        }
        setFullEditModal(null);
    };

    const resetCodingJourneyAndReturn = () => {
        if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(CODING_JOURNEY_STORAGE_KEY);
        }
        setCodingPreviewReady(false);
        setCodingJourneyStep("focus");
        setCodingEditModal(null);
        setEnabledStages((MODULE_OPTIONS.coding || []).map((module) => module.stage));
        setDsaTopics([]);
        setLevel("Mid");
        setSessionError(null);
        router.push("/interviews/ai");
    };

    const goBackInCodingJourney = () => {
        if (codingPreviewReady) {
            resetCodingJourneyAndReturn();
            return;
        }
        if (codingJourneyStep === "focus") {
            resetCodingJourneyAndReturn();
            return;
        }
        setCodingJourneyStep("focus");
    };

    const goForwardInCodingJourney = () => {
        setSessionError(null);
        if (codingPreviewReady) {
            if (hasInsufficientCredits) {
                setUpgradeOpen(true);
                return;
            }
            continueToWarmup();
            return;
        }
        if (codingJourneyStep === "focus") {
            setCodingJourneyStep("settings");
            return;
        }
        setCodingPreviewReady(true);
    };

    const codingPrimaryActionLabel = codingPreviewReady
        ? hasInsufficientCredits ? "Buy minutes" : "Start"
        : codingJourneyStep === "settings" ? "Review" : "Next";

    const resetShortJourneyAndReturn = () => {
        if (isShortJourneyType(selectedType) && typeof window !== "undefined") {
            window.sessionStorage.removeItem(getShortJourneyStorageKey(selectedType));
        }
        setShortPreviewReady(false);
        setShortJourneyStep("resume");
        setShortEditModal(null);
        setResumeId(null);
        setResumeAnalysis(null);
        if (isShortJourneyType(selectedType)) {
            setEnabledStages((MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
        }
        setLevel("Mid");
        setSessionError(null);
        setUploadError(null);
        router.push("/interviews/ai");
    };

    const goBackInShortJourney = () => {
        if (shortPreviewReady) {
            resetShortJourneyAndReturn();
            return;
        }
        if (shortJourneyStep === "resume") {
            resetShortJourneyAndReturn();
            return;
        }
        setShortJourneyStep("resume");
    };

    const goForwardInShortJourney = () => {
        setSessionError(null);
        if (shortPreviewReady) {
            if (hasInsufficientCredits) {
                setUpgradeOpen(true);
                return;
            }
            continueToWarmup();
            return;
        }
        if (shortJourneyStep === "resume") {
            if (selectedType === "system_design") {
                setShortJourneyStep("settings");
                return;
            }
            setShortPreviewReady(true);
            return;
        }
        setShortPreviewReady(true);
    };

    const shortPrimaryActionLabel = shortPreviewReady
        ? hasInsufficientCredits ? "Buy minutes" : "Start"
        : shortJourneyStep === "settings" || selectedType === "behavioural" && shortJourneyStep === "resume" ? "Review" : "Next";

    const resetGenAiJourneyAndReturn = () => {
        if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(GEN_AI_JOURNEY_STORAGE_KEY);
        }
        setGenAiPreviewReady(false);
        setGenAiJourneyStep("resume");
        setGenAiEditModal(null);
        setResumeId(null);
        setResumeAnalysis(null);
        setEnabledStages((MODULE_OPTIONS.gen_ai_role || []).map((module) => module.stage));
        setGenAIConcepts([]);
        setLevel("Mid");
        setSessionError(null);
        setUploadError(null);
        router.push("/interviews/ai");
    };

    const goBackInGenAiJourney = () => {
        if (genAiPreviewReady) {
            resetGenAiJourneyAndReturn();
            return;
        }
        if (genAiJourneyStep === "resume") {
            resetGenAiJourneyAndReturn();
            return;
        }
        if (genAiJourneyStep === "modules") {
            setGenAiJourneyStep("resume");
            return;
        }
        if (genAiJourneyStep === "question") {
            setGenAiJourneyStep("modules");
            return;
        }
        setGenAiJourneyStep(genAiHasQuestionModule ? "question" : "modules");
    };

    const goForwardInGenAiJourney = () => {
        setSessionError(null);
        if (genAiPreviewReady) {
            if (hasInsufficientCredits) {
                setUpgradeOpen(true);
                return;
            }
            continueToWarmup();
            return;
        }
        if (genAiJourneyStep === "resume") {
            setGenAiJourneyStep("modules");
            return;
        }
        if (genAiJourneyStep === "modules") {
            if (selectedPracticeCount === 0) {
                setSessionError("Choose at least one module for this interview.");
                return;
            }
            setGenAiJourneyStep(genAiHasQuestionModule ? "question" : "settings");
            return;
        }
        if (genAiJourneyStep === "question") {
            setGenAiJourneyStep("settings");
            return;
        }
        if (selectedPracticeCount === 0) {
            setSessionError("Choose at least one module for this interview.");
            return;
        }
        setGenAiPreviewReady(true);
    };

    const genAiPrimaryActionLabel = genAiPreviewReady
        ? hasInsufficientCredits ? "Buy minutes" : "Start"
        : genAiJourneyStep === "settings" ? "Review" : "Next";

    const saveGenAiEditModal = () => {
        if (genAiEditModal === "modules" && genAiHasQuestionModule) {
            setGenAiEditModal("question");
            return;
        }
        setGenAiEditModal(null);
    };

    const resetRoleJourneyAndReturn = () => {
        if (isRoleJourneyType(selectedType) && typeof window !== "undefined") {
            window.sessionStorage.removeItem(getRoleJourneyStorageKey(selectedType));
        }
        setRolePreviewReady(false);
        setRoleJourneyStep("resume");
        setRoleEditModal(null);
        setResumeId(null);
        setResumeAnalysis(null);
        if (isRoleJourneyType(selectedType)) {
            setEnabledStages((MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
        }
        setDsConcepts([]);
        setLevel("Mid");
        setSessionError(null);
        setUploadError(null);
        router.push("/interviews/ai");
    };

    const goBackInRoleJourney = () => {
        if (rolePreviewReady) {
            resetRoleJourneyAndReturn();
            return;
        }
        if (roleJourneyStep === "resume") {
            resetRoleJourneyAndReturn();
            return;
        }
        if (roleJourneyStep === "modules") {
            setRoleJourneyStep("resume");
            return;
        }
        if (roleJourneyStep === "question") {
            setRoleJourneyStep("modules");
            return;
        }
        setRoleJourneyStep(roleHasQuestionModule ? "question" : "modules");
    };

    const goForwardInRoleJourney = () => {
        setSessionError(null);
        if (rolePreviewReady) {
            if (hasInsufficientCredits) {
                setUpgradeOpen(true);
                return;
            }
            continueToWarmup();
            return;
        }
        if (roleJourneyStep === "resume") {
            setRoleJourneyStep("modules");
            return;
        }
        if (roleJourneyStep === "modules") {
            if (selectedPracticeCount === 0) {
                setSessionError("Choose at least one module for this interview.");
                return;
            }
            setRoleJourneyStep(roleHasQuestionModule ? "question" : "settings");
            return;
        }
        if (roleJourneyStep === "question") {
            setRoleJourneyStep("settings");
            return;
        }
        if (selectedPracticeCount === 0) {
            setSessionError("Choose at least one module for this interview.");
            return;
        }
        setRolePreviewReady(true);
    };

    const rolePrimaryActionLabel = rolePreviewReady
        ? hasInsufficientCredits ? "Buy minutes" : "Start"
        : roleJourneyStep === "settings" ? "Review" : "Next";

    const saveRoleEditModal = () => {
        if (roleEditModal === "modules" && roleHasQuestionModule) {
            setRoleEditModal("question");
            return;
        }
        setRoleEditModal(null);
    };

    const resetSimpleJourneyAndReturn = () => {
        if (isSimpleJourneyType(selectedType) && typeof window !== "undefined") {
            window.sessionStorage.removeItem(getSimpleJourneyStorageKey(selectedType));
        }
        setSimplePreviewReady(false);
        setSimpleJourneyStep(isSimpleJourneyType(selectedType) ? getSimpleJourneySteps(selectedType)[0] : "modules");
        setSimpleEditModal(null);
        setResumeId(null);
        setResumeAnalysis(null);
        if (isSimpleJourneyType(selectedType)) {
            setEnabledStages((MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
        }
        setSessionError(null);
        setUploadError(null);
        router.push("/interviews/ai");
    };

    const goBackInSimpleJourney = () => {
        if (simplePreviewReady) {
            resetSimpleJourneyAndReturn();
            return;
        }
        if (simpleJourneyStep === "resume") {
            resetSimpleJourneyAndReturn();
            return;
        }
        if (selectedType === "resume_round") {
            setSimpleJourneyStep("resume");
            return;
        }
        resetSimpleJourneyAndReturn();
    };

    const goForwardInSimpleJourney = () => {
        setSessionError(null);
        if (simplePreviewReady) {
            if (hasInsufficientCredits) {
                setUpgradeOpen(true);
                return;
            }
            continueToWarmup();
            return;
        }
        if (simpleJourneyStep === "resume") {
            if (selectedType === "resume_round" && !resumeId) {
                setSessionError("Select or upload a resume before continuing.");
                return;
            }
            // Resume Screening sections are fixed (all on) — skip the section
            // picker step and go straight to the review screen.
            if (selectedType === "resume_round") {
                setEnabledStages((MODULE_OPTIONS.resume_round || []).map((module) => module.stage));
                setSimplePreviewReady(true);
                return;
            }
            setSimpleJourneyStep("modules");
            return;
        }
        if (selectedType === "resume_round" && !resumeId) {
            setSessionError("Select or upload a resume before starting Resume Screening Interview.");
            return;
        }
        if (visibleSelectedModules.length === 0) {
            setSessionError(selectedType === "resume_round" ? "Choose at least one resume section." : "Choose at least one module for this interview.");
            return;
        }
        if (selectedType === "problem_solving_case") {
            if (hasInsufficientCredits) {
                setUpgradeOpen(true);
                return;
            }
            continueToWarmup();
            return;
        }
        setSimplePreviewReady(true);
    };

    const simplePrimaryActionLabel = simplePreviewReady
        ? hasInsufficientCredits ? "Buy minutes" : "Start"
        : selectedType === "problem_solving_case" ? hasInsufficientCredits ? "Buy minutes" : "Continue to mic check" : simpleJourneyStep === "modules" ? "Review" : "Next";

    const renderReviewPage = ({
        preview,
        onBack,
        onBegin,
        beginDisabled,
    }: {
        preview: ReactNode;
        onBack: () => void;
        onBegin: () => void;
        beginDisabled: boolean;
    }) => {
        const showWarning = hasInsufficientCredits;
        if (showWarning) {
            return (
                <main className="flex h-full min-h-0 w-full flex-col items-center justify-center bg-[#fbfcff] px-6 py-12 dark:bg-lc-bg animate-in fade-in duration-200">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex flex-col items-center text-center">
                            <span className="flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-500 dark:bg-amber-500/10">
                                <span className="material-symbols-outlined text-[32px]">warning</span>
                            </span>
                            <h3 className="mt-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                Insufficient minutes
                            </h3>
                            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                You need at least <span className="font-bold text-slate-900 dark:text-white">{estimatedMinutes} minutes</span> to start this session. You currently have <span className="font-bold text-slate-900 dark:text-white">{walletTotal} minutes</span> remaining.
                            </p>
                            
                            <div className="mt-8 flex w-full flex-col gap-3">
                                <Link
                                    href="/settings/billing"
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700"
                                >
                                    <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
                                    Buy Now
                                </Link>
                                <button
                                    onClick={onBack}
                                    className="flex w-full items-center justify-center rounded-xl border border-slate-200 px-5 py-3.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-bg"
                                >
                                    Go Back
                                </button>
                            </div>
                        </div>
                    </div>
                </main>
            );
        }

        return (
            <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#fbfcff] dark:bg-lc-bg">
            <div className="mx-auto flex min-h-0 w-full max-w-[960px] flex-1 flex-col gap-5 overflow-hidden px-6 pt-8 lg:px-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <button
                            type="button"
                            onClick={onBack}
                            className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-300"
                            aria-label="Back"
                        >
                            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
                        </button>
                        <h2 className="text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white font-nunito">
                            Review your session
                        </h2>
                    </div>
                    {!billingLoading && snapshot && (
                        <Link
                            href="/settings/billing"
                            className="group flex items-center gap-2.5 text-slate-700 transition-colors hover:text-primary dark:text-slate-200 dark:hover:text-primary"
                            title="Interview minutes remaining - click to manage"
                        >
                            <ClockIcon size={24} className="transition-transform group-hover:rotate-12" />
                            <span className="text-[18px] font-bold tabular-nums">
                                {walletTotal}
                            </span>
                            <span className="text-[15px] font-semibold text-slate-500 transition-colors group-hover:text-primary/80 dark:text-slate-400">
                                mins left
                            </span>
                        </Link>
                    )}
                </div>

                <section className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg bg-white px-5 py-4 shadow-md shadow-slate-200/70 ring-1 ring-slate-200/70 dark:bg-lc-surface dark:shadow-black/20 dark:ring-lc-border">
                        <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Interview Type</p>
                        <p className="mt-2 text-sm font-extrabold text-blue-600 dark:text-blue-300">{selectedTypeInfo?.label ?? "Interview"}</p>
                    </div>
                    <div className="rounded-lg bg-white px-5 py-4 shadow-md shadow-slate-200/70 ring-1 ring-slate-200/70 dark:bg-lc-surface dark:shadow-black/20 dark:ring-lc-border">
                        <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Estimated Time</p>
                        <p className="mt-2 text-sm font-extrabold text-blue-600 dark:text-blue-300">{estimatedMinutes} min</p>
                    </div>
                    <div className="rounded-lg bg-white px-5 py-4 shadow-md shadow-slate-200/70 ring-1 ring-slate-200/70 dark:bg-lc-surface dark:shadow-black/20 dark:ring-lc-border">
                        <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Session Load</p>
                        <p className="mt-2 text-sm font-extrabold text-blue-600 dark:text-blue-300">
                            {selectedPracticeCount} {isResumeScreening ? `section${selectedPracticeCount === 1 ? "" : "s"}` : `module${selectedPracticeCount === 1 ? "" : "s"}`}
                        </p>
                    </div>
                </section>

                <section className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto pr-2 divide-y divide-slate-200 dark:divide-lc-border">
                        {preview}
                    </div>
                </section>

                {sessionError && (
                    <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                        {sessionError}
                    </div>
                )}

            </div>

            <div className="shrink-0 border-t border-slate-200 bg-slate-100/80 px-6 py-2.5 shadow-[0_-8px_20px_rgba(15,23,42,0.035)] dark:border-lc-border dark:bg-lc-surface/90 lg:px-8">
                <div className="mx-auto flex max-w-[960px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <span className="material-symbols-outlined text-[16px] text-slate-400">info</span>
                        You can still change these settings before starting.
                    </p>
                    <button
                        type="button"
                        onClick={onBegin}
                        disabled={beginDisabled}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Begin interview
                        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </button>
                </div>
            </div>
        </main>
    );
};

    if (!selectedType || !selectedTypeInfo) {
        return (
            <div className="flex-1 overflow-auto">
                <PageHeader showBack titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Customize Interview</h1>} />
                <main className="mx-auto flex w-full max-w-[900px] flex-col items-start gap-4 px-6 py-12">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Choose an interview type first</h2>
                    <p className="text-slate-500 dark:text-slate-400">The customization page opens after selecting an interview type.</p>
                    <button
                        onClick={() => router.replace("/interviews/ai")}
                        className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
                    >
                        Back to setup
                    </button>
                </main>
            </div>
        );
    }

    if ((isCsFundamentals && !csJourneyRestored) || (isFullInterview && !fullJourneyRestored) || (isCodingInterview && !codingJourneyRestored) || (isGenAiInterview && !genAiJourneyRestored) || (isRoleJourneyInterview && !roleJourneyRestored) || (isSimpleJourneyInterview && !simpleJourneyRestored) || (isShortJourneyInterview && !shortJourneyRestored)) {
        return (
            <div className="flex-1 bg-slate-50 dark:bg-lc-bg" />
        );
    }

    if (selectedType === "problem_solving_case") {
        const showWarning = hasInsufficientCredits;
        if (showWarning) {
            return (
                <div className="flex flex-1 items-center justify-center bg-slate-50 px-6 py-12 dark:bg-lc-bg animate-in fade-in duration-200">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex flex-col items-center text-center">
                            <span className="flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-500 dark:bg-amber-500/10">
                                <span className="material-symbols-outlined text-[32px]">warning</span>
                            </span>
                            <h3 className="mt-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                Insufficient minutes
                            </h3>
                            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                You need at least <span className="font-bold text-slate-900 dark:text-white">25 minutes</span> to start this session. You currently have <span className="font-bold text-slate-900 dark:text-white">{walletTotal} minutes</span> remaining.
                            </p>
                            
                            <div className="mt-8 flex w-full flex-col gap-3">
                                <Link
                                    href="/settings/billing"
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700"
                                >
                                    <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
                                    Buy Now
                                </Link>
                                <button
                                    onClick={() => router.replace("/interviews/ai")}
                                    className="flex w-full items-center justify-center rounded-xl border border-slate-200 px-5 py-3.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-bg"
                                >
                                    Back to setup
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex-1 overflow-auto bg-slate-50 dark:bg-lc-bg">
                <UpgradeModal
                    open={upgradeOpen}
                    onClose={() => setUpgradeOpen(false)}
                    feature="interview_minutes"
                    reason="minutes"
                    currentPlan={snapshot?.plan}
                    currentSubscriptionId={snapshot?.subscriptionId ?? undefined}
                    showMinutePacks
                    description={`${selectedTypeInfo.label} needs 25 minutes. You have ${walletTotal}.`}
                />
                <main className="flex min-h-full items-center justify-center px-6 py-16">
                    <div className="flex flex-col items-center gap-5 text-center">
                        <div className="relative">
                            <div className="size-14 rounded-full border-[3px] border-slate-200 dark:border-lc-border" />
                            <div className="absolute inset-0 size-14 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" />
                        </div>
                        <div>
                            <h1 className="text-xl font-extrabold text-slate-950 dark:text-white font-nunito">Opening ready check</h1>
                            <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                Taking you straight to the 25 min Problem Solving interview setup.
                            </p>
                        </div>
                    </div>
                </main>
                <FeatureLimitModal />
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto">
            {starting && (
                <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-white dark:bg-lc-bg">
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative">
                            <div className="size-16 rounded-full border-[3px] border-slate-200 dark:border-lc-border" />
                            <div className="absolute inset-0 size-16 animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
                        </div>
                        <div className="space-y-2 text-center">
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight">Setting up your interview</h2>
                            <p className="text-sm text-slate-500 animate-pulse">{loadingStatus || "Getting ready..."}</p>
                        </div>
                    </div>
                </div>
            )}

            <UpgradeModal
                open={upgradeOpen}
                onClose={() => setUpgradeOpen(false)}
                feature="interview_minutes"
                reason="minutes"
                currentPlan={snapshot?.plan}
                currentSubscriptionId={snapshot?.subscriptionId ?? undefined}
                showMinutePacks
                description={`${selectedTypeInfo.label} needs ${estimatedMinutes} minute${estimatedMinutes === 1 ? "" : "s"}. You have ${walletTotal}.`}
            />

            {!isCsFundamentals && !isFullInterview && !isCodingInterview && !isGenAiInterview && !isRoleJourneyInterview && !isSimpleJourneyInterview && !isShortJourneyInterview && (
                <PageHeader showBack titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Customize Interview</h1>} />
            )}

            {isCsFundamentals && csPreviewReady ? renderReviewPage({
                preview: renderCsPreview(),
                onBack: goBackInCsJourney,
                onBegin: goForwardInCsJourney,
                beginDisabled: starting || billingLoading || selectedPracticeCount === 0,
            }) : isCsFundamentals ? (
                <main className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm dark:bg-black/55 sm:p-6" onClick={() => router.push("/interviews/ai")}>
                    <section className="flex h-[calc(100vh-24px)] max-h-[540px] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-lc-border dark:bg-lc-surface sm:h-[calc(100vh-48px)]" onClick={(event) => event.stopPropagation()}>
                        <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                            <h2 className="text-lg font-extrabold text-slate-950 dark:text-white font-nunito">Interview Setup</h2>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                {estimatedMinutes} min
                            </span>
                        </div>

                        <div className={`min-h-0 flex-1 px-7 py-6 ${csJourneyStep === "resume" ? "overflow-hidden" : "overflow-y-auto"}`}>
                            <h3 className="mb-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                {csJourneyStep === "resume"
                                        ? "Choose resume"
                                        : csJourneyStep === "focus"
                                            ? "Choose CS topics"
                                            : csJourneyStep === "sql"
                                                ? "Include SQL round?"
                                                : "Choose difficulty"}
                            </h3>
                            <div>
                                {csJourneyStep === "resume" && (
                                    <>
                                        {renderCsResumeControls()}
                                    </>
                                )}
                                {csJourneyStep === "focus" && (
                                    <>
                                        {renderCsFocusControls()}
                                    </>
                                )}
                                {csJourneyStep === "settings" && (
                                    <>
                                        {renderCsSettingsControls()}
                                    </>
                                )}
                                {csJourneyStep === "sql" && (
                                    <>
                                        {renderCsSqlControls()}
                                    </>
                                )}

                                {sessionError && (
                                    <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                        {sessionError}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                            <button
                                type="button"
                                onClick={goBackInCsJourney}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-bg"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={goForwardInCsJourney}
                                disabled={starting || billingLoading || selectedPracticeCount === 0}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {csPrimaryActionLabel}
                            </button>
                        </div>
                    </section>
                </main>
            ) : isFullInterview && fullPreviewReady ? renderReviewPage({
                preview: renderFullPreview(),
                onBack: goBackInFullJourney,
                onBegin: goForwardInFullJourney,
                beginDisabled: starting || billingLoading || selectedPracticeCount === 0,
            }) : isFullInterview ? (
                <main className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm dark:bg-black/55 sm:p-6" onClick={() => router.push("/interviews/ai")}>
                    <section className="flex h-[calc(100vh-24px)] max-h-[540px] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-lc-border dark:bg-lc-surface sm:h-[calc(100vh-48px)]" onClick={(event) => event.stopPropagation()}>
                        <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                            <h2 className="text-lg font-extrabold text-slate-950 dark:text-white font-nunito">Interview Setup</h2>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                {estimatedMinutes} min
                            </span>
                        </div>

                        <div className={`min-h-0 flex-1 px-7 py-6 ${fullJourneyStep === "resume" ? "overflow-hidden" : "overflow-y-auto"}`}>
                            <h3 className="mb-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                {fullJourneyStep === "resume"
                                    ? "Choose resume"
                                    : fullJourneyStep === "modules"
                                        ? "Choose modules"
                                        : fullJourneyStep === "coding"
                                            ? "Choose coding topics"
                                            : fullJourneyStep === "cs"
                                                ? "Choose CS topics"
                                                : fullJourneyStep === "sql"
                                                    ? "Include SQL round?"
                                                    : "Choose difficulty"}
                            </h3>
                            {fullJourneyStep === "resume" && (
                                <>
                                    {renderFullResumeControls()}
                                </>
                            )}
                            {fullJourneyStep === "modules" && (
                                <>
                                    {renderFullModuleControls()}
                                </>
                            )}
                            {fullJourneyStep === "coding" && (
                                <>
                                    {renderFullCodingControls()}
                                </>
                            )}
                            {fullJourneyStep === "cs" && (
                                <>
                                    {renderFullCsControls()}
                                </>
                            )}
                            {fullJourneyStep === "sql" && (
                                <>
                                    {renderFullSqlControls()}
                                </>
                            )}
                            {fullJourneyStep === "settings" && (
                                <>
                                    {renderCsSettingsControls()}
                                </>
                            )}

                            {sessionError && (
                                <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    {sessionError}
                                </div>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                            <button
                                type="button"
                                onClick={goBackInFullJourney}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-bg"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={goForwardInFullJourney}
                                disabled={starting || billingLoading || selectedPracticeCount === 0}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {fullPrimaryActionLabel}
                            </button>
                        </div>
                    </section>
                </main>
            ) : isGenAiInterview && genAiPreviewReady ? renderReviewPage({
                preview: renderGenAiPreview(),
                onBack: goBackInGenAiJourney,
                onBegin: goForwardInGenAiJourney,
                beginDisabled: starting || billingLoading || selectedPracticeCount === 0,
            }) : isGenAiInterview ? (
                <main className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm dark:bg-black/55 sm:p-6" onClick={() => router.push("/interviews/ai")}>
                    <section className="flex h-[calc(100vh-24px)] max-h-[540px] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-lc-border dark:bg-lc-surface sm:h-[calc(100vh-48px)]" onClick={(event) => event.stopPropagation()}>
                        <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                            <h2 className="text-lg font-extrabold text-slate-950 dark:text-white font-nunito">Interview Setup</h2>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                {estimatedMinutes} min
                            </span>
                        </div>

                        <div className={`min-h-0 flex-1 px-7 py-6 ${genAiJourneyStep === "resume" ? "overflow-hidden" : "overflow-y-auto"}`}>
                            <h3 className="mb-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                {genAiJourneyStep === "resume"
                                    ? "Choose resume"
                                    : genAiJourneyStep === "modules"
                                        ? "Choose modules"
                                        : genAiJourneyStep === "question"
                                            ? "Choose question focus"
                                            : "Choose difficulty"}
                            </h3>
                            {genAiJourneyStep === "resume" && (
                                <>
                                    {renderShortResumeControls()}
                                </>
                            )}
                            {genAiJourneyStep === "modules" && (
                                <>
                                    {renderGenAiModuleControls()}
                                </>
                            )}
                            {genAiJourneyStep === "question" && (
                                <>
                                    {renderGenAiQuestionControls()}
                                </>
                            )}
                            {genAiJourneyStep === "settings" && (
                                <>
                                    {renderCsSettingsControls()}
                                </>
                            )}

                            {sessionError && (
                                <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    {sessionError}
                                </div>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                            <button
                                type="button"
                                onClick={goBackInGenAiJourney}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-bg"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={goForwardInGenAiJourney}
                                disabled={starting || billingLoading || selectedPracticeCount === 0}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {genAiPrimaryActionLabel}
                            </button>
                        </div>
                    </section>
                </main>
            ) : isRoleJourneyInterview && rolePreviewReady ? renderReviewPage({
                preview: renderRolePreview(),
                onBack: goBackInRoleJourney,
                onBegin: goForwardInRoleJourney,
                beginDisabled: starting || billingLoading || selectedPracticeCount === 0,
            }) : isRoleJourneyInterview ? (
                <main className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm dark:bg-black/55 sm:p-6" onClick={() => router.push("/interviews/ai")}>
                    <section className="flex h-[calc(100vh-24px)] max-h-[540px] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-lc-border dark:bg-lc-surface sm:h-[calc(100vh-48px)]" onClick={(event) => event.stopPropagation()}>
                        <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                            <h2 className="text-lg font-extrabold text-slate-950 dark:text-white font-nunito">Interview Setup</h2>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                {estimatedMinutes} min
                            </span>
                        </div>

                        <div className={`min-h-0 flex-1 px-7 py-6 ${roleJourneyStep === "resume" ? "overflow-hidden" : "overflow-y-auto"}`}>
                            <h3 className="mb-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                {roleJourneyStep === "resume"
                                    ? "Choose resume"
                                    : roleJourneyStep === "modules"
                                        ? "Choose modules"
                                        : roleJourneyStep === "question"
                                            ? "Choose question focus"
                                            : "Choose difficulty"}
                            </h3>
                            {roleJourneyStep === "resume" && (
                                <>
                                    {renderShortResumeControls()}
                                </>
                            )}
                            {roleJourneyStep === "modules" && (
                                <>
                                    {renderRoleModuleControls()}
                                </>
                            )}
                            {roleJourneyStep === "question" && isDataScienceInterview && (
                                <>
                                    {renderRoleQuestionControls()}
                                </>
                            )}
                            {roleJourneyStep === "settings" && (
                                <>
                                    {renderCsSettingsControls()}
                                </>
                            )}

                            {sessionError && (
                                <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    {sessionError}
                                </div>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                            <button
                                type="button"
                                onClick={goBackInRoleJourney}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-bg"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={goForwardInRoleJourney}
                                disabled={starting || billingLoading || selectedPracticeCount === 0}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {rolePrimaryActionLabel}
                            </button>
                        </div>
                    </section>
                </main>
            ) : isSimpleJourneyInterview && simplePreviewReady ? renderReviewPage({
                preview: renderSimplePreview(),
                onBack: goBackInSimpleJourney,
                onBegin: goForwardInSimpleJourney,
                beginDisabled: starting || billingLoading || (selectedType === "resume_round" && !resumeId),
            }) : isSimpleJourneyInterview ? (
                <main className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm dark:bg-black/55 sm:p-6" onClick={() => router.push("/interviews/ai")}>
                    <section className="flex h-[calc(100vh-24px)] max-h-[540px] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-lc-border dark:bg-lc-surface sm:h-[calc(100vh-48px)]" onClick={(event) => event.stopPropagation()}>
                        <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                            <h2 className="text-lg font-extrabold text-slate-950 dark:text-white font-nunito">Interview Setup</h2>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                {estimatedMinutes} min
                            </span>
                        </div>

                        <div className={`min-h-0 flex-1 px-7 py-6 ${simpleJourneyStep === "resume" ? "overflow-hidden" : "overflow-y-auto"}`}>
                            <h3 className="mb-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                {simpleJourneyStep === "resume"
                                    ? "Choose resume"
                                    : selectedType === "resume_round"
                                        ? "Choose sections"
                                        : "Problem solving interview"}
                            </h3>
                            {simpleJourneyStep === "resume" && selectedType === "resume_round" && (
                                <>
                                    {renderRequiredResumeControls()}
                                </>
                            )}
                            {simpleJourneyStep === "modules" && (
                                <>
                                    {selectedType === "resume_round" && renderSimpleModuleControls()}
                                </>
                            )}

                            {sessionError && (
                                <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    {sessionError}
                                </div>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                            <button
                                type="button"
                                onClick={goBackInSimpleJourney}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-bg"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={goForwardInSimpleJourney}
                                disabled={starting || billingLoading}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {simplePrimaryActionLabel}
                            </button>
                        </div>
                    </section>
                </main>
            ) : isCodingInterview && codingPreviewReady ? renderReviewPage({
                preview: renderCodingPreview(),
                onBack: goBackInCodingJourney,
                onBegin: goForwardInCodingJourney,
                beginDisabled: starting || billingLoading || selectedPracticeCount === 0,
            }) : isCodingInterview ? (
                <main className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm dark:bg-black/55 sm:p-6" onClick={() => router.push("/interviews/ai")}>
                    <section className="flex h-[calc(100vh-24px)] max-h-[540px] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-lc-border dark:bg-lc-surface sm:h-[calc(100vh-48px)]" onClick={(event) => event.stopPropagation()}>
                        <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                            <h2 className="text-lg font-extrabold text-slate-950 dark:text-white font-nunito">Interview Setup</h2>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                {estimatedMinutes} min
                            </span>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
                            <h3 className="mb-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                {codingJourneyStep === "focus"
                                        ? "Choose question focus"
                                        : "Choose difficulty"}
                            </h3>
                            {codingJourneyStep === "focus" && (
                                <>
                                    {renderCodingFocusControls()}
                                </>
                            )}
                            {codingJourneyStep === "settings" && (
                                <>
                                    {renderCsSettingsControls()}
                                </>
                            )}

                            {sessionError && (
                                <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    {sessionError}
                                </div>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                            <button
                                type="button"
                                onClick={goBackInCodingJourney}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-bg"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={goForwardInCodingJourney}
                                disabled={starting || billingLoading || selectedPracticeCount === 0}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {codingPrimaryActionLabel}
                            </button>
                        </div>
                    </section>
                </main>
            ) : isShortJourneyInterview && shortPreviewReady ? renderReviewPage({
                preview: renderShortPreview(),
                onBack: goBackInShortJourney,
                onBegin: goForwardInShortJourney,
                beginDisabled: starting || billingLoading || selectedPracticeCount === 0,
            }) : isShortJourneyInterview ? (
                <main className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm dark:bg-black/55 sm:p-6" onClick={() => router.push("/interviews/ai")}>
                    <section className="flex h-[calc(100vh-24px)] max-h-[540px] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-lc-border dark:bg-lc-surface sm:h-[calc(100vh-48px)]" onClick={(event) => event.stopPropagation()}>
                        <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                            <h2 className="text-lg font-extrabold text-slate-950 dark:text-white font-nunito">Interview Setup</h2>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                {estimatedMinutes} min
                            </span>
                        </div>

                        <div className={`min-h-0 flex-1 px-7 py-6 ${shortJourneyStep === "resume" ? "overflow-hidden" : "overflow-y-auto"}`}>
                            <h3 className="mb-5 text-xl font-extrabold text-slate-950 dark:text-white font-nunito">
                                {shortJourneyStep === "resume"
                                    ? "Choose resume"
                                    : "Choose difficulty"}
                            </h3>
                            {shortJourneyStep === "resume" && (
                                <>
                                    {renderShortResumeControls()}
                                </>
                            )}
                            {shortJourneyStep === "settings" && selectedType === "system_design" && (
                                <>
                                    {renderCsSettingsControls()}
                                </>
                            )}

                            {sessionError && (
                                <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    {sessionError}
                                </div>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                            <button
                                type="button"
                                onClick={goBackInShortJourney}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-bg"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={goForwardInShortJourney}
                                disabled={starting || billingLoading || selectedPracticeCount === 0}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {shortPrimaryActionLabel}
                            </button>
                        </div>
                    </section>
                </main>
            ) : (
            <main className="w-full px-6 py-10 lg:px-8">
                <div className="mx-auto grid max-w-[1320px] gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-8">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                            <button onClick={() => router.push("/interviews/ai")} className="hover:text-blue-600">Setup</button>
                            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                            <span className="text-slate-900 dark:text-white">Customize</span>
                        </div>
                        {canUseResume && (
                            <section className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface/80 md:p-8">
                                <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-950 dark:text-white font-nunito">Select resume</h3>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                            Choose the resume to use for resume-focused modules in this interview.
                                        </p>
                                    </div>
                                    {resumeId && (
                                        <button
                                            onClick={() => {
                                                setResumeId(null);
                                                setResumeAnalysis(null);
                                            }}
                                            className="w-fit rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-lc-border dark:text-slate-300"
                                        >
                                            Clear selection
                                        </button>
                                    )}
                                </div>

                                {loadingResumes ? (
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500 dark:border-lc-border dark:bg-lc-bg dark:text-slate-400">
                                        Loading your resumes...
                                    </div>
                                ) : (
                                    <div className="flex gap-6 overflow-x-auto pb-8 pt-6 -mt-6 custom-scrollbar snap-x px-2 -mx-2">
                                        {existingResumes.map((resume) => {
                                            const selected = resumeId === resume.id;
                                            return (
                                                <div
                                                    key={resume.id}
                                                    onClick={() => selectExistingResume(resume)}
                                                    onMouseEnter={handleCardMouseEnter}
                                                    className={`group relative snap-center flex-none w-[160px] md:w-[220px] aspect-[4/5] rounded-2xl border-2 p-3 md:p-5 text-left flex flex-col transition-all duration-300 ease-out cursor-pointer hover:-translate-y-3 hover:shadow-xl hover:shadow-primary/10 overflow-hidden before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] before:transition-transform before:duration-700 before:ease-in-out ${
                                                        selected
                                                            ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                                                            : "border-slate-200 dark:border-lc-border bg-white/70 dark:bg-lc-surface/70 backdrop-blur-sm hover:border-primary/50"
                                                    }`}
                                                >
                                                    {selected && (
                                                        <div className="absolute -top-3 -right-3 size-8 z-[10] bg-primary rounded-full flex items-center justify-center shadow-lg text-white">
                                                            <span className="material-symbols-outlined text-sm">check</span>
                                                        </div>
                                                    )}

                                                    <button
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setDeleteConfirmId(resume.id);
                                                        }}
                                                        className="absolute top-3 right-3 z-[10] size-7 bg-white dark:bg-lc-surface rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-red-50 dark:hover:bg-red-500/10 border border-slate-200 dark:border-lc-border"
                                                        title="Delete resume"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px] text-slate-400 hover:text-red-500">delete</span>
                                                    </button>

                                                    <div className="flex-1 w-full bg-white dark:bg-lc-bg rounded-lg border border-slate-100 dark:border-lc-border mb-4 overflow-hidden flex flex-col p-1 gap-1 group-hover:scale-105 transition-transform duration-300 shadow-inner group-hover:bg-white relative">
                                                        {signedUrls[resume.id] ? (
                                                            <div className="absolute inset-0 bg-white overflow-hidden rounded-lg pointer-events-none">
                                                                <iframe
                                                                    src={`${signedUrls[resume.id]}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                                                    className="w-full h-[300%] -mt-2 border-none bg-white pointer-events-none"
                                                                    scrolling="no"
                                                                    tabIndex={-1}
                                                                />
                                                                <div className="absolute inset-0 bg-transparent z-10" />
                                                            </div>
                                                        ) : (
                                                            <div className="absolute inset-0 p-2 flex flex-col overflow-hidden text-[#aaa] pointer-events-none opacity-50 dark:opacity-30">
                                                                <div className="h-1.5 w-1/3 bg-current rounded-sm mx-auto mb-2" />
                                                                <div className="h-0.5 w-full bg-current rounded-sm mb-1 opacity-60" />
                                                                <div className="h-0.5 w-5/6 bg-current rounded-sm mb-1 opacity-60" />
                                                                <div className="h-0.5 w-2/3 bg-current rounded-sm mb-1 opacity-60" />
                                                                <div className="mt-2 h-0.5 w-1/4 bg-current rounded-sm mb-1" />
                                                                <div className="h-0.5 w-full bg-current rounded-sm mb-1 opacity-60" />
                                                                <div className="h-0.5 w-full bg-current rounded-sm mb-1 opacity-60" />
                                                                <div className="h-0.5 w-4/5 bg-current rounded-sm opacity-60" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="mt-auto group-hover:-translate-y-1 transition-transform duration-300">
                                                        <p className="font-bold text-slate-800 dark:text-white truncate" title={resume.fileName}>
                                                            {resume.fileName || "Resume"}
                                                        </p>
                                                        <p className="text-[11px] text-slate-400 mt-1 uppercase font-bold tracking-wider">
                                                            {resume.uploadedAt ? new Date(resume.uploadedAt).toLocaleDateString() : "Uploaded resume"}
                                                        </p>
                                                        {resume.analysis && (
                                                            <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                                                Analyzed
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        <button
                                            type="button"
                                            onClick={() => setShowAddResume(true)}
                                            onMouseEnter={handleCardMouseEnter}
                                            className="group snap-center flex-none w-[160px] md:w-[220px] aspect-[4/5] rounded-2xl border-2 border-dashed border-slate-300 dark:border-lc-border hover:border-primary bg-slate-50/70 dark:bg-lc-surface/70 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 cursor-pointer transition-all duration-300 ease-out hover:-translate-y-3 hover:shadow-xl hover:shadow-primary/10 hover:bg-primary/5 relative overflow-hidden before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] before:transition-transform before:duration-700 before:ease-in-out"
                                        >
                                            <div className="size-14 bg-white dark:bg-lc-bg rounded-full flex items-center justify-center shadow-sm text-slate-400 group-hover:text-primary group-hover:scale-110 transition-all duration-300 mb-4 group-hover:bg-white border border-slate-100 dark:border-lc-border">
                                                <span className="material-symbols-outlined text-3xl">add</span>
                                            </div>
                                            <span className="font-bold text-slate-600 dark:text-slate-300 group-hover:text-primary transition-colors group-hover:-translate-y-1">Add a new resume</span>
                                            {uploadError && (
                                                <span className="absolute bottom-4 left-4 right-4 text-[10px] text-red-500 font-medium">
                                                    {uploadError}
                                                </span>
                                            )}
                                        </button>
                                    </div>
                                )}

                                {resumeId && !resumeModuleEnabled && (
                                    <div className="mt-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                        <span className="material-symbols-outlined mt-0.5 text-[20px]">info</span>
                                        <span>Resume probing is off for this run, so the selected resume will not be analyzed or used.</span>
                                    </div>
                                )}

                                {uploadError && (
                                    <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                        {uploadError}
                                    </div>
                                )}
                            </section>
                        )}

                        {!isResumeScreening && (
                        <section className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface/80 md:p-8">
                            <div className="mb-6">
                                <h3 className="text-xl font-bold text-slate-950 dark:text-white font-nunito">Select modules</h3>
                                {visibleModules.length > 1 && (
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose which rounds to include in this mock interview.</p>
                                )}
                            </div>
                            {moduleWarning && (
                                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                                    {moduleWarning}
                                </div>
                            )}
                            <div className="grid gap-4 md:grid-cols-2">
                                {visibleModules.map((module) => {
                                    const enabled = enabledStageSet.has(module.stage);
                                    const locked = isLockedStage(selectedType, module.stage);
                                    const required = isRequiredStage(selectedType, module.stage);
                                    return (
                                        <button
                                            key={module.stage}
                                            type="button"
                                            onClick={() => toggleStage(module.stage)}
                                            disabled={locked}
                                            className={`group relative min-h-[132px] rounded-xl border-2 p-5 text-left transition-all ${
                                                enabled
                                                    ? "border-blue-500 bg-blue-50/70 shadow-sm shadow-blue-600/10 dark:border-blue-400 dark:bg-blue-500/20"
                                                    : "border-slate-200 bg-white hover:border-blue-300 dark:border-lc-border dark:bg-lc-bg"
                                            } ${locked ? "cursor-default" : "cursor-pointer hover:-translate-y-0.5 hover:shadow-md"}`}
                                        >
                                            <span className={`mb-4 flex size-11 items-center justify-center rounded-xl ${enabled ? "bg-blue-100 text-blue-600 dark:bg-blue-500/30 dark:text-blue-200" : "bg-slate-100 text-slate-500 dark:bg-lc-surface dark:text-slate-400"}`}>
                                                <span className="material-symbols-outlined text-[24px]">{module.icon}</span>
                                            </span>
                                            <span className="absolute right-5 top-5">
                                                <span className={`material-symbols-outlined text-[24px] ${enabled ? "text-blue-600 dark:text-blue-300" : "text-slate-300 dark:text-slate-600"}`}>
                                                    {enabled ? "check_box" : "check_box_outline_blank"}
                                                </span>
                                            </span>
                                            <span className="block pr-8 text-[16px] font-bold text-slate-950 dark:text-white">
                                                {module.label}
                                                {required ? <span className="ml-2 text-xs text-slate-500">(required)</span> : null}
                                            </span>
                                            <span className="mt-1 block text-sm leading-6 text-slate-500 dark:text-slate-400">
                                                {module.description}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                        )}

                        {hasQuestionFocusControls && (
                            <section className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface/80 md:p-8">
                                <div className="mb-6">
                                    <h3 className="text-xl font-bold text-slate-950 dark:text-white font-nunito">Question focus</h3>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Select the supported topics you want emphasized during the session.</p>
                                </div>
                                <div className="space-y-8">
                                    {enabledStageSet.has("DSA") && (
                                        <TopicGroup title="Coding topics" items={DSA_TOPICS} selected={dsaTopics} onToggle={(topic) => setDsaTopics((prev) => toggleValue(prev, topic))} />
                                    )}
                                    {enabledStageSet.has("FUNDAMENTALS") && (
                                        <div className="space-y-4">
                                            <TopicGroup title="CS fundamentals topics" items={CS_TOPICS} selected={csTopics} onToggle={(topic) => setCsTopics((prev) => toggleRequiredValue(prev, topic))} required />
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-lc-border dark:bg-lc-bg dark:text-slate-300">
                                                    <span>SQL round</span>
                                                    <input type="checkbox" checked={includeSqlRound} onChange={(e) => setIncludeSqlRound(e.target.checked)} />
                                                </label>
                                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-lc-border dark:bg-lc-bg dark:text-slate-300">
                                                    <span>Questions per topic</span>
                                                    <div className="mt-3">
                                                        <PopupSelect
                                                            ariaLabel="Questions per topic"
                                                            options={QUESTION_COUNT_OPTIONS}
                                                            value={questionCountPerTopic}
                                                            onChange={(value) => setQuestionCountPerTopic(Number(value))}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {enabledStageSet.has("GEN_AI_CONCEPTS") && (
                                        <TopicGroup title="GenAI concept focus" items={GENAI_SUBTOPICS} selected={genAIConcepts} onToggle={(topic) => setGenAIConcepts((prev) => toggleValue(prev, topic))} format={formatFocusLabel} />
                                    )}
                                    {enabledStageSet.has("DS_CONCEPTS") && (
                                        <TopicGroup title="DS concept focus" items={DS_CONCEPT_CATEGORIES} selected={dsConcepts} onToggle={(topic) => setDsConcepts((prev) => toggleValue(prev, topic))} format={formatDSConceptLabel} />
                                    )}
                                </div>
                            </section>
                        )}

                        {showSessionSettings && (
                            <section className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface/80 md:p-8">
                                <div className="mb-6">
                                    <h3 className="text-xl font-bold text-slate-950 dark:text-white font-nunito">Session settings</h3>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Tailor the session to the interview level you are targeting.</p>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-lc-border dark:bg-lc-bg">
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-4">
                                            <span className="flex size-12 items-center justify-center rounded-xl bg-slate-100 text-blue-600 dark:bg-lc-surface">
                                                <span className="material-symbols-outlined">speed</span>
                                            </span>
                                            <div>
                                                <p className="font-bold text-slate-950 dark:text-white">Experience level</p>
                                            </div>
                                        </div>
                                        <div className="w-full sm:w-[220px]">
                                            <PopupSelect
                                                ariaLabel="Experience level"
                                                options={LEVEL_OPTIONS}
                                                value={level}
                                                onChange={(value) => setLevel(value as InterviewLevel)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}
                    </div>

                    <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
                        <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface/90">
                            <h3 className="text-xl font-bold text-slate-950 dark:text-white font-nunito">Summary</h3>
                            <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{selectedTypeInfo?.label}</p>
                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{summaryCountLabel}</p>
                            <div className="mt-6 divide-y divide-slate-100 dark:divide-lc-border">
                                {visibleSelectedModules.map((module) => (
                                    <div key={module.stage} className="flex items-center justify-between gap-3 py-3 text-sm">
                                        <span className="flex min-w-0 items-center gap-3 font-semibold text-slate-800 dark:text-slate-200">
                                            <span className="material-symbols-outlined text-[18px] text-blue-600">{module.icon}</span>
                                            <span className="truncate">{module.label}</span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-5 flex items-center justify-between rounded-xl bg-slate-100 px-4 py-4 font-bold text-slate-900 dark:bg-lc-bg dark:text-white">
                                <span>Total time</span>
                                <span className="text-blue-600">{estimatedMinutes} min</span>
                            </div>
                            <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 dark:border-lc-border dark:text-slate-300">
                                <span className="flex items-center gap-2"><ClockIcon className="h-7 w-7" /> Minutes</span>
                                <span>{estimatedMinutes} min{estimatedMinutes === 1 ? "" : "s"}</span>
                            </div>
                            {sessionError && (
                                <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    {sessionError}
                                </div>
                            )}
                            <button
                                onClick={() => {
                                    if (hasInsufficientCredits) {
                                        setUpgradeOpen(true);
                                        return;
                                    }
                                    continueToWarmup();
                                }}
                                disabled={starting || billingLoading || selectedPracticeCount === 0}
                                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-4 text-base font-bold text-white shadow-xl shadow-blue-600/20 transition-all hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                            >
                                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                                {hasInsufficientCredits ? "Upgrade or buy minutes" : "Continue to warm-up"}
                            </button>
                            <button onClick={() => router.push("/interviews/ai")} className="mt-4 flex w-full items-center justify-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                Back to setup
                            </button>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface/90">
                            <div className="flex items-center gap-3">
                                <span className="flex size-11 items-center justify-center rounded-xl bg-blue-600 text-white">
                                    <span className="material-symbols-outlined">tips_and_updates</span>
                                </span>
                                <h3 className="text-lg font-bold text-slate-950 dark:text-white font-nunito">Pro tip</h3>
                            </div>
                            <p className="mt-4 text-sm leading-7 text-slate-500 dark:text-slate-400">
                                {isResumeScreening
                                    ? "Resume Screening Interview follows one fixed forward flow through your resume, so the interviewer can verify claims without jumping between sections."
                                    : "Pick the modules that match your current prep goal. Full interviews are useful for end-to-end practice, while focused sessions are better when you want sharper feedback on one weak area."}
                            </p>
                        </section>
                    </aside>
                </div>
            </main>
            )}
            {isCsFundamentals && csEditModal && (
                <JourneyEditDialog
                    title={csEditModal === "resume" ? "Resume" : csEditModal === "focus" ? "Question focus" : csEditModal === "sql" ? "SQL round" : "Difficulty"}
                    onClose={() => setCsEditModal(null)}
                    onSave={() => setCsEditModal(null)}
                    estimatedMinutes={estimatedMinutes}
                >
                    {csEditModal === "resume" && renderCsResumeControls()}
                    {csEditModal === "focus" && renderCsFocusControls()}
                    {csEditModal === "sql" && renderCsSqlControls()}
                    {csEditModal === "settings" && renderCsSettingsControls()}
                </JourneyEditDialog>
            )}
            {isFullInterview && fullEditModal && (
                <JourneyEditDialog
                    title={fullEditModal === "resume" ? "Resume" : fullEditModal === "modules" ? "Modules" : fullEditModal === "coding" ? "Coding topics" : fullEditModal === "cs" ? "CS topics" : fullEditModal === "sql" ? "SQL round" : "Difficulty"}
                    onClose={() => setFullEditModal(null)}
                    onSave={saveFullEditModal}
                    saveLabel={fullEditModal === "modules" && (fullHasCodingModule || fullHasCsModule) ? "Next" : fullEditModal === "coding" && fullHasCsModule ? "Next" : fullEditModal === "cs" && fullHasCsModule ? "Next" : "Save changes"}
                    estimatedMinutes={estimatedMinutes}
                >
                    {fullEditModal === "resume" && renderFullResumeControls()}
                    {fullEditModal === "modules" && renderFullModuleControls()}
                    {fullEditModal === "coding" && renderFullCodingControls()}
                    {fullEditModal === "cs" && renderFullCsControls()}
                    {fullEditModal === "sql" && renderFullSqlControls()}
                    {fullEditModal === "settings" && renderCsSettingsControls()}
                </JourneyEditDialog>
            )}
            {isGenAiInterview && genAiEditModal && (
                <JourneyEditDialog
                    title={genAiEditModal === "resume" ? "Resume" : genAiEditModal === "modules" ? "Modules" : genAiEditModal === "question" ? "Question focus" : "Difficulty"}
                    onClose={() => setGenAiEditModal(null)}
                    onSave={saveGenAiEditModal}
                    saveLabel={genAiEditModal === "modules" && genAiHasQuestionModule ? "Next" : "Save changes"}
                    estimatedMinutes={estimatedMinutes}
                >
                    {genAiEditModal === "resume" && renderShortResumeControls()}
                    {genAiEditModal === "modules" && renderGenAiModuleControls()}
                    {genAiEditModal === "question" && renderGenAiQuestionControls()}
                    {genAiEditModal === "settings" && renderCsSettingsControls()}
                </JourneyEditDialog>
            )}
            {isRoleJourneyInterview && roleEditModal && (
                <JourneyEditDialog
                    title={roleEditModal === "resume" ? "Resume" : roleEditModal === "modules" ? "Modules" : roleEditModal === "question" ? "Question focus" : "Difficulty"}
                    onClose={() => setRoleEditModal(null)}
                    onSave={saveRoleEditModal}
                    saveLabel={roleEditModal === "modules" && roleHasQuestionModule ? "Next" : "Save changes"}
                    estimatedMinutes={estimatedMinutes}
                >
                    {roleEditModal === "resume" && renderShortResumeControls()}
                    {roleEditModal === "modules" && renderRoleModuleControls()}
                    {roleEditModal === "question" && isDataScienceInterview && renderRoleQuestionControls()}
                    {roleEditModal === "settings" && renderCsSettingsControls()}
                </JourneyEditDialog>
            )}
            {isSimpleJourneyInterview && simpleEditModal && (
                <JourneyEditDialog
                    title={simpleEditModal === "resume" ? "Resume" : selectedType === "resume_round" ? "Sections" : "Module"}
                    onClose={() => setSimpleEditModal(null)}
                    onSave={() => setSimpleEditModal(null)}
                    estimatedMinutes={estimatedMinutes}
                >
                    {simpleEditModal === "resume" && selectedType === "resume_round" && renderRequiredResumeControls()}
                    {simpleEditModal === "modules" && renderSimpleModuleControls()}
                </JourneyEditDialog>
            )}
            {isCodingInterview && codingEditModal && (
                <JourneyEditDialog
                    title={codingEditModal === "modules" ? "Modules" : codingEditModal === "focus" ? "Question focus" : "Difficulty"}
                    onClose={() => setCodingEditModal(null)}
                    onSave={() => setCodingEditModal(null)}
                    estimatedMinutes={estimatedMinutes}
                >
                    {codingEditModal === "modules" && renderCodingModuleControls()}
                    {codingEditModal === "focus" && renderCodingFocusControls()}
                    {codingEditModal === "settings" && renderCsSettingsControls()}
                </JourneyEditDialog>
            )}
            {isShortJourneyInterview && shortEditModal && (
                <JourneyEditDialog
                    title={shortEditModal === "resume" ? "Resume" : shortEditModal === "modules" ? "Module" : "Difficulty"}
                    onClose={() => setShortEditModal(null)}
                    onSave={() => setShortEditModal(null)}
                    estimatedMinutes={estimatedMinutes}
                >
                    {shortEditModal === "resume" && renderShortResumeControls()}
                    {shortEditModal === "modules" && renderShortModuleControls()}
                    {shortEditModal === "settings" && selectedType === "system_design" && renderCsSettingsControls()}
                </JourneyEditDialog>
            )}
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleFileSelect(file);
                    event.target.value = "";
                }}
            />

            {showAddResume && (
                <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddResume(false)} />
                    <div className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-xl font-bold text-slate-950 dark:text-white font-nunito">Add your resume</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Upload a PDF or build one from the resume workspace.</p>
                            </div>
                            <button onClick={() => setShowAddResume(false)} className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:text-slate-700 dark:bg-lc-bg dark:text-slate-300">
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        {uploadingResume ? (
                            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-slate-200 bg-slate-50 py-12 dark:border-lc-border dark:bg-lc-bg">
                                <div className="size-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Uploading resume...</p>
                            </div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2">
                                <button
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                    className="min-h-[220px] rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition-all hover:border-blue-400 hover:bg-blue-50 dark:border-lc-border dark:bg-lc-bg dark:hover:bg-blue-500/10"
                                >
                                    <span className="mx-auto flex size-14 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm dark:bg-lc-surface dark:text-blue-300">
                                        <span className="material-symbols-outlined text-[30px]">cloud_upload</span>
                                    </span>
                                    <span className="mt-4 block text-base font-bold text-slate-900 dark:text-white">Upload PDF resume</span>
                                    <span className="mt-2 block text-sm leading-6 text-slate-500 dark:text-slate-400">Drag and drop here, or click to browse. Max 5MB.</span>
                                </button>

                                <button
                                    onClick={() => {
                                        setShowAddResume(false);
                                        router.push("/resumes?new=true");
                                    }}
                                    className="min-h-[220px] rounded-xl border border-slate-200 bg-white p-6 text-left transition-all hover:border-emerald-300 hover:bg-emerald-50/60 dark:border-lc-border dark:bg-lc-bg dark:hover:bg-emerald-500/10"
                                >
                                    <span className="flex size-14 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                                        <span className="material-symbols-outlined text-[30px]">auto_awesome</span>
                                    </span>
                                    <span className="mt-4 block text-base font-bold text-slate-900 dark:text-white">Build with LaTeX</span>
                                    <span className="mt-2 block text-sm leading-6 text-slate-500 dark:text-slate-400">Open the resume builder, create a resume, then return to select it here.</span>
                                    <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-300">
                                        Open builder
                                        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {deleteConfirmId && (
                <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirmId(null)} />
                    <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex items-start gap-4">
                            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500 dark:bg-red-500/10">
                                <span className="material-symbols-outlined">warning</span>
                            </span>
                            <div>
                                <h3 className="text-lg font-bold text-slate-950 dark:text-white">Delete resume?</h3>
                                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">This removes the resume from your account and cannot be undone.</p>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button onClick={() => setDeleteConfirmId(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-bg">
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDeleteResume(deleteConfirmId)}
                                disabled={deletingResumeId === deleteConfirmId}
                                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
                            >
                                {deletingResumeId === deleteConfirmId ? "Deleting..." : "Delete"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <FeatureLimitModal />
        </div>
    );
}

function TopicGroup({
    title,
    items,
    selected,
    onToggle,
    required = false,
    format = (value: string) => value,
}: {
    title: string;
    items: string[];
    selected: string[];
    onToggle: (item: string) => void;
    required?: boolean;
    format?: (value: string) => string;
}) {
    return (
        <div className="space-y-4">
            <p className="text-sm font-bold text-slate-800 dark:text-white">{title}</p>
            <div className="flex flex-wrap gap-3">
                {items.map((item) => {
                    const active = selected.includes(item);
                    const disabled = required && active && selected.length <= 1;
                    return (
                        <button
                            key={item}
                            type="button"
                            onClick={() => onToggle(item)}
                            disabled={disabled}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                                active
                                    ? "border-blue-600 bg-blue-600 text-white"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 dark:border-lc-border dark:bg-lc-bg dark:text-slate-300"
                            } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                            {active ? <span className="material-symbols-outlined mr-1 align-[-3px] text-[16px]">check</span> : null}
                            {format(item)}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function ReviewField({
    title,
    children,
    compact = false,
    onEdit,
}: {
    title: string;
    children: ReactNode;
    compact?: boolean;
    onEdit?: () => void;
}) {
    return (
        <section className={`grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start ${compact ? "py-4" : "py-5"}`}>
            <div className="min-w-0">
                <h4 className="text-sm font-extrabold text-slate-950 dark:text-white font-nunito">{title}</h4>
                <div className="mt-1 min-w-0">
                    {children}
                </div>
            </div>
            {onEdit && (
                <div className="flex justify-start sm:justify-end">
                    <button
                        type="button"
                        onClick={onEdit}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-blue-500 transition-colors hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10"
                    >
                        <span className="material-symbols-outlined text-[14px]">edit</span>
                        Edit
                    </button>
                </div>
            )}
        </section>
    );
}

function JourneyEditDialog({
    title,
    children,
    onClose,
    onSave,
    saveLabel = "Save changes",
    estimatedMinutes,
}: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    onSave: () => void;
    saveLabel?: string;
    estimatedMinutes?: number;
}) {
    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-sm dark:bg-black/55 sm:p-6">
            <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close edit dialog" />
            <section className="relative flex h-[calc(100vh-24px)] max-h-[540px] w-full max-w-[540px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-lc-border dark:bg-lc-surface sm:h-[calc(100vh-48px)]">
                <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-6 dark:border-lc-border">
                    <h2 className="text-base font-extrabold text-slate-950 dark:text-white font-nunito">{title}</h2>
                    <div className="flex items-center gap-3 pr-8">
                        {estimatedMinutes !== undefined && (
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                {estimatedMinutes} min
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="absolute right-3 flex size-7 items-center justify-center rounded-md text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10"
                        aria-label="Close edit dialog"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
                    {children}
                </div>
                <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                    <button
                        type="button"
                        onClick={onSave}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
                    >
                        {saveLabel}
                    </button>
                </div>
            </section>
        </div>
    );
}

type PopupSelectOption<T extends string | number> = {
    value: T;
    label: string;
    description?: string;
};

function PopupSelect<T extends string | number>({
    value,
    options,
    onChange,
    ariaLabel,
}: {
    value: T;
    options: readonly PopupSelectOption<T>[];
    onChange: (value: T) => void;
    ariaLabel: string;
}) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const selectedOption = options.find((option) => option.value === value) || options[0];

    useEffect(() => {
        if (!open) return;
        scrollElementToBottom(menuRef.current);
        const firstFrame = window.requestAnimationFrame(() => {
            scrollElementToBottom(menuRef.current);
            window.requestAnimationFrame(() => scrollElementToBottom(menuRef.current));
        });
        return () => window.cancelAnimationFrame(firstFrame);
    }, [open]);

    return (
        <div
            className="relative"
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setOpen(false);
                }
            }}
        >
            <button
                type="button"
                aria-label={ariaLabel}
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-900 shadow-sm outline-none transition-colors hover:border-blue-300 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:hover:border-blue-400/60 dark:focus:bg-lc-surface"
            >
                <span className="min-w-0">
                    <span className="block truncate">{selectedOption.label}</span>
                    {selectedOption.description && (
                        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {selectedOption.description}
                        </span>
                    )}
                </span>
                <span className={`material-symbols-outlined shrink-0 text-[20px] text-blue-600 transition-transform dark:text-blue-300 ${open ? "rotate-180" : ""}`}>
                    expand_more
                </span>
            </button>
            {open && (
                <div
                    ref={(node) => {
                        menuRef.current = node;
                        scrollElementToBottom(node);
                    }}
                    className="absolute left-0 right-0 z-50 mt-2 max-h-[220px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-950/10 dark:border-lc-border dark:bg-lc-surface dark:shadow-black/30 custom-scrollbar"
                >
                    {options.map((option) => {
                        const selected = option.value === value;
                        return (
                            <button
                                key={String(option.value)}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                                    selected
                                        ? "bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200"
                                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-lc-bg"
                                }`}
                            >
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-extrabold">{option.label}</span>
                                    {option.description && (
                                        <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            {option.description}
                                        </span>
                                    )}
                                </span>
                                {selected && <span className="material-symbols-outlined text-[18px] text-blue-600 dark:text-blue-300">check</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ChoiceCard({
    title,
    description,
    selected = false,
    disabled = false,
    compact = false,
    onClick,
}: {
    title: string;
    description: string;
    selected?: boolean;
    disabled?: boolean;
    compact?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`group flex w-full items-start gap-4 rounded-xl border text-left shadow-sm transition-all ${
                compact ? "min-h-[86px] p-4" : "min-h-[104px] p-[18px]"
            } ${
                selected
                    ? "border-transparent bg-blue-50 text-slate-900 shadow-blue-600/10 dark:bg-blue-500/20 dark:text-white"
                    : "border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:shadow-md dark:border-lc-border dark:bg-lc-surface dark:text-white"
            } ${disabled ? "cursor-not-allowed opacity-70" : "hover:-translate-y-0.5"}`}
        >
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold">{title}</span>
                <span className="mt-1 block text-[13px] leading-5 text-slate-500 dark:text-slate-400">{description}</span>
            </span>
            <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${
                selected ? "border-blue-600 bg-blue-600 text-white dark:border-blue-400" : "border-slate-300 bg-white text-transparent dark:border-slate-600 dark:bg-lc-bg"
            }`}>
                {selected ? <span className="material-symbols-outlined text-[16px] leading-none">check</span> : null}
            </span>
        </button>
    );
}

function TopicChoiceCard({
    title,
    description,
    selected = false,
    disabled = false,
    onClick,
}: {
    title: string;
    description: string;
    selected?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`group flex min-h-[98px] w-full items-start gap-3 rounded-xl px-4 py-3.5 text-left shadow-sm transition-all ${
                selected
                    ? "border border-transparent bg-blue-50 text-slate-900 dark:bg-blue-500/20 dark:text-white"
                    : "border border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:shadow-md dark:border-lc-border dark:bg-lc-surface dark:text-white"
            } ${disabled ? "cursor-not-allowed opacity-70" : "hover:-translate-y-0.5"}`}
        >
            <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${
                selected ? "border-blue-600 bg-blue-600 dark:border-blue-400" : "border-slate-300 bg-white dark:border-slate-600 dark:bg-lc-bg"
            }`}>
                {selected ? <span className="material-symbols-outlined text-[16px] leading-none text-white">check</span> : null}
            </span>
            <span className="min-w-0">
                <span className="block text-[15px] font-extrabold">{title}</span>
                <span className="mt-1 block text-[13px] leading-5 text-slate-500 dark:text-slate-400">{description}</span>
            </span>
        </button>
    );
}

export default function CustomizeInterviewPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading customization...</div>}>
            <CustomizeInterviewContent />
        </Suspense>
    );
}
