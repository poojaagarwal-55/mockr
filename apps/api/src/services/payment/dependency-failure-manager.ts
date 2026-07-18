type DependencyHealth = {
  dependency: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  failures: number;
  openUntil: number | null;
  lastErrorAt: number | null;
};

type CircuitState = {
  failures: number;
  openUntil: number | null;
  lastErrorAt: number | null;
};

type ExecuteOptions<T> = {
  failureThreshold?: number;
  cooldownMs?: number;
  fallback?: () => Promise<T>;
};

export class DependencyFailureManager {
  private readonly circuits = new Map<string, CircuitState>();

  private getState(dependency: string): CircuitState {
    const existing = this.circuits.get(dependency);
    if (existing) {
      return existing;
    }

    const created: CircuitState = {
      failures: 0,
      openUntil: null,
      lastErrorAt: null,
    };

    this.circuits.set(dependency, created);
    return created;
  }

  async executeWithCircuitBreaker<T>(
    dependency: string,
    task: () => Promise<T>,
    options?: ExecuteOptions<T>
  ): Promise<{
    ok: boolean;
    data?: T;
    fromFallback: boolean;
    error?: unknown;
    circuitOpen: boolean;
  }> {
    const failureThreshold = options?.failureThreshold || 3;
    const cooldownMs = options?.cooldownMs || 60_000;

    const state = this.getState(dependency);
    const now = Date.now();

    if (state.openUntil && state.openUntil > now) {
      if (options?.fallback) {
        try {
          const fallbackData = await options.fallback();
          return {
            ok: true,
            data: fallbackData,
            fromFallback: true,
            circuitOpen: true,
          };
        } catch (fallbackError) {
          return {
            ok: false,
            fromFallback: true,
            error: fallbackError,
            circuitOpen: true,
          };
        }
      }

      return {
        ok: false,
        fromFallback: false,
        error: new Error(`Circuit open for dependency: ${dependency}`),
        circuitOpen: true,
      };
    }

    try {
      const data = await task();
      state.failures = 0;
      state.openUntil = null;
      return {
        ok: true,
        data,
        fromFallback: false,
        circuitOpen: false,
      };
    } catch (error) {
      state.failures += 1;
      state.lastErrorAt = now;

      if (state.failures >= failureThreshold) {
        state.openUntil = now + cooldownMs;
      }

      if (options?.fallback) {
        try {
          const fallbackData = await options.fallback();
          return {
            ok: true,
            data: fallbackData,
            fromFallback: true,
            error,
            circuitOpen: Boolean(state.openUntil && state.openUntil > now),
          };
        } catch {
          // ignore fallback failure and return original error
        }
      }

      return {
        ok: false,
        fromFallback: false,
        error,
        circuitOpen: Boolean(state.openUntil && state.openUntil > now),
      };
    }
  }

  getDependencyHealth(): DependencyHealth[] {
    const now = Date.now();

    return Array.from(this.circuits.entries()).map(([dependency, state]) => {
      const open = Boolean(state.openUntil && state.openUntil > now);
      const status: DependencyHealth['status'] = open
        ? 'unhealthy'
        : state.failures > 0
          ? 'degraded'
          : 'healthy';

      return {
        dependency,
        status,
        failures: state.failures,
        openUntil: state.openUntil,
        lastErrorAt: state.lastErrorAt,
      };
    });
  }
}

export const dependencyFailureManager = new DependencyFailureManager();
