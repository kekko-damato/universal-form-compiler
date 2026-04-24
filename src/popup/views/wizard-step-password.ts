import type { ViewRenderer } from './router';
import type { CreateVaultRequest, CreateVaultResponse } from '@/types/messages';

const MIN_LEN = 12;

export function createWizardPasswordStep(
  onDone: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Step 1 di 3 — Master password</h1>
        <p class="muted">
          Questa password cifra tutti i tuoi dati. Non può essere recuperata.
        </p>

        <div class="form-group">
          <label for="pw1">Password (min ${MIN_LEN} caratteri)</label>
          <input id="pw1" type="password" autocomplete="new-password" />
        </div>
        <div class="form-group">
          <label for="pw2">Ripeti password</label>
          <input id="pw2" type="password" autocomplete="new-password" />
        </div>
        <div id="err" class="error" hidden></div>
        <div class="actions">
          <button id="create-btn" disabled>Continua</button>
        </div>
      `;
      const pw1 = container.querySelector<HTMLInputElement>('#pw1')!;
      const pw2 = container.querySelector<HTMLInputElement>('#pw2')!;
      const btn = container.querySelector<HTMLButtonElement>('#create-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      const validate = (): string | null => {
        if (pw1.value.length < MIN_LEN) return `Almeno ${MIN_LEN} caratteri`;
        if (pw1.value !== pw2.value) return 'Le password non coincidono';
        return null;
      };
      const update = () => {
        const problem = validate();
        btn.disabled = problem !== null;
        err.hidden = problem === null;
        err.textContent = problem ?? '';
      };
      pw1.addEventListener('input', update);
      pw2.addEventListener('input', update);

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = (await chrome.runtime.sendMessage({
          type: 'vault/create',
          masterPassword: pw1.value,
        } as CreateVaultRequest)) as CreateVaultResponse;
        if (res.ok) {
          await onDone();
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
