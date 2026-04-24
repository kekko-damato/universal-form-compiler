import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAIClient,
  AIBudgetExceededError,
  AIRateLimitError,
  AIAuthError,
} from '@/background/ai-client';

function mockFetchOnce(response: unknown, status = 200, headers = {}) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    );
}

describe('ai-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to the chat completions endpoint with model, messages, response_format', async () => {
    const spy = mockFetchOnce({
      choices: [
        {
          message: { content: '{"hello":"world"}' },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const client = createAIClient({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    });

    const result = await client.structuredCompletion({
      system: 'You are a test.',
      user: 'hi',
      schema: { type: 'object', properties: { hello: { type: 'string' } } },
      schemaName: 'greeting',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a test.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'greeting',
        schema: { type: 'object', properties: { hello: { type: 'string' } } },
        strict: true,
      },
    });
    expect(result.data).toEqual({ hello: 'world' });
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('throws AIAuthError on 401', async () => {
    mockFetchOnce({ error: { message: 'Invalid API key' } }, 401);
    const client = createAIClient({ apiKey: 'sk-bad', model: 'gpt-4o-mini' });
    await expect(
      client.structuredCompletion({
        system: 's',
        user: 'u',
        schema: { type: 'object' },
        schemaName: 'x',
      }),
    ).rejects.toBeInstanceOf(AIAuthError);
  });

  it('throws AIRateLimitError on 429', async () => {
    mockFetchOnce({ error: 'rate limited' }, 429, { 'Retry-After': '2' });
    const client = createAIClient({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      maxRetries: 0, // do not retry in this test
    });
    await expect(
      client.structuredCompletion({
        system: 's',
        user: 'u',
        schema: { type: 'object' },
        schemaName: 'x',
      }),
    ).rejects.toBeInstanceOf(AIRateLimitError);
  });

  it('retries on 5xx with exponential backoff', async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server' }), { status: 502 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'server' }), { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200 },
        ),
      );

    const client = createAIClient({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      maxRetries: 3,
      retryBaseMs: 1000,
    });

    const promise = client.structuredCompletion({
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      schemaName: 'x',
    });

    // Flush pending promises between retries
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.data).toEqual({ ok: true });
    vi.useRealTimers();
  });

  it('surfaces AIBudgetExceededError when budget exceeded', async () => {
    const client = createAIClient({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      budget: { maxTokens: 10, usedTokens: 11 },
    });
    await expect(
      client.structuredCompletion({
        system: 's',
        user: 'u',
        schema: { type: 'object' },
        schemaName: 'x',
      }),
    ).rejects.toBeInstanceOf(AIBudgetExceededError);
  });
});
