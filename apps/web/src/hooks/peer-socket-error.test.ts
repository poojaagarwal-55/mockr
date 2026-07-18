import { mapPeerSocketErrorMessage } from "./peer-socket-error";

describe("mapPeerSocketErrorMessage", () => {
    test("maps generic websocket error to actionable startup message", () => {
        const msg = mapPeerSocketErrorMessage("websocket error", "http://localhost:3004");
        expect(msg).toContain("http://localhost:3004");
        expect(msg.toLowerCase()).toContain("start the p2p service");
    });

    test("passes through non-transport errors", () => {
        const msg = mapPeerSocketErrorMessage("Authentication failed", "http://localhost:3004");
        expect(msg).toBe("Authentication failed");
    });
});
