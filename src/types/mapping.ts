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
