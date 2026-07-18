import {
    createInitialResumeAgendaState,
    getActiveResumeAgendaItem,
    getAllowedResumeAgendaIntents,
    getResumeAgendaItemTurnLimit,
    nextUnaskedResumeAgendaIntent,
    updateResumeAgendaAfterProbe,
} from "./resume-agenda-state.js";
import type { ResumeAgendaItem } from "./interview-runtime-types.js";

function projectItem(overrides: Partial<ResumeAgendaItem> = {}): ResumeAgendaItem {
    return {
        id: "project:demo",
        type: "project",
        label: "Demo",
        summary: "Demo project",
        priority: 10,
        mode: "deep",
        status: "active",
        askedIntents: [],
        turnCount: 0,
        weakCount: 0,
        componentCounts: {},
        ...overrides,
    };
}

describe("resume agenda intent helpers", () => {
    it("returns the escalation ladder for a deep project", () => {
        expect(getAllowedResumeAgendaIntents(projectItem())).toEqual([
            "overview", "motivation", "ownership", "implementation", "tradeoff", "failure", "impact", "skill_usage",
        ]);
    });

    it("returns the short ladder for a rapid project", () => {
        expect(getAllowedResumeAgendaIntents(projectItem({ mode: "rapid" }))).toEqual(["ownership", "impact"]);
    });

    it("picks the first intent that has not been asked yet", () => {
        expect(nextUnaskedResumeAgendaIntent(projectItem({ askedIntents: [] }))).toBe("overview");
        expect(nextUnaskedResumeAgendaIntent(projectItem({ askedIntents: ["overview"] }))).toBe("motivation");
        expect(nextUnaskedResumeAgendaIntent(projectItem({ askedIntents: ["overview", "motivation"] }))).toBe("ownership");
    });

    it("falls back to the deepest intent once every allowed intent has been asked", () => {
        const allAsked = getAllowedResumeAgendaIntents(projectItem());
        expect(nextUnaskedResumeAgendaIntent(projectItem({ askedIntents: allAsked }))).toBe("skill_usage");
    });
});

describe("server-driven resume probe fallback (anti-repeat guarantee)", () => {
    // Mirrors what ensureResumeProbeRecordedAfterTurn does each turn the model
    // forgets record_resume_probe: advance the agenda with the next unasked intent.
    function applyServerFallbackTurn(state: ReturnType<typeof createInitialResumeAgendaState>) {
        const active = getActiveResumeAgendaItem(state)!;
        return updateResumeAgendaAfterProbe(state, {
            agendaItemId: active.id,
            intent: nextUnaskedResumeAgendaIntent(active),
            answerQuality: "partial",
        })!;
    }

    it("advances turnCount and asked intents every turn instead of freezing", () => {
        let state = createInitialResumeAgendaState({ projects: [{ name: "Alpha" }, { name: "Beta" }] });
        const firstId = getActiveResumeAgendaItem(state)!.id;

        state = applyServerFallbackTurn(state);
        const afterOne = state.items.find((i) => i.id === firstId)!;
        expect(afterOne.turnCount).toBe(1);
        expect(afterOne.askedIntents).toContain("overview");

        state = applyServerFallbackTurn(state);
        const afterTwo = state.items.find((i) => i.id === firstId)!;
        // turnCount keeps climbing and a *new* intent is recorded — the per-turn
        // prompt is therefore different, so the model is nudged off the repeat.
        expect(afterTwo.turnCount).toBe(2);
        expect(afterTwo.askedIntents).toEqual(expect.arrayContaining(["overview", "motivation"]));
    });

    it("closes the active item within its hard cap and moves to the next one", () => {
        let state = createInitialResumeAgendaState({ projects: [{ name: "Alpha" }, { name: "Beta" }] });
        const firstItem = getActiveResumeAgendaItem(state)!;
        const firstId = firstItem.id;
        const cap = getResumeAgendaItemTurnLimit(firstItem);

        // Without ever calling record_resume_probe "for real", the fallback alone
        // must bound repetition: the item is closed by the time the cap is hit.
        for (let turn = 0; turn < cap + 2; turn++) {
            const active = getActiveResumeAgendaItem(state);
            if (!active || active.id !== firstId) break;
            state = applyServerFallbackTurn(state);
        }

        expect(state.closedItemIds).toContain(firstId);
        const nextActive = getActiveResumeAgendaItem(state);
        // Either advanced to a different item or fully exhausted the agenda — never
        // stuck re-asking the first item.
        expect(nextActive?.id).not.toBe(firstId);
    });

    it("closes faster on repeated weak answers than the hard cap", () => {
        let state = createInitialResumeAgendaState({ projects: [{ name: "Alpha" }] });
        const firstItem = getActiveResumeAgendaItem(state)!;
        const firstId = firstItem.id;

        // A deep project's hard cap is 7, but the weak-answer limit is lower, so
        // three weak turns should already close it.
        for (let turn = 0; turn < 3; turn++) {
            const active = getActiveResumeAgendaItem(state);
            if (!active || active.id !== firstId) break;
            state = updateResumeAgendaAfterProbe(state, {
                agendaItemId: firstId,
                intent: nextUnaskedResumeAgendaIntent(active),
                answerQuality: "weak",
            })!;
        }

        expect(state.closedItemIds).toContain(firstId);
    });
});
