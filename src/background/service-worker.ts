import {
  hasVaultData,
  resetVault,
  readSecretConfig,
  writeSecretConfig,
  readCanonicalData,
  writeCanonicalData,
  listDocuments,
  getDocument,
  getActiveDocumentId,
  createDocument,
  updateDocument,
  deleteDocument,
  setActiveDocument,
} from '@/lib/vault';
import type { CanonicalData } from '@/lib/canonical-schema';
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
import { readSessionKey, writeSessionKey, removeSessionKey } from '@/lib/storage';

const DEFAULT_MODEL = 'gpt-4o-mini';

// Persisted across popup re-opens via chrome.storage.session — survives the
// service-worker being suspended and the popup being closed/reopened, but is
// dropped when Chrome itself shuts down.
const COMPILE_SESSION_KEY = 'ufc_compile_session_v1';
const PENDING_PROPOSAL_KEY = 'ufc_pending_proposal_v1';

interface CompileSessionPersisted {
  fields: FieldDescriptor[];
  proposal: Mapping[];
  results: { fieldId: string; ok: boolean; error?: string }[];
  tokensUsed: number;
  ts: number;
}

interface PendingProposal {
  tabId: number;
  fields: FieldDescriptor[];
  proposal: Mapping[];
  tokensUsed: number;
}

// In-memory cache plus session-storage fallback. The MV3 service worker can
// be suspended at any moment between compile/start and compile/confirm; if it
// is, the in-memory `pendingProposal` is lost. Reading from session storage
// on miss recovers transparently.
let pendingProposalCache: PendingProposal | null = null;

async function setPendingProposal(p: PendingProposal): Promise<void> {
  pendingProposalCache = p;
  await writeSessionKey(PENDING_PROPOSAL_KEY, p);
}

async function getPendingProposal(): Promise<PendingProposal | null> {
  if (pendingProposalCache) return pendingProposalCache;
  const stored = await readSessionKey<PendingProposal>(PENDING_PROPOSAL_KEY);
  if (stored) pendingProposalCache = stored;
  return stored ?? null;
}

async function clearPendingProposal(): Promise<void> {
  pendingProposalCache = null;
  await removeSessionKey(PENDING_PROPOSAL_KEY);
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab;
}

async function activeTabId(): Promise<number> {
  return (await activeTab()).id!;
}

type EnsureResult = { ok: true } | { ok: false; error: string };

// Make sure the content script is alive in the given tab. If it isn't,
// try to inject it programmatically. This recovers from the very common
// case of a tab that was already open before the extension was loaded
// or reloaded — Chrome does not auto-inject content scripts in that case.
async function ensureContentScript(
  tabId: number,
  url: string | undefined,
): Promise<EnsureResult> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'content/ping' });
    return { ok: true };
  } catch {
    // Listener absent — fall through to injection.
  }

  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      error:
        'Questa pagina non supporta la compilazione automatica. Apri un sito web (http o https) e riprova.',
    };
  }

  const manifest = chrome.runtime.getManifest();
  const cs = manifest.content_scripts?.[0];
  const jsFiles = cs?.js ?? [];
  const cssFiles = cs?.css ?? [];
  if (jsFiles.length === 0) {
    return { ok: false, error: 'Content script non registrato nel manifest' };
  }

  try {
    if (cssFiles.length > 0) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: cssFiles,
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: jsFiles,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        'Impossibile attivare la compilazione su questa pagina. Ricaricala (F5) e riprova. ' +
        `(${err instanceof Error ? err.message : 'unknown error'})`,
    };
  }
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
        await clearPendingProposal();
        await removeSessionKey(COMPILE_SESSION_KEY);
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
          theme: cfg?.theme ?? 'system',
        };
      } catch {
        return { apiKey: null, model: DEFAULT_MODEL, theme: 'system' };
      }
    }

    case 'settings/save': {
      try {
        await writeSecretConfig({
          apiKey: req.apiKey,
          model: req.model,
          theme: req.theme,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'documents/list': {
      const docs = await listDocuments();
      const activeId = await getActiveDocumentId();
      return {
        documents: docs.map((d) => {
          const p = d.data.person;
          const nameParts = [p.first_name, p.middle_name, p.last_name]
            .filter((s) => typeof s === 'string' && s.length > 0)
            .join(' ');
          return {
            id: d.id,
            name: d.name,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            preview: {
              fullName: nameParts || p.full_name || '',
              email: d.data.contact?.email ?? '',
            },
          };
        }),
        activeId,
      };
    }

    case 'documents/get': {
      const doc = await getDocument(req.id);
      if (!doc) return { document: null };
      return {
        document: {
          id: doc.id,
          name: doc.name,
          data: doc.data,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        },
      };
    }

    case 'documents/create': {
      try {
        const doc = await createDocument(req.name, req.data as CanonicalData);
        return { ok: true, id: doc.id };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'documents/update': {
      try {
        const patch: { name?: string; data?: CanonicalData } = {};
        if (req.name !== undefined) patch.name = req.name;
        if (req.data !== undefined) patch.data = req.data as CanonicalData;
        const updated = await updateDocument(req.id, patch);
        if (!updated) return { ok: false, error: 'Documento non trovato' };
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'documents/delete': {
      try {
        await deleteDocument(req.id);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'documents/setActive': {
      const ok = await setActiveDocument(req.id);
      return ok ? { ok: true } : { ok: false, error: 'Documento non trovato' };
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
        // Independent prep steps (config read, canonical read, tab lookup,
        // and clearing the previous session) all run in parallel. ensureCS
        // depends on `tab` so it stays sequential after.
        const [cfg, canonical, tab] = await Promise.all([
          readSecretConfig(),
          readCanonicalData(),
          activeTab(),
          removeSessionKey(COMPILE_SESSION_KEY),
        ]);
        if (!cfg?.apiKey) {
          return { ok: false, error: 'OpenAI API key not configured' };
        }
        if (!canonical) {
          return {
            ok: false,
            error: 'No canonical data imported yet — run the setup wizard',
          };
        }
        const tabId = tab.id!;
        const ensure = await ensureContentScript(tabId, tab.url);
        if (!ensure.ok) {
          return { ok: false, error: ensure.error };
        }
        let scanRes: { ok: true; fields: FieldDescriptor[] } | { ok: false; error: string };
        try {
          scanRes = (await chrome.tabs.sendMessage(tabId, {
            type: 'content/scan',
          })) as { ok: true; fields: FieldDescriptor[] } | { ok: false; error: string };
        } catch (err) {
          return {
            ok: false,
            error: `Errore comunicazione con la pagina: ${err instanceof Error ? err.message : 'unknown'}`,
          };
        }
        if (!scanRes.ok) {
          return { ok: false, error: scanRes.error };
        }
        const ai = createAIClient({ apiKey: cfg.apiKey, model: cfg.model });
        const proposalResult = await computeProposal(
          scanRes.fields,
          canonical,
          { ai },
        );
        await setPendingProposal({
          tabId,
          fields: scanRes.fields,
          proposal: proposalResult.proposal,
          tokensUsed: proposalResult.tokensUsed,
        });
        // Fire-and-forget: marker rendering is purely visual feedback on the
        // page — the user's popup flow does not need to wait for it. Saves
        // one round-trip to the content script before the proposal is shown.
        void chrome.tabs
          .sendMessage(tabId, {
            type: 'content/mark',
            marks: proposalResult.proposal.map((m) => {
              const field = scanRes.fields.find((f) => f.id === m.fieldId);
              return {
                selector: field?.selector ?? '',
                status: m.status,
              };
            }),
          })
          .catch(() => {
            // Tab may have navigated; safe to ignore.
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
        const pending = await getPendingProposal();
        if (!pending) return { ok: false, error: 'No pending proposal' };
        const mappings = req.mappings as Mapping[];
        const valuesById: Record<string, string> = {};
        const selectorsById: Record<string, string> = {};
        for (const m of mappings) {
          const field = pending.fields.find((f) => f.id === m.fieldId);
          if (!field) continue;
          selectorsById[m.fieldId] = field.selector;
          // Pass-2 AI-fill mappings carry a literal value derived/translated
          // from the canonical data. When present it wins over canonicalKey.
          valuesById[m.fieldId] =
            m.literalValue !== undefined
              ? m.literalValue
              : resolveRealValue(canonical, m.canonicalKey);
        }
        const fillRes = (await chrome.tabs.sendMessage(pending.tabId, {
          type: 'content/fill',
          mappings,
          valuesById,
          selectorsById,
        })) as {
          ok: true;
          results: { fieldId: string; ok: boolean; error?: string }[];
        };
        // Persist the result so the popup can restore the same view after
        // being closed and re-opened (e.g. user clicked away to verify the
        // form). Cleared on dismissResult, clearMarks, new compile, or reset.
        const sessionPayload: CompileSessionPersisted = {
          fields: pending.fields,
          proposal: pending.proposal,
          results: fillRes.results,
          tokensUsed: pending.tokensUsed,
          ts: Date.now(),
        };
        await writeSessionKey(COMPILE_SESSION_KEY, sessionPayload);
        await clearPendingProposal();
        return { ok: true, results: fillRes.results };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Unknown' };
      }
    }

    case 'compile/clearMarks': {
      try {
        const tabId = await activeTabId();
        await chrome.tabs.sendMessage(tabId, { type: 'content/clear' });
      } catch {
        // ignore
      }
      await clearPendingProposal();
      await removeSessionKey(COMPILE_SESSION_KEY);
      return { ok: true };
    }

    case 'compile/restoreSession': {
      const session = await readSessionKey<CompileSessionPersisted>(
        COMPILE_SESSION_KEY,
      );
      return { session: session ?? null };
    }

    case 'compile/dismissResult': {
      await removeSessionKey(COMPILE_SESSION_KEY);
      return { ok: true };
    }

    default: {
      // TypeScript narrows `req` to `never` here when the switch is
      // exhaustive. If a new PopupRequest type is added without a case,
      // this assignment fails to compile — preventing silent no-ops.
      const _exhaustive: never = req;
      return _exhaustive;
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
