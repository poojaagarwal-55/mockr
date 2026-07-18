const { validateToolArgs } = require("./tool-args-schema.js");

describe("tool argument validation", () => {
    test("accepts valid transition_stage arguments", () => {
        const result = validateToolArgs("transition_stage", {
            nextStage: "FUNDAMENTALS",
            reason: "DSA section completed",
        });

        expect(result).toEqual({
            success: true,
            data: {
                nextStage: "FUNDAMENTALS",
                reason: "DSA section completed",
            },
        });
    });

    test("rejects invalid transition_stage stage", () => {
        const result = validateToolArgs("transition_stage", {
            nextStage: "INVALID_STAGE",
            reason: "bad",
        });

        expect(result.success).toBe(false);
        if (result.success) throw new Error("Expected transition_stage validation to fail");
        expect(result.message).toContain("Invalid arguments for transition_stage");
    });

    test("rejects out-of-range hint numbers", () => {
        const result = validateToolArgs("give_hint", {
            questionId: "abc123",
            hintNumber: 99,
        });

        expect(result.success).toBe(false);
        if (result.success) throw new Error("Expected give_hint validation to fail");
        expect(result.message).toContain("hintNumber");
    });

    test("accepts record_question without optional referenceAnswer", () => {
        const result = validateToolArgs("record_question", {
            questionFundamentalId: "mongo-id",
            questionTitle: "Explain ACID properties",
        });

        expect(result).toEqual({
            success: true,
            data: {
                questionFundamentalId: "mongo-id",
                questionTitle: "Explain ACID properties",
            },
        });
    });
});
