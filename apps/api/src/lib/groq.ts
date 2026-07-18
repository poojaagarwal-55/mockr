// ============================================
// Groq Fallback Client + Gemini-compatible shim
// ============================================
// When GOOGLE_GENERATIVE_AI_API_KEY is not configured (e.g. the key has
// expired and was removed from the env), `getGeminiClient()` returns the shim
// built here instead of a real GoogleGenAI client.
//
// The shim implements ONLY the slice of the @google/genai surface this codebase
// actually uses — `models.generateContent()` and `models.generateContentStream()`
// — translating those calls to Groq's OpenAI-compatible Chat Completions API.
// This lets every existing Gemini call site keep working unchanged.
//
// Groq is OpenAI-compatible, so we reuse the `openai` SDK (already a dependency
// for the xAI client) pointed at Groq's base URL — no new package required.
//
// Scope / known limitations (verified against current call sites):
//   - Text only. gpt-oss-120b on Groq has no vision; the codebase sends no
//     multimodal (inlineData/fileData) parts, so this is fine today.
//   - Structured output uses Gemini's schema-less JSON mode
//     (responseMimeType: "application/json"), mapped to Groq json_object mode.
//   - Tool calling (functionDeclarations) is translated to OpenAI tools, and
//     responses are mapped back to Gemini's functionCalls / parts shape.

import OpenAI from "openai";
import type { GoogleGenAI } from "@google/genai";
import { getXAIClient, XAI_MODEL } from "./xai.js";

let _client: OpenAI | null = null;

export function getGroqClient(): OpenAI {
    if (!_client) {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error("GROQ_API_KEY not configured");
        _client = new OpenAI({
            apiKey,
            baseURL: "https://api.groq.com/openai/v1",
        });
    }
    return _client;
}

// Single Groq model used for every fallback call regardless of which Gemini
// model the caller asked for (all the GEMINI_* constants currently resolve to
// the same flash model anyway). Override via GROQ_MODEL.
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// ── Gemini → OpenAI translation helpers ──────────────────────────

type AnyObj = Record<string, unknown>;

// Gemini's Type enum is UPPERCASE ("OBJECT" / "STRING" / ...). JSON Schema (and
// therefore OpenAI tool parameters) wants lowercase. Recursively normalize.
function toJsonSchema(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(toJsonSchema);
    if (node && typeof node === "object") {
        const out: AnyObj = {};
        for (const [k, v] of Object.entries(node as AnyObj)) {
            if (k === "type" && typeof v === "string") out[k] = v.toLowerCase();
            else out[k] = toJsonSchema(v);
        }
        return out;
    }
    return node;
}

function geminiToolsToOpenAI(
    tools: unknown
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
    if (!Array.isArray(tools)) return undefined;
    const out: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
    for (const tool of tools) {
        const decls = (tool as AnyObj)?.functionDeclarations;
        if (!Array.isArray(decls)) continue;
        for (const fd of decls) {
            const decl = fd as AnyObj;
            out.push({
                type: "function",
                function: {
                    name: String(decl.name),
                    description: decl.description ? String(decl.description) : undefined,
                    parameters: decl.parameters
                        ? (toJsonSchema(decl.parameters) as AnyObj)
                        : { type: "object", properties: {} },
                },
            });
        }
    }
    return out.length ? out : undefined;
}

function safeParseArgs(raw: string | undefined): AnyObj {
    if (!raw) return {};
    try {
        return JSON.parse(raw) as AnyObj;
    } catch {
        return {};
    }
}

// Map Gemini's thinkingConfig to gpt-oss reasoning_effort (low|medium|high).
function mapReasoningEffort(thinkingConfig: unknown): "low" | "medium" | "high" | undefined {
    const level = (thinkingConfig as AnyObj)?.thinkingLevel;
    if (level == null) return undefined;
    const s = String(level).toLowerCase();
    if (s.includes("high")) return "high";
    if (s.includes("low")) return "low";
    return "medium";
}

// Translate Gemini `contents` (string | Content | Content[]) plus a
// systemInstruction into an OpenAI message array. Crucially, Gemini correlates
// tool calls/responses by function NAME while OpenAI correlates by an opaque
// tool_call_id — so we assign ids to assistant tool_calls and match the
// following functionResponse parts to them by name+order.
function geminiContentsToMessages(
    contents: unknown,
    systemInstruction: unknown
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    const sysText =
        typeof systemInstruction === "string"
            ? systemInstruction
            : extractTextFromParts((systemInstruction as AnyObj)?.parts);
    if (sysText) messages.push({ role: "system", content: sysText });

    const list: AnyObj[] =
        typeof contents === "string"
            ? [{ role: "user", parts: [{ text: contents }] }]
            : Array.isArray(contents)
                ? (contents as AnyObj[])
                : contents
                    ? [contents as AnyObj]
                    : [];

    // Pending tool_calls awaiting their responses (from the most recent
    // assistant turn), used to assign tool_call_id to the next tool messages.
    let pending: { name: string; id: string }[] = [];
    let callCounter = 0;

    for (const content of list) {
        const role = content.role;
        const parts = Array.isArray(content.parts) ? (content.parts as AnyObj[]) : [];
        const textParts = parts.filter((p) => typeof p.text === "string" && (p.text as string).length > 0);
        const fnCalls = parts.filter((p) => p.functionCall);
        const fnResponses = parts.filter((p) => p.functionResponse);

        if (role === "model" || role === "assistant") {
            const text = textParts.map((p) => p.text as string).join("");
            if (fnCalls.length > 0) {
                pending = [];
                const toolCalls = fnCalls.map((p) => {
                    const fc = p.functionCall as AnyObj;
                    const id = `call_${callCounter++}`;
                    pending.push({ name: String(fc.name), id });
                    return {
                        id,
                        type: "function" as const,
                        function: {
                            name: String(fc.name),
                            arguments: JSON.stringify(fc.args ?? {}),
                        },
                    };
                });
                messages.push({
                    role: "assistant",
                    content: text || null,
                    tool_calls: toolCalls,
                });
            } else {
                messages.push({ role: "assistant", content: text });
            }
            continue;
        }

        // role === "user" (or unspecified)
        if (fnResponses.length > 0) {
            for (const p of fnResponses) {
                const fr = p.functionResponse as AnyObj;
                const name = String(fr.name);
                let idx = pending.findIndex((pc) => pc.name === name);
                if (idx === -1) idx = pending.length ? 0 : -1;
                const match = idx >= 0 ? pending.splice(idx, 1)[0] : undefined;
                messages.push({
                    role: "tool",
                    tool_call_id: match ? match.id : `call_${callCounter++}`,
                    content: JSON.stringify(fr.response ?? {}),
                });
            }
        }
        if (textParts.length > 0) {
            messages.push({ role: "user", content: textParts.map((p) => p.text as string).join("\n") });
        }
    }

    return messages;
}

function extractTextFromParts(parts: unknown): string {
    if (!Array.isArray(parts)) return "";
    return parts
        .map((p) => (typeof (p as AnyObj)?.text === "string" ? ((p as AnyObj).text as string) : ""))
        .filter(Boolean)
        .join("");
}

// Build a Gemini-shaped response object from an OpenAI completion. Only the
// fields the codebase reads are populated: `.text`, `.functionCalls`, and
// `.candidates[0].content.parts`.
function buildGeminiResponse(completion: OpenAI.Chat.Completions.ChatCompletion) {
    const message = completion.choices?.[0]?.message;
    const text = message?.content ?? "";
    const toolCalls = message?.tool_calls ?? [];

    const functionCalls = toolCalls
        .filter((tc) => tc.type === "function")
        .map((tc) => ({
            name: tc.function.name,
            args: safeParseArgs(tc.function.arguments),
        }));

    const parts: AnyObj[] = [];
    if (text) parts.push({ text });
    for (const fc of functionCalls) parts.push({ functionCall: { name: fc.name, args: fc.args } });

    return {
        text,
        functionCalls: functionCalls.length ? functionCalls : undefined,
        candidates: [{ content: { role: "model", parts } }],
    };
}

// Shared param builder for both streaming and non-streaming requests.
function buildRequestBody(params: AnyObj, model: string) {
    const config = (params.config ?? {}) as AnyObj;
    const messages = geminiContentsToMessages(params.contents, config.systemInstruction);

    const jsonMode = config.responseMimeType === "application/json";
    // json_object mode (OpenAI/Groq) requires the literal word "json" somewhere
    // in the prompt. Gemini's JSON prompts usually include it, but guarantee it.
    if (jsonMode && !messages.some((m) => typeof m.content === "string" && /json/i.test(m.content))) {
        messages.push({ role: "system", content: "Respond ONLY with valid JSON." });
    }

    const body: AnyObj = {
        model,
        messages,
    };
    if (jsonMode) body.response_format = { type: "json_object" };
    if (typeof config.temperature === "number") body.temperature = config.temperature;
    if (typeof config.maxOutputTokens === "number") body.max_completion_tokens = config.maxOutputTokens;

    const tools = geminiToolsToOpenAI(config.tools);
    if (tools) body.tools = tools;

    const effort = mapReasoningEffort(config.thinkingConfig);
    if (effort) body.reasoning_effort = effort;

    return body;
}

/**
 * Build an object that is structurally compatible with the subset of the
 * GoogleGenAI client the codebase uses, but backed by Groq. Returned cast to
 * `GoogleGenAI` so existing call sites and their types keep working unchanged.
 */
/**
 * Generic OpenAI-compatible → Gemini shim. Any provider exposing an OpenAI Chat
 * Completions API (Groq, xAI/Grok, …) can back the Gemini call sites unchanged.
 */
function createOpenAICompatGeminiShim(client: OpenAI, model: string): GoogleGenAI {
    const models = {
        async generateContent(params: AnyObj) {
            const body = buildRequestBody(params, model);
            const completion = (await client.chat.completions.create(
                body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
            )) as OpenAI.Chat.Completions.ChatCompletion;
            return buildGeminiResponse(completion);
        },

        async generateContentStream(params: AnyObj) {
            const body = buildRequestBody(params, model);
            body.stream = true;
            const stream = (await client.chat.completions.create(
                body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
            )) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

            // Gemini streams objects exposing `.text` per chunk.
            return (async function* () {
                for await (const chunk of stream) {
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (delta) yield { text: delta };
                }
            })();
        },
    };

    return { models } as unknown as GoogleGenAI;
}

export function createGroqGeminiShim(): GoogleGenAI {
    return createOpenAICompatGeminiShim(getGroqClient(), GROQ_MODEL);
}

/**
 * xAI/Grok-backed Gemini shim. Lets Gemini-backed features run on the existing xAI
 * credits when no Gemini/Groq key is available — used by the screening JD builder so
 * recruiters can generate plans without provisioning a new key.
 */
export function createXAIGeminiShim(): GoogleGenAI {
    return createOpenAICompatGeminiShim(getXAIClient(), XAI_MODEL);
}
