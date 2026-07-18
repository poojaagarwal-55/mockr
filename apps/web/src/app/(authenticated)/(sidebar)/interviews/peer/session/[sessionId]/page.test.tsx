import { readFileSync } from "node:fs";
import path from "node:path";

describe("PeerSessionRoomPage layout", () => {
    test("keeps AI-style three-panel workspace sections", () => {
        const source = readFileSync(path.join(__dirname, "page.tsx"), "utf8");

        expect(source).toContain("xl:flex-row");
        expect(source).toContain("cursor-col-resize");
        expect(source).toContain("Shared Coding IDE");
        expect(source).toContain("Problem");
        expect(source).toContain("Test Results");
        expect(source).toContain("Run Tests");
        expect(source).toContain("Submit");
        expect(source).toContain("Peer Video");
        expect(source).toContain("Your Video");
        expect(source).toContain("Transcript / Chat");
        expect(source).toContain("Switch");
        expect(source).toContain("End Interview");
        expect(source).toContain("toggleMute");
        expect(source).toContain("toggleCamera");
        expect(source).toContain("isCameraOn ? \"videocam\" : \"videocam_off\"");
        expect(source).toContain("questionDetails.statement");
        expect(source).toContain("response.starter_code");
        expect(source).toContain("expected_output");
        expect(source).toContain("stdin ?? testCasesToDisplay");
        expect(source).toContain("router.replace(`/interviews/peer/session/${sessionId}/feedback`)");
        expect(source).not.toContain("Peer feedback");
    });
});