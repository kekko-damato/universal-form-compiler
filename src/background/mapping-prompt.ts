import type { FieldDescriptor } from '@/types/field';

export const MAPPING_SYSTEM_PROMPT = `You match web form fields to keys from a user's canonical data dictionary.
Rules:
- You receive a list of form fields (each with a stable id, widget type, labels, attributes, options, validation, context) and a list of available canonical keys (dotted paths).
- For EACH field, output exactly one mapping entry: {fieldId, canonicalKey|null, confidence (0..1), note}.
- confidence ≥ 0.8 means certain; 0.5-0.79 uncertain; <0.5 means unmapped (return canonicalKey=null).
- NEVER invent canonical keys — use only those provided.
- You do NOT see user values. Match by semantics alone (label text, attribute names, widget type).
- For radio/select: the canonical key's value will be matched against options later; focus on the field semantics.
- Skip file inputs (return null, note "file upload").
- If multiple fields semantically match the same canonical key (e.g., two email fields), pick the best match and return null for the others with a note explaining.
- Italian labels: "Nome" → person.first_name, "Cognome" → person.last_name, "Partita IVA" → company.vat_number, "Codice Fiscale" (context company) → company.tax_code, "PEC" → contact.pec.
- Always include a "note" field in every mapping entry. Use null when there is nothing to say; otherwise a short human-readable explanation (e.g., "duplicate email field", "file upload").`;

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
        required: ['fieldId', 'canonicalKey', 'confidence', 'note'],
        properties: {
          fieldId: { type: 'string' },
          canonicalKey: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
};

export function buildMappingUserPrompt(
  fields: FieldDescriptor[],
  availableKeys: string[],
): string {
  // Compact field representation: drop noise that does not help the model
  // pick a canonical key (validation rules, redundant attributes, source
  // tags inside labels). This trims prompt tokens significantly on large
  // forms — the AI runs faster and costs less without losing signal.
  const compactFields = fields.map((f) => {
    const out: Record<string, unknown> = {
      id: f.id,
      labels: f.labels.map((l) => l.text),
    };
    out.widget =
      f.widget.kind === 'native-input'
        ? f.widget.type
        : f.widget.kind === 'native-select'
          ? 'select'
          : f.widget.kind === 'native-textarea'
            ? 'textarea'
            : 'unsupported';
    const a: Record<string, string> = {};
    if (f.attributes.name) a.name = f.attributes.name;
    if (f.attributes.id) a.id = f.attributes.id;
    if (f.attributes.autocomplete) a.autocomplete = f.attributes.autocomplete;
    if (f.attributes.placeholder) a.placeholder = f.attributes.placeholder;
    if (Object.keys(a).length > 0) out.attrs = a;
    if (f.options && f.options.length > 0) out.options = f.options;
    if (f.context.formTitle) out.formTitle = f.context.formTitle;
    return out;
  });
  // Inline JSON (no pretty-print) → fewer tokens.
  return `Available canonical keys:\n${JSON.stringify(availableKeys)}\n\nFields to map:\n${JSON.stringify(compactFields)}`;
}
