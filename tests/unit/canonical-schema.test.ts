import { describe, it, expect } from 'vitest';
import {
  CanonicalDataSchema,
  SENSITIVE_FIELD_PATHS,
  validateCanonical,
  listAvailableKeys,
  isSensitivePath,
} from '@/lib/canonical-schema';

describe('canonical schema', () => {
  it('accepts minimal valid data', () => {
    const data = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' },
      contact: { email: 'a.rossi@example.com' },
    };
    const result = CanonicalDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'not-an-email' },
    };
    expect(CanonicalDataSchema.safeParse(data).success).toBe(false);
  });

  it('rejects invalid birth_date (not ISO YYYY-MM-DD)', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B', birth_date: '05/03/1990' },
      contact: { email: 'a@b.co' },
    };
    expect(CanonicalDataSchema.safeParse(data).success).toBe(false);
  });

  it('accepts unknown extra fields in custom.*', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
      custom: { horse_name: 'Thunder', lucky_number: 7 },
    };
    expect(CanonicalDataSchema.safeParse(data).success).toBe(true);
  });

  it('version must be literal 1', () => {
    const data = {
      version: 2,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
    };
    expect(CanonicalDataSchema.safeParse(data).success).toBe(false);
  });
});

describe('validateCanonical', () => {
  it('returns parsed data on success', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B' },
      contact: { email: 'a@b.co' },
    };
    const result = validateCanonical(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.person.first_name).toBe('A');
    }
  });

  it('returns structured error list on failure', () => {
    const data = {
      version: 1,
      person: { first_name: '', last_name: 'B' },
      contact: { email: 'bad' },
    };
    const result = validateCanonical(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty('path');
      expect(result.errors[0]).toHaveProperty('message');
    }
  });
});

describe('SENSITIVE_FIELD_PATHS', () => {
  it('includes known sensitive paths', () => {
    expect(SENSITIVE_FIELD_PATHS).toEqual(
      expect.arrayContaining([
        'credentials.*.password',
        'payment_cards[*].number',
        'payment_cards[*].cvv',
        'banking.iban',
        'documents.passport_number',
        'documents.id_card_number',
        'documents.driver_license_number',
        'person.ssn',
      ]),
    );
  });

  it('isSensitivePath matches glob patterns', () => {
    // credentials.*.password uses single-segment glob; keys like "example_com" avoid dots
    expect(isSensitivePath('credentials.example_com.password')).toBe(true);
    expect(isSensitivePath('payment_cards[0].number')).toBe(true);
    expect(isSensitivePath('payment_cards[2].cvv')).toBe(true);
    expect(isSensitivePath('banking.iban')).toBe(true);
    expect(isSensitivePath('person.first_name')).toBe(false);
    expect(isSensitivePath('contact.email')).toBe(false);
  });
});

describe('listAvailableKeys', () => {
  it('flattens canonical data to dotted keys', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B', birth_city: 'Rome' },
      contact: { email: 'a@b.co' },
      custom: { horse: 'Thunder' },
    };
    const keys = listAvailableKeys(data as never);
    expect(keys).toEqual(
      expect.arrayContaining([
        'person.first_name',
        'person.last_name',
        'person.birth_city',
        'contact.email',
        'custom.horse',
      ]),
    );
  });

  it('excludes sensitive paths by default', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B', ssn: '123' },
      contact: { email: 'a@b.co' },
      banking: { iban: 'IT60X0542811101000000123456' },
    };
    const keys = listAvailableKeys(data as never);
    expect(keys).not.toContain('person.ssn');
    expect(keys).not.toContain('banking.iban');
    expect(keys).toContain('person.first_name');
  });

  it('includes sensitive paths when opt-in', () => {
    const data = {
      version: 1,
      person: { first_name: 'A', last_name: 'B', ssn: '123' },
      contact: { email: 'a@b.co' },
    };
    const keys = listAvailableKeys(data as never, { includeSensitive: true });
    expect(keys).toContain('person.ssn');
  });
});
