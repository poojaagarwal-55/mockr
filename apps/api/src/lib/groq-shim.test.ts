process.env.GROQ_API_KEY = "test-key";

import { createGroqGeminiShim, getGroqClient } from "./groq.js";

describe("groq gemini-compat shim", () => {
    it("translates a multi-turn tool conversation and maps the response", async () => {
        const client = getGroqClient();
        let captured: any = null;
        // Stub the network call; echo a tool-call response.
        (client.chat.completions as any).create = async (body: any) => {
            captured = body;
            return {
                choices: [
                    {
                        message: {
                            content: "I'll read the source first.",
                            tool_calls: [
                                {
                                    id: "x",
                                    type: "function",
                                    function: { name: "read_source", arguments: "{}" },
                                },
                            ],
                        },
                    },
                ],
            };
        };

        const shim = createGroqGeminiShim();
        const response: any = await shim.models.generateContent({
            model: "gemini-3.5-flash",
            contents: [
                { role: "user", parts: [{ text: "Make my resume bold." }] },
                {
                    role: "model",
                    parts: [{ functionCall: { name: "read_source", args: {} } }],
                },
                {
                    role: "user",
                    parts: [{ functionResponse: { name: "read_source", response: { source: "\\textbf{hi}" } } }],
                },
            ],
            config: {
                systemInstruction: "You are a LaTeX agent.",
                tools: [
                    {
                        functionDeclarations: [
                            { name: "read_source", description: "Read it", parameters: { type: "OBJECT", properties: {} } },
                        ],
                    },
                ],
                thinkingConfig: { thinkingLevel: "HIGH" },
            },
        } as any);

        // ── Request translation ──
        const roles = captured.messages.map((m: any) => m.role);
        expect(roles).toEqual(["system", "user", "assistant", "tool"]);

        const assistant = captured.messages[2];
        expect(assistant.tool_calls).toHaveLength(1);
        const toolMsg = captured.messages[3];
        // tool message id must match the assistant tool_call id (name-correlated)
        expect(toolMsg.tool_call_id).toBe(assistant.tool_calls[0].id);
        expect(JSON.parse(toolMsg.content)).toEqual({ source: "\\textbf{hi}" });

        // tool schema lowercased to JSON Schema
        expect(captured.tools[0].function.parameters.type).toBe("object");
        // thinking -> reasoning_effort
        expect(captured.reasoning_effort).toBe("high");

        // ── Response mapping ──
        expect(response.text).toBe("I'll read the source first.");
        expect(response.functionCalls).toEqual([{ name: "read_source", args: {} }]);
        const parts = response.candidates[0].content.parts;
        expect(parts.some((p: any) => p.text)).toBe(true);
        expect(parts.some((p: any) => p.functionCall?.name === "read_source")).toBe(true);
    });

    it("maps JSON mode and streams text", async () => {
        const client = getGroqClient();
        let captured: any = null;
        (client.chat.completions as any).create = async (body: any) => {
            captured = body;
            async function* gen() {
                yield { choices: [{ delta: { content: "Hello " } }] };
                yield { choices: [{ delta: { content: "world" } }] };
            }
            return gen();
        };

        const shim = createGroqGeminiShim();
        const stream: any = await shim.models.generateContentStream({
            model: "gemini-3.5-flash",
            contents: "Return JSON please",
            config: { responseMimeType: "application/json", temperature: 0.2 },
        } as any);

        expect(captured.response_format).toEqual({ type: "json_object" });
        expect(captured.temperature).toBe(0.2);

        let text = "";
        for await (const chunk of stream) text += chunk.text;
        expect(text).toBe("Hello world");
    });
});
