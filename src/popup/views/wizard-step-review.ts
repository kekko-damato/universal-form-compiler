import type { ViewRenderer } from './router';
import type {
  SaveCanonicalDataRequest,
  SaveCanonicalDataResponse,
} from '@/types/messages';

export function createWizardReviewStep(
  data: unknown,
  onDone: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Step 2 di 2 — Rivedi i dati</h1>
        <p class="muted">
          Controlla il JSON normalizzato. Puoi modificarlo prima di salvare.
        </p>

        <div class="form-group">
          <label for="json">Dati canonici</label>
          <textarea id="json" rows="14" style="width:100%;font-family:monospace;font-size:12px;background:var(--input-bg);color:var(--fg);border:1px solid var(--input-border);border-radius:6px;padding:8px">${escapeHtml(JSON.stringify(data, null, 2))}</textarea>
        </div>

        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="save-btn">Salva e finisci</button>
        </div>
      `;
      const ta = container.querySelector<HTMLTextAreaElement>('#json')!;
      const btn = container.querySelector<HTMLButtonElement>('#save-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      btn.addEventListener('click', async () => {
        err.hidden = true;
        btn.disabled = true;
        let parsed: unknown;
        try {
          parsed = JSON.parse(ta.value);
        } catch (e) {
          err.hidden = false;
          err.textContent = `JSON non valido: ${e instanceof Error ? e.message : String(e)}`;
          btn.disabled = false;
          return;
        }
        const res = (await chrome.runtime.sendMessage({
          type: 'canonical/save',
          data: parsed,
        } as SaveCanonicalDataRequest)) as SaveCanonicalDataResponse;
        if (res.ok) {
          await onDone();
        } else {
          err.hidden = false;
          err.textContent = res.error;
          btn.disabled = false;
        }
      });
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
