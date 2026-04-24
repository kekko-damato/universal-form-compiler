import {
  hasVault,
  createVault,
  openVault,
  deleteVault,
  WrongPasswordError,
  VaultLockedError,
} from '@/lib/vault';
import { createSessionManager } from './session';
import { createRateLimiter } from './rate-limiter';
import type {
  PopupRequest,
  PopupResponse,
  VaultState,
} from '@/types/messages';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const session = createSessionManager({
  timeoutMs: SESSION_TIMEOUT_MS,
  onStateChange: (state) => {
    console.log('[UFC] session', state);
  },
});

const unlockLimiter = createRateLimiter({
  maxAttempts: 5,
  windowMs: 5 * 60_000,
  baseLockoutMs: 30_000,
});

async function computeVaultState(): Promise<VaultState> {
  if (!(await hasVault())) return { kind: 'no_vault' };
  return session.getState() === 'unlocked'
    ? { kind: 'unlocked' }
    : { kind: 'locked' };
}

async function handleRequest(req: PopupRequest): Promise<PopupResponse> {
  switch (req.type) {
    case 'vault/getState':
      return { state: await computeVaultState() };

    case 'vault/create':
      try {
        await createVault(req.masterPassword);
        session.unlock(req.masterPassword);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

    case 'vault/unlock': {
      const gate = unlockLimiter.check();
      if (!gate.allowed) {
        return {
          ok: false,
          error: `Too many attempts, wait ${Math.ceil(gate.lockoutMs / 1000)}s`,
          lockoutMs: gate.lockoutMs,
          attemptsRemaining: 0,
        };
      }
      try {
        await openVault(req.masterPassword);
        unlockLimiter.recordSuccess();
        session.unlock(req.masterPassword);
        return { ok: true };
      } catch (err) {
        if (err instanceof WrongPasswordError) {
          unlockLimiter.recordFailure();
          const next = unlockLimiter.check();
          return {
            ok: false,
            error: 'Wrong master password',
            attemptsRemaining: next.allowed ? next.attemptsRemaining : 0,
          };
        }
        if (err instanceof VaultLockedError) {
          return { ok: false, error: 'No vault exists' };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'vault/lock':
      session.lock();
      return { ok: true };

    case 'vault/delete':
      try {
        await deleteVault(req.masterPassword);
        session.lock();
        return { ok: true };
      } catch (err) {
        if (err instanceof WrongPasswordError) {
          return { ok: false, error: 'Wrong master password' };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
  }
}

chrome.runtime.onMessage.addListener(
  (req: PopupRequest, _sender, sendResponse) => {
    // Refresh session activity on any message
    session.touch();

    handleRequest(req)
      .then((res) => sendResponse(res))
      .catch((err) => {
        console.error('[UFC] message handler error', err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });

    return true; // keep channel open for async response
  },
);

console.log('[UFC] service worker ready');
