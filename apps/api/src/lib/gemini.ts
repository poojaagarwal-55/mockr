// ============================================
// Google Gemini Client (for resume & report services)
// ============================================
// Uses @google/genai SDK for thinking and system instruction caching.
// System instructions are sent as `systemInstruction` so Gemini's
// server-side implicit caching kicks in across repeated calls.

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { createGroqGeminiShim } from "./groq.js";

let _client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
    if (!_client) {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (apiKey) {
            _client = new GoogleGenAI({ apiKey });
        } else if (process.env.GROQ_API_KEY) {
            // Gemini key not available — fall back to Groq via a Gemini-compatible
            // shim so every call site keeps working unchanged. Blank
            // GOOGLE_GENERATIVE_AI_API_KEY in the env to activate this path.
            console.warn(
                "[gemini] GOOGLE_GENERATIVE_AI_API_KEY not set — falling back to Groq for all Gemini-backed features."
            );
            _client = createGroqGeminiShim();
        } else {
            throw new Error(
                "Neither GOOGLE_GENERATIVE_AI_API_KEY nor GROQ_API_KEY is configured"
            );
        }
    }
    return _client;
}

/**
 * Whether any Gemini-backed provider is available — either a real Gemini key,
 * or a Groq key to fall back to. Call sites that pre-check configuration before
 * invoking the client should use this instead of reading the Gemini key
 * directly, so the Groq fallback path isn't short-circuited.
 */
export function isGeminiBackedAvailable(): boolean {
    return !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GROQ_API_KEY);
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL || "gemini-3.5-flash";
export const GEMINI_REPORT_MODEL = process.env.GEMINI_REPORT_MODEL || "gemini-3.5-flash";
export const GEMINI_REPORT_PRO_MODEL = process.env.GEMINI_REPORT_PRO_MODEL || "gemini-3.5-flash";

export const GEMINI_THINKING_MEDIUM = { thinkingLevel: ThinkingLevel.MEDIUM };
export const GEMINI_THINKING_HIGH = { thinkingLevel: ThinkingLevel.HIGH };

// ============================================
// Resilient generation (retry + robust JSON)
// ============================================
// Gemini intermittently returns transient failures (429 rate-limit, 5xx
// "model overloaded"/"unavailable", network resets) or an empty body
// (thinking budget exhausted, momentary safety hiccup). It also occasionally
// emits slightly malformed JSON. None of these should bubble up as a hard
// failure on the first try — the call usually succeeds on a quick retry.
// These helpers centralize that resilience so every resume/LaTeX AI feature
// gets the same reliability instead of failing on a single hiccup.

/** Error thrown when the model output cannot be parsed as JSON (retriable). */
export class GeminiJsonError extends Error {
    constructor(message = "Gemini returned invalid JSON") {
        super(message);
        this.name = "GeminiJsonError";
    }
}

/** Error thrown when the model returns an empty body (retriable). */
export class GeminiEmptyError extends Error {
    constructor(message = "Gemini returned an empty response") {
        super(message);
        this.name = "GeminiEmptyError";
    }
}

const RETRIABLE_ERROR =
    /\b(408|409|425|429|500|502|503|504|overloaded|unavailable|rate.?limit|deadline|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|internal error)\b/i;

function isRetriableGeminiError(err: unknown): boolean {
    if (err instanceof GeminiJsonError || err instanceof GeminiEmptyError) return true;
    const anyErr = err as { status?: number; code?: number; response?: { status?: number }; message?: string };
    const status = anyErr?.status ?? anyErr?.code ?? anyErr?.response?.status;
    if (typeof status === "number" && [408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
    const msg = anyErr?.message ?? String(err ?? "");
    return RETRIABLE_ERROR.test(msg);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type GenerateContentParams = Parameters<GoogleGenAI["models"]["generateContent"]>[0];

/**
 * Robustly extract a JSON object from model output. Handles markdown code
 * fences and leading/trailing prose by isolating the first balanced { ... }.
 * Throws GeminiJsonError (retriable) when nothing parseable is found.
 */
export function extractJsonObject<T = any>(text: string): T {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();

    try {
        return JSON.parse(cleaned) as T;
    } catch {
        // fall through to balanced-brace extraction
    }

    const start = cleaned.indexOf("{");
    if (start !== -1) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < cleaned.length; i++) {
            const c = cleaned[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (c === "\\") escaped = true;
                else if (c === '"') inString = false;
                continue;
            }
            if (c === '"') inString = true;
            else if (c === "{") depth++;
            else if (c === "}") {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(cleaned.slice(start, i + 1)) as T;
                    } catch {
                        break;
                    }
                }
            }
        }
    }

    throw new GeminiJsonError();
}

/**
 * Calls Gemini with exponential backoff + jitter on transient errors and
 * returns the raw text. Empty bodies are treated as transient by default.
 */
export async function generateTextWithRetry(
    params: GenerateContentParams,
    opts: { retries?: number; requireText?: boolean } = {}
): Promise<string> {
    const retries = opts.retries ?? 3;
    const requireText = opts.requireText ?? true;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await getGeminiClient().models.generateContent(params);
            const text = result.text ?? "";
            if (requireText && !text.trim()) throw new GeminiEmptyError();
            return text;
        } catch (err) {
            lastErr = err;
            if (attempt < retries && isRetriableGeminiError(err)) {
                const backoff = Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400);
                await sleep(backoff);
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

/**
 * Like generateTextWithRetry but also parses the result as JSON, retrying on
 * malformed output. Guarantees a parsed object or throws after all retries.
 */
export async function generateJsonWithRetry<T = any>(
    params: GenerateContentParams,
    opts: { retries?: number } = {}
): Promise<T> {
    const retries = opts.retries ?? 3;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // Inner call does no retrying; this loop owns retry so JSON-parse
            // failures also trigger a fresh generation, not just API errors.
            const text = await generateTextWithRetry(params, { retries: 0 });
            return extractJsonObject<T>(text);
        } catch (err) {
            lastErr = err;
            if (attempt < retries && isRetriableGeminiError(err)) {
                const backoff = Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 400);
                await sleep(backoff);
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}
