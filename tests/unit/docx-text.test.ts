import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractDocxText } from '@/lib/docx-text';

const fixturePath = resolve(__dirname, '../fixtures/sample.docx');

describe('extractDocxText', () => {
  it.skipIf(!existsSync(fixturePath))(
    'extracts plaintext from a DOCX buffer',
    async () => {
      const buf = readFileSync(fixturePath);
      const arrayBuffer = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
      const text = await extractDocxText(arrayBuffer);
      expect(text).toContain('Nome: Antonio');
      expect(text).toContain('Cognome: Rossi');
      expect(text).toContain('Email: antonio.rossi@example.com');
      expect(text).toContain('Partita IVA: 12345678901');
    },
  );

  it('throws on invalid DOCX buffer', async () => {
    const bogus = new TextEncoder().encode('not a docx').buffer;
    await expect(extractDocxText(bogus)).rejects.toThrow();
  });
});
