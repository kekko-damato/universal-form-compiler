import type { ViewRenderer } from './router';
import type { CreateVaultRequest, CreateVaultResponse } from '@/types/messages';

const MIN_LEN = 12;

export function createSetupPasswordView(
  onCreated: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Crea il tuo vault</h1>
        <p class="muted">
          La master password cifra i tuoi dati in locale. Non può essere
          recuperata — se la dimentichi, i dati sono persi.
        </p>

        <div class="form-group">
          <label for="pw1">Master password (min ${MIN_LEN} caratteri)</label>
          <input id="pw1" type="password" autocomplete="new-password" />
        </div>

        <div class="form-group">
          <label for="pw2">Ripeti master password</label>
          <input id="pw2" type="password" autocomplete="new-password" />
        </div>

        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="create-btn" disabled>Crea vault</button>
        </div>
      `;

      const pw1 = container.querySelector<HTMLInputElement>('#pw1')!;
      const pw2 = container.querySelector<HTMLInputElement>('#pw2')!;
      const btn = container.querySelector<HTMLButtonElement>('#create-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      function validate(): string | null {
        if (pw1.value.length < MIN_LEN) {
          return `Almeno ${MIN_LEN} caratteri`;
        }
        if (pw1.value !== pw2.value) {
          return 'Le password non coincidono';
        }
        return null;
      }

      function update(): void {
        const problem = validate();
        btn.disabled = problem !== null;
        err.hidden = problem === null;
        err.textContent = problem ?? '';
      }

      pw1.addEventListener('input', update);
      pw2.addEventListener('input', update);

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const req: CreateVaultRequest = {
          type: 'vault/create',
          masterPassword: pw1.value,
        };
        const res = (await chrome.runtime.sendMessage(req)) as CreateVaultResponse;
        if (res.ok) {
          await onCreated();
        } else {
          err.hidden = false;
          err.textContent = res.error;
          btn.disabled = false;
        }
      });

      pw1.focus();
    },
  };
}
