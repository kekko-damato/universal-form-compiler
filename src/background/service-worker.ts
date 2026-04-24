import {
  hasVault,
  createVault,
  openVault,
  deleteVault,
  WrongPasswordError,
  VaultLockedError,
  readSecretConfig,
  writeSecretConfig,
  readCanonicalData,
  writeCanonicalData,
} from '@/lib/vault';
import { createSessionManager } from './session';
import { createRateLimiter } from './rate-limiter';
import {
  createAIClient,
  AIAuthError,
  AIBudgetExceededError,
  AIRateLimitError,
  AIServerError,
} from './ai-client';
import { importRawData, type ImportFormat } from '@/lib/importer';
import { fromBase64 } from '@/lib/crypto';
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

const DEFAULT_MODEL = 'gpt-4o-mini';

function formatFromFilename(filename: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'text';
}

function requirePassword(): string {
  const pw = session.getPassword();
  if (!pw) throw new Error('Vault is locked');
  return pw;
}

function formatAIError(err: unknown): string {
  if (err instanceof AIAuthError) return 'OpenAI API key is invalid';
  if (err instanceof AIBudgetExceededError) return 'AI budget exceeded';
  if (err instanceof AIRateLimitError) return 'OpenAI rate limit reached';
  if (err instanceof AIServerError) return `OpenAI server error (${err.status})`;
  return err instanceof Error ? err.message : 'Unknown error';
}

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

    case 'settings/get': {
      try {
        const pw = requirePassword();
        const cfg = await readSecretConfig(pw);
        return {
          apiKey: cfg?.apiKey ?? null,
          model: cfg?.model ?? DEFAULT_MODEL,
        };
      } catch {
        return { apiKey: null, model: DEFAULT_MODEL };
      }
    }

    case 'settings/save': {
      try {
        const pw = requirePassword();
        await writeSecretConfig(
          { apiKey: req.apiKey, model: req.model },
          pw,
        );
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'import/run': {
      try {
        const pw = requirePassword();
        const cfg = await readSecretConfig(pw);
        if (!cfg?.apiKey) {
          return { ok: false, error: 'OpenAI API key not configured' };
        }
        const ai = createAIClient({ apiKey: cfg.apiKey, model: cfg.model });
        const format = formatFromFilename(req.filename);
        const input =
          format === 'docx'
            ? { format, buffer: fromBase64(req.bufferBase64 ?? '').buffer as ArrayBuffer }
            : { format, text: req.text ?? '' };

        const result = await importRawData(input, { ai });
        if (!result.ok) {
          return {
            ok: false,
            error: 'Imported data failed validation',
            validationErrors: result.errors,
          };
        }
        return {
          ok: true,
          data: result.data,
          tokens: result.usage.total_tokens,
        };
      } catch (err) {
        return { ok: false, error: formatAIError(err) };
      }
    }

    case 'canonical/get': {
      try {
        const pw = requirePassword();
        const data = await readCanonicalData(pw);
        return { data };
      } catch {
        return { data: null };
      }
    }

    case 'canonical/save': {
      try {
        const pw = requirePassword();
        await writeCanonicalData(
          req.data as Parameters<typeof writeCanonicalData>[0],
          pw,
        );
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
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
