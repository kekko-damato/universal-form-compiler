import { describe, it, expect } from 'vitest';
import {
  buildMappingUserPrompt,
  MAPPING_RESPONSE_SCHEMA,
  MAPPING_SYSTEM_PROMPT,
} from '@/background/mapping-prompt';
import type { FieldDescriptor } from '@/types/field';

describe('mapping prompt', () => {
  it('MAPPING_SYSTEM_PROMPT is non-empty', () => {
    expect(MAPPING_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('schema declares mappings array of {fieldId, canonicalKey, confidence}', () => {
    expect(MAPPING_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
      properties: {
        mappings: {
          type: 'array',
          items: expect.objectContaining({
            required: expect.arrayContaining(['fieldId', 'canonicalKey', 'confidence']),
          }),
        },
      },
    });
  });

  it('buildMappingUserPrompt includes fields and keys as JSON', () => {
    const fields: FieldDescriptor[] = [
      {
        id: 'ufc-1',
        selector: '#a',
        widget: { kind: 'native-input', type: 'email' },
        labels: [{ text: 'Email', source: 'label' }],
        attributes: { name: 'email', type: 'email' },
        context: {},
      },
    ];
    const prompt = buildMappingUserPrompt(fields, ['person.first_name', 'contact.email']);
    expect(prompt).toContain('contact.email');
    expect(prompt).toContain('ufc-1');
    expect(prompt).toContain('"labels"');
  });
});
