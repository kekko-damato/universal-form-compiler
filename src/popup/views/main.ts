import type { ViewRenderer } from './router';
import { icon } from '../icons';
import type {
  GetCanonicalDataRequest,
  GetCanonicalDataResponse,
  ListDocumentsRequest,
  ListDocumentsResponse,
  SetActiveDocumentRequest,
  SetActiveDocumentResponse,
} from '@/types/messages';

interface CanonicalShape {
  person?: {
    first_name?: string;
    last_name?: string;
    middle_name?: string;
    full_name?: string;
  };
  contact?: { email?: string };
  company?: { legal_name?: string };
}

// Main view = identity + (optional) doc switcher + single CTA. All other
// actions live in Settings, accessible via a single icon-button in the header.
export function createMainView(
  onSettings: () => Promise<void>,
  _onReimport: () => Promise<void>,
  onCompile: () => Promise<void>,
  _onReset: () => Promise<void>,
): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      const [canonical, docs] = await Promise.all([
        chrome.runtime.sendMessage({
          type: 'canonical/get',
        } as GetCanonicalDataRequest) as Promise<GetCanonicalDataResponse>,
        chrome.runtime.sendMessage({
          type: 'documents/list',
        } as ListDocumentsRequest) as Promise<ListDocumentsResponse>,
      ]);

      const data = canonical.data as CanonicalShape | null;
      const hasData = data !== null;
      const fullName = hasData ? composeFullName(data) : '';
      const email = data?.contact?.email ?? '';
      const initials = hasData ? computeInitials(data) : '?';
      const multipleDocs = docs.documents.length > 1;

      container.innerHTML = `
        <header class="header">
          <span class="h-icon">${icon('zap', { size: 20 })}</span>
          <div class="h-text">
            <div class="h-title">Form Compiler</div>
            <div class="h-subtitle">Riempie i form con AI</div>
          </div>
          <div class="h-action">
            <button id="settings-btn" class="icon-btn icon-btn-bordered" title="Impostazioni">
              ${icon('settings', { size: 18 })}
            </button>
          </div>
        </header>

        <section class="identity">
          ${
            hasData
              ? `
            <div class="identity-row">
              <div class="identity-avatar">${escapeHtml(initials)}</div>
              <div class="identity-text">
                <div class="identity-name">${escapeHtml(fullName || '—')}</div>
                <div class="identity-meta">${escapeHtml(email || 'nessuna email')}</div>
              </div>
            </div>
            ${
              multipleDocs
                ? `
              <div class="identity-switcher">
                ${icon('file', { size: 14 })}
                <select id="doc-switch" title="Documento attivo">
                  ${docs.documents
                    .map(
                      (d) =>
                        `<option value="${d.id}" ${d.id === docs.activeId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`,
                    )
                    .join('')}
                </select>
              </div>
            `
                : ''
            }
          `
              : `
            <div class="identity-empty">
              ${icon('upload', { size: 16 })}
              <span>Apri Impostazioni per importare il primo documento</span>
            </div>
          `
          }
        </section>

        <div class="footer-actions">
          <button id="compile-btn" class="cta" ${!hasData ? 'disabled' : ''}>
            ${icon('wand', { size: 18 })} Compila form
          </button>
        </div>
      `;

      const switcher = container.querySelector<HTMLSelectElement>('#doc-switch');
      switcher?.addEventListener('change', async () => {
        const id = switcher.value;
        const res = (await chrome.runtime.sendMessage({
          type: 'documents/setActive',
          id,
        } as SetActiveDocumentRequest)) as SetActiveDocumentResponse;
        if (!res.ok) {
          alert(`Errore: ${res.error}`);
          return;
        }
        await this.render(container);
      });

      container
        .querySelector<HTMLButtonElement>('#settings-btn')!
        .addEventListener('click', async () => {
          await onSettings();
        });

      container
        .querySelector<HTMLButtonElement>('#compile-btn')!
        .addEventListener('click', async () => {
          if (!hasData) return;
          await onCompile();
        });
    },
  };
}

function composeFullName(data: CanonicalShape): string {
  const p = data.person ?? {};
  const parts = [p.first_name, p.middle_name, p.last_name].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (parts.length > 0) return parts.join(' ');
  if (p.full_name) return p.full_name;
  return '';
}

function computeInitials(data: CanonicalShape): string {
  const p = data.person ?? {};
  const f = (p.first_name ?? '').trim()[0] ?? '';
  const l = (p.last_name ?? '').trim()[0] ?? '';
  return (f + l).toUpperCase() || '?';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
