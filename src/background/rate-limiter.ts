export interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  baseLockoutMs?: number; // default 30_000
}

export type CheckResult =
  | { allowed: true; attemptsRemaining: number }
  | { allowed: false; lockoutMs: number; attemptsRemaining: 0 };

export interface RateLimiter {
  check(): CheckResult;
  recordFailure(): void;
  recordSuccess(): void;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const baseLockoutMs = opts.baseLockoutMs ?? 30_000;
  let failures: number[] = []; // timestamps
  let lockoutLevel = 0; // increments each time limit is hit

  function prune(): void {
    const cutoff = Date.now() - opts.windowMs;
    failures = failures.filter((t) => t > cutoff);
  }

  function check(): CheckResult {
    prune();
    const remaining = opts.maxAttempts - failures.length;
    if (remaining > 0) {
      return { allowed: true, attemptsRemaining: remaining };
    }
    const lockoutMs = baseLockoutMs * Math.pow(2, lockoutLevel);
    return { allowed: false, lockoutMs, attemptsRemaining: 0 };
  }

  function recordFailure(): void {
    prune();
    failures.push(Date.now());
    if (failures.length > opts.maxAttempts) {
      lockoutLevel++;
    }
  }

  function recordSuccess(): void {
    failures = [];
    lockoutLevel = 0;
  }

  return { check, recordFailure, recordSuccess };
}
