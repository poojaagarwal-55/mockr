import type {
    ResumeAgendaItem,
    ResumeAgendaItemStatus,
    ResumeAgendaQuestionIntent,
    ResumeAgendaState,
    ResumeProbeDepth,
} from "./interview-runtime-types.js";

const PROJECT_DEEP_LIMIT = 7;
const PROJECT_RAPID_LIMIT = 5;
const RESUME_NON_PROJECT_LIMIT = 5;
const RESUME_FIT_LIMIT = 3;
const COMPONENT_FOLLOWUP_LIMIT = 2;

function slugify(value: string): string {
    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64) || "item";
}

function asArray(value: any): any[] {
    return Array.isArray(value) ? value : [];
}

function toText(value: any): string {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object") return "";
    return String(value.description || value.summary || value.details || value.name || value.title || value.role || "").trim();
}

function pushUnique(items: ResumeAgendaItem[], item: ResumeAgendaItem): void {
    if (items.some((existing) => existing.id === item.id)) return;
    items.push(item);
}

function activateNext(state: ResumeAgendaState): ResumeAgendaState {
    const active = state.items.find((item) => item.id === state.activeItemId && item.status === "active");
    if (active) return state;

    const next = [...state.items]
        .filter((item) => item.status === "unasked")
        .sort((a, b) => a.priority - b.priority)[0];

    if (!next) {
        return {
            ...state,
            activeItemId: undefined,
            currentIntent: undefined,
            turnsOnItem: 0,
            turnsOnComponent: {},
        };
    }

    return {
        ...state,
        activeItemId: next.id,
        currentIntent: undefined,
        turnsOnItem: 0,
        turnsOnComponent: {},
        items: state.items.map((item) =>
            item.id === next.id ? { ...item, status: "active", turnCount: 0, weakCount: 0 } : item
        ),
    };
}

export function getActiveResumeAgendaItem(state?: ResumeAgendaState): ResumeAgendaItem | undefined {
    if (!state?.activeItemId) return undefined;
    return state.items.find((item) => item.id === state.activeItemId && item.status === "active");
}

export function createInitialResumeAgendaState(resumeSummary: any | null | undefined): ResumeAgendaState {
    const items: ResumeAgendaItem[] = [];

    asArray(resumeSummary?.projects).forEach((project: any, index) => {
        const name = String(project?.name || project?.title || `Project ${index + 1}`).trim();
        if (!name) return;
        const techStack = asArray(project?.techStack || project?.technologies || project?.skills)
            .map((tech) => String(tech).trim())
            .filter(Boolean);
        pushUnique(items, {
            id: `project:${slugify(name)}`,
            type: "project",
            label: name,
            summary: toText(project) || name,
            evidence: techStack.length ? [`Tech/skills listed: ${techStack.join(", ")}`] : undefined,
            priority: 10 + index,
            mode: index < 2 ? "deep" : "rapid",
            status: "unasked",
            askedIntents: [],
            turnCount: 0,
            weakCount: 0,
            componentCounts: {},
        });
    });

    asArray(resumeSummary?.experience).forEach((exp: any, index) => {
        const role = String(exp?.role || exp?.title || "Experience").trim();
        const company = String(exp?.company || exp?.organization || "").trim();
        const label = company ? `${role} at ${company}` : role;
        pushUnique(items, {
            id: `experience:${slugify(label)}`,
            type: "experience",
            label,
            summary: toText(exp) || label,
            priority: 40 + index,
            status: "unasked",
            askedIntents: [],
            turnCount: 0,
            weakCount: 0,
        });
    });

    const responsibilityEntries = [
        ...asArray(resumeSummary?.positionsOfResponsibility),
        ...asArray(resumeSummary?.leadership),
        ...asArray(resumeSummary?.responsibilities),
    ];
    responsibilityEntries.forEach((entry: any, index) => {
        const label = typeof entry === "string"
            ? entry.trim()
            : String(entry?.title || entry?.role || entry?.position || entry?.name || `Responsibility ${index + 1}`).trim();
        if (!label) return;
        pushUnique(items, {
            id: `responsibility:${slugify(label)}`,
            type: "responsibility",
            label,
            summary: toText(entry) || label,
            priority: 60 + index,
            status: "unasked",
            askedIntents: [],
            turnCount: 0,
            weakCount: 0,
        });
    });

    if (items.some((item) => /\b(ai|llm|rag|gemini|openai|agent|generative)\b/i.test(`${item.label} ${item.summary}`))) {
        pushUnique(items, {
            id: "risk:ai-contribution-clarity",
            type: "risk",
            label: "AI contribution clarity",
            summary: "Clarify what AI generated versus what the candidate personally understood, changed, tested, or owned.",
            priority: 95,
            status: "unasked",
            askedIntents: [],
            turnCount: 0,
            weakCount: 0,
        });
    }

    pushUnique(items, {
        id: "fit:role-synthesis",
        type: "fit",
        label: "role fit synthesis",
        summary: "Synthesize strongest defensible proof points and role-fit communication.",
        priority: 120,
        status: "unasked",
        askedIntents: [],
        turnCount: 0,
        weakCount: 0,
    });

    return activateNext({
        items,
        closedItemIds: [],
        turnsOnItem: 0,
        turnsOnComponent: {},
    });
}

export function mapResumeDepthToAgendaIntent(depth: ResumeProbeDepth): ResumeAgendaQuestionIntent {
    if (depth === "tradeoffs") return "tradeoff";
    if (depth === "failure_depth") return "failure";
    if (depth === "senior_depth") return "impact";
    return depth;
}

/** The intents the model is allowed to use for an agenda item, in escalation order. */
export function getAllowedResumeAgendaIntents(item: ResumeAgendaItem): ResumeAgendaQuestionIntent[] {
    if (item.type === "project") {
        return item.mode === "rapid"
            ? ["ownership", "impact"]
            : ["overview", "motivation", "ownership", "implementation", "tradeoff", "failure", "impact", "skill_usage"];
    }
    if (item.type === "skill") return ["skill_usage", "fit"];
    if (item.type === "fit") return ["fit", "impact"];
    return ["ownership", "impact", "failure", "fit"];
}

/**
 * The next allowed intent for an item that has not been asked yet, falling back
 * to the deepest allowed intent once they have all been asked. Used by the
 * server-side probe fallback to keep the agenda's asked-intent list growing (and
 * so the per-turn prompt changing) even when the model forgets to record a probe.
 */
export function nextUnaskedResumeAgendaIntent(item: ResumeAgendaItem): ResumeAgendaQuestionIntent {
    const allowed = getAllowedResumeAgendaIntents(item);
    const asked = new Set(item.askedIntents);
    return allowed.find((intent) => !asked.has(intent)) || allowed[allowed.length - 1] || "overview";
}

function closeStatusForQuality(answerQuality: string, fallback: ResumeAgendaItemStatus): ResumeAgendaItemStatus {
    if (answerQuality === "declined") return "declined";
    if (answerQuality === "weak") return "unverified";
    return fallback;
}

export function getResumeAgendaItemTurnLimit(item: ResumeAgendaItem): number {
    if (item.type === "project") {
        return item.mode === "rapid" ? PROJECT_RAPID_LIMIT : PROJECT_DEEP_LIMIT;
    }
    if (item.type === "fit") {
        return RESUME_FIT_LIMIT;
    }
    return RESUME_NON_PROJECT_LIMIT;
}

export function updateResumeAgendaAfterProbe(
    state: ResumeAgendaState | undefined,
    input: {
        agendaItemId?: string;
        intent: ResumeAgendaQuestionIntent;
        answerQuality: "weak" | "partial" | "strong" | "declined";
        shouldCloseItem?: boolean;
        componentKey?: string;
    }
): ResumeAgendaState | undefined {
    if (!state) return state;

    const targetId = input.agendaItemId || state.activeItemId;
    const active = state.items.find((item) => item.id === targetId && item.status === "active");
    if (!active) return activateNext(state);

    const componentKey = input.componentKey ? slugify(input.componentKey) : undefined;
    const componentCounts = { ...(active.componentCounts || {}) };
    if (componentKey) componentCounts[componentKey] = (componentCounts[componentKey] || 0) + 1;

    const turnCount = active.turnCount + 1;
    const weakCount = input.answerQuality === "weak" || input.answerQuality === "declined"
        ? active.weakCount + 1
        : active.weakCount;
    const askedIntents = [...new Set([...active.askedIntents, input.intent])];

    const hitComponentCap = componentKey ? (componentCounts[componentKey] || 0) >= COMPONENT_FOLLOWUP_LIMIT : false;
    const hitTurnCap = turnCount >= getResumeAgendaItemTurnLimit(active);
    const weakLimit = active.mode === "rapid" ? 2 : active.type === "project" ? 3 : 2;
    const repeatedWeak = weakCount >= weakLimit || input.answerQuality === "declined";
    const strongTerminal =
        input.answerQuality === "strong" &&
        (input.intent === "impact" || input.intent === "failure" || input.intent === "tradeoff") &&
        active.type === "project" &&
        turnCount >= getResumeAgendaItemTurnLimit(active);

    const modelRequestedClose = Boolean(input.shouldCloseItem) &&
        (input.answerQuality === "declined" || repeatedWeak || turnCount >= getResumeAgendaItemTurnLimit(active));
    const shouldClose = Boolean(modelRequestedClose || hitComponentCap || hitTurnCap || repeatedWeak || strongTerminal);
    const nextStatus: ResumeAgendaItemStatus = shouldClose
        ? closeStatusForQuality(input.answerQuality, hitTurnCap || hitComponentCap ? "saturated" : "covered")
        : "active";

    const closedItemIds = shouldClose && !state.closedItemIds.includes(active.id)
        ? [...state.closedItemIds, active.id]
        : state.closedItemIds;

    const nextState: ResumeAgendaState = {
        ...state,
        activeItemId: shouldClose ? undefined : active.id,
        closedItemIds,
        currentIntent: input.intent,
        turnsOnItem: shouldClose ? 0 : turnCount,
        turnsOnComponent: shouldClose ? {} : { ...state.turnsOnComponent, ...(componentKey ? { [componentKey]: componentCounts[componentKey] } : {}) },
        items: state.items.map((item) =>
            item.id === active.id
                ? { ...item, status: nextStatus, askedIntents, turnCount, weakCount, componentCounts }
                : item
        ),
    };

    return activateNext(nextState);
}

export function declineActiveResumeAgendaItem(
    state: ResumeAgendaState | undefined,
    intent: ResumeAgendaQuestionIntent = "overview"
): ResumeAgendaState | undefined {
    return updateResumeAgendaAfterProbe(state, {
        intent,
        answerQuality: "declined",
        shouldCloseItem: true,
    });
}

export function buildResumeAgendaNotice(state?: ResumeAgendaState): string {
    const active = getActiveResumeAgendaItem(state);
    if (!state || !active) {
        return "[SYSTEM NOTIFICATION] The server-owned resume agenda has no remaining active items. Close the resume screening now. Do not ask another resume question.";
    }
    const closed = state.items
        .filter((item) => state.closedItemIds.includes(item.id))
        .map((item) => item.label);
    return [
        "[SYSTEM NOTIFICATION] Follow the current server-owned resume agenda.",
        `Continue only with active resume agenda item: ${active.label} (${active.type}${active.mode ? `/${active.mode}` : ""}).`,
        `Resume evidence: ${active.summary}`,
        closed.length ? `Closed items: ${closed.join(", ")}.` : "Closed items: none.",
        "Do not return to closed items. Do not ask the candidate what to discuss next.",
    ].join(" ");
}

export function buildResumeAgendaPromptBlock(state?: ResumeAgendaState): string | null {
    if (!state) return null;
    const active = getActiveResumeAgendaItem(state);
    const closed = state.items
        .filter((item) => state.closedItemIds.includes(item.id))
        .map((item) => item.label);
    const remaining = state.items
        .filter((item) => item.status === "unasked")
        .slice(0, 6)
        .map((item) => item.label);

    const lines = ["## Server-Owned Resume Agenda"];
    lines.push("The server owns resume coverage. Ask exactly one natural interviewer question about the active item only.");
    lines.push("Do not ask the candidate what to evaluate, what section to discuss, or for 'one other project/skill/course' unless the active item below explicitly names that item.");
    lines.push("After each candidate answer, silently call record_resume_probe with agendaItemId and intent before asking the next question.");

    if (!active) {
        lines.push("Active item: none. Close the interview now; do not ask another resume question.");
        return lines.join("\n");
    }

    const allowedIntents = getAllowedResumeAgendaIntents(active);

    lines.push(`Active item id: ${active.id}`);
    lines.push(`Active item: ${active.label} (${active.type}${active.mode ? `/${active.mode}` : ""})`);
    lines.push(`Resume evidence: ${active.summary}`);
    if (active.evidence?.length) lines.push(`Supporting details: ${active.evidence.join("; ")}`);
    lines.push(`Allowed intents now: ${allowedIntents.join(", ")}`);
    lines.push(`Already asked intents for this item: ${active.askedIntents.length ? active.askedIntents.join(", ") : "none"}`);
    lines.push(`Turns on this item: ${active.turnCount} of ${getResumeAgendaItemTurnLimit(active)} hard cap`);
    lines.push(`Closed items: ${closed.length ? closed.join(", ") : "none"}`);
    lines.push(`Upcoming named items: ${remaining.length ? remaining.join(", ") : "none"}`);
    lines.push("Hard cap: deep projects get 7 interviewer questions total unless the candidate clearly refuses; rapid projects get at most 5 interviewer questions total, and non-project items get at most 5 interviewer questions total. When the cap is reached, close the item and move forward.");
    lines.push("If the active item is a rapid project, start with ownership/impact. Use remaining turns only for clarification, weak answer recovery, or concise impact follow-ups. Never ask architecture, model-layer, code-level, or repeated implementation follow-ups for a rapid project.");
    lines.push("Do not ask coursework, degree-subject, or technology-checklist questions as standalone fallbacks. Skills must be verified only through the current named resume item or final role-fit synthesis.");
    lines.push("If the answer is weak/declined or this item is saturated, close it through record_resume_probe and use only the next active agenda item.");

    return lines.join("\n");
}
