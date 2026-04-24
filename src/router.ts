import type {
  RouteResult,
  RouterConfig,
  RoutingRules,
  SmartRouterOptions,
  TaskCategory,
  LLMProvider,
} from './types.js';

const DEFAULT_RULES: RoutingRules = {
  minConfidence: 0.7,
  semanticFallback: true,
  debug: false,
  useClassification: true,
};

/**
 * Instruction-based task router.
 *
 * Tiered routing:
 *   1. Keyword match (project → agent) — free
 *   2. Signal-based classification — free
 *   3. LLM semantic fallback — paid, cheap model
 *
 * The router returns as soon as it has a confident match, so the LLM is
 * only consulted for ambiguous tasks.
 */
export class SmartRouter {
  private readonly config: RouterConfig;
  private readonly rules: RoutingRules;
  private readonly llm?: LLMProvider;
  private readonly logger: NonNullable<SmartRouterOptions['logger']>;

  constructor(options: SmartRouterOptions) {
    this.config = options.config;
    this.rules = { ...DEFAULT_RULES, ...(options.config.rules ?? {}) };
    this.llm = options.llm;
    this.logger = options.logger ?? {
      info: (...args) => this.rules.debug && console.log('[smart-router]', ...args),
      warn: (...args) => console.warn('[smart-router]', ...args),
    };
  }

  async route(task: string, context?: string): Promise<RouteResult> {
    const kw = this.keywordRoute(task);
    if (kw && kw.confidence >= this.rules.minConfidence) return kw;

    if (this.rules.useClassification) {
      const cls = this.classificationRoute(task);
      if (cls && cls.confidence >= this.rules.minConfidence) return cls;
    }

    if (this.rules.semanticFallback && this.llm) {
      const sem = await this.semanticRoute(task, context);
      if (sem && sem.confidence >= this.rules.minConfidence) return sem;
    }

    return {
      agent: null,
      subAgent: null,
      project: null,
      confidence: 0,
      reason: 'No confident route',
      method: 'none',
    };
  }

  keywordRoute(task: string): RouteResult | null {
    const lower = task.toLowerCase();
    const projects = this.config.projects ?? {};
    const agents = this.config.agents ?? [];

    let matchedProject: string | null = null;
    let projectScore = 0;

    for (const [id, proj] of Object.entries(projects)) {
      let score = 0;
      for (const alias of proj.aliases) if (lower.includes(alias.toLowerCase())) score += 3;
      for (const kw of proj.keywords) if (lower.includes(kw.toLowerCase())) score += 1;
      if (score > projectScore) {
        projectScore = score;
        matchedProject = id;
      }
    }

    let matchedAgent: string | null = null;
    let agentScore = 0;

    for (const agent of agents) {
      if (agent.project && agent.project !== matchedProject && agent.project !== '_global') continue;
      let score = 0;
      for (const kw of agent.keywords ?? []) if (lower.includes(kw.toLowerCase())) score += 1;
      if (score > agentScore) {
        agentScore = score;
        matchedAgent = agent.name;
      }
    }

    if (projectScore === 0 && agentScore === 0) return null;

    const defaultAgent = matchedProject ? projects[matchedProject].chief : null;
    const finalAgent = matchedAgent ?? defaultAgent;
    if (!finalAgent) return null;

    const confidence = Math.min(0.95, projectScore * 0.2 + agentScore * 0.15);

    this.logger.info(
      `keyword project=${matchedProject} agent=${finalAgent} confidence=${confidence.toFixed(2)}`,
    );

    return {
      agent: finalAgent,
      subAgent: matchedAgent && matchedAgent !== defaultAgent ? matchedAgent : null,
      project: matchedProject,
      confidence,
      reason: `Keyword match: project=${matchedProject} (${projectScore}), agent=${matchedAgent ?? '—'} (${agentScore})`,
      method: 'keyword',
    };
  }

  classificationRoute(task: string): RouteResult | null {
    const categories = this.config.taskCategories;
    if (!categories || categories.length === 0) return null;

    const lower = task.toLowerCase();
    let best: TaskCategory | null = null;
    let bestScore = 0;

    for (const cat of categories) {
      if (!cat.routeTo) continue;
      let score = 0;
      for (const sig of cat.signals) if (lower.includes(sig.toLowerCase())) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = cat;
      }
    }

    if (!best || bestScore === 0) return null;

    const confidence = Math.min(0.9, 0.55 + bestScore * 0.15);
    this.logger.info(`classify category=${best.id} agent=${best.routeTo} confidence=${confidence.toFixed(2)}`);

    return {
      agent: best.routeTo,
      subAgent: best.subAgent,
      project: null,
      confidence,
      reason: `Classification: ${best.id} (${bestScore} signals)`,
      method: 'classification',
    };
  }

  async semanticRoute(task: string, context?: string): Promise<RouteResult | null> {
    if (!this.llm) return null;

    const prompt = this.buildPrompt(task, context);

    let raw: string;
    try {
      raw = await this.llm.complete(prompt);
    } catch (err) {
      this.logger.warn('LLM provider failed:', err);
      return null;
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }

    const agent = typeof parsed.agent === 'string' ? parsed.agent : null;
    const subAgent = typeof parsed.subAgent === 'string' ? parsed.subAgent : null;
    const project = typeof parsed.project === 'string' ? parsed.project : null;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : parseFloat(String(parsed.confidence)) || 0;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';

    if (!agent) return null;

    this.logger.info(`semantic agent=${agent} confidence=${confidence.toFixed(2)} reason="${reason}"`);

    return { agent, subAgent, project, confidence, reason, method: 'semantic' };
  }

  private buildPrompt(task: string, context?: string): string {
    const agents = (this.config.agents ?? [])
      .map((a) => `- ${a.name}: ${a.description}${a.taskTypes?.length ? ` (handles: ${a.taskTypes.join(', ')})` : ''}`)
      .join('\n');

    const projects = Object.entries(this.config.projects ?? {})
      .map(([id, p]) => `- ${id}: ${p.description} (default agent: ${p.chief})`)
      .join('\n');

    const examples = (this.config.examples ?? [])
      .slice(0, 6)
      .map((e) => `- "${e.task}" → ${e.route} (${e.reason})`)
      .join('\n');

    return `You are a routing classifier. Decide which agent should handle the task.

PROJECTS:
${projects || '(none defined — route by agent only)'}

AGENTS:
${agents}

EXAMPLES:
${examples}

TASK: "${task}"
${context ? `CONTEXT: ${context.slice(0, 400)}` : ''}

Respond with ONLY a JSON object:
{
  "agent": "agent-name or null",
  "subAgent": "sub-agent-name or null",
  "project": "project-id or null",
  "confidence": 0.0,
  "reason": "short justification"
}`;
  }
}
