import {
    validateEndInterview,
    validateStageTransition,
} from "./interview-state-machine.js";

describe("interview state machine", () => {

    test("allows next sequential stage transition", () => {
        const result = validateStageTransition({
            interviewType: "cs_fundamentals",
            currentStage: "INTRO",
            nextStage: "FUNDAMENTALS",
            stageOrder: ["INTRO", "FUNDAMENTALS", "CLOSING"],
        });

        expect(result).toMatchObject({
            allowed: true,
            code: "ok",
            expectedNextStage: "FUNDAMENTALS",
        });
    });

    test("blocks skipped stages", () => {
        const result = validateStageTransition({
            interviewType: "full_interview",
            currentStage: "INTRO",
            nextStage: "CLOSING",
            stageOrder: ["INTRO", "DSA", "FUNDAMENTALS", "CLOSING"],
        });

        expect(result).toMatchObject({
            allowed: false,
            code: "stage_skip_blocked",
            expectedNextStage: "DSA",
        });
    });

    test("blocks non-forward transitions", () => {
        const result = validateStageTransition({
            interviewType: "full_interview",
            currentStage: "FUNDAMENTALS",
            nextStage: "DSA",
            stageOrder: ["INTRO", "DSA", "FUNDAMENTALS", "CLOSING"],
        });

        expect(result).toMatchObject({
            allowed: false,
            code: "non_forward_transition",
            expectedNextStage: "CLOSING",
        });
    });

    test("blocks invalid next stage for interview type", () => {
        const result = validateStageTransition({
            interviewType: "coding",
            currentStage: "DSA",
            nextStage: "SYSTEM_DESIGN",
            stageOrder: ["DSA"],
        });

        expect(result).toMatchObject({
            allowed: false,
            code: "invalid_next_stage",
            expectedNextStage: null,
        });
    });

    test("requires scratchpad before leaving system design", () => {
        const result = validateStageTransition({
            interviewType: "system_design",
            currentStage: "SYSTEM_DESIGN",
            nextStage: "CLOSING",
            stageOrder: ["INTRO", "SYSTEM_DESIGN", "CLOSING"],
            scratchpadOpened: false,
            systemDesignExchangeCount: 0,
        });

        expect(result).toMatchObject({
            allowed: false,
            code: "scratchpad_required",
            expectedNextStage: "CLOSING",
        });
    });

    test("requires minimum exchanges before leaving system design", () => {
        const result = validateStageTransition({
            interviewType: "system_design",
            currentStage: "SYSTEM_DESIGN",
            nextStage: "CLOSING",
            stageOrder: ["INTRO", "SYSTEM_DESIGN", "CLOSING"],
            scratchpadOpened: true,
            systemDesignExchangeCount: 1,
        });

        expect(result).toMatchObject({
            allowed: false,
            code: "minimum_exchanges_required",
            expectedNextStage: "CLOSING",
        });
    });

    test("allows leaving system design when gates are satisfied", () => {
        const result = validateStageTransition({
            interviewType: "system_design",
            currentStage: "SYSTEM_DESIGN",
            nextStage: "CLOSING",
            stageOrder: ["INTRO", "SYSTEM_DESIGN", "CLOSING"],
            scratchpadOpened: true,
            systemDesignExchangeCount: 3,
        });

        expect(result).toMatchObject({
            allowed: true,
            code: "ok",
            expectedNextStage: "CLOSING",
        });
    });

    test("end interview is blocked before final stage", () => {
        const result = validateEndInterview({
            interviewType: "full_interview",
            currentStage: "DSA",
            stageOrder: ["INTRO", "DSA", "FUNDAMENTALS", "CLOSING"],
            scratchpadOpened: false,
        });

        expect(result).toMatchObject({
            allowed: false,
            code: "not_final_stage",
        });
    });

    test("end interview is allowed at final stage", () => {
        const result = validateEndInterview({
            interviewType: "coding",
            currentStage: "DSA",
            stageOrder: ["DSA"],
            scratchpadOpened: false,
        });

        expect(result).toMatchObject({
            allowed: true,
            code: "ok",
        });
    });
});
