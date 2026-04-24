export type SessionState = 'locked' | 'unlocked';

export interface SessionManagerOptions {
  timeoutMs: number;
  onStateChange?: (state: SessionState) => void;
}

export interface SessionManager {
  getState(): SessionState;
  getPassword(): string | null;
  unlock(password: string): void;
  lock(): void;
  touch(): void;
}

export function createSessionManager(
  opts: SessionManagerOptions,
): SessionManager {
  let password: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleTimeout(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      lock();
    }, opts.timeoutMs);
  }

  function lock(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const wasUnlocked = password !== null;
    password = null;
    if (wasUnlocked) opts.onStateChange?.('locked');
  }

  function unlock(pw: string): void {
    password = pw;
    scheduleTimeout();
    opts.onStateChange?.('unlocked');
  }

  function touch(): void {
    if (password !== null) scheduleTimeout();
  }

  function getState(): SessionState {
    return password === null ? 'locked' : 'unlocked';
  }

  function getPassword(): string | null {
    return password;
  }

  return { getState, getPassword, unlock, lock, touch };
}
