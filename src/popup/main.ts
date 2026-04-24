import { createRouter, type Router, type ViewRenderer } from './views/router';
import { createSetupPasswordView } from './views/setup-password';
import { createUnlockView } from './views/unlock';
import { createMainView } from './views/main';
import type {
  GetVaultStateRequest,
  GetVaultStateResponse,
  LockVaultRequest,
  LockVaultResponse,
} from '@/types/messages';

async function getVaultState(): Promise<GetVaultStateResponse['state']> {
  const req: GetVaultStateRequest = { type: 'vault/getState' };
  const res = (await chrome.runtime.sendMessage(req)) as GetVaultStateResponse;
  return res.state;
}

async function lockVault(): Promise<void> {
  const req: LockVaultRequest = { type: 'vault/lock' };
  await chrome.runtime.sendMessage<LockVaultRequest, LockVaultResponse>(req);
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('missing #app');

  let router: Router;

  async function routeByState(): Promise<void> {
    const state = await getVaultState();
    switch (state.kind) {
      case 'no_vault':
        await router.show('setup-password');
        return;
      case 'locked':
        await router.show('unlock');
        return;
      case 'unlocked':
        await router.show('main');
        return;
    }
  }

  const views: Record<string, () => ViewRenderer> = {
    'setup-password': () => createSetupPasswordView(routeByState),
    unlock: () => createUnlockView(routeByState),
    main: () =>
      createMainView(async () => {
        await lockVault();
        await routeByState();
      }),
  };

  router = createRouter(container, views as never);
  await routeByState();
}

void boot();
