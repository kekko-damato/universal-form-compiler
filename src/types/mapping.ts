import type { FieldDescriptor } from './field';

export type MappingStatus = 'certain' | 'uncertain' | 'unmapped' | 'sensitive-local' | 'skipped';

export interface Mapping {
  fieldId: string;                  // matches FieldDescriptor.id
  canonicalKey: string | null;      // e.g. "person.first_name", null if unmapped
  displayValuePreview: string;      // value from vault, masked if sensitive
  status: MappingStatus;
  confidence: number;               // 0..1
  note?: string;                    // human-readable reason (e.g. "no match", "widget unsupported")
  // When set, the fill layer should write this value verbatim instead of
  // resolving canonicalKey. Produced by the AI Pass 2 ("AI-fill"), where the
  // model has access to the full canonical data and can emit a derived /
  // option-translated value (e.g. "Maschio" for gender:"M", or a concatenated
  // full name). Mutually compatible with canonicalKey: when both are set,
  // canonicalKey is informational and literalValue wins on fill.
  literalValue?: string;
  // True when this mapping was produced by Pass 2 instead of the standard
  // semantic-key Pass 1. UI uses this to mark with an "AI-resolved" badge so
  // the user can spot-check.
  aiResolved?: boolean;
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
