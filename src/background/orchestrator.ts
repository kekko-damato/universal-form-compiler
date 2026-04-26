import type { AIClient } from './ai-client';
import {
  MAPPING_SYSTEM_PROMPT,
  MAPPING_RESPONSE_SCHEMA,
  buildMappingUserPrompt,
} from './mapping-prompt';
import {
  FILL_SYSTEM_PROMPT,
  FILL_RESPONSE_SCHEMA,
  buildFillUserPrompt,
} from './fill-prompt';
import type { FieldDescriptor } from '@/types/field';
import type { Mapping, MappingStatus } from '@/types/mapping';
import {
  listAvailableKeys,
  isSensitivePath,
  scrubSensitive,
  type CanonicalData,
} from '@/lib/canonical-schema';
import {
  looksLikeExampleEmail,
  matchesFieldPlaceholder,
} from '@/lib/value-guards';
import { heuristicMap } from './heuristics';

export interface OrchestratorDeps {
  ai: Pick<AIClient, 'jsonCompletion'>;
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

  // Phase 1b: heuristic fast-path. Maps obvious fields (HTML autocomplete
  // attribute, known name/id tokens like "email", "first_name", "vat", etc.)
  // locally and removes them from the AI Pass 1 input. Big perf win because:
  //   - AI prompt size shrinks proportional to how many fields match
  //   - For fully-autocomplete-tagged forms, Pass 1 may be skipped entirely
  // Only rules with very high precision live in heuristics.ts.
  const heuristicMatches = heuristicMap(remaining, data);
  const heuristicById = new Map(heuristicMatches.map((m) => [m.fieldId, m]));
  const heuristicMappings: Mapping[] = [];
  const remainingForAI: FieldDescriptor[] = [];
  for (const f of remaining) {
    const h = heuristicById.get(f.id);
    if (h) {
      heuristicMappings.push({
        fieldId: f.id,
        canonicalKey: h.canonicalKey,
        displayValuePreview: resolveValue(data, h.canonicalKey),
        status: 'certain',
        confidence: h.confidence,
        note: h.note,
      });
    } else {
      remainingForAI.push(f);
    }
  }

  // Phase 2: AI mapping for non-sensitive, non-heuristic-matched fields
  const availableKeys = listAvailableKeys(data);
  let tokensUsed = 0;
  const aiMappings: Mapping[] = [...heuristicMappings];

  if (remainingForAI.length > 0 && availableKeys.length > 0) {
    const res = await deps.ai.jsonCompletion<{
      mappings: {
        fieldId: string;
        canonicalKey: string | null;
        confidence: number;
        note?: string | null;
      }[];
    }>({
      system: MAPPING_SYSTEM_PROMPT,
      user: buildMappingUserPrompt(remainingForAI, availableKeys),
      schema: MAPPING_RESPONSE_SCHEMA,
      schemaName: 'FieldMapping',
      temperature: 0,
    });
    tokensUsed = res.usage.total_tokens;

    for (const f of remainingForAI) {
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
      const mapping: Mapping = {
        fieldId: f.id,
        canonicalKey: found.canonicalKey,
        displayValuePreview: value,
        status,
        confidence: found.confidence,
      };
      // Treat null note as "no note" — omit the field instead of carrying null.
      if (found.note != null && found.note !== '') {
        mapping.note = found.note;
      }
      aiMappings.push(mapping);
    }
  } else if (remainingForAI.length > 0) {
    for (const f of remainingForAI) {
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

  // Phase 3: AI-fill pass for fields still unmapped or uncertain. The AI
  // sees the full canonical data (with sensitive paths scrubbed) and can
  // emit a literal value to drop into the field — useful for custom keys,
  // option translation (e.g. gender "M" → "Maschio"), and composed values.
  const allMappings = [...local, ...aiMappings];
  // Some fields look "certain" to Pass 1 but actually need composition. The
  // canonical example: the user has both person.first_name and middle_name
  // (or, anglo-style, a separate middle name); Pass 1 happily maps Italian
  // "Nome" → first_name and stops, but the page expects ALL given names
  // there. Re-route those to Pass 2 so the model can compose the right
  // value based on label semantics + the actual data.
  const hasMiddleName =
    typeof data.person.middle_name === 'string' &&
    data.person.middle_name.trim().length > 0;
  const refillIds = new Set(
    allMappings
      .filter((m) => {
        if (m.status === 'unmapped' || m.status === 'uncertain') return true;
        if (
          hasMiddleName &&
          (m.canonicalKey === 'person.first_name' ||
            m.canonicalKey === 'person.middle_name')
        ) {
          return true;
        }
        return false;
      })
      .map((m) => m.fieldId),
  );
  const refillFields = fields.filter((f) => {
    if (!refillIds.has(f.id)) return false;
    // Never AI-fill password or file fields, regardless of Pass 1 status.
    if (f.widget.kind === 'native-input') {
      if (f.widget.type === 'password' || f.widget.type === 'file') return false;
    }
    return true;
  });

  if (refillFields.length > 0) {
    try {
      const safeData = scrubSensitive(data);
      const res2 = await deps.ai.jsonCompletion<{
        mappings: {
          fieldId: string;
          value: string | null;
          canonicalKey: string | null;
          confidence: number;
          note?: string | null;
        }[];
      }>({
        system: FILL_SYSTEM_PROMPT,
        user: buildFillUserPrompt(refillFields, safeData),
        schema: FILL_RESPONSE_SCHEMA,
        schemaName: 'FieldFill',
        temperature: 0,
      });
      tokensUsed += res2.usage.total_tokens;

      // Post-AI safety net: build a flat "evidence text" of every leaf value
      // that exists in the canonical data, then reject any AI-emitted value
      // whose tokens are not present (or that is not an exact match of the
      // field's options list). This is the last line of defense against
      // hallucination: even if the model ignores the prompt and invents an
      // email/city/etc., we drop the value here.
      const evidenceText = buildEvidenceText(safeData);

      for (const fill of res2.data.mappings) {
        if (typeof fill.value !== 'string' || fill.value === '') continue;
        const idx = allMappings.findIndex((m) => m.fieldId === fill.fieldId);
        if (idx === -1) continue;
        const field = refillFields.find((f) => f.id === fill.fieldId);
        const fieldOptions = field?.options ?? [];

        // Hard rejections that override every other check: placeholder text
        // copied from the field, or known example/RFC-reserved email
        // domains. These are NEVER acceptable values.
        if (matchesFieldPlaceholder(fill.value, field)) {
          const prev = allMappings[idx]!;
          allMappings[idx] = {
            fieldId: prev.fieldId,
            canonicalKey: null,
            displayValuePreview: '',
            status: 'unmapped',
            confidence: 0,
            note: `AI stava per copiare il testo di esempio del form ("${fill.value}") — campo lasciato vuoto`,
          };
          continue;
        }
        if (looksLikeExampleEmail(fill.value)) {
          const prev = allMappings[idx]!;
          allMappings[idx] = {
            fieldId: prev.fieldId,
            canonicalKey: null,
            displayValuePreview: '',
            status: 'unmapped',
            confidence: 0,
            note: `AI ha proposto un'email di esempio ("${fill.value}") — campo lasciato vuoto`,
          };
          continue;
        }

        const evidenced = valueIsEvidenced(fill.value, evidenceText, fieldOptions);
        const inferable = isReasonableInference(fill.value, field, data);
        if (!evidenced && !inferable) {
          // Value not traceable to the data → likely hallucinated. Mark the
          // field as unmapped with a clear note so the user knows to fill it
          // manually instead of trusting an invented value.
          const prev = allMappings[idx]!;
          allMappings[idx] = {
            fieldId: prev.fieldId,
            canonicalKey: null,
            displayValuePreview: '',
            status: 'unmapped',
            confidence: 0,
            note: `AI ha proposto "${fill.value}" ma non è presente nei dati — campo lasciato vuoto`,
          };
          continue;
        }

        const prev = allMappings[idx]!;
        const upgraded: Mapping = {
          fieldId: prev.fieldId,
          canonicalKey: fill.canonicalKey ?? null,
          displayValuePreview: fill.value,
          status: 'certain',
          confidence: fill.confidence,
          literalValue: fill.value,
          aiResolved: true,
        };
        if (fill.note != null && fill.note !== '') {
          upgraded.note = fill.note;
        } else if (fill.canonicalKey == null) {
          upgraded.note = 'Compilato dall\'AI dai dati';
        }
        allMappings[idx] = upgraded;
      }
    } catch {
      // If Pass 2 fails (rate-limit, malformed JSON, etc.), keep the Pass 1
      // result intact rather than blowing up the whole compile flow.
    }
  }

  return {
    proposal: allMappings,
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

// Flatten every leaf value of the canonical data into one lowercase string.
// Used as the "evidence corpus" against which Pass-2 outputs are validated:
// if a candidate value (or its tokens) doesn't appear here AND isn't a field
// option, the AI made it up.
export function buildEvidenceText(data: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(String(v).toLowerCase());
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(data);
  return parts.join('  '); // unlikely separator → no false substring hits
}

const TRIVIAL_TOKENS = new Set([
  'di', 'del', 'della', 'dei', 'delle', 'da', 'in', 'a', 'al', 'alla',
  'con', 'per', 'su', 'sul', 'sulla',
  'and', 'the', 'of', 'to',
  'el', 'la', 'lo', 'le', 'gli', 'un', 'una', 'uno',
  'srl', 's.r.l', 'spa', 's.p.a',
]);

// Recognized tokens for the GENDER common-sense inference. Kept narrow on
// purpose: gender is a linguistic deduction from a name we already have, not
// an external lookup.
const GENDER_TOKENS = new Set([
  'm', 'f', 'x',
  'maschio', 'femmina', 'maschile', 'femminile',
  'male', 'female',
  'uomo', 'donna',
  'man', 'woman',
]);

function fieldText(f: FieldDescriptor): string {
  return [
    ...f.labels.map((l) => l.text),
    f.attributes.name ?? '',
    f.attributes.id ?? '',
    f.attributes.placeholder ?? '',
    f.attributes.ariaLabel ?? '',
    f.attributes.title ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

// Narrow common-sense inferences the AI is allowed to make WITHOUT the
// value appearing in the canonical data — because they are linguistic
// deductions from data we already have, not external factual lookups.
//
// Kept very small on purpose: gender from a clearly-gendered first name.
// Place of birth, residence, phone, email, etc. are NOT here — those are
// external facts and must come verbatim from the document.
export function isReasonableInference(
  value: string,
  field: FieldDescriptor | undefined,
  data: CanonicalData,
): boolean {
  if (!field) return false;
  const v = value.trim().toLowerCase();
  if (v.length === 0) return false;
  const text = fieldText(field);
  if (/\b(sesso|gender|sex)\b/.test(text)) {
    if (!GENDER_TOKENS.has(v)) return false;
    const fn = data.person.first_name;
    return typeof fn === 'string' && fn.trim().length > 0;
  }
  return false;
}

// Returns true if `value` is "evidenced" by the canonical data. A value is
// allowed when:
//   1) It exactly matches one of the field's options (covers select/radio
//      translations, e.g. gender "M" → option "Maschio").
//   2) The whole value (lowercased) appears as a substring of the evidence.
//   3) Every significant token (length ≥ 2, non-trivial connective) of the
//      value appears in the evidence — covers compositions like
//      "Raffaele Francesco" when both names are stored in separate fields.
export function valueIsEvidenced(
  value: string,
  evidence: string,
  options: string[],
): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  const vLower = v.toLowerCase();

  // (1) Field-option match.
  for (const opt of options) {
    if (opt.toLowerCase() === vLower) return true;
  }

  // (2) Whole-value substring match.
  if (evidence.includes(vLower)) return true;

  // (3) Every significant token must appear.
  const tokens = vLower
    .split(/[\s,;.\-/'"\\()[\]{}]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !TRIVIAL_TOKENS.has(t));
  if (tokens.length === 0) return false;
  return tokens.every((t) => evidence.includes(t));
}

function matchSensitiveLocally(
  f: FieldDescriptor,
  data: CanonicalData,
): Mapping | null {
  const name = (f.attributes.name ?? '').toLowerCase();
  const id = (f.attributes.id ?? '').toLowerCase();
  const autocomplete = (f.attributes.autocomplete ?? '').toLowerCase();
  const type = f.widget.kind === 'native-input' ? f.widget.type : '';

  // Password field → credentials for current host (host plumbing deferred to 1d).
  // Until host is threaded through, treat every password field as unmapped but
  // handled locally (never sent to AI so we never leak the label/name context).
  if (type === 'password') {
    return {
      fieldId: f.id,
      canonicalKey: null,
      displayValuePreview: '',
      status: 'unmapped',
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
