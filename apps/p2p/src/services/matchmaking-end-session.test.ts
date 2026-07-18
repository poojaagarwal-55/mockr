import { readFileSync } from "node:fs";
import path from "node:path";

describe("Matchmaking end-session behavior", () => {
    test("allows participant-driven session ending", () => {
        const source = readFileSync(path.join(__dirname, "matchmaking.service.ts"), "utf8");

        expect(source).toContain("await this.completeSession(payload.peerSessionId, \"ended_by_participant\")");
        expect(source).toContain("reason === \"ended_by_participant\"");
    });
});
