import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanForm } from '@/content/form-scanner';

function loadFixture(name: string): void {
  const html = readFileSync(
    resolve(__dirname, `../fixtures/forms/${name}`),
    'utf8',
  );
  document.documentElement.innerHTML = html
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<html[^>]*>/i, '')
    .replace(/<\/html>/i, '');
}

describe('scanForm — basic.html', () => {
  beforeEach(() => {
    loadFixture('basic.html');
  });

  it('finds all form fields', () => {
    const fields = scanForm(document);
    // first_name + email + password + country + 2 radios + checkbox + bio + cv = 9
    // Radios are grouped into one descriptor with options, so 8
    expect(fields.length).toBe(8);
  });

  it('extracts explicit label via for=id', () => {
    const fields = scanForm(document);
    const firstName = fields.find((f) => f.attributes.name === 'first_name');
    expect(firstName).toBeDefined();
    expect(firstName!.labels).toContainEqual({
      text: 'First name',
      source: 'label',
    });
  });

  it('extracts wrapping-label text when no for attribute', () => {
    const fields = scanForm(document);
    const email = fields.find((f) => f.attributes.name === 'email');
    expect(email).toBeDefined();
    const texts = email!.labels.map((l) => l.text);
    expect(texts.some((t) => t.includes('Email'))).toBe(true);
  });

  it('extracts placeholder as a label source', () => {
    const fields = scanForm(document);
    const email = fields.find((f) => f.attributes.name === 'email');
    expect(email!.labels).toContainEqual({
      text: 'you@example.com',
      source: 'placeholder',
    });
  });

  it('extracts select options', () => {
    const fields = scanForm(document);
    const country = fields.find((f) => f.attributes.name === 'country');
    expect(country?.options).toEqual(
      expect.arrayContaining(['Italy', 'United States']),
    );
  });

  it('groups radio inputs by name into a single descriptor', () => {
    const fields = scanForm(document);
    const news = fields.filter((f) => f.attributes.name === 'newsletter');
    expect(news.length).toBe(1);
    expect(news[0]!.widget).toEqual({ kind: 'native-input', type: 'radio' });
    expect(news[0]!.options).toEqual(expect.arrayContaining(['yes', 'no']));
  });

  it('captures required validation', () => {
    const fields = scanForm(document);
    const firstName = fields.find((f) => f.attributes.name === 'first_name');
    expect(firstName!.validation?.required).toBe(true);
  });

  it('assigns stable unique ids', () => {
    const fields = scanForm(document);
    const ids = new Set(fields.map((f) => f.id));
    expect(ids.size).toBe(fields.length);
  });

  it('extracts fieldset legend for nearby text', () => {
    const fields = scanForm(document);
    const newsletter = fields.find((f) => f.attributes.name === 'newsletter');
    const labelTexts = newsletter!.labels.map((l) => l.text);
    expect(labelTexts.some((t) => t.toLowerCase().includes('newsletter'))).toBe(true);
  });

  it('captures form title from heading', () => {
    const fields = scanForm(document);
    expect(fields[0]!.context.formTitle).toContain('Registration');
  });

  it('selector can locate the element back', () => {
    const fields = scanForm(document);
    for (const f of fields) {
      const found = document.querySelector(f.selector);
      expect(found).not.toBeNull();
    }
  });

  it('skips hidden inputs', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<input type="hidden" name="csrf" value="abc123" />',
    );
    const fields = scanForm(document);
    const csrf = fields.find((f) => f.attributes.name === 'csrf');
    expect(csrf).toBeUndefined();
  });

  it('skips submit buttons', () => {
    const fields = scanForm(document);
    expect(fields.find((f) => f.attributes.type === 'submit')).toBeUndefined();
  });
});

describe('scanForm — italian.html', () => {
  beforeEach(() => {
    loadFixture('italian.html');
  });

  it('finds Italian-labeled fields', () => {
    const fields = scanForm(document);
    expect(fields.length).toBe(8);
    const piva = fields.find((f) => f.attributes.name === 'vat');
    expect(piva!.labels).toContainEqual({
      text: 'Partita IVA',
      source: 'label',
    });
  });

  it('captures textarea as widget', () => {
    const fields = scanForm(document);
    const address = fields.find((f) => f.attributes.name === 'address');
    expect(address!.widget).toEqual({ kind: 'native-textarea' });
  });

  it('captures pattern validation on P.IVA', () => {
    const fields = scanForm(document);
    const piva = fields.find((f) => f.attributes.name === 'vat');
    expect(piva!.validation?.pattern).toBe('\\d{11}');
  });
});
