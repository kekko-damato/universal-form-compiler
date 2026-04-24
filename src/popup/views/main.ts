import type { ViewRenderer } from './router';
import type {
  GetCanonicalDataRequest,
  GetCanonicalDataResponse,
} from '@/types/messages';

export function createMainView(
  onLock: () => Promise<void>,
  onSettings: () => Promise<void>,
  onReimport: () => Promise<void>,
): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      const canonical = (await chrome.runtime.sendMessage({
        type: 'canonical/get',
      } as GetCanonicalDataRequest)) as GetCanonicalDataResponse;
      const hasData = canonical.data !== null;

      container.innerHTML = `
        <h1>Universal Form Compiler</h1>
        <p class="muted">
          ${hasData ? 'Vault sbloccato e dati pronti.' : 'Vault sbloccato, ma nessun dato importato.'}
        </p>
        <p class="muted">
          La compilazione dei form arriva in Fase 1c.
        </p>

        <div class="actions">
          <button id="reimport-btn" class="secondary">
            ${hasData ? 'Re-importa dati' : 'Importa dati'}
          </button>
          <button id="settings-btn" class="secondary">Impostazioni</button>
        </div>
        <div class="actions" style="margin-top:8px">
          <button id="lock-btn" class="secondary">Lock vault</button>
        </div>
      `;

      container
        .querySelector<HTMLButtonElement>('#lock-btn')!
        .addEventListener('click', async () => {
          await onLock();
        });
      container
        .querySelector<HTMLButtonElement>('#settings-btn')!
        .addEventListener('click', async () => {
          await onSettings();
        });
      container
        .querySelector<HTMLButtonElement>('#reimport-btn')!
        .addEventListener('click', async () => {
          await onReimport();
        });
    },
  };
}
