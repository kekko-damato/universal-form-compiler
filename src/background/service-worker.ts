import {
  hasVaultData,
  resetVault,
  readSecretConfig,
  writeSecretConfig,
  readCanonicalData,
  writeCanonicalData,
} from '@/lib/vault';
import {
  createAIClient,
  AIAuthError,
  AIBudgetExceededError,
  AIRateLimitError,
  AIServerError,
} from './ai-client';
import { importRawData, type ImportFormat } from '@/lib/importer';
import { fromBase64 } from '@/lib/crypto';
import { computeProposal, resolveRealValue } from './orchestrator';
import type { FieldDescriptor } from '@/types/field';
import type { Mapping } from '@/types/mapping';
import type {
  PopupRequest,
  PopupResponse,
  VaultState,
} from '@/types/messages';

const DEFAULT_MODEL = 'gpt-4o-mini';

interface PendingProposal {
  tabId: number;
  fields: FieldDescriptor[];
  proposal: Mapping[];
}
let pendingProposal: PendingProposal | null = null;

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}

function formatFromFilename(filename: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'text';
}

function formatAIError(err: unknown): string {
  if (err instanceof AIAuthError) return 'OpenAI API key is invalid';
  if (err instanceof AIBudgetExceededError) return 'AI budget exceeded';
  if (err instanceof AIRateLimitError) return 'OpenAI rate limit reached';
  if (err instanceof AIServerError) return `OpenAI server error (${err.status})`;
  return err instanceof Error ? err.message : 'Unknown error';
}

async function computeVaultState(): Promise<VaultState> {
  return (await hasVaultData()) ? { kind: 'has_data' } : { kind: 'no_data' };
}

async function handleRequest(req: PopupRequest): Promise<PopupResponse> {
  switch (req.type) {
    case 'vault/getState':
      return { state: await computeVaultState() };

    case 'vault/reset':
      try {
        await resetVault();
        pendingProposal = null;
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }

    case 'settings/get': {
      try {
        const cfg = await readSecretConfig();
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
        await writeSecretConfig({ apiKey: req.apiKey, model: req.model });
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
        const cfg = await readSecretConfig();
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
        const data = await readCanonicalData();
        return { data };
      } catch {
        return { data: null };
      }
    }

    case 'canonical/save': {
      try {
        await writeCanonicalData(
          req.data as Parameters<typeof writeCanonicalData>[0],
        );
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'compile/start': {
      try {
        const cfg = await readSecretConfig();
        if (!cfg?.apiKey) {
          return { ok: false, error: 'OpenAI API key not configured' };
        }
        const canonical = await readCanonicalData();
        if (!canonical) {
          return {
            ok: false,
            error: 'No canonical data imported yet — run the setup wizard',
          };
        }
        const tabId = await activeTabId();
        let scanRes: { ok: true; fields: FieldDescriptor[] } | { ok: false; error: string };
        try {
          scanRes = (await chrome.tabs.sendMessage(tabId, {
            type: 'content/scan',
          })) as { ok: true; fields: FieldDescriptor[] } | { ok: false; error: string };
        } catch {
          return {
            ok: false,
            error: 'Apri una pagina web normale (http/https) e riprova',
          };
        }
        if (!('ok' in scanRes) || !scanRes.ok) {
          return {
            ok: false,
            error:
              'ok' in scanRes
                ? (scanRes as { error: string }).error
                : 'Scan failed (content script not responding)',
          };
        }
        const ai = createAIClient({ apiKey: cfg.apiKey, model: cfg.model });
        const proposalResult = await computeProposal(
          scanRes.fields,
          canonical,
          { ai },
        );
        pendingProposal = {
          tabId,
          fields: scanRes.fields,
          proposal: proposalResult.proposal,
        };
        await chrome.tabs.sendMessage(tabId, {
          type: 'content/mark',
          marks: proposalResult.proposal.map((m) => {
            const field = scanRes.fields.find((f) => f.id === m.fieldId);
            return {
              selector: field?.selector ?? '',
              status: m.status,
            };
          }),
        });
        return {
          ok: true,
          fields: scanRes.fields,
          proposal: proposalResult.proposal,
          tokensUsed: proposalResult.tokensUsed,
        };
      } catch (err) {
        return { ok: false, error: formatAIError(err) };
      }
    }

    case 'compile/confirm': {
      try {
        const canonical = await readCanonicalData();
        if (!canonical) return { ok: false, error: 'No data' };
        if (!pendingProposal) return { ok: false, error: 'No pending proposal' };
        const mappings = req.mappings as Mapping[];
        const valuesById: Record<string, string> = {};
        const selectorsById: Record<string, string> = {};
        for (const m of mappings) {
          const field = pendingProposal.fields.find((f) => f.id === m.fieldId);
          if (!field) continue;
          selectorsById[m.fieldId] = field.selector;
          valuesById[m.fieldId] = resolveRealValue(canonical, m.canonicalKey);
        }
        const fillRes = (await chrome.tabs.sendMessage(pendingProposal.tabId, {
          type: 'content/fill',
          mappings,
          valuesById,
          selectorsById,
        })) as {
          ok: true;
          results: { fieldId: string; ok: boolean; error?: string }[];
        };
        pendingProposal = null;
        return { ok: true, results: fillRes.results };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Unknown' };
      }
    }

    case 'compile/clearMarks': {
      try {
        const tabId = await activeTabId();
        await chrome.tabs.sendMessage(tabId, { type: 'content/clear' });
        pendingProposal = null;
      } catch {
        // ignore
      }
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener(
  (req: PopupRequest, _sender, sendResponse) => {
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
