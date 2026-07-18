// ============================================
// PII-Safe Error Logging Utilities
// ============================================

const PII_PATTERNS: [RegExp, string][] = [
    // Email addresses
    [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]"],
    // fullName-like fields in JSON
    [/"(fullName|full_name|password|currentPassword|newPassword)"\s*:\s*"[^"]*"/g, '"$1":"[REDACTED]"'],
];

/**
 * Sanitize an error or object for logging by redacting PII fields.
 */
export function sanitizeForLog(input: unknown): unknown {
    if (input === null || input === undefined) return input;

    if (input instanceof Error) {
        const sanitized = new Error(redactString(input.message));
        sanitized.name = input.name;
        if (input.stack) {
            sanitized.stack = redactString(input.stack);
        }
        return sanitized;
    }

    if (typeof input === "string") {
        return redactString(input);
    }

    if (typeof input === "object") {
        try {
            const str = JSON.stringify(input);
            return JSON.parse(redactString(str));
        } catch {
            return "[unserializable object]";
        }
    }

    return input;
}

function redactString(str: string): string {
    let result = str;
    for (const [pattern, replacement] of PII_PATTERNS) {
        result = result.replace(pattern, replacement);
    }
    return result;
}

/**
 * Mask a user ID for logging: user-abcd1234...
 */
export function maskUserId(userId: string): string {
    return `user-${userId.slice(0, 8)}...`;
}
