import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createSessionManager } from '@/background/session';

describe('session manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts locked', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    expect(sm.getState()).toBe('locked');
    expect(sm.getPassword()).toBeNull();
  });

  it('unlock stores password and reports unlocked', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    sm.unlock('my password');
    expect(sm.getState()).toBe('unlocked');
    expect(sm.getPassword()).toBe('my password');
  });

  it('lock clears password', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    sm.unlock('pw');
    sm.lock();
    expect(sm.getState()).toBe('locked');
    expect(sm.getPassword()).toBeNull();
  });

  it('auto-locks after timeout', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    sm.unlock('pw');
    expect(sm.getState()).toBe('unlocked');
    vi.advanceTimersByTime(60_001);
    expect(sm.getState()).toBe('locked');
    expect(sm.getPassword()).toBeNull();
  });

  it('touch() resets the timeout', () => {
    const sm = createSessionManager({ timeoutMs: 60_000 });
    sm.unlock('pw');
    vi.advanceTimersByTime(30_000);
    sm.touch();
    vi.advanceTimersByTime(40_000);
    expect(sm.getState()).toBe('unlocked'); // 40s since touch < 60s
    vi.advanceTimersByTime(20_001);
    expect(sm.getState()).toBe('locked');
  });

  it('onStateChange callback fires on lock/unlock', () => {
    const cb = vi.fn();
    const sm = createSessionManager({ timeoutMs: 60_000, onStateChange: cb });
    sm.unlock('pw');
    expect(cb).toHaveBeenCalledWith('unlocked');
    sm.lock();
    expect(cb).toHaveBeenCalledWith('locked');
  });
});
