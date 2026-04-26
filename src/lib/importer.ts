import {
  validateCanonical,
  type CanonicalData,
  type ValidationError,
} from './canonical-schema';
import { parseCsvToText } from './csv-parse';
import { parseYamlToText } from './yaml-parse';
import { extractDocxText } from './docx-text';
import { looksLikeExampleEmail } from './value-guards';
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
  ai: Pick<AIClient, 'jsonCompletion'>;
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

ABSOLUTE ANTI-FABRICATION RULE — read this twice:
You are a TRANSCRIBER, not an INFERENCER. Every value you output must be present (verbatim or with a trivial format change) in the source document. You are FORBIDDEN from:
  - Inventing emails, phones, addresses, dates, names, IDs, codes, or anything not literally written in the document.
  - Generating plausible placeholders like "example@example.com", "John Doe", "+39 333 1234567", "1990-01-01".
  - Inferring values from context (e.g. don't guess a person's gender from their name; don't guess a province from a city; don't guess a fiscal code from birth data).
  - Translating, expanding abbreviations, or otherwise enriching data not stated.
If a field is not present in the document, OMIT it. An incomplete profile is the correct output. Output { "version": 1, "person": {...} } with NOTHING ELSE if that's all the document contains.

CRITICAL STRUCTURAL RULES:
- The "custom" object exists ONLY at the root level. NEVER add a "custom" key inside "person", "contact", "company", "banking", "addresses", "documents", or any other nested object.
- Each nested object (person, contact, company, etc.) accepts ONLY the keys listed in the schema. Do not invent keys.
- If a piece of data does not fit any known key, put it at root level: { "custom": { "your_key": "value" } }.
- Always emit "version": 1 at the root.

CONTENT RULES (apply ONLY when the value is in the document):
- Italian fiscal terms: "Partita IVA" -> company.vat_number; "Codice Fiscale" of a person -> person.tax_code; of a company -> company.tax_code; "PEC" -> contact.pec.
- Dates MUST be ISO YYYY-MM-DD. Italian "GG/MM/AAAA" must be converted (e.g. "05/03/1990" -> "1990-03-05"). This is a format change, not a fabrication.
- Emails and URLs must be syntactically valid. If the document has an invalid email, omit it rather than "fix" it.
- The "contact" object is OPTIONAL — if the document has no email/phone/etc., omit "contact" entirely. Never invent a placeholder email.
- Italian double given names ("Maria Cristina", "Raffaele Francesco", "Anna Maria", "Vincenzo Antonio", etc.) are a SINGLE given name in Italian usage. Put the ENTIRE multi-word given name in person.first_name. Do NOT split them into first_name + middle_name. Use middle_name ONLY for explicit middle initials or non-Italian middle names that are clearly distinct from the first name (e.g., "John F. Kennedy" -> first_name: "John", middle_name: "F.").
- Sensitive values (password, IBAN, credit card numbers, SSN): if explicitly present in the document, include them. Never guess. If absent, omit.

EXAMPLE of correct output:
{
  "version": 1,
  "person": { "first_name": "Antonio", "last_name": "Rossi", "tax_code": "RSSANT80A01H501Z" },
  "contact": { "email": "antonio@example.com", "phone": "+39 333 1234567" },
  "company": { "legal_name": "RDD Italia srl", "vat_number": "12345678901" },
  "custom": { "favourite_color": "blue", "horse_name": "Thunder" }
}

WRONG (do not do this): putting "custom" inside "person" or "contact" — that breaks validation.`;

/**
 * AI models sometimes ignore the "custom only at root" rule and put a
 * "custom" object inside person/contact/company/etc. We hoist any such
 * nested custom keys to the top-level custom object (namespaced by their
 * parent path so we don't lose information), and strip other unknown keys
 * that strict Zod would reject.
 */
function sanitizeAIOutput(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const root = { ...(raw as Record<string, unknown>) };

  const knownTopLevelKeys = new Set([
    'version', 'person', 'contact', 'addresses', 'company',
    'banking', 'credentials', 'payment_cards', 'documents', 'custom',
  ]);
  const knownSubKeys: Record<string, Set<string>> = {
    person: new Set(['first_name', 'last_name', 'middle_name', 'full_name', 'gender',
      'birth_date', 'birth_city', 'birth_country', 'nationality', 'tax_code', 'ssn']),
    contact: new Set(['email', 'email_secondary', 'phone', 'phone_mobile', 'pec', 'website']),
    company: new Set(['legal_name', 'trade_name', 'vat_number', 'tax_code', 'legal_form',
      'rea_number', 'founded_date', 'employees', 'annual_revenue', 'address']),
    banking: new Set(['iban', 'swift_bic', 'bank_name', 'account_holder']),
    documents: new Set(['passport_number', 'id_card_number', 'driver_license_number']),
    addresses: new Set(['primary', 'billing', 'shipping']),
  };

  const rootCustom: Record<string, unknown> = {
    ...((root.custom as Record<string, unknown>) ?? {}),
  };

  // Walk known sub-objects and lift unknown keys (including misplaced "custom")
  for (const [parent, allowed] of Object.entries(knownSubKeys)) {
    const sub = root[parent];
    if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) continue;
    const subObj = sub as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(subObj)) {
      if (allowed.has(k)) {
        cleaned[k] = v;
        continue;
      }
      if (k === 'custom' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
        // Hoist nested custom: { person: { custom: {x: 1} } } -> { custom: { person_x: 1 } }
        for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
          rootCustom[`${parent}_${ck}`] = cv;
        }
        continue;
      }
      // Other unknown sub-key: namespace it into rootCustom
      rootCustom[`${parent}_${k}`] = v;
    }
    root[parent] = cleaned;
  }

  // Drop unknown top-level keys (move them into custom)
  for (const k of Object.keys(root)) {
    if (!knownTopLevelKeys.has(k)) {
      rootCustom[k] = root[k];
      delete root[k];
    }
  }

  if (Object.keys(rootCustom).length > 0) {
    root.custom = rootCustom;
  }

  // Strip any email that looks like a placeholder / RFC-reserved example
  // (e.g. "mario.rossi@example.com"). The model sometimes echoes example
  // boilerplate from forms/documents — never let those reach the vault.
  const contact = root.contact as Record<string, unknown> | undefined;
  if (contact && typeof contact.email === 'string' && looksLikeExampleEmail(contact.email)) {
    delete contact.email;
  }
  if (contact && typeof contact.email_secondary === 'string' && looksLikeExampleEmail(contact.email_secondary)) {
    delete contact.email_secondary;
  }
  if (contact && typeof contact.pec === 'string' && looksLikeExampleEmail(contact.pec)) {
    delete contact.pec;
  }

  return root;
}

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

  const completion = await deps.ai.jsonCompletion({
    system: SYSTEM_PROMPT,
    user: userText,
    schema,
    schemaName: 'CanonicalData',
    temperature: 0,
  });

  const sanitized = sanitizeAIOutput(completion.data);
  const validation = validateCanonical(sanitized);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, data: validation.data, usage: completion.usage };
}

// Converts the Zod schema to a plain JSON-Schema-style object that OpenAI's
// structured-output endpoint accepts. We hand-produce a minimal subset
// because Zod->JSON-Schema converters add properties OpenAI does not allow.
function toOpenAIJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'person'],
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
