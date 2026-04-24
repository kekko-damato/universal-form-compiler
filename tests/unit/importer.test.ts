import { describe, it, expect, vi } from 'vitest';
import { importRawData, detectFormat, type ImporterDeps } from '@/lib/importer';
import type { StructuredCompletionResult } from '@/background/ai-client';
import type { CanonicalData } from '@/lib/canonical-schema';

function makeDeps(
  aiResult: StructuredCompletionResult<Partial<CanonicalData>>,
): ImporterDeps {
  return {
    ai: {
      jsonCompletion: vi.fn().mockResolvedValue(aiResult),
    },
  };
}

describe('detectFormat', () => {
  it('detects by explicit extension', () => {
    expect(detectFormat('file.docx')).toBe('docx');
    expect(detectFormat('file.CSV')).toBe('csv');
    expect(detectFormat('file.yml')).toBe('yaml');
    expect(detectFormat('file.yaml')).toBe('yaml');
    expect(detectFormat('file.txt')).toBe('text');
  });
});

describe('importRawData', () => {
  it('calls AI with extracted text and returns validated CanonicalData', async () => {
    const deps = makeDeps({
      data: {
        version: 1,
        person: { first_name: 'Antonio', last_name: 'Rossi' },
        contact: { email: 'antonio@example.com' },
      },
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const result = await importRawData(
      { format: 'text', text: 'nome: antonio\ncognome: rossi\nemail: antonio@example.com' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.person.first_name).toBe('Antonio');
      expect(result.data.contact.email).toBe('antonio@example.com');
      expect(result.usage.total_tokens).toBe(30);
    }
    expect(deps.ai.jsonCompletion).toHaveBeenCalledTimes(1);
  });

  it('returns validation errors if AI output fails Zod validation', async () => {
    const deps = makeDeps({
      data: {
        version: 1,
        person: { first_name: '', last_name: 'Rossi' } as never,
        contact: { email: 'not-an-email' } as never,
      },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const result = await importRawData(
      { format: 'text', text: 'junk' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('parses CSV to text before calling AI', async () => {
    const deps = makeDeps({
      data: {
        version: 1,
        person: { first_name: 'A', last_name: 'B' },
        contact: { email: 'a@b.co' },
      },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const csv = 'key,value\nNome,A\nCognome,B\nEmail,a@b.co\n';
    const result = await importRawData(
      { format: 'csv', text: csv },
      deps,
    );
    expect(result.ok).toBe(true);

    const mockFn = deps.ai.jsonCompletion as ReturnType<typeof vi.fn>;
    const firstCall = mockFn.mock.calls[0];
    expect(firstCall).toBeDefined();
    const call = firstCall![0] as { user: string };
    expect(call.user).toContain('Nome: A');
  });

  it('parses YAML to text before calling AI', async () => {
    const deps = makeDeps({
      data: {
        version: 1,
        person: { first_name: 'A', last_name: 'B' },
        contact: { email: 'a@b.co' },
      },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const yaml = 'person:\n  first_name: A\n  last_name: B\nemail: a@b.co\n';
    const result = await importRawData(
      { format: 'yaml', text: yaml },
      deps,
    );
    expect(result.ok).toBe(true);
  });
});
