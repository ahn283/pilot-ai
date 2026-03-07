/**
 * Multi-agent orchestration for role-based sub-agent delegation.
 * Each agent has a role and is invoked as an independent Claude session.
 */
import { invokeClaudeCli, invokeClaudeApi } from './claude.js';

export type AgentRole = 'research' | 'planning' | 'coding' | 'review';

export interface SubAgent {
  role: AgentRole;
  systemPrompt: string;
}

export interface AgentTask {
  agent: SubAgent;
  prompt: string;
  cwd?: string;
  maxRetries?: number;
}

export interface AgentResult {
  role: AgentRole;
  success: boolean;
  output: string;
  error?: string;
  retries: number;
}

// Predefined agent roles with system prompts
export const AGENTS: Record<AgentRole, SubAgent> = {
  research: {
    role: 'research',
    systemPrompt:
      'You are a research agent. Gather information, read documentation, search codebases, and summarize findings. Do not modify any files.',
  },
  planning: {
    role: 'planning',
    systemPrompt:
      'You are a planning agent. Analyze requirements, design implementation strategies, and produce step-by-step plans. Do not write code.',
  },
  coding: {
    role: 'coding',
    systemPrompt:
      'You are a coding agent. Implement features, fix bugs, and write tests based on the provided plan. Follow existing code conventions.',
  },
  review: {
    role: 'review',
    systemPrompt:
      'You are a code review agent. Review code changes for bugs, security issues, performance problems, and style violations. Provide actionable feedback.',
  },
};

/**
 * Shared context that agents can read from and write to.
 */
export class SharedContext {
  private data = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  toPromptContext(): string {
    if (this.data.size === 0) return '';
    const lines = ['<SHARED_CONTEXT>'];
    for (const [key, value] of this.data) {
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      lines.push(`<context key="${key}">${val}</context>`);
    }
    lines.push('</SHARED_CONTEXT>');
    return lines.join('\n');
  }
}

/**
 * Executes a sub-agent task with retry logic.
 */
export async function executeAgent(
  task: AgentTask,
  context: SharedContext,
  mode: { type: 'cli' } | { type: 'api'; apiKey: string },
): Promise<AgentResult> {
  const maxRetries = task.maxRetries ?? 1;
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const contextStr = context.toPromptContext();
      const fullPrompt = [
        task.agent.systemPrompt,
        contextStr,
        `<TASK>\n${task.prompt}\n</TASK>`,
      ]
        .filter(Boolean)
        .join('\n\n');

      let output: string;
      if (mode.type === 'cli') {
        const result = await invokeClaudeCli({ prompt: fullPrompt, cwd: task.cwd });
        output = result.result;
      } else {
        output = await invokeClaudeApi({ prompt: fullPrompt, apiKey: mode.apiKey });
      }

      return {
        role: task.agent.role,
        success: true,
        output,
        retries: attempt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    role: task.agent.role,
    success: false,
    output: '',
    error: lastError,
    retries: maxRetries,
  };
}

/**
 * Orchestrates a multi-agent workflow: research → plan → code → review.
 */
export async function orchestrate(
  task: string,
  cwd: string,
  mode: { type: 'cli' } | { type: 'api'; apiKey: string },
): Promise<AgentResult[]> {
  const context = new SharedContext();
  const results: AgentResult[] = [];

  // 1. Research
  const researchResult = await executeAgent(
    { agent: AGENTS.research, prompt: `Research for: ${task}`, cwd },
    context,
    mode,
  );
  results.push(researchResult);
  if (researchResult.success) context.set('research', researchResult.output);

  // 2. Planning
  const planResult = await executeAgent(
    { agent: AGENTS.planning, prompt: `Create implementation plan for: ${task}`, cwd },
    context,
    mode,
  );
  results.push(planResult);
  if (planResult.success) context.set('plan', planResult.output);

  // 3. Coding
  const codeResult = await executeAgent(
    { agent: AGENTS.coding, prompt: `Implement: ${task}`, cwd, maxRetries: 2 },
    context,
    mode,
  );
  results.push(codeResult);
  if (codeResult.success) context.set('implementation', codeResult.output);

  // 4. Review
  const reviewResult = await executeAgent(
    { agent: AGENTS.review, prompt: `Review the implementation of: ${task}`, cwd },
    context,
    mode,
  );
  results.push(reviewResult);

  return results;
}
