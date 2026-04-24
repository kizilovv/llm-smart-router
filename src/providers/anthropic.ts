import type { LLMProvider } from '../types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Use the cheapest model you're comfortable with — Haiku is ideal for routing. */
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * Anthropic Messages API provider.
 *
 * Use Haiku for routing — it's 12× cheaper than Sonnet and more than smart
 * enough to pick an agent from a list.
 */
export class AnthropicProvider implements LLMProvider {
  private readonly opts: Required<Omit<AnthropicProviderOptions, 'apiKey'>> & { apiKey: string };

  constructor(options: AnthropicProviderOptions) {
    this.opts = {
      apiKey: options.apiKey,
      model: options.model ?? 'claude-haiku-4-5-20251001',
      baseUrl: options.baseUrl ?? 'https://api.anthropic.com/v1',
      maxTokens: options.maxTokens ?? 300,
      timeoutMs: options.timeoutMs ?? 15_000,
    };
  }

  async complete(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);

    try {
      const response = await fetch(`${this.opts.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.opts.model,
          max_tokens: this.opts.maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
