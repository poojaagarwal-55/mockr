export type Judge0InfrastructureOperation = 'submit' | 'result' | 'poll' | 'circuit';

export interface Judge0InfrastructureErrorOptions {
  operation?: Judge0InfrastructureOperation;
  statusCode?: number;
  retryable?: boolean;
  cause?: unknown;
}

export class Judge0InfrastructureError extends Error {
  readonly code = 'JUDGE0_INFRASTRUCTURE_ERROR';
  readonly operation: Judge0InfrastructureOperation | null;
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: Judge0InfrastructureErrorOptions = {}) {
    super(message);
    this.name = 'Judge0InfrastructureError';
    this.operation = options.operation ?? null;
    this.statusCode = options.statusCode ?? null;
    this.retryable = options.retryable ?? true;

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isJudge0InfrastructureError(error: unknown): error is Judge0InfrastructureError {
  return (
    error instanceof Judge0InfrastructureError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'JUDGE0_INFRASTRUCTURE_ERROR')
  );
}

export function isCircuitBreakerOpenError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Circuit breaker is OPEN');
}

export function isRetryableJudge0HttpStatus(statusCode: number | null | undefined): boolean {
  return (
    statusCode == null ||
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode >= 500
  );
}
