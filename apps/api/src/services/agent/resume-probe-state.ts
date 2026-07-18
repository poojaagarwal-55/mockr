import type { ResumeProbeDepth, ResumeProbeState } from "./interview-runtime-types.js";

export const RESUME_PROBE_DEPTH_ORDER: ResumeProbeDepth[] = [
    "overview",
    "motivation",
    "ownership",
    "implementation",
    "tradeoffs",
    "failure_depth",
    "senior_depth",
];

export function createInitialResumeProbeState(): ResumeProbeState {
    return {
        currentDepth: "overview",
        consecutiveWeakAnswers: 0,
        completedDepths: [],
        askedProbeKeys: [],
        saturatedProjects: [],
    };
}

export function normalizeProbeProjectName(projectName: string | undefined): string {
    return (projectName || "unknown")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

export function makeResumeProbeKey(projectName: string | undefined, depth: ResumeProbeDepth): string {
    return `${normalizeProbeProjectName(projectName)}::${depth}`;
}

export function nextResumeProbeDepth(depth: ResumeProbeDepth): ResumeProbeDepth {
    const index = RESUME_PROBE_DEPTH_ORDER.indexOf(depth);
    if (index < 0 || index >= RESUME_PROBE_DEPTH_ORDER.length - 1) {
        return depth;
    }
    return RESUME_PROBE_DEPTH_ORDER[index + 1];
}

export function inferResumeProbeDepthFromQuestion(text: string): ResumeProbeDepth | null {
    const normalized = text.toLowerCase();
    if (!normalized.includes("?")) return null;

    if (/\b(what\s+would\s+you\s+do\s+differently|redesign|at\s+scale|scale|scaling|scalability|10x|million|security|observability|maintainability|migration)\b/i.test(normalized)) {
        return "senior_depth";
    }
    if (/\b(hardest|challenge|bug|bottleneck|failure|failed|debug|incident|latency|reliability|stuck)\b/i.test(normalized)) {
        return "failure_depth";
    }
    if (/\b(tradeoff|alternative|why\s+(?:did\s+you\s+choose|choose|this\s+stack)|why\s+not|cost|latency|complexity)\b/i.test(normalized)) {
        return "tradeoffs";
    }
    if (/\b(architecture|implemented|implementation|data\s+flow|api|database|schema|websocket|pipeline|module|how\s+(?:does|did|is|was))\b/i.test(normalized)) {
        return "implementation";
    }
    if (/\b(your\s+role|personally|owned|ownership|contribution|what\s+part\s+did\s+you|responsible)\b/i.test(normalized)) {
        return "ownership";
    }
    if (/\b(why\s+did\s+you\s+(?:build|make|decide)|motivat|goal|success\s+criteria|constraint)\b/i.test(normalized)) {
        return "motivation";
    }
    if (/\b(what\s+(?:is|was|does|did)|who\s+(?:is|was|uses|would\s+use)|problem\s+(?:it\s+)?solves?|built\s+for|primary\s+users?|user\s+flow|end-to-end)\b/i.test(normalized)) {
        return "overview";
    }

    return null;
}

export function inferResumeProjectNameFromText(text: string, resumeSummary: any | null): string | undefined {
    const projects = Array.isArray(resumeSummary?.projects) ? resumeSummary.projects : [];
    const lower = text.toLowerCase();
    for (const project of projects) {
        const name = typeof project?.name === "string" ? project.name.trim() : "";
        if (name && lower.includes(name.toLowerCase())) {
            return name;
        }
    }
    return undefined;
}

export function markResumeProbeAsked(
    state: ResumeProbeState | undefined,
    projectName: string | undefined,
    depth: ResumeProbeDepth
): ResumeProbeState {
    const next = state || createInitialResumeProbeState();
    const key = makeResumeProbeKey(projectName || next.activeProjectName, depth);
    const askedProbeKeys = new Set(next.askedProbeKeys || []);
    askedProbeKeys.add(key);
    return {
        ...next,
        activeProjectName: projectName || next.activeProjectName,
        lastAskedProjectName: projectName || next.activeProjectName,
        lastAskedDepth: depth,
        askedProbeKeys: [...askedProbeKeys],
    };
}
