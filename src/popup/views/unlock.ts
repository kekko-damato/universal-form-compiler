import type { ViewRenderer } from './router';
import type { UnlockVaultRequest, UnlockVaultResponse } from '@/types/messages';

export function createUnlockView(
  onUnlocked: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Vault bloccato</h1>
        <p class="muted">Inserisci la master password per sbloccare.</p>

        <div class="form-group">
          <label for="pw">Master password</label>
          <input id="pw" type="password" autocomplete="current-password" />
        </div>

        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="unlock-btn">Sblocca</button>
        </div>
      `;

      const pw = container.querySelector<HTMLInputElement>('#pw')!;
      const btn = container.querySelector<HTMLButtonElement>('#unlock-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      async function submit(): Promise<void> {
        if (pw.value.length === 0) return;
        btn.disabled = true;
        err.hidden = true;

        const req: UnlockVaultRequest = {
          type: 'vault/unlock',
          masterPassword: pw.value,
        };
        const res = (await chrome.runtime.sendMessage(req)) as UnlockVaultResponse;
        if (res.ok) {
          await onUnlocked();
        } else {
          err.hidden = false;
          let msg = res.error;
          if (typeof res.attemptsRemaining === 'number' && res.attemptsRemaining > 0) {
            msg += ` (${res.attemptsRemaining} tentativi rimasti)`;
          }
          if (typeof res.lockoutMs === 'number') {
            msg += ` — blocco attivo per ${Math.ceil(res.lockoutMs / 1000)}s`;
          }
          err.textContent = msg;
          pw.value = '';
          pw.focus();
          btn.disabled = false;
        }
      }

      btn.addEventListener('click', () => {
        void submit();
      });
      pw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void submit();
      });

      pw.focus();
    },
  };
}
