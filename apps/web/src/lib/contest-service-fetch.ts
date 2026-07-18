import { createSupabaseBrowserClient } from "@/lib/supabase";

const DEFAULT_CONTEST_API = "http://localhost:3002";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getContestApiBaseUrl() {
  const configuredBase = (process.env.NEXT_PUBLIC_CONTEST_API_URL || DEFAULT_CONTEST_API).trim();
  if (typeof window === "undefined") return trimTrailingSlash(configuredBase);

  try {
    const url = new URL(configuredBase);
    if (LOOPBACK_HOSTS.has(window.location.hostname) && LOOPBACK_HOSTS.has(url.hostname)) {
      url.hostname = window.location.hostname;
    }
    return trimTrailingSlash(url.toString());
  } catch {
    return trimTrailingSlash(configuredBase);
  }
}

function buildContestServiceUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${getContestApiBaseUrl()}${cleanPath}`;
}

function mergeHeaders(headers: HeadersInit | undefined, token: string) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("Authorization", `Bearer ${token}`);
  return nextHeaders;
}

export async function getContestServiceToken() {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;

  const refreshed = await supabase.auth.refreshSession();
  return refreshed.data.session?.access_token || null;
}

export async function contestServiceFetch(path: string, init: RequestInit = {}) {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || (await supabase.auth.refreshSession()).data.session?.access_token;
  if (!token) return null;

  const requestUrl = buildContestServiceUrl(path);
  const requestInit = {
    ...init,
    cache: init.cache ?? "no-store",
    headers: mergeHeaders(init.headers, token),
  };

  const response = await fetch(requestUrl, requestInit);
  if (response.status !== 401) return response;

  const refreshed = await supabase.auth.refreshSession();
  const refreshedToken = refreshed.data.session?.access_token;
  if (!refreshedToken || refreshedToken === token) return response;

  return fetch(requestUrl, {
    ...init,
    cache: init.cache ?? "no-store",
    headers: mergeHeaders(init.headers, refreshedToken),
  });
}
