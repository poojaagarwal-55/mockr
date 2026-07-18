export type Judge0Provider = 'auto' | 'rapidapi' | 'self-hosted';
export type Judge0Runtime = 'standard' | 'extra';

const DEFAULT_STANDARD_CE_URL = 'https://judge0-ce.p.rapidapi.com';
const DEFAULT_EXTRA_CE_URL = 'https://judge0-extra-ce.p.rapidapi.com';

const SHARED_JUDGE0_HOSTS = new Set([
  'ce.judge0.com',
  'api.judge0.com',
  'judge0.com',
]);

function getHost(apiUrl: string): string {
  return new URL(apiUrl).hostname.toLowerCase();
}

function isExtraCeEndpoint(apiUrl: string): boolean {
  return getHost(apiUrl).includes('extra');
}

export function isSharedJudge0Endpoint(apiUrl: string): boolean {
  const host = getHost(apiUrl);
  return host.includes('rapidapi.com') || SHARED_JUDGE0_HOSTS.has(host);
}

export function resolveJudge0Provider(apiUrl: string, provider: Judge0Provider = 'auto'): Exclude<Judge0Provider, 'auto'> {
  if (provider === 'rapidapi' || provider === 'self-hosted') {
    return provider;
  }

  return getHost(apiUrl).includes('rapidapi.com') ? 'rapidapi' : 'self-hosted';
}

export interface Judge0EndpointOptions {
  runtime?: Judge0Runtime;
  apiUrl: string;
  ceUrl?: string;
  extraCeUrl?: string;
  host?: string;
  ceHost?: string;
  extraCeHost?: string;
}

export interface Judge0Endpoint {
  apiUrl: string;
  host: string;
  provider: Exclude<Judge0Provider, 'auto'>;
}

/**
 * Resolve the Judge0 endpoint for the requested runtime.
 *
 * Legacy production may have JUDGE0_API_URL pointed at Extra CE for data
 * science tasks. Standard contest DSA language IDs (C++ 54, Python 71, etc.)
 * must still run on standard CE, matching the main API practice IDE behavior.
 */
export function resolveJudge0Endpoint(options: Judge0EndpointOptions): Judge0Endpoint {
  const runtime = options.runtime ?? 'standard';
  const legacyUrl = options.apiUrl;
  const legacyIsExtra = isExtraCeEndpoint(legacyUrl);

  const apiUrl = runtime === 'extra'
    ? options.extraCeUrl || (legacyIsExtra ? legacyUrl : '') || DEFAULT_EXTRA_CE_URL
    : options.ceUrl || (!legacyIsExtra ? legacyUrl : '') || DEFAULT_STANDARD_CE_URL;

  const host = runtime === 'extra'
    ? options.extraCeHost || (legacyIsExtra ? options.host : undefined) || new URL(apiUrl).host
    : options.ceHost || (!legacyIsExtra ? options.host : undefined) || new URL(apiUrl).host;

  return {
    apiUrl,
    host,
    provider: resolveJudge0Provider(apiUrl, 'auto'),
  };
}

export interface Judge0HeaderOptions {
  apiUrl: string;
  apiKey?: string;
  provider?: Judge0Provider;
  rapidApiHost?: string;
  authHeader?: string;
}

export function buildJudge0Headers(options: Judge0HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const provider = resolveJudge0Provider(options.apiUrl, options.provider);

  if (provider === 'rapidapi') {
    if (options.apiKey) {
      headers['X-RapidAPI-Key'] = options.apiKey;
    }
    headers['X-RapidAPI-Host'] = options.rapidApiHost || new URL(options.apiUrl).host;
    return headers;
  }

  if (options.apiKey) {
    headers[options.authHeader || 'X-Auth-Token'] = options.apiKey;
  }

  return headers;
}
