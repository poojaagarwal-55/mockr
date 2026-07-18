/**
 * Fetches a Google Cloud identity token for calling authenticated Cloud Run services.
 * Tokens are cached for 55 minutes (they expire after 60).
 * Falls back gracefully when running outside GCP (local dev).
 */

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

export async function getIdentityToken(audience: string): Promise<string | null> {
    const cached = tokenCache.get(audience);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.token;
    }

    try {
        const metadataUrl =
            `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity` +
            `?audience=${encodeURIComponent(audience)}`;

        const res = await fetch(metadataUrl, {
            headers: { "Metadata-Flavor": "Google" },
            signal: AbortSignal.timeout(2000),
        });

        if (!res.ok) return null;

        const token = (await res.text()).trim();
        tokenCache.set(audience, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
        return token;
    } catch {
        // Not running on GCP (local dev) or metadata server unreachable
        return null;
    }
}

/** Returns auth headers for a Cloud Run request, empty object outside GCP. */
export async function cloudRunAuthHeaders(serviceUrl: string): Promise<Record<string, string>> {
    // Use the base URL (no path) as the audience
    const audience = new URL(serviceUrl).origin;
    const token = await getIdentityToken(audience);
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}
