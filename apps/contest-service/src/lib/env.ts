import { z } from 'zod';
import dotenv from 'dotenv';
import { isSharedJudge0Endpoint, resolveJudge0Endpoint, resolveJudge0Provider } from './judge0-endpoint.js';

// Load environment variables
dotenv.config();

const optionalEnvString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional()
);

const optionalUrlString = optionalEnvString.refine((value) => {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, 'must be a valid URL');

function parseEnvBoolean(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

const envBoolean = (defaultValue: boolean) => z
  .string()
  .optional()
  .default(defaultValue ? 'true' : 'false')
  .transform(parseEnvBoolean);

const optionalEnvBoolean = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional().transform((value) => (value === undefined ? undefined : parseEnvBoolean(value)))
);

const redisTcpUrlSchema = optionalEnvString.refine((value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'redis:' || parsed.protocol === 'rediss:';
  } catch {
    return false;
  }
}, 'QUEUE_REDIS_URL must be a TCP Redis URL using redis:// or rediss://');

/**
 * Environment variable schema validation
 * Validates all required environment variables at startup
 * Crashes fast if any required variable is missing
 */
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().default('3001').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  METRICS_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

  // Redis (Upstash)
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  // Durable contest submission queue
  QUEUE_BACKEND: z.enum(['auto', 'in-process', 'bullmq']).default('auto'),
  QUEUE_REDIS_URL: redisTcpUrlSchema,
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(10),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(2),
  QUEUE_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(2000),
  // Backpressure: reject new submissions with 503 once this many jobs are
  // waiting (not yet processing). Generous default so normal contests never
  // hit it; only trips during a genuine backlog (e.g. Judge0 outage). 0 = off.
  QUEUE_MAX_WAITING: z.coerce.number().int().nonnegative().default(1000),
  BULLMQ_DRAIN_DELAY_SECONDS: z.coerce.number().int().positive().default(300),
  BULLMQ_STALLED_INTERVAL_MS: z.coerce.number().int().min(1000).default(300_000),
  BULLMQ_LOCK_DURATION_MS: z.coerce.number().int().min(1000).default(180_000),
  BULLMQ_MAX_STALLED_COUNT: z.coerce.number().int().min(0).default(2),

  // Judge0 API
  JUDGE0_PROVIDER: z.enum(['auto', 'rapidapi', 'self-hosted']).default('auto'),
  JUDGE0_API_URL: z.string().url('JUDGE0_API_URL must be a valid URL').default('https://judge0-ce.p.rapidapi.com'),
  JUDGE0_CE_URL: optionalUrlString,
  JUDGE0_EXTRA_CE_URL: optionalUrlString,
  JUDGE0_API_KEY: optionalEnvString,
  JUDGE0_HOST: optionalEnvString,
  JUDGE0_CE_HOST: optionalEnvString,
  JUDGE0_EXTRA_CE_HOST: optionalEnvString,
  JUDGE0_AUTH_HEADER: z.string().optional().default('X-Auth-Token'),
  JUDGE0_ALLOW_SHARED_ENDPOINT: envBoolean(false),
  JUDGE0_EXECUTION_CONCURRENCY: z.coerce.number().int().positive().default(10),
  // Max test cases submitted per Judge0 batch call. RapidAPI caps batches at 20.
  JUDGE0_MAX_BATCH_SIZE: z.coerce.number().int().positive().max(20).default(20),
  JUDGE0_CPU_TIME_LIMIT_SECONDS: z.coerce.number().positive().default(2),
  JUDGE0_WALL_TIME_LIMIT_SECONDS: z.coerce.number().positive().default(4),
  JUDGE0_MEMORY_LIMIT_KB: z.coerce.number().int().positive().default(262144),
  JUDGE0_POLL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(120),
  JUDGE0_POLL_INITIAL_DELAY_MS: z.coerce.number().int().positive().default(1000),
  JUDGE0_POLL_MAX_DELAY_MS: z.coerce.number().int().positive().default(5000),
  JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT: optionalEnvBoolean,
  JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT: optionalEnvBoolean,

  // Supabase (for authentication)
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // Local load-test auth. Disabled in production.
  LOAD_TEST_AUTH_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  LOAD_TEST_JWT_SECRET: optionalEnvString,

  // MongoDB (for question bank)
  MONGODB_URI: z.string().url('MONGODB_URI must be a valid MongoDB connection string'),

  // Admin Configuration
  ADMIN_EMAILS: z.string().optional().default(''),

  // WebSocket
  WS_PORT: z.string().default('3002').transform(Number),

  // CORS — comma-separated list of allowed origins in production
  ALLOWED_ORIGINS: optionalEnvString,
}).superRefine((value, ctx) => {
  const judge0Provider = resolveJudge0Provider(value.JUDGE0_API_URL, value.JUDGE0_PROVIDER);
  const standardJudge0Endpoint = resolveJudge0Endpoint({
    runtime: 'standard',
    apiUrl: value.JUDGE0_API_URL,
    ceUrl: value.JUDGE0_CE_URL,
    extraCeUrl: value.JUDGE0_EXTRA_CE_URL,
    host: value.JUDGE0_HOST,
    ceHost: value.JUDGE0_CE_HOST,
    extraCeHost: value.JUDGE0_EXTRA_CE_HOST,
  });
  const standardJudge0Provider = standardJudge0Endpoint.provider === 'rapidapi'
    ? 'rapidapi'
    : value.JUDGE0_PROVIDER === 'auto'
    ? standardJudge0Endpoint.provider
    : value.JUDGE0_PROVIDER;

  if ((judge0Provider === 'rapidapi' || standardJudge0Provider === 'rapidapi') && !value.JUDGE0_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JUDGE0_API_KEY'],
      message: 'JUDGE0_API_KEY is required when Judge0 provider is RapidAPI',
    });
  }

  if (
    value.NODE_ENV === 'production' &&
    (isSharedJudge0Endpoint(value.JUDGE0_API_URL) || isSharedJudge0Endpoint(standardJudge0Endpoint.apiUrl)) &&
    !value.JUDGE0_ALLOW_SHARED_ENDPOINT
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JUDGE0_API_URL'],
      message: 'Production contests must use a dedicated/self-hosted Judge0 endpoint. Set JUDGE0_ALLOW_SHARED_ENDPOINT=true only for an intentional non-contest fallback.',
    });
  }

  if (value.JUDGE0_POLL_INITIAL_DELAY_MS > value.JUDGE0_POLL_MAX_DELAY_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JUDGE0_POLL_INITIAL_DELAY_MS'],
      message: 'JUDGE0_POLL_INITIAL_DELAY_MS must be <= JUDGE0_POLL_MAX_DELAY_MS',
    });
  }

  if (value.NODE_ENV === 'production' && value.LOAD_TEST_AUTH_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LOAD_TEST_AUTH_ENABLED'],
      message: 'LOAD_TEST_AUTH_ENABLED must never be true in production',
    });
  }

  if (value.LOAD_TEST_AUTH_ENABLED && !value.LOAD_TEST_JWT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LOAD_TEST_JWT_SECRET'],
      message: 'LOAD_TEST_JWT_SECRET is required when LOAD_TEST_AUTH_ENABLED=true',
    });
  }
});

/**
 * Validate and parse environment variables
 * Throws error with detailed message if validation fails
 */
function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((err) => `  - ${err.path.join('.')}: ${err.message}`).join('\n');
      console.error('❌ Environment variable validation failed:\n' + missingVars);
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();

export type Env = z.infer<typeof envSchema>;

/**
 * Parse Redis URL into components
 * Supports both redis:// and rediss:// (TLS) protocols
 */
export function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
    tls: parsed.protocol === 'rediss:',
  };
}

export const redisConfig = parseRedisUrl(env.REDIS_URL);
