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
    credentials: RequestCredentials | undefined
): RequestCredentials {
    if (credentials) return credentials;
    if (typeof window === "undefined") return "same-origin";
    return requestUrl.origin === window.location.origin ? "same-origin" : "include";
}

export async function apiFetch<T = unknown>(
    path: string,
    options: FetchOptions = {}
): Promise<T> {
    const { token, headers: customHeaders, credentials, ...rest } = options;
    const headers: Record<string, string> = {
        ...((customHeaders as Record<string, string>) || {}),
    };

    const isFormDataBody = typeof FormData !== "undefined" && rest.body instanceof FormData;
    if (rest.body && !headers["Content-Type"] && !isFormDataBody) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const cleanBase = getApiBaseUrl();
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const requestUrl = new URL(cleanPath, `${cleanBase}/`);

    let res: Response;
    try {
        res = await fetch(requestUrl.toString(), {
            ...rest,
            headers,
            credentials: resolveCredentials(requestUrl, credentials),
        });
    } catch (err: any) {
        const isAbort =
            rest.signal?.aborted ||
            err?.name === "AbortError" ||
            err?.message === "New search initiated";

        if (isAbort) throw err;
        throw new ApiError(0, INTERNAL_SERVER_ERROR_MESSAGE);
    }

    if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        const safeMessage =
            res.status >= 500
                ? INTERNAL_SERVER_ERROR_MESSAGE
                : errorBody.message || errorBody.error || res.statusText;

        throw new ApiError(res.status, safeMessage, errorBody);
    }

    if (res.status === 204) return {} as T;

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

function getTimezoneHeader(): Record<string, string> {
    if (typeof window === "undefined") return {};
    try {
        return { "x-user-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone };
    } catch {
        return {};
    }
}

/**
 * POST to a Server-Sent-Events endpoint and invoke `onEvent` for each `data: …`
 * frame. Uses fetch + ReadableStream (not EventSource) so the bearer token can be
 * sent as an Authorization header. Mirrors the AI-tutor stream consumer.
 */
export async function apiStream(
    path: string,
    body: unknown,
    onEvent: (event: any) => void,
    token?: string,
    signal?: AbortSignal
): Promise<void> {
    const cleanBase = getApiBaseUrl();
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const requestUrl = new URL(cleanPath, `${cleanBase}/`);

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...getTimezoneHeader(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
        res = await fetch(requestUrl.toString(), {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            credentials: resolveCredentials(requestUrl, undefined),
            signal,
        });
    } catch (err: any) {
        if (signal?.aborted || err?.name === "AbortError") throw err;
        throw new ApiError(0, INTERNAL_SERVER_ERROR_MESSAGE);
    }

    if (!res.ok || !res.body) {
        const errorBody = await res.json().catch(() => ({}));
        const safeMessage =
            res.status >= 500 ? INTERNAL_SERVER_ERROR_MESSAGE : errorBody.message || errorBody.error || res.statusText;
        throw new ApiError(res.status, safeMessage, errorBody);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() || "";
        for (const frame of frames) {
            const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
            if (!line) continue;
            try {
                onEvent(JSON.parse(line.slice(6)));
            } catch {
                /* ignore malformed frame */
            }
        }
    }
}

export const api = {
    get: <T>(path: string, token?: string) =>
        apiFetch<T>(path, { method: "GET", token, headers: getTimezoneHeader() }),
    post: <T>(path: string, body: unknown, token?: string) =>
        apiFetch<T>(path, {
            method: "POST",
            body: JSON.stringify(body),
            token,
            headers: getTimezoneHeader(),
        }),
    put: <T>(path: string, body: unknown, token?: string) =>
        apiFetch<T>(path, {
            method: "PUT",
            body: JSON.stringify(body),
            token,
            headers: getTimezoneHeader(),
        }),
    patch: <T>(path: string, body: unknown, token?: string) =>
        apiFetch<T>(path, {
            method: "PATCH",
            body: JSON.stringify(body),
            token,
            headers: getTimezoneHeader(),
        }),
    upload: <T>(path: string, body: FormData, token?: string) =>
        apiFetch<T>(path, {
            method: "POST",
            body,
            token,
            headers: getTimezoneHeader(),
        }),
    delete: <T>(path: string, token?: string) =>
        apiFetch<T>(path, { method: "DELETE", token, headers: getTimezoneHeader() }),
};
