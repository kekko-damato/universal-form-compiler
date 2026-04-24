import { createRouter, type Router, type ViewRenderer, type ViewId } from './views/router';
import { createSetupWizard } from './views/setup-wizard';
import { createMainView } from './views/main';
import { createSettingsView } from './views/settings';
import { createWizardImportStep } from './views/wizard-step-import';
import { createWizardReviewStep } from './views/wizard-step-review';
import { createDryRunView } from './views/dry-run';
import type {
  GetVaultStateRequest,
  GetVaultStateResponse,
  StartCompileRequest,
  StartCompileResponse,
} from '@/types/messages';

async function getVaultState(): Promise<GetVaultStateResponse['state']> {
  const res = (await chrome.runtime.sendMessage({
    type: 'vault/getState',
  } as GetVaultStateRequest)) as GetVaultStateResponse;
  return res.state;
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('missing #app');

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
    // Mini-wizard for re-import after first setup: import step → review step
    const host = container!;
    let imported: unknown = null;

    const importStep = createWizardImportStep(async (data) => {
      imported = data;
      const reviewStep = createWizardReviewStep(imported, goMain);
      await reviewStep.render(host);
    });
    await importStep.render(host);
  }

  async function goCompile(): Promise<void> {
    container!.innerHTML = '<p class="muted">Analizzo il form…</p>';
    const res = (await chrome.runtime.sendMessage({
      type: 'compile/start',
    } as StartCompileRequest)) as StartCompileResponse;
    if (!res.ok) {
      container!.innerHTML = `
        <h1>Errore</h1>
        <p class="error">${escapeHtml(res.error)}</p>
        <div class="actions">
          <button id="back-btn" class="secondary">Indietro</button>
        </div>
      `;
      const back = container!.querySelector<HTMLButtonElement>('#back-btn');
      back?.addEventListener('click', () => {
        void routeByState();
      });
      return;
    }
    const view = createDryRunView(
      res.fields as {
        id: string;
        labels: { text: string; source: string }[];
        attributes: { name?: string };
      }[],
      res.proposal as never,
      res.tokensUsed,
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
    'dry-run': () => ({
      render: () => {
        /* dry-run is rendered imperatively by goCompile */
      },
    }),
  };

  router = createRouter(container, views);
  await routeByState();
}

void boot();
