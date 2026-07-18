import type { ScreeningPhaseType } from "./blueprint.js";

/**
 * Role archetypes: the DEFAULT screening shape per role family.
 *
 * IMPORTANT — these are DEFAULTS, never final. The archetype is handed to the
 * config agent as a strong starting point (ordered phases, rubric seed, question
 * topic filters, probing emphasis) that the agent adapts to the specific JD and
 * the recruiter can freely override in chat. Nothing here is enforced or locked;
 * it exists so a Frontend screen differs meaningfully from a Backend one out of
 * the box instead of collapsing to the same generic SDE structure.
 *
 * Phases are SUB-PHASE granular (pm_case vs pm_concepts, ds_sql vs ds_coding) and
 * ORDERED — the order in `phases` is the recommended sequence. A role lists only
 * the sub-phases it needs (a metrics-heavy PM may want pm_concepts but not a full
 * pm_case; a leadership role wants no technical phase at all).
 */

export type ScreeningArchetypeId =
    | "frontend"
    | "backend"
    | "fullstack"
    | "mobile"
    | "data_science"
    | "ml_ai"
    | "data_engineering"
    | "devops_sre"
    | "qa_sdet"
    | "security"
    | "product_manager"
    | "engineering_leadership"
    | "generalist_swe";

/** One recommended phase in an archetype's default sequence (order matters). */
export type ArchetypePhase = {
    type: ScreeningPhaseType;
    /** Default minutes hint (the agent + duration guardrails still finalize). */
    minutes: number;
    /** Optional per-phase note the agent should weave into framing/probing. */
    note?: string;
};

/** A DEFAULT rubric dimension for the archetype (weights are a starting point). */
export type ArchetypeRubricDimension = {
    id: string;
    label: string;
    weight: number;
    competencyTags: string[];
};

/**
 * Question-bank topic/difficulty filters per bank-backed phase, so auto-selected
 * questions are on-topic for the role (e.g. frontend coding avoids graph theory).
 * Keys are phase types; values are the controlled-vocab tokens to match.
 */
export type ArchetypeQuestionFilters = Partial<Record<ScreeningPhaseType, {
    topics?: string[];
    difficulty?: "Easy" | "Medium" | "Hard";
}>>;

export type RoleArchetype = {
    id: ScreeningArchetypeId;
    label: string;
    /** Lowercase keyword hints for deterministic JD -> archetype matching. */
    matchHints: string[];
    /** Ordered default phase sequence (only the sub-phases this role needs). */
    phases: ArchetypePhase[];
    /** DEFAULT rubric (dimensions + starting weights). Fully overridable. */
    rubric: ArchetypeRubricDimension[];
    /** Topic/difficulty filters for bank-backed phases. */
    questionFilters: ArchetypeQuestionFilters;
    /** One-paragraph probing emphasis injected into the design + interviewer prompt. */
    probing: string;
};

const R = (id: string, label: string, weight: number, ...tags: string[]): ArchetypeRubricDimension =>
    ({ id, label, weight, competencyTags: tags.length ? tags : [id] });

export const ROLE_ARCHETYPES: RoleArchetype[] = [
    {
        id: "frontend",
        label: "Frontend Engineer",
        matchHints: ["frontend", "front-end", "front end", "react", "vue", "angular", "svelte", "next.js", "nextjs", "typescript ui", "css", "html", "web ui", "ui engineer", "web developer"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe ownership of shipped UI features, component architecture decisions, and user-facing impact." },
            { type: "coding", minutes: 25, note: "Implementation problem in the IDE (interim: the in-browser component sandbox is not built yet, so use a general coding problem)." },
            { type: "system_design", minutes: 20, note: "Frontend architecture: component/library design, state management, rendering strategy, performance." },
            { type: "behavioral", minutes: 15, note: "Collaboration with design/backend, handling ambiguity, UX care." },
        ],
        rubric: [
            R("ui_component_architecture", "UI & component architecture", 25, "component_design", "state_management"),
            R("correctness", "Correctness", 20, "correctness"),
            R("accessibility", "Accessibility", 15, "accessibility", "semantics"),
            R("frontend_performance", "Performance", 15, "performance", "rendering"),
            R("communication", "Communication", 15, "communication"),
            R("ownership", "Project ownership", 10, "ownership"),
        ],
        questionFilters: {
            coding: { topics: ["arrays", "strings", "hashing", "recursion", "dom"] },
            system_design: { topics: ["frontend-architecture", "state-management", "rendering"] },
        },
        probing: "Prioritize real UI engineering: component composition, state, accessibility, and performance. Avoid backend/distributed-systems framing. (A dedicated in-browser component-build phase will replace the generic coding round once the frontend sandbox ships.)",
    },
    {
        id: "backend",
        label: "Backend Engineer",
        matchHints: ["backend", "back-end", "back end", "api", "microservice", "node.js", "python backend", "java", "go", "golang", "rest", "grpc", "server", "distributed", "database engineer"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe ownership of services/APIs, data modeling, and production reliability." },
            { type: "coding", minutes: 25, note: "Algorithmic/implementation problem (DSA) in the IDE." },
            { type: "system_design", minutes: 20, note: "Backend distributed-systems design: APIs, data stores, caching, scaling, reliability." },
            { type: "behavioral", minutes: 15, note: "Ownership, incident handling, cross-team collaboration." },
        ],
        rubric: [
            R("api_data_modeling", "API & data modeling", 25, "api_design", "data_modeling"),
            R("correctness", "Correctness", 20, "correctness"),
            R("scalability", "Scalability", 20, "scalability", "system_design"),
            R("reliability", "Reliability", 15, "reliability", "ownership"),
            R("communication", "Communication", 20, "communication"),
        ],
        questionFilters: {
            coding: { topics: ["arrays", "strings", "hashing", "sorting", "two-pointers"] },
            system_design: { topics: ["caching", "api-design", "database-design", "messaging-queue", "rate-limiting"] },
        },
        probing: "Focus on service/API design, data modeling, correctness, and scaling/reliability tradeoffs. System design should be a backend distributed-systems problem.",
    },
    {
        id: "fullstack",
        label: "Full-Stack Engineer",
        matchHints: ["fullstack", "full-stack", "full stack", "full stack engineer", "mern", "mean", "end-to-end"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe end-to-end ownership across UI and backend." },
            { type: "coding", minutes: 25, note: "Implementation problem in the IDE." },
            { type: "system_design", minutes: 20, note: "End-to-end feature design touching client and server." },
            { type: "behavioral", minutes: 15 },
        ],
        rubric: [
            R("technical_breadth", "Technical breadth", 25, "technical_depth"),
            R("correctness", "Correctness", 20, "correctness"),
            R("system_design", "System design", 20, "system_design", "scalability"),
            R("communication", "Communication", 20, "communication"),
            R("ownership", "Project ownership", 15, "ownership"),
        ],
        questionFilters: {
            coding: { topics: ["arrays", "strings", "hashing", "recursion"] },
            system_design: { topics: ["api-design", "caching", "frontend-architecture"] },
        },
        probing: "Balance client and server. Probe how the candidate reasons across the full stack, not deep in only one layer.",
    },
    {
        id: "mobile",
        label: "Mobile Engineer",
        matchHints: ["mobile", "ios", "android", "swift", "kotlin", "react native", "flutter", "objective-c", "app developer"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe shipped mobile apps: lifecycle, offline, performance, app-store realities." },
            { type: "coding", minutes: 25, note: "Implementation problem; emphasize UI/state or data handling." },
            { type: "system_design", minutes: 20, note: "Mobile app architecture: offline sync, state, navigation, performance/battery." },
            { type: "behavioral", minutes: 15 },
        ],
        rubric: [
            R("mobile_architecture", "Mobile architecture", 25, "architecture", "state_management"),
            R("correctness", "Correctness", 20, "correctness"),
            R("performance", "Performance & UX", 20, "performance"),
            R("communication", "Communication", 20, "communication"),
            R("ownership", "Project ownership", 15, "ownership"),
        ],
        questionFilters: {
            coding: { topics: ["arrays", "strings", "hashing"] },
            system_design: { topics: ["frontend-architecture", "state-management", "caching"] },
        },
        probing: "Emphasize app lifecycle, offline/sync, state, and performance/battery. Avoid server-heavy distributed-systems framing.",
    },
    {
        id: "data_science",
        label: "Data Scientist",
        matchHints: ["data scientist", "data science", "machine learning scientist", "statistics", "statistical", "pandas", "regression", "experiment", "a/b test", "ab test", "analytics scientist"],
        phases: [
            { type: "resume_project", minutes: 12, note: "Probe modeling projects: framing, data, evaluation, and business impact." },
            { type: "ds_concepts", minutes: 12, note: "Statistics / ML concept questions (probability, inference, modeling, evaluation)." },
            { type: "ds_sql", minutes: 18, note: "Analytics SQL against a realistic schema." },
            { type: "ds_coding", minutes: 18, note: "Python/pandas data-analysis task." },
            { type: "ds_business_case", minutes: 12, note: "Business & metrics case grounded on the candidate's projects: defining success metrics, diagnosing metric movement, turning analysis into a decision." },
        ],
        rubric: [
            R("stats_ml_reasoning", "Stats & ML reasoning", 25, "statistics", "modeling"),
            R("sql_proficiency", "SQL proficiency", 20, "sql"),
            R("data_analysis", "Data analysis", 20, "data_analysis", "pandas"),
            R("business_sense", "Business sense", 15, "business_metrics"),
            R("communication", "Communication", 20, "communication"),
        ],
        questionFilters: {
            ds_sql: { topics: ["joins", "aggregation", "window-functions", "group-by"] },
        },
        probing: "Probe statistical reasoning, experiment design, and turning data into decisions. SQL and coding must be analytics-flavored, not DSA.",
    },
    {
        id: "ml_ai",
        label: "ML / GenAI Engineer",
        matchHints: ["machine learning engineer", "ml engineer", "mle", "genai", "gen ai", "generative ai", "llm", "rag", "prompt", "fine-tuning", "fine tuning", "nlp", "deep learning", "ai engineer", "mlops"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe GenAI/ML ownership: model choice, RAG vs fine-tuning, eval, production tradeoffs." },
            { type: "genai_concepts", minutes: 15, note: "GenAI/ML fundamentals (transformers, RAG, evaluation, model selection)." },
            { type: "genai_coding", minutes: 30, note: "Applied GenAI coding task (NO AI-assistant usage in the screening variant)." },
            { type: "behavioral", minutes: 10 },
        ],
        rubric: [
            R("genai_fundamentals", "GenAI fundamentals", 25, "genai_fundamentals"),
            R("applied_ml", "Applied ML / coding", 20, "problem_solving", "code_quality"),
            R("eval_rigor", "Evaluation rigor", 20, "evaluation"),
            R("ai_responsibility", "AI responsibility", 15, "ai_ethics"),
            R("communication", "Communication", 20, "communication"),
        ],
        questionFilters: {},
        probing: "Probe GenAI/ML decisions and evaluation rigor. In screening, the coding phase does NOT allow AI-assistant usage — evaluate the candidate's own implementation and understanding.",
    },
    {
        id: "data_engineering",
        label: "Data Engineer",
        matchHints: ["data engineer", "data engineering", "etl", "elt", "spark", "airflow", "data pipeline", "warehouse", "snowflake", "databricks", "kafka"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe pipeline ownership: ingestion, transformation, reliability, data quality." },
            { type: "ds_sql", minutes: 20, note: "SQL: joins, windowing, aggregation at scale." },
            { type: "system_design", minutes: 20, note: "Data platform design: batch/stream, storage, schema, reliability." },
            { type: "behavioral", minutes: 10 },
        ],
        rubric: [
            R("data_modeling", "Data modeling", 25, "data_modeling", "schema_design"),
            R("sql_proficiency", "SQL proficiency", 20, "sql"),
            R("pipeline_reliability", "Pipeline reliability", 20, "reliability", "scalability"),
            R("communication", "Communication", 20, "communication"),
            R("ownership", "Project ownership", 15, "ownership"),
        ],
        questionFilters: {
            ds_sql: { topics: ["joins", "window-functions", "aggregation", "ctes"] },
            system_design: { topics: ["streaming", "storage", "database-design", "messaging-queue"] },
        },
        probing: "Emphasize data modeling, SQL depth, and pipeline reliability/scale. System design should be a data-platform problem.",
    },
    {
        id: "devops_sre",
        label: "DevOps / SRE",
        matchHints: ["devops", "sre", "site reliability", "platform engineer", "infrastructure", "kubernetes", "k8s", "terraform", "ci/cd", "cloud engineer", "observability"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe infra/reliability ownership: incidents, automation, scaling." },
            { type: "coding", minutes: 20, note: "Scripting/implementation problem (parsing, automation-flavored)." },
            { type: "system_design", minutes: 25, note: "Reliability/infra design: deployment, scaling, failure modes, observability." },
            { type: "behavioral", minutes: 10, note: "Incident response and on-call ownership." },
        ],
        rubric: [
            R("systems_reliability", "Systems & reliability", 25, "reliability", "system_design"),
            R("automation", "Automation & tooling", 20, "automation", "code_quality"),
            R("incident_ownership", "Incident ownership", 20, "ownership", "debugging"),
            R("communication", "Communication", 20, "communication"),
            R("correctness", "Correctness", 15, "correctness"),
        ],
        questionFilters: {
            coding: { topics: ["strings", "hashing", "arrays"] },
            system_design: { topics: ["load-balancing", "caching", "rate-limiting", "messaging-queue"] },
        },
        probing: "Probe reliability, automation, failure modes, and observability. System design should center deployment/scaling/incident response.",
    },
    {
        id: "qa_sdet",
        label: "QA / SDET",
        matchHints: ["qa", "sdet", "test engineer", "automation engineer", "quality assurance", "test automation", "selenium", "cypress", "playwright"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe test strategy ownership: coverage, automation, flake, quality gates." },
            { type: "coding", minutes: 25, note: "Implementation problem; emphasize edge cases and testability." },
            { type: "cs_theory", minutes: 10, note: "Testing/CS fundamentals." },
            { type: "behavioral", minutes: 10 },
        ],
        rubric: [
            R("test_strategy", "Test strategy", 25, "testing", "coverage"),
            R("correctness", "Correctness & edge cases", 25, "correctness", "edge_cases"),
            R("automation", "Automation", 20, "automation"),
            R("communication", "Communication", 20, "communication"),
            R("ownership", "Ownership", 10, "ownership"),
        ],
        questionFilters: {
            coding: { topics: ["arrays", "strings", "hashing"] },
        },
        probing: "Emphasize edge-case thinking, test strategy, and automation. Reward candidates who reason about what could break.",
    },
    {
        id: "security",
        label: "Security Engineer",
        matchHints: ["security", "appsec", "infosec", "penetration", "pentest", "vulnerability", "cryptography", "security engineer"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe security work: threat modeling, findings, remediation ownership." },
            { type: "coding", minutes: 20, note: "Implementation problem; probe secure coding and edge cases." },
            { type: "system_design", minutes: 20, note: "Security architecture: authn/z, threat modeling, data protection." },
            { type: "behavioral", minutes: 10 },
        ],
        rubric: [
            R("security_depth", "Security depth", 30, "security", "threat_modeling"),
            R("correctness", "Correctness", 20, "correctness"),
            R("system_design", "Secure design", 20, "system_design"),
            R("communication", "Communication", 20, "communication"),
            R("ownership", "Ownership", 10, "ownership"),
        ],
        questionFilters: {
            system_design: { topics: ["api-design", "rate-limiting", "database-design"] },
        },
        probing: "Probe threat modeling, secure design, and remediation ownership. Reward adversarial thinking.",
    },
    {
        id: "product_manager",
        label: "Product Manager",
        matchHints: ["product manager", "product management", "pm role", "roadmap", "stakeholder", "product owner", "prioritization", "north star", "product strategy"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe product ownership: what they drove, metrics moved, stakeholders managed." },
            { type: "pm_case", minutes: 20, note: "Product case (CIRCLES-style) in the notepad." },
            { type: "pm_concepts", minutes: 12, note: "Metrics, prioritization, experiment-design concept questions." },
            { type: "pm_strategy", minutes: 15, note: "Strategy & prioritization: roadmap tradeoffs, north-star framing, defending a position under devil's-advocate probing. CORE for any PM role — keep it unless the JD is a narrow execution/analyst PM." },
            { type: "behavioral", minutes: 10 },
        ],
        rubric: [
            R("prioritization_strategy", "Prioritization & strategy", 25, "product_strategy"),
            R("product_case_structuring", "Case structuring", 20, "product_case_structuring"),
            R("product_metrics", "Metrics & analytics", 20, "product_metrics"),
            R("product_ownership", "Product ownership", 15, "product_ownership"),
            R("communication", "Communication", 20, "communication"),
        ],
        questionFilters: {},
        probing: "Probe structured product thinking, strategy & roadmap prioritization, tradeoff decisions, metric definition, and stakeholder framing. A dedicated pm_strategy phase is a DEFAULT part of a PM screen (the role is fundamentally strategic) — include it unless the JD is explicitly a narrow execution/analytics PM. No coding/technical phases unless the JD is explicitly technical PM.",
    },
    {
        id: "engineering_leadership",
        label: "Engineering / People Leadership",
        matchHints: ["engineering manager", "team lead", "leadership", "people management", "director", "head of", "conflict resolution", "influence without authority", "cross-functional", "drive outcomes through teamwork", "mentorship"],
        phases: [
            { type: "resume_project", minutes: 15, note: "Probe leadership ownership: initiatives driven, teams influenced, outcomes delivered." },
            { type: "pm_case", minutes: 20, note: "Cross-functional program/leadership scenario (structured in the notepad) — NOT a technical whiteboard." },
            { type: "behavioral", minutes: 25, note: "Scenario-based leadership: conflict resolution, influence without authority, ambiguity." },
        ],
        rubric: [
            R("leadership", "Leadership & initiative", 25, "leadership"),
            R("collaboration", "Collaboration", 20, "teamwork", "collaboration"),
            R("conflict_resolution", "Conflict resolution", 20, "conflict_resolution"),
            R("ownership", "Ownership", 15, "ownership"),
            R("communication", "Communication", 20, "communication"),
        ],
        questionFilters: {},
        probing: "This is a NON-technical leadership screen. Do NOT include a technical coding or engineering system-design whiteboard phase. Use scenario-based behavioral and a cross-functional leadership case instead.",
    },
    {
        id: "generalist_swe",
        label: "Software Engineer (generalist)",
        matchHints: ["software engineer", "sde", "developer", "programmer", "swe"],
        phases: [
            { type: "resume_project", minutes: 15 },
            { type: "coding", minutes: 25 },
            { type: "system_design", minutes: 20 },
            { type: "behavioral", minutes: 15 },
        ],
        rubric: [
            R("technical_correctness", "Technical correctness", 30, "correctness", "technical_depth"),
            R("problem_solving", "Problem solving", 25, "problem_solving"),
            R("system_design", "System design", 20, "system_design"),
            R("communication", "Communication", 15, "communication"),
            R("ownership", "Ownership", 10, "ownership"),
        ],
        questionFilters: {
            coding: { topics: ["arrays", "strings", "hashing", "recursion"] },
            system_design: { topics: ["caching", "api-design", "database-design"] },
        },
        probing: "Balanced general SWE screen. Adapt emphasis to whatever the JD highlights.",
    },
];

export const ARCHETYPE_IDS: ScreeningArchetypeId[] = ROLE_ARCHETYPES.map((a) => a.id);

const DEFAULT_ARCHETYPE = ROLE_ARCHETYPES.find((a) => a.id === "generalist_swe")!;

export function archetypeById(id: string | null | undefined): RoleArchetype {
    return ROLE_ARCHETYPES.find((a) => a.id === id) || DEFAULT_ARCHETYPE;
}

/**
 * Deterministic fallback matcher: score each archetype by how many of its
 * matchHints appear in the role title + skills + focus text. Used when the LLM
 * doesn't return a valid archetype id. Never throws; defaults to generalist_swe.
 */
export function selectArchetype(input: { role?: string | null; coreSkills?: string[]; focusAreas?: string[]; jobTitle?: string | null }): RoleArchetype {
    const hay = [
        input.role || "",
        input.jobTitle || "",
        ...(input.coreSkills || []),
        ...(input.focusAreas || []),
    ].join(" ").toLowerCase();
    if (!hay.trim()) return DEFAULT_ARCHETYPE;

    let best = DEFAULT_ARCHETYPE;
    let bestScore = 0;
    for (const archetype of ROLE_ARCHETYPES) {
        let score = 0;
        for (const hint of archetype.matchHints) if (hay.includes(hint)) score += hint.includes(" ") ? 2 : 1;
        if (score > bestScore) { bestScore = score; best = archetype; }
    }
    return bestScore > 0 ? best : DEFAULT_ARCHETYPE;
}

/**
 * Render an archetype as a "DEFAULT (fully changeable)" block for the config
 * agent's design prompt. The wording makes explicit that the agent should start
 * here but adapt to the JD, and that the recruiter can override anything.
 */
export function renderArchetypeDefaults(archetype: RoleArchetype): string {
    const phaseLines = archetype.phases
        .map((p, i) => {
            const filters = archetype.questionFilters[p.type];
            const topics = filters?.topics?.length ? ` [question topics: ${filters.topics.join(", ")}]` : "";
            return `  ${i + 1}. ${p.type} (~${p.minutes} min)${p.note ? ` — ${p.note}` : ""}${topics}`;
        })
        .join("\n");
    const rubricLine = archetype.rubric.map((d) => `${d.label} ${d.weight}%`).join(", ");
    return [
        `DETECTED ROLE ARCHETYPE: ${archetype.label} (${archetype.id}).`,
        `This is a DEFAULT starting point, NOT final — adapt it to the specifics of THIS job description, and the recruiter can change anything in chat.`,
        `Recommended phase sequence (in order):`,
        phaseLines,
        `Recommended rubric (default weights — adjust to the JD's emphasis): ${rubricLine}.`,
        `Probing emphasis: ${archetype.probing}`,
    ].join("\n");
}
