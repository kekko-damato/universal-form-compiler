import type { MappingStatus } from '@/types/mapping';

const STATUS_CLASSES: Record<MappingStatus, string> = {
  certain: 'ufc-mark-certain',
  uncertain: 'ufc-mark-uncertain',
  unmapped: 'ufc-mark-unmapped',
  'sensitive-local': 'ufc-mark-sensitive',
  skipped: 'ufc-mark-skipped',
};

const ALL_CLASSES = Object.values(STATUS_CLASSES);

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
}

export function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  const existing = document.getElementById('ufc-toast');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'ufc-toast';
  div.className = `ufc-toast ufc-toast-${kind}`;
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(() => {
    div.remove();
  }, 4000);
}
