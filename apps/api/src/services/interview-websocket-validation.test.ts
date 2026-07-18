const {
    chatMessagePayloadSchema,
    codeRunPayloadSchema,
    parseVoiceTextPayload,
    sessionJoinPayloadSchema,
    voiceMutePayloadSchema,
} = require("./interview-websocket-validation.js");

describe("websocket payload validation", () => {
    test("accepts valid session join payload", () => {
        const parsed = sessionJoinPayloadSchema.safeParse({
            sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
            isVoiceMode: true,
        });

        expect(parsed.success).toBe(true);
    });

    test("rejects invalid chat message payload", () => {
        const parsed = chatMessagePayloadSchema.safeParse({ content: "" });
        expect(parsed.success).toBe(false);
    });

    test("accepts valid code run payload", () => {
        const parsed = codeRunPayloadSchema.safeParse({
            code: "print('hello')",
            language: "python",
            questionId: "q_123",
        });

        expect(parsed.success).toBe(true);
    });

    test("rejects invalid voice mute payload", () => {
        const parsed = voiceMutePayloadSchema.safeParse({ muted: "yes" });
        expect(parsed.success).toBe(false);
    });

    test("accepts voice text payload when canvas snapshot is null", () => {
        const result = parseVoiceTextPayload({ text: "hello", canvasSnapshot: null });
        expect(result.success).toBe(true);
    });

    test("accepts voice text payload and ignores invalid optional canvas snapshot", () => {
        const result = parseVoiceTextPayload({ text: "hello", canvasSnapshot: "invalid" });
        expect(result.success).toBe(true);
        if (!result.success) throw new Error("Expected voice:text parse success");
        expect(result.ignoredInvalidCanvasSnapshot).toBe(true);
    });
});
