import { describe, it, expect, vi } from 'vitest';
import { computeProposal, resolveValue } from '@/background/orchestrator';
import type { FieldDescriptor } from '@/types/field';
import type { AIClient } from '@/background/ai-client';
import type { CanonicalData } from '@/lib/canonical-schema';

const makeAI = (result: unknown, usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }): Pick<AIClient, 'structuredCompletion'> => ({
  structuredCompletion: vi.fn().mockResolvedValue({ data: result, usage }),
});

function sampleFields(): FieldDescriptor[] {
  return [
    {
      id: 'ufc-1',
      selector: '#fn',
      widget: { kind: 'native-input', type: 'text' },
      labels: [{ text: 'First name', source: 'label' }],
      attributes: { name: 'first_name' },
      context: {},
    },
    {
      id: 'ufc-2',
      selector: '#em',
      widget: { kind: 'native-input', type: 'email' },
      labels: [{ text: 'Email', source: 'label' }],
      attributes: { name: 'email' },
      context: {},
    },
    {
      id: 'ufc-3',
      selector: '#pw',
      widget: { kind: 'native-input', type: 'password' },
      labels: [{ text: 'Password', source: 'label' }],
      attributes: { name: 'password' },
      context: {},
    },
  ];
}

function sampleData(): CanonicalData {
  return {
    version: 1,
    person: { first_name: 'Antonio', last_name: 'Rossi' },
    contact: { email: 'antonio@example.com' },
  };
}

describe('computeProposal', () => {
  it('calls AI with non-sensitive fields and returns mappings with values and statuses', async () => {
    const ai = makeAI({
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: 'person.first_name', confidence: 0.95 },
        { fieldId: 'ufc-2', canonicalKey: 'contact.email', confidence: 0.9 },
      ],
    });
    const result = await computeProposal(sampleFields(), sampleData(), { ai });

    const fn = result.proposal.find((m) => m.fieldId === 'ufc-1')!;
    expect(fn.canonicalKey).toBe('person.first_name');
    expect(fn.status).toBe('certain');
    expect(fn.displayValuePreview).toBe('Antonio');

    const em = result.proposal.find((m) => m.fieldId === 'ufc-2')!;
    expect(em.displayValuePreview).toBe('antonio@example.com');

    // Password field handled locally (not from AI), marked as sensitive-local with null value
    const pw = result.proposal.find((m) => m.fieldId === 'ufc-3')!;
    expect(pw.status).toBe('unmapped'); // no credentials stored for this host in sample data
  });

  it('marks uncertain for confidence between 0.5 and 0.8', async () => {
    const ai = makeAI({
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: 'person.first_name', confidence: 0.6 },
      ],
    });
    const fields = sampleFields().slice(0, 1);
    const result = await computeProposal(fields, sampleData(), { ai });
    expect(result.proposal[0]!.status).toBe('uncertain');
  });

  it('marks unmapped for null canonicalKey or low confidence', async () => {
    const ai = makeAI({
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: null, confidence: 0.0 },
      ],
    });
    const fields = sampleFields().slice(0, 1);
    const result = await computeProposal(fields, sampleData(), { ai });
    expect(result.proposal[0]!.status).toBe('unmapped');
    expect(result.proposal[0]!.canonicalKey).toBeNull();
  });

  it('masks sensitive values in preview even when mapped', async () => {
    const ai = makeAI({ mappings: [] });
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
      banking: { iban: 'IT60X0542811101000000123456' },
    };
    const fields: FieldDescriptor[] = [
      {
        id: 'ufc-iban',
        selector: '#iban',
        widget: { kind: 'native-input', type: 'text' },
        labels: [{ text: 'IBAN', source: 'label' }],
        attributes: { name: 'iban' },
        context: {},
      },
    ];
    const result = await computeProposal(fields, data, { ai });
    // Sensitive-local heuristic should map by name "iban" → banking.iban
    const m = result.proposal[0]!;
    expect(m.status).toBe('sensitive-local');
    expect(m.displayValuePreview).toMatch(/•/);
    expect(m.canonicalKey).toBe('banking.iban');
  });
});

describe('resolveValue', () => {
  it('resolves dotted path to value', () => {
    const data = sampleData();
    expect(resolveValue(data, 'person.first_name')).toBe('Antonio');
    expect(resolveValue(data, 'contact.email')).toBe('antonio@example.com');
    expect(resolveValue(data, 'does.not.exist')).toBe('');
  });

  it('resolves array index', () => {
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
      payment_cards: [
        { label: 'primary', number: '4111', expiry: '12/26', cvv: '123', holder: 'A B' },
      ],
    };
    expect(resolveValue(data, 'payment_cards[0].number')).toBe('4111');
  });
});
