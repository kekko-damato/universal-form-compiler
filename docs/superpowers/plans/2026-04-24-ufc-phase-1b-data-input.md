# UFC Phase 1b — Data Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI client (OpenAI wrapper with retry + tool use), canonical JSON schema with Zod validation, and a file importer that normalizes user-uploaded DOCX/CSV/YAML into canonical JSON via AI. Extend the setup wizard from Phase 1a (which currently only creates a password) into a three-step flow: password → file+API-key → review/edit. At the end of Phase 1b, the user can walk through the setup, import their data, review the result, and land on the (still placeholder) main view with a populated encrypted vault ready for Phase 1c.

**Architecture:** The AI client is `fetch`-based (no SDK dependency — SDKs tend to rely on Node builtins that MV3 service workers don't have). OpenAI's JSON Schema-constrained structured outputs (response_format `json_schema`) is used in lieu of tool use for importer calls, because the importer always returns a single typed object. Retry wraps the fetch with exponential backoff and honors `Retry-After`. The canonical schema lives in `src/lib/canonical-schema.ts` as a single source of truth: Zod for runtime validation, inferred `CanonicalData` type for compile-time. Sensitive-field paths are a declarative list exported from the same module. The importer pipeline is: detect format → extract text → call AI with prompt+schema → parse → Zod validate → return CanonicalData. The popup setup wizard is restructured around a step controller that persists state in memory between steps.

**Tech Stack additions:** `mammoth` (DOCX text extraction), `js-yaml` (YAML parsing), `papaparse` (CSV parsing). All are pure-JS, bundle cleanly in Vite, work in extension context.

**Reference spec:** [docs/superpowers/specs/2026-04-24-universal-form-compiler-design.md](../specs/2026-04-24-universal-form-compiler-design.md)

**Scope:** Milestones M2 (AI client) and M3 (schema + importer + setup wizard) from the spec. **Not** in Phase 1b: form scanner, form filler, dry-run, content scripts, cache. Those are in Phase 1c.

---

## File Structure

### Created in Phase 1b

| File | Responsibility |
|---|---|
| `src/types/canonical.ts` | `CanonicalData` types (inferred from Zod schema) |
| `src/lib/canonical-schema.ts` | Zod schema + `SENSITIVE_FIELD_PATHS` registry |
| `src/lib/docx-text.ts` | DOCX → plain text via `mammoth` |
| `src/lib/csv-parse.ts` | CSV → flat key/value pairs via `papaparse` |
| `src/lib/yaml-parse.ts` | YAML → JS object via `js-yaml` |
| `src/lib/importer.ts` | Orchestrates extract → AI normalize → validate |
| `src/background/ai-client.ts` | OpenAI fetch wrapper with retry and structured-output support |
| `src/popup/views/setup-wizard.ts` | Step controller replacing the Phase 1a setup-password view |
| `src/popup/views/wizard-step-password.ts` | Wizard step 1 (password creation) |
| `src/popup/views/wizard-step-import.ts` | Wizard step 2 (file + API key + model) |
| `src/popup/views/wizard-step-review.ts` | Wizard step 3 (edit canonical JSON, confirm) |
| `src/popup/views/settings.ts` | Standalone settings view (API key, model, budget, timeout) |
| `tests/unit/canonical-schema.test.ts` | Schema validation + sensitive-field registry tests |
| `tests/unit/ai-client.test.ts` | AI client tests (mock fetch) |
| `tests/unit/docx-text.test.ts` | DOCX extraction (skipped if fixture missing) |
| `tests/unit/csv-parse.test.ts` | CSV parser tests |
| `tests/unit/yaml-parse.test.ts` | YAML parser tests |
| `tests/unit/importer.test.ts` | Importer pipeline tests (mock AI, real parsers) |
| `tests/fixtures/sample.docx` | Small DOCX with a few key:value lines (hand-created) |
| `tests/fixtures/sample.csv` | Small CSV |
| `tests/fixtures/sample.yaml` | Small YAML |

### Modified in Phase 1b

| File | Change |
|---|---|
| `src/types/messages.ts` | Add AI/import/vault-write/settings message types |
| `src/background/service-worker.ts` | Add handlers for new messages; import AI client |
| `src/lib/vault.ts` | Extend `VaultData` to include `apiKey`, `model`, and canonical `data` payload; add typed getters/setters |
| `src/popup/main.ts` | Add routing for `settings` view; route `no_vault` → `setup-wizard` instead of old `setup-password` |
| `src/popup/views/main.ts` | Add a "Settings" button and a "Re-import data" button (wizard re-entry) |
| `package.json` | Add runtime deps: `mammoth`, `js-yaml`, `papaparse` + types |

### Removed in Phase 1b

| File | Reason |
|---|---|
| `src/popup/views/setup-password.ts` | Subsumed by `setup-wizard` step 1 |

---

## Task 1: Install runtime dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install dependencies**

```bash
cd "/Users/kekko/Desktop/Lavoro/RDD-Italia/Bando Disegni/Compiler V2"
npm install mammoth@^1.6.0 js-yaml@^4.1.0 papaparse@^5.4.1
npm install -D @types/js-yaml@^4.0.9 @types/papaparse@^5.3.14
```

- [ ] **Step 2: Verify versions**

```bash
npm ls mammoth js-yaml papaparse @types/js-yaml @types/papaparse
```

Expected: one version line per package, no `UNMET DEPENDENCY`.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mammoth, js-yaml, papaparse for importer"
```

---

## Task 2: Canonical schema with Zod (TDD)

**Files:** `src/lib/canonical-schema.ts`, `src/types/canonical.ts`, `tests/unit/canonical-schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/canonical-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  CanonicalDataSchema,
  SENSITIVE_FIELD_PATHS,
  validateCanonical,
  listAvailableKeys,
  isSensitivePath,
} from '@/lib/canonical-schema';

describe('canonical schema', () => {
  it('accepts minimal valid data', () => {
    const data = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' },
      contact: { email: 'a.rossi@example.com' },
    };
    const result = CanonicalDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'not-an-email' },
    };
    expect(CanonicalDataSchema.safeParse(data).success).toBe(false);
  });

  it('rejects invalid birth_date (not ISO YYYY-MM-DD)', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B', birth_date: '05/03/1990' },
      contact: { email: 'a@b.co' },
    };
    expect(CanonicalDataSchema.safeParse(data).success).toBe(false);
  });

  it('accepts unknown extra fields in custom.*', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
      custom: { horse_name: 'Thunder', lucky_number: 7 },
    };
    expect(CanonicalDataSchema.safeParse(data).success).toBe(true);
  });

  it('version must be literal 1', () => {
    const data = {
      version: 2,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
    };
    expect(CanonicalDataSchema.safeParse(data).success).toBe(false);
  });
});

describe('validateCanonical', () => {
  it('returns parsed data on success', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
    };
    const result = validateCanonical(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.person.first_name).toBe('A');
    }
  });

  it('returns structured error list on failure', () => {
    const data = {
      version: 1,
      person: { first_name: '', last_name: 'B' },
      contact: { email: 'bad' },
    };
    const result = validateCanonical(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty('path');
      expect(result.errors[0]).toHaveProperty('message');
    }
  });
});

describe('SENSITIVE_FIELD_PATHS', () => {
  it('includes known sensitive paths', () => {
    expect(SENSITIVE_FIELD_PATHS).toEqual(
      expect.arrayContaining([
        'credentials.*.password',
        'payment_cards[*].number',
        'payment_cards[*].cvv',
        'banking.iban',
        'documents.passport_number',
        'documents.id_card_number',
        'documents.driver_license_number',
        'person.ssn',
      ]),
    );
  });

  it('isSensitivePath matches glob patterns', () => {
    expect(isSensitivePath('credentials.example.com.password')).toBe(true);
    expect(isSensitivePath('payment_cards[0].number')).toBe(true);
    expect(isSensitivePath('payment_cards[2].cvv')).toBe(true);
    expect(isSensitivePath('banking.iban')).toBe(true);
    expect(isSensitivePath('person.first_name')).toBe(false);
    expect(isSensitivePath('contact.email')).toBe(false);
  });
});

describe('listAvailableKeys', () => {
  it('flattens canonical data to dotted keys', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B', birth_city: 'Rome' },
      contact: { email: 'a@b.co' },
      custom: { horse: 'Thunder' },
    };
    const keys = listAvailableKeys(data as never);
    expect(keys).toEqual(
      expect.arrayContaining([
        'person.first_name',
        'person.last_name',
        'person.birth_city',
        'contact.email',
        'custom.horse',
      ]),
    );
  });

  it('excludes sensitive paths by default', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B', ssn: '123' },
      contact: { email: 'a@b.co' },
      banking: { iban: 'IT60X0542811101000000123456' },
    };
    const keys = listAvailableKeys(data as never);
    expect(keys).not.toContain('person.ssn');
    expect(keys).not.toContain('banking.iban');
    expect(keys).toContain('person.first_name');
  });

  it('includes sensitive paths when opt-in', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B', ssn: '123' },
      contact: { email: 'a@b.co' },
    };
    const keys = listAvailableKeys(data as never, { includeSensitive: true });
    expect(keys).toContain('person.ssn');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/canonical-schema.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement schema**

Create `src/lib/canonical-schema.ts`:

```typescript
import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const AddressSchema = z
  .object({
    street: z.string().default(''),
    number: z.string().default(''),
    unit: z.string().optional(),
    city: z.string().default(''),
    state_province: z.string().optional(),
    postal_code: z.string().default(''),
    country: z.string().default(''),
  })
  .strict();

const PersonSchema = z
  .object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    middle_name: z.string().optional(),
    full_name: z.string().optional(),
    gender: z
      .enum(['M', 'F', 'X', 'prefer_not_to_say'])
      .optional(),
    birth_date: isoDate.optional(),
    birth_city: z.string().optional(),
    birth_country: z.string().optional(),
    nationality: z.string().optional(),
    tax_code: z.string().optional(),
    ssn: z.string().optional(),
  })
  .strict();

const ContactSchema = z
  .object({
    email: z.string().email(),
    email_secondary: z.string().email().optional(),
    phone: z.string().optional(),
    phone_mobile: z.string().optional(),
    pec: z.string().email().optional(),
    website: z.string().url().optional(),
  })
  .strict();

const AddressesSchema = z
  .object({
    primary: AddressSchema.optional(),
    billing: AddressSchema.optional(),
    shipping: AddressSchema.optional(),
  })
  .strict();

const CompanySchema = z
  .object({
    legal_name: z.string().optional(),
    trade_name: z.string().optional(),
    vat_number: z.string().optional(),
    tax_code: z.string().optional(),
    legal_form: z.string().optional(),
    rea_number: z.string().optional(),
    founded_date: isoDate.optional(),
    employees: z.number().int().nonnegative().optional(),
    annual_revenue: z.number().nonnegative().optional(),
    address: AddressSchema.optional(),
  })
  .strict();

const BankingSchema = z
  .object({
    iban: z.string().optional(),
    swift_bic: z.string().optional(),
    bank_name: z.string().optional(),
    account_holder: z.string().optional(),
  })
  .strict();

const CredentialEntrySchema = z
  .object({
    username: z.string(),
    password: z.string(),
  })
  .strict();

const PaymentCardSchema = z
  .object({
    label: z.string(),
    number: z.string(),
    expiry: z.string().regex(/^\d{2}\/\d{2}$/, 'expected MM/YY'),
    cvv: z.string(),
    holder: z.string(),
    type: z.string().optional(),
  })
  .strict();

const DocumentsSchema = z
  .object({
    passport_number: z.string().optional(),
    id_card_number: z.string().optional(),
    driver_license_number: z.string().optional(),
  })
  .strict();

export const CanonicalDataSchema = z
  .object({
    version: z.literal(1),
    person: PersonSchema,
    contact: ContactSchema,
    addresses: AddressesSchema.optional(),
    company: CompanySchema.optional(),
    banking: BankingSchema.optional(),
    credentials: z.record(z.string(), CredentialEntrySchema).optional(),
    payment_cards: z.array(PaymentCardSchema).optional(),
    documents: DocumentsSchema.optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type CanonicalData = z.infer<typeof CanonicalDataSchema>;

export const SENSITIVE_FIELD_PATHS: readonly string[] = [
  'credentials.*.password',
  'payment_cards[*].number',
  'payment_cards[*].cvv',
  'banking.iban',
  'documents.passport_number',
  'documents.id_card_number',
  'documents.driver_license_number',
  'person.ssn',
];

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_FIELD_PATHS.some((pattern) => {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.]/g, '\\.')
          .replace(/\[\*\]/g, '\\[\\d+\\]')
          .replace(/\*/g, '[^.]+') +
        '$',
    );
    return regex.test(path);
  });
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; data: CanonicalData }
  | { ok: false; errors: ValidationError[] };

export function validateCanonical(input: unknown): ValidationResult {
  const result = CanonicalDataSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return { ok: false, errors };
}

export interface ListKeysOptions {
  includeSensitive?: boolean;
}

export function listAvailableKeys(
  data: CanonicalData,
  opts: ListKeysOptions = {},
): string[] {
  const keys: string[] = [];
  const walk = (obj: unknown, prefix: string): void => {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== 'object') {
      if (!opts.includeSensitive && isSensitivePath(prefix)) return;
      keys.push(prefix);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => walk(item, `${prefix}[${idx}]`));
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      const next = prefix === '' ? k : `${prefix}.${k}`;
      walk(v, next);
    }
  };
  walk(data, '');
  // Remove the version key
  return keys.filter((k) => k !== 'version');
}
```

- [ ] **Step 4: Create canonical type barrel**

Create `src/types/canonical.ts`:

```typescript
export type {
  CanonicalData,
  ValidationError,
  ValidationResult,
  ListKeysOptions,
} from '@/lib/canonical-schema';
```

- [ ] **Step 5: Run — expect pass**

```bash
npx vitest run tests/unit/canonical-schema.test.ts && npm run typecheck
```

Expected: 10+ tests passing, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canonical-schema.ts src/types/canonical.ts tests/unit/canonical-schema.test.ts
git commit -m "feat(schema): canonical data Zod schema + sensitive-field registry + key listing"
```

---

## Task 3: AI client — basic fetch wrapper (TDD)

**Files:** `src/background/ai-client.ts`, `tests/unit/ai-client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/ai-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAIClient,
  AIBudgetExceededError,
  AIRateLimitError,
  AIAuthError,
} from '@/background/ai-client';

function mockFetchOnce(response: unknown, status = 200, headers = {}) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    );
}

describe('ai-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to the chat completions endpoint with model, messages, response_format', async () => {
    const spy = mockFetchOnce({
      choices: [
        {
          message: { content: '{"hello":"world"}' },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const client = createAIClient({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });

    const result = await client.structuredCompletion({
      system: 'You are a test.',
      user: 'hi',
      schema: { type: 'object', properties: { hello: { type: 'string' } } },
      schemaName: 'greeting',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a test.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'greeting',
        schema: { type: 'object', properties: { hello: { type: 'string' } } },
        strict: true,
      },
    });
    expect(result.data).toEqual({ hello: 'world' });
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('throws AIAuthError on 401', async () => {
    mockFetchOnce({ error: { message: 'Invalid API key' } }, 401);
    const client = createAIClient({ apiKey: 'sk-bad', model: 'gpt-4o-mini' });
    await expect(
      client.structuredCompletion({
        system: 's',
        user: 'u',
        schema: { type: 'object' },
        schemaName: 'x',
      }),
    ).rejects.toBeInstanceOf(AIAuthError);
  });

  it('throws AIRateLimitError on 429', async () => {
    mockFetchOnce({ error: 'rate limited' }, 429, { 'Retry-After': '2' });
    const client = createAIClient({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      maxRetries: 0, // do not retry in this test
    });
    await expect(
      client.structuredCompletion({
        system: 's',
        user: 'u',
        schema: { type: 'object' },
        schemaName: 'x',
      }),
    ).rejects.toBeInstanceOf(AIRateLimitError);
  });

  it('retries on 5xx with exponential backoff', async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server' }), { status: 502 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server' }), { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200 },
        ),
      );

    const client = createAIClient({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      maxRetries: 3,
      retryBaseMs: 1000,
    });

    const promise = client.structuredCompletion({
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      schemaName: 'x',
    });

    // Flush pending promises between retries
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.data).toEqual({ ok: true });
    vi.useRealTimers();
  });

  it('surfaces AIBudgetExceededError when budget exceeded', async () => {
    const client = createAIClient({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      budget: { maxTokens: 10, usedTokens: 11 },
    });
    await expect(
      client.structuredCompletion({
        system: 's',
        user: 'u',
        schema: { type: 'object' },
        schemaName: 'x',
      }),
    ).rejects.toBeInstanceOf(AIBudgetExceededError);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/ai-client.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement AI client**

Create `src/background/ai-client.ts`:

```typescript
export interface AIBudget {
  maxTokens: number;
  usedTokens: number;
}

export interface AIClientOptions {
  apiKey: string;
  model: string;
  maxRetries?: number;
  retryBaseMs?: number;
  budget?: AIBudget;
  endpoint?: string;
}

export interface StructuredCompletionRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  temperature?: number;
}

export interface StructuredCompletionResult<T = unknown> {
  data: T;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class AIAuthError extends Error {
  constructor(message = 'Invalid API key') {
    super(message);
    this.name = 'AIAuthError';
  }
}

export class AIRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super('Rate limited');
    this.name = 'AIRateLimitError';
  }
}

export class AIBudgetExceededError extends Error {
  constructor() {
    super('AI budget exceeded');
    this.name = 'AIBudgetExceededError';
  }
}

export class AIServerError extends Error {
  constructor(public status: number, message: string) {
    super(`OpenAI error ${status}: ${message}`);
    this.name = 'AIServerError';
  }
}

export interface AIClient {
  structuredCompletion<T = unknown>(
    req: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult<T>>;
}

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export function createAIClient(opts: AIClientOptions): AIClient {
  const maxRetries = opts.maxRetries ?? 3;
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;

  async function callOnce(
    body: Record<string, unknown>,
  ): Promise<StructuredCompletionResult> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new AIAuthError();
    }
    if (res.status === 429) {
      const ra = res.headers.get('Retry-After');
      const retryAfterMs = ra ? Number(ra) * 1000 : 10_000;
      throw new AIRateLimitError(retryAfterMs);
    }
    if (res.status >= 500) {
      const text = await res.text().catch(() => '');
      throw new AIServerError(res.status, text);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIServerError(res.status, text);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new AIServerError(200, 'Empty response');

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      throw new AIServerError(200, 'Response was not valid JSON');
    }

    return {
      data,
      usage: json.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  return {
    async structuredCompletion<T = unknown>(
      req: StructuredCompletionRequest,
    ): Promise<StructuredCompletionResult<T>> {
      if (opts.budget && opts.budget.usedTokens >= opts.budget.maxTokens) {
        throw new AIBudgetExceededError();
      }

      const body = {
        model: opts.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: req.schemaName,
            schema: req.schema,
            strict: true,
          },
        },
        temperature: req.temperature ?? 0,
      };

      let lastError: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return (await callOnce(body)) as StructuredCompletionResult<T>;
        } catch (err) {
          lastError = err;
          if (err instanceof AIAuthError) throw err;
          if (err instanceof AIBudgetExceededError) throw err;
          if (err instanceof AIRateLimitError) {
            if (attempt >= maxRetries) throw err;
            await new Promise((r) => setTimeout(r, err.retryAfterMs));
            continue;
          }
          if (err instanceof AIServerError && err.status >= 500) {
            if (attempt >= maxRetries) throw err;
            const backoff = retryBaseMs * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          throw err;
        }
      }
      throw lastError;
    },
  };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/ai-client.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/background/ai-client.ts tests/unit/ai-client.test.ts
git commit -m "feat(ai): OpenAI structured-completion client with retry and budget"
```

---

## Task 4: Format parsers — DOCX, CSV, YAML (TDD)

**Files:** `src/lib/docx-text.ts`, `src/lib/csv-parse.ts`, `src/lib/yaml-parse.ts`, corresponding tests, and fixtures.

- [ ] **Step 1: Create fixtures directory and CSV/YAML fixtures**

```bash
mkdir -p tests/fixtures
```

Create `tests/fixtures/sample.csv`:

```
key,value
Nome,Antonio
Cognome,Rossi
Email,antonio.rossi@example.com
Telefono,+39 333 1234567
Partita IVA,12345678901
```

Create `tests/fixtures/sample.yaml`:

```yaml
person:
  first_name: Antonio
  last_name: Rossi
contact:
  email: antonio.rossi@example.com
  phone: "+39 333 1234567"
company:
  vat_number: "12345678901"
```

Create `tests/fixtures/sample.docx` — a binary DOCX file. Since creating a valid DOCX from plaintext is non-trivial, generate it programmatically using a one-off Node script:

Create `tests/fixtures/make-docx.mjs`:

```javascript
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Minimal DOCX: a zip with [Content_Types].xml, _rels/.rels, word/document.xml
// We'll use a tiny pure-JS zip by constructing it manually.
// Simpler alternative: use `jszip` from node_modules (mammoth depends on it).
const JSZip = require('jszip');

const zip = new JSZip();
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Nome: Antonio</w:t></w:r></w:p>
    <w:p><w:r><w:t>Cognome: Rossi</w:t></w:r></w:p>
    <w:p><w:r><w:t>Email: antonio.rossi@example.com</w:t></w:r></w:p>
    <w:p><w:r><w:t>Partita IVA: 12345678901</w:t></w:r></w:p>
  </w:body>
</w:document>`);

const buf = await zip.generateAsync({ type: 'nodebuffer' });
writeFileSync('tests/fixtures/sample.docx', buf);
console.log('wrote tests/fixtures/sample.docx');
```

Run:

```bash
node tests/fixtures/make-docx.mjs
```

Expected: `wrote tests/fixtures/sample.docx`.

- [ ] **Step 2: Write failing tests for CSV parser**

Create `tests/unit/csv-parse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsvToText } from '@/lib/csv-parse';

describe('parseCsvToText', () => {
  it('converts a key/value CSV to plain text key: value lines', () => {
    const raw = readFileSync(
      resolve(__dirname, '../fixtures/sample.csv'),
      'utf8',
    );
    const text = parseCsvToText(raw);
    expect(text).toContain('Nome: Antonio');
    expect(text).toContain('Cognome: Rossi');
    expect(text).toContain('Email: antonio.rossi@example.com');
  });

  it('handles CSV with quoted values containing commas', () => {
    const raw = 'key,value\nAddress,"Via Roma, 1"\n';
    const text = parseCsvToText(raw);
    expect(text).toContain('Address: Via Roma, 1');
  });

  it('handles arbitrary column names (treats first column as key, rest as value)', () => {
    const raw = 'field,data\nname,Antonio\nemail,a@b.co\n';
    const text = parseCsvToText(raw);
    expect(text).toContain('name: Antonio');
    expect(text).toContain('email: a@b.co');
  });
});
```

- [ ] **Step 3: Run — expect failure**

```bash
npx vitest run tests/unit/csv-parse.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement CSV parser**

Create `src/lib/csv-parse.ts`:

```typescript
import Papa from 'papaparse';

export function parseCsvToText(raw: string): string {
  const result = Papa.parse<string[]>(raw.trim(), {
    skipEmptyLines: true,
  });
  if (result.errors.length) {
    throw new Error(
      `CSV parse error: ${result.errors.map((e) => e.message).join('; ')}`,
    );
  }
  const rows = result.data;
  if (rows.length === 0) return '';

  // Assume first row is header; subsequent rows are key/value pairs
  // where first column is the key and everything after is joined.
  const lines: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const [key, ...rest] = row;
    if (!key) continue;
    const value = rest.join(', ').trim();
    lines.push(`${key}: ${value}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 5: Run — expect pass**

```bash
npx vitest run tests/unit/csv-parse.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 6: Write failing tests for YAML parser**

Create `tests/unit/yaml-parse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseYamlToText, parseYamlToObject } from '@/lib/yaml-parse';

describe('yaml parser', () => {
  it('parses YAML file to object', () => {
    const raw = readFileSync(
      resolve(__dirname, '../fixtures/sample.yaml'),
      'utf8',
    );
    const obj = parseYamlToObject(raw) as Record<string, unknown>;
    expect(obj).toHaveProperty('person');
    expect((obj.person as Record<string, unknown>).first_name).toBe('Antonio');
  });

  it('converts YAML to flattened key: value text', () => {
    const raw = 'person:\n  first_name: Antonio\n  last_name: Rossi\nemail: a@b.co\n';
    const text = parseYamlToText(raw);
    expect(text).toContain('person.first_name: Antonio');
    expect(text).toContain('person.last_name: Rossi');
    expect(text).toContain('email: a@b.co');
  });

  it('throws on invalid YAML', () => {
    expect(() => parseYamlToObject('key: : bad')).toThrow();
  });
});
```

- [ ] **Step 7: Run — expect failure**

```bash
npx vitest run tests/unit/yaml-parse.test.ts
```

Expected: FAIL.

- [ ] **Step 8: Implement YAML parser**

Create `src/lib/yaml-parse.ts`:

```typescript
import yaml from 'js-yaml';

export function parseYamlToObject(raw: string): unknown {
  return yaml.load(raw);
}

export function parseYamlToText(raw: string): string {
  const obj = parseYamlToObject(raw);
  const lines: string[] = [];
  const walk = (v: unknown, prefix: string): void => {
    if (v === null || v === undefined) return;
    if (typeof v !== 'object') {
      lines.push(`${prefix}: ${String(v)}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, idx) => walk(item, `${prefix}[${idx}]`));
      return;
    }
    for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
      const next = prefix === '' ? k : `${prefix}.${k}`;
      walk(inner, next);
    }
  };
  walk(obj, '');
  return lines.join('\n');
}
```

- [ ] **Step 9: Run — expect pass**

```bash
npx vitest run tests/unit/yaml-parse.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 10: Write failing test for DOCX parser**

Create `tests/unit/docx-text.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractDocxText } from '@/lib/docx-text';

const fixturePath = resolve(__dirname, '../fixtures/sample.docx');

describe('extractDocxText', () => {
  it.skipIf(!existsSync(fixturePath))(
    'extracts plaintext from a DOCX buffer',
    async () => {
      const buf = readFileSync(fixturePath);
      const arrayBuffer = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
      const text = await extractDocxText(arrayBuffer);
      expect(text).toContain('Nome: Antonio');
      expect(text).toContain('Cognome: Rossi');
      expect(text).toContain('Email: antonio.rossi@example.com');
      expect(text).toContain('Partita IVA: 12345678901');
    },
  );

  it('throws on invalid DOCX buffer', async () => {
    const bogus = new TextEncoder().encode('not a docx').buffer;
    await expect(extractDocxText(bogus)).rejects.toThrow();
  });
});
```

- [ ] **Step 11: Run — expect failure**

```bash
npx vitest run tests/unit/docx-text.test.ts
```

Expected: FAIL.

- [ ] **Step 12: Implement DOCX extractor**

Create `src/lib/docx-text.ts`:

```typescript
import mammoth from 'mammoth';

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}
```

- [ ] **Step 13: Run — expect pass**

```bash
npx vitest run tests/unit/docx-text.test.ts
```

Expected: 2 tests passing (or 1 if DOCX fixture missing).

- [ ] **Step 14: Commit**

```bash
git add tests/fixtures/ src/lib/csv-parse.ts src/lib/yaml-parse.ts src/lib/docx-text.ts tests/unit/csv-parse.test.ts tests/unit/yaml-parse.test.ts tests/unit/docx-text.test.ts
git commit -m "feat(parsers): CSV, YAML, DOCX text extraction with fixtures"
```

---

## Task 5: Importer pipeline (TDD)

**Files:** `src/lib/importer.ts`, `tests/unit/importer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/importer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { importRawData, detectFormat, type ImporterDeps } from '@/lib/importer';
import type { StructuredCompletionResult } from '@/background/ai-client';
import type { CanonicalData } from '@/lib/canonical-schema';

function makeDeps(
  aiResult: StructuredCompletionResult<Partial<CanonicalData>>,
): ImporterDeps {
  return {
    ai: {
      structuredCompletion: vi.fn().mockResolvedValue(aiResult),
    },
  };
}

describe('detectFormat', () => {
  it('detects by explicit extension', () => {
    expect(detectFormat('file.docx')).toBe('docx');
    expect(detectFormat('file.CSV')).toBe('csv');
    expect(detectFormat('file.yml')).toBe('yaml');
    expect(detectFormat('file.yaml')).toBe('yaml');
    expect(detectFormat('file.txt')).toBe('text');
  });
});

describe('importRawData', () => {
  it('calls AI with extracted text and returns validated CanonicalData', async () => {
    const deps = makeDeps({
      data: {
        version: 1,
        person: { first_name: 'Antonio', last_name: 'Rossi' },
        contact: { email: 'antonio@example.com' },
      },
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const result = await importRawData(
      { format: 'text', text: 'nome: antonio\ncognome: rossi\nemail: antonio@example.com' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.person.first_name).toBe('Antonio');
      expect(result.data.contact.email).toBe('antonio@example.com');
      expect(result.usage.total_tokens).toBe(30);
    }
    expect(deps.ai.structuredCompletion).toHaveBeenCalledTimes(1);
  });

  it('returns validation errors if AI output fails Zod validation', async () => {
    const deps = makeDeps({
      data: {
        version: 1,
        person: { first_name: '', last_name: 'Rossi' } as never,
        contact: { email: 'not-an-email' } as never,
      },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const result = await importRawData(
      { format: 'text', text: 'junk' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('parses CSV to text before calling AI', async () => {
    const deps = makeDeps({
      data: {
        version: 1,
        person: { first_name: 'A', last_name: 'B' },
        contact: { email: 'a@b.co' },
      },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const csv = 'key,value\nNome,A\nCognome,B\nEmail,a@b.co\n';
    const result = await importRawData(
      { format: 'csv', text: csv },
      deps,
    );
    expect(result.ok).toBe(true);

    const call = (deps.ai.structuredCompletion as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { user: string };
    expect(call.user).toContain('Nome: A');
  });

  it('parses YAML to text before calling AI', async () => {
    const deps = makeDeps({
      data: {
        version: 1,
        person: { first_name: 'A', last_name: 'B' },
        contact: { email: 'a@b.co' },
      },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const yaml = 'person:\n  first_name: A\n  last_name: B\nemail: a@b.co\n';
    const result = await importRawData(
      { format: 'yaml', text: yaml },
      deps,
    );
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/importer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement importer**

Create `src/lib/importer.ts`:

```typescript
import {
  CanonicalDataSchema,
  validateCanonical,
  type CanonicalData,
  type ValidationError,
} from './canonical-schema';
import { parseCsvToText } from './csv-parse';
import { parseYamlToText } from './yaml-parse';
import { extractDocxText } from './docx-text';
import type {
  AIClient,
  StructuredCompletionResult,
} from '@/background/ai-client';

export type ImportFormat = 'docx' | 'csv' | 'yaml' | 'text';

export interface ImportInput {
  format: ImportFormat;
  text?: string;
  buffer?: ArrayBuffer;
}

export interface ImporterDeps {
  ai: Pick<AIClient, 'structuredCompletion'>;
}

export type ImportResult =
  | {
      ok: true;
      data: CanonicalData;
      usage: StructuredCompletionResult['usage'];
    }
  | { ok: false; errors: ValidationError[] };

export function detectFormat(filename: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'text';
}

const SYSTEM_PROMPT = `You normalize free-form personal and company data from a user-supplied document into a strict canonical JSON schema.
Rules:
- Only output fields supported by the schema. Unknown data can go in "custom".
- Italian fiscal terms: "Partita IVA" → company.vat_number; "Codice Fiscale" of a person → person.tax_code; of a company → company.tax_code; "PEC" → contact.pec.
- Dates MUST be ISO YYYY-MM-DD. Italian "GG/MM/AAAA" must be converted.
- Emails and URLs must be valid.
- If a value is ambiguous, skip it — never guess password, IBAN, credit card, or other sensitive data.
- Do not fabricate missing required fields; if first_name/last_name/email are missing, put them in custom and leave schema-required fields unchecked (caller validates).`;

async function toPromptText(input: ImportInput): Promise<string> {
  switch (input.format) {
    case 'docx': {
      if (!input.buffer) throw new Error('DOCX import requires buffer');
      return extractDocxText(input.buffer);
    }
    case 'csv': {
      if (!input.text) throw new Error('CSV import requires text');
      return parseCsvToText(input.text);
    }
    case 'yaml': {
      if (!input.text) throw new Error('YAML import requires text');
      return parseYamlToText(input.text);
    }
    case 'text':
      return input.text ?? '';
  }
}

export async function importRawData(
  input: ImportInput,
  deps: ImporterDeps,
): Promise<ImportResult> {
  const userText = await toPromptText(input);
  const schema = toOpenAIJsonSchema();

  const completion = await deps.ai.structuredCompletion({
    system: SYSTEM_PROMPT,
    user: userText,
    schema,
    schemaName: 'CanonicalData',
    temperature: 0,
  });

  const validation = validateCanonical(completion.data);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, data: validation.data, usage: completion.usage };
}

// Converts the Zod schema to a plain JSON-Schema-style object that OpenAI's
// structured-output endpoint accepts. We hand-produce a minimal subset
// because Zod→JSON-Schema converters add properties OpenAI does not allow.
function toOpenAIJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'person', 'contact'],
    properties: {
      version: { type: 'integer', enum: [1] },
      person: {
        type: 'object',
        additionalProperties: false,
        required: ['first_name', 'last_name'],
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          middle_name: { type: 'string' },
          full_name: { type: 'string' },
          gender: { type: 'string', enum: ['M', 'F', 'X', 'prefer_not_to_say'] },
          birth_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          birth_city: { type: 'string' },
          birth_country: { type: 'string' },
          nationality: { type: 'string' },
          tax_code: { type: 'string' },
          ssn: { type: 'string' },
        },
      },
      contact: {
        type: 'object',
        additionalProperties: false,
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          email_secondary: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          phone_mobile: { type: 'string' },
          pec: { type: 'string', format: 'email' },
          website: { type: 'string', format: 'uri' },
        },
      },
      addresses: {
        type: 'object',
        additionalProperties: false,
        properties: {
          primary: { $ref: '#/$defs/address' },
          billing: { $ref: '#/$defs/address' },
          shipping: { $ref: '#/$defs/address' },
        },
      },
      company: {
        type: 'object',
        additionalProperties: false,
        properties: {
          legal_name: { type: 'string' },
          trade_name: { type: 'string' },
          vat_number: { type: 'string' },
          tax_code: { type: 'string' },
          legal_form: { type: 'string' },
          rea_number: { type: 'string' },
          founded_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          employees: { type: 'integer', minimum: 0 },
          annual_revenue: { type: 'number', minimum: 0 },
          address: { $ref: '#/$defs/address' },
        },
      },
      banking: {
        type: 'object',
        additionalProperties: false,
        properties: {
          iban: { type: 'string' },
          swift_bic: { type: 'string' },
          bank_name: { type: 'string' },
          account_holder: { type: 'string' },
        },
      },
      credentials: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'password'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
      payment_cards: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'number', 'expiry', 'cvv', 'holder'],
          properties: {
            label: { type: 'string' },
            number: { type: 'string' },
            expiry: { type: 'string', pattern: '^\\d{2}/\\d{2}$' },
            cvv: { type: 'string' },
            holder: { type: 'string' },
            type: { type: 'string' },
          },
        },
      },
      documents: {
        type: 'object',
        additionalProperties: false,
        properties: {
          passport_number: { type: 'string' },
          id_card_number: { type: 'string' },
          driver_license_number: { type: 'string' },
        },
      },
      custom: {
        type: 'object',
        additionalProperties: true,
      },
    },
    $defs: {
      address: {
        type: 'object',
        additionalProperties: false,
        properties: {
          street: { type: 'string' },
          number: { type: 'string' },
          unit: { type: 'string' },
          city: { type: 'string' },
          state_province: { type: 'string' },
          postal_code: { type: 'string' },
          country: { type: 'string' },
        },
      },
    },
  };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/importer.test.ts
```

Expected: 5 tests passing (4 importRawData + 1 detectFormat with 5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/importer.ts tests/unit/importer.test.ts
git commit -m "feat(importer): canonical-JSON importer pipeline with AI normalization"
```

---

## Task 6: Extend vault to hold data + apiKey + model

**Files:** `src/lib/vault.ts`, `tests/unit/vault.test.ts`

- [ ] **Step 1: Write failing tests extending vault**

Append to `tests/unit/vault.test.ts`:

```typescript
import type { CanonicalData } from '@/lib/canonical-schema';
import {
  writeSecretConfig,
  readSecretConfig,
  writeCanonicalData,
  readCanonicalData,
} from '@/lib/vault';

describe('vault: secret config', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('stores and reads apiKey + model', async () => {
    await createVault('my strong pw 123');
    await writeSecretConfig(
      { apiKey: 'sk-test-abc', model: 'gpt-4o-mini' },
      'my strong pw 123',
    );
    const cfg = await readSecretConfig('my strong pw 123');
    expect(cfg).toEqual({ apiKey: 'sk-test-abc', model: 'gpt-4o-mini' });
  });

  it('readSecretConfig returns null before first write', async () => {
    await createVault('my strong pw 123');
    const cfg = await readSecretConfig('my strong pw 123');
    expect(cfg).toBeNull();
  });
});

describe('vault: canonical data', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('stores and reads CanonicalData', async () => {
    await createVault('my strong pw 123');
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' },
      contact: { email: 'antonio@example.com' },
    };
    await writeCanonicalData(data, 'my strong pw 123');
    const read = await readCanonicalData('my strong pw 123');
    expect(read).toEqual(data);
  });

  it('readCanonicalData returns null before first write', async () => {
    await createVault('my strong pw 123');
    expect(await readCanonicalData('my strong pw 123')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: FAIL, functions not exported.

- [ ] **Step 3: Extend vault**

Append to `src/lib/vault.ts`:

```typescript
import type { CanonicalData } from './canonical-schema';

export interface SecretConfig {
  apiKey: string;
  model: string;
}

interface ExtendedVaultData extends VaultData {
  data: Record<string, unknown> & {
    secretConfig?: SecretConfig;
    canonical?: CanonicalData;
  };
}

function asExtended(data: VaultData): ExtendedVaultData {
  return data as ExtendedVaultData;
}

export async function writeSecretConfig(
  config: SecretConfig,
  masterPassword: string,
): Promise<void> {
  const current = await openVault(masterPassword);
  const ext = asExtended(current);
  ext.data = { ...(ext.data ?? {}), secretConfig: config };
  await writeVaultData(ext, masterPassword);
}

export async function readSecretConfig(
  masterPassword: string,
): Promise<SecretConfig | null> {
  const current = asExtended(await openVault(masterPassword));
  return current.data?.secretConfig ?? null;
}

export async function writeCanonicalData(
  data: CanonicalData,
  masterPassword: string,
): Promise<void> {
  const current = await openVault(masterPassword);
  const ext = asExtended(current);
  ext.data = { ...(ext.data ?? {}), canonical: data };
  await writeVaultData(ext, masterPassword);
}

export async function readCanonicalData(
  masterPassword: string,
): Promise<CanonicalData | null> {
  const current = asExtended(await openVault(masterPassword));
  return current.data?.canonical ?? null;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run tests/unit/vault.test.ts
```

Expected: 16 vault tests passing (12 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault.ts tests/unit/vault.test.ts
git commit -m "feat(vault): typed getters/setters for secret config and canonical data"
```

---

## Task 7: Message contract extensions

**Files:** `src/types/messages.ts`

- [ ] **Step 1: Extend messages**

Append to `src/types/messages.ts` (before the `PopupRequest`/`PopupResponse` union and `ResponseFor`):

```typescript
// --- Settings ---
export type GetSettingsRequest = { type: 'settings/get' };
export type GetSettingsResponse = {
  apiKey: string | null;
  model: string;
};

export type SaveSettingsRequest = {
  type: 'settings/save';
  apiKey: string;
  model: string;
};
export type SaveSettingsResponse =
  | { ok: true }
  | { ok: false; error: string };

// --- Import ---
export type ImportFileRequest = {
  type: 'import/run';
  filename: string;
  // Either text or a base64-encoded buffer for DOCX.
  text?: string;
  bufferBase64?: string;
};
export type ImportFileResponse =
  | { ok: true; data: unknown; tokens: number } // data is CanonicalData shape
  | { ok: false; error: string; validationErrors?: { path: string; message: string }[] };

// --- Canonical data read/write ---
export type GetCanonicalDataRequest = { type: 'canonical/get' };
export type GetCanonicalDataResponse = { data: unknown | null };

export type SaveCanonicalDataRequest = {
  type: 'canonical/save';
  data: unknown;
};
export type SaveCanonicalDataResponse =
  | { ok: true }
  | { ok: false; error: string };
```

Replace the `PopupRequest` / `PopupResponse` unions with:

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
  | SaveCanonicalDataRequest;

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
  | SaveCanonicalDataResponse;
```

Extend the `ResponseFor` helper:

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
  never;
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/messages.ts
git commit -m "feat(types): extend message contract for settings, import, canonical I/O"
```

---

## Task 8: Service worker handlers for settings + import + canonical I/O

**Files:** `src/background/service-worker.ts`

- [ ] **Step 1: Extend service worker**

Modify `src/background/service-worker.ts` — add imports at the top:

```typescript
import { createAIClient, AIAuthError, AIBudgetExceededError, AIRateLimitError, AIServerError } from './ai-client';
import { importRawData, type ImportFormat } from '@/lib/importer';
import { readSecretConfig, writeSecretConfig, readCanonicalData, writeCanonicalData } from '@/lib/vault';
import { fromBase64 } from '@/lib/crypto';
```

Helper functions at module scope:

```typescript
const DEFAULT_MODEL = 'gpt-4o-mini';

function formatFromFilename(filename: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'text';
}

function requirePassword(): string {
  const pw = session.getPassword();
  if (!pw) throw new Error('Vault is locked');
  return pw;
}

function formatAIError(err: unknown): string {
  if (err instanceof AIAuthError) return 'OpenAI API key is invalid';
  if (err instanceof AIBudgetExceededError) return 'AI budget exceeded';
  if (err instanceof AIRateLimitError) return 'OpenAI rate limit reached';
  if (err instanceof AIServerError) return `OpenAI server error (${err.status})`;
  return err instanceof Error ? err.message : 'Unknown error';
}
```

Add new cases inside `handleRequest` before the closing brace of the switch:

```typescript
    case 'settings/get': {
      try {
        const pw = requirePassword();
        const cfg = await readSecretConfig(pw);
        return {
          apiKey: cfg?.apiKey ?? null,
          model: cfg?.model ?? DEFAULT_MODEL,
        };
      } catch {
        return { apiKey: null, model: DEFAULT_MODEL };
      }
    }

    case 'settings/save': {
      try {
        const pw = requirePassword();
        await writeSecretConfig(
          { apiKey: req.apiKey, model: req.model },
          pw,
        );
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    case 'import/run': {
      try {
        const pw = requirePassword();
        const cfg = await readSecretConfig(pw);
        if (!cfg?.apiKey) {
          return { ok: false, error: 'OpenAI API key not configured' };
        }
        const ai = createAIClient({ apiKey: cfg.apiKey, model: cfg.model });
        const format = formatFromFilename(req.filename);
        const input =
          format === 'docx'
            ? { format, buffer: fromBase64(req.bufferBase64 ?? '').buffer as ArrayBuffer }
            : { format, text: req.text ?? '' };

        const result = await importRawData(input, { ai });
        if (!result.ok) {
          return {
            ok: false,
            error: 'Imported data failed validation',
            validationErrors: result.errors,
          };
        }
        return {
          ok: true,
          data: result.data,
          tokens: result.usage.total_tokens,
        };
      } catch (err) {
        return { ok: false, error: formatAIError(err) };
      }
    }

    case 'canonical/get': {
      try {
        const pw = requirePassword();
        const data = await readCanonicalData(pw);
        return { data };
      } catch {
        return { data: null };
      }
    }

    case 'canonical/save': {
      try {
        const pw = requirePassword();
        await writeCanonicalData(
          req.data as Parameters<typeof writeCanonicalData>[0],
          pw,
        );
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }
```

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat(background): handlers for settings, import, canonical I/O"
```

---

## Task 9: Settings view

**Files:** `src/popup/views/settings.ts`

- [ ] **Step 1: Create settings view**

Create `src/popup/views/settings.ts`:

```typescript
import type { ViewRenderer } from './router';
import type {
  GetSettingsRequest,
  GetSettingsResponse,
  SaveSettingsRequest,
  SaveSettingsResponse,
} from '@/types/messages';

const MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (economico, default)' },
  { value: 'gpt-4o', label: 'GPT-4o (qualità alta)' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1 (massima qualità)' },
] as const;

export function createSettingsView(onBack: () => Promise<void>): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      const current = (await chrome.runtime.sendMessage({
        type: 'settings/get',
      } as GetSettingsRequest)) as GetSettingsResponse;

      container.innerHTML = `
        <h1>Impostazioni</h1>

        <div class="form-group">
          <label for="apikey">OpenAI API Key</label>
          <input id="apikey" type="password" placeholder="sk-..." value="${escapeHtml(current.apiKey ?? '')}" />
          <p class="muted">La chiave è salvata cifrata nel vault.</p>
        </div>

        <div class="form-group">
          <label for="model">Modello</label>
          <select id="model">
            ${MODELS.map(
              (m) =>
                `<option value="${m.value}" ${m.value === current.model ? 'selected' : ''}>${m.label}</option>`,
            ).join('')}
          </select>
        </div>

        <div id="err" class="error" hidden></div>
        <div id="ok" class="muted" hidden>Salvato.</div>

        <div class="actions">
          <button id="save-btn">Salva</button>
          <button id="back-btn" class="secondary">Indietro</button>
        </div>
      `;

      const apiKey = container.querySelector<HTMLInputElement>('#apikey')!;
      const model = container.querySelector<HTMLSelectElement>('#model')!;
      const saveBtn = container.querySelector<HTMLButtonElement>('#save-btn')!;
      const backBtn = container.querySelector<HTMLButtonElement>('#back-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;
      const ok = container.querySelector<HTMLDivElement>('#ok')!;

      saveBtn.addEventListener('click', async () => {
        err.hidden = true;
        ok.hidden = true;
        saveBtn.disabled = true;
        const res = (await chrome.runtime.sendMessage({
          type: 'settings/save',
          apiKey: apiKey.value.trim(),
          model: model.value,
        } as SaveSettingsRequest)) as SaveSettingsResponse;
        if (res.ok) {
          ok.hidden = false;
        } else {
          err.hidden = false;
          err.textContent = res.error;
        }
        saveBtn.disabled = false;
      });

      backBtn.addEventListener('click', async () => {
        await onBack();
      });
    },
  };
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
git add src/popup/views/settings.ts
git commit -m "feat(popup): settings view for OpenAI API key and model selection"
```

---

## Task 10: Setup wizard — multi-step controller

**Files:** `src/popup/views/wizard-step-password.ts`, `src/popup/views/wizard-step-import.ts`, `src/popup/views/wizard-step-review.ts`, `src/popup/views/setup-wizard.ts`; delete `src/popup/views/setup-password.ts`

- [ ] **Step 1: Extract password step**

Create `src/popup/views/wizard-step-password.ts`:

```typescript
import type { ViewRenderer } from './router';
import type { CreateVaultRequest, CreateVaultResponse } from '@/types/messages';

const MIN_LEN = 12;

export function createWizardPasswordStep(
  onDone: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Step 1 di 3 — Master password</h1>
        <p class="muted">
          Questa password cifra tutti i tuoi dati. Non può essere recuperata.
        </p>

        <div class="form-group">
          <label for="pw1">Password (min ${MIN_LEN} caratteri)</label>
          <input id="pw1" type="password" autocomplete="new-password" />
        </div>
        <div class="form-group">
          <label for="pw2">Ripeti password</label>
          <input id="pw2" type="password" autocomplete="new-password" />
        </div>
        <div id="err" class="error" hidden></div>
        <div class="actions">
          <button id="create-btn" disabled>Continua</button>
        </div>
      `;
      const pw1 = container.querySelector<HTMLInputElement>('#pw1')!;
      const pw2 = container.querySelector<HTMLInputElement>('#pw2')!;
      const btn = container.querySelector<HTMLButtonElement>('#create-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      const validate = (): string | null => {
        if (pw1.value.length < MIN_LEN) return `Almeno ${MIN_LEN} caratteri`;
        if (pw1.value !== pw2.value) return 'Le password non coincidono';
        return null;
      };
      const update = () => {
        const problem = validate();
        btn.disabled = problem !== null;
        err.hidden = problem === null;
        err.textContent = problem ?? '';
      };
      pw1.addEventListener('input', update);
      pw2.addEventListener('input', update);

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = (await chrome.runtime.sendMessage({
          type: 'vault/create',
          masterPassword: pw1.value,
        } as CreateVaultRequest)) as CreateVaultResponse;
        if (res.ok) {
          await onDone();
        } else {
          err.hidden = false;
          err.textContent = res.error;
          btn.disabled = false;
        }
      });

      pw1.focus();
    },
  };
}
```

- [ ] **Step 2: Create import step**

Create `src/popup/views/wizard-step-import.ts`:

```typescript
import type { ViewRenderer } from './router';
import type {
  SaveSettingsRequest,
  SaveSettingsResponse,
  ImportFileRequest,
  ImportFileResponse,
} from '@/types/messages';
import { toBase64 } from '@/lib/crypto';

export function createWizardImportStep(
  onImported: (canonicalData: unknown) => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Step 2 di 3 — Importa dati</h1>
        <p class="muted">
          Carica un file (DOCX, CSV, YAML) con i tuoi dati. L'AI li
          normalizzerà nello schema interno.
        </p>

        <div class="form-group">
          <label for="apikey">OpenAI API Key</label>
          <input id="apikey" type="password" placeholder="sk-..." />
          <p class="muted">Salvata cifrata nel vault.</p>
        </div>

        <div class="form-group">
          <label for="model">Modello</label>
          <select id="model">
            <option value="gpt-4o-mini" selected>GPT-4o mini (default)</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="gpt-4.1-mini">GPT-4.1 mini</option>
            <option value="gpt-4.1">GPT-4.1</option>
          </select>
        </div>

        <div class="form-group">
          <label for="file">File</label>
          <input id="file" type="file" accept=".docx,.csv,.yaml,.yml,.txt" />
        </div>

        <div id="status" class="muted" hidden></div>
        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="go-btn" disabled>Importa</button>
        </div>
      `;
      const apiKey = container.querySelector<HTMLInputElement>('#apikey')!;
      const model = container.querySelector<HTMLSelectElement>('#model')!;
      const file = container.querySelector<HTMLInputElement>('#file')!;
      const btn = container.querySelector<HTMLButtonElement>('#go-btn')!;
      const status = container.querySelector<HTMLDivElement>('#status')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      const updateBtn = () => {
        btn.disabled =
          apiKey.value.trim().length === 0 || file.files?.length === 0;
      };
      apiKey.addEventListener('input', updateBtn);
      file.addEventListener('change', updateBtn);

      btn.addEventListener('click', async () => {
        err.hidden = true;
        btn.disabled = true;
        status.hidden = false;
        status.textContent = 'Salvo le impostazioni…';

        const saveRes = (await chrome.runtime.sendMessage({
          type: 'settings/save',
          apiKey: apiKey.value.trim(),
          model: model.value,
        } as SaveSettingsRequest)) as SaveSettingsResponse;
        if (!saveRes.ok) {
          err.hidden = false;
          err.textContent = saveRes.error;
          status.hidden = true;
          btn.disabled = false;
          return;
        }

        status.textContent = 'Leggo il file…';
        const f = file.files![0]!;
        const req: ImportFileRequest = {
          type: 'import/run',
          filename: f.name,
        };
        if (f.name.toLowerCase().endsWith('.docx')) {
          const buf = new Uint8Array(await f.arrayBuffer());
          req.bufferBase64 = toBase64(buf);
        } else {
          req.text = await f.text();
        }

        status.textContent = 'Chiamo l\'AI per normalizzare i dati…';
        const res = (await chrome.runtime.sendMessage(req)) as ImportFileResponse;
        if (res.ok) {
          status.hidden = true;
          await onImported(res.data);
        } else {
          err.hidden = true;
          err.hidden = false;
          let msg = res.error;
          if (res.validationErrors?.length) {
            msg +=
              '\n' +
              res.validationErrors
                .map((e) => `• ${e.path || '(root)'}: ${e.message}`)
                .join('\n');
          }
          err.textContent = msg;
          status.hidden = true;
          btn.disabled = false;
        }
      });

      apiKey.focus();
    },
  };
}
```

- [ ] **Step 3: Create review step**

Create `src/popup/views/wizard-step-review.ts`:

```typescript
import type { ViewRenderer } from './router';
import type {
  SaveCanonicalDataRequest,
  SaveCanonicalDataResponse,
} from '@/types/messages';

export function createWizardReviewStep(
  data: unknown,
  onDone: () => Promise<void>,
): ViewRenderer {
  return {
    render(container: HTMLElement) {
      container.innerHTML = `
        <h1>Step 3 di 3 — Rivedi i dati</h1>
        <p class="muted">
          Controlla il JSON normalizzato. Puoi modificarlo prima di salvare.
        </p>

        <div class="form-group">
          <label for="json">Dati canonici</label>
          <textarea id="json" rows="14" style="width:100%;font-family:monospace;font-size:12px;background:var(--input-bg);color:var(--fg);border:1px solid var(--input-border);border-radius:6px;padding:8px">${escapeHtml(JSON.stringify(data, null, 2))}</textarea>
        </div>

        <div id="err" class="error" hidden></div>

        <div class="actions">
          <button id="save-btn">Salva e finisci</button>
        </div>
      `;
      const ta = container.querySelector<HTMLTextAreaElement>('#json')!;
      const btn = container.querySelector<HTMLButtonElement>('#save-btn')!;
      const err = container.querySelector<HTMLDivElement>('#err')!;

      btn.addEventListener('click', async () => {
        err.hidden = true;
        btn.disabled = true;
        let parsed: unknown;
        try {
          parsed = JSON.parse(ta.value);
        } catch (e) {
          err.hidden = false;
          err.textContent = `JSON non valido: ${e instanceof Error ? e.message : String(e)}`;
          btn.disabled = false;
          return;
        }
        const res = (await chrome.runtime.sendMessage({
          type: 'canonical/save',
          data: parsed,
        } as SaveCanonicalDataRequest)) as SaveCanonicalDataResponse;
        if (res.ok) {
          await onDone();
        } else {
          err.hidden = false;
          err.textContent = res.error;
          btn.disabled = false;
        }
      });
    },
  };
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

- [ ] **Step 4: Create wizard controller**

Create `src/popup/views/setup-wizard.ts`:

```typescript
import type { ViewRenderer } from './router';
import { createWizardPasswordStep } from './wizard-step-password';
import { createWizardImportStep } from './wizard-step-import';
import { createWizardReviewStep } from './wizard-step-review';

type WizardStep = 'password' | 'import' | 'review' | 'done';

export function createSetupWizard(
  onFinished: () => Promise<void>,
): ViewRenderer {
  return {
    async render(container: HTMLElement) {
      let step: WizardStep = 'password';
      let importedData: unknown = null;

      const advance = async (to: WizardStep): Promise<void> => {
        step = to;
        const view = viewFor(step);
        if (view) {
          await view.render(container);
        }
      };

      const viewFor = (s: WizardStep): ViewRenderer | null => {
        switch (s) {
          case 'password':
            return createWizardPasswordStep(() => advance('import'));
          case 'import':
            return createWizardImportStep(async (data) => {
              importedData = data;
              await advance('review');
            });
          case 'review':
            return createWizardReviewStep(importedData, async () => {
              await advance('done');
            });
          case 'done':
            container.innerHTML = '<p class="muted">Fatto, sto caricando…</p>';
            await onFinished();
            return null;
        }
      };

      await advance('password');
    },
  };
}
```

- [ ] **Step 5: Delete old setup-password view**

```bash
git rm src/popup/views/setup-password.ts
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors (main.ts references setup-password and will break — that's fixed in Task 11).

- [ ] **Step 7: Commit**

```bash
git add src/popup/views/wizard-step-password.ts src/popup/views/wizard-step-import.ts src/popup/views/wizard-step-review.ts src/popup/views/setup-wizard.ts
git commit -m "feat(popup): 3-step setup wizard (password, import, review)"
```

(Note: typecheck may report error on missing setup-password import — the fix comes in Task 11.)

---

## Task 11: Wire wizard + settings into popup main

**Files:** `src/popup/main.ts`, `src/popup/views/router.ts`, `src/popup/views/main.ts`

- [ ] **Step 1: Extend view router with new view IDs**

Modify `src/popup/views/router.ts` — replace the `ViewId` union:

```typescript
export type ViewId = 'setup-wizard' | 'unlock' | 'main' | 'settings';
```

- [ ] **Step 2: Extend main view with settings button and re-import**

Replace `src/popup/views/main.ts`:

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
        <p class="muted">
          La compilazione dei form arriva in Fase 1c.
        </p>

        <div class="actions">
          <button id="reimport-btn" class="secondary">
            ${hasData ? 'Re-importa dati' : 'Importa dati'}
          </button>
          <button id="settings-btn" class="secondary">Impostazioni</button>
        </div>
        <div class="actions" style="margin-top:8px">
          <button id="lock-btn" class="secondary">Lock vault</button>
        </div>
      `;

      container
        .querySelector<HTMLButtonElement>('#lock-btn')!
        .addEventListener('click', async () => {
          await onLock();
        });
      container
        .querySelector<HTMLButtonElement>('#settings-btn')!
        .addEventListener('click', async () => {
          await onSettings();
        });
      container
        .querySelector<HTMLButtonElement>('#reimport-btn')!
        .addEventListener('click', async () => {
          await onReimport();
        });
    },
  };
}
```

- [ ] **Step 3: Rewire popup main.ts**

Replace `src/popup/main.ts`:

```typescript
import { createRouter, type Router, type ViewRenderer, type ViewId } from './views/router';
import { createSetupWizard } from './views/setup-wizard';
import { createUnlockView } from './views/unlock';
import { createMainView } from './views/main';
import { createSettingsView } from './views/settings';
import { createWizardImportStep } from './views/wizard-step-import';
import { createWizardReviewStep } from './views/wizard-step-review';
import type {
  GetVaultStateRequest,
  GetVaultStateResponse,
  LockVaultRequest,
  LockVaultResponse,
} from '@/types/messages';

async function getVaultState(): Promise<GetVaultStateResponse['state']> {
  const res = (await chrome.runtime.sendMessage({
    type: 'vault/getState',
  } as GetVaultStateRequest)) as GetVaultStateResponse;
  return res.state;
}

async function lockVault(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({
    type: 'vault/lock',
  } as LockVaultRequest)) as LockVaultResponse;
  void res;
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('missing #app');

  let router: Router;

  async function routeByState(): Promise<void> {
    const state = await getVaultState();
    switch (state.kind) {
      case 'no_vault':
        await router.show('setup-wizard');
        return;
      case 'locked':
        await router.show('unlock');
        return;
      case 'unlocked':
        await router.show('main');
        return;
    }
  }

  async function goMain(): Promise<void> {
    await router.show('main');
  }

  async function goSettings(): Promise<void> {
    await router.show('settings');
  }

  async function reImport(): Promise<void> {
    // Mini-wizard for re-import after first setup: import step → review step
    let imported: unknown = null;

    const importStep = createWizardImportStep(async (data) => {
      imported = data;
      const reviewStep = createWizardReviewStep(imported, goMain);
      await reviewStep.render(container);
    });
    await importStep.render(container);
  }

  const views: Record<ViewId, () => ViewRenderer> = {
    'setup-wizard': () => createSetupWizard(routeByState),
    unlock: () => createUnlockView(routeByState),
    main: () =>
      createMainView(
        async () => {
          await lockVault();
          await routeByState();
        },
        goSettings,
        reImport,
      ),
    settings: () => createSettingsView(goMain),
  };

  router = createRouter(container, views);
  await routeByState();
}

void boot();
```

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/popup/main.ts src/popup/views/router.ts src/popup/views/main.ts
git commit -m "feat(popup): wire setup-wizard, settings, re-import into main router"
```

---

## Task 12: Full verification + manual smoke test in Chrome

**Files:** none

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: all tests passing. Count = 41 (Phase 1a) + 10 (canonical schema) + 5 (ai-client) + 3 (csv) + 3 (yaml) + 2 (docx, 1 skipped if no fixture) + 5 (importer) + 4 (vault extensions) = **~73 tests passing**.

- [ ] **Step 2: Typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: no errors, `dist/` produced.

- [ ] **Step 3: Manual test in Chrome**

1. Reload extension at `chrome://extensions/` from `dist/`
2. If you have an existing vault from Phase 1a, in service worker console run: `await chrome.storage.local.remove('ufc_vault_v1')`, then re-open popup
3. Popup shows step 1 of wizard → enter matching ≥12-char password → Continua
4. Step 2 — paste your OpenAI API key, select model, upload one of `tests/fixtures/sample.csv` or `.yaml` → Importa
5. If API call succeeds, step 3 shows the canonical JSON in a textarea — review and save
6. Main view shows "Vault sbloccato e dati pronti"
7. Click "Impostazioni" → verify API key persists (masked)
8. Click "Re-importa dati" → mini-flow: import + review
9. Click "Lock vault" → unlock screen
10. Re-unlock → main view preserves all data

If any step fails with a clear error message, good — that's intended behavior (we want transparency). If anything crashes or hangs silently, file it for Phase 1c.

- [ ] **Step 4: Tag phase complete**

```bash
git tag phase-1b-complete
git log --oneline | head -40
```

Expected: all Phase 1a and 1b commits present.

---

## Phase 1b Deliverables

- AI client for OpenAI with retry, budget tracking, structured outputs, typed errors
- Canonical JSON schema with Zod validation and sensitive-field registry
- DOCX, CSV, YAML parsers
- Importer pipeline (file → extract → AI normalize → validate)
- Vault extended to store API key, model, and canonical data
- Multi-step setup wizard (password → import → review)
- Settings view for API key/model management
- Main view with re-import and settings navigation
- ~30 new unit tests (total ~73)

**Next:** Phase 1c adds content scripts (form scanner, widget detector, form filler), the orchestrator that sends scanned fields + canonical keys to the AI and receives a mapping, the overlay, and the dry-run UI. At the end of 1c, the extension is usable on HTML-native forms end-to-end.

---

## Self-Review Notes

**Spec coverage for Phase 1b (M2-M3):**
- M2 AI client → Task 3
- M3 canonical schema + sensitive registry → Task 2
- M3 importer pipeline → Task 5, with format parsers in Task 4
- M3 setup wizard with all three steps → Tasks 10-11
- Settings/API key storage → Tasks 6, 8, 9
- Vault extensions for data persistence → Task 6

**Placeholder scan:** none.

**Type consistency:** `CanonicalData`, `SecretConfig`, `ImportResult`, `StructuredCompletionResult`, `ImportFileRequest/Response`, etc. defined once and referenced consistently.

**Scope check:** Phase 1b is 12 tasks, ~30 new unit tests, covers only import/schema/AI plumbing. No form-filling logic, no content scripts — those are Phase 1c.

**Known limitations carried forward:**
- SW eviction resets rate-limiter counter (Phase 1a-known)
- `writeVaultData` does double PBKDF2 (acceptable for import flow, infrequent)
- Real OpenAI calls not tested automatically (would require network + real key) — deferred to manual smoke test in Task 12
