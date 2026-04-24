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
