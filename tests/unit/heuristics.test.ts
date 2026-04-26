import { describe, it, expect } from 'vitest';
import { heuristicMap } from '@/background/heuristics';
import type { FieldDescriptor } from '@/types/field';
import type { CanonicalData } from '@/lib/canonical-schema';

function field(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    id: 'ufc-1',
    selector: '#x',
    widget: { kind: 'native-input', type: 'text' },
    labels: [],
    attributes: {},
    context: {},
    ...overrides,
  };
}

const sampleData: CanonicalData = {
  version: 1,
  person: {
    first_name: 'Antonio',
    last_name: 'Rossi',
    middle_name: 'Maria',
    birth_date: '1990-01-01',
  },
  contact: {
    email: 'a@b.co',
    phone: '+39 333 1234567',
  },
  company: {
    legal_name: 'ACME Srl',
    vat_number: '12345678901',
  },
  addresses: {
    primary: {
      street: 'Via Roma 1',
      number: '',
      city: 'Bari',
      postal_code: '70121',
      country: 'IT',
    },
  },
};

describe('heuristicMap — autocomplete attribute', () => {
  it('maps autocomplete="email" to contact.email', () => {
    const m = heuristicMap(
      [field({ attributes: { autocomplete: 'email' } })],
      sampleData,
    );
    expect(m).toEqual([
      expect.objectContaining({ canonicalKey: 'contact.email' }),
    ]);
  });

  it('maps autocomplete="given-name" to person.first_name', () => {
    const m = heuristicMap(
      [field({ attributes: { autocomplete: 'given-name' } })],
      sampleData,
    );
    expect(m[0]?.canonicalKey).toBe('person.first_name');
  });

  it('maps autocomplete token list ("shipping street-address")', () => {
    const m = heuristicMap(
      [field({ attributes: { autocomplete: 'shipping street-address' } })],
      sampleData,
    );
    expect(m[0]?.canonicalKey).toBe('addresses.primary.street');
  });

  it('does NOT map when canonical data has no value at the key', () => {
    const m = heuristicMap(
      [field({ attributes: { autocomplete: 'email' } })],
      {
        version: 1,
        person: { first_name: 'A', last_name: 'B' },
        contact: {}, // no email
      },
    );
    expect(m).toEqual([]);
  });
});

describe('heuristicMap — name/id tokens', () => {
  it('maps name="email" to contact.email', () => {
    const m = heuristicMap(
      [field({ attributes: { name: 'email' } })],
      sampleData,
    );
    expect(m[0]?.canonicalKey).toBe('contact.email');
  });

  it('maps name="cognome" to person.last_name', () => {
    const m = heuristicMap(
      [field({ attributes: { name: 'cognome' } })],
      sampleData,
    );
    expect(m[0]?.canonicalKey).toBe('person.last_name');
  });

  it('maps name="partita_iva" to company.vat_number', () => {
    const m = heuristicMap(
      [field({ attributes: { name: 'partita_iva' } })],
      sampleData,
    );
    expect(m[0]?.canonicalKey).toBe('company.vat_number');
  });

  it('matches case-insensitively and with separator normalization', () => {
    const m = heuristicMap(
      [field({ attributes: { name: 'P-IVA' } })],
      sampleData,
    );
    // 'P-IVA' → 'p_iva' after normalization
    expect(m[0]?.canonicalKey).toBe('company.vat_number');
  });

  it('does not match unrelated names', () => {
    const m = heuristicMap(
      [field({ attributes: { name: 'random_field_xyz' } })],
      sampleData,
    );
    expect(m).toEqual([]);
  });

  it('does not return a match if canonical lacks the value', () => {
    // Field name says VAT but data has no company at all.
    const m = heuristicMap(
      [field({ attributes: { name: 'vat' } })],
      {
        version: 1,
        person: { first_name: 'A', last_name: 'B' },
        contact: {},
      },
    );
    expect(m).toEqual([]);
  });
});

describe('heuristicMap — autocomplete wins over name', () => {
  it('uses autocomplete first', () => {
    // autocomplete says email, name says vat → autocomplete wins
    const m = heuristicMap(
      [field({ attributes: { autocomplete: 'email', name: 'vat' } })],
      sampleData,
    );
    expect(m[0]?.canonicalKey).toBe('contact.email');
  });
});
