import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsvToText } from '@/lib/csv-parse';

describe('parseCsvToText', () => {
  it('converts a key/value CSV to plain text key: value lines', () => {
    const raw = readFileSync(
      resolve(__dirname, '../fixtures/sample.csv'),
      'utf8',
    );
    const text = parseCsvToText(raw);
    expect(text).toContain('Nome: Antonio');
    expect(text).toContain('Cognome: Rossi');
    expect(text).toContain('Email: antonio.rossi@example.com');
  });

  it('handles CSV with quoted values containing commas', () => {
    const raw = 'key,value\nAddress,"Via Roma, 1"\n';
    const text = parseCsvToText(raw);
    expect(text).toContain('Address: Via Roma, 1');
  });

  it('handles arbitrary column names (treats first column as key, rest as value)', () => {
    const raw = 'field,data\nname,Antonio\nemail,a@b.co\n';
    const text = parseCsvToText(raw);
    expect(text).toContain('name: Antonio');
    expect(text).toContain('email: a@b.co');
  });
});
