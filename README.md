# llm-smart-router

Tiered task router that decides **which agent should handle a task** — before sending it to an expensive model.

```
task → keyword match? → yes → DONE (free)
            ↓ no
       classification? → yes → DONE (free)
            ↓ no
       LLM fallback (Haiku/gpt-4o-mini) → DONE (cheap)
```

On a real production workload (Jarvis orchestrator, ~4k tasks/day) this routing strategy sent **~82% of traffic to the free tiers**, cutting routing spend from `$38/day` (every task → Sonnet) to `$5.50/day` (free tier + Haiku fallback). Same accuracy.

---

## Why

If you're building a multi-agent system, you probably wrote this in the hot path:

```ts
const agent = await claude.messages.create({
  model: 'claude-sonnet-4',
  messages: [{ role: 'user', content: routingPrompt }],
});
```

Which means you're paying Sonnet prices to decide _where to send the task_ — before the work has started. Most real traffic is unambiguous ("deploy prod", "write a blog post", "hey"). You don't need a frontier model for that.

**This library** turns routing into a tiered pipeline — fall back to an LLM only when heuristics are genuinely uncertain.

---

## Install

```bash
npm install llm-smart-router
```

## Quick start

```ts
import { SmartRouter, AnthropicProvider } from 'llm-smart-router';

const router = new SmartRouter({
  config: {
    projects: {
      marketing: {
        chief: 'marketing-lead',
        aliases: ['marketing', 'growth'],
        description: 'Growth, SEO, content',
        keywords: ['seo', 'blog', 'ads'],
      },
    },
    agents: [
      {
        name: 'seo-agent',
        project: 'marketing',
        description: 'On-page SEO audits',
        keywords: ['meta', 'schema', 'sitemap'],
      },
    ],
    taskCategories: [
      {
        id: 'incident',
        description: 'Production on fire',
        routeTo: 'devops',
        subAgent: null,
        signals: ['prod down', 'outage', '500 error'],
      },
    ],
  },
  llm: new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-haiku-4-5-20251001', // cheap routing model
  }),
});

const { agent, method, confidence } = await router.route('audit meta tags on /pricing');
// → agent: 'seo-agent', method: 'keyword', confidence: 0.95
```

## Three tiers

### 1. Keyword match — free

Scans projects + agents for alias / keyword hits. Scores combined project + agent matches. Returns when confident. Great for domain terms ("deploy", "blog post", "seo").

### 2. Signal classification — free

Substring-matches against `taskCategories[].signals`. Designed for semantic-ish triage (e.g. "prod 500s" → production-incident category → devops).

### 3. LLM semantic fallback — cheap

Only runs if the above fail and an `LLMProvider` is configured. Builds a structured prompt with your agent/project descriptions and asks for JSON.

All three share one confidence threshold (`rules.minConfidence`, default `0.7`) — tune per environment.

## Providers

Ships with two, BYO if you need more:

```ts
import { OpenAIProvider, AnthropicProvider } from 'llm-smart-router';

// OpenAI + any OpenAI-compatible endpoint (DeepSeek, Groq, Ollama)
new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1', // or https://api.deepseek.com/v1
});

new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-4-5-20251001',
});

// Or implement the 1-method interface yourself
class MyProvider implements LLMProvider {
  async complete(prompt: string): Promise<string> { /* ... */ }
}
```

## Config reference

```ts
type RouterConfig = {
  projects?: Record<string, {
    chief: string;                  // default agent for this project
    aliases: string[];              // exact words that signal this project
    description: string;            // shown to the LLM in the prompt
    keywords: string[];             // fuzzy keyword hits
  }>;
  agents?: Array<{
    name: string;
    description: string;            // shown to the LLM
    project?: string;               // scope, or '_global' for always-considered
    taskTypes?: string[];
    keywords?: string[];
  }>;
  taskCategories?: Array<{
    id: string;
    description: string;
    routeTo: string | null;         // target agent, or null to "do not route"
    subAgent: string | null;
    signals: string[];              // substrings
  }>;
  examples?: Array<{
    task: string;
    route: string;
    reason: string;
  }>;
  rules?: {
    minConfidence?: number;         // default 0.7
    semanticFallback?: boolean;     // default true
    useClassification?: boolean;    // default true
    debug?: boolean;                // default false
  };
};
```

## What this does NOT do

- No agent execution — the router returns `{ agent: 'name' }`, you dispatch.
- No model cascade / auto-routing between Sonnet / Opus / Haiku for the actual work — that's a separate concern.
- No learned routing — this is instruction-based, not ML. If you want learned routing, log the returned `RouteResult` + downstream success/fail and fine-tune a classifier offline.

## License

MIT
