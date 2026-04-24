import type { ViewRenderer } from './router';
import type {
  SaveSettingsRequest,
  SaveSettingsResponse,
  ImportFileRequest,
  ImportFileResponse,
} from '@/types/messages';
import { toBase64 } from '@/lib/crypto';

export function createWizardImportStep(
  onImported: (canonicalData: unknown) => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Step 1 di 2 — Importa dati</h1>
        <p class="muted">
          Carica un file (DOCX, CSV, YAML) con i tuoi dati. L'AI li
          normalizzerà nello schema interno.
        </p>

        <div class="form-group">
          <label for="apikey">OpenAI API Key</label>
          <input id="apikey" type="password" placeholder="sk-..." />
          <p class="muted">Salvata in chiaro in chrome.storage.local.</p>
        </div>

        <div class="form-group">
          <label for="model">Modello</label>
          <select id="model">
            <option value="gpt-4o-mini" selected>GPT-4o mini (default)</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="gpt-4.1-mini">GPT-4.1 mini</option>
            <option value="gpt-4.1">GPT-4.1</option>
          </select>
        </div>

        <div class="form-group">
          <label for="file">File</label>
          <input id="file" type="file" accept=".docx,.csv,.yaml,.yml,.txt" />
        </div>

        <div id="status" class="muted" hidden></div>
        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="go-btn" disabled>Importa</button>
        </div>
      `;
      const apiKey = container.querySelector<HTMLInputElement>('#apikey')!;
      const model = container.querySelector<HTMLSelectElement>('#model')!;
      const file = container.querySelector<HTMLInputElement>('#file')!;
      const btn = container.querySelector<HTMLButtonElement>('#go-btn')!;
      const status = container.querySelector<HTMLDivElement>('#status')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      const updateBtn = () => {
        btn.disabled =
          apiKey.value.trim().length === 0 || file.files?.length === 0;
      };
      apiKey.addEventListener('input', updateBtn);
      file.addEventListener('change', updateBtn);

      btn.addEventListener('click', async () => {
        err.hidden = true;
        btn.disabled = true;
        status.hidden = false;
        status.textContent = 'Salvo le impostazioni…';

        const saveRes = (await chrome.runtime.sendMessage({
          type: 'settings/save',
          apiKey: apiKey.value.trim(),
          model: model.value,
        } as SaveSettingsRequest)) as SaveSettingsResponse;
        if (!saveRes.ok) {
          err.hidden = false;
          err.textContent = saveRes.error;
          status.hidden = true;
          btn.disabled = false;
          return;
        }

        status.textContent = 'Leggo il file…';
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

        status.textContent = 'Chiamo l\'AI per normalizzare i dati…';
        const res = (await chrome.runtime.sendMessage(req)) as ImportFileResponse;
        if (res.ok) {
          status.hidden = true;
          await onImported(res.data);
        } else {
          err.hidden = true;
          err.hidden = false;
          let msg = res.error;
          if (res.validationErrors?.length) {
            msg +=
              '\n' +
              res.validationErrors
                .map((e) => `• ${e.path || '(root)'}: ${e.message}`)
                .join('\n');
          }
          err.textContent = msg;
          status.hidden = true;
          btn.disabled = false;
        }
      });

      apiKey.focus();
    },
  };
}
