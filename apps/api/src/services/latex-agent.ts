// ============================================
// LaTeX Resume AI Agent
// ============================================
// Agentic loop: Gemini Pro with function calling.
// Tools: read_source, compile, replace_text, finish.
// Streams SSE events back to the client.

import { type Tool, type Content, Type } from "@google/genai";
import { getGeminiClient, GEMINI_PRO_MODEL, GEMINI_THINKING_HIGH } from "../lib/gemini.js";
import { cloudRunAuthHeaders } from "../lib/gcp-identity.js";

const LATEX_COMPILER_URL = process.env.LATEX_COMPILER_URL || "http://localhost:3002";
const MAX_ITERATIONS = 12;

// ── Types ────────────────────────────────────────────────────

export type AgentEvent =
    | { type: "status"; message: string }
    | { type: "edit"; originalText: string; newText: string; description: string; updatedSource?: string }
    | { type: "compile_result"; success: boolean; errors: { line: number; message: string; severity: string }[]; warnings: string[] }
    | { type: "message"; content: string }
    | { type: "done"; summary: string; updatedSource?: string }
    | { type: "error"; message: string };

// ── System Prompt ────────────────────────────────────────────

const AGENT_SYSTEM = `You are an expert LaTeX resume editor embedded in a coding IDE.
You work in an agentic loop with tools — exactly like Cursor or Windsurf.

Your tools:
- read_source: Read the current LaTeX source code
- compile: Compile the LaTeX and get any errors or warnings
- replace_text: Replace an exact verbatim snippet with new text (surgical edits)
- finish: Signal you are done and provide a summary

Your workflow:
1. Always start by calling read_source to understand the document
2. For "fix errors" tasks: compile first to see what is broken
3. Make targeted edits with replace_text — small, surgical changes
4. After edits, compile again to verify the fix worked
5. If new errors appear, diagnose and fix them
6. Repeat until the LaTeX compiles cleanly or the task is done
7. Call finish when done

CRITICAL: When optimizing or improving resume content:
- NEVER invent specific numbers, percentages, or metrics that are not already in the document
- If quantification would improve the content, use placeholders like [X%], [N users], [Y hours] to indicate where metrics should be added
- Ask the user to provide the actual values for these placeholders

Critical rules for replace_text:
- originalText must be EXACT, VERBATIM text from the current source — every character must match
- Keep originalText short enough to be unique in the document (a few lines at most)
- newText must be valid LaTeX — preserve indentation, closing braces, environments
- Never break brace nesting — every { must have a matching }
- Never remove \\begin/\\end pairs without adding matching ones
- Max 3 compile attempts. Do not loop forever if errors persist.`;

// ── Tool declarations ─────────────────────────────────────────

const AGENT_TOOLS: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "read_source",
                description: "Read the current LaTeX source code in full to understand the document before making changes.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {},
                },
            },
            {
                name: "compile",
                description: "Compile the current LaTeX source. Returns success/failure plus any errors (with line numbers) and warnings.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {},
                },
            },
            {
                name: "replace_text",
                description: "Replace an exact verbatim snippet of the LaTeX source with new text.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        originalText: {
                            type: Type.STRING,
                            description: "The exact verbatim text from the document to replace (must match character-for-character)",
                        },
                        newText: {
                            type: Type.STRING,
                            description: "The replacement LaTeX code",
                        },
                        description: {
                            type: Type.STRING,
                            description: "One-line description of this change for the user",
                        },
                    },
                    required: ["originalText", "newText", "description"],
                },
            },
            {
                name: "finish",
                description: "Signal the task is complete. Provide a clear summary of all changes made.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        summary: {
                            type: Type.STRING,
                            description: "Summary of what was done",
                        },
                    },
                    required: ["summary"],
                },
            },
        ],
    },
];

// ── Compile helper (calls Docker service directly, no R2 upload) ──

async function compileLatex(source: string): Promise<{
    success: boolean;
    errors: { line: number; message: string; severity: string }[];
    warnings: string[];
}> {
    try {
        const res = await fetch(`${LATEX_COMPILER_URL}/compile`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...await cloudRunAuthHeaders(LATEX_COMPILER_URL),
            },
            body: JSON.stringify({ source }),
            signal: AbortSignal.timeout(60_000),
        });
        const data = await res.json() as {
            success: boolean;
            errors?: { line: number; message: string; severity: string }[];
            warnings?: string[];
        };
        return {
            success: data.success,
            errors: data.errors ?? [],
            warnings: data.warnings ?? [],
        };
    } catch {
        return {
            success: false,
            errors: [{ line: 0, message: "Compiler service unreachable", severity: "error" }],
            warnings: [],
        };
    }
}

// ── Agent loop ────────────────────────────────────────────────

export async function* runLatexAgent(
    userMessage: string,
    initialSource: string
): AsyncGenerator<AgentEvent & { updatedSource?: string }> {
    const client = getGeminiClient();
    let source = initialSource;
    let compileCount = 0;

    const contents: Content[] = [
        { role: "user", parts: [{ text: userMessage }] },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        let response;
        try {
            response = await client.models.generateContent({
                model: GEMINI_PRO_MODEL,
                contents,
                config: {
                    systemInstruction: AGENT_SYSTEM,
                    tools: AGENT_TOOLS,
                    thinkingConfig: GEMINI_THINKING_HIGH,
                },
            });
        } catch (err) {
            yield { type: "error", message: `AI request failed: ${(err as Error).message}` };
            return;
        }

        const responseParts = response.candidates?.[0]?.content?.parts ?? [];
        contents.push({ role: "model", parts: responseParts });

        // Yield any text from the model
        const textPart = responseParts.find((p) => p.text);
        if (textPart?.text) {
            yield { type: "message", content: textPart.text };
        }

        const functionCalls = response.functionCalls;
        if (!functionCalls || functionCalls.length === 0) {
            yield { type: "done", summary: textPart?.text ?? "Task complete.", updatedSource: source };
            return;
        }

        // Execute each tool call and collect responses
        const toolResponseParts: Content["parts"] = [];

        for (const call of functionCalls) {
            const name = call.name ?? "";
            const args = (call.args ?? {}) as Record<string, string>;

            if (name === "read_source") {
                yield { type: "status", message: "Reading document..." };
                toolResponseParts.push({
                    functionResponse: { name, response: { source } },
                });

            } else if (name === "compile") {
                if (compileCount >= 3) {
                    toolResponseParts.push({
                        functionResponse: { name, response: { error: "Max compile attempts reached. Call finish now." } },
                    });
                    continue;
                }
                compileCount++;
                yield { type: "status", message: `Compiling... (attempt ${compileCount})` };
                const result = await compileLatex(source);
                yield { type: "compile_result", ...result };
                toolResponseParts.push({
                    functionResponse: { name, response: result as unknown as Record<string, unknown> },
                });

            } else if (name === "replace_text") {
                const originalText = args.originalText ?? "";
                const newText = args.newText ?? "";
                const description = args.description ?? "Edit";

                // Exact match first, then trimmed fallback
                const searchText = source.includes(originalText)
                    ? originalText
                    : source.includes(originalText.trim())
                        ? originalText.trim()
                        : null;

                if (searchText !== null) {
                    source = source.replace(searchText, newText);
                    yield { type: "edit", originalText: searchText, newText, description, updatedSource: source };
                    toolResponseParts.push({
                        functionResponse: { name, response: { success: true } },
                    });
                } else {
                    toolResponseParts.push({
                        functionResponse: {
                            name,
                            response: { success: false, error: "Text not found in source. Call read_source to re-read the document before retrying." },
                        },
                    });
                }

            } else if (name === "finish") {
                const summary = args.summary ?? "Done.";
                yield { type: "done", summary, updatedSource: source };
                return;
            }
        }

        contents.push({ role: "user", parts: toolResponseParts });
    }

    yield { type: "done", summary: "Max iterations reached.", updatedSource: source };
}
