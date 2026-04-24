import type { HTMLInputKind, WidgetType } from '@/types/field';

const KNOWN_INPUT_KINDS: readonly HTMLInputKind[] = [
  'text', 'email', 'password', 'tel', 'url', 'number', 'search',
  'date', 'datetime-local', 'time', 'month', 'week',
  'checkbox', 'radio', 'file', 'color', 'range', 'hidden',
];

function isKnownInputKind(s: string): s is HTMLInputKind {
  return (KNOWN_INPUT_KINDS as readonly string[]).includes(s);
}

export function detectWidget(el: Element): WidgetType {
  const tag = el.tagName.toLowerCase();

  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    const kind: HTMLInputKind = isKnownInputKind(type) ? type : 'text';
    return { kind: 'native-input', type: kind };
  }
  if (tag === 'textarea') {
    return { kind: 'native-textarea' };
  }
  if (tag === 'select') {
    const multiple = (el as HTMLSelectElement).multiple;
    return { kind: 'native-select', multiple };
  }
  return { kind: 'unsupported', reason: `Unsupported element: <${tag}>` };
}
