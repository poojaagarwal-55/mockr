export const PROCTORING_SNAPSHOT_MAX_BYTES = 200 * 1024;
export const PROCTORING_SOCKET_NAMESPACE = "/secure-oa";
export const PROCTORING_SESSION_ROOM_PREFIX = "session:";

export function proctoringSessionRoom(sessionId: string) {
    return `${PROCTORING_SESSION_ROOM_PREFIX}${sessionId}`;
}
