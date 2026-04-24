# UFC Phase 1c — Compile MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add content scripts (form scanner, form filler, overlay), orchestrator that maps user data to form fields via AI, dry-run confirmation UI, and the "Compile this form" button. At the end of Phase 1c the extension can scan a visible HTML form on any page, propose a mapping, show a dry-run, let the user confirm/edit, then fill the form with colored-border feedback — **never** auto-submitting. Phase 1c handles **HTML native fields only** (`input`, `textarea`, `select`, `radio`, `checkbox`, `file`). Material UI, Ant Design, rich text editors, Shadow DOM, iframes, and dynamic forms come in Phase 2+.

**Architecture:** Content scripts are bundled separately by Vite CRX plugin and injected by the MV3 manifest. Communication is strictly typed via `chrome.runtime.onMessage` / `chrome.tabs.sendMessage`. The form scanner walks the DOM collecting `FieldDescriptor`s; the orchestrator in the service worker sends descriptors + canonical keys (not values) to OpenAI, receives a `Mapping[]`, surfaces it in a dry-run popup view, and on confirmation forwards the mapping (with values substituted locally from the vault) to the content script's filler. The overlay applies colored borders in-page. File uploads are not auto-filled — they are flagged for manual user action.

**Tech Stack additions:** No new runtime deps. Uses the existing AI client, Zod for mapping-response validation, jsdom for unit-testing scanner/filler in Vitest.

**Reference spec:** [docs/superpowers/specs/2026-04-24-universal-form-compiler-design.md](../specs/2026-04-24-universal-form-compiler-design.md)

**Scope:** Milestones M4 (scanner), M5 (orchestrator + AI mapping), M6 (filler + dry-run) from the spec, limited to HTML native fields. **Not in 1c**: UI-library widget detectors, Shadow DOM, iframes, rich text, wizard multi-step, MutationObserver, cache, file-upload automation.

---

## File Structure

### Created in Phase 1c

| File | Responsibility |
|---|---|
| `src/types/field.ts` | `FieldDescriptor`, `WidgetType`, `FieldLabel` types |
| `src/types/mapping.ts` | `Mapping`, `MappingStatus`, `CompileRequest/Response` types |
| `src/content/form-scanner.ts` | DOM walker: find native fields, extract metadata, assign stable IDs |
| `src/content/widget-detector.ts` | Phase-1c stub: returns native widget types based on element + type attribute |
| `src/content/form-filler.ts` | Set values with synthetic events, React compatibility trick |
| `src/content/overlay.ts` | In-page status bar + colored-border marks |
| `src/content/content-entry.ts` | Content script entry: wires scanner/filler/overlay to `chrome.runtime.onMessage` |
| `src/content/content-styles.css` | Overlay CSS (coexists with any page CSS using high-specificity rules) |
| `src/background/orchestrator.ts` | Coordinates scan → AI mapping → dry-run → fill across popup+content+AI |
| `src/background/mapping-prompt.ts` | Builds the mapping-specific system prompt and JSON schema |
| `src/popup/views/dry-run.ts` | Dry-run panel: green/yellow/red per field, edit/confirm |
| `tests/unit/form-scanner.test.ts` | Scanner tests (JSDOM fixtures) |
| `tests/unit/form-filler.test.ts` | Filler tests (JSDOM + synthetic event assertions) |
| `tests/unit/widget-detector.test.ts` | Widget classifier tests |
| `tests/unit/orchestrator.test.ts` | Orchestrator tests (mocked AI + content script) |
| `tests/unit/mapping-prompt.test.ts` | Prompt schema validation |
| `tests/fixtures/forms/basic.html` | Simple HTML form (text/email/password/select/radio/checkbox) |
| `tests/fixtures/forms/italian.html` | Italian company registration-like form |

### Modified in Phase 1c

| File | Change |
|---|---|
| `manifest.json` | Add `content_scripts` entry, expand `host_permissions` to `<all_urls>` for fill flow |
| `src/types/messages.ts` | Add `CompileFormRequest/Response`, `ContentScan/FillRequest/Response` message types |
| `src/background/service-worker.ts` | Handle `compile/start` from popup; dispatch scan → AI → return proposed mapping to popup; on confirm, send fill to content script |
| `src/popup/main.ts` | Add `dry-run` view id + route; add compile button handler in main |
| `src/popup/views/router.ts` | Add `'dry-run'` to `ViewId` union |
| `src/popup/views/main.ts` | Add "Compila questo form" button, calls `compile/start` on active tab |

### Unchanged in Phase 1c

`src/lib/*` stays untouched (vault, crypto, canonical-schema, importer, parsers). `src/background/session.ts`, `rate-limiter.ts`, `ai-client.ts` are unchanged — consumed by orchestrator. Popup views `unlock`, `setup-wizard`, `settings` are unchanged.

---

## Task 1: Update manifest for content scripts

**Files:** `manifest.json`

- [ ] **Step 1: Replace manifest**

Modify `manifest.json` — update `host_permissions` and add `content_scripts`:

```json
{
  "manifest_version": 3,
  "name": "Universal Form Compiler",
  "version": "0.1.0",
  "description": "Auto-fill any web form from an encrypted JSON vault using OpenAI.",
  "author": { "email": "vdamato@rdditalia.com" },
  "icons": {
    "16": "src/assets/icon16.png",
    "48": "src/assets/icon48.png",
    "128": "src/assets/icon128.png"
  },
  "action": {
    "default_popup": "src/popup/index.html",
    "default_title": "Universal Form Compiler"
  },
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "permissions": [
    "storage",
    "activeTab",
    "scripting"
  ],
  "host_permissions": [
    "https://api.openai.com/*",
    "<all_urls>"
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/content-entry.ts"],
      "css": ["src/content/content-styles.css"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "chore(manifest): add content_scripts and broaden host_permissions"
```

---

## Task 2: Types for fields and mappings

**Files:** `src/types/field.ts`, `src/types/mapping.ts`

- [ ] **Step 1: Create field types**

Create `src/types/field.ts`:

```typescript
export type HTMLInputKind =
  | 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'search'
  | 'date' | 'datetime-local' | 'time' | 'month' | 'week'
  | 'checkbox' | 'radio' | 'file' | 'color' | 'range' | 'hidden';

export type WidgetType =
  | { kind: 'native-input'; type: HTMLInputKind }
  | { kind: 'native-textarea' }
  | { kind: 'native-select'; multiple: boolean }
  | { kind: 'unsupported'; reason: string };

export interface FieldLabel {
  text: string;
  source: 'label' | 'aria-label' | 'placeholder' | 'title' | 'nearby' | 'legend';
}

export interface FieldValidation {
  required?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
}

export interface FieldDescriptor {
  id: string;                       // stable selector assigned by scanner
  selector: string;                 // CSS selector suitable for querySelector
  widget: WidgetType;
  labels: FieldLabel[];
  attributes: {
    name?: string;
    id?: string;
    autocomplete?: string;
    placeholder?: string;
    ariaLabel?: string;
    title?: string;
    type?: string;
  };
  options?: string[];               // for select / radio group
  validation?: FieldValidation;
  context: {
    nearbyText?: string;
    formTitle?: string;
  };
}
```

- [ ] **Step 2: Create mapping types**

Create `src/types/mapping.ts`:

```typescript
import type { FieldDescriptor } from './field';

export type MappingStatus = 'certain' | 'uncertain' | 'unmapped' | 'sensitive-local' | 'skipped';

export interface Mapping {
  fieldId: string;                  // matches FieldDescriptor.id
  canonicalKey: string | null;      // e.g. "person.first_name", null if unmapped
  displayValuePreview: string;      // value from vault, masked if sensitive
  status: MappingStatus;
  confidence: number;               // 0..1
  note?: string;                    // human-readable reason (e.g. "no match", "widget unsupported")
}

export interface CompileResult {
  fields: FieldDescriptor[];
  proposal: Mapping[];
  tokensUsed: number;
}

export interface FillResult {
  fieldId: string;
  ok: boolean;
  error?: string;
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/field.ts src/types/mapping.ts
git commit -m "feat(types): FieldDescriptor, WidgetType, Mapping types"
```

---

## Task 3: Widget detector (TDD)

**Files:** `src/content/widget-detector.ts`, `tests/unit/widget-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/widget-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectWidget } from '@/content/widget-detector';

function el(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild as HTMLElement;
}

describe('detectWidget', () => {
  it('classifies text input', () => {
    expect(detectWidget(el('<input type="text">'))).toEqual({
      kind: 'native-input',
      type: 'text',
    });
  });

  it('classifies email input', () => {
    expect(detectWidget(el('<input type="email">'))).toEqual({
      kind: 'native-input',
      type: 'email',
    });
  });

  it('classifies password input', () => {
    expect(detectWidget(el('<input type="password">'))).toEqual({
      kind: 'native-input',
      type: 'password',
    });
  });

  it('treats unknown input type as text fallback', () => {
    expect(detectWidget(el('<input type="foobar">'))).toEqual({
      kind: 'native-input',
      type: 'text',
    });
  });

  it('defaults input without type to text', () => {
    expect(detectWidget(el('<input>'))).toEqual({
      kind: 'native-input',
      type: 'text',
    });
  });

  it('classifies checkbox', () => {
    expect(detectWidget(el('<input type="checkbox">'))).toEqual({
      kind: 'native-input',
      type: 'checkbox',
    });
  });

  it('classifies radio', () => {
    expect(detectWidget(el('<input type="radio">'))).toEqual({
      kind: 'native-input',
      type: 'radio',
    });
  });

  it('classifies file', () => {
    expect(detectWidget(el('<input type="file">'))).toEqual({
      kind: 'native-input',
      type: 'file',
    });
  });

  it('classifies textarea', () => {
    expect(detectWidget(el('<textarea></textarea>'))).toEqual({
      kind: 'native-textarea',
    });
  });

  it('classifies single select', () => {
    expect(detectWidget(el('<select></select>'))).toEqual({
      kind: 'native-select',
      multiple: false,
    });
  });

  it('classifies multi select', () => {
    expect(detectWidget(el('<select multiple></select>'))).toEqual({
      kind: 'native-select',
      multiple: true,
    });
  });

  it('returns unsupported for non-form elements', () => {
    const result = detectWidget(el('<div></div>'));
    expect(result.kind).toBe('unsupported');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/widget-detector.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/content/widget-detector.ts`:

```typescript
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
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/widget-detector.test.ts
```

Expected: 12 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/content/widget-detector.ts tests/unit/widget-detector.test.ts
git commit -m "feat(content): widget detector for native HTML form elements"
```

---

## Task 4: Form scanner fixtures + tests

**Files:** `tests/fixtures/forms/basic.html`, `tests/fixtures/forms/italian.html`, `tests/unit/form-scanner.test.ts`

- [ ] **Step 1: Create basic fixture**

Create `tests/fixtures/forms/basic.html`:

```html
<!DOCTYPE html>
<html>
  <head><title>Basic form</title></head>
  <body>
    <h1>Registration</h1>
    <form id="reg-form">
      <label for="first-name">First name</label>
      <input id="first-name" name="first_name" type="text" required />

      <label>
        Email address
        <input name="email" type="email" placeholder="you@example.com" />
      </label>

      <label for="pw">Password</label>
      <input id="pw" name="password" type="password" autocomplete="new-password" />

      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="">-- choose --</option>
        <option value="IT">Italy</option>
        <option value="US">United States</option>
      </select>

      <fieldset>
        <legend>Newsletter</legend>
        <label><input type="radio" name="newsletter" value="yes" /> Yes</label>
        <label><input type="radio" name="newsletter" value="no" /> No</label>
      </fieldset>

      <label>
        <input type="checkbox" name="terms" /> I accept the terms
      </label>

      <label for="bio">Short bio</label>
      <textarea id="bio" name="bio" rows="4"></textarea>

      <label for="cv">CV</label>
      <input id="cv" name="cv" type="file" />

      <button type="submit">Register</button>
    </form>
  </body>
</html>
```

- [ ] **Step 2: Create Italian fixture**

Create `tests/fixtures/forms/italian.html`:

```html
<!DOCTYPE html>
<html>
  <head><title>Azienda</title></head>
  <body>
    <h1>Iscrizione azienda</h1>
    <form id="company-form">
      <label for="ragione-sociale">Ragione Sociale</label>
      <input id="ragione-sociale" name="ragione_sociale" type="text" required />

      <label for="piva">Partita IVA</label>
      <input id="piva" name="vat" type="text" pattern="\d{11}" />

      <label for="cf">Codice Fiscale</label>
      <input id="cf" name="tax_code" type="text" />

      <label for="pec">PEC</label>
      <input id="pec" name="pec" type="email" />

      <label for="telefono">Telefono</label>
      <input id="telefono" name="phone" type="tel" />

      <label for="forma">Forma giuridica</label>
      <select id="forma" name="legal_form">
        <option value="">-- Seleziona --</option>
        <option value="srl">S.r.l.</option>
        <option value="spa">S.p.A.</option>
        <option value="snc">S.n.c.</option>
      </select>

      <label for="dipendenti">Numero dipendenti</label>
      <input id="dipendenti" name="employees" type="number" min="0" />

      <label for="indirizzo">Sede legale</label>
      <textarea id="indirizzo" name="address"></textarea>

      <button type="submit">Invia</button>
    </form>
  </body>
</html>
```

- [ ] **Step 3: Write failing tests**

Create `tests/unit/form-scanner.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanForm } from '@/content/form-scanner';

function loadFixture(name: string): void {
  const html = readFileSync(
    resolve(__dirname, `../fixtures/forms/${name}`),
    'utf8',
  );
  document.documentElement.innerHTML = html
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<html[^>]*>/i, '')
    .replace(/<\/html>/i, '');
}

describe('scanForm — basic.html', () => {
  beforeEach(() => {
    loadFixture('basic.html');
  });

  it('finds all form fields', () => {
    const fields = scanForm(document);
    // first_name + email + password + country + 2 radios + checkbox + bio + cv = 9
    // Radios are grouped into one descriptor with options, so 8
    expect(fields.length).toBe(8);
  });

  it('extracts explicit label via for=id', () => {
    const fields = scanForm(document);
    const firstName = fields.find((f) => f.attributes.name === 'first_name');
    expect(firstName).toBeDefined();
    expect(firstName!.labels).toContainEqual({
      text: 'First name',
      source: 'label',
    });
  });

  it('extracts wrapping-label text when no for attribute', () => {
    const fields = scanForm(document);
    const email = fields.find((f) => f.attributes.name === 'email');
    expect(email).toBeDefined();
    const texts = email!.labels.map((l) => l.text);
    expect(texts.some((t) => t.includes('Email'))).toBe(true);
  });

  it('extracts placeholder as a label source', () => {
    const fields = scanForm(document);
    const email = fields.find((f) => f.attributes.name === 'email');
    expect(email!.labels).toContainEqual({
      text: 'you@example.com',
      source: 'placeholder',
    });
  });

  it('extracts select options', () => {
    const fields = scanForm(document);
    const country = fields.find((f) => f.attributes.name === 'country');
    expect(country?.options).toEqual(
      expect.arrayContaining(['Italy', 'United States']),
    );
  });

  it('groups radio inputs by name into a single descriptor', () => {
    const fields = scanForm(document);
    const news = fields.filter((f) => f.attributes.name === 'newsletter');
    expect(news.length).toBe(1);
    expect(news[0]!.widget).toEqual({ kind: 'native-input', type: 'radio' });
    expect(news[0]!.options).toEqual(expect.arrayContaining(['yes', 'no']));
  });

  it('captures required validation', () => {
    const fields = scanForm(document);
    const firstName = fields.find((f) => f.attributes.name === 'first_name');
    expect(firstName!.validation?.required).toBe(true);
  });

  it('assigns stable unique ids', () => {
    const fields = scanForm(document);
    const ids = new Set(fields.map((f) => f.id));
    expect(ids.size).toBe(fields.length);
  });

  it('extracts fieldset legend for nearby text', () => {
    const fields = scanForm(document);
    const newsletter = fields.find((f) => f.attributes.name === 'newsletter');
    const labelTexts = newsletter!.labels.map((l) => l.text);
    expect(labelTexts.some((t) => t.toLowerCase().includes('newsletter'))).toBe(true);
  });

  it('captures form title from heading', () => {
    const fields = scanForm(document);
    expect(fields[0]!.context.formTitle).toContain('Registration');
  });

  it('selector can locate the element back', () => {
    const fields = scanForm(document);
    for (const f of fields) {
      const found = document.querySelector(f.selector);
      expect(found).not.toBeNull();
    }
  });

  it('skips hidden inputs', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<input type="hidden" name="csrf" value="abc123" />',
    );
    const fields = scanForm(document);
    const csrf = fields.find((f) => f.attributes.name === 'csrf');
    expect(csrf).toBeUndefined();
  });

  it('skips submit buttons', () => {
    const fields = scanForm(document);
    expect(fields.find((f) => f.attributes.type === 'submit')).toBeUndefined();
  });
});

describe('scanForm — italian.html', () => {
  beforeEach(() => {
    loadFixture('italian.html');
  });

  it('finds Italian-labeled fields', () => {
    const fields = scanForm(document);
    expect(fields.length).toBe(8);
    const piva = fields.find((f) => f.attributes.name === 'vat');
    expect(piva!.labels).toContainEqual({
      text: 'Partita IVA',
      source: 'label',
    });
  });

  it('captures textarea as widget', () => {
    const fields = scanForm(document);
    const address = fields.find((f) => f.attributes.name === 'address');
    expect(address!.widget).toEqual({ kind: 'native-textarea' });
  });

  it('captures pattern validation on P.IVA', () => {
    const fields = scanForm(document);
    const piva = fields.find((f) => f.attributes.name === 'vat');
    expect(piva!.validation?.pattern).toBe('\\d{11}');
  });
});
```

- [ ] **Step 4: Run — expect failure**

```bash
npx vitest run tests/unit/form-scanner.test.ts
```

Expected: FAIL.

- [ ] **Step 5: Commit fixtures + tests**

```bash
git add tests/fixtures/forms/ tests/unit/form-scanner.test.ts
git commit -m "test(scanner): HTML form fixtures and failing tests for scanForm"
```

---

## Task 5: Form scanner implementation

**Files:** `src/content/form-scanner.ts`

- [ ] **Step 1: Implement scanner**

Create `src/content/form-scanner.ts`:

```typescript
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
      push((l as HTMLElement).innerText, 'label');
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

function textExcluding(root: HTMLElement, exclude: HTMLElement): string {
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
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  // Also treat `hidden` attribute
  if (el.hasAttribute('hidden')) return true;
  return false;
}

function extractFormTitle(root: Document | ShadowRoot): string | undefined {
  if (!(root instanceof Document)) return undefined;
  const headings = root.querySelectorAll('h1, h2');
  for (const h of Array.from(headings)) {
    const text = (h as HTMLElement).innerText.trim();
    if (text) return text;
  }
  const title = root.title;
  return title && title.trim() !== '' ? title : undefined;
}
```

- [ ] **Step 2: Run — expect pass**

```bash
npx vitest run tests/unit/form-scanner.test.ts tests/unit/widget-detector.test.ts
```

Expected: scanner tests (~14) + widget-detector tests (12) all passing.

- [ ] **Step 3: Commit**

```bash
git add src/content/form-scanner.ts
git commit -m "feat(content): form scanner for native HTML fields with label/validation extraction"
```

---

## Task 6: Form filler (TDD)

**Files:** `src/content/form-filler.ts`, `tests/unit/form-filler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/form-filler.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fillField, type FillAction } from '@/content/form-filler';

function setupForm(): void {
  document.body.innerHTML = `
    <form>
      <input id="txt" type="text" />
      <input id="mail" type="email" />
      <input id="pw" type="password" />
      <input id="num" type="number" />
      <input id="cb" type="checkbox" />
      <input type="radio" name="gender" value="M" id="r1" />
      <input type="radio" name="gender" value="F" id="r2" />
      <select id="sel">
        <option value="">--</option>
        <option value="it">Italy</option>
        <option value="us">United States</option>
      </select>
      <textarea id="ta"></textarea>
      <input id="file" type="file" />
    </form>
  `;
}

describe('fillField — text-like', () => {
  beforeEach(setupForm);

  it('fills text input and dispatches input+change events', async () => {
    const el = document.getElementById('txt') as HTMLInputElement;
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    el.addEventListener('input', inputSpy);
    el.addEventListener('change', changeSpy);

    const action: FillAction = { selector: '#txt', value: 'Antonio' };
    const res = await fillField(action);
    expect(res.ok).toBe(true);
    expect(el.value).toBe('Antonio');
    expect(inputSpy).toHaveBeenCalled();
    expect(changeSpy).toHaveBeenCalled();
  });

  it('fills email input', async () => {
    const el = document.getElementById('mail') as HTMLInputElement;
    await fillField({ selector: '#mail', value: 'a@b.co' });
    expect(el.value).toBe('a@b.co');
  });

  it('fills password input', async () => {
    const el = document.getElementById('pw') as HTMLInputElement;
    await fillField({ selector: '#pw', value: 's3cr3t' });
    expect(el.value).toBe('s3cr3t');
  });

  it('fills number input', async () => {
    const el = document.getElementById('num') as HTMLInputElement;
    await fillField({ selector: '#num', value: '42' });
    expect(el.value).toBe('42');
  });

  it('fills textarea', async () => {
    const el = document.getElementById('ta') as HTMLTextAreaElement;
    await fillField({ selector: '#ta', value: 'Some long text' });
    expect(el.value).toBe('Some long text');
  });
});

describe('fillField — checkbox', () => {
  beforeEach(setupForm);

  it('checks checkbox for truthy value', async () => {
    const el = document.getElementById('cb') as HTMLInputElement;
    const res = await fillField({ selector: '#cb', value: 'true' });
    expect(res.ok).toBe(true);
    expect(el.checked).toBe(true);
  });

  it('unchecks checkbox for falsy value', async () => {
    const el = document.getElementById('cb') as HTMLInputElement;
    el.checked = true;
    const res = await fillField({ selector: '#cb', value: 'false' });
    expect(res.ok).toBe(true);
    expect(el.checked).toBe(false);
  });
});

describe('fillField — radio', () => {
  beforeEach(setupForm);

  it('selects matching radio by value', async () => {
    const res = await fillField({
      selector: 'input[type="radio"][name="gender"]',
      value: 'F',
    });
    expect(res.ok).toBe(true);
    expect((document.getElementById('r1') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('r2') as HTMLInputElement).checked).toBe(true);
  });

  it('returns ok=false when no radio matches', async () => {
    const res = await fillField({
      selector: 'input[type="radio"][name="gender"]',
      value: 'X',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no matching/i);
  });
});

describe('fillField — select', () => {
  beforeEach(setupForm);

  it('selects option by value', async () => {
    const el = document.getElementById('sel') as HTMLSelectElement;
    const res = await fillField({ selector: '#sel', value: 'it' });
    expect(res.ok).toBe(true);
    expect(el.value).toBe('it');
  });

  it('selects option by display text when value mismatch', async () => {
    const el = document.getElementById('sel') as HTMLSelectElement;
    const res = await fillField({ selector: '#sel', value: 'Italy' });
    expect(res.ok).toBe(true);
    expect(el.value).toBe('it');
  });

  it('returns ok=false when no option matches', async () => {
    const res = await fillField({ selector: '#sel', value: 'XY' });
    expect(res.ok).toBe(false);
  });
});

describe('fillField — file', () => {
  beforeEach(setupForm);

  it('skips file input with informational error', async () => {
    const res = await fillField({ selector: '#file', value: '/tmp/foo.pdf' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/file upload/i);
  });
});

describe('fillField — missing element', () => {
  beforeEach(setupForm);

  it('returns ok=false when selector matches nothing', async () => {
    const res = await fillField({ selector: '#missing', value: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/form-filler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement filler**

Create `src/content/form-filler.ts`:

```typescript
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
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/form-filler.test.ts
```

Expected: ~14 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/content/form-filler.ts tests/unit/form-filler.test.ts
git commit -m "feat(content): form filler with React-safe setter and synthetic events"
```

---

## Task 7: Overlay + content entry

**Files:** `src/content/overlay.ts`, `src/content/content-styles.css`, `src/content/content-entry.ts`

- [ ] **Step 1: Create overlay**

Create `src/content/overlay.ts`:

```typescript
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
```

- [ ] **Step 2: Create overlay styles**

Create `src/content/content-styles.css`:

```css
.ufc-mark-certain,
.ufc-mark-uncertain,
.ufc-mark-unmapped,
.ufc-mark-sensitive,
.ufc-mark-skipped {
  outline: 2px solid transparent !important;
  outline-offset: 2px !important;
  transition: outline-color 120ms ease-in-out;
}
.ufc-mark-certain { outline-color: #10b981 !important; }
.ufc-mark-uncertain { outline-color: #f59e0b !important; }
.ufc-mark-unmapped { outline-color: #ef4444 !important; }
.ufc-mark-sensitive { outline-color: #8b5cf6 !important; }
.ufc-mark-skipped { outline-color: #6b7280 !important; }

.ufc-toast {
  position: fixed !important;
  bottom: 16px !important;
  right: 16px !important;
  padding: 10px 14px !important;
  border-radius: 8px !important;
  background: #0f172a !important;
  color: #f1f5f9 !important;
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif !important;
  z-index: 2147483647 !important;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35) !important;
  max-width: 360px !important;
}
.ufc-toast-error {
  background: #7f1d1d !important;
}
```

- [ ] **Step 3: Create content entry**

Create `src/content/content-entry.ts`:

```typescript
import { scanForm } from './form-scanner';
import { fillField, type FillAction } from './form-filler';
import { clearMarks, markField, showToast } from './overlay';
import type { Mapping } from '@/types/mapping';

interface ContentScanRequest {
  type: 'content/scan';
}
interface ContentFillRequest {
  type: 'content/fill';
  mappings: Mapping[];
  valuesById: Record<string, string>;
  selectorsById: Record<string, string>;
}
interface ContentMarkRequest {
  type: 'content/mark';
  marks: { selector: string; status: Mapping['status'] }[];
}
interface ContentClearRequest {
  type: 'content/clear';
}

type ContentRequest =
  | ContentScanRequest
  | ContentFillRequest
  | ContentMarkRequest
  | ContentClearRequest;

chrome.runtime.onMessage.addListener(
  (req: ContentRequest, _sender, sendResponse) => {
    (async () => {
      try {
        switch (req.type) {
          case 'content/scan': {
            const fields = scanForm(document);
            sendResponse({ ok: true, fields });
            return;
          }
          case 'content/fill': {
            const results = [];
            for (const m of req.mappings) {
              const selector = req.selectorsById[m.fieldId];
              const value = req.valuesById[m.fieldId];
              if (!selector || value === undefined) continue;
              const action: FillAction = {
                selector,
                value,
                fieldId: m.fieldId,
              };
              const r = await fillField(action);
              results.push(r);
              markField(selector, r.ok ? m.status : 'skipped');
            }
            showToast(
              `Compilati ${results.filter((r) => r.ok).length}/${results.length} campi`,
            );
            sendResponse({ ok: true, results });
            return;
          }
          case 'content/mark': {
            for (const m of req.marks) markField(m.selector, m.status);
            sendResponse({ ok: true });
            return;
          }
          case 'content/clear': {
            clearMarks();
            sendResponse({ ok: true });
            return;
          }
        }
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    })();
    return true; // async
  },
);

console.log('[UFC] content script ready');
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/content/overlay.ts src/content/content-styles.css src/content/content-entry.ts
git commit -m "feat(content): overlay marks + toast + content script message entry"
```

---

## Task 8: Extend message contract

**Files:** `src/types/messages.ts`

- [ ] **Step 1: Append new message types**

Append to `src/types/messages.ts` before the `PopupRequest`/`PopupResponse` unions:

```typescript
// --- Compile flow (popup ↔ background) ---

export type StartCompileRequest = { type: 'compile/start' };
export type StartCompileResponse =
  | {
      ok: true;
      fields: unknown[];       // FieldDescriptor[], serialized
      proposal: unknown[];     // Mapping[], serialized
      tokensUsed: number;
    }
  | { ok: false; error: string };

export type ConfirmCompileRequest = {
  type: 'compile/confirm';
  mappings: unknown[];         // user-edited Mapping[]
};
export type ConfirmCompileResponse =
  | { ok: true; results: { fieldId: string; ok: boolean; error?: string }[] }
  | { ok: false; error: string };

export type ClearMarksRequest = { type: 'compile/clearMarks' };
export type ClearMarksResponse = { ok: true };
```

Extend the unions:

```typescript
export type PopupRequest =
  | GetVaultStateRequest
  | CreateVaultRequest
  | UnlockVaultRequest
  | LockVaultRequest
  | DeleteVaultRequest
  | GetSettingsRequest
  | SaveSettingsRequest
  | ImportFileRequest
  | GetCanonicalDataRequest
  | SaveCanonicalDataRequest
  | StartCompileRequest
  | ConfirmCompileRequest
  | ClearMarksRequest;

export type PopupResponse =
  | GetVaultStateResponse
  | CreateVaultResponse
  | UnlockVaultResponse
  | LockVaultResponse
  | DeleteVaultResponse
  | GetSettingsResponse
  | SaveSettingsResponse
  | ImportFileResponse
  | GetCanonicalDataResponse
  | SaveCanonicalDataResponse
  | StartCompileResponse
  | ConfirmCompileResponse
  | ClearMarksResponse;
```

Extend `ResponseFor`:

```typescript
export type ResponseFor<R extends PopupRequest> =
  R extends GetVaultStateRequest ? GetVaultStateResponse :
  R extends CreateVaultRequest ? CreateVaultResponse :
  R extends UnlockVaultRequest ? UnlockVaultResponse :
  R extends LockVaultRequest ? LockVaultResponse :
  R extends DeleteVaultRequest ? DeleteVaultResponse :
  R extends GetSettingsRequest ? GetSettingsResponse :
  R extends SaveSettingsRequest ? SaveSettingsResponse :
  R extends ImportFileRequest ? ImportFileResponse :
  R extends GetCanonicalDataRequest ? GetCanonicalDataResponse :
  R extends SaveCanonicalDataRequest ? SaveCanonicalDataResponse :
  R extends StartCompileRequest ? StartCompileResponse :
  R extends ConfirmCompileRequest ? ConfirmCompileResponse :
  R extends ClearMarksRequest ? ClearMarksResponse :
  never;
```

- [ ] **Step 2: Typecheck** (transient failure expected until Task 10 adds the SW handlers)

```bash
npm run typecheck
```

Expected: transient error on service-worker exhaustiveness — fixed in Task 10.

- [ ] **Step 3: Commit**

```bash
git add src/types/messages.ts
git commit -m "feat(types): compile-flow message types"
```

---

## Task 9: Mapping prompt + orchestrator (TDD)

**Files:** `src/background/mapping-prompt.ts`, `src/background/orchestrator.ts`, `tests/unit/mapping-prompt.test.ts`, `tests/unit/orchestrator.test.ts`

- [ ] **Step 1: Create mapping prompt module**

Create `src/background/mapping-prompt.ts`:

```typescript
import type { FieldDescriptor } from '@/types/field';

export const MAPPING_SYSTEM_PROMPT = `You match web form fields to keys from a user's canonical data dictionary.
Rules:
- You receive a list of form fields (each with a stable id, widget type, labels, attributes, options, validation, context) and a list of available canonical keys (dotted paths).
- For EACH field, output exactly one mapping entry: {fieldId, canonicalKey|null, confidence (0..1), note?}.
- confidence ≥ 0.8 means certain; 0.5-0.79 uncertain; <0.5 means unmapped (return canonicalKey=null).
- NEVER invent canonical keys — use only those provided.
- You do NOT see user values. Match by semantics alone (label text, attribute names, widget type).
- For radio/select: the canonical key's value will be matched against options later; focus on the field semantics.
- Skip file inputs (return null, note "file upload").
- If multiple fields semantically match the same canonical key (e.g., two email fields), pick the best match and return null for the others with a note explaining.
- Italian labels: "Nome" → person.first_name, "Cognome" → person.last_name, "Partita IVA" → company.vat_number, "Codice Fiscale" (context company) → company.tax_code, "PEC" → contact.pec.`;

export const MAPPING_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['mappings'],
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fieldId', 'canonicalKey', 'confidence'],
        properties: {
          fieldId: { type: 'string' },
          canonicalKey: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          note: { type: 'string' },
        },
      },
    },
  },
};

export function buildMappingUserPrompt(
  fields: FieldDescriptor[],
  availableKeys: string[],
): string {
  const fieldsJson = JSON.stringify(
    fields.map((f) => ({
      id: f.id,
      widget: f.widget,
      labels: f.labels,
      attributes: f.attributes,
      options: f.options,
      validation: f.validation,
      context: f.context,
    })),
    null,
    2,
  );
  const keysJson = JSON.stringify(availableKeys);
  return `Available canonical keys:\n${keysJson}\n\nFields to map:\n${fieldsJson}`;
}
```

- [ ] **Step 2: Write tests for prompt**

Create `tests/unit/mapping-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildMappingUserPrompt,
  MAPPING_RESPONSE_SCHEMA,
  MAPPING_SYSTEM_PROMPT,
} from '@/background/mapping-prompt';
import type { FieldDescriptor } from '@/types/field';

describe('mapping prompt', () => {
  it('MAPPING_SYSTEM_PROMPT is non-empty', () => {
    expect(MAPPING_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('schema declares mappings array of {fieldId, canonicalKey, confidence}', () => {
    expect(MAPPING_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
      properties: {
        mappings: {
          type: 'array',
          items: expect.objectContaining({
            required: expect.arrayContaining(['fieldId', 'canonicalKey', 'confidence']),
          }),
        },
      },
    });
  });

  it('buildMappingUserPrompt includes fields and keys as JSON', () => {
    const fields: FieldDescriptor[] = [
      {
        id: 'ufc-1',
        selector: '#a',
        widget: { kind: 'native-input', type: 'email' },
        labels: [{ text: 'Email', source: 'label' }],
        attributes: { name: 'email', type: 'email' },
        context: {},
      },
    ];
    const prompt = buildMappingUserPrompt(fields, ['person.first_name', 'contact.email']);
    expect(prompt).toContain('contact.email');
    expect(prompt).toContain('ufc-1');
    expect(prompt).toContain('"labels"');
  });
});
```

- [ ] **Step 3: Run — expect pass (or fail+pass if implementation needs fix)**

```bash
npx vitest run tests/unit/mapping-prompt.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 4: Write orchestrator tests**

Create `tests/unit/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { computeProposal, resolveValue } from '@/background/orchestrator';
import type { FieldDescriptor } from '@/types/field';
import type { AIClient } from '@/background/ai-client';
import type { CanonicalData } from '@/lib/canonical-schema';

const makeAI = (result: unknown, usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }): Pick<AIClient, 'structuredCompletion'> => ({
  structuredCompletion: vi.fn().mockResolvedValue({ data: result, usage }),
});

function sampleFields(): FieldDescriptor[] {
  return [
    {
      id: 'ufc-1',
      selector: '#fn',
      widget: { kind: 'native-input', type: 'text' },
      labels: [{ text: 'First name', source: 'label' }],
      attributes: { name: 'first_name' },
      context: {},
    },
    {
      id: 'ufc-2',
      selector: '#em',
      widget: { kind: 'native-input', type: 'email' },
      labels: [{ text: 'Email', source: 'label' }],
      attributes: { name: 'email' },
      context: {},
    },
    {
      id: 'ufc-3',
      selector: '#pw',
      widget: { kind: 'native-input', type: 'password' },
      labels: [{ text: 'Password', source: 'label' }],
      attributes: { name: 'password' },
      context: {},
    },
  ];
}

function sampleData(): CanonicalData {
  return {
    version: 1,
    person: { first_name: 'Antonio', last_name: 'Rossi' },
    contact: { email: 'antonio@example.com' },
  };
}

describe('computeProposal', () => {
  it('calls AI with non-sensitive fields and returns mappings with values and statuses', async () => {
    const ai = makeAI({
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: 'person.first_name', confidence: 0.95 },
        { fieldId: 'ufc-2', canonicalKey: 'contact.email', confidence: 0.9 },
      ],
    });
    const result = await computeProposal(sampleFields(), sampleData(), { ai });

    const fn = result.proposal.find((m) => m.fieldId === 'ufc-1')!;
    expect(fn.canonicalKey).toBe('person.first_name');
    expect(fn.status).toBe('certain');
    expect(fn.displayValuePreview).toBe('Antonio');

    const em = result.proposal.find((m) => m.fieldId === 'ufc-2')!;
    expect(em.displayValuePreview).toBe('antonio@example.com');

    // Password field handled locally (not from AI), marked as sensitive-local with null value
    const pw = result.proposal.find((m) => m.fieldId === 'ufc-3')!;
    expect(pw.status).toBe('unmapped'); // no credentials stored for this host in sample data
  });

  it('marks uncertain for confidence between 0.5 and 0.8', async () => {
    const ai = makeAI({
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: 'person.first_name', confidence: 0.6 },
      ],
    });
    const fields = sampleFields().slice(0, 1);
    const result = await computeProposal(fields, sampleData(), { ai });
    expect(result.proposal[0]!.status).toBe('uncertain');
  });

  it('marks unmapped for null canonicalKey or low confidence', async () => {
    const ai = makeAI({
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: null, confidence: 0.0 },
      ],
    });
    const fields = sampleFields().slice(0, 1);
    const result = await computeProposal(fields, sampleData(), { ai });
    expect(result.proposal[0]!.status).toBe('unmapped');
    expect(result.proposal[0]!.canonicalKey).toBeNull();
  });

  it('masks sensitive values in preview even when mapped', async () => {
    const ai = makeAI({ mappings: [] });
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
      banking: { iban: 'IT60X0542811101000000123456' },
    };
    const fields: FieldDescriptor[] = [
      {
        id: 'ufc-iban',
        selector: '#iban',
        widget: { kind: 'native-input', type: 'text' },
        labels: [{ text: 'IBAN', source: 'label' }],
        attributes: { name: 'iban' },
        context: {},
      },
    ];
    const result = await computeProposal(fields, data, { ai });
    // Sensitive-local heuristic should map by name "iban" → banking.iban
    const m = result.proposal[0]!;
    expect(m.status).toBe('sensitive-local');
    expect(m.displayValuePreview).toMatch(/•/);
    expect(m.canonicalKey).toBe('banking.iban');
  });
});

describe('resolveValue', () => {
  it('resolves dotted path to value', () => {
    const data = sampleData();
    expect(resolveValue(data, 'person.first_name')).toBe('Antonio');
    expect(resolveValue(data, 'contact.email')).toBe('antonio@example.com');
    expect(resolveValue(data, 'does.not.exist')).toBe('');
  });

  it('resolves array index', () => {
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
      payment_cards: [
        { label: 'primary', number: '4111', expiry: '12/26', cvv: '123', holder: 'A B' },
      ],
    };
    expect(resolveValue(data, 'payment_cards[0].number')).toBe('4111');
  });
});
```

- [ ] **Step 5: Implement orchestrator**

Create `src/background/orchestrator.ts`:

```typescript
import type { AIClient } from './ai-client';
import {
  MAPPING_SYSTEM_PROMPT,
  MAPPING_RESPONSE_SCHEMA,
  buildMappingUserPrompt,
} from './mapping-prompt';
import type { FieldDescriptor } from '@/types/field';
import type { Mapping, MappingStatus } from '@/types/mapping';
import {
  listAvailableKeys,
  isSensitivePath,
  type CanonicalData,
} from '@/lib/canonical-schema';

export interface OrchestratorDeps {
  ai: Pick<AIClient, 'structuredCompletion'>;
}

export interface ProposalResult {
  proposal: Mapping[];
  tokensUsed: number;
}

export async function computeProposal(
  fields: FieldDescriptor[],
  data: CanonicalData,
  deps: OrchestratorDeps,
): Promise<ProposalResult> {
  // Phase 1: local matching for sensitive fields + file inputs
  const local: Mapping[] = [];
  const remaining: FieldDescriptor[] = [];

  for (const f of fields) {
    const sensitive = matchSensitiveLocally(f, data);
    if (sensitive) {
      local.push(sensitive);
      continue;
    }
    if (f.widget.kind === 'native-input' && f.widget.type === 'file') {
      local.push({
        fieldId: f.id,
        canonicalKey: null,
        displayValuePreview: '',
        status: 'skipped',
        confidence: 0,
        note: 'File upload must be selected manually',
      });
      continue;
    }
    remaining.push(f);
  }

  // Phase 2: AI mapping for non-sensitive
  const availableKeys = listAvailableKeys(data);
  let tokensUsed = 0;
  const aiMappings: Mapping[] = [];

  if (remaining.length > 0 && availableKeys.length > 0) {
    const res = await deps.ai.structuredCompletion<{
      mappings: {
        fieldId: string;
        canonicalKey: string | null;
        confidence: number;
        note?: string;
      }[];
    }>({
      system: MAPPING_SYSTEM_PROMPT,
      user: buildMappingUserPrompt(remaining, availableKeys),
      schema: MAPPING_RESPONSE_SCHEMA,
      schemaName: 'FieldMapping',
      temperature: 0,
    });
    tokensUsed = res.usage.total_tokens;

    for (const f of remaining) {
      const found = res.data.mappings.find((m) => m.fieldId === f.id);
      if (!found) {
        aiMappings.push({
          fieldId: f.id,
          canonicalKey: null,
          displayValuePreview: '',
          status: 'unmapped',
          confidence: 0,
          note: 'AI did not return a mapping',
        });
        continue;
      }
      const status = statusFromConfidence(found.canonicalKey, found.confidence);
      const value =
        status !== 'unmapped' && found.canonicalKey
          ? resolveValue(data, found.canonicalKey)
          : '';
      aiMappings.push({
        fieldId: f.id,
        canonicalKey: found.canonicalKey,
        displayValuePreview: value,
        status,
        confidence: found.confidence,
        note: found.note,
      });
    }
  } else {
    for (const f of remaining) {
      aiMappings.push({
        fieldId: f.id,
        canonicalKey: null,
        displayValuePreview: '',
        status: 'unmapped',
        confidence: 0,
        note: 'No canonical data available',
      });
    }
  }

  return {
    proposal: [...local, ...aiMappings],
    tokensUsed,
  };
}

function statusFromConfidence(
  canonicalKey: string | null,
  confidence: number,
): MappingStatus {
  if (canonicalKey === null) return 'unmapped';
  if (confidence >= 0.8) return 'certain';
  if (confidence >= 0.5) return 'uncertain';
  return 'unmapped';
}

function matchSensitiveLocally(
  f: FieldDescriptor,
  data: CanonicalData,
): Mapping | null {
  const name = (f.attributes.name ?? '').toLowerCase();
  const id = (f.attributes.id ?? '').toLowerCase();
  const autocomplete = (f.attributes.autocomplete ?? '').toLowerCase();
  const type = f.widget.kind === 'native-input' ? f.widget.type : '';

  // Password field → credentials for current host
  if (type === 'password') {
    // No host available in scan result here; just mark sensitive-local unmapped
    // (full implementation wires host through content→popup→background in 1d)
    return {
      fieldId: f.id,
      canonicalKey: null,
      displayValuePreview: '',
      status: 'sensitive-local',
      confidence: 0,
      note: 'Password field — site-specific credentials not stored yet',
    };
  }

  // IBAN
  if (name.includes('iban') || id.includes('iban') || hasLabel(f, /\biban\b/i)) {
    if (data.banking?.iban) {
      return {
        fieldId: f.id,
        canonicalKey: 'banking.iban',
        displayValuePreview: maskSensitive(data.banking.iban),
        status: 'sensitive-local',
        confidence: 0.95,
      };
    }
  }

  // Credit card number
  if (autocomplete === 'cc-number' || autocomplete === 'cc-csc') {
    const card = data.payment_cards?.[0];
    if (!card) return null;
    const key =
      autocomplete === 'cc-csc'
        ? 'payment_cards[0].cvv'
        : 'payment_cards[0].number';
    const value = autocomplete === 'cc-csc' ? card.cvv : card.number;
    return {
      fieldId: f.id,
      canonicalKey: key,
      displayValuePreview: maskSensitive(value),
      status: 'sensitive-local',
      confidence: 0.95,
    };
  }

  return null;
}

function hasLabel(f: FieldDescriptor, re: RegExp): boolean {
  return f.labels.some((l) => re.test(l.text));
}

function maskSensitive(s: string): string {
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

export function resolveValue(data: CanonicalData, path: string): string {
  // Handles dotted paths with optional [n] index segments
  const parts = path.split(/\.|\[(\d+)\]/).filter((p) => p !== undefined && p !== '');
  let current: unknown = data;
  for (const p of parts) {
    if (current === null || current === undefined) return '';
    if (typeof current !== 'object') return '';
    if (Array.isArray(current)) {
      const idx = Number(p);
      if (Number.isNaN(idx)) return '';
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[p];
    }
  }
  if (current === null || current === undefined) return '';
  return String(current);
}

// Overload for mapping plumbing: given a value preview that may be masked
// (for sensitive-local), the fill layer needs the real value. This helper
// is used to pull real values when ready to fill.
export function resolveRealValue(
  data: CanonicalData,
  path: string | null,
): string {
  if (!path) return '';
  if (isSensitivePath(path)) {
    return resolveValue(data, path);
  }
  return resolveValue(data, path);
}
```

- [ ] **Step 6: Run — expect pass**

```bash
npx vitest run tests/unit/orchestrator.test.ts tests/unit/mapping-prompt.test.ts
```

Expected: ~9 tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/background/mapping-prompt.ts src/background/orchestrator.ts tests/unit/mapping-prompt.test.ts tests/unit/orchestrator.test.ts
git commit -m "feat(background): orchestrator computes proposal via AI + local sensitive matching"
```

---

## Task 10: Wire compile handlers in service worker

**Files:** `src/background/service-worker.ts`

- [ ] **Step 1: Extend handlers**

Modify `src/background/service-worker.ts`:

Add imports at top:

```typescript
import { computeProposal, resolveRealValue } from './orchestrator';
import type { FieldDescriptor } from '@/types/field';
import type { Mapping } from '@/types/mapping';
```

Add module-level pending-proposal state (the compile flow spans two popup calls):

```typescript
interface PendingProposal {
  tabId: number;
  fields: FieldDescriptor[];
  proposal: Mapping[];
}
let pendingProposal: PendingProposal | null = null;

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}
```

Add new cases in the `handleRequest` switch before the closing brace:

```typescript
    case 'compile/start': {
      try {
        const pw = requirePassword();
        const cfg = await readSecretConfig(pw);
        if (!cfg?.apiKey) {
          return { ok: false, error: 'OpenAI API key not configured' };
        }
        const canonical = await readCanonicalData(pw);
        if (!canonical) {
          return {
            ok: false,
            error: 'No canonical data imported yet — run the setup wizard',
          };
        }
        const tabId = await activeTabId();
        const scanRes = (await chrome.tabs.sendMessage(tabId, {
          type: 'content/scan',
        })) as { ok: true; fields: FieldDescriptor[] } | { ok: false; error: string };
        if (!('ok' in scanRes) || !scanRes.ok) {
          return {
            ok: false,
            error:
              'ok' in scanRes
                ? (scanRes as { error: string }).error
                : 'Scan failed (content script not responding)',
          };
        }
        const ai = createAIClient({ apiKey: cfg.apiKey, model: cfg.model });
        const proposalResult = await computeProposal(
          scanRes.fields,
          canonical,
          { ai },
        );
        pendingProposal = {
          tabId,
          fields: scanRes.fields,
          proposal: proposalResult.proposal,
        };
        await chrome.tabs.sendMessage(tabId, {
          type: 'content/mark',
          marks: proposalResult.proposal.map((m) => {
            const field = scanRes.fields.find((f) => f.id === m.fieldId);
            return {
              selector: field?.selector ?? '',
              status: m.status,
            };
          }),
        });
        return {
          ok: true,
          fields: scanRes.fields,
          proposal: proposalResult.proposal,
          tokensUsed: proposalResult.tokensUsed,
        };
      } catch (err) {
        return { ok: false, error: formatAIError(err) };
      }
    }

    case 'compile/confirm': {
      try {
        const pw = requirePassword();
        const canonical = await readCanonicalData(pw);
        if (!canonical) return { ok: false, error: 'No data' };
        if (!pendingProposal) return { ok: false, error: 'No pending proposal' };
        const mappings = req.mappings as Mapping[];
        const valuesById: Record<string, string> = {};
        const selectorsById: Record<string, string> = {};
        for (const m of mappings) {
          const field = pendingProposal.fields.find((f) => f.id === m.fieldId);
          if (!field) continue;
          selectorsById[m.fieldId] = field.selector;
          valuesById[m.fieldId] = resolveRealValue(canonical, m.canonicalKey);
        }
        const fillRes = (await chrome.tabs.sendMessage(pendingProposal.tabId, {
          type: 'content/fill',
          mappings,
          valuesById,
          selectorsById,
        })) as {
          ok: true;
          results: { fieldId: string; ok: boolean; error?: string }[];
        };
        pendingProposal = null;
        return { ok: true, results: fillRes.results };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Unknown' };
      }
    }

    case 'compile/clearMarks': {
      try {
        const tabId = await activeTabId();
        await chrome.tabs.sendMessage(tabId, { type: 'content/clear' });
        pendingProposal = null;
      } catch {
        // ignore
      }
      return { ok: true };
    }
```

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: both succeed. The build now includes content scripts in the output bundle.

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat(background): compile/start, compile/confirm, compile/clearMarks handlers"
```

---

## Task 11: Dry-run popup view

**Files:** `src/popup/views/dry-run.ts`

- [ ] **Step 1: Create dry-run view**

Create `src/popup/views/dry-run.ts`:

```typescript
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
                ${m.status === 'unmapped' || m.status === 'skipped' ? 'Salta' : 'Salta'}
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
        await chrome.runtime.sendMessage({
          type: 'compile/clearMarks',
        } as ClearMarksRequest) as ClearMarksResponse;
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/popup/views/dry-run.ts
git commit -m "feat(popup): dry-run view for reviewing and confirming the mapping"
```

---

## Task 12: Wire "Compile this form" into main view + router

**Files:** `src/popup/views/router.ts`, `src/popup/views/main.ts`, `src/popup/main.ts`

- [ ] **Step 1: Add dry-run to ViewId**

Modify `src/popup/views/router.ts` — update the `ViewId` union:

```typescript
export type ViewId = 'setup-wizard' | 'unlock' | 'main' | 'settings' | 'dry-run';
```

- [ ] **Step 2: Add compile button to main view**

Modify `src/popup/views/main.ts` — the factory now also accepts `onCompile`:

```typescript
import type { ViewRenderer } from './router';
import type {
  GetCanonicalDataRequest,
  GetCanonicalDataResponse,
} from '@/types/messages';

export function createMainView(
  onLock: () => Promise<void>,
  onSettings: () => Promise<void>,
  onReimport: () => Promise<void>,
  onCompile: () => Promise<void>,
): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      const canonical = (await chrome.runtime.sendMessage({
        type: 'canonical/get',
      } as GetCanonicalDataRequest)) as GetCanonicalDataResponse;
      const hasData = canonical.data !== null;

      container.innerHTML = `
        <h1>Universal Form Compiler</h1>
        <p class="muted">
          ${hasData ? 'Vault sbloccato e dati pronti.' : 'Vault sbloccato, ma nessun dato importato.'}
        </p>

        <div class="actions">
          <button id="compile-btn" ${!hasData ? 'disabled' : ''}>Compila questo form</button>
        </div>

        <div class="actions" style="margin-top:8px">
          <button id="reimport-btn" class="secondary">
            ${hasData ? 'Re-importa dati' : 'Importa dati'}
          </button>
          <button id="settings-btn" class="secondary">Impostazioni</button>
        </div>
        <div class="actions" style="margin-top:8px">
          <button id="lock-btn" class="secondary">Lock vault</button>
        </div>
      `;

      container.querySelector<HTMLButtonElement>('#compile-btn')!
        .addEventListener('click', async () => { await onCompile(); });
      container.querySelector<HTMLButtonElement>('#lock-btn')!
        .addEventListener('click', async () => { await onLock(); });
      container.querySelector<HTMLButtonElement>('#settings-btn')!
        .addEventListener('click', async () => { await onSettings(); });
      container.querySelector<HTMLButtonElement>('#reimport-btn')!
        .addEventListener('click', async () => { await onReimport(); });
    },
  };
}
```

- [ ] **Step 3: Wire compile flow in popup main**

Modify `src/popup/main.ts`. Add imports at the top:

```typescript
import { createDryRunView } from './views/dry-run';
import type {
  StartCompileRequest,
  StartCompileResponse,
} from '@/types/messages';
```

Add `goCompile` function inside `boot()` (after `reImport`):

```typescript
  async function goCompile(): Promise<void> {
    container.innerHTML = '<p class="muted">Analizzo il form…</p>';
    const res = (await chrome.runtime.sendMessage({
      type: 'compile/start',
    } as StartCompileRequest)) as StartCompileResponse;
    if (!res.ok) {
      container.innerHTML = `
        <h1>Errore</h1>
        <p class="error">${escapeHtml(res.error)}</p>
        <div class="actions">
          <button id="back-btn" class="secondary">Indietro</button>
        </div>
      `;
      const back = container.querySelector<HTMLButtonElement>('#back-btn');
      back?.addEventListener('click', () => { void routeByState(); });
      return;
    }
    const view = createDryRunView(
      res.fields as { id: string; labels: { text: string; source: string }[]; attributes: { name?: string } }[],
      res.proposal as never,
      res.tokensUsed,
      goMain,
    );
    await view.render(container);
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
```

Update `main` factory call to pass `goCompile`:

```typescript
    main: () =>
      createMainView(
        async () => {
          await lockVault();
          await routeByState();
        },
        goSettings,
        reImport,
        goCompile,
      ),
```

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: both succeed. Build output should now include a content script bundle.

- [ ] **Step 5: Commit**

```bash
git add src/popup/views/router.ts src/popup/views/main.ts src/popup/main.ts
git commit -m "feat(popup): compile button + dry-run flow wired into main router"
```

---

## Task 13: Full verification + manual Chrome smoke test

**Files:** none

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: ~100+ tests passing (75 from 1a+1b + 12 widget detector + 14+ form-scanner + 14+ form-filler + 9+ orchestrator + 3 mapping-prompt = ~127).

- [ ] **Step 2: Typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: no errors; `dist/` produced with both service worker and content script bundles.

- [ ] **Step 3: Commit plan file**

```bash
git add docs/superpowers/plans/2026-04-24-ufc-phase-1c-compile-mvp.md
git commit -m "docs: add Phase 1c implementation plan"
```

- [ ] **Step 4: Manual smoke test in Chrome**

1. Reload extension at `chrome://extensions/` from `dist/`
2. Open the basic test fixture: `file://.../tests/fixtures/forms/basic.html` (or serve it with `python3 -m http.server` and navigate to `http://localhost:8000/tests/fixtures/forms/basic.html`)
3. Unlock the vault (must have been set up in Phase 1b — if not, run through setup wizard and import canonical data first)
4. Click the extension icon → popup shows main view with "Compila questo form"
5. Click "Compila questo form"
6. Popup shows "Analizzo il form…" then switches to dry-run view with list of fields and their proposed mappings
7. Page shows colored borders: green on certain matches, yellow on uncertain, red on unmapped, purple on sensitive
8. Toggle "Salta" buttons to skip any field you don't want filled
9. Click "Compila" → fields populate in the page, toast shows "Compilati X/Y campi"
10. Click "Annulla" on the dry-run instead → colored borders clear

- [ ] **Step 5: Tag phase**

```bash
git tag phase-1c-complete
git log --oneline | head -50
```

---

## Phase 1c Deliverables

- Content scripts: form scanner, widget detector (native only), form filler, overlay
- Orchestrator: local sensitive matching + AI semantic mapping via structured completion
- Dry-run popup view with per-field skip toggles
- Main view "Compile this form" button
- Typed end-to-end message contract (popup → bg → content and back)
- ~50 new unit tests (total ~127)
- **The extension can auto-fill HTML native forms end-to-end.**

**Next:** Phase 2 expands the widget detector to MUI, Ant, Bootstrap, date pickers, rich text; adds Shadow DOM + iframe traversal; adds MutationObserver for dynamic fields; adds wizard multi-step navigation; adds the opt-in cache with site fingerprinting.

---

## Self-Review Notes

**Spec coverage for Phase 1c (M4-M6):**
- M4 scanner → Tasks 3-5
- M5 orchestrator + AI mapping → Tasks 8-10 (+ message types, background wiring)
- M6 filler → Task 6
- M6 dry-run UI → Tasks 11-12

**Placeholder scan:** none.

**Type consistency:** `FieldDescriptor`, `Mapping`, `WidgetType`, `MappingStatus` defined once and referenced consistently across scanner/filler/orchestrator/popup.

**Scope check:** Focused on HTML native. Tier C features (UI libraries, Shadow DOM, iframes, rich text, wizard, MutationObserver) explicitly deferred to Phase 2 and listed in "Not in 1c" at the top.

**Known limitations carried forward into Phase 2:**
- Password fields are flagged sensitive-local but never auto-filled (need site-hostname plumbing from content script up to orchestrator for credentials lookup)
- `all_frames: false` means iframes are ignored — broadens to `true` in Phase 2 with same-origin check
- No MutationObserver yet, so dynamic fields appearing after interaction won't be rescanned
- `resolveRealValue` and `resolveValue` are duplicated — cleanup when value-masking is refactored
