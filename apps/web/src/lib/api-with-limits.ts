/**
 * API utility that automatically detects and handles feature limit errors
 */

import { shouldShowUpgradeForError } from "@/components/upgrade-modal";

export class FeatureLimitError extends Error {
    code: string;
    plan?: string;
    detail?: Record<string, unknown>;
    originalError: unknown;

    constructor(message: string, code: string, originalError: unknown, plan?: string, detail?: Record<string, unknown>) {
        super(message);
        this.name = "FeatureLimitError";
        this.code = code;
        this.plan = plan;
        this.detail = detail;
        this.originalError = originalError;
    }
}

/**
 * Fetch wrapper that automatically converts feature limit errors to FeatureLimitError
 * Usage: const response = await fetchWithLimits(url, options);
 */
export async function fetchWithLimits(url: string, options?: RequestInit): Promise<Response> {
    const response = await fetch(url, options);
    
    if (!response.ok) {
        try {
            const errorData = await response.json();
            
            // Check if this is a feature limit error
            if (shouldShowUpgradeForError(errorData)) {
                throw new FeatureLimitError(
                    errorData.message || "Feature limit reached",
                    errorData.code || errorData.error || "FEATURE_LIMIT",
                    errorData,
                    errorData.plan,
                    errorData.detail
                );
            }
            
            // Not a feature limit error, throw regular error
            throw new Error(errorData.message || `Request failed with status ${response.status}`);
        } catch (err) {
            // If JSON parsing fails or error is already thrown, re-throw
            if (err instanceof FeatureLimitError || err instanceof Error) {
                throw err;
            }
            throw new Error(`Request failed with status ${response.status}`);
        }
    }
    
    return response;
}

/**
 * Check if an error is a feature limit error
 */
export function isFeatureLimitError(error: unknown): error is FeatureLimitError {
    return error instanceof FeatureLimitError || shouldShowUpgradeForError(error);
}
