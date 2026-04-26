import type { MappingStatus } from '@/types/mapping';

const STATUS_CLASSES: Record<MappingStatus, string> = {
  certain: 'ufc-mark-certain',
  uncertain: 'ufc-mark-uncertain',
  unmapped: 'ufc-mark-unmapped',
  'sensitive-local': 'ufc-mark-sensitive',
  skipped: 'ufc-mark-skipped',
};

const ALL_CLASSES = Object.values(STATUS_CLASSES);

const TOAST_ID = 'ufc-toast';
const WIDGET_ID = 'ufc-widget';

// Lucide-style inline SVG. Kept tiny and self-contained so the overlay has
// zero network/dependency cost.
const ICONS = {
  check:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  alert:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  x: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  zap: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  spinner:
    '<svg xmlns="http://www.w3.org/2000/svg" class="ufc-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
} as const;

export function markField(selector: string, status: MappingStatus): void {
  const el = document.querySelector(selector);
  if (!el || !(el instanceof HTMLElement)) return;
  el.classList.remove(...ALL_CLASSES);
  el.classList.add(STATUS_CLASSES[status]);
}

export function clearMarks(): void {
  for (const cls of ALL_CLASSES) {
    const els = document.querySelectorAll(`.${cls}`);
    els.forEach((e) => e.classList.remove(cls));
  }
  hideWidget();
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export function showToast(message: string, kind: ToastKind | 'info' = 'success'): void {
  const existing = document.getElementById(TOAST_ID);
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = TOAST_ID;
  // Map legacy 'info' caller to a sensible default.
  const k = kind === 'info' ? 'success' : kind;
  div.className = `ufc-toast ufc-toast-${k}`;
  div.innerHTML = `
    <span class="ufc-toast-icon">${toastIcon(k)}</span>
    <span class="ufc-toast-msg"></span>
    <button class="ufc-toast-close" aria-label="Chiudi">${ICONS.x}</button>
  `;
  // Use textContent for the message (XSS-safe — never inject untrusted HTML).
  const msgEl = div.querySelector('.ufc-toast-msg');
  if (msgEl) msgEl.textContent = message;
  document.body.appendChild(div);

  // Slide-in
  requestAnimationFrame(() => div.classList.add('ufc-toast-show'));

  const close = (): void => {
    div.classList.remove('ufc-toast-show');
    setTimeout(() => div.remove(), 200);
  };
  div.querySelector('.ufc-toast-close')?.addEventListener('click', close);
  // Auto-dismiss success/info quickly, errors persist longer
  const ttl = k === 'error' ? 8000 : k === 'warning' ? 6000 : 4000;
  setTimeout(close, ttl);
}

export type WidgetStatus = 'analyzing' | 'ready' | 'filling' | 'done' | 'error';

interface WidgetOpts {
  status: WidgetStatus;
  title: string;
  detail?: string;
  autoHideMs?: number;
}

export function showWidget(opts: WidgetOpts): void {
  let el = document.getElementById(WIDGET_ID) as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = WIDGET_ID;
    el.className = 'ufc-widget';
    el.innerHTML = `
      <div class="ufc-widget-icon"></div>
      <div class="ufc-widget-body">
        <div class="ufc-widget-title"></div>
        <div class="ufc-widget-detail"></div>
      </div>
      <button class="ufc-widget-close" aria-label="Chiudi">${ICONS.x}</button>
    `;
    document.body.appendChild(el);
    el.querySelector('.ufc-widget-close')?.addEventListener('click', () =>
      hideWidget(),
    );
  }
  el.className = `ufc-widget ufc-widget-${opts.status}`;
  const iconEl = el.querySelector('.ufc-widget-icon');
  const titleEl = el.querySelector('.ufc-widget-title');
  const detailEl = el.querySelector('.ufc-widget-detail') as HTMLElement | null;
  if (iconEl) iconEl.innerHTML = widgetIcon(opts.status);
  if (titleEl) titleEl.textContent = opts.title;
  if (detailEl) {
    if (opts.detail) {
      detailEl.textContent = opts.detail;
      detailEl.style.display = '';
    } else {
      detailEl.textContent = '';
      detailEl.style.display = 'none';
    }
  }
  requestAnimationFrame(() => el!.classList.add('ufc-widget-show'));

  if (opts.autoHideMs && opts.autoHideMs > 0) {
    window.clearTimeout((el as HTMLElement & { _ufcHideTimer?: number })._ufcHideTimer);
    (el as HTMLElement & { _ufcHideTimer?: number })._ufcHideTimer = window.setTimeout(
      () => hideWidget(),
      opts.autoHideMs,
    );
  }
}

export function hideWidget(): void {
  const el = document.getElementById(WIDGET_ID);
  if (!el) return;
  el.classList.remove('ufc-widget-show');
  setTimeout(() => el.remove(), 220);
}

function toastIcon(k: ToastKind): string {
  switch (k) {
    case 'success':
      return ICONS.check;
    case 'warning':
      return ICONS.alert;
    case 'error':
      return ICONS.x;
    case 'info':
      return ICONS.zap;
  }
}

function widgetIcon(s: WidgetStatus): string {
  switch (s) {
    case 'analyzing':
    case 'filling':
      return ICONS.spinner;
    case 'ready':
      return ICONS.zap;
    case 'done':
      return ICONS.check;
    case 'error':
      return ICONS.alert;
  }
}
