// ============================================
// xAI Client — Grok LLM + TTS
// ============================================
// Shared OpenAI-compatible client for xAI's API.
// Used by all services: interview orchestrator,
// voice pipeline, resume analysis, report generation.

import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getXAIClient(): OpenAI {
    if (!_client) {
        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) throw new Error("XAI_API_KEY not configured");
        _client = new OpenAI({
            apiKey,
            baseURL: "https://api.x.ai/v1",
        });
    }
    return _client;
}

export const XAI_MODEL = "grok-4.20-0309-non-reasoning";

// Used for one-shot Responses API calls (e.g. resume web search pre-flight).
// xAI requires grok-4 family for server-side tools (web_search).
// Using "grok-4" (base) as a safe fallback — grok-4-mini may not exist.
export const XAI_RESPONSES_MODEL = "grok-4";
