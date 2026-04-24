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
