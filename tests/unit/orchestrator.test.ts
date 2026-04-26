import { describe, it, expect, vi } from 'vitest';
import { computeProposal, resolveValue } from '@/background/orchestrator';
import type { FieldDescriptor } from '@/types/field';
import type { AIClient } from '@/background/ai-client';
import type { CanonicalData } from '@/lib/canonical-schema';

const makeAI = (result: unknown, usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }): Pick<AIClient, 'jsonCompletion'> => ({
  jsonCompletion: vi.fn().mockResolvedValue({ data: result, usage }),
});

// Helper for two-pass orchestration: returns pass1 then pass2 in order.
const makeAITwoPass = (
  pass1: unknown,
  pass2: unknown,
  usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
): Pick<AIClient, 'jsonCompletion'> => {
  const fn = vi.fn();
  fn.mockResolvedValueOnce({ data: pass1, usage });
  fn.mockResolvedValueOnce({ data: pass2, usage });
  return { jsonCompletion: fn };
};

// Sample fields without name/id tokens that would trigger the heuristic
// fast-path. The orchestrator tests focus on the AI pipeline; the
// heuristics get their own dedicated tests in heuristics.test.ts.
function sampleFields(): FieldDescriptor[] {
  return [
    {
      id: 'ufc-1',
      selector: '#fn',
      widget: { kind: 'native-input', type: 'text' },
      labels: [{ text: 'First name', source: 'label' }],
      attributes: {},
      context: {},
    },
    {
      id: 'ufc-2',
      selector: '#em',
      widget: { kind: 'native-input', type: 'email' },
      labels: [{ text: 'Email', source: 'label' }],
      attributes: {},
      context: {},
    },
    {
      id: 'ufc-3',
      selector: '#pw',
      widget: { kind: 'native-input', type: 'password' },
      labels: [{ text: 'Password', source: 'label' }],
      attributes: {},
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

  it('handles AI response with note: null without crashing', async () => {
    const ai = makeAI({
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: 'person.first_name', confidence: 0.95, note: null },
        { fieldId: 'ufc-2', canonicalKey: null, confidence: 0.2, note: null },
      ],
    });
    const fields = sampleFields().slice(0, 2);
    const result = await computeProposal(fields, sampleData(), { ai });
    const fn = result.proposal.find((m) => m.fieldId === 'ufc-1')!;
    expect(fn.canonicalKey).toBe('person.first_name');
    expect(fn.note).toBeUndefined();
    const em = result.proposal.find((m) => m.fieldId === 'ufc-2')!;
    expect(em.status).toBe('unmapped');
    expect(em.note).toBeUndefined();
  });

  it('Pass 2 upgrades unmapped fields to certain when AI-fill returns a value', async () => {
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    const pass2 = {
      mappings: [
        {
          fieldId: 'ufc-1',
          value: 'Antonio Rossi',
          canonicalKey: null,
          confidence: 0.85,
          note: 'concatenated first + last name',
        },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    const fields = sampleFields().slice(0, 1);
    const result = await computeProposal(fields, sampleData(), { ai });
    const m = result.proposal.find((mm) => mm.fieldId === 'ufc-1')!;
    expect(m.status).toBe('certain');
    expect(m.literalValue).toBe('Antonio Rossi');
    expect(m.displayValuePreview).toBe('Antonio Rossi');
    expect(m.aiResolved).toBe(true);
    expect(m.canonicalKey).toBeNull();
  });

  it('Pass 2 accepts a value that matches one of the field options (e.g. gender translation)', async () => {
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-g', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    const pass2 = {
      mappings: [
        {
          fieldId: 'ufc-g',
          value: 'Maschio',
          canonicalKey: 'person.gender',
          confidence: 0.9,
          note: null,
        },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    // Field is a select with "Maschio"/"Femmina" options — the AI is allowed
    // to translate gender:"M" into one of those options because they are
    // explicitly part of the field, not invented.
    const fields: FieldDescriptor[] = [
      {
        id: 'ufc-g',
        selector: '#g',
        widget: { kind: 'native-select', multiple: false },
        labels: [{ text: 'Sesso', source: 'label' }],
        attributes: { name: 'sesso' },
        options: ['Maschio', 'Femmina'],
        context: {},
      },
    ];
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi', gender: 'M' },
      contact: { email: 'antonio@example.com' },
    };
    const result = await computeProposal(fields, data, { ai });
    const m = result.proposal[0]!;
    expect(m.status).toBe('certain');
    expect(m.literalValue).toBe('Maschio');
    expect(m.aiResolved).toBe(true);
  });

  it('Pass 2 ALLOWS gender inference from a clearly-gendered first name (text input, no options)', async () => {
    // Free-text "Sesso" field, no options. Data has only first_name.
    // The AI should be allowed to output "Maschio" via the narrow gender
    // inference exception, because "Raffaele" is unambiguously male.
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-g', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    const pass2 = {
      mappings: [
        {
          fieldId: 'ufc-g',
          value: 'Maschio',
          canonicalKey: null,
          confidence: 0.85,
          note: 'inferito dal nome',
        },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    const fields: FieldDescriptor[] = [
      {
        id: 'ufc-g',
        selector: '#sesso',
        widget: { kind: 'native-input', type: 'text' },
        labels: [{ text: 'Sesso', source: 'label' }],
        attributes: { name: 'sesso' },
        context: {},
      },
    ];
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Raffaele', last_name: "D'Amato" }, // no gender stored
      contact: {},
    };
    const result = await computeProposal(fields, data, { ai });
    const m = result.proposal[0]!;
    expect(m.status).toBe('certain');
    expect(m.literalValue).toBe('Maschio');
    expect(m.aiResolved).toBe(true);
  });

  it('Pass 2 REJECTS a fabricated email (external fact, never derivable)', async () => {
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    // Data has no email — AI hallucinates a plausible-looking one on a real
    // domain. Must be rejected by the evidence-text check (the local-part
    // is not present anywhere in the canonical data).
    const pass2 = {
      mappings: [
        {
          fieldId: 'ufc-1',
          value: 'svxhe@gmail.com',
          canonicalKey: 'contact.email',
          confidence: 0.95,
          note: null,
        },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    const fields = sampleFields().slice(0, 1);
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' },
      contact: {}, // no email at all
    };
    const result = await computeProposal(fields, data, { ai });
    const m = result.proposal[0]!;
    expect(m.status).toBe('unmapped');
    expect(m.literalValue).toBeUndefined();
    expect(m.note).toMatch(/non è presente nei dati/i);
  });

  it('Pass 2 REJECTS the field placeholder copied verbatim', async () => {
    // Form has placeholder="esempio: mario.rossi@dominio.it" and AI literally
    // outputs that as the email value. Must be rejected with a clear note.
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    const pass2 = {
      mappings: [
        {
          fieldId: 'ufc-1',
          value: 'mario.rossi@dominio.it',
          canonicalKey: 'contact.email',
          confidence: 0.9,
          note: null,
        },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    const fields: FieldDescriptor[] = [
      {
        id: 'ufc-1',
        selector: '#email',
        widget: { kind: 'native-input', type: 'email' },
        labels: [{ text: 'Email', source: 'label' }],
        attributes: {
          name: 'email',
          placeholder: 'Esempio: mario.rossi@dominio.it',
        },
        context: {},
      },
    ];
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' },
      contact: {},
    };
    const result = await computeProposal(fields, data, { ai });
    const m = result.proposal[0]!;
    expect(m.status).toBe('unmapped');
    expect(m.literalValue).toBeUndefined();
    expect(m.note).toMatch(/testo di esempio del form/i);
  });

  it('Pass 2 REJECTS an example-domain email even if not in the placeholder', async () => {
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-2', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    const pass2 = {
      mappings: [
        {
          fieldId: 'ufc-2',
          value: 'antonio.rossi@example.com',
          canonicalKey: 'contact.email',
          confidence: 0.9,
          note: null,
        },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    const fields = sampleFields().slice(1, 2); // email field id is ufc-2
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' },
      contact: {},
    };
    const result = await computeProposal(fields, data, { ai });
    const m = result.proposal[0]!;
    expect(m.status).toBe('unmapped');
    expect(m.literalValue).toBeUndefined();
    expect(m.note).toMatch(/email di esempio/i);
  });

  it('Pass 2 REJECTS a fabricated city (external fact not in data)', async () => {
    // Form has a "Provincia" / "Luogo di nascita" field. Data only has the
    // person's name. The AI tries to invent "Roma" / "RM". Must be rejected.
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    const pass2 = {
      mappings: [
        {
          fieldId: 'ufc-1',
          value: 'Roma',
          canonicalKey: 'addresses.primary.city',
          confidence: 0.6,
          note: null,
        },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    const fields: FieldDescriptor[] = [
      {
        id: 'ufc-1',
        selector: '#luogo',
        widget: { kind: 'native-input', type: 'text' },
        labels: [{ text: 'Luogo di nascita', source: 'label' }],
        attributes: { name: 'luogo_nascita' },
        context: {},
      },
    ];
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Raffaele', last_name: "D'Amato" },
      contact: {},
    };
    const result = await computeProposal(fields, data, { ai });
    const m = result.proposal[0]!;
    expect(m.status).toBe('unmapped');
    expect(m.literalValue).toBeUndefined();
    expect(m.note).toMatch(/non è presente nei dati/i);
  });

  it('Pass 2 leaves field untouched when AI returns null value', async () => {
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    const pass2 = {
      mappings: [
        { fieldId: 'ufc-1', value: null, canonicalKey: null, confidence: 0, note: null },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    const fields = sampleFields().slice(0, 1);
    const result = await computeProposal(fields, sampleData(), { ai });
    expect(result.proposal[0]!.status).toBe('unmapped');
    expect(result.proposal[0]!.literalValue).toBeUndefined();
  });

  it('Pass 2 skips password fields even if Pass 1 left them unmapped', async () => {
    const pass1 = { mappings: [] }; // password handled by sensitive-local heuristic
    const pass2 = {
      mappings: [
        { fieldId: 'ufc-3', value: 'leakedpassword', canonicalKey: null, confidence: 1, note: null },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    // Only password field, so Pass 1 has no remaining work; Pass 2 must
    // not be called for password fields. Use ufc-3 from sampleFields.
    const fields = sampleFields().slice(2, 3);
    const result = await computeProposal(fields, sampleData(), { ai });
    const pw = result.proposal[0]!;
    expect(pw.status).toBe('unmapped');
    expect(pw.literalValue).toBeUndefined();
    // Pass 2 should NOT have been invoked because the only refill candidate
    // is a password field (filtered out).
    expect(ai.jsonCompletion).toHaveBeenCalledTimes(0);
  });

  it('Pass 2 re-evaluates first_name mapping when middle_name exists in data', async () => {
    // Pass 1 confidently maps "Nome" → person.first_name (certain).
    // Because middle_name exists, the orchestrator should still send the
    // field to Pass 2 so the model can compose the full given name.
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: 'person.first_name', confidence: 0.95, note: null },
      ],
    };
    const pass2 = {
      mappings: [
        {
          fieldId: 'ufc-1',
          value: 'Raffaele Francesco',
          canonicalKey: null,
          confidence: 0.95,
          note: 'composed first + middle',
        },
      ],
    };
    const ai = makeAITwoPass(pass1, pass2);
    const fields = sampleFields().slice(0, 1);
    const data: CanonicalData = {
      version: 1,
      person: {
        first_name: 'Raffaele',
        last_name: 'D\'Amato',
        middle_name: 'Francesco',
      },
      contact: { email: 'r@x.it' },
    };
    const result = await computeProposal(fields, data, { ai });
    const m = result.proposal[0]!;
    expect(m.literalValue).toBe('Raffaele Francesco');
    expect(m.aiResolved).toBe(true);
    expect(m.status).toBe('certain');
    // Pass 2 must have been invoked even though Pass 1 was already certain.
    expect(ai.jsonCompletion).toHaveBeenCalledTimes(2);
  });

  it('Pass 2 is NOT triggered for first_name when middle_name is empty', async () => {
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: 'person.first_name', confidence: 0.95, note: null },
      ],
    };
    const ai = makeAI(pass1);
    const fields = sampleFields().slice(0, 1);
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' }, // no middle_name
      contact: { email: 'a@b.co' },
    };
    const result = await computeProposal(fields, data, { ai });
    expect(result.proposal[0]!.literalValue).toBeUndefined();
    expect(ai.jsonCompletion).toHaveBeenCalledTimes(1);
  });

  it('Pass 2 swallows errors and keeps Pass 1 results', async () => {
    const pass1 = {
      mappings: [
        { fieldId: 'ufc-1', canonicalKey: null, confidence: 0.0, note: null },
      ],
    };
    const fn = vi.fn();
    fn.mockResolvedValueOnce({
      data: pass1,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    fn.mockRejectedValueOnce(new Error('rate limit'));
    const ai = { jsonCompletion: fn };
    const fields = sampleFields().slice(0, 1);
    const result = await computeProposal(fields, sampleData(), { ai });
    expect(result.proposal[0]!.status).toBe('unmapped');
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
