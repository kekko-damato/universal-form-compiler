import { createRouter, type Router, type ViewRenderer, type ViewId } from './views/router';
import { createSetupWizard } from './views/setup-wizard';
import { createMainView } from './views/main';
import { createSettingsView } from './views/settings';
import { createWizardImportStep } from './views/wizard-step-import';
import { createWizardReviewStep } from './views/wizard-step-review';
import { createResultView } from './views/result';
import { icon } from './icons';
import { loadAndApplyTheme } from './theme';
import type {
  GetVaultStateRequest,
  GetVaultStateResponse,
  StartCompileRequest,
  StartCompileResponse,
  ConfirmCompileRequest,
  ConfirmCompileResponse,
  RestoreCompileSessionRequest,
  RestoreCompileSessionResponse,
} from '@/types/messages';
import type { Mapping } from '@/types/mapping';

async function getVaultState(): Promise<GetVaultStateResponse['state']> {
  const res = (await chrome.runtime.sendMessage({
    type: 'vault/getState',
  } as GetVaultStateRequest)) as GetVaultStateResponse;
  return res.state;
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('missing #app');

  // Apply persisted theme as early as possible so the popup never flashes
  // the wrong palette while bootstrapping.
  await loadAndApplyTheme();

  let router: Router;

  async function routeByState(): Promise<void> {
    const state = await getVaultState();
    switch (state.kind) {
      case 'no_data':
        await router.show('setup-wizard');
        return;
      case 'has_data':
        await router.show('main');
        return;
    }
  }

  async function goMain(): Promise<void> {
    await router.show('main');
  }

  async function goSettings(): Promise<void> {
    await router.show('settings');
  }

  async function reImport(): Promise<void> {
    const host = container!;
    let imported: unknown = null;

    const importStep = createWizardImportStep(async (data) => {
      imported = data;
      const reviewStep = createWizardReviewStep({
        data: imported,
        onSave: async (parsed) => {
          const res = await chrome.runtime.sendMessage({
            type: 'canonical/save',
            data: parsed,
          });
          return res as { ok: true } | { ok: false; error: string };
        },
        onDone: goMain,
      });
      await reviewStep.render(host);
    });
    await importStep.render(host);
  }

  function showError(title: string, msg: string): void {
    container!.innerHTML = `
      <header class="header">
        <span class="h-icon h-icon-warn">${icon('alert', { size: 20 })}</span>
        <div class="h-text">
          <div class="h-title">${escapeHtml(title)}</div>
          <div class="h-subtitle">Compilazione non riuscita</div>
        </div>
      </header>
      <div class="error">
        ${icon('alert', { size: 14 })}
        <span>${escapeHtml(msg)}</span>
      </div>
      <div class="footer-actions">
        <button id="back-btn" class="secondary">
          ${icon('arrowLeft', { size: 16 })} Indietro
        </button>
      </div>
    `;
    container!.querySelector<HTMLButtonElement>('#back-btn')?.addEventListener(
      'click',
      () => void routeByState(),
    );
  }

  // Auto-fill flow: no confirmation step. Click "Compila form" → analyze →
  // fill all eligible mappings → show summary highlighting fields that need
  // review (uncertain, unmapped, skipped, failed).
  async function goCompile(): Promise<void> {
    container!.innerHTML = `
      <header class="header">
        <span class="h-icon">${icon('wand', { size: 20 })}</span>
        <div class="h-text">
          <div class="h-title">Analisi in corso</div>
          <div class="h-subtitle">Sto leggendo i campi del form…</div>
        </div>
      </header>
      <div class="loading-block">
        <span class="spinner"></span>
        <span>L'AI sta proponendo i mapping…</span>
      </div>
    `;
    const startRes = (await chrome.runtime.sendMessage({
      type: 'compile/start',
    } as StartCompileRequest)) as StartCompileResponse;
    if (!startRes.ok) {
      showError('Errore', startRes.error);
      return;
    }

    const proposal = startRes.proposal as Mapping[];
    const fields = startRes.fields as {
      id: string;
      labels: { text: string; source: string }[];
      attributes: { name?: string };
    }[];

    const fillable = proposal.filter(
      (m) =>
        m.status !== 'skipped' &&
        (m.canonicalKey !== null || m.literalValue !== undefined),
    );

    container!.innerHTML = `
      <header class="header">
        <span class="h-icon">${icon('wand', { size: 20 })}</span>
        <div class="h-text">
          <div class="h-title">Compilazione in corso</div>
          <div class="h-subtitle">Scrivo ${fillable.length} campi…</div>
        </div>
      </header>
      <div class="loading-block">
        <span class="spinner"></span>
        <span>Quasi pronto…</span>
      </div>
    `;

    const confirmRes = (await chrome.runtime.sendMessage({
      type: 'compile/confirm',
      mappings: fillable,
    } as ConfirmCompileRequest)) as ConfirmCompileResponse;
    if (!confirmRes.ok) {
      showError('Errore in fase di compilazione', confirmRes.error);
      return;
    }

    const view = createResultView(
      fields,
      proposal as never,
      confirmRes.results,
      startRes.tokensUsed,
      goMain,
    );
    await view.render(container!);
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const views: Record<ViewId, () => ViewRenderer> = {
    'setup-wizard': () => createSetupWizard(routeByState),
    main: () =>
      createMainView(goSettings, reImport, goCompile, routeByState),
    settings: () => createSettingsView(goMain),
  };

  router = createRouter(container, views);

  // If the user just compiled a form and then closed the popup (e.g. clicked
  // away to verify the result), restore the result view instead of jumping
  // back to main. Stays available across popup re-opens until user dismisses
  // it ("Fatto" / "Pulisci marker") or starts a new compile.
  const restored = (await chrome.runtime.sendMessage({
    type: 'compile/restoreSession',
  } as RestoreCompileSessionRequest)) as RestoreCompileSessionResponse;
  if (restored?.session) {
    const view = createResultView(
      restored.session.fields as never,
      restored.session.proposal as never,
      restored.session.results,
      restored.session.tokensUsed,
      goMain,
    );
    await view.render(container);
    return;
  }

  await routeByState();
}

void boot();
