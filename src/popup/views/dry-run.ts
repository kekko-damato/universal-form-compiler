import type { ViewRenderer } from './router';
import type {
  ConfirmCompileRequest,
  ConfirmCompileResponse,
  ClearMarksRequest,
  ClearMarksResponse,
} from '@/types/messages';

interface MappingShape {
  fieldId: string;
  canonicalKey: string | null;
  displayValuePreview: string;
  status: 'certain' | 'uncertain' | 'unmapped' | 'sensitive-local' | 'skipped';
  confidence: number;
  note?: string;
}

interface FieldShape {
  id: string;
  labels: { text: string; source: string }[];
  attributes: { name?: string };
}

export function createDryRunView(
  fields: FieldShape[],
  proposal: MappingShape[],
  tokensUsed: number,
  onDone: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      const total = proposal.length;
      const certain = proposal.filter((m) => m.status === 'certain').length;
      const uncertain = proposal.filter((m) => m.status === 'uncertain').length;
      const unmapped = proposal.filter(
        (m) => m.status === 'unmapped' || m.status === 'skipped',
      ).length;

      container.innerHTML = `
        <h1>Pronto per compilare</h1>
        <p class="muted">
          ${certain} certi, ${uncertain} incerti, ${unmapped} saltati
          su ${total} campi. (${tokensUsed} token)
        </p>

        <div id="list" style="display:flex;flex-direction:column;gap:8px;margin:12px 0"></div>

        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="fill-btn">Compila</button>
          <button id="cancel-btn" class="secondary">Annulla</button>
        </div>
      `;

      const list = container.querySelector<HTMLDivElement>('#list')!;
      const fillBtn = container.querySelector<HTMLButtonElement>('#fill-btn')!;
      const cancelBtn = container.querySelector<HTMLButtonElement>('#cancel-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      const workingMappings: MappingShape[] = proposal.map((m) => ({ ...m }));

      function render(): void {
        list.innerHTML = '';
        for (let i = 0; i < workingMappings.length; i++) {
          const m = workingMappings[i]!;
          const field = fields.find((f) => f.id === m.fieldId);
          const labelText =
            field?.labels[0]?.text ?? field?.attributes.name ?? m.fieldId;
          const color = statusColor(m.status);
          const row = document.createElement('div');
          row.style.cssText = `border-left:3px solid ${color};padding:6px 8px;background:var(--input-bg);border-radius:4px;font-size:12px`;
          row.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:6px">
              <strong>${escapeHtml(labelText)}</strong>
              <span style="color:${color}">${statusLabel(m.status)}</span>
            </div>
            <div class="muted" style="margin-top:2px">
              ${m.canonicalKey ? escapeHtml(m.canonicalKey) : '(nessuna chiave)'}
              ${m.displayValuePreview ? ` → ${escapeHtml(m.displayValuePreview)}` : ''}
            </div>
            ${m.note ? `<div class="muted" style="font-style:italic">${escapeHtml(m.note)}</div>` : ''}
            <div style="margin-top:4px">
              <button class="secondary" data-idx="${i}" style="padding:2px 8px;font-size:11px">
                ${m.status === 'skipped' ? 'Riattiva' : 'Salta'}
              </button>
            </div>
          `;
          list.appendChild(row);
        }

        list.querySelectorAll<HTMLButtonElement>('button[data-idx]').forEach(
          (btn) => {
            btn.addEventListener('click', () => {
              const idx = Number(btn.dataset.idx);
              const m = workingMappings[idx]!;
              m.status = m.status === 'skipped' ? 'unmapped' : 'skipped';
              render();
            });
          },
        );
      }

      render();

      fillBtn.addEventListener('click', async () => {
        err.hidden = true;
        fillBtn.disabled = true;
        cancelBtn.disabled = true;
        // Submit only mappings that are not skipped and have a canonicalKey
        const toFill = workingMappings.filter(
          (m) => m.status !== 'skipped' && m.canonicalKey !== null,
        );
        const res = (await chrome.runtime.sendMessage({
          type: 'compile/confirm',
          mappings: toFill,
        } as ConfirmCompileRequest)) as ConfirmCompileResponse;
        if (res.ok) {
          await onDone();
        } else {
          err.hidden = false;
          err.textContent = res.error;
          fillBtn.disabled = false;
          cancelBtn.disabled = false;
        }
      });

      cancelBtn.addEventListener('click', async () => {
        (await chrome.runtime.sendMessage({
          type: 'compile/clearMarks',
        } as ClearMarksRequest)) as ClearMarksResponse;
        await onDone();
      });
    },
  };
}

function statusColor(s: MappingShape['status']): string {
  switch (s) {
    case 'certain':
      return '#10b981';
    case 'uncertain':
      return '#f59e0b';
    case 'sensitive-local':
      return '#8b5cf6';
    case 'skipped':
    case 'unmapped':
    default:
      return '#ef4444';
  }
}

function statusLabel(s: MappingShape['status']): string {
  switch (s) {
    case 'certain':
      return 'certo';
    case 'uncertain':
      return 'incerto';
    case 'sensitive-local':
      return 'sensibile';
    case 'skipped':
      return 'saltato';
    case 'unmapped':
      return 'non mappato';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
