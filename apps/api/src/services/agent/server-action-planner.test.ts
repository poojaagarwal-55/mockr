const { buildServerActionPlan } = require("./server-action-planner.js");

describe("server action planner", () => {
    test("routes non-control tools to passthrough", () => {
        const plan = buildServerActionPlan([
            { id: "1", name: "fetch_question", arguments: "{\"category\":\"DSA\"}" },
            { id: "2", name: "open_ide", arguments: "{\"questionId\":\"q1\",\"language\":\"cpp\"}" },
        ]);

        expect(plan.passthroughToolCalls).toHaveLength(2);
        expect(plan.controlSuggestions).toHaveLength(0);
        expect(plan.deferredToolResponses).toHaveLength(0);
    });

    test("captures valid transition and end suggestions", () => {
        const plan = buildServerActionPlan([
            { id: "1", name: "transition_stage", arguments: "{\"nextStage\":\"FUNDAMENTALS\",\"reason\":\"done\"}" },
            { id: "2", name: "end_interview", arguments: "{\"summary\":\"Candidate done\"}" },
        ]);

        expect(plan.passthroughToolCalls).toHaveLength(0);
        expect(plan.controlSuggestions).toEqual([
            {
                kind: "transition_stage",
                toolCallId: "1",
                args: { nextStage: "FUNDAMENTALS", reason: "done" },
            },
            {
                kind: "end_interview",
                toolCallId: "2",
                args: { summary: "Candidate done" },
            },
        ]);
        expect(plan.deferredToolResponses).toHaveLength(0);
    });

    test("returns invalid suggestion on malformed json", () => {
        const plan = buildServerActionPlan([
            { id: "bad", name: "transition_stage", arguments: "{not-json}" },
        ]);

        expect(plan.controlSuggestions).toEqual([
            {
                kind: "invalid",
                toolCallId: "bad",
                message: "Invalid JSON arguments for tool transition_stage.",
            },
        ]);
    });

    test("returns invalid suggestion on schema validation failure", () => {
        const plan = buildServerActionPlan([
            { id: "bad", name: "transition_stage", arguments: "{\"nextStage\":\"BAD\",\"reason\":\"x\"}" },
        ]);

        expect(plan.controlSuggestions).toHaveLength(1);
        expect(plan.controlSuggestions[0].kind).toBe("invalid");
    });

    test("keeps only the final panel action and reorders execution safely", () => {
        const plan = buildServerActionPlan([
            { id: "a", name: "open_sql_editor", arguments: "{}" },
            { id: "b", name: "fetch_question", arguments: "{\"category\":\"SQL\"}" },
            { id: "c", name: "open_ide", arguments: "{\"questionId\":\"q1\",\"language\":\"cpp\"}" },
            { id: "d", name: "give_hint", arguments: "{\"questionId\":\"q1\",\"hintNumber\":1}" },
            { id: "e", name: "close_panel", arguments: "{\"summary\":\"done\"}" },
        ]);

        expect(plan.passthroughToolCalls.map((call: any) => call.id)).toEqual(["b", "d", "e"]);
        expect(plan.deferredToolResponses).toEqual([
            {
                toolCallId: "a",
                content: "Suppressed by server sequencing policy: only the final panel action is executed per turn.",
            },
            {
                toolCallId: "c",
                content: "Suppressed by server sequencing policy: only the final panel action is executed per turn.",
            },
        ]);
    });

    test("keeps only latest control actions per kind", () => {
        const plan = buildServerActionPlan([
            { id: "t1", name: "transition_stage", arguments: "{\"nextStage\":\"DSA\",\"reason\":\"r1\"}" },
            { id: "e1", name: "end_interview", arguments: "{\"summary\":\"s1\"}" },
            { id: "t2", name: "transition_stage", arguments: "{\"nextStage\":\"FUNDAMENTALS\",\"reason\":\"r2\"}" },
            { id: "e2", name: "end_interview", arguments: "{\"summary\":\"s2\"}" },
        ]);

        expect(plan.controlSuggestions).toEqual([
            {
                kind: "transition_stage",
                toolCallId: "t2",
                args: { nextStage: "FUNDAMENTALS", reason: "r2" },
            },
            {
                kind: "end_interview",
                toolCallId: "e2",
                args: { summary: "s2" },
            },
        ]);

        expect(plan.deferredToolResponses).toEqual([
            {
                toolCallId: "t1",
                content: "Suppressed by server control policy: only the latest transition_stage call is executed per turn.",
            },
            {
                toolCallId: "e1",
                content: "Suppressed by server control policy: only the latest end_interview call is executed per turn.",
            },
        ]);
    });
});
