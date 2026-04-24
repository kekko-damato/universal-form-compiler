import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createRateLimiter } from '@/background/rate-limiter';

describe('rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to maxAttempts within the window', () => {
    const rl = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60_000 });
    for (let i = 0; i < 5; i++) {
      expect(rl.check()).toMatchObject({ allowed: true });
      rl.recordFailure();
    }
    expect(rl.check()).toEqual({
      allowed: false,
      lockoutMs: expect.any(Number),
      attemptsRemaining: 0,
    });
  });

  it('reports attemptsRemaining correctly', () => {
    const rl = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60_000 });
    expect(rl.check().allowed).toBe(true);
    rl.recordFailure();
    expect(rl.check().allowed).toBe(true);
    rl.recordFailure();
    rl.recordFailure();
    const check = rl.check();
    expect(check.allowed).toBe(true);
    if (check.allowed) {
      expect(check.attemptsRemaining).toBe(2);
    }
  });

  it('resets on recordSuccess', () => {
    const rl = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60_000 });
    for (let i = 0; i < 5; i++) rl.recordFailure();
    expect(rl.check().allowed).toBe(false);

    rl.recordSuccess();
    expect(rl.check().allowed).toBe(true);
  });

  it('drops old attempts after window', () => {
    const rl = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60_000 });
    for (let i = 0; i < 5; i++) rl.recordFailure();
    expect(rl.check().allowed).toBe(false);

    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(rl.check().allowed).toBe(true);
  });

  it('exponential backoff across lockouts', () => {
    const rl = createRateLimiter({
      maxAttempts: 3,
      windowMs: 60_000,
      baseLockoutMs: 1000,
    });
    for (let i = 0; i < 3; i++) rl.recordFailure();
    const first = rl.check();
    expect(first.allowed).toBe(false);
    if (!first.allowed) expect(first.lockoutMs).toBe(1000);

    vi.advanceTimersByTime(1001);
    rl.recordFailure(); // triggers next lockout level
    const second = rl.check();
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.lockoutMs).toBe(2000);
  });
});
