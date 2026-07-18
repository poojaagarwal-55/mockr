export function normalizeJwt(token: string): string {
    return token.trim().replace(/^Bearer\s+/i, "").trim();
}
