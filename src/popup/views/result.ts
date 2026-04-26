import type { ViewRenderer } from './router';
import { icon, type IconName } from '../icons';
import type {
  ClearMarksRequest,
  ClearMarksResponse,
  DismissCompileResultRequest,
  DismissCompileResultResponse,
} from '@/types/messages';

interface MappingShape {
  fieldId: string;
  canonicalKey: string | null;
  displayValuePreview: string;
  status: 'certain' | 'uncertain' | 'unmapped' | 'sensitive-local' | 'skipped';
  confidence: number;
  note?: string;
  literalValue?: string;
  aiResolved?: boolean;
}

interface FieldShape {
  id: string;
  labels: { text: string; source: string }[];
  attributes: { name?: string };
}

interface FillRes {
  fieldId: string;
  ok: boolean;
  error?: string;
}

type RowKind = 'uncertain' | 'failed' | 'unmapped' | 'skipped';

interface AlertRow {
  kind: RowKind;
  field: FieldShape;
  mapping: MappingShape;
  fill?: FillRes;
}

interface FilledRow {
  field: FieldShape;
  mapping: MappingShape;
  status: 'certain' | 'uncertain' | 'sensitive-local' | 'failed';
  value: string;
}

export function createResultView(
  fields: FieldShape[],
  proposal: MappingShape[],
  results: FillRes[],
  tokensUsed: number,
  onBack: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      const resultsById = new Map(results.map((r) => [r.fieldId, r]));
      const totalProposed = proposal.length;
      const filledOk = results.filter((r) => r.ok).length;

      const alerts: AlertRow[] = [];
      const filledLog: FilledRow[] = [];

      for (const m of proposal) {
        const field = fields.find((f) => f.id === m.fieldId);
        if (!field) continue;
        const fr = resultsById.get(m.fieldId);

        if (m.status === 'skipped') {
          alerts.push({ kind: 'skipped', field, mapping: m });
          continue;
        }
        const wasAttempted =
          m.canonicalKey !== null || m.literalValue !== undefined;
        if (!wasAttempted) {
          alerts.push({ kind: 'unmapped', field, mapping: m });
          continue;
        }
        if (fr && !fr.ok) {
          alerts.push({ kind: 'failed', field, mapping: m, fill: fr });
          filledLog.push({
            field,
            mapping: m,
            status: 'failed',
            value: m.displayValuePreview,
          });
          continue;
        }
        if (fr && fr.ok && m.status === 'uncertain') {
          alerts.push({ kind: 'uncertain', field, mapping: m, fill: fr });
        }
        if (fr && fr.ok) {
          const status =
            m.status === 'sensitive-local'
              ? 'sensitive-local'
              : m.status === 'uncertain'
                ? 'uncertain'
                : 'certain';
          filledLog.push({
            field,
            mapping: m,
            status,
            value: m.displayValuePreview,
          });
        }
      }

      const allOk = alerts.length === 0;

      container.innerHTML = `
        <header class="header">
          <span class="h-icon ${allOk ? 'h-icon-ok' : 'h-icon-warn'}">
            ${icon(allOk ? 'check' : 'alert', { size: 20 })}
          </span>
          <div class="h-text">
            <div class="h-title">${allOk ? 'Form compilato' : 'Compilato con avvisi'}</div>
            <div class="h-subtitle">${filledOk} di ${totalProposed} campi · ${tokensUsed} token</div>
          </div>
        </header>

        <section class="result-hero ${allOk ? 'is-ok' : 'has-warn'}">
          <div class="result-hero-icon">
            ${icon(allOk ? 'check' : 'alert', { size: 24 })}
          </div>
          <div>
            <div class="result-hero-title">
              ${allOk ? 'Tutto compilato' : `${alerts.length} ${alerts.length === 1 ? 'avviso' : 'avvisi'}`}
            </div>
            <div class="result-hero-meta">
              ${
                allOk
                  ? 'Nessun campo da rivedere'
                  : 'Controlla i campi qui sotto prima di inviare il form'
              }
            </div>
          </div>
        </section>

        ${alertSection('uncertain', alerts.filter((a) => a.kind === 'uncertain'))}
        ${alertSection('failed', alerts.filter((a) => a.kind === 'failed'))}
        ${alertSection('unmapped', alerts.filter((a) => a.kind === 'unmapped'))}
        ${alertSection('skipped', alerts.filter((a) => a.kind === 'skipped'))}

        ${filledLogSection(filledLog)}

        <div class="footer-actions">
          <button id="back-btn" class="cta">
            ${icon('check', { size: 16 })} Fatto
          </button>
          <button id="clear-btn" class="secondary">
            ${icon('refresh', { size: 14 })} Pulisci marker dalla pagina
          </button>
        </div>
      `;

      container
        .querySelector<HTMLButtonElement>('#back-btn')!
        .addEventListener('click', async () => {
          // Dismiss the persisted result so reopening the popup goes to main,
          // not back here. (clearMarks would also do this but would wipe the
          // colored markers from the page; "Fatto" should leave them.)
          (await chrome.runtime.sendMessage({
            type: 'compile/dismissResult',
          } as DismissCompileResultRequest)) as DismissCompileResultResponse;
          await onBack();
        });
      container
        .querySelector<HTMLButtonElement>('#clear-btn')!
        .addEventListener('click', async () => {
          (await chrome.runtime.sendMessage({
            type: 'compile/clearMarks',
          } as ClearMarksRequest)) as ClearMarksResponse;
          await onBack();
        });

      const log = container.querySelector<HTMLDivElement>('.filled-log');
      const logHead = container.querySelector<HTMLButtonElement>('.filled-log-head');
      logHead?.addEventListener('click', () => {
        log?.classList.toggle('is-open');
      });
    },
  };
}

function alertSection(kind: RowKind, rows: AlertRow[]): string {
  if (rows.length === 0) return '';
  const meta = ALERT_META[kind];
  const items = rows
    .map((r) => {
      const labelText =
        r.field.labels[0]?.text ?? r.field.attributes.name ?? r.field.id;
      const value =
        kind === 'uncertain'
          ? r.mapping.literalValue ?? r.mapping.displayValuePreview
          : '';
      const reason =
        kind === 'failed' ? r.fill?.error ?? 'errore sconosciuto' : '';
      return `
        <div class="alert-row">
          <div class="alert-row-label">${escapeHtml(labelText)}</div>
          ${value ? `<div class="alert-row-value">→ ${escapeHtml(value)}</div>` : ''}
          ${reason ? `<div class="alert-row-reason">${escapeHtml(reason)}</div>` : ''}
          ${
            (kind === 'unmapped' || kind === 'skipped') && meta.itemReason
              ? `<div class="alert-row-reason">${escapeHtml(meta.itemReason)}</div>`
              : ''
          }
        </div>
      `;
    })
    .join('');
  return `
    <div class="alert-card alert-${kind}">
      <div class="alert-head">
        <span>${icon(meta.icon, { size: 12 })}</span>
        <span>${escapeHtml(meta.title)} (${rows.length})</span>
      </div>
      <div class="alert-body">${items}</div>
    </div>
  `;
}

function filledLogSection(rows: FilledRow[]): string {
  if (rows.length === 0) return '';
  const items = rows
    .map((r) => {
      const labelText =
        r.field.labels[0]?.text ?? r.field.attributes.name ?? r.field.id;
      const aiBadge = r.mapping.aiResolved
        ? '<span class="filled-row-ai" title="Compilato dall\'AI">AI</span>'
        : '';
      const statusIconName: IconName =
        r.status === 'failed'
          ? 'x'
          : r.status === 'uncertain'
            ? 'alert'
            : r.status === 'sensitive-local'
              ? 'shield'
              : 'check';
      return `
        <div class="filled-row">
          <span class="filled-row-status s-${r.status}">${icon(statusIconName, { size: 11 })}</span>
          <span class="filled-row-label" title="${escapeHtml(labelText)}">${escapeHtml(labelText)}</span>
          ${aiBadge}
          <span class="filled-row-value" title="${escapeHtml(r.value)}">${escapeHtml(r.value || '—')}</span>
        </div>
      `;
    })
    .join('');
  return `
    <div class="filled-log">
      <button class="filled-log-head" type="button">
        ${icon('file', { size: 14 })}
        <span>Tutti i campi (${rows.length})</span>
        <span class="chev">${icon('chevronDown', { size: 14 })}</span>
      </button>
      <div class="filled-log-body">${items}</div>
    </div>
  `;
}

const ALERT_META: Record<
  RowKind,
  { icon: IconName; title: string; itemReason: string }
> = {
  uncertain: {
    icon: 'alert',
    title: 'Da rivedere',
    itemReason: '',
  },
  failed: {
    icon: 'x',
    title: 'Non compilati',
    itemReason: '',
  },
  unmapped: {
    icon: 'x',
    title: 'Da compilare a mano',
    itemReason: 'Nessun dato disponibile per questo campo',
  },
  skipped: {
    icon: 'shield',
    title: 'Da selezionare a mano',
    itemReason: 'Allegato file: selezionalo manualmente',
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
