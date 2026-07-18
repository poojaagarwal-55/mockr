/**
 * Tutor agent loop.
 *
 * Drives the agentic turn-by-turn flow:
 *   user msg
 *   ├─ turn 1: model emits functionCalls? execute in parallel, append responses
 *   ├─ turn 2: model emits more functionCalls? loop
 *   └─ final turn: model emits text — stream tokens to caller
 *
 * Yields a stream of AgentEvent values. The HTTP endpoint serializes them
 * as SSE. Final assistant text is also returned in the terminal `done`
 * event so the endpoint can persist it without re-buffering.
 */

import { type Content, type FunctionCall, type Part } from "@google/genai";
import { getGeminiClient, GEMINI_PRO_MODEL, GEMINI_MODEL, GEMINI_THINKING_MEDIUM } from "../../../lib/gemini.js";
import { TUTOR_AGENT_TOOLS, executeAgentTool, type ToolExecutionResult } from "./tool-registry.js";
import { logToolCall } from "./tool-logger.js";

const MAX_AGENT_ITERATIONS = 3;
const MAX_TOOL_CALLS_PER_TURN = 8;
const MAX_TOTAL_TOOL_CALLS = 16;
const MODEL_THINKING_BUDGET = 4096;

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

export type AgentInputMessage = { role: "user" | "assistant"; content: string };

export type AgentEvent =
    | { type: "agent_turn"; iteration: number }
    | { type: "tool_call_started"; callId: string; tool: string; args: Record<string, unknown> }
    | { type: "tool_call_completed"; callId: string; tool: string; ok: boolean; latencyMs: number; errorCode?: string }
    | { type: "agent_thought"; text: string; iteration: number }
    | {
          type: "artifact_created";
          artifactId: string;
          artifactType: string;
          title: string;
          summary: string | null;
          isDraft: boolean;
      }
    | {
          type: "artifact_committed";
          artifactId: string;
          resourceId?: string | null;
          artifactType: string;
          title: string;
      }
    | {
          type: "clarification_requested";
          context: string;
          slots: Array<{
              id: string;
              label: string;
              type: "chip" | "text" | "number" | "date";
              options?: string[];
              placeholder?: string;
              required?: boolean;
          }>;
      }
    | { type: "token"; text: string }
    | { type: "warning"; code: string; message: string }
    | { type: "done"; finalText: string; toolCallCount: number; iterations: number }
    | { type: "error"; message: string };

// Tools that produce an artifact (and need an artifact_created SSE event).
const SKILL_CREATE_TOOL_NAMES = new Set([
    "create_question_sheet",
    "create_action_plan",
    "create_quiz",
    "propose_question_sheet",
    "propose_action_plan",
    "propose_quiz",
    "revise_question_sheet",
    "revise_action_plan",
    "revise_quiz",
]);
const COMMIT_TOOL_NAME = "commit_artifact";
const CLARIFICATION_TOOL_NAME = "request_clarification";

function buildClarificationFollowupMessage() {
    return "I need one quick detail before I draft this. Fill in the prompt below and I'll build it right away.";
}

function parseClarificationAnswerMap(message: string): { context: string; answers: Record<string, string> } | null {
    const match = message.match(/^\[clarify:[^\]]+\]\s*([\s\S]*)/i);
    if (!match) return null;

    const lines = (match[1] || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const context = lines.find((line) => !line.startsWith("-")) || "";
    const answers: Record<string, string> = {};
    for (const line of lines) {
        const answerMatch = line.match(/^-\s*([^:]+):\s*(.+)$/);
        if (!answerMatch) continue;
        answers[answerMatch[1].trim().toLowerCase()] = answerMatch[2].trim();
    }
    return { context, answers };
}

function numberFromClarificationAnswer(value: string | undefined): number | null {
    if (!value) return null;
    const match = value.match(/\d+/);
    if (!match) return null;
    const n = Number.parseInt(match[0], 10);
    return Number.isFinite(n) ? n : null;
}

function inferQuestionSheetArgsFromClarification(message: string): Record<string, unknown> | null {
    const parsed = parseClarificationAnswerMap(message);
    if (!parsed) return null;

    const haystack = `${parsed.context} ${Object.keys(parsed.answers).join(" ")} ${Object.values(parsed.answers).join(" ")}`.toLowerCase();
    const looksLikeSheet =
        /\bsheet|practice|question|problem|drill\b/.test(haystack) &&
        !/\baction\s*plan|study\s*plan|quiz|test me\b/.test(haystack);
    if (!looksLikeSheet) return null;

    const topicEntry = Object.entries(parsed.answers).find(([label]) =>
        /\btopic|category|type|focus|area|subject\b/.test(label)
    );
    const countEntry = Object.entries(parsed.answers).find(([label]) =>
        /\bcount|number|many|questions|problems\b/.test(label)
    );
    const difficultyEntry = Object.entries(parsed.answers).find(([label]) =>
        /\bdifficulty|level|mix\b/.test(label)
    );

    const focusTopics = topicEntry?.[1]
        ?.split(/\s*(?:,|\||\/|\band\b)\s*/i)
        .map((topic) => topic.trim())
        .filter((topic) => topic && !/^\(skipped\)$/i.test(topic))
        .slice(0, 10);
    const totalQuestions = Math.min(25, Math.max(1, numberFromClarificationAnswer(countEntry?.[1]) ?? 8));
    const difficultyText = (difficultyEntry?.[1] || "").toLowerCase();
    const difficultyMix = difficultyText.includes("easy")
        ? { easy: totalQuestions, medium: 0, hard: 0 }
        : difficultyText.includes("hard")
            ? { easy: 0, medium: 0, hard: totalQuestions }
            : difficultyText.includes("medium")
                ? { easy: 0, medium: totalQuestions, hard: 0 }
                : undefined;

    return {
        ...(focusTopics && focusTopics.length > 0 ? { focusTopics } : {}),
        totalQuestions,
        ...(difficultyMix ? { difficultyMix } : {}),
        rationale: "Built from the clarification form answers.",
    };
}

function artifactSummaryFromToolResult(data: Record<string, unknown>): {
    artifactId: string;
    artifactType: string;
    title: string;
    summary: string | null;
    isDraft: boolean;
} | null {
    const artifactId =
        typeof data.artifactId === "string"
            ? data.artifactId
            : typeof data.draftId === "string"
                ? data.draftId
                : null;
    const title = typeof data.title === "string" ? data.title : null;
    if (!artifactId || !title) return null;
    return {
        artifactId,
        artifactType: typeof data.type === "string" ? data.type : "artifact",
        title,
        summary: typeof data.summary === "string" ? data.summary : null,
        isDraft: data.isDraft === true,
    };
}

export type RunTutorAgentInput = {
    userId: string;
    conversationId: string | null;
    message: string;
    history: AgentInputMessage[];
    systemPrompt: string;
};

// ─────────────────────────────────────────────────────────────────
// Loop
// ─────────────────────────────────────────────────────────────────

export async function* runTutorAgent(input: RunTutorAgentInput): AsyncGenerator<AgentEvent> {
    const client = getGeminiClient();

    const contents: Content[] = [
        ...input.history.map<Content>((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
        })),
        { role: "user", parts: [{ text: input.message }] },
    ];

    let totalToolCalls = 0;
    let finalText = "";
    let deterministicFallback: string | null = null;
    const sheetClarificationFallbackArgs = inferQuestionSheetArgsFromClarification(input.message);

    for (let iteration = 1; iteration <= MAX_AGENT_ITERATIONS; iteration++) {
        yield { type: "agent_turn", iteration };

        // The final iteration must produce text: drop the tools so the model
        // commits to an answer instead of asking for more data forever.
        const isLastIteration = iteration === MAX_AGENT_ITERATIONS;

        // Stream the LAST turn (so users see tokens as they arrive). For
        // intermediate turns we use non-streaming because function calls
        // arrive atomically and we'd just buffer the whole response anyway.
        const shouldStream = isLastIteration;

        if (!shouldStream) {
            const response = await safeGenerate(
                client,
                contents,
                input.systemPrompt,
                !isLastIteration,
                iteration
            );
            if (!response) {
                yield { type: "error", message: "Model request failed." };
                return;
            }

            const responseParts = response.candidates?.[0]?.content?.parts ?? [];
            // Append the model's turn (functionCalls + any text it emitted) to history.
            if (responseParts.length > 0) {
                contents.push({ role: "model", parts: responseParts });
            }

            const functionCalls = (response.functionCalls ?? []) as FunctionCall[];

            // Capture text emitted alongside function calls — the model often narrates
            // its plan ("I'll check your weak areas first..."). Surface as agent_thought.
            const thoughtText = collectText(responseParts);
            if (thoughtText && functionCalls.length > 0) {
                yield { type: "agent_thought", text: thoughtText, iteration };
            }

            if (!functionCalls.length) {
                if (sheetClarificationFallbackArgs) {
                    const callId = `fallback-propose-question-sheet-${Date.now()}`;
                    const args: Record<string, unknown> = {
                        ...sheetClarificationFallbackArgs,
                        conversationId: input.conversationId ?? undefined,
                    };
                    yield {
                        type: "tool_call_started",
                        callId,
                        tool: "propose_question_sheet",
                        args,
                    };
                    const startedAt = Date.now();
                    const result = await executeAgentTool(input.userId, "propose_question_sheet", args);
                    yield {
                        type: "tool_call_completed",
                        callId,
                        tool: "propose_question_sheet",
                        ok: result.ok,
                        latencyMs: Date.now() - startedAt,
                        ...(result.ok ? {} : { errorCode: result.errorCode }),
                    };
                    totalToolCalls += 1;

                    if (result.ok) {
                        const artifact = artifactSummaryFromToolResult(result.data as Record<string, unknown>);
                        if (artifact) {
                            yield { type: "artifact_created", ...artifact };
                            finalText = `Here's your draft — **${artifact.title}**. Review it above, and hit **Approve** to save it or **Revise** if you'd like any changes.`;
                            yield { type: "token", text: finalText };
                            yield { type: "done", finalText, toolCallCount: totalToolCalls, iterations: iteration };
                            return;
                        }
                    }
                }

                // Model decided to answer without more tools — emit any text it gave us and finish.
                if (thoughtText) {
                    const clarification = extractClarificationFromText(thoughtText);
                    if (clarification) {
                        if (clarification.preface) {
                            finalText = clarification.preface;
                            yield { type: "token", text: clarification.preface };
                        }
                        yield {
                            type: "clarification_requested",
                            context: clarification.context,
                            slots: clarification.slots,
                        };
                        yield { type: "done", finalText, toolCallCount: totalToolCalls, iterations: iteration };
                        return;
                    }

                    finalText = thoughtText;
                    yield { type: "token", text: thoughtText };
                } else if (deterministicFallback) {
                    finalText = deterministicFallback;
                    yield { type: "token", text: finalText };
                }
                yield { type: "done", finalText, toolCallCount: totalToolCalls, iterations: iteration };
                return;
            }

            const limited = functionCalls.slice(0, MAX_TOOL_CALLS_PER_TURN);
            if (functionCalls.length > MAX_TOOL_CALLS_PER_TURN) {
                yield {
                    type: "warning",
                    code: "TOO_MANY_TOOL_CALLS_IN_TURN",
                    message: `Model requested ${functionCalls.length} tool calls; executing first ${MAX_TOOL_CALLS_PER_TURN}.`,
                };
            }
            if (totalToolCalls + limited.length > MAX_TOTAL_TOOL_CALLS) {
                yield {
                    type: "warning",
                    code: "TOOL_CALL_BUDGET_EXCEEDED",
                    message: "Tool call budget exhausted — forcing final answer.",
                };
                contents.push({
                    role: "user",
                    parts: [
                        {
                            text: "[system] Tool budget exhausted. Answer using only the data you've already gathered.",
                        },
                    ],
                });
                continue;
            }

            const turnEvents: AgentEvent[] = [];
            const responseParts2 = await runToolBatch({
                userId: input.userId,
                conversationId: input.conversationId,
                calls: limited,
                emit: (e) => turnEvents.push(e),
            });

            for (const e of turnEvents) yield e;

            totalToolCalls += limited.length;
            deterministicFallback =
                buildReportQuestionFallback(input.message, responseParts2) ?? deterministicFallback;

            const requestedClarification = turnEvents.some((event) => event.type === "clarification_requested");
            if (requestedClarification) {
                if (!finalText.trim()) {
                    finalText = buildClarificationFollowupMessage();
                    yield { type: "token", text: finalText };
                }
                yield { type: "done", finalText, toolCallCount: totalToolCalls, iterations: iteration };
                return;
            }

            // If a propose_* / revise_* / commit tool created or committed an artifact,
            // exit early here. The draft card renders inline in the UI — the model's
            // streaming final turn would see the completed artifact and produce nothing,
            // which triggers the ugly fallback message. Instead we emit a short natural
            // follow-up and let the UI card carry the full content.
            const artifactCreatedEvent = turnEvents.find(
                (e): e is Extract<AgentEvent, { type: "artifact_created" }> => e.type === "artifact_created"
            );
            const artifactCommittedEvent = turnEvents.find(
                (e): e is Extract<AgentEvent, { type: "artifact_committed" }> => e.type === "artifact_committed"
            );
            if (artifactCreatedEvent) {
                const isDraft = artifactCreatedEvent.isDraft;
                const title = artifactCreatedEvent.title ?? "your draft";
                const savedLocation = artifactCreatedEvent.artifactType === "quiz"
                    ? "saved in this chat"
                    : "saved to your library";
                finalText = isDraft
                    ? `Here's your draft — **${title}**. Review it above, and hit **Approve** to save it or **Revise** if you'd like any changes.`
                    : `Done — **${title}** has been ${savedLocation}.`;
                yield { type: "token", text: finalText };
                yield { type: "done", finalText, toolCallCount: totalToolCalls, iterations: iteration };
                return;
            }
            if (artifactCommittedEvent) {
                const title = artifactCommittedEvent.title ?? "your plan";
                const savedLocation = artifactCommittedEvent.artifactType === "quiz"
                    ? "saved in this chat"
                    : "now in your library";
                finalText = `Saved! **${title}** is ${savedLocation}.`;
                yield { type: "token", text: finalText };
                yield { type: "done", finalText, toolCallCount: totalToolCalls, iterations: iteration };
                return;
            }

            contents.push({ role: "user", parts: responseParts2 });
            continue;
        }

        // ── Final iteration: stream tokens, no more tool calls allowed. ──
        try {
            const stream = await client.models.generateContentStream({
                model: GEMINI_PRO_MODEL,
                contents,
                config: {
                    systemInstruction: input.systemPrompt,
                    thinkingConfig: GEMINI_THINKING_MEDIUM,
                    // No tools on the last turn — force immediate answer.
                },
            });
            for await (const chunk of stream) {
                const delta = chunk.text;
                if (delta) {
                    finalText += delta;
                    yield { type: "token", text: delta };
                }
            }
            if (!finalText.trim() && deterministicFallback) {
                finalText = deterministicFallback;
                yield { type: "token", text: finalText };
            }
            yield { type: "done", finalText, toolCallCount: totalToolCalls, iterations: iteration };
            return;
        } catch (err: any) {
            yield { type: "error", message: err?.message ?? "model_stream_failed" };
            return;
        }
    }

    // Should be unreachable — final iteration always returns.
    yield { type: "done", finalText, toolCallCount: totalToolCalls, iterations: MAX_AGENT_ITERATIONS };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

async function safeGenerate(
    client: ReturnType<typeof getGeminiClient>,
    contents: Content[],
    systemInstruction: string,
    withTools: boolean,
    iteration: number
) {
    try {
        return await client.models.generateContent({
            model: withTools ? GEMINI_MODEL : GEMINI_PRO_MODEL,
            contents,
            config: {
                systemInstruction,
                thinkingConfig: GEMINI_THINKING_MEDIUM,
                ...(withTools ? { tools: TUTOR_AGENT_TOOLS } : {}),
            },
        });
    } catch (err) {
        console.error("[tutor-agent] generate failed", err);
        return null;
    }
}

function collectText(parts: Part[]): string {
    return parts
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("")
        .trim();
}

function buildReportQuestionFallback(message: string, parts: Part[]): string | null {
    if (!/\b(last|latest|recent|previous)\b[\s\S]{0,40}\b(interview|report)\b|\bhow did i do\b|\bmy score\b/i.test(message)) {
        return null;
    }

    const summaries = toolData(parts, "get_report_summary");
    const packs = toolData(parts, "get_user_context_pack");
    const lists = toolData(parts, "list_recent_reports");
    const summary = summaries[0];
    const contextReport = Array.isArray(packs[0]?.recentReports) ? (packs[0].recentReports as any[])[0] : null;
    const listedReport = Array.isArray(lists[0]?.reports) ? (lists[0].reports as any[])[0] : null;
    const report = summary ?? contextReport ?? listedReport;

    if (!report) {
        return "I don't see a completed interview report yet, so I can't score your last interview from saved data. Once an interview report is generated, I can summarize the score, strengths, and weak areas here.";
    }

    const type = prettifySessionType(textValue(report.type) ?? "interview");
    const score = numberValue(report.overallScore);
    const date = textValue(report.completedAt) ?? textValue(report.generatedAt);
    const dateText = formatShortDate(date);
    const lines: string[] = [];

    lines.push(
        score !== null
            ? `Your latest ${type}${dateText ? ` from ${dateText}` : ""} scored **${score}/100**.`
            : `I found your latest ${type}${dateText ? ` from ${dateText}` : ""}, but it does not have a saved overall score yet.`
    );

    const rubricLines = normalizeRubricScores(summary?.rubricScores).slice(0, 3);
    if (rubricLines.length > 0) {
        lines.push(`Rubric snapshot: ${rubricLines.join(", ")}.`);
    }

    const strengths = stringList(summary?.strengths).slice(0, 2);
    if (strengths.length > 0) {
        lines.push(`What went well: ${strengths.join("; ")}.`);
    }

    const improvements = stringList(summary?.improvements).slice(0, 2);
    const weakAreas = Array.isArray(packs[0]?.openWeakAreas)
        ? (packs[0].openWeakAreas as any[])
              .map((w) => [textValue(w.topic), textValue(w.category)].filter(Boolean).join(" in "))
              .filter(Boolean)
              .slice(0, 2)
        : [];
    const nextFocus = improvements.length > 0 ? improvements : weakAreas;
    if (nextFocus.length > 0) {
        lines.push(`Next focus: ${nextFocus.join("; ")}.`);
    }

    return lines.join("\n\n");
}

function toolData(parts: Part[], toolName: string): Array<Record<string, unknown>> {
    return parts
        .map((part) => (part as any).functionResponse)
        .filter((response) => response?.name === toolName && response?.response?.ok === true)
        .map((response) => response.response.data)
        .filter((data): data is Record<string, unknown> => !!data && typeof data === "object" && !Array.isArray(data));
}

function textValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    return Number.isFinite(n) ? Math.round(n) : null;
}

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
}

function normalizeRubricScores(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const record = item as Record<string, unknown>;
            const category = textValue(record.category) ?? textValue(record.name) ?? textValue(record.label);
            const score = numberValue(record.score);
            if (!category || score === null) return null;
            return `${category} ${score}/100`;
        })
        .filter((item): item is string => !!item);
}

function prettifySessionType(value: string): string {
    return value
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatShortDate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

type ClarificationSlot = {
    id: string;
    label: string;
    type: "chip" | "text";
    options?: string[];
    placeholder?: string;
    required?: boolean;
};

function extractClarificationFromText(text: string): {
    preface: string;
    context: string;
    slots: ClarificationSlot[];
} | null {
    const match = text.match(/\[clarify:[^\]]+\]\s*([\s\S]*)/i);
    if (!match) return null;

    const payload = (match[1] || "").trim();
    if (!payload) return null;

    const parts = payload.split(/\n\s*-\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
    const context = parts.length > 0 ? parts[0] : payload;
    const slotParts = parts.length > 1 ? parts.slice(1) : [];
    const slots: ClarificationSlot[] = [];

    for (const [idx, raw] of slotParts.entries()) {
        const labeled = raw.match(/^(.*?)[?:]\s*:?\s*(.*)$/);
        const label = (labeled?.[1] || raw).trim();
        const optionText = (labeled?.[2] || "").trim();
        const options = optionText
            ? optionText.split(/\s*(?:\||\/|,)\s*/).map((o) => o.trim()).filter(Boolean)
            : [];

        if (options.length > 1) {
            slots.push({
                id: `slot_${idx + 1}`,
                label,
                type: "chip",
                options: options.slice(0, 6),
                required: true,
            });
        } else {
            slots.push({
                id: `slot_${idx + 1}`,
                label,
                type: "text",
                placeholder: options[0] || undefined,
                required: true,
            });
        }
    }

    if (slots.length === 0) {
        slots.push({
            id: "slot_1",
            label: "Your answer",
            type: "text",
            required: true,
        });
    }

    return {
        preface: "Quick detail before I draft this.",
        context,
        slots,
    };
}

async function runToolBatch(input: {
    userId: string;
    conversationId: string | null;
    calls: FunctionCall[];
    emit: (e: AgentEvent) => void;
}): Promise<Part[]> {
    // Execute in parallel; emit started/completed events around each.
    const tasks = input.calls.map(async (call, idx) => {
        const name = call.name ?? "unknown";
        const args = (call.args ?? {}) as Record<string, unknown>;
        const callId = `${idx}_${name}_${Date.now().toString(36)}`;

        input.emit({ type: "tool_call_started", callId, tool: name, args });

        const result = await executeAgentTool(input.userId, name, args);

        input.emit({
            type: "tool_call_completed",
            callId,
            tool: name,
            ok: result.ok,
            latencyMs: result.latencyMs,
            errorCode: result.errorCode,
        });

        // Side-effects per tool family — surfaced to the UI as derived events.
        if (result.ok) {
            const data = result.data as Record<string, unknown> | null | undefined;

            // 1) Skill tools (create_* / propose_* / revise_*) produce / refresh an artifact.
            if (data && SKILL_CREATE_TOOL_NAMES.has(name)) {
                const artifactId =
                    typeof data.artifactId === "string"
                        ? data.artifactId
                        : typeof data.draftId === "string"
                            ? (data.draftId as string)
                            : null;
                const title = typeof data.title === "string" ? data.title : null;
                if (artifactId && title) {
                    input.emit({
                        type: "artifact_created",
                        artifactId,
                        artifactType: typeof data.type === "string" ? (data.type as string) : "artifact",
                        title,
                        summary: typeof data.summary === "string" ? (data.summary as string) : null,
                        isDraft: data.isDraft === true,
                    });
                }
            }

            // 2) commit_artifact transitions a draft → committed; emit so the UI
            //    can flip the card UI and remove approve/revise buttons.
            if (data && name === COMMIT_TOOL_NAME) {
                const artifactId = typeof data.artifactId === "string" ? data.artifactId : null;
                const title = typeof data.title === "string" ? data.title : null;
                if (artifactId && title) {
                    input.emit({
                        type: "artifact_committed",
                        artifactId,
                        resourceId: typeof data.resourceId === "string" ? data.resourceId : null,
                        artifactType: typeof data.type === "string" ? (data.type as string) : "artifact",
                        title,
                    });
                }
            }

            // 3) request_clarification — pause and ask the user via inline UI.
            if (data && name === CLARIFICATION_TOOL_NAME) {
                const sentinel = (data as any).__clarification as
                    | { context?: string; slots?: any[] }
                    | undefined;
                if (sentinel && Array.isArray(sentinel.slots) && sentinel.slots.length > 0) {
                    input.emit({
                        type: "clarification_requested",
                        context: typeof sentinel.context === "string" ? sentinel.context : "",
                        slots: sentinel.slots as any,
                    });
                }
            }
        }

        // Persist the call (fire-and-forget).
        logToolCall({ userId: input.userId, conversationId: input.conversationId, result });

        return { call, result };
    });

    const settled = await Promise.all(tasks);

    return settled.map<Part>(({ call, result }) => ({
        functionResponse: {
            name: call.name ?? "unknown",
            response: shapeResponseForModel(result),
        },
    }));
}

/**
 * The model only sees what we put here. Keep it tight so token cost
 * stays bounded, and never include error stacks.
 */
function shapeResponseForModel(result: ToolExecutionResult): Record<string, unknown> {
    if (result.ok) {
        return { ok: true, data: result.data };
    }
    return {
        ok: false,
        error: {
            code: result.errorCode ?? "TOOL_FAILED",
            message: result.errorMessage ?? "Tool failed.",
        },
    };
}
