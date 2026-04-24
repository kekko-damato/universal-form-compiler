import type { ViewRenderer } from './router';
import type {
  GetSettingsRequest,
  GetSettingsResponse,
  SaveSettingsRequest,
  SaveSettingsResponse,
} from '@/types/messages';

const MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (economico, default)' },
  { value: 'gpt-4o', label: 'GPT-4o (qualità alta)' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1 (massima qualità)' },
] as const;

export function createSettingsView(onBack: () => Promise<void>): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      const current = (await chrome.runtime.sendMessage({
        type: 'settings/get',
      } as GetSettingsRequest)) as GetSettingsResponse;

      container.innerHTML = `
        <h1>Impostazioni</h1>

        <div class="form-group">
          <label for="apikey">OpenAI API Key</label>
          <input id="apikey" type="password" placeholder="sk-..." value="${escapeHtml(current.apiKey ?? '')}" />
          <p class="muted">La chiave è salvata in chiaro in chrome.storage.local.</p>
        </div>

        <div class="form-group">
          <label for="model">Modello</label>
          <select id="model">
            ${MODELS.map(
              (m) =>
                `<option value="${m.value}" ${m.value === current.model ? 'selected' : ''}>${m.label}</option>`,
            ).join('')}
          </select>
        </div>

        <div id="err" class="error" hidden></div>
        <div id="ok" class="muted" hidden>Salvato.</div>

        <div class="actions">
          <button id="save-btn">Salva</button>
          <button id="back-btn" class="secondary">Indietro</button>
        </div>
      `;

      const apiKey = container.querySelector<HTMLInputElement>('#apikey')!;
      const model = container.querySelector<HTMLSelectElement>('#model')!;
      const saveBtn = container.querySelector<HTMLButtonElement>('#save-btn')!;
      const backBtn = container.querySelector<HTMLButtonElement>('#back-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;
      const ok = container.querySelector<HTMLDivElement>('#ok')!;

      saveBtn.addEventListener('click', async () => {
        err.hidden = true;
        ok.hidden = true;
        saveBtn.disabled = true;
        const res = (await chrome.runtime.sendMessage({
          type: 'settings/save',
          apiKey: apiKey.value.trim(),
          model: model.value,
        } as SaveSettingsRequest)) as SaveSettingsResponse;
        if (res.ok) {
          ok.hidden = false;
        } else {
          err.hidden = false;
          err.textContent = res.error;
        }
        saveBtn.disabled = false;
      });

      backBtn.addEventListener('click', async () => {
        await onBack();
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
