import type { ViewRenderer } from './router';
import type {
  GetCanonicalDataRequest,
  GetCanonicalDataResponse,
  ResetVaultRequest,
  ResetVaultResponse,
} from '@/types/messages';

export function createMainView(
  onSettings: () => Promise<void>,
  onReimport: () => Promise<void>,
  onCompile: () => Promise<void>,
  onReset: () => Promise<void>,
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
          ${hasData ? 'Dati pronti.' : 'Nessun dato importato.'}
        </p>

        <div class="actions">
          <button id="compile-btn" ${!hasData ? 'disabled' : ''}>Compila questo form</button>
        </div>

        <div class="actions" style="margin-top:8px">
          <button id="reimport-btn" class="secondary">
            ${hasData ? 'Re-importa dati' : 'Importa dati'}
          </button>
          <button id="settings-btn" class="secondary">Impostazioni</button>
        </div>
        <div class="actions" style="margin-top:8px">
          <button id="reset-btn" class="secondary">Cancella tutto</button>
        </div>
      `;

      container
        .querySelector<HTMLButtonElement>('#compile-btn')!
        .addEventListener('click', async () => {
          await onCompile();
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
      container
        .querySelector<HTMLButtonElement>('#reset-btn')!
        .addEventListener('click', async () => {
          const ok = confirm(
            'Cancellare tutti i dati salvati (API key + dati canonici)? ' +
              "L'operazione non è reversibile.",
          );
          if (!ok) return;
          const res = (await chrome.runtime.sendMessage({
            type: 'vault/reset',
          } as ResetVaultRequest)) as ResetVaultResponse;
          if (!res.ok) {
            alert(`Errore: ${res.error}`);
            return;
          }
          await onReset();
        });
    },
  };
}
