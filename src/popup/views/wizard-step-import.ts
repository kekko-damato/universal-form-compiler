import type { ViewRenderer } from './router';
import { icon } from '../icons';
import { stepperHtml } from './stepper';
import type {
  SaveSettingsRequest,
  SaveSettingsResponse,
  ImportFileRequest,
  ImportFileResponse,
  GetSettingsRequest,
  GetSettingsResponse,
} from '@/types/messages';
import { toBase64 } from '@/lib/crypto';

export function createWizardImportStep(
  onImported: (canonicalData: unknown) => Promise<void>,
): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      const current = (await chrome.runtime.sendMessage({
        type: 'settings/get',
      } as GetSettingsRequest)) as GetSettingsResponse;

      // The AI section (api key + model) is needed only on the very first
      // setup. Once the user has saved an api key, those fields live in
      // Settings → AI; showing them here too would be redundant noise.
      const needsAiSetup = !current.apiKey || current.apiKey.trim() === '';

      container.innerHTML = `
        <header class="header">
          <span class="h-icon">${icon('zap', { size: 20 })}</span>
          <div class="h-text">
            <div class="h-title">${needsAiSetup ? 'Setup' : 'Nuovo documento'}</div>
            <div class="h-subtitle">${
              needsAiSetup
                ? 'Configura e importa i tuoi dati'
                : 'Importa un nuovo documento'
            }</div>
          </div>
        </header>

        ${stepperHtml(1)}

        <div class="card">
          <p class="muted">
            Carica un file (DOCX, CSV, YAML) con i tuoi dati. L'AI li
            normalizzerà nello schema interno.
          </p>
        </div>

        ${
          needsAiSetup
            ? `
          <section class="section">
            <h2>${icon('cpu', { size: 12 })} AI</h2>
            <div class="field">
              <label for="apikey">${icon('key', { size: 12 })} API Key</label>
              <input id="apikey" type="password" placeholder="sk-..." />
              <div class="field-hint">Salvata in chiaro in chrome.storage.local</div>
            </div>
            <div class="field">
              <label for="model">${icon('cpu', { size: 12 })} Modello</label>
              <select id="model">
                <option value="gpt-4o-mini" selected>GPT-4o mini · economico</option>
                <option value="gpt-4o">GPT-4o · qualità alta</option>
                <option value="gpt-4.1-mini">GPT-4.1 mini</option>
                <option value="gpt-4.1">GPT-4.1 · massima qualità</option>
              </select>
            </div>
          </section>
        `
            : ''
        }

        <section class="section">
          <h2>${icon('file', { size: 12 })} File</h2>
          <div class="field">
            <input id="file" type="file" accept=".docx,.csv,.yaml,.yml,.txt" />
          </div>
        </section>

        <div id="status" class="loading-block" hidden></div>
        <div id="err" class="error" hidden></div>

        <div class="footer-actions">
          <button id="go-btn" disabled>
            ${icon('upload', { size: 16 })} Importa
          </button>
        </div>
      `;
      const apiKey = container.querySelector<HTMLInputElement>('#apikey');
      const model = container.querySelector<HTMLSelectElement>('#model');
      const file = container.querySelector<HTMLInputElement>('#file')!;
      const btn = container.querySelector<HTMLButtonElement>('#go-btn')!;
      const status = container.querySelector<HTMLDivElement>('#status')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      const updateBtn = (): void => {
        const apiOk = needsAiSetup
          ? (apiKey?.value.trim().length ?? 0) > 0
          : true;
        const fileOk = (file.files?.length ?? 0) > 0;
        btn.disabled = !(apiOk && fileOk);
      };
      apiKey?.addEventListener('input', updateBtn);
      file.addEventListener('change', updateBtn);
      updateBtn();

      const setStatus = (msg: string): void => {
        status.hidden = false;
        status.innerHTML = `<span class="spinner"></span><span>${escapeHtml(msg)}</span>`;
      };

      btn.addEventListener('click', async () => {
        err.hidden = true;
        btn.disabled = true;

        if (needsAiSetup) {
          setStatus('Salvo le impostazioni…');
          const saveRes = (await chrome.runtime.sendMessage({
            type: 'settings/save',
            apiKey: apiKey!.value.trim(),
            model: model!.value,
            theme: current.theme,
          } as SaveSettingsRequest)) as SaveSettingsResponse;
          if (!saveRes.ok) {
            err.hidden = false;
            err.innerHTML = `${icon('alert', { size: 14 })} <span>${escapeHtml(saveRes.error)}</span>`;
            status.hidden = true;
            btn.disabled = false;
            return;
          }
        }

        setStatus('Leggo il file…');
        const f = file.files![0]!;
        const req: ImportFileRequest = {
          type: 'import/run',
          filename: f.name,
        };
        if (f.name.toLowerCase().endsWith('.docx')) {
          const buf = new Uint8Array(await f.arrayBuffer());
          req.bufferBase64 = toBase64(buf);
        } else {
          req.text = await f.text();
        }

        setStatus("Chiamo l'AI per normalizzare i dati…");
        const res = (await chrome.runtime.sendMessage(req)) as ImportFileResponse;
        if (res.ok) {
          status.hidden = true;
          await onImported(res.data);
        } else {
          err.hidden = false;
          let msg = res.error;
          if (res.validationErrors?.length) {
            msg +=
              '\n' +
              res.validationErrors
                .map((e) => `• ${e.path || '(root)'}: ${e.message}`)
                .join('\n');
          }
          err.innerHTML = `${icon('alert', { size: 14 })} <span>${escapeHtml(msg)}</span>`;
          status.hidden = true;
          btn.disabled = false;
        }
      });

      if (needsAiSetup) apiKey?.focus();
      else file.focus();
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
