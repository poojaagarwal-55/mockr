const DEFAULT_API_BASE = "http://localhost:3001";
const INTERNAL_SERVER_ERROR_MESSAGE =
    "Internal Server Error. Please check your connection and try again.";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

type FetchOptions = RequestInit & {
    token?: string;
};

function trimTrailingSlash(value: string): string {
    return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getPreferredLoopbackHost(): string | null {
    if (typeof window === "undefined") return null;
    return LOOPBACK_HOSTS.has(window.location.hostname)
        ? window.location.hostname
        : null;
}

export function getApiBaseUrl(): string {
    const configuredBase = process.env.NEXT_PUBLIC_API_URL?.trim();
    const preferredLoopbackHost = getPreferredLoopbackHost();

    if (configuredBase) {
        try {
            const url = new URL(configuredBase);
            if (
                preferredLoopbackHost &&
                LOOPBACK_HOSTS.has(url.hostname) &&
                url.hostname !== preferredLoopbackHost
            ) {
                url.hostname = preferredLoopbackHost;
            }
            return trimTrailingSlash(url.toString());
        } catch {
            return trimTrailingSlash(configuredBase);
        }
    }

    if (preferredLoopbackHost && typeof window !== "undefined") {
        return `${window.location.protocol}//${preferredLoopbackHost}:3001`;
    }

    return DEFAULT_API_BASE;
}

function resolveCredentials(
    requestUrl: URL,
    token: string | undefined,
    credentials: RequestCredentials | undefined
): RequestCredentials {
    if (credentials) return credentials;
    if (typeof window === "undefined") return "same-origin";
    // Always use 'include' for cross-origin requests to allow cookies (like deviceToken)
    // Even when using Bearer token auth, we need cookies for device tracking
    return requestUrl.origin === window.location.origin ? "same-origin" : "include";
}

/**
 * Fetch wrapper that auto-attaches the Supabase access token
 * as an Authorization header for API requests.
 */
export async function apiFetch<T = unknown>(
    path: string,
    options: FetchOptions = {}
): Promise<T> {
    const { token, headers: customHeaders, credentials, ...rest } = options;

    const headers: Record<string, string> = {
        ...((customHeaders as Record<string, string>) || {}),
    };

    const isFormData = typeof FormData !== "undefined" && rest.body instanceof FormData;
    if (rest.body && !headers["Content-Type"] && !isFormData) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const cleanBase = getApiBaseUrl();
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const requestUrl = new URL(cleanPath, `${cleanBase}/`);

    let res: Response;
    try {
        res = await fetch(requestUrl.toString(), {
            ...rest,
            headers,
            credentials: resolveCredentials(requestUrl, token, credentials),
        });
    } catch (err: any) {
        const isAbort =
            rest.signal?.aborted ||
            err?.name === "AbortError" ||
            err === "New search initiated" ||
            err?.message === "New search initiated";

        // Don't log abort errors (happens when user types quickly in search)
        if (isAbort) {
            throw err;
        }
        console.error(
            `[apiFetch] ${rest.method || "GET"} ${requestUrl.toString()} failed:`,
            err
        );
        throw new ApiError(
            0,
            INTERNAL_SERVER_ERROR_MESSAGE
        );
    }

    if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        // Backend sends 'error' field, not 'message'
        const safeMessage = res.status >= 500
            ? INTERNAL_SERVER_ERROR_MESSAGE
            : (errorBody.error || errorBody.message || res.statusText);

        throw new ApiError(
            res.status,
            safeMessage,
            errorBody
        );
    }

    // Handle 204 No Content
    if (res.status === 204) {
        return {} as T;
    }

    return res.json() as Promise<T>;
}

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public body?: unknown
    ) {
        super(message);
        this.name = "ApiError";
    }
}

// ── Convenience Methods ──────────────────────────────────────

function getTimezoneHeader(): Record<string, string> {
    if (typeof window === "undefined") return {};
    try {
        return { "x-user-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone };
    } catch {
        return {};
    }
}

export const api = {
    get: <T>(path: string, token?: string) =>
        apiFetch<T>(path, { method: "GET", token, headers: getTimezoneHeader() }),

    post: <T>(path: string, body: unknown, token?: string) =>
        apiFetch<T>(path, { method: "POST", body: JSON.stringify(body), token, headers: getTimezoneHeader() }),

    put: <T>(path: string, body: unknown, token?: string) =>
        apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body), token, headers: getTimezoneHeader() }),

    patch: <T>(path: string, body: unknown, token?: string) =>
        apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body), token, headers: getTimezoneHeader() }),

    delete: <T>(path: string, token?: string) =>
        apiFetch<T>(path, { method: "DELETE", token, headers: getTimezoneHeader() }),
};
