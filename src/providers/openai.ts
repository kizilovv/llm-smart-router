import type { LLMProvider } from '../types.js';

export interface OpenAIProviderOptions {
  apiKey: string;
  /** Model ID. Use the cheapest model that reliably returns JSON — e.g. gpt-4o-mini. */
  model?: string;
  /** Override the base URL for OpenAI-compatible endpoints (DeepSeek, Together, Groq, local ollama). */
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** Request timeout in ms. Default: 15_000. */
  timeoutMs?: number;
}

/**
 * OpenAI-compatible chat completion provider.
 *
 * Works with any endpoint that follows the OpenAI API: OpenAI, DeepSeek,
 * Groq, Together, Anthropic via an OpenAI-compatible proxy, local Ollama.
 */
export class OpenAIProvider implements LLMProvider {
  private readonly opts: Required<Omit<OpenAIProviderOptions, 'apiKey'>> & { apiKey: string };

  constructor(options: OpenAIProviderOptions) {
    this.opts = {
      apiKey: options.apiKey,
      model: options.model ?? 'gpt-4o-mini',
      baseUrl: options.baseUrl ?? 'https://api.openai.com/v1',
      temperature: options.temperature ?? 0,
      maxTokens: options.maxTokens ?? 300,
      timeoutMs: options.timeoutMs ?? 15_000,
    };
  }

  async complete(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);

    try {
      const response = await fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: this.opts.temperature,
          max_tokens: this.opts.maxTokens,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenAI HTTP ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}
