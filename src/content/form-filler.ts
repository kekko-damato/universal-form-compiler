import type { FillResult } from '@/types/mapping';

export interface FillAction {
  selector: string;
  value: string;
  fieldId?: string;
}

export async function fillField(action: FillAction): Promise<FillResult> {
  const el = document.querySelector(action.selector);
  if (!el || !(el instanceof HTMLElement)) {
    return {
      fieldId: action.fieldId ?? action.selector,
      ok: false,
      error: `Element not found: ${action.selector}`,
    };
  }

  try {
    if (el instanceof HTMLInputElement) {
      return await fillInput(el, action);
    }
    if (el instanceof HTMLTextAreaElement) {
      return fillTextLike(el, action);
    }
    if (el instanceof HTMLSelectElement) {
      return fillSelect(el, action);
    }
    return {
      fieldId: action.fieldId ?? action.selector,
      ok: false,
      error: `Unsupported element: ${el.tagName}`,
    };
  } catch (err) {
    return {
      fieldId: action.fieldId ?? action.selector,
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function fillInput(
  el: HTMLInputElement,
  action: FillAction,
): Promise<FillResult> {
  const type = el.type;
  if (type === 'file') {
    return {
      fieldId: action.fieldId ?? action.selector,
      ok: false,
      error: `File upload must be selected manually: ${action.value}`,
    };
  }
  if (type === 'checkbox') {
    const shouldCheck = isTruthy(action.value);
    if (el.checked !== shouldCheck) {
      el.checked = shouldCheck;
      dispatchInputChange(el);
    }
    return { fieldId: action.fieldId ?? action.selector, ok: true };
  }
  if (type === 'radio') {
    // Find sibling radio with matching value
    const name = el.name;
    const scope = el.form ?? document;
    const radios = Array.from(
      scope.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${cssEscapeAttr(name)}"]`,
      ),
    );
    const match = radios.find(
      (r) => r.value === action.value || labelOf(r) === action.value,
    );
    if (!match) {
      return {
        fieldId: action.fieldId ?? action.selector,
        ok: false,
        error: `No matching radio for value "${action.value}"`,
      };
    }
    if (!match.checked) {
      match.checked = true;
      dispatchInputChange(match);
    }
    return { fieldId: action.fieldId ?? action.selector, ok: true };
  }

  return fillTextLike(el, action);
}

function fillTextLike(
  el: HTMLInputElement | HTMLTextAreaElement,
  action: FillAction,
): FillResult {
  el.focus();
  setValueReactSafe(el, action.value);
  dispatchInputChange(el);
  el.blur();
  return { fieldId: action.fieldId ?? action.selector, ok: true };
}

function fillSelect(
  el: HTMLSelectElement,
  action: FillAction,
): FillResult {
  const byValue = Array.from(el.options).find((o) => o.value === action.value);
  const byText = byValue
    ? null
    : Array.from(el.options).find(
        (o) => (o.textContent?.trim() ?? '') === action.value,
      );
  const match = byValue ?? byText;
  if (!match) {
    return {
      fieldId: action.fieldId ?? action.selector,
      ok: false,
      error: `No matching option for value "${action.value}"`,
    };
  }
  el.value = match.value;
  dispatchInputChange(el);
  return { fieldId: action.fieldId ?? action.selector, ok: true };
}

function setValueReactSafe(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    el instanceof HTMLInputElement
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

function dispatchInputChange(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function isTruthy(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'sì' || v === 'si' || v === 'on';
}

function labelOf(radio: HTMLInputElement): string {
  const id = radio.id;
  if (id) {
    const lbl = document.querySelector(`label[for="${cssEscapeAttr(id)}"]`);
    if (lbl) return (lbl.textContent ?? '').trim();
  }
  const wrap = radio.closest('label');
  if (wrap) {
    const clone = wrap.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input').forEach((n) => n.remove());
    return (clone.textContent ?? '').trim();
  }
  return '';
}

function cssEscapeAttr(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}
