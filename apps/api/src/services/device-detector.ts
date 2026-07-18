import { UAParser } from "ua-parser-js";
import axios from "axios";

// Simple in-process cache: IP → { result, expiresAt }
const ipLocationCache = new Map<string, { result: LocationInfo; expiresAt: number }>();
const IP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface DeviceInfo {
  deviceType: string; // "desktop", "mobile", "tablet"
  browser: string; // "Chrome", "Firefox", etc.
  os: string; // "Windows", "macOS", "iOS", etc.
  userAgent: string;
}

export interface LocationInfo {
  city: string | null;
  country: string | null;
  location: string | null; // "San Francisco, CA, US"
}

/**
 * Parse user-agent string to extract device information
 */
export function parseUserAgent(userAgent: string): DeviceInfo {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  // Determine device type
  let deviceType = "desktop";
  if (result.device.type === "mobile") deviceType = "mobile";
  else if (result.device.type === "tablet") deviceType = "tablet";

  // Get browser name
  const browser = result.browser.name || "Unknown Browser";

  // Get OS name
  const os = result.os.name || "Unknown OS";

  return {
    deviceType,
    browser,
    os,
    userAgent,
  };
}

/**
 * Get location information from IP address using ipapi.co (free tier: 1000/day).
 * Results are cached for 24 hours per IP to avoid hitting the rate limit.
 */
export async function getLocationFromIP(ipAddress: string): Promise<LocationInfo> {
  // Skip for localhost/private IPs
  if (
    !ipAddress ||
    ipAddress === "::1" ||
    ipAddress === "127.0.0.1" ||
    ipAddress.startsWith("192.168.") ||
    ipAddress.startsWith("10.") ||
    ipAddress.startsWith("172.")
  ) {
    return {
      city: null,
      country: null,
      location: "Local Network",
    };
  }

  // Return cached result if still fresh
  const cached = ipLocationCache.get(ipAddress);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  try {
    const response = await axios.get(`https://ipapi.co/${ipAddress}/json/`, {
      timeout: 3000,
    });

    const data = response.data;

    // ipapi.co returns a JSON error object (not HTTP error) on rate limit
    if (data.error) {
      console.warn(`[DeviceDetector] ipapi.co error for ${ipAddress}: ${data.reason}`);
      return { city: null, country: null, location: null };
    }

    const parts: string[] = [];
    if (data.city) parts.push(data.city);
    if (data.region) parts.push(data.region);
    if (data.country_name) parts.push(data.country_name);

    const result: LocationInfo = {
      city: data.city || null,
      country: data.country_name || null,
      location: parts.length > 0 ? parts.join(", ") : null,
    };

    ipLocationCache.set(ipAddress, { result, expiresAt: Date.now() + IP_CACHE_TTL_MS });
    return result;
  } catch (error: any) {
    // On 429 rate limit, cache a null result for 1 hour to stop hammering the API
    if (error?.response?.status === 429) {
      console.warn(`[DeviceDetector] ipapi.co rate limited (429) — suppressing for 1h`);
      const empty: LocationInfo = { city: null, country: null, location: null };
      ipLocationCache.set(ipAddress, { result: empty, expiresAt: Date.now() + 60 * 60 * 1000 });
      return empty;
    }
    console.error("[DeviceDetector] Failed to get location from IP:", error);
    return {
      city: null,
      country: null,
      location: null,
    };
  }
}

/**
 * Get client IP address from request
 * Handles proxies and load balancers
 */
export function getClientIP(request: any): string {
  // Check common proxy headers
  const forwarded = request.headers["x-forwarded-for"];
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(",")[0].trim();
  }

  const realIP = request.headers["x-real-ip"];
  if (realIP) {
    return realIP;
  }

  // Fallback to socket IP
  return request.socket?.remoteAddress || request.ip || "unknown";
}
