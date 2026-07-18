const {
    splitToolCallsByAvailability,
    buildUnavailableToolNotice,
} = require("./tool-call-sanitizer.js");

describe("tool call sanitizer", () => {
    test("splits allowed and rejected tool calls", () => {
        const result = splitToolCallsByAvailability(
            [
                { id: "1", name: "open_scratchpad", arguments: "{}" },
                { id: "2", name: "end_interview", arguments: "{}" },
                { id: "3", name: "transition_stage", arguments: "{}" },
            ],
            ["open_scratchpad", "transition_stage"]
        );

        expect(result.allowedToolCalls.map((call: any) => call.name)).toEqual([
            "open_scratchpad",
            "transition_stage",
        ]);
        expect(result.rejectedToolCalls.map((call: any) => call.name)).toEqual([
            "end_interview",
        ]);
        expect(result.rejectedToolNames).toEqual(["end_interview"]);
    });

    test("deduplicates rejected tool names", () => {
        const result = splitToolCallsByAvailability(
            [
                { id: "1", name: "end_interview", arguments: "{}" },
                { id: "2", name: "end_interview", arguments: "{}" },
            ],
            ["open_scratchpad"]
        );

        expect(result.rejectedToolCalls).toHaveLength(2);
        expect(result.rejectedToolNames).toEqual(["end_interview"]);
    });

    test("builds unavailable tool notice", () => {
        const notice = buildUnavailableToolNotice(
            ["end_interview"],
            ["open_scratchpad", "transition_stage"]
        );

        expect(notice).toContain("blocked");
        expect(notice).toContain("ONLY");
        expect(notice).toContain("end_interview");
        expect(notice).toContain("open_scratchpad");
        expect(notice).toContain("transition_stage");
    });
});
