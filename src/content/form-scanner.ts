import { detectWidget } from './widget-detector';
import type {
  FieldDescriptor,
  FieldLabel,
  FieldValidation,
  WidgetType,
} from '@/types/field';

const FORM_ELEMENT_TAGS = ['input', 'textarea', 'select'] as const;

const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export function scanForm(root: Document | ShadowRoot = document): FieldDescriptor[] {
  const elements = Array.from(
    root.querySelectorAll(FORM_ELEMENT_TAGS.join(',')),
  );

  const formTitle = extractFormTitle(root);
  const descriptors: FieldDescriptor[] = [];
  const radioGroups = new Map<string, HTMLInputElement[]>();

  let counter = 0;
  const nextId = (): string => `ufc-${++counter}`;

  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;

    // Skip invisible and known non-fillable types
    if (isHidden(el)) continue;
    if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has(el.type)) continue;

    // Group radios by name — we'll emit one descriptor per group
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const name = el.name || '(unnamed-radio)';
      const group = radioGroups.get(name) ?? [];
      group.push(el);
      radioGroups.set(name, group);
      continue;
    }

    const widget = detectWidget(el);
    if (widget.kind === 'unsupported') continue;

    descriptors.push(buildDescriptor(el, widget, nextId(), formTitle));
  }

  for (const [name, group] of radioGroups) {
    const first = group[0];
    if (!first) continue;
    const widget: WidgetType = { kind: 'native-input', type: 'radio' };
    const desc = buildDescriptor(first, widget, nextId(), formTitle, { radioName: name });
    desc.options = group.map((r) => r.value).filter((v) => v !== '');
    // Prefer fieldset legend for radios
    const legend = findFieldsetLegend(first);
    if (legend) {
      desc.labels.unshift({ text: legend, source: 'legend' });
    }
    descriptors.push(desc);
  }

  return descriptors;
}

function buildDescriptor(
  el: HTMLElement,
  widget: WidgetType,
  id: string,
  formTitle: string | undefined,
  opts: { radioName?: string } = {},
): FieldDescriptor {
  const labels = collectLabels(el);
  const selector = opts.radioName
    ? `input[type="radio"][name="${cssEscape(opts.radioName)}"]`
    : buildSelector(el, id);
  const options = getOptions(el);
  const validation = getValidation(el);

  const attributes: FieldDescriptor['attributes'] = {};
  const name = el.getAttribute('name');
  if (name) attributes.name = name;
  const elId = el.getAttribute('id');
  if (elId) attributes.id = elId;
  const autocomplete = el.getAttribute('autocomplete');
  if (autocomplete) attributes.autocomplete = autocomplete;
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) attributes.placeholder = placeholder;
  const aria = el.getAttribute('aria-label');
  if (aria) attributes.ariaLabel = aria;
  const title = el.getAttribute('title');
  if (title) attributes.title = title;
  const type = el.getAttribute('type');
  if (type) attributes.type = type;

  return {
    id,
    selector,
    widget,
    labels,
    attributes,
    options,
    validation,
    context: { formTitle },
  };
}

function collectLabels(el: HTMLElement): FieldLabel[] {
  const labels: FieldLabel[] = [];
  const seen = new Set<string>();
  const push = (text: string, source: FieldLabel['source']): void => {
    const clean = text.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const key = `${source}:${clean}`;
    if (seen.has(key)) return;
    seen.add(key);
    labels.push({ text: clean, source });
  };

  const elId = el.getAttribute('id');
  if (elId) {
    const labelEls = document.querySelectorAll(`label[for="${cssEscape(elId)}"]`);
    for (const l of Array.from(labelEls)) {
      push(readText(l as HTMLElement), 'label');
    }
  }

  const wrapping = el.closest('label');
  if (wrapping) {
    const text = textExcluding(wrapping, el);
    push(text, 'label');
  }

  const aria = el.getAttribute('aria-label');
  if (aria) push(aria, 'aria-label');

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) push(placeholder, 'placeholder');

  const title = el.getAttribute('title');
  if (title) push(title, 'title');

  return labels;
}

function textExcluding(root: HTMLElement, _exclude: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  // Remove the field's clone and any nested form elements
  clone.querySelectorAll('input, textarea, select, button').forEach((n) => n.remove());
  return clone.textContent ?? '';
}

function getOptions(el: HTMLElement): string[] | undefined {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options)
      .map((o) => o.textContent?.trim() ?? '')
      .filter((t) => t !== '' && !t.startsWith('--'));
  }
  return undefined;
}

function getValidation(el: HTMLElement): FieldValidation | undefined {
  const v: FieldValidation = {};
  let hasAny = false;

  if (el.hasAttribute('required')) {
    v.required = true;
    hasAny = true;
  }
  const pattern = el.getAttribute('pattern');
  if (pattern) {
    v.pattern = pattern;
    hasAny = true;
  }
  const minLen = el.getAttribute('minlength');
  if (minLen) {
    v.minLength = Number(minLen);
    hasAny = true;
  }
  const maxLen = el.getAttribute('maxlength');
  if (maxLen) {
    v.maxLength = Number(maxLen);
    hasAny = true;
  }
  const min = el.getAttribute('min');
  if (min) {
    v.min = min;
    hasAny = true;
  }
  const max = el.getAttribute('max');
  if (max) {
    v.max = max;
    hasAny = true;
  }

  return hasAny ? v : undefined;
}

function findFieldsetLegend(el: HTMLElement): string | null {
  const fs = el.closest('fieldset');
  if (!fs) return null;
  const legend = fs.querySelector(':scope > legend');
  return legend?.textContent?.trim() ?? null;
}

function buildSelector(el: HTMLElement, fallbackId: string): string {
  const id = el.getAttribute('id');
  if (id) return `#${cssEscape(id)}`;
  const name = el.getAttribute('name');
  if (name) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[name="${cssEscape(name)}"]`;
  }
  // Fallback: tag + data attribute we'll inject during fill
  el.setAttribute('data-ufc-fid', fallbackId);
  return `[data-ufc-fid="${fallbackId}"]`;
}

function cssEscape(s: string): string {
  // Minimal CSS escape — covers quotes, backslashes
  return s.replace(/["\\]/g, '\\$&');
}

function isHidden(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === 'hidden') return true;
  const win = el.ownerDocument?.defaultView;
  // Walk up to <html>: a parent with display:none / visibility:hidden /
  // hidden attribute hides every descendant. CSS does NOT inherit `display`
  // so a per-element getComputedStyle check would miss this very common
  // case (e.g. fields inside a collapsed accordion).
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.hasAttribute('hidden')) return true;
    if (win) {
      const style = win.getComputedStyle(cur);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function extractFormTitle(root: Document | ShadowRoot): string | undefined {
  if (!(root instanceof Document)) return undefined;
  const headings = root.querySelectorAll('h1, h2');
  for (const h of Array.from(headings)) {
    const text = readText(h as HTMLElement).trim();
    if (text) return text;
  }
  const title = root.title;
  return title && title.trim() !== '' ? title : undefined;
}

function readText(el: HTMLElement): string {
  // Prefer innerText when available (browser), fall back to textContent (jsdom).
  const inner = (el as HTMLElement & { innerText?: string }).innerText;
  if (typeof inner === 'string') return inner;
  return el.textContent ?? '';
}
