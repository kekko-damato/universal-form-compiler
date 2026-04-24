import {
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
Rules:
- Only output fields supported by the schema. Unknown data can go in "custom".
- Italian fiscal terms: "Partita IVA" -> company.vat_number; "Codice Fiscale" of a person -> person.tax_code; of a company -> company.tax_code; "PEC" -> contact.pec.
- Dates MUST be ISO YYYY-MM-DD. Italian "GG/MM/AAAA" must be converted.
- Emails and URLs must be valid.
- If a value is ambiguous, skip it - never guess password, IBAN, credit card, or other sensitive data.
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

  const completion = await deps.ai.jsonCompletion({
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
// because Zod->JSON-Schema converters add properties OpenAI does not allow.
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
