import { readFileSync } from "node:fs";
import path from "node:path";

describe("PeerSessionFeedbackPage", () => {
    test("uses a dedicated post-session feedback screen", () => {
        const source = readFileSync(path.join(__dirname, "page.tsx"), "utf8");

        expect(source).toContain("How did your interview today go?");
        expect(source).toContain("Did this session happen?");
        expect(source).toContain("Partner feedback");
        expect(source).toContain("Feedback unlocks once the interview ends for both participants.");
        expect(source).toContain("/p2p/sessions/${sessionId}/feedback");
        expect(source).toContain("Submit");
    });
});
