import {
  hasVault,
  createVault,
  openVault,
  deleteVault,
  WrongPasswordError,
  VaultLockedError,
} from '@/lib/vault';
import { createSessionManager } from './session';
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

    case 'vault/unlock':
      try {
        await openVault(req.masterPassword);
        session.unlock(req.masterPassword);
        return { ok: true };
      } catch (err) {
        if (err instanceof WrongPasswordError) {
          return { ok: false, error: 'Wrong master password' };
        }
        if (err instanceof VaultLockedError) {
          return { ok: false, error: 'No vault exists' };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
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
