import { readFile } from 'fs/promises';
import { SmartRouter, AnthropicProvider, type RouterConfig } from '../src/index.js';

async function main() {
  const raw = await readFile(new URL('./routing.json', import.meta.url), 'utf-8');
  const config = JSON.parse(raw) as RouterConfig;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const router = new SmartRouter({
    config,
    llm: apiKey ? new AnthropicProvider({ apiKey, model: 'claude-haiku-4-5-20251001' }) : undefined,
  });

  const tasks = [
    'audit meta tags on the pricing page',
    'prod is throwing 500s on checkout',
    'hey how is it going',
    'figure out whether our retention curve is hiding a cohort problem',
  ];

  for (const task of tasks) {
    const result = await router.route(task);
    console.log(`task: ${task}`);
    console.log(`  → ${result.agent ?? '(no route)'} [${result.method}, confidence=${result.confidence.toFixed(2)}]`);
    console.log(`  reason: ${result.reason}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
