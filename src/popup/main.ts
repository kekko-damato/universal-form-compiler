import { createRouter, type Router, type ViewRenderer, type ViewId } from './views/router';
import { createSetupWizard } from './views/setup-wizard';
import { createUnlockView } from './views/unlock';
import { createMainView } from './views/main';
import { createSettingsView } from './views/settings';
import { createWizardImportStep } from './views/wizard-step-import';
import { createWizardReviewStep } from './views/wizard-step-review';
import type {
  GetVaultStateRequest,
  GetVaultStateResponse,
  LockVaultRequest,
  LockVaultResponse,
} from '@/types/messages';

async function getVaultState(): Promise<GetVaultStateResponse['state']> {
  const res = (await chrome.runtime.sendMessage({
    type: 'vault/getState',
  } as GetVaultStateRequest)) as GetVaultStateResponse;
  return res.state;
}

async function lockVault(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({
    type: 'vault/lock',
  } as LockVaultRequest)) as LockVaultResponse;
  void res;
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('missing #app');

  let router: Router;

  async function routeByState(): Promise<void> {
    const state = await getVaultState();
    switch (state.kind) {
      case 'no_vault':
        await router.show('setup-wizard');
        return;
      case 'locked':
        await router.show('unlock');
        return;
      case 'unlocked':
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

  const views: Record<ViewId, () => ViewRenderer> = {
    'setup-wizard': () => createSetupWizard(routeByState),
    unlock: () => createUnlockView(routeByState),
    main: () =>
      createMainView(
        async () => {
          await lockVault();
          await routeByState();
        },
        goSettings,
        reImport,
      ),
    settings: () => createSettingsView(goMain),
  };

  router = createRouter(container, views);
  await routeByState();
}

void boot();
