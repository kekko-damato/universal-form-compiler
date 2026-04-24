export interface AIBudget {
  maxTokens: number;
  usedTokens: number;
}

export interface AIClientOptions {
  apiKey: string;
  model: string;
  maxRetries?: number;
  retryBaseMs?: number;
  budget?: AIBudget;
  endpoint?: string;
}

export interface StructuredCompletionRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  temperature?: number;
}

export interface StructuredCompletionResult<T = unknown> {
  data: T;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class AIAuthError extends Error {
  constructor(message = 'Invalid API key') {
    super(message);
    this.name = 'AIAuthError';
  }
}

export class AIRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super('Rate limited');
    this.name = 'AIRateLimitError';
  }
}

export class AIBudgetExceededError extends Error {
  constructor() {
    super('AI budget exceeded');
    this.name = 'AIBudgetExceededError';
  }
}

export class AIServerError extends Error {
  constructor(public status: number, message: string) {
    super(`OpenAI error ${status}: ${message}`);
    this.name = 'AIServerError';
  }
}

export interface AIClient {
  structuredCompletion<T = unknown>(
    req: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult<T>>;
  /**
   * Like `structuredCompletion` but uses `response_format: { type: 'json_object' }`
   * instead of the strict `json_schema` mode. The schema is still sent to the
   * model, but embedded inside the user prompt as a reference. Callers should
   * rely on their own schema validation (Zod) for the returned data.
   *
   * Use this for flexible schemas that include `format`, `pattern`, `minimum`,
   * `maximum`, `additionalProperties: true`, or partial `required` lists — all of
   * which OpenAI's strict mode rejects with a 400.
   */
  jsonCompletion<T = unknown>(
    req: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult<T>>;
}

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export function createAIClient(opts: AIClientOptions): AIClient {
  const maxRetries = opts.maxRetries ?? 3;
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;

  async function callOnce(
    body: Record<string, unknown>,
  ): Promise<StructuredCompletionResult> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new AIAuthError();
    }
    if (res.status === 429) {
      const ra = res.headers.get('Retry-After');
      const retryAfterMs = ra ? Number(ra) * 1000 : 10_000;
      throw new AIRateLimitError(retryAfterMs);
    }
    if (res.status >= 500) {
      const text = await res.text().catch(() => '');
      throw new AIServerError(res.status, text);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIServerError(res.status, text);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new AIServerError(200, 'Empty response');

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      throw new AIServerError(200, 'Response was not valid JSON');
    }

    return {
      data,
      usage: json.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  async function runWithRetries<T>(
    body: Record<string, unknown>,
  ): Promise<StructuredCompletionResult<T>> {
    if (opts.budget && opts.budget.usedTokens >= opts.budget.maxTokens) {
      throw new AIBudgetExceededError();
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return (await callOnce(body)) as StructuredCompletionResult<T>;
      } catch (err) {
        lastError = err;
        if (err instanceof AIAuthError) throw err;
        if (err instanceof AIBudgetExceededError) throw err;
        if (err instanceof AIRateLimitError) {
          if (attempt >= maxRetries) throw err;
          await new Promise((r) => setTimeout(r, err.retryAfterMs));
          continue;
        }
        if (err instanceof AIServerError && err.status >= 500) {
          if (attempt >= maxRetries) throw err;
          const backoff = retryBaseMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  return {
    async structuredCompletion<T = unknown>(
      req: StructuredCompletionRequest,
    ): Promise<StructuredCompletionResult<T>> {
      const body = {
        model: opts.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: req.schemaName,
            schema: req.schema,
            strict: true,
          },
        },
        temperature: req.temperature ?? 0,
      };
      return runWithRetries<T>(body);
    },

    async jsonCompletion<T = unknown>(
      req: StructuredCompletionRequest,
    ): Promise<StructuredCompletionResult<T>> {
      const schemaBlock = JSON.stringify(req.schema, null, 2);
      const userWithSchema = `Respond with JSON matching this schema (name: ${req.schemaName}):\n${schemaBlock}\n\nInput:\n${req.user}`;
      const body = {
        model: opts.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: userWithSchema },
        ],
        response_format: { type: 'json_object' },
        temperature: req.temperature ?? 0,
      };
      return runWithRetries<T>(body);
    },
  };
}
