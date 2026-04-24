import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseYamlToText, parseYamlToObject } from '@/lib/yaml-parse';

describe('yaml parser', () => {
  it('parses YAML file to object', () => {
    const raw = readFileSync(
      resolve(__dirname, '../fixtures/sample.yaml'),
      'utf8',
    );
    const obj = parseYamlToObject(raw) as Record<string, unknown>;
    expect(obj).toHaveProperty('person');
    expect((obj.person as Record<string, unknown>).first_name).toBe('Antonio');
  });

  it('converts YAML to flattened key: value text', () => {
    const raw = 'person:\n  first_name: Antonio\n  last_name: Rossi\nemail: a@b.co\n';
    const text = parseYamlToText(raw);
    expect(text).toContain('person.first_name: Antonio');
    expect(text).toContain('person.last_name: Rossi');
    expect(text).toContain('email: a@b.co');
  });

  it('throws on invalid YAML', () => {
    expect(() => parseYamlToObject('key: : bad')).toThrow();
  });
});
