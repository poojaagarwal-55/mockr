// ============================================
// User-Facing Error Messages
// ============================================
// Sanitizes internal errors into user-friendly messages
// without exposing sensitive information like API keys,
// rate limits, internal service names, or stack traces.

/**
 * Sanitizes an error message to be user-friendly.
 * Removes sensitive information like API keys, rate limits,
 * internal service names, and technical details.
 */
export function sanitizeErrorMessage(error: any): string {
    const rawMessage = typeof error === 'string' 
        ? error 
        : error?.message || error?.toString?.() || 'An unexpected error occurred';

    // Keep this function idempotent. Several voice paths sanitize once in the
    // pipeline and again at the socket boundary; known-safe copy should not
    // degrade into the generic fallback on the second pass.
    if (/^The service is temporarily unavailable\. Please try again in a few moments\.$/i.test(rawMessage)) {
        return 'The service is temporarily unavailable. Please try again in a few moments.';
    }

    if (/^Unable to connect to the service\. Please try again later\.$/i.test(rawMessage)) {
        return 'Unable to connect to the service. Please try again later.';
    }

    if (/^Connection error\. Please check your internet connection(?: and try again)?\.$/i.test(rawMessage)) {
        return 'Connection error. Please check your internet connection and try again.';
    }

    if (/^Microphone access denied\. Please allow microphone access(?: in your browser settings)?(?: and try again)?\.$/i.test(rawMessage)) {
        return 'Microphone access denied. Please allow microphone access and try again.';
    }

    if (/voice mode is temporarily unavailable|switching to text mode/i.test(rawMessage)) {
        return 'Voice mode is temporarily unavailable. Switching to text mode.';
    }

    if (/audio playback is temporarily unavailable/i.test(rawMessage)) {
        return 'Audio playback is temporarily unavailable. Switching to text mode.';
    }

    if (/speech recognition is temporarily unavailable/i.test(rawMessage)) {
        return 'Speech recognition is temporarily unavailable. Switching to text mode.';
    }

    // Rate limit errors (429)
    if (/429|rate limit|spending limit|credits|quota/i.test(rawMessage)) {
        return 'The service is temporarily unavailable. Please try again in a few moments.';
    }

    // Authentication errors (401, 403)
    if (/401|403|unauthorized|forbidden|authentication|api key/i.test(rawMessage)) {
        return 'Unable to connect to the service. Please try again later.';
    }

    // Network/connection errors
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|connection|timeout/i.test(rawMessage)) {
        return 'Connection error. Please check your internet connection and try again.';
    }

    // Speech recognition errors
    if (/speech recognition|STT|Deepgram|transcription/i.test(rawMessage)) {
        return 'Speech recognition is temporarily unavailable. Switching to text mode.';
    }

    // Text-to-speech errors
    if (/text-to-speech|TTS|audio generation|audio playback/i.test(rawMessage)) {
        return 'Audio playback is temporarily unavailable. Switching to text mode.';
    }

    // Microphone/media permission errors. Do not match the generic word
    // "audio" here; server-side TTS failures also contain that word.
    if (/microphone|media|getUserMedia|permission denied/i.test(rawMessage)) {
        return 'Microphone access denied. Please allow microphone access and try again.';
    }

    // AI/LLM errors
    if (/AI response|LLM|model|generation failed/i.test(rawMessage)) {
        return 'Unable to generate response. Please try again.';
    }

    // Session errors
    if (/session.*not found|session.*expired/i.test(rawMessage)) {
        return 'Your session has expired. Please refresh the page.';
    }

    // Database errors
    if (/database|prisma|mongodb|query failed/i.test(rawMessage)) {
        return 'A temporary error occurred. Please try again.';
    }

    // Prefetch errors
    if (/prefetch|question bank/i.test(rawMessage)) {
        return 'Unable to load interview questions. Please try again.';
    }

    // Generic fallback for any other errors
    // Don't expose the raw message as it might contain sensitive info
    return 'An unexpected error occurred. Please try again.';
}

/**
 * Checks if an error is a connectivity issue (network, timeout, etc.)
 */
export function isConnectivityIssue(error: any): boolean {
    const message = typeof error === 'string' 
        ? error 
        : error?.message || error?.toString?.() || '';
    
    return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|connection|timeout/i.test(message);
}

/**
 * Standard error messages for common scenarios
 */
export const STANDARD_ERROR_MESSAGES = {
    AUTHENTICATION_FAILED: 'Authentication failed. Please sign in again.',
    SESSION_EXPIRED: 'Your session has expired. Please refresh the page.',
    NETWORK_ERROR: 'Connection error. Please check your internet connection.',
    SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again later.',
    MICROPHONE_DENIED: 'Microphone access denied. Please allow microphone access in your browser settings.',
    VOICE_UNAVAILABLE: 'Voice mode is temporarily unavailable. Switching to text mode.',
    INTERNAL_SERVER_ERROR: 'An unexpected error occurred. Please try again.',
} as const;

// Re-export for backward compatibility
export const AUTHENTICATION_FAILED_MESSAGE = STANDARD_ERROR_MESSAGES.AUTHENTICATION_FAILED;
export const INTERNAL_SERVER_ERROR_MESSAGE = STANDARD_ERROR_MESSAGES.INTERNAL_SERVER_ERROR;
export const INTERNAL_SERVER_ERROR_NAME = 'InternalServerError';
