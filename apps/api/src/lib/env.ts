// ============================================
// Startup Environment Variable Validation
// ============================================
// Validates on first access (not at import time) so that
// dotenv.config() has a chance to run before validation.

// Core vars the server cannot function without
const REQUIRED_ENV_VARS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "XAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "ENCRYPTION_KEY",
] as const;

// Feature-gated vars — warn at startup, fail at request time
const OPTIONAL_ENV_VARS = [
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
] as const;

let _validated = false;

export function validateEnv(): void {
    if (_validated) return;
    _validated = true;

    const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        console.error(
            `\n❌ Missing required environment variables:\n${missing.map((k) => `   - ${k}`).join("\n")}\n\nAdd them to your .env file and restart.\n`
        );
        process.exit(1);
    }

    // Gemini-backed features (tutor, resume analysis, report generation, AI
    // screening config) need EITHER a Gemini key OR a Groq key to fall back to.
    // Blank GOOGLE_GENERATIVE_AI_API_KEY to route those features through Groq.
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GROQ_API_KEY) {
        console.error(
            "\n❌ Neither GOOGLE_GENERATIVE_AI_API_KEY nor GROQ_API_KEY is set.\nSet one of them so Gemini-backed features have a provider, then restart.\n"
        );
        process.exit(1);
    }
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GROQ_API_KEY) {
        console.warn(
            "\n⚠️  GOOGLE_GENERATIVE_AI_API_KEY not set — Gemini-backed features will use the Groq fallback.\n"
        );
    }

    const missingOptional = OPTIONAL_ENV_VARS.filter((key) => !process.env[key]);
    if (missingOptional.length > 0) {
        console.warn(
            `\n⚠️  Missing optional environment variables (features will be disabled):\n${missingOptional.map((k) => `   - ${k}`).join("\n")}\n`
        );
    }
}

/**
 * Require a Razorpay env var at request time.
 * Throws a descriptive error if the var is not set.
 */
export function requireRazorpayEnv(key: "RAZORPAY_KEY_ID" | "RAZORPAY_KEY_SECRET" | "RAZORPAY_WEBHOOK_SECRET"): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`${key} is not configured. Payment features are unavailable.`);
    }
    return value;
}

// Lazy-initialized frozen config — reads process.env on first access
let _env: Readonly<{
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    XAI_API_KEY: string;
    GOOGLE_GENERATIVE_AI_API_KEY: string;
    DEEPGRAM_API_KEY: string;
    ENCRYPTION_KEY: string;
}> | null = null;

export function getEnv() {
    if (!_env) {
        validateEnv();
        _env = Object.freeze({
            SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            XAI_API_KEY: process.env.XAI_API_KEY!,
            GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
            DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY!,
            ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
        });
    }
    return _env;
}

// Convenience alias — kept so existing `env.X` call sites still work
export const env = new Proxy({} as ReturnType<typeof getEnv>, {
    get(_target, prop: string) {
        return getEnv()[prop as keyof ReturnType<typeof getEnv>];
    },
});
