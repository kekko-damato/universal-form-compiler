import type { ViewRenderer } from './router';
import { icon, type IconName } from '../icons';
import { applyTheme } from '../theme';
import { createWizardImportStep } from './wizard-step-import';
import { createWizardReviewStep } from './wizard-step-review';
import type {
  GetSettingsRequest,
  GetSettingsResponse,
  SaveSettingsRequest,
  SaveSettingsResponse,
  ListDocumentsRequest,
  ListDocumentsResponse,
  CreateDocumentRequest,
  CreateDocumentResponse,
  UpdateDocumentRequest,
  UpdateDocumentResponse,
  DeleteDocumentRequest,
  DeleteDocumentResponse,
  SetActiveDocumentRequest,
  SetActiveDocumentResponse,
  ResetVaultRequest,
  ResetVaultResponse,
  Theme,
  DocumentSummary,
} from '@/types/messages';

const MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini · economico' },
  { value: 'gpt-4o', label: 'GPT-4o · qualità alta' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1 · massima qualità' },
] as const;

const THEME_TILES: { value: Theme; label: string; iconName: IconName }[] = [
  { value: 'light', label: 'Chiaro', iconName: 'sun' },
  { value: 'dark', label: 'Scuro', iconName: 'moon' },
  { value: 'system', label: 'Sistema', iconName: 'monitor' },
];

export function createSettingsView(onBack: () => Promise<void>): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      await renderList(container, onBack);
    },
  };
}

async function renderList(
  container: HTMLElement,
  onBack: () => Promise<void>,
): Promise<void> {
  const [settings, docsRes] = await Promise.all([
    chrome.runtime.sendMessage({
      type: 'settings/get',
    } as GetSettingsRequest) as Promise<GetSettingsResponse>,
    chrome.runtime.sendMessage({
      type: 'documents/list',
    } as ListDocumentsRequest) as Promise<ListDocumentsResponse>,
  ]);

  container.innerHTML = `
    <header class="header">
      <button id="back-btn" class="h-back" title="Indietro">
        ${icon('arrowLeft', { size: 18 })}
      </button>
      <div class="h-text">
        <div class="h-title">Impostazioni</div>
        <div class="h-subtitle">Documenti, AI e tema</div>
      </div>
    </header>

    <section class="section">
      <h2>${icon('file', { size: 12 })} Documenti</h2>
      <div id="docs-list" class="docs-list"></div>
      <div class="footer-actions">
        <button id="new-doc-btn" class="secondary">
          ${icon('plus', { size: 16 })} Nuovo documento
        </button>
      </div>
    </section>

    <section class="section">
      <h2>${icon('cpu', { size: 12 })} AI</h2>
      <div class="field">
        <label for="apikey">${icon('key', { size: 12 })} API Key</label>
        <input id="apikey" type="password" placeholder="sk-..." value="${escapeHtml(settings.apiKey ?? '')}" />
        <div class="field-hint">Salvata in chiaro in chrome.storage.local</div>
      </div>
      <div class="field">
        <label for="model">${icon('cpu', { size: 12 })} Modello</label>
        <select id="model">
          ${MODELS.map(
            (m) =>
              `<option value="${m.value}" ${m.value === settings.model ? 'selected' : ''}>${m.label}</option>`,
          ).join('')}
        </select>
      </div>
    </section>

    <section class="section">
      <h2>${icon('sparkles', { size: 12 })} Tema</h2>
      <div class="theme-grid" role="radiogroup">
        ${THEME_TILES.map(
          (t) => `
          <label class="theme-tile ${settings.theme === t.value ? 'is-active' : ''}">
            <input type="radio" name="theme" value="${t.value}" ${
              settings.theme === t.value ? 'checked' : ''
            } />
            <span class="theme-swatch theme-swatch-${t.value}"></span>
            <span class="theme-tile-label">
              ${icon(t.iconName, { size: 13 })} ${t.label}
            </span>
          </label>
        `,
        ).join('')}
      </div>
    </section>

    <div id="save-feedback"></div>

    <div class="footer-actions">
      <button id="save-btn">
        ${icon('save', { size: 14 })} Salva impostazioni
      </button>
    </div>

    <section class="section section-danger">
      <h2 style="color:var(--error)">${icon('alert', { size: 12 })} Zona pericolo</h2>
      <p class="muted">Cancella tutti i documenti, l'API key e le impostazioni. Operazione irreversibile.</p>
      <div class="footer-actions">
        <button id="reset-btn" class="danger">
          ${icon('trash', { size: 14 })} Cancella tutto
        </button>
      </div>
    </section>
  `;

  renderDocs(container, docsRes.documents, docsRes.activeId, onBack);

  container.querySelector<HTMLButtonElement>('#back-btn')!.addEventListener(
    'click',
    () => void onBack(),
  );

  container.querySelector<HTMLButtonElement>('#new-doc-btn')!.addEventListener(
    'click',
    () => {
      void renderImport(container, { mode: 'create' }, onBack);
    },
  );

  container
    .querySelectorAll<HTMLInputElement>('input[name="theme"]')
    .forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          applyTheme(r.value as Theme);
          container.querySelectorAll('.theme-tile').forEach((el) => {
            const input = el.querySelector('input') as HTMLInputElement;
            el.classList.toggle('is-active', input.checked);
          });
        }
      });
    });

  const apiKeyEl = container.querySelector<HTMLInputElement>('#apikey')!;
  const modelEl = container.querySelector<HTMLSelectElement>('#model')!;
  const saveBtn = container.querySelector<HTMLButtonElement>('#save-btn')!;
  const feedback = container.querySelector<HTMLDivElement>('#save-feedback')!;

  saveBtn.addEventListener('click', async () => {
    feedback.innerHTML = '';
    saveBtn.disabled = true;
    const themeChecked = container.querySelector<HTMLInputElement>(
      'input[name="theme"]:checked',
    );
    const theme = (themeChecked?.value as Theme | undefined) ?? 'system';
    const res = (await chrome.runtime.sendMessage({
      type: 'settings/save',
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value,
      theme,
    } as SaveSettingsRequest)) as SaveSettingsResponse;
    if (res.ok) {
      applyTheme(theme);
      feedback.innerHTML = `<div class="success-msg">${icon('check', { size: 14 })} Impostazioni salvate</div>`;
    } else {
      feedback.innerHTML = `<div class="error">${icon('alert', { size: 14 })} <span>${escapeHtml(res.error)}</span></div>`;
    }
    saveBtn.disabled = false;
  });

  container.querySelector<HTMLButtonElement>('#reset-btn')!.addEventListener(
    'click',
    async () => {
      const ok = confirm(
        'Cancellare TUTTO (documenti, API key, impostazioni)? Operazione irreversibile.',
      );
      if (!ok) return;
      const res = (await chrome.runtime.sendMessage({
        type: 'vault/reset',
      } as ResetVaultRequest)) as ResetVaultResponse;
      if (!res.ok) {
        alert(`Errore: ${res.error}`);
        return;
      }
      await onBack();
    },
  );
}

function renderDocs(
  container: HTMLElement,
  docs: DocumentSummary[],
  activeId: string | null,
  onBack: () => Promise<void>,
): void {
  const list = container.querySelector<HTMLDivElement>('#docs-list')!;
  if (docs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        ${icon('file', { size: 24 })}
        <div>Nessun documento ancora caricato</div>
      </div>
    `;
    return;
  }
  list.innerHTML = docs
    .map(
      (d) => `
        <div class="doc-row ${d.id === activeId ? 'is-active' : ''}" data-id="${d.id}">
          <span class="doc-row-dot" title="${d.id === activeId ? 'Documento attivo' : ''}"></span>
          <div class="doc-row-body">
            <input class="doc-name" type="text" value="${escapeHtml(d.name)}" data-id="${d.id}" />
            <div class="doc-meta">
              ${escapeHtml(d.preview.fullName || '—')}${d.preview.email ? ` · ${escapeHtml(d.preview.email)}` : ''}
            </div>
          </div>
          <div class="doc-row-actions">
            ${
              d.id !== activeId
                ? `<button class="icon-btn doc-activate" data-id="${d.id}" title="Imposta come attivo">${icon('check', { size: 16 })}</button>`
                : ''
            }
            <button class="icon-btn doc-reimport" data-id="${d.id}" title="Re-importa documento">${icon('refresh', { size: 16 })}</button>
            <button class="icon-btn danger doc-delete" data-id="${d.id}" title="Elimina">${icon('trash', { size: 16 })}</button>
          </div>
        </div>
      `,
    )
    .join('');

  list.querySelectorAll<HTMLInputElement>('.doc-name').forEach((input) => {
    let prev = input.value;
    input.addEventListener('focus', () => {
      prev = input.value;
    });
    input.addEventListener('blur', async () => {
      const next = input.value.trim();
      if (next === '' || next === prev) {
        input.value = prev || 'Senza nome';
        return;
      }
      const id = input.dataset.id!;
      const res = (await chrome.runtime.sendMessage({
        type: 'documents/update',
        id,
        name: next,
      } as UpdateDocumentRequest)) as UpdateDocumentResponse;
      if (!res.ok) {
        alert(`Rinomina fallita: ${res.error}`);
        input.value = prev;
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = prev;
        input.blur();
      }
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.doc-activate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id!;
      const res = (await chrome.runtime.sendMessage({
        type: 'documents/setActive',
        id,
      } as SetActiveDocumentRequest)) as SetActiveDocumentResponse;
      if (!res.ok) {
        alert(`Errore: ${res.error}`);
        return;
      }
      await renderList(container, onBack);
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.doc-reimport').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      void renderImport(container, { mode: 'update', id }, onBack);
    });
  });

  list.querySelectorAll<HTMLButtonElement>('.doc-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id!;
      if (!confirm('Eliminare questo documento? Operazione irreversibile.')) return;
      const res = (await chrome.runtime.sendMessage({
        type: 'documents/delete',
        id,
      } as DeleteDocumentRequest)) as DeleteDocumentResponse;
      if (!res.ok) {
        alert(`Errore: ${res.error}`);
        return;
      }
      await renderList(container, onBack);
    });
  });
}

type ImportMode = { mode: 'create' } | { mode: 'update'; id: string };

async function renderImport(
  container: HTMLElement,
  mode: ImportMode,
  onBack: () => Promise<void>,
): Promise<void> {
  const importStep = createWizardImportStep(async (data) => {
    const reviewStep = createWizardReviewStep({
      data,
      step: 2,
      subtitle:
        mode.mode === 'update' ? 'Re-importa documento' : 'Nuovo documento',
      onSave: async (parsed) => {
        if (mode.mode === 'create') {
          const filename = guessLastFilename();
          const res = (await chrome.runtime.sendMessage({
            type: 'documents/create',
            name: filename,
            data: parsed,
          } as CreateDocumentRequest)) as CreateDocumentResponse;
          return res;
        } else {
          const res = (await chrome.runtime.sendMessage({
            type: 'documents/update',
            id: mode.id,
            data: parsed,
          } as UpdateDocumentRequest)) as UpdateDocumentResponse;
          return res;
        }
      },
      onDone: async () => {
        await renderList(container, onBack);
      },
    });
    await reviewStep.render(container);
  });
  await importStep.render(container);
}

function guessLastFilename(): string {
  const input = document.querySelector<HTMLInputElement>('#file');
  const name = input?.files?.[0]?.name ?? '';
  if (name) return name.replace(/\.[^.]+$/, '');
  return `Documento ${new Date().toLocaleDateString('it-IT')}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
