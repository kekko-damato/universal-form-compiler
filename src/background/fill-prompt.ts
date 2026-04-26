import type { FieldDescriptor } from '@/types/field';

// Pass 2 — "AI-fill". For every field that Pass 1 left as `uncertain` or
// `unmapped`, this prompt gives the model the FULL canonical data (with
// values, minus sensitive paths) and asks it to produce a concrete value to
// drop into the field, OR null if no usable info exists.

export const FILL_SYSTEM_PROMPT = `You are filling web form fields from a user's personal/business data dictionary.

CRITICAL ANTI-FABRICATION RULE — read this twice:
You are FORBIDDEN from inventing, guessing, or making up FACTUAL EXTERNAL data. Better to leave a field empty than to invent. Every value you output MUST be either:
  (a) Present verbatim (case-insensitive) in the canonical data provided, OR
  (b) A trivial transformation of values present in the data (concatenation of two named keys; date format change; whitespace normalization; case change; abbreviation of a name to its initial), OR
  (c) An exact match (or label/value mapping) of one of the field's "options" list, where the source value comes from data, OR
  (d) A NARROW common-sense linguistic inference from data values (see ALLOWED INFERENCES below).

ALLOWED INFERENCES (deductions from data already present, not external lookups):
- Gender from a clearly-gendered first name. If the form has a "Sesso" / "Gender" / "Sex" field and the data has person.first_name (e.g., "Raffaele", "Maria", "Antonio") whose grammatical gender is unambiguous, you may output the corresponding gender value ("M"/"F", "Maschio"/"Femmina", or the matching option label, depending on the field). Skip if the name is gender-ambiguous.

FORBIDDEN INFERENCES (these are FACTS the document either contains or doesn't — NEVER derive them from elsewhere):
- Email addresses (don't compose name@domain.tld from a name)
- Phone numbers, mobile numbers
- Postal addresses, streets, cities, provinces, postal codes, countries
- Dates of any kind (birth date, founding date, expiration) — except pure format changes of an existing date
- Codice Fiscale, Partita IVA, SSN, passport / ID / driving-licence numbers
- Place of birth, place of residence, place of work
- Any code, identifier, IBAN, card number, password, factual lookup
- Bank names, employer names, school names, anything not literally in the data

If a field requires anything in the FORBIDDEN list and the data does not contain it, return value: null. The user PREFERS empty fields to fabricated ones; a wrong value can have legal/financial consequences.

You receive:
  1) A list of form fields the previous pass could not map confidently (each with id, widget, labels, attributes, options, validation, context).
  2) The user's full canonical data (JSON). Sensitive paths (passwords, IBAN, card numbers, SSN, ID numbers) have been removed for privacy.

For EACH field, output exactly one entry: {fieldId, value, canonicalKey, confidence, note}.

Field-specific guidance:
- For radio/select/checkbox fields with an "options" list: "value" MUST be one of the option strings — pick the one whose meaning matches a value present in the data. If no option semantically matches data you have, return null.
- For numeric/date fields: format the value to match the field's "type" or pattern when possible (purely a format change, never a content change).
- COMPOSED NAMES: when a "Nome" / "First name" / "Name" field is generic (no separate "middle name" field exists in the form), AND the canonical data has BOTH person.first_name and person.middle_name, output the FULL given name as "first_name middle_name" joined by a space (e.g. first_name="Raffaele", middle_name="Francesco" → value="Raffaele Francesco"). Only put just first_name when the form explicitly has a separate "Secondo nome" / "Middle name" field.
- File uploads, password fields, anything explicitly marked sensitive: return null.

Output fields explained:
- "value": the literal string to type (or null per the rule above).
- "canonicalKey": the dotted path you used. MANDATORY when value is non-null. Use null only if the value was composed from multiple keys; in that case the value MUST be a literal join/format of values that all appear in the data.
- "confidence": 0..1 — how sure are you the value is correct AND fully traceable to the data.
- "note": short Italian explanation (max ~80 chars) or null.

Italian forms are common: handle Italian labels naturally (Nome, Cognome, Partita IVA, Codice Fiscale, PEC, Sede legale, Provincia, CAP, ecc.). Italian double given names ("Maria Cristina", "Raffaele Francesco") are a single given name — keep them together.

When in doubt, return null. The user reviews the result; an empty field is a clear signal to fill it manually, an invented value is a silent error.`;

export const FILL_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['mappings'],
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fieldId', 'value', 'canonicalKey', 'confidence', 'note'],
        properties: {
          fieldId: { type: 'string' },
          value: { type: ['string', 'null'] },
          canonicalKey: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
};

export function buildFillUserPrompt(
  fields: FieldDescriptor[],
  canonicalDataSafe: unknown,
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
  const dataJson = JSON.stringify(canonicalDataSafe, null, 2);
  return `Canonical data (sensitive paths already removed):\n${dataJson}\n\nFields to fill:\n${fieldsJson}\n\nReminder: every value you emit must be present in the data above (verbatim, simple format change, composition of named keys, or matching a field option that maps to a real data value). When in doubt, return value: null.`;
}
