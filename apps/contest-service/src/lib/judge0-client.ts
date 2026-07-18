import axios, { AxiosInstance, AxiosError } from 'axios';
import { env } from './env.js';
import { judge0CircuitBreaker } from './circuit-breaker.js';
import { recordJudge0Call, recordJudge0Failure } from './metrics.js';
import {
  Judge0InfrastructureError,
  Judge0InfrastructureOperation,
  isCircuitBreakerOpenError,
  isJudge0InfrastructureError,
  isRetryableJudge0HttpStatus,
} from './judge0-errors.js';
import { buildJudge0Headers, resolveJudge0Endpoint } from './judge0-endpoint.js';

/**
 * Judge0 Client
 * Handles code execution via Judge0 RapidAPI or a dedicated/self-hosted Judge0.
 * Includes circuit breaker and retry logic with exponential backoff
 */

// Language ID mapping for Judge0
export const LANGUAGE_IDS = {
  python3: 71,
  javascript: 63,
  typescript: 74,
  java: 62,
  cpp: 54,
  c: 50,
  csharp: 51,
  go: 60,
  rust: 73,
  ruby: 72,
} as const;

export type SupportedLanguage = keyof typeof LANGUAGE_IDS;

// Judge0 submission status IDs
export enum Judge0Status {
  IN_QUEUE = 1,
  PROCESSING = 2,
  ACCEPTED = 3,
  WRONG_ANSWER = 4,
  TIME_LIMIT_EXCEEDED = 5,
  COMPILATION_ERROR = 6,
  RUNTIME_ERROR_SIGSEGV = 7,
  RUNTIME_ERROR_SIGXFSZ = 8,
  RUNTIME_ERROR_SIGFPE = 9,
  RUNTIME_ERROR_SIGABRT = 10,
  RUNTIME_ERROR_NZEC = 11,
  RUNTIME_ERROR_OTHER = 12,
  INTERNAL_ERROR = 13,
  EXEC_FORMAT_ERROR = 14,
}

export interface Judge0SubmissionRequest {
  source_code: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: number;
  wall_time_limit?: number;
  memory_limit?: number;
  enable_per_process_and_thread_time_limit?: boolean;
  enable_per_process_and_thread_memory_limit?: boolean;
}

export interface Judge0SubmissionResponse {
  token: string;
}

export interface Judge0ResultResponse {
  status: {
    id: number;
    description: string;
  };
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
}

export interface Judge0ExecutionLimits {
  cpuTimeLimitSeconds?: number | null;
  memoryLimitMb?: number | null;
}

function clampCpuTimeLimit(value: number): number {
  return Math.min(5, Math.max(0.1, value));
}

function normalizeMemoryLimitKb(valueMb: number): number {
  return clampMemoryLimitKb(valueMb * 1024);
}

function clampMemoryLimitKb(valueKb: number): number {
  return Math.max(16 * 1024, Math.min(256 * 1024, Math.round(valueKb)));
}

function getAxiosStatus(error: unknown): number | null {
  return (error as AxiosError | undefined)?.response?.status ?? null;
}

function toJudge0InfrastructureError(
  operation: Judge0InfrastructureOperation,
  error: unknown,
  message: string,
  statusCode: number | null = getAxiosStatus(error)
): Judge0InfrastructureError {
  return new Judge0InfrastructureError(message, {
    operation,
    statusCode: statusCode ?? undefined,
    retryable: isRetryableJudge0HttpStatus(statusCode),
    cause: error,
  });
}

/**
 * Judge0 API Client
 */
class Judge0Client {
  private client: AxiosInstance;

  constructor() {
    const endpoint = resolveJudge0Endpoint({
      runtime: 'standard',
      apiUrl: env.JUDGE0_API_URL,
      ceUrl: env.JUDGE0_CE_URL,
      extraCeUrl: env.JUDGE0_EXTRA_CE_URL,
      host: env.JUDGE0_HOST,
      ceHost: env.JUDGE0_CE_HOST,
      extraCeHost: env.JUDGE0_EXTRA_CE_HOST,
    });
    const provider = endpoint.provider === 'rapidapi'
      ? 'rapidapi'
      : env.JUDGE0_PROVIDER === 'auto'
        ? endpoint.provider
        : env.JUDGE0_PROVIDER;

    this.client = axios.create({
      baseURL: endpoint.apiUrl,
      headers: buildJudge0Headers({
        apiUrl: endpoint.apiUrl,
        apiKey: env.JUDGE0_API_KEY,
        provider,
        rapidApiHost: endpoint.host,
        authHeader: env.JUDGE0_AUTH_HEADER,
      }),
      timeout: 30000, // 30 seconds
    });

    console.log(`[Judge0] Using ${provider} standard endpoint host=${endpoint.host}`);
  }

  /**
   * Submit code for execution with circuit breaker and retry logic
   */
  async submitCode(request: Judge0SubmissionRequest): Promise<string> {
    return await this.withCircuitBreaker('submit', async () => {
      return await this.submitCodeWithRetry(request);
    });
  }

  /**
   * Submit code with exponential backoff retry
   * Retries on HTTP 429 (rate limit) and 5xx errors
   * Max 2 retries
   */
  private async submitCodeWithRetry(
    request: Judge0SubmissionRequest,
    attempt: number = 0
  ): Promise<string> {
    try {
      // Encode source code and stdin as base64 (required for binary-safe I/O)
      const encodedRequest = {
        ...request,
        source_code: Buffer.from(request.source_code).toString('base64'),
        stdin: request.stdin ? Buffer.from(request.stdin).toString('base64') : undefined,
        expected_output: request.expected_output
          ? Buffer.from(request.expected_output).toString('base64')
          : undefined,
      };

      recordJudge0Call('submit');
      const response = await this.client.post<Judge0SubmissionResponse>(
        '/submissions',
        encodedRequest,
        {
          params: {
            base64_encoded: 'true',
            wait: 'false',
          },
        }
      );

      return response.data.token;
    } catch (error: any) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      recordJudge0Failure('submit', error, status ?? null);

      const retryable = isRetryableJudge0HttpStatus(status);
      const shouldRetry = retryable && attempt < 2;

      if (shouldRetry) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Judge0] Retrying submission after ${delay}ms (attempt ${attempt + 1}/2)`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return await this.submitCodeWithRetry(request, attempt + 1);
      }

      console.error(`[Judge0] Submission failed after retries (status=${status ?? 'network'}): ${axiosError.message}`);
      throw toJudge0InfrastructureError('submit', error, 'Failed to submit code to Judge0', status ?? null);
    }
  }

  /**
   * Get submission result with circuit breaker
   * Polls until terminal state is reached
   */
  async getSubmission(token: string): Promise<Judge0ResultResponse> {
    return await this.withCircuitBreaker('result', async () => {
      return await this.getSubmissionWithRetry(token);
    });
  }

  /**
   * Get submission with retry logic
   */
  private async getSubmissionWithRetry(
    token: string,
    attempt: number = 0
  ): Promise<Judge0ResultResponse> {
    try {
      recordJudge0Call('result');
      const response = await this.client.get<Judge0ResultResponse>(
        `/submissions/${token}`,
        {
          params: {
            base64_encoded: 'true',   // must match submission encoding
            fields: 'status,stdout,stderr,compile_output,message,time,memory',
          },
        }
      );

      const data = response.data;

      // Decode base64 fields returned by Judge0
      const decode = (v: string | null): string | null => {
        if (!v) return v;
        try { return Buffer.from(v, 'base64').toString('utf-8'); } catch { return v; }
      };

      return {
        ...data,
        stdout:         decode(data.stdout),
        stderr:         decode(data.stderr),
        compile_output: decode(data.compile_output),
        message:        decode(data.message),
      };
    } catch (error: any) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      recordJudge0Failure('result', error, status ?? null);

      const retryable = isRetryableJudge0HttpStatus(status);
      const shouldRetry = retryable && attempt < 2;

      if (shouldRetry) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Judge0] Retrying get submission after ${delay}ms (attempt ${attempt + 1}/2)`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return await this.getSubmissionWithRetry(token, attempt + 1);
      }

      console.error(`[Judge0] Result fetch failed after retries (status=${status ?? 'network'}): ${axiosError.message}`);
      throw toJudge0InfrastructureError('result', error, 'Failed to get submission from Judge0', status ?? null);
    }
  }

  /**
   * Poll submission until terminal state
   * Returns final result
   */
  async pollSubmission(token: string, maxAttempts = env.JUDGE0_POLL_MAX_ATTEMPTS): Promise<Judge0ResultResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.getSubmission(token);

      // Check if terminal state
      if (this.isTerminalState(result.status.id)) {
        return result;
      }

      // Wait before next poll (exponential backoff)
      const delay = Math.min(
        env.JUDGE0_POLL_INITIAL_DELAY_MS * Math.pow(1.5, attempt),
        env.JUDGE0_POLL_MAX_DELAY_MS
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Judge0InfrastructureError('Submission polling timeout', {
      operation: 'poll',
      retryable: true,
    });
  }

  // ─── Batch execution ──────────────────────────────────────────────────────
  // Judge0 supports submitting many test cases in a single request via
  // /submissions/batch. Contest submissions can contain more than one batch;
  // JUDGE0_MAX_BATCH_SIZE only controls transport chunk size, not total tests.

  /** Submit a batch of submissions; returns tokens aligned to input order. */
  async submitBatch(requests: Judge0SubmissionRequest[]): Promise<string[]> {
    return await this.withCircuitBreaker('submit', async () => {
      return await this.submitBatchWithRetry(requests);
    });
  }

  private async submitBatchWithRetry(
    requests: Judge0SubmissionRequest[],
    attempt: number = 0
  ): Promise<string[]> {
    try {
      const submissions = requests.map((request) => ({
        ...request,
        source_code: Buffer.from(request.source_code).toString('base64'),
        stdin: request.stdin ? Buffer.from(request.stdin).toString('base64') : undefined,
        expected_output: request.expected_output
          ? Buffer.from(request.expected_output).toString('base64')
          : undefined,
      }));

      recordJudge0Call('submit');
      const response = await this.client.post<Array<{ token?: string; error?: unknown }>>(
        '/submissions/batch',
        { submissions },
        { params: { base64_encoded: 'true' } }
      );

      const tokens = (response.data || [])
        .map((item) => item?.token)
        .filter((t): t is string => Boolean(t));
      if (tokens.length !== requests.length) {
        throw new Judge0InfrastructureError('Judge0 batch submit returned incomplete tokens', {
          operation: 'submit',
          retryable: true,
        });
      }
      return tokens;
    } catch (error: any) {
      if (isJudge0InfrastructureError(error)) throw error;
      const status = (error as AxiosError).response?.status;
      recordJudge0Failure('submit', error, status ?? null);

      if (isRetryableJudge0HttpStatus(status) && attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Judge0] Retrying batch submit after ${delay}ms (attempt ${attempt + 1}/2)`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return await this.submitBatchWithRetry(requests, attempt + 1);
      }

      throw toJudge0InfrastructureError('submit', error, 'Failed to submit batch to Judge0', status ?? null);
    }
  }

  private async getBatchWithRetry(
    tokens: string[],
    attempt: number = 0
  ): Promise<Judge0ResultResponse[]> {
    try {
      recordJudge0Call('result');
      const response = await this.client.get<{ submissions: Judge0ResultResponse[] }>(
        '/submissions/batch',
        {
          params: {
            tokens: tokens.join(','),
            base64_encoded: 'true',
            fields: 'status,stdout,stderr,compile_output,message,time,memory',
          },
        }
      );

      const decode = (v: string | null): string | null => {
        if (!v) return v;
        try { return Buffer.from(v, 'base64').toString('utf-8'); } catch { return v; }
      };

      return (response.data.submissions || []).map((data) => ({
        ...data,
        stdout: decode(data.stdout),
        stderr: decode(data.stderr),
        compile_output: decode(data.compile_output),
        message: decode(data.message),
      }));
    } catch (error: any) {
      const status = (error as AxiosError).response?.status;
      recordJudge0Failure('result', error, status ?? null);

      if (isRetryableJudge0HttpStatus(status) && attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return await this.getBatchWithRetry(tokens, attempt + 1);
      }

      throw toJudge0InfrastructureError('result', error, 'Failed to get batch from Judge0', status ?? null);
    }
  }

  /** Poll a batch of tokens until every submission reaches a terminal state. */
  async pollBatch(tokens: string[], maxAttempts = env.JUDGE0_POLL_MAX_ATTEMPTS): Promise<Judge0ResultResponse[]> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const results = await this.withCircuitBreaker('result', async () => this.getBatchWithRetry(tokens));

      const allTerminal = results.length === tokens.length
        && results.every((r) => this.isTerminalState(r.status.id));
      if (allTerminal) {
        return results;
      }

      const delay = Math.min(
        env.JUDGE0_POLL_INITIAL_DELAY_MS * Math.pow(1.5, attempt),
        env.JUDGE0_POLL_MAX_DELAY_MS
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Judge0InfrastructureError('Batch submission polling timeout', {
      operation: 'poll',
      retryable: true,
    });
  }

  /**
   * Execute the same code against many stdins in batches.
   * Chunks at JUDGE0_MAX_BATCH_SIZE; results are aligned to the input order.
   */
  async executeBatch(
    code: string,
    language: SupportedLanguage,
    stdins: Array<string | undefined>,
    limits?: Judge0ExecutionLimits
  ): Promise<Judge0ResultResponse[]> {
    const languageId = LANGUAGE_IDS[language];
    if (!languageId) {
      throw new Error(`Unsupported language: ${language}`);
    }

    const buildRequest = (stdin: string | undefined): Judge0SubmissionRequest => {
      const request: Judge0SubmissionRequest = {
        source_code: code,
        language_id: languageId,
        stdin,
        // Mirror executeCode: honour per-question limits, fall back to env.
        cpu_time_limit: limits?.cpuTimeLimitSeconds
          ? clampCpuTimeLimit(Number(limits.cpuTimeLimitSeconds))
          : clampCpuTimeLimit(env.JUDGE0_CPU_TIME_LIMIT_SECONDS),
        wall_time_limit: limits?.cpuTimeLimitSeconds
          ? Math.max(clampCpuTimeLimit(Number(limits.cpuTimeLimitSeconds)) + 2, clampCpuTimeLimit(Number(limits.cpuTimeLimitSeconds)) * 2)
          : env.JUDGE0_WALL_TIME_LIMIT_SECONDS,
        memory_limit: limits?.memoryLimitMb
          ? normalizeMemoryLimitKb(Number(limits.memoryLimitMb))
          : clampMemoryLimitKb(env.JUDGE0_MEMORY_LIMIT_KB),
      };
      if (env.JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT !== undefined) {
        request.enable_per_process_and_thread_time_limit = env.JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT;
      }
      if (env.JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT !== undefined) {
        request.enable_per_process_and_thread_memory_limit = env.JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT;
      }
      return request;
    };

    const batchSize = Math.max(1, Math.min(20, env.JUDGE0_MAX_BATCH_SIZE));
    const results: Judge0ResultResponse[] = [];

    for (let i = 0; i < stdins.length; i += batchSize) {
      const chunk = stdins.slice(i, i + batchSize).map(buildRequest);
      const tokens = await this.submitBatch(chunk);
      const chunkResults = await this.pollBatch(tokens);
      results.push(...chunkResults);
    }

    return results;
  }

  private async withCircuitBreaker<T>(
    operation: Judge0InfrastructureOperation,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      return await judge0CircuitBreaker.execute(fn);
    } catch (error) {
      if (isJudge0InfrastructureError(error)) {
        throw error;
      }

      if (isCircuitBreakerOpenError(error)) {
        throw new Judge0InfrastructureError('Judge0 circuit breaker is open', {
          operation,
          retryable: true,
          cause: error,
        });
      }

      throw error;
    }
  }

  /**
   * Check if status is terminal (not in queue or processing)
   */
  private isTerminalState(statusId: number): boolean {
    return statusId !== Judge0Status.IN_QUEUE && statusId !== Judge0Status.PROCESSING;
  }

  /**
   * Execute code with test case
   * Convenience method that submits and polls
   */
  async executeCode(
    code: string,
    language: SupportedLanguage,
    stdin?: string,
    expectedOutput?: string,
    limits?: Judge0ExecutionLimits
  ): Promise<Judge0ResultResponse> {
    const languageId = LANGUAGE_IDS[language];
    if (!languageId) {
      throw new Error(`Unsupported language: ${language}`);
    }

    const request: Judge0SubmissionRequest = {
      source_code: code,
      language_id: languageId,
      stdin,
      expected_output: expectedOutput,
      cpu_time_limit: limits?.cpuTimeLimitSeconds
        ? clampCpuTimeLimit(Number(limits.cpuTimeLimitSeconds))
        : clampCpuTimeLimit(env.JUDGE0_CPU_TIME_LIMIT_SECONDS),
      wall_time_limit: limits?.cpuTimeLimitSeconds
        ? Math.max(clampCpuTimeLimit(Number(limits.cpuTimeLimitSeconds)) + 2, clampCpuTimeLimit(Number(limits.cpuTimeLimitSeconds)) * 2)
        : env.JUDGE0_WALL_TIME_LIMIT_SECONDS,
      memory_limit: limits?.memoryLimitMb
        ? normalizeMemoryLimitKb(Number(limits.memoryLimitMb))
        : clampMemoryLimitKb(env.JUDGE0_MEMORY_LIMIT_KB),
    };

    if (env.JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT !== undefined) {
      request.enable_per_process_and_thread_time_limit =
        env.JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT;
    }

    if (env.JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT !== undefined) {
      request.enable_per_process_and_thread_memory_limit =
        env.JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT;
    }

    const token = await this.submitCode(request);

    return await this.pollSubmission(token);
  }
}

// Export singleton instance
export const judge0Client = new Judge0Client();

/**
 * Helper function to check if result is accepted
 */
export function isAccepted(result: Judge0ResultResponse): boolean {
  return result.status.id === Judge0Status.ACCEPTED;
}

/**
 * Helper function to get human-readable status
 */
export function getStatusDescription(statusId: number): string {
  const statusMap: Record<number, string> = {
    [Judge0Status.IN_QUEUE]: 'In Queue',
    [Judge0Status.PROCESSING]: 'Processing',
    [Judge0Status.ACCEPTED]: 'Accepted',
    [Judge0Status.WRONG_ANSWER]: 'Wrong Answer',
    [Judge0Status.TIME_LIMIT_EXCEEDED]: 'Time Limit Exceeded',
    [Judge0Status.COMPILATION_ERROR]: 'Compilation Error',
    [Judge0Status.RUNTIME_ERROR_SIGSEGV]: 'Runtime Error (SIGSEGV)',
    [Judge0Status.RUNTIME_ERROR_SIGXFSZ]: 'Runtime Error (SIGXFSZ)',
    [Judge0Status.RUNTIME_ERROR_SIGFPE]: 'Runtime Error (SIGFPE)',
    [Judge0Status.RUNTIME_ERROR_SIGABRT]: 'Runtime Error (SIGABRT)',
    [Judge0Status.RUNTIME_ERROR_NZEC]: 'Runtime Error (NZEC)',
    [Judge0Status.RUNTIME_ERROR_OTHER]: 'Runtime Error',
    [Judge0Status.INTERNAL_ERROR]: 'Internal Error',
    [Judge0Status.EXEC_FORMAT_ERROR]: 'Exec Format Error',
  };

  return statusMap[statusId] || 'Unknown Status';
}
