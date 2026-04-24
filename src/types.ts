export interface TaskCategory {
  id: string;
  description: string;
  /** Name of the agent/chief to route matched tasks to. `null` skips routing (e.g. "conversational"). */
  routeTo: string | null;
  /** Optional sub-agent name (for hierarchical routing). */
  subAgent: string | null;
  /** Substring signals that match this category (case-insensitive). */
  signals: string[];
}

export interface RoutingExample {
  task: string;
  route: string;
  reason: string;
}

export interface AgentConfig {
  name: string;
  description: string;
  /**
   * Category/tag this agent belongs to. Used for scoping: an agent is only
   * considered for tasks whose detected project matches `project`, or when
   * `project` is `"_global"`.
   */
  project?: string;
  /** Kinds of tasks this agent handles, e.g. ["seo", "blog"]. */
  taskTypes?: string[];
  /** Substring keywords that hint at this agent. */
  keywords?: string[];
}

export interface ProjectConfig {
  /** Default agent/chief for this project. */
  chief: string;
  aliases: string[];
  description: string;
  /** Domains/keywords that help the router detect this project. */
  keywords: string[];
}

export interface RoutingRules {
  /** Minimum confidence required to return a confident route. Default 0.7. */
  minConfidence: number;
  /** If keyword/classification match fails, fall back to LLM-based semantic routing. */
  semanticFallback: boolean;
  /** Emit console logs of routing decisions. */
  debug: boolean;
  /** Use signal-based classification (faster than LLM, smarter than keywords). */
  useClassification: boolean;
}

export interface RouterConfig {
  projects?: Record<string, ProjectConfig>;
  agents?: AgentConfig[];
  taskCategories?: TaskCategory[];
  examples?: RoutingExample[];
  rules?: Partial<RoutingRules>;
}

export type RouteMethod = 'keyword' | 'classification' | 'semantic' | 'none';

export interface RouteResult {
  /** Matched agent name, or `null` when no confident route was found. */
  agent: string | null;
  /** Optional sub-agent (e.g. for hierarchical orchestrations). */
  subAgent: string | null;
  /** Matched project (when the router uses project-scoped config). */
  project: string | null;
  /** 0.0 – 1.0 */
  confidence: number;
  reason: string;
  method: RouteMethod;
}

export interface LLMProvider {
  /**
   * Return raw model output for a routing prompt. The router parses the
   * first JSON object from the response — your provider does NOT need to
   * enforce structured output, but should ideally use a cheap/fast model.
   */
  complete(prompt: string): Promise<string>;
}

export interface SmartRouterOptions {
  config: RouterConfig;
  /** Optional LLM provider for semantic fallback. If omitted, semantic routing is disabled. */
  llm?: LLMProvider;
  /** Custom logger (defaults to `console` when `rules.debug` is true). */
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}
