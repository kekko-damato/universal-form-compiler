import type { ViewRenderer } from './router';
import { icon } from '../icons';
import { stepperHtml } from './stepper';

export interface ReviewStepOpts {
  data: unknown;
  onSave: (parsedData: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: () => Promise<void>;
  step?: 1 | 2;
  subtitle?: string;
}

export function createWizardReviewStep(opts: ReviewStepOpts): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <header class="header">
          <span class="h-icon">${icon('zap', { size: 20 })}</span>
          <div class="h-text">
            <div class="h-title">Setup</div>
            <div class="h-subtitle">${escapeHtml(opts.subtitle ?? 'Rivedi i dati estratti')}</div>
          </div>
        </header>

        ${stepperHtml(opts.step ?? 2)}

        <div class="card">
          <p class="muted">
            Controlla il JSON normalizzato. Puoi modificarlo prima di salvare.
          </p>
        </div>

        <section class="section">
          <h2>${icon('file', { size: 12 })} Dati canonici</h2>
          <div class="field">
            <textarea id="json" rows="14">${escapeHtml(JSON.stringify(opts.data, null, 2))}</textarea>
          </div>
        </section>

        <div id="err" class="error" hidden></div>

        <div class="footer-actions">
          <button id="save-btn">
            ${icon('save', { size: 14 })} Salva e finisci
          </button>
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
          err.innerHTML = `${icon('alert', { size: 14 })} <span>JSON non valido: ${escapeHtml(e instanceof Error ? e.message : String(e))}</span>`;
          btn.disabled = false;
          return;
        }
        const res = await opts.onSave(parsed);
        if (res.ok) {
          await opts.onDone();
        } else {
          err.hidden = false;
          err.innerHTML = `${icon('alert', { size: 14 })} <span>${escapeHtml(res.error)}</span>`;
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
