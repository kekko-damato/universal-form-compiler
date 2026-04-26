import { describe, it, expect } from 'vitest';
import {
  looksLikeExampleEmail,
  matchesFieldPlaceholder,
} from '@/lib/value-guards';
import type { FieldDescriptor } from '@/types/field';

function makeField(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    id: 'ufc-1',
    selector: '#x',
    widget: { kind: 'native-input', type: 'email' },
    labels: [{ text: 'Email', source: 'label' }],
    attributes: {},
    context: {},
    ...overrides,
  };
}

describe('looksLikeExampleEmail', () => {
  it('flags RFC-reserved example domains', () => {
    expect(looksLikeExampleEmail('foo@example.com')).toBe(true);
    expect(looksLikeExampleEmail('foo@example.org')).toBe(true);
    expect(looksLikeExampleEmail('foo@example.net')).toBe(true);
    expect(looksLikeExampleEmail('foo@example.it')).toBe(true);
  });

  it('flags common Italian/English placeholder domains', () => {
    expect(looksLikeExampleEmail('mario@dominio.it')).toBe(true);
    expect(looksLikeExampleEmail('user@esempio.it')).toBe(true);
    expect(looksLikeExampleEmail('foo@yourcompany.com')).toBe(true);
    expect(looksLikeExampleEmail('foo@yourdomain.com')).toBe(true);
    expect(looksLikeExampleEmail('foo@company.it')).toBe(true);
    expect(looksLikeExampleEmail('foo@test.com')).toBe(true);
    expect(looksLikeExampleEmail('foo@prova.it')).toBe(true);
  });

  it('flags subdomains of placeholder domains', () => {
    expect(looksLikeExampleEmail('foo@mail.example.com')).toBe(true);
    expect(looksLikeExampleEmail('foo@dev.example.it')).toBe(true);
  });

  it('flags common placeholder local-parts on any domain', () => {
    expect(looksLikeExampleEmail('mario.rossi@gmail.com')).toBe(true);
    expect(looksLikeExampleEmail('john.doe@gmail.com')).toBe(true);
    expect(looksLikeExampleEmail('noreply@gmail.com')).toBe(true);
    expect(looksLikeExampleEmail('user@gmail.com')).toBe(true);
  });

  it('does NOT flag genuine emails', () => {
    expect(looksLikeExampleEmail('vdamato@rdditalia.com')).toBe(false);
    expect(looksLikeExampleEmail('antonio@gmail.com')).toBe(false);
    expect(looksLikeExampleEmail('raffaelefrancesco.damato@gmail.com')).toBe(false);
    expect(looksLikeExampleEmail('contact@anthropic.com')).toBe(false);
  });

  it('returns false for non-emails', () => {
    expect(looksLikeExampleEmail('not-an-email')).toBe(false);
    expect(looksLikeExampleEmail('')).toBe(false);
    expect(looksLikeExampleEmail('@')).toBe(false);
  });
});

describe('matchesFieldPlaceholder', () => {
  it('flags exact placeholder match', () => {
    const field = makeField({
      attributes: { placeholder: 'esempio@email.it' },
    });
    expect(matchesFieldPlaceholder('esempio@email.it', field)).toBe(true);
  });

  it('flags placeholder match case-insensitively', () => {
    const field = makeField({
      attributes: { placeholder: 'Esempio@Email.IT' },
    });
    expect(matchesFieldPlaceholder('esempio@email.it', field)).toBe(true);
  });

  it('flags value contained inside a long placeholder hint', () => {
    const field = makeField({
      attributes: { placeholder: 'Esempio: mario.rossi@dominio.it' },
    });
    expect(matchesFieldPlaceholder('mario.rossi@dominio.it', field)).toBe(true);
  });

  it('also checks title and aria-label attributes', () => {
    expect(
      matchesFieldPlaceholder(
        'foo@bar.com',
        makeField({ attributes: { title: 'foo@bar.com' } }),
      ),
    ).toBe(true);
    expect(
      matchesFieldPlaceholder(
        'foo@bar.com',
        makeField({ attributes: { ariaLabel: 'foo@bar.com' } }),
      ),
    ).toBe(true);
  });

  it('does not false-positive on short values inside long placeholders', () => {
    // "M" should not be flagged just because the placeholder mentions M
    const field = makeField({
      attributes: { placeholder: 'Inserisci genere: M o F' },
    });
    expect(matchesFieldPlaceholder('M', field)).toBe(false);
  });

  it('returns false when no placeholder present', () => {
    const field = makeField({ attributes: {} });
    expect(matchesFieldPlaceholder('foo@bar.com', field)).toBe(false);
  });

  it('returns false on empty value', () => {
    const field = makeField({
      attributes: { placeholder: 'esempio@email.it' },
    });
    expect(matchesFieldPlaceholder('', field)).toBe(false);
    expect(matchesFieldPlaceholder('   ', field)).toBe(false);
  });
});
