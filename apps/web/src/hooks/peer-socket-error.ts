export function mapPeerSocketErrorMessage(raw: string | undefined, baseUrl: string): string {
    const text = (raw || "").toLowerCase();

    if (
        text.includes("websocket error") ||
        text.includes("xhr poll error") ||
        text.includes("transport")
    ) {
        return `Peer realtime service is unreachable at ${baseUrl}. Start the p2p service and refresh.`;
    }

    if (!raw || raw.trim().length === 0) {
        return `Peer realtime service is unreachable at ${baseUrl}. Start the p2p service and refresh.`;
    }

    return raw;
}
