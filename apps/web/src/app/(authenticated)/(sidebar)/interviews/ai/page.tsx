"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AIInterviewTabs } from "./ai-interview-tabs";
import { Footer } from "@/components/footer";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { ClockIcon } from "@/components/icons/clock-icon";
import { useBilling } from "@/hooks/use-billing";
import { interviewCreditCost, PLAN_ENTITLEMENTS, type InterviewCostKey, type InterviewStage } from "@interviewforge/shared";
import { UpgradeModal } from "@/components/upgrade-modal";
import { fetchWithLimits, isFeatureLimitError } from "@/lib/api-with-limits";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useAuth } from "@/context/auth-context";
import { MSG91PhoneVerification } from "@/components/auth/MSG91PhoneVerification";

type InterviewTypeMeta = {
    id: InterviewCostKey;
    label: string;
    duration: string;
    icon: string;
    description: string;
    details: string[];
    bestFor: string;
};

type ModuleOption = {
    stage: InterviewStage;
    label: string;
    description: string;
    minutes: number;
    optional?: boolean;
    hidden?: boolean;
};

function isInternalStage(type: string | null, stage: InterviewStage) {
    return stage === "CLOSING" && type !== "gen_ai_role";
}

function isRequiredStage(type: string | null, stage: InterviewStage) {
    return stage === "PM_BEHAVIORAL" || (type === "gen_ai_role" && stage === "CLOSING");
}

function isLockedStage(type: string | null, stage: InterviewStage) {
    return isInternalStage(type, stage) || isRequiredStage(type, stage);
}

const MODULE_OPTIONS: Partial<Record<InterviewCostKey, ModuleOption[]>> = {
    full_interview: [
        { stage: "INTRO", label: "Resume deep-dive", description: "Strengthen how you introduce your background, projects, and role-fit evidence.", minutes: 7, optional: true },
        { stage: "DSA", label: "Coding", description: "Improve problem-solving speed, code clarity, testing, and complexity explanation.", minutes: 30 },
        { stage: "FUNDAMENTALS", label: "CS + SQL", description: "Strengthen CS reasoning and SQL explanations with interview-ready examples.", minutes: 20 },
        { stage: "CLOSING", label: "Wrap-up", description: "Summarize performance gaps and leave with clear next preparation steps.", minutes: 3 },
    ],
    coding: [
        { stage: "DSA", label: "Coding", description: "Improve problem-solving speed, code clarity, testing, and complexity explanation.", minutes: 40 },
    ],
    cs_fundamentals: [
        { stage: "INTRO", label: "Warm-up", description: "Set context quickly so the interview can target the right fundamentals gaps.", minutes: 2, optional: true },
        { stage: "FUNDAMENTALS", label: "CS fundamentals", description: "Strengthen OS, DBMS, CN, OOP, and SQL reasoning under follow-up pressure.", minutes: 20 },
        { stage: "CLOSING", label: "Wrap-up", description: "Summarize performance gaps and leave with clear next preparation steps.", minutes: 3 },
    ],
    system_design: [
        { stage: "INTRO", label: "Warm-up", description: "Calibrate the problem space before moving into design tradeoffs.", minutes: 2, optional: true },
        { stage: "SYSTEM_DESIGN", label: "System design", description: "Improve how you scope requirements, justify architecture, and reason about scale.", minutes: 25 },
        { stage: "CLOSING", label: "Wrap-up", description: "Summarize performance gaps and leave with clear next preparation steps.", minutes: 3 },
    ],
    behavioural: [
        { stage: "INTRO", label: "Warm-up", description: "Set up your background so stories can be evaluated quickly.", minutes: 2, optional: true },
        { stage: "BEHAVIOURAL", label: "Behavioural", description: "Improve STAR storytelling, ownership evidence, conflict handling, and impact.", minutes: 15 },
        { stage: "CLOSING", label: "Wrap-up", description: "Summarize performance gaps and leave with clear next preparation steps.", minutes: 3 },
    ],
    gen_ai_role: [
        { stage: "INTRO", label: "Resume deep-dive", description: "Strengthen how you explain real AI project ownership and production choices.", minutes: 10, optional: true },
        { stage: "GEN_AI_CONCEPTS", label: "GenAI concepts", description: "Improve reasoning about RAG, evaluation, prompting, models, and deployment tradeoffs.", minutes: 10 },
        { stage: "GEN_AI_CODING", label: "GenAI coding", description: "Practice implementing GenAI tasks while proving code and AI-tool ownership.", minutes: 25 },
        { stage: "CLOSING", label: "Responsibility case", description: "Improve judgment around AI safety, ethics, and responsible product decisions.", minutes: 5 },
    ],
    data_science_role: [
        { stage: "INTRO", label: "Resume deep-dive", description: "Strengthen how you explain data/ML project ownership and business impact.", minutes: 10, optional: true },
        { stage: "DS_CONCEPTS", label: "Stats + ML", description: "Improve statistical and ML reasoning under practical follow-up questions.", minutes: 15 },
        { stage: "DS_SQL", label: "SQL", description: "Practice translating business questions into correct, efficient SQL.", minutes: 15 },
        { stage: "DS_CODING", label: "Python/Pandas", description: "Improve Python/Pandas problem solving, data handling, and explanation clarity.", minutes: 20 },
        { stage: "DS_BUSINESS_CASE", label: "Metrics case", description: "Strengthen metric definition, experiment design, and business tradeoff thinking.", minutes: 10 },
    ],
    pm_role: [
        { stage: "INTRO", label: "Resume ownership", description: "Strengthen how you connect resume experience to product ownership and impact.", minutes: 18, optional: true },
        { stage: "PM_CASE", label: "Product case", description: "Practice structuring product cases, clarifying goals, and prioritizing tradeoffs.", minutes: 22 },
        { stage: "PM_CONCEPTS", label: "PM concepts", description: "Improve metrics, prioritization, experimentation, and execution judgment.", minutes: 18 },
        { stage: "PM_STRATEGY", label: "Strategy", description: "Strengthen market reasoning, competitive thinking, and strategic tradeoff clarity.", minutes: 18 },
        { stage: "PM_BEHAVIORAL", label: "Behavioural", description: "Refine STAR stories for conflict, launch decisions, leadership, and ownership.", minutes: 14 },
    ],
    problem_solving_case: [
        { stage: "PROBLEM_SOLVING", label: "Problem-solving", description: "Improve structured reasoning, assumption testing, adaptation, and conviction under pressure.", minutes: 25 },
        { stage: "CLOSING", label: "Wrap-up", description: "Summarize performance gaps and leave with clear next preparation steps.", minutes: 3 },
    ],
    resume_round: [
        { stage: "RESUME_STUDIES", label: "Opening Calibration", description: "Brief background and target-role context.", minutes: 1, hidden: true },
        { stage: "RESUME_PROJECTS", label: "Projects Verification", description: "Claims, skills, AI usage, architecture, trade-offs, and impact.", minutes: 18 },
        { stage: "RESUME_EXPERIENCE", label: "Experience Evidence", description: "Improve how you prove shipped work, responsibility, stakeholder context, and measurable outcomes.", minutes: 5, optional: true },
        { stage: "RESUME_RESPONSIBILITY", label: "Leadership Evidence", description: "Initiative, accountability, influence, and results.", minutes: 3, optional: true },
        { stage: "RESUME_SKILLS", label: "Fit & Communication", description: "Role alignment, self-awareness, and proof-point synthesis.", minutes: 4 },
        { stage: "CLOSING", label: "Wrap-up", description: "Risks, proof points, and next preparation actions.", minutes: 2 },
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

const CS_TOPICS = ["DBMS", "OS", "CN", "OOPS"];
const GENAI_SUBTOPICS = ["RAGPipeline", "PromptEngineering", "Evaluation", "ModelSelection", "MLOps", "TransformerInternals"];
const DS_CONCEPT_CATEGORIES = ["statistics", "ml_fundamentals", "tabular_techniques", "deep_learning", "probabilistic_models", "reinforcement_learning"];
const DIFFICULTIES = ["Easy", "Medium", "Hard"];

function toggleValue<T>(values: T[], value: T) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function toggleRequiredValue<T>(values: T[], value: T) {
    if (values.includes(value) && values.length <= 1) return values;
    return toggleValue(values, value);
}

function formatDSConceptLabel(value: string) {
    if (value === "ml_fundamentals") return "ML Fundamentals";
    return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

const INTERVIEW_TYPES: InterviewTypeMeta[] = [
    {
        id: "full_interview",
        label: "SDE Interview",
        duration: "90 mins",
        icon: "assignment",
        description: "End-to-end interview simulation covering intro, coding, fundamentals, and wrap-up in one guided session.",
        details: [
            "Choose which modules to include: resume deep-dive, coding, CS fundamentals, and wrap-up",
            "Coding can be focused by topic, such as DP, graphs, binary search, trees, and more",
            "CS fundamentals can be focused by OS, CN, DBMS, and OOPS, with an optional SQL round",
            "Enabled coding rounds use the live IDE and SQL rounds use the SQL editor",
            "Receive a detailed performance report with scores across all areas",
        ],
        bestFor: "Candidates preparing for on-site or final-round interviews at top tech companies.",
    },
    {
        id: "coding",
        label: "Coding Interview",
        duration: "40 mins",
        icon: "code",
        description: "Focused DSA practice with a live coding IDE, guided hints, and feedback on logic and efficiency.",
        details: [
            "Choose coding question topics such as DP, graphs, binary search, trees, arrays, and strings",
            "Optionally override coding difficulty, or leave it on auto based on your profile",
            "Code your solution in a full-featured IDE with 40+ languages",
            "The AI interviewer guides you through hints and follow-ups",
            "Discuss time and space complexity after solving",
            "Get feedback on code quality, efficiency, and problem-solving approach",
        ],
        bestFor: "Sharpening your DSA skills and practicing under timed pressure.",
    },
    {
        id: "cs_fundamentals",
        label: "CS Fundamentals",
        duration: "25 mins",
        icon: "school",
        description: "Sharpen core CS concepts across OS, DBMS, networks, and OOP with adaptive, interview-style questions.",
        details: [
            "Choose the broad CS topics you want: OS, CN, DBMS, and OOPS",
            "Enable or disable the SQL round separately from theory topics",
            "Choose how many questions to ask per selected topic",
            "Mix of conceptual and scenario-based questions",
            "Tests depth of understanding, not just memorization",
        ],
        bestFor: "Candidates who want to solidify their CS theory knowledge.",
    },
    {
        id: "system_design",
        label: "System Design Interview",
        duration: "30 mins",
        icon: "hub",
        description: "Design scalable systems with a structured flow through requirements, architecture, trade-offs, and scale.",
        details: [
            "Receive a real-world system design problem (e.g., design Twitter, URL shortener)",
            "Walk through requirements gathering and scope definition",
            "Discuss high-level architecture, database choices, and trade-offs",
            "Dive into scaling strategies, caching, and load balancing",
            "This standalone round keeps the flow fixed, with no module or difficulty selection",
        ],
        bestFor: "Senior engineers and anyone targeting SDE2+ roles at top companies.",
    },
    {
        id: "behavioural",
        label: "Behavioural Interview",
        duration: "20 mins",
        icon: "psychology",
        description: "Practice STAR-based behavioural answers focused on ownership, teamwork, communication, and impact.",
        details: [
            "Questions based on Amazon LP-style and Google behavioural patterns",
            "Practice structuring answers with Situation, Task, Action, Result",
            "Covers teamwork, conflict resolution, ownership, and leadership",
            "AI provides feedback on clarity, structure, and impact of your stories",
            "This standalone round keeps the behavioural flow fixed without module selection",
        ],
        bestFor: "Anyone who struggles with the \"Tell me about a time...\" questions.",
    },
    {
        id: "gen_ai_role",
        label: "Gen AI Interview",
        duration: "50 mins",
        icon: "auto_awesome",
        description: "Master GenAI fundamentals, coding, and ethical responsibility to excel in your upcoming technical interview.",
        details: [
            "Phase 1: Resume deep-dive — LLM probes your real AI/ML projects (model choice, RAG vs fine-tuning, evaluation)",
            "Phase 2: GenAI concept check — 3–4 questions from a curated bank (transformers, RAG, prompt engineering, MLOps)",
            "Phase 3: Live GenAI coding task in the IDE — AI tool usage explicitly allowed and evaluated",
            "Phase 4: AI responsibility scenario + company Q&A wrap-up",
        ],
        bestFor: "Engineers applying for GenAI, LLM, or applied AI roles at product companies.",
    },
    {
        id: "data_science_role",
        label: "Data Science Interview",
        duration: "70 mins",
        icon: "analytics",
        description: "Practice for building expertise in Applied statistics, SQL, and deep learning and solving complex data coding assessments.",
        details: [
            "Choose which DS modules to include and focus concepts by category",
            "Resume deep-dive probes real DS/ML project ownership, data quality, modeling choices, and business impact",
            "SQL problem sets open in the SQL editor against a realistic business schema",
            "Python/Pandas coding runs in the IDE as a live data analysis task",
            "Business metrics case closes with measurement, experimentation, and trade-off reasoning",
        ],
        bestFor: "Data Scientists, ML Engineers, and Analytics Engineers applying for DS roles.",
    },
    {
        id: "pm_role",
        label: "Product Manager Interview",
        duration: "40 mins",
        icon: "inventory_2",
        description: "Conquer this comprehensive five-phase challenge by mastering resume deep-dives, CIRCLES-driven cases, and rigorous strategy sessions to showcase your product leadership.",
        details: [
            "Choose which PM modules to include: resume ownership, product case, PM concepts, strategy, and behavioral",
            "Live product case uses a structured notepad and may introduce a constraint mid-session",
            "PM concepts cover metric definition, prioritization, interpretation, and experiment design",
            "Product strategy probes market reasoning with follow-up challenges",
            "Behavioral round focuses on cross-functional conflict, launches, and ownership stories",
        ],
        bestFor: "Product Managers and APMs preparing for PM interviews at product companies.",
    },
    {
        id: "problem_solving_case",
        label: "Problem Solving Interview",
        duration: "25 mins",
        icon: "extension",
        description: "Practice interview puzzle and case reasoning with hints, twists, and conviction probes.",
        details: [
            "One structured analytical case rather than a DSA coding task",
            "The interviewer tests assumptions, decomposition, and logical reasoning",
            "Hints are introduced progressively and your absorption is evaluated",
            "A twist or changed constraint checks adaptability under pressure",
            "This standalone case keeps the flow fixed and focuses the report on reasoning, communication, and conviction",
        ],
        bestFor: "Candidates who want to build calm, structured reasoning for non-coding problem-solving rounds.",
    },
    {
        id: "resume_round",
        label: "Resume Screening Interview",
        duration: "30 mins",
        icon: "badge",
        description: "A focused resume-based interview that checks how clearly you can explain the claims, projects, experience, education, and skills in your selected resume.",
        details: [
            "Select or upload a resume before starting the round",
            "Project and experience follow-ups focus on your role, decisions, implementation, trade-offs, outcomes, and verification",
            "Expect tough project follow-ups that reveal where your understanding is shallow, unclear, or unsupported",
            "AI-assisted, tutorial, or team-based work should be explained honestly: what you used, changed, verified, and personally owned",
            "Report summarizes screening readiness, strong evidence, weak or unsupported claims, possible resume risks, and answer-bank improvements",
        ],
        bestFor: "Candidates who want to practice defending their resume claims and turn vague resume points into interview-ready stories.",
    },
];

const INTERVIEW_TYPE_QUERY_MAP: Record<string, InterviewCostKey> = {
    "full-interview": "full_interview",
    full_interview: "full_interview",
    coding: "coding",
    "cs-fundamentals": "cs_fundamentals",
    cs_fundamentals: "cs_fundamentals",
    "system-design": "system_design",
    system_design: "system_design",
    behavioural: "behavioural",
    behavioral: "behavioural",
    "gen-ai": "gen_ai_role",
    gen_ai_role: "gen_ai_role",
    "data-science": "data_science_role",
    data_science_role: "data_science_role",
    "product-management": "pm_role",
    pm_role: "pm_role",
};

function normalizeInterviewType(value: string | null): InterviewCostKey | "" {
    if (!value) return "";
    return INTERVIEW_TYPE_QUERY_MAP[value] || "";
}

export default function SetupPage() {
    useEffect(() => { document.title = "Interview Setup | Mockr"; }, []);
    const router = useRouter();
    const searchParams = useSearchParams();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { user } = useAuth();
    const { snapshot, loading: billingLoading } = useBilling();
    const { handleFeatureError, UpgradeModal: FeatureLimitModal } = useFeatureLimit();

    // Phone verification modal state
    const [showPhoneVerificationModal, setShowPhoneVerificationModal] = useState(false);
    const [showPhoneVerificationWidget, setShowPhoneVerificationWidget] = useState(false);

    // Form state
    const [selectedType, setSelectedType] = useState<InterviewCostKey | "">("");
    const [enabledStages, setEnabledStages] = useState<InterviewStage[]>([]);
    const [dsaTopics, setDsaTopics] = useState<string[]>([]);
    const [csTopics, setCsTopics] = useState<string[]>(CS_TOPICS);
    const [includeSqlRound, setIncludeSqlRound] = useState(true);
    const [questionCountPerTopic, setQuestionCountPerTopic] = useState(2);
    const [genAIConcepts, setGenAIConcepts] = useState<string[]>([]);
    const [dsConcepts, setDsConcepts] = useState<string[]>([]);
    const [stageDifficulty, setStageDifficulty] = useState<Record<string, string>>({});

    // Resume state
    const [resumeFile, setResumeFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [resumeAnalysis, setResumeAnalysis] = useState<any>(null);
    const [resumeId, setResumeId] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);

    // Existing resumes
    const [existingResumes, setExistingResumes] = useState<any[]>([]);
    const [loadingResumes, setLoadingResumes] = useState(true);
    const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

    // Session creation state
    const [starting, setStarting] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);
    const [upgradeOpen, setUpgradeOpen] = useState(false);

    // Info modal
    const [infoModalType, setInfoModalType] = useState<string | null>(null);
    const infoType = INTERVIEW_TYPES.find((t) => t.id === infoModalType);

    // Add Resume menu
    const [showAddMenu, setShowAddMenu] = useState(false);

    // Delete resume state
    const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const selectedTypeInfo = selectedType
        ? INTERVIEW_TYPES.find((type) => type.id === selectedType)
        : null;
    const selectedModules = selectedType ? MODULE_OPTIONS[selectedType] || [] : [];
    const visibleModules = selectedModules.filter((module) => !isInternalStage(selectedType, module.stage));
    const hideStageModuleToggles = selectedType === "coding" ||
        selectedType === "cs_fundamentals" ||
        selectedType === "system_design" ||
        selectedType === "behavioural" ||
        selectedType === "problem_solving_case";
    const enabledStageSet = new Set(enabledStages);
    const hasQuestionFocusControls = enabledStageSet.has("DSA") ||
        enabledStageSet.has("FUNDAMENTALS") ||
        enabledStageSet.has("GEN_AI_CONCEPTS") ||
        enabledStageSet.has("DS_CONCEPTS");
    const selectedPracticeCount = selectedModules.filter((module) => !isInternalStage(selectedType, module.stage) && module.stage !== "CLOSING" && enabledStageSet.has(module.stage)).length;
    const getEstimatedMinutes = () => {
        if (!selectedType) return 0;
        if (selectedType === "full_interview") {
            let mins = 0;
            const hasStage = (stage: InterviewStage) => enabledStageSet.has(stage);
            if (hasStage("DSA")) mins += 40;
            if (hasStage("FUNDAMENTALS")) {
                mins += 34; // CS Theory (24) + SQL (10)
            }
            if (hasStage("CLOSING")) mins += 3;
            const hasResume = resumeId && hasStage("INTRO");
            const cappedNonResume = Math.min(mins, 80);
            return Math.min(90, Math.max(5, Math.round((cappedNonResume + (hasResume ? 10 : 0)) / 5) * 5));
        }
        return selectedModules
            .filter((module) => enabledStageSet.has(module.stage) && !isInternalStage(selectedType, module.stage))
            .reduce((sum, module) => sum + module.minutes, 0);
    };
    const estimatedMinutes = getEstimatedMinutes();
    const isCustomModulePlan = selectedModules.length > 0 && enabledStages.length !== selectedModules.length;
    const resumeModuleEnabled = enabledStageSet.has("INTRO") || selectedType === "resume_round";
    const selectedCost = selectedType ? interviewCreditCost(selectedType) : 0;
    const walletTotal = snapshot?.wallet.total ?? 0;
    const hasInsufficientCredits = Boolean(
        selectedType && snapshot && walletTotal < estimatedMinutes
    );
    const currentPlanName = snapshot
        ? PLAN_ENTITLEMENTS[snapshot.plan].displayName
        : "Free";

    useEffect(() => {
        const typeFromUrl = normalizeInterviewType(searchParams.get("type"));
        if (typeFromUrl) {
            setSelectedType(typeFromUrl);
        }
    }, [searchParams]);

    // ── Check if phone verification popup should be shown ───────────────────
    useEffect(() => {
        // Show phone verification modal if user has 0 interview minutes and phone is not verified
        if (!billingLoading && snapshot && user) {
            const hasZeroCredits = snapshot.wallet.total === 0;
            const phoneNotVerified = !user.mobileVerified;

            if (hasZeroCredits && phoneNotVerified) {
                setShowPhoneVerificationModal(true);
            }
        }
    }, [billingLoading, snapshot, user]);

    useEffect(() => {
        if (!selectedType) {
            setEnabledStages([]);
            return;
        }
        setEnabledStages((MODULE_OPTIONS[selectedType] || []).map((module) => module.stage));
    }, [selectedType]);

    // ── Fetch existing resumes on mount ───────────────────
    useEffect(() => {
        (async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) return;
                const res = await api.get<{ resumes: any[] }>("/resumes", token);
                setExistingResumes(res.resumes || []);

                // Fetch presigned URLs for previews
                if (res.resumes && res.resumes.length > 0) {
                    const urls: Record<string, string> = {};
                    await Promise.all(res.resumes.map(async (r: any) => {
                        try {
                            const urlRes = await api.get<{ url: string }>(`/resumes/${r.id}/download`, token);
                            urls[r.id] = urlRes.url;
                        } catch(e) {
                            // ignore
                        }
                    }));
                    setSignedUrls(urls);
                }
            } catch {
                // silently fail — user can still upload
            } finally {
                setLoadingResumes(false);
            }
        })();
    }, []);

    // ── Select an existing resume ─────────────────────────
    const selectExistingResume = (resume: any) => {
        if (resumeId === resume.id) {
            setResumeId(null);
            setResumeAnalysis(null);
        } else {
            setResumeId(resume.id);
            setResumeAnalysis(resume.analysis || null);
        }
        setResumeFile(null);
        setUploadError(null);
    };

    const toggleStage = (stage: InterviewStage) => {
        if (isLockedStage(selectedType, stage)) return;

        setEnabledStages((prev) => {
            const isEnabled = prev.includes(stage);
            const next = isEnabled
                ? prev.filter((item) => item !== stage)
                : [...prev, stage];

            const moduleOrder = selectedType ? (MODULE_OPTIONS[selectedType] || []).map((module) => module.stage) : [];
            const ordered = moduleOrder.filter((item) => next.includes(item));
            const hasPractice = ordered.some((item) => !isInternalStage(selectedType, item) && item !== "CLOSING");
            return hasPractice ? ordered : prev;
        });
    };

    const buildModuleConfig = () => {
        if (!selectedType || selectedModules.length === 0) return undefined;
        if (selectedType === "resume_round") return undefined;

        const disabledStages = selectedModules
            .map((module) => module.stage)
            .filter((stage) => !enabledStageSet.has(stage));
        const stageOptions: Record<string, any> = {};

        if (enabledStageSet.has("DSA") && (dsaTopics.length > 0 || stageDifficulty.DSA)) {
            stageOptions.DSA = {};
            if (dsaTopics.length > 0) stageOptions.DSA.topics = dsaTopics;
            if (stageDifficulty.DSA) stageOptions.DSA.difficulty = stageDifficulty.DSA;
        }

        if (enabledStageSet.has("FUNDAMENTALS")) {
            stageOptions.FUNDAMENTALS = {
                topics: csTopics,
                includeSQL: includeSqlRound,
                questionCountPerTopic,
            };
        }

        if (enabledStageSet.has("GEN_AI_CONCEPTS") && genAIConcepts.length > 0) {
            stageOptions.GEN_AI_CONCEPTS = {};
            if (genAIConcepts.length > 0) stageOptions.GEN_AI_CONCEPTS.subtopics = genAIConcepts;
        }

        if (enabledStageSet.has("DS_CONCEPTS") && dsConcepts.length > 0) {
            stageOptions.DS_CONCEPTS = {};
            if (dsConcepts.length > 0) stageOptions.DS_CONCEPTS.topics = dsConcepts;
        }

        if (!isCustomModulePlan && Object.keys(stageOptions).length === 0) return undefined;

        return {
            version: 1,
            enabledStages,
            disabledStages,
            source: isCustomModulePlan || Object.keys(stageOptions).length > 0 ? "custom" : "default",
            stageOptions,
        };
    };

    // ── Delete Resume ─────────────────────────────────────────
    const handleDeleteResume = async (resumeIdToDelete: string) => {
        setDeletingResumeId(resumeIdToDelete);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
            const res = await fetch(`${API_BASE}/resumes/${resumeIdToDelete}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Failed to delete resume");
            }

            // Remove from local state
            setExistingResumes((prev) => prev.filter((r) => r.id !== resumeIdToDelete));

            // Clear selection if deleted resume was selected
            if (resumeId === resumeIdToDelete) {
                setResumeId(null);
                setResumeAnalysis(null);
            }

            // Remove signed URL
            setSignedUrls((prev) => {
                const newUrls = { ...prev };
                delete newUrls[resumeIdToDelete];
                return newUrls;
            });
        } catch (err: any) {
            alert(err.message || "Failed to delete resume");
        } finally {
            setDeletingResumeId(null);
            setDeleteConfirmId(null);
        }
    };

    // ── Upload Resume ────────────────────────────────────────
    const handleFileSelect = (file: File) => {
        if (file.type !== "application/pdf") {
            setUploadError("Only PDF files are accepted");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError("Maximum file size is 5MB");
            return;
        }
        setResumeFile(file);
        setUploadError(null);
        uploadResume(file);
    };

    const uploadResume = async (file: File) => {
        setUploading(true);
        setUploadError(null);

        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            const formData = new FormData();
            formData.append("file", file);

            const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
            const res = await fetch(`${API_BASE}/resumes/upload`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Upload failed");
            }

            const result = await res.json();
            setResumeId(result.id);
            setResumeAnalysis(null);
            // Add to existing resumes list so it shows up in the picker
            setExistingResumes((prev) => [
                { id: result.id, fileName: file.name, analysis: null, uploadedAt: new Date().toISOString() },
                ...prev,
            ]);

            // Fetch signed URL for the newly uploaded resume
            try {
                const urlRes = await api.get<{ url: string }>(`/resumes/${result.id}/download`, token);
                setSignedUrls(prev => ({ ...prev, [result.id]: urlRes.url }));
            } catch {
                // ignore
            }

            setUploading(false);
            setShowAddMenu(false);
            return;
        } catch (err: any) {
            setUploadError(err.message || "Failed to upload resume");
            setUploading(false);
        }
    };

    // ── Start Interview ──────────────────────────────────────
    const startInterview = async () => {
        if (!selectedType) {
            setSessionError("Choose an interview type first");
            return;
        }

        if (selectedModules.length > 0 && selectedPracticeCount === 0) {
            setSessionError("Choose at least one module for this interview");
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

        // Check interview minutes BEFORE showing loading screen
        if (hasInsufficientCredits) {
            setSessionError(
                `${selectedTypeInfo?.label || "This interview"} needs ${estimatedMinutes} minute${estimatedMinutes === 1 ? "" : "s"}. You have ${walletTotal}.`
            );
            setUpgradeOpen(true);
            return;
        }

        // Block if upload is still in progress
        if (uploading) {
            setSessionError("Please wait for the resume to finish uploading");
            return;
        }

        setStarting(true);
        setSessionError(null);

        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            // If resume probing is selected and a resume is selected but not yet analyzed, run analysis first
            if (resumeModuleEnabled && resumeId && !resumeAnalysis) {
                setLoadingStatus("Analyzing your resume...");
                const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
                const analyzeRes = await fetchWithLimits(`${API_BASE}/resumes/${resumeId}/analyze`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!analyzeRes.ok) {
                    const err = await analyzeRes.json().catch(() => ({}));
                    throw new Error(err.message || "Failed to analyze resume");
                }

                const analyzeResult = await analyzeRes.json();
                setResumeAnalysis(analyzeResult.analysis);

                // Update local list so future selections skip analysis
                setExistingResumes((prev) =>
                    prev.map((r) => (r.id === resumeId ? { ...r, analysis: analyzeResult.analysis } : r))
                );
            }

            setLoadingStatus("Preparing your interview...");

            const session = await api.post<{ id: string }>(
                "/interviews",
                {
                    mode: "mock",
                    resumeId: resumeModuleEnabled ? resumeId || undefined : undefined,
                    type: selectedType,
                    difficulty: "Medium",
                    language: "Python",
                    moduleConfig: buildModuleConfig(),
                },
                token
            );

            setLoadingStatus("Launching interview room...");
            router.push(`/room/${session.id}`);
        } catch (err: any) {
            // Check if it's a feature limit error
            if (isFeatureLimitError(err)) {
                handleFeatureError(err, "interview_minutes");
            }
            setSessionError(err.message || "Failed to create session");
            setStarting(false);
            setLoadingStatus(null);
        }
    };

    // ── Drop Handler ─────────────────────────────────────────
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    };

    // ── Mouse Enter Handler for Cards ─────────────────────────
    const handleCardMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const fromLeft = x < rect.width / 2;
        e.currentTarget.style.setProperty('--wave-dir', fromLeft ? '1' : '-1');
    };

    const goToCustomize = (typeId: InterviewCostKey) => {
        setSelectedType(typeId);
        setSessionError(null);
        const defaultModules = MODULE_OPTIONS[typeId] || [];
        const defaultEstimatedMinutes = defaultModules
            .filter((module) => !isInternalStage(typeId, module.stage))
            .reduce((sum, module) => sum + module.minutes, 0);
        if (snapshot && walletTotal < defaultEstimatedMinutes) {
            setUpgradeOpen(true);
            return;
        }
        if (typeof window !== "undefined") {
            const journeyStorageKeys: Partial<Record<InterviewCostKey, string>> = {
                cs_fundamentals: "mockr-cs-fundamentals-customize",
                full_interview: "mockr-full-interview-customize",
                coding: "mockr-coding-customize",
                gen_ai_role: "mockr-gen-ai-customize",
                data_science_role: "mockr-role-interview-customize-data_science_role",
                pm_role: "mockr-role-interview-customize-pm_role",
                problem_solving_case: "mockr-simple-interview-customize-problem_solving_case",
                resume_round: "mockr-simple-interview-customize-resume_round",
                system_design: "mockr-short-interview-customize-system_design",
                behavioural: "mockr-short-interview-customize-behavioural",
            };
            const key = journeyStorageKeys[typeId];
            if (key) window.sessionStorage.removeItem(key);
        }
        const params = new URLSearchParams({ type: typeId });
        if (resumeId) params.set("resumeId", resumeId);
        router.push(`/interviews/ai/customize?${params.toString()}`);
    };

    return (
        <div className="flex-1 overflow-auto">
            {/* Full-screen loading overlay */}
            {starting && (
                <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-white dark:bg-lc-bg">
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative">
                            <div className="size-16 border-[3px] border-slate-200 dark:border-lc-border rounded-full" />
                            <div className="absolute inset-0 size-16 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                        <div className="text-center space-y-2">
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Setting up your interview</h2>
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
                description={
                    selectedTypeInfo
                        ? `${selectedTypeInfo.label} needs ${estimatedMinutes} minute${estimatedMinutes === 1 ? "" : "s"}. You have ${walletTotal}.`
                        : "Add minutes or upgrade to keep practicing with mock interviews."
                }
            />

            <PageHeader
                showBack
                backUrl="/interviews"
                titleNode={
                    <AIInterviewTabs active="setup" />
                }
            >
                {!billingLoading && snapshot && (
                    <Link
                        href="/settings/billing"
                        className="group flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:text-primary dark:hover:text-primary transition-colors"
                        title="Interview minutes remaining - click to manage"
                    >
                        <ClockIcon size={24} className="transition-transform group-hover:rotate-12" />
                        <span className="text-[18px] font-bold tabular-nums">
                            {snapshot.wallet.total}
                        </span>
                        <span className="text-[15px] font-semibold text-slate-500 dark:text-slate-400 group-hover:text-primary/80 transition-colors">
                            mins left
                        </span>
                    </Link>
                )}
            </PageHeader>

            <main className="flex-1 flex flex-col w-full py-12 px-6 lg:px-8 pb-16 space-y-12 text-left">
                {/* Resume selection now lives on the customization step. */}
                {false && (
                <section className="space-y-6">
                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                        Select or Upload Resume
                    </h2>

                    <div className="flex gap-6 overflow-x-auto pb-8 pt-6 -mt-6 custom-scrollbar snap-x px-2 -mx-2">
                        {existingResumes.map((r) => (
                            <div
                                key={r.id}
                                onClick={() => selectExistingResume(r)}
                                onMouseEnter={handleCardMouseEnter}
                                className={`group relative snap-center flex-none w-[160px] md:w-[220px] aspect-[4/5] rounded-2xl border-2 p-3 md:p-5 text-left flex flex-col transition-all duration-300 ease-out cursor-pointer hover:-translate-y-3 hover:shadow-xl hover:shadow-primary/10 overflow-hidden before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] before:transition-transform before:duration-700 before:ease-in-out ${resumeId === r.id
                                    ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                                    : "border-slate-200 dark:border-lc-border bg-white/70 dark:bg-lc-surface/70 backdrop-blur-sm hover:border-primary/50"
                                }`}
                            >
                                {resumeId === r.id && (
                                    <div className="absolute -top-3 -right-3 size-8 z-[10] bg-primary rounded-full flex items-center justify-center shadow-lg text-white">
                                        <span className="material-symbols-outlined text-sm">check</span>
                                    </div>
                                )}

                                {/* Delete button - appears on hover */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteConfirmId(r.id);
                                    }}
                                    className="absolute top-3 right-3 z-[10] size-7 bg-white dark:bg-lc-surface rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-red-50 dark:hover:bg-red-500/10 border border-slate-200 dark:border-lc-border"
                                    title="Delete resume"
                                >
                                    <span className="material-symbols-outlined text-[16px] text-slate-400 hover:text-red-500">delete</span>
                                </button>

                                {/* Preview pseudo-box */}
                                <div className="flex-1 w-full bg-white dark:bg-lc-bg rounded-lg border border-slate-100 dark:border-lc-border mb-4 overflow-hidden flex flex-col p-1 gap-1 group-hover:scale-105 transition-transform duration-300 shadow-inner group-hover:bg-white relative">
                                    {signedUrls[r.id] ? (
                                        <div className="absolute inset-0 bg-white overflow-hidden rounded-lg pointer-events-none">
                                            <iframe
                                                src={`${signedUrls[r.id]}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                                className="w-full h-[300%] -mt-2 border-none bg-white pointer-events-none"
                                                scrolling="no"
                                                tabIndex={-1}
                                            />
                                            {/* Mask to ensure scrolling indicators are hidden */}
                                            <div className="absolute inset-0 bg-transparent z-10"></div>
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
                                    <p className="font-bold text-slate-800 dark:text-white truncate" title={r.fileName}>{r.fileName}</p>
                                    <p className="text-[11px] text-slate-400 mt-1 uppercase font-bold tracking-wider">
                                        {new Date(r.uploadedAt).toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        ))}


                        {/* Add New Resume Card */}
                        {(
                            <button
                                onClick={() => setShowAddMenu(true)}
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
                        )}
                    </div>
                </section>
                )}

                {/* Interview Type Section */}
                <section className="space-y-6 pt-4">
                    <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                        Select Interview Type
                    </h2>

                    <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2 snap-x md:grid md:grid-cols-5 md:gap-4 md:overflow-visible md:pb-0 md:mx-0 md:px-0">
                        {INTERVIEW_TYPES.map((type) => {
                            return (
                            <div
                                key={type.id}
                                onClick={() => goToCustomize(type.id)}
                                onMouseEnter={handleCardMouseEnter}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        goToCustomize(type.id);
                                    }
                                }}
                                className={`group relative snap-center flex-none w-[220px] md:w-auto min-h-[245px] p-4 md:p-4 rounded-2xl border-2 text-left flex flex-col transition-all duration-300 ease-out cursor-pointer hover:-translate-y-2 overflow-hidden before:pointer-events-none before:absolute before:inset-0 before:w-[200%] before:h-full before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] dark:before:via-white/[0.05] before:to-transparent hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] before:transition-transform before:duration-700 before:ease-in-out shadow-sm hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] ${selectedType === type.id
                                    ? "border-primary bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 dark:from-[#303030] dark:via-[#282828] dark:to-[#1e1e1e] shadow-[0_20px_40px_-15px_rgba(37,99,235,0.3)] ring-4 ring-primary/20"
                                    : "border-slate-200 dark:border-white/10 bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 dark:from-[#2a2a2a] dark:via-[#222222] dark:to-[#1a1a1a] dark:hover:from-[#303030] dark:hover:to-[#1e1e1e] backdrop-blur-sm hover:border-primary/50"
                                    }`}
                            >
                                {selectedType === type.id && (
                                    <div className="absolute top-4 right-4">
                                        <span className="material-symbols-outlined text-primary text-xl">
                                            check_circle
                                        </span>
                                    </div>
                                )}

                                <div className="relative z-10 flex flex-1 origin-top flex-col items-start gap-1.5 transition-transform duration-300 w-full">
                                    <div className="flex min-h-[38px] items-start w-full pr-6">
                                        <h4 className="line-clamp-2 font-bold font-nunito text-[16px] text-slate-900 dark:text-[#eff1f6] leading-tight">{type.label}</h4>
                                    </div>

                                    <p className="min-h-0 flex-1 w-full text-left text-[13px] leading-snug text-slate-600 line-clamp-5 dark:text-slate-400">
                                        {type.description}
                                    </p>

                                    <div className="w-full flex items-center justify-end pt-0.5">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setInfoModalType(type.id);
                                            }}
                                            className="cursor-pointer text-[12px] font-bold text-blue-700/70 dark:text-blue-300/75 hover:text-blue-700/90 dark:hover:text-blue-300"
                                        >
                                            Know more
                                        </button>
                                    </div>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                </section>

                {false && selectedModules.length > 0 && (
                    <section className="space-y-4 pt-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                    {hideStageModuleToggles ? "Interview Focus" : "Customize Modules"}
                                </h2>
                                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                    {hideStageModuleToggles
                                        ? "This Interview uses fixed module flow."
                                        : `${selectedPracticeCount} module${selectedPracticeCount === 1 ? "" : "s"} selected - about ${estimatedMinutes} min`}
                                </p>
                            </div>
                            {!hideStageModuleToggles && (
                                <button
                                    type="button"
                                    onClick={() => setEnabledStages(selectedModules.map((module) => module.stage))}
                                    className="text-sm font-bold text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200"
                                >
                                    Restore full flow
                                </button>
                            )}
                        </div>

                        {!hideStageModuleToggles && (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pt-2">
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
                                            className={`group flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                                                enabled
                                                    ? "border-blue-500 bg-blue-50/70 dark:border-blue-400/70 dark:bg-blue-500/10"
                                                    : "border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface opacity-70"
                                            } ${locked ? "cursor-default" : "cursor-pointer hover:-translate-y-0.5 hover:shadow-md"}`}
                                        >
                                            <span className={`material-symbols-outlined mt-0.5 text-[22px] ${
                                                enabled ? "text-blue-600 dark:text-blue-300" : "text-slate-400"
                                            }`}>
                                                {enabled ? "check_circle" : "radio_button_unchecked"}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-2">
                                                    <span className="font-bold text-sm text-slate-900 dark:text-white">{module.label}</span>
                                                    {required && (
                                                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-lc-hover dark:text-slate-400">
                                                            Required
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="mt-1 block text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                                                    {module.description}
                                                </span>
                                            </span>
                                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                                {module.minutes}m
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {hideStageModuleToggles && (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                {visibleModules.map((module) => (
                                    <div
                                        key={module.stage}
                                        className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white/70 p-4 text-left dark:border-lc-border dark:bg-lc-surface/70"
                                    >
                                        <span className="material-symbols-outlined mt-0.5 text-[22px] text-blue-600 dark:text-blue-300">
                                            check_circle
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-2">
                                                <span className="font-bold text-sm text-slate-900 dark:text-white">{module.label}</span>
                                                {!module.optional && (
                                                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-lc-hover dark:text-slate-400">
                                                        Fixed
                                                    </span>
                                                )}
                                            </span>
                                            <span className="mt-1 block text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                                                {module.description}
                                            </span>
                                        </span>
                                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            {module.minutes}m
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {hasQuestionFocusControls && (
                            <div className="space-y-5 rounded-xl border border-slate-200 bg-white/70 p-4 dark:border-lc-border dark:bg-lc-surface/70">
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Question focus</h3>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        Choose broad categories where the question bank supports reliable filtering.
                                    </p>
                                </div>

                                {enabledStageSet.has("DSA") && (
                                    <div className="space-y-2">
                                        <p className="text-sm font-bold text-slate-800 dark:text-white">Coding topics</p>
                                        <div className="flex flex-wrap gap-2">
                                            {DSA_TOPICS.map((topic) => (
                                                <button
                                                    key={topic}
                                                    type="button"
                                                    onClick={() => setDsaTopics((prev) => toggleValue(prev, topic))}
                                                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                                                        dsaTopics.includes(topic)
                                                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                                                            : "border-slate-200 text-slate-500 hover:border-blue-300 dark:border-lc-border"
                                                    }`}
                                                >
                                                    {topic}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {enabledStageSet.has("FUNDAMENTALS") && (
                                    <div className="space-y-3">
                                        <p className="text-sm font-bold text-slate-800 dark:text-white">CS fundamentals topics</p>
                                        <div className="flex flex-wrap gap-2">
                                            {CS_TOPICS.map((topic) => {
                                                const isLastSelected = csTopics.includes(topic) && csTopics.length <= 1;
                                                return (
                                                    <button
                                                        key={topic}
                                                        type="button"
                                                        onClick={() => setCsTopics((prev) => toggleRequiredValue(prev, topic))}
                                                        disabled={isLastSelected}
                                                        className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                                                            csTopics.includes(topic)
                                                                ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                                                                : "border-slate-200 text-slate-500 hover:border-blue-300 dark:border-lc-border"
                                                        } disabled:cursor-not-allowed disabled:opacity-60`}
                                                    >
                                                        {topic}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-lc-border dark:bg-lc-bg dark:text-slate-300">
                                                <span>SQL round</span>
                                                <input
                                                    type="checkbox"
                                                    checked={includeSqlRound}
                                                    onChange={(e) => setIncludeSqlRound(e.target.checked)}
                                                />
                                            </label>
                                            <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-lc-border dark:bg-lc-bg dark:text-slate-300">
                                                <span>Questions per topic</span>
                                                <select
                                                    value={questionCountPerTopic}
                                                    onChange={(e) => setQuestionCountPerTopic(Number(e.target.value))}
                                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-lc-border dark:bg-lc-surface"
                                                >
                                                    <option value={1}>1</option>
                                                    <option value={2}>2</option>
                                                    <option value={3}>3</option>
                                                </select>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {enabledStageSet.has("GEN_AI_CONCEPTS") && (
                                    <div className="space-y-2">
                                        <p className="text-sm font-bold text-slate-800 dark:text-white">GenAI concept focus</p>
                                        <div className="flex flex-wrap gap-2">
                                            {GENAI_SUBTOPICS.map((topic) => (
                                                <button
                                                    key={topic}
                                                    type="button"
                                                    onClick={() => setGenAIConcepts((prev) => toggleValue(prev, topic))}
                                                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                                                        genAIConcepts.includes(topic)
                                                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                                                            : "border-slate-200 text-slate-500 hover:border-blue-300 dark:border-lc-border"
                                                    }`}
                                                >
                                                    {topic}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {enabledStageSet.has("DS_CONCEPTS") && (
                                    <div className="space-y-2">
                                        <p className="text-sm font-bold text-slate-800 dark:text-white">DS concept focus</p>
                                        <div className="flex flex-wrap gap-2">
                                            {DS_CONCEPT_CATEGORIES.map((topic) => (
                                                <button
                                                    key={topic}
                                                    type="button"
                                                    onClick={() => setDsConcepts((prev) => toggleValue(prev, topic))}
                                                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                                                        dsConcepts.includes(topic)
                                                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                                                            : "border-slate-200 text-slate-500 hover:border-blue-300 dark:border-lc-border"
                                                    }`}
                                                >
                                                    {formatDSConceptLabel(topic)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {enabledStageSet.has("DSA") && (
                                    <div className="space-y-2">
                                        <p className="text-sm font-bold text-slate-800 dark:text-white">Coding difficulty</p>
                                        <div className="flex flex-wrap gap-3">
                                            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                                                DSA
                                                <select
                                                    value={stageDifficulty.DSA || ""}
                                                    onChange={(e) => setStageDifficulty((prev) => ({ ...prev, DSA: e.target.value }))}
                                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-lc-border dark:bg-lc-surface"
                                                >
                                                    <option value="">Auto</option>
                                                    {DIFFICULTIES.map((difficulty) => (
                                                        <option key={difficulty} value={difficulty}>{difficulty}</option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {!resumeModuleEnabled && resumeId && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                Resume probing is off for this run, so the selected resume will not be analyzed or used.
                            </div>
                        )}
                    </section>
                )}

                {sessionError && (
                <div className="relative z-10 flex w-full items-center gap-4 pt-2">
                    <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 rounded-lg border border-red-100 dark:border-red-500/20">
                        <span className="material-symbols-outlined text-red-500 text-sm">error</span>
                        <span className="text-sm font-medium text-red-600 dark:text-red-400">{sessionError}</span>
                    </div>
                </div>
                )}
            </main>

            <Footer />

            {/* File input lives outside the modal so closing the modal doesn't unmount it before the picker opens */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                    e.target.value = "";
                }}
            />

            {/* Add Resume Menu Modal */}
            {showAddMenu && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setShowAddMenu(false)}
                    />
                    <div className="relative w-full max-w-2xl bg-white dark:bg-lc-surface rounded-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] dark:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] border border-slate-200/60 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200 p-8 flex flex-col">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="font-nunito font-bold text-2xl text-slate-900 dark:text-white tracking-tight">Add your resume</h3>
                            <button onClick={() => setShowAddMenu(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer bg-slate-100 dark:bg-lc-bg hover:bg-slate-200 dark:hover:bg-slate-800 p-2 rounded-xl">
                                <span className="material-symbols-outlined text-lg">close</span>
                            </button>
                        </div>

                        {uploading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                <p className="text-slate-600 dark:text-slate-300 font-semibold text-sm">Uploading resume...</p>
                            </div>
                        ) : (
                        <div className="relative flex flex-col pl-12 py-2 group/modal">
                            {/* Option 1: Upload Area (Bigger) */}
                            <div className="relative mb-6">
                                {/* Continuous Background Line for Top Half gap */}
                                <div className="absolute -left-[40px] top-[-30px] bottom-[-24px] w-[2px] bg-slate-200 dark:bg-slate-700" />

                                {/* Blue Wave Wrapper - stops at connection junction */}
                                <div className="absolute -left-[40px] top-[-30px] bottom-1/2 w-[2px] overflow-hidden z-10">
                                    <div className="absolute inset-0 bg-blue-500 scale-y-0 origin-top group-has-[.group\/upload:hover]/modal:scale-y-100 transition-transform duration-500 ease-in-out" />
                                </div>

                                {/* Green Wave Wrapper - goes entirely past Option 1 down to margin */}
                                <div className="absolute -left-[40px] top-[-30px] bottom-[-24px] w-[2px] overflow-hidden z-10 pointer-events-none">
                                    <div className="absolute inset-0 bg-emerald-500 scale-y-0 origin-top group-has-[.group\/latex:hover]/modal:scale-y-100 transition-transform duration-[300ms] ease-linear" />
                                </div>

                                {/* Horizontal connector to Upload */}
                                <div className="absolute -left-[38px] top-1/2 w-[38px] h-[2px] bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                    {/* Blue wave going right */}
                                    <div className="absolute inset-0 bg-blue-500 -translate-x-full group-has-[.group\/upload:hover]/modal:translate-x-0 transition-transform duration-500 ease-in-out delay-0 group-has-[.group\/upload:hover]/modal:delay-100" />
                                </div>
                                {/* Junction dot */}
                                <div className="absolute -left-[43px] top-1/2 size-[10px] bg-slate-400 dark:bg-slate-500 group-has-[.group\/upload:hover]/modal:bg-blue-500 rounded-full -translate-y-1/2 shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_rgba(15,23,42,1)] z-10 transition-colors duration-500 delay-0 group-has-[.group\/upload:hover]/modal:delay-100" />

                                <div
                                    className="relative group/upload w-full p-8 md:p-10 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-lc-bg/20 hover:bg-blue-500/5 transition-all text-center cursor-pointer min-h-[220px] flex flex-col items-center justify-center overflow-hidden"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => {
                                        fileInputRef.current?.click();
                                    }}
                                >
                                    {/* Wave border effect using absolute pseudo element */}
                                    <div className="absolute inset-[-2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent -translate-x-full group-hover/upload:translate-x-[200%] transition-transform duration-1000 ease-in-out opacity-0 group-hover/upload:opacity-100 delay-200 pointer-events-none" />
                                    {/* Inner white background to cover the solid block from above so only borders glow */}
                                    <div className="absolute inset-[2px] rounded-[14px] bg-slate-50 dark:bg-lc-bg/90 pointer-events-none transition-colors group-hover/upload:bg-blue-50/50 dark:group-hover/upload:bg-blue-900/10" />

                                    <div className="relative z-10 size-16 bg-white dark:bg-lc-surface rounded-full flex items-center justify-center shadow-sm text-slate-400 group-hover/upload:text-blue-500 group-hover/upload:scale-110 transition-all duration-500 mb-4 border border-slate-100 dark:border-lc-border">
                                        <span className="material-symbols-outlined text-3xl z-10">cloud_upload</span>
                                        <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl opacity-0 group-hover/upload:opacity-100 transition-opacity duration-500" />
                                    </div>
                                    <h4 className="relative z-10 font-bold text-slate-800 dark:text-slate-200 group-hover/upload:text-blue-500 mb-2 text-lg font-nunito transition-colors">
                                        Upload a PDF Resume
                                    </h4>
                                    <p className="relative z-10 text-sm text-slate-500 dark:text-slate-400 max-w-[250px] mx-auto leading-relaxed">
                                        Drag and drop your file here, or click to browse from your computer <br/> <span className="text-[10px] opacity-70 mt-2 block">(Max 5MB)</span>
                                    </p>
                                </div>
                            </div>

                            {/* Option 2: Latex Area */}
                            <div className="relative w-full flex">
                                {/* Background Line bridging to Option 2 center */}
                                <div className="absolute -left-[40px] top-0 bottom-1/2 w-[2px] bg-slate-200 dark:bg-slate-700" />

                                {/* Green Wave Wrapper - second half! Starts delayed to simulate single flowing line */}
                                <div className="absolute -left-[40px] top-0 bottom-1/2 w-[2px] overflow-hidden z-10 pointer-events-none">
                                    <div className="absolute inset-0 bg-emerald-500 scale-y-0 origin-top group-has-[.group\/latex:hover]/modal:scale-y-100 transition-transform duration-[200ms] ease-linear delay-0 group-has-[.group\/latex:hover]/modal:delay-[300ms]" />
                                </div>

                                {/* Horizontal connector to Latex */}
                                <div className="absolute -left-[38px] top-1/2 w-[38px] h-[2px] bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                    <div className="absolute inset-0 bg-emerald-500 -translate-x-full group-has-[.group\/latex:hover]/modal:translate-x-0 transition-transform duration-[300ms] ease-in-out delay-0 group-has-[.group\/latex:hover]/modal:delay-[500ms]" />
                                </div>
                                {/* Node dot */}
                                <div className="absolute -left-[43px] top-1/2 size-[10px] bg-slate-400 dark:bg-slate-500 group-has-[.group\/latex:hover]/modal:bg-emerald-500 rounded-full -translate-y-1/2 shadow-[0_0_0_4px_rgba(255,255,255,1)] dark:shadow-[0_0_0_4px_rgba(15,23,42,1)] z-10 transition-colors duration-300 delay-0 group-has-[.group\/latex:hover]/modal:delay-[500ms]" />

                                <button
                                    onClick={() => {
                                        setShowAddMenu(false);
                                        router.push('/resumes?new=true');
                                    }}
                                    className="group/latex relative w-full overflow-hidden p-[2px] rounded-xl bg-slate-200 dark:bg-slate-700 transition-all duration-300 hover:-translate-y-1 active:scale-95"
                                >
                                    {/* Wave border effect sweeping across */}
                                    <div className="absolute inset-[-2px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent -translate-x-full group-hover/latex:translate-x-[200%] transition-transform duration-[1000ms] ease-in-out opacity-0 group-hover/latex:opacity-100 delay-0 group-hover/latex:delay-[650ms]" />

                                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-600 blur-md opacity-0 transition-opacity duration-500" />

                                    <div className="relative flex items-center gap-3 px-6 py-3.5 bg-white dark:bg-lc-surface rounded-[10px] transition-colors duration-300 z-10 w-full hover:bg-emerald-50/50 dark:hover:bg-lc-surface">
                                        <div className="size-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center group-hover/latex:bg-emerald-100 dark:group-hover/latex:bg-emerald-500/20 transition-colors duration-300">
                                            <span className="material-symbols-outlined text-emerald-500 transition-colors duration-300 text-lg">auto_awesome</span>
                                        </div>
                                        <div className="flex flex-col items-start flex-1 text-left">
                                            <span className="font-bold font-nunito text-slate-800 dark:text-slate-100 transition-colors duration-300 leading-tight">
                                                Build with LaTeX
                                            </span>
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400 transition-colors duration-300">
                                                Use our magical AI builder
                                            </span>
                                        </div>
                                        <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 group-hover/latex:text-emerald-500 ml-3 transition-colors duration-300">arrow_forward</span>
                                    </div>
                                </button>
                            </div>
                        </div>
                        )}
                    </div>
                </div>
            )}

            {/* Interview Type Info Modal */}
            {infoType && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setInfoModalType(null)}
                    />
                    {/* Modal */}
                    <div className="relative w-full max-w-2xl bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                        {/* Header */}
                        <div className="relative px-6 pt-6 pb-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">{infoType.label}</h3>
                                        <span className="text-xs font-medium text-slate-500">
                                            {infoType.duration} · {interviewCreditCost(infoType.id)} minute{interviewCreditCost(infoType.id) === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setInfoModalType(null)}
                                    className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-slate-400 text-lg">close</span>
                                </button>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="px-6 pb-6 space-y-5">
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Overview</h4>
                                <p className="text-sm text-slate-600 dark:text-[#ababab] leading-relaxed">
                                    {infoType.description}
                                </p>
                            </div>

                            <div className="space-y-2.5">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">What to expect</h4>
                                <ul className="space-y-2">
                                    {infoType.details.map((detail, i) => (
                                        <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-[#ccc]">
                                            <span className="material-symbols-outlined text-primary text-[16px] mt-0.5 shrink-0">check_circle</span>
                                            {detail}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="p-3 bg-primary/5 rounded-lg border border-primary/10">
                                <div className="flex items-start gap-2">
                                    <span className="material-symbols-outlined text-primary text-[16px] mt-0.5 shrink-0">lightbulb</span>
                                    <div>
                                        <span className="text-xs font-bold text-primary">Best for</span>
                                        <p className="text-xs text-slate-600 dark:text-[#ababab] mt-0.5">{infoType.bestFor}</p>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    setInfoModalType(null);
                                    goToCustomize(infoType.id);
                                }}
                                className="w-full bg-[#FFE500] hover:bg-[#f5dc00] text-[#1a1a1a] font-bold font-nunito py-3 rounded-lg shadow-lg shadow-[#FFE500]/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                            >
                                Select {infoType.label}
                                <span className="material-symbols-outlined text-lg">arrow_forward</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={() => setDeleteConfirmId(null)}
                    />
                    <div className="relative w-full max-w-md bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200 p-6">
                        <div className="flex items-start gap-4 mb-6">
                            <div className="size-12 bg-red-50 dark:bg-red-500/10 rounded-full flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-red-500 text-2xl">warning</span>
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white font-nunito mb-2">Delete Resume?</h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Are you sure you want to delete this resume? This action cannot be undone.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                disabled={deletingResumeId !== null}
                                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDeleteResume(deleteConfirmId)}
                                disabled={deletingResumeId !== null}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {deletingResumeId === deleteConfirmId ? (
                                    <>
                                        <span className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Deleting...
                                    </>
                                ) : (
                                    "Delete"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Feature Limit Modal */}
            <FeatureLimitModal />

            {/* Phone Verification Info Modal */}
            {showPhoneVerificationModal && !showPhoneVerificationWidget && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setShowPhoneVerificationModal(false)}
                    />

                    {/* Modal */}
                    <div className="relative w-full max-w-md bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                        {/* Close button */}
                        <button
                            onClick={() => setShowPhoneVerificationModal(false)}
                            className="absolute top-4 right-4 size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-slate-400 text-lg">close</span>
                        </button>

                        {/* Body */}
                        <div className="px-8 py-8 text-center">
                            {/* Title */}
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                Get free interview minutes
                            </h2>

                            {/* Description */}
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                                Start practicing interviews immediately with your welcome bonus
                            </p>

                            {/* Action buttons */}
                            <div className="space-y-3">
                                <button
                                    onClick={() => {
                                        setShowPhoneVerificationWidget(true);
                                    }}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-blue-600/20 transition-all hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer"
                                >
                                    Verify Phone Number
                                </button>

                                <button
                                    onClick={() => setShowPhoneVerificationModal(false)}
                                    className="w-full py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 font-medium transition-colors"
                                >
                                    Maybe Later
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Phone Verification Widget */}
            {showPhoneVerificationWidget && (
                <MSG91PhoneVerification
                    onSuccess={() => {
                        setShowPhoneVerificationWidget(false);
                        setShowPhoneVerificationModal(false);
                    }}
                    onClose={() => {
                        setShowPhoneVerificationWidget(false);
                        // Keep the info modal open so user can try again
                    }}
                />
            )}
        </div>
    );
}
