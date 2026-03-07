import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvokeClaudeCli = vi.fn();
const mockInvokeClaudeApi = vi.fn();
vi.mock('../../src/agent/claude.js', () => ({
  invokeClaudeCli: (...args: unknown[]) => mockInvokeClaudeCli(...args),
  invokeClaudeApi: (...args: unknown[]) => mockInvokeClaudeApi(...args),
}));

const { SharedContext, executeAgent, orchestrate, AGENTS } =
  await import('../../src/agent/multi-agent.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SharedContext', () => {
  it('stores and retrieves values', () => {
    const ctx = new SharedContext();
    ctx.set('key', 'value');
    expect(ctx.get('key')).toBe('value');
  });

  it('returns undefined for missing keys', () => {
    const ctx = new SharedContext();
    expect(ctx.get('missing')).toBeUndefined();
  });

  it('generates prompt context XML', () => {
    const ctx = new SharedContext();
    ctx.set('plan', 'Build the thing');
    const prompt = ctx.toPromptContext();
    expect(prompt).toContain('<SHARED_CONTEXT>');
    expect(prompt).toContain('Build the thing');
    expect(prompt).toContain('</SHARED_CONTEXT>');
  });

  it('returns empty string when no data', () => {
    const ctx = new SharedContext();
    expect(ctx.toPromptContext()).toBe('');
  });
});

describe('AGENTS', () => {
  it('defines all four roles', () => {
    expect(AGENTS.research.role).toBe('research');
    expect(AGENTS.planning.role).toBe('planning');
    expect(AGENTS.coding.role).toBe('coding');
    expect(AGENTS.review.role).toBe('review');
  });
});

describe('executeAgent', () => {
  it('executes via CLI mode', async () => {
    mockInvokeClaudeCli.mockResolvedValue({ result: 'research output' });
    const ctx = new SharedContext();
    const result = await executeAgent(
      { agent: AGENTS.research, prompt: 'Find info' },
      ctx,
      { type: 'cli' },
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('research output');
    expect(result.role).toBe('research');
  });

  it('executes via API mode', async () => {
    mockInvokeClaudeApi.mockResolvedValue('api output');
    const ctx = new SharedContext();
    const result = await executeAgent(
      { agent: AGENTS.planning, prompt: 'Plan it' },
      ctx,
      { type: 'api', apiKey: 'sk-test' },
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('api output');
  });

  it('retries on failure', async () => {
    mockInvokeClaudeCli
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ result: 'ok' });
    const ctx = new SharedContext();
    const result = await executeAgent(
      { agent: AGENTS.coding, prompt: 'Code it', maxRetries: 1 },
      ctx,
      { type: 'cli' },
    );
    expect(result.success).toBe(true);
    expect(result.retries).toBe(1);
  });

  it('returns failure after max retries', async () => {
    mockInvokeClaudeCli.mockRejectedValue(new Error('always fails'));
    const ctx = new SharedContext();
    const result = await executeAgent(
      { agent: AGENTS.review, prompt: 'Review', maxRetries: 2 },
      ctx,
      { type: 'cli' },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('always fails');
    expect(result.retries).toBe(2);
  });
});

describe('orchestrate', () => {
  it('runs all four agents in sequence', async () => {
    mockInvokeClaudeCli
      .mockResolvedValueOnce({ result: 'research done' })
      .mockResolvedValueOnce({ result: 'plan done' })
      .mockResolvedValueOnce({ result: 'code done' })
      .mockResolvedValueOnce({ result: 'review done' });

    const results = await orchestrate('build feature X', '/tmp', { type: 'cli' });
    expect(results).toHaveLength(4);
    expect(results[0].role).toBe('research');
    expect(results[1].role).toBe('planning');
    expect(results[2].role).toBe('coding');
    expect(results[3].role).toBe('review');
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('continues even if research fails', async () => {
    mockInvokeClaudeCli
      .mockRejectedValueOnce(new Error('no research'))
      .mockRejectedValueOnce(new Error('no research retry'))
      .mockResolvedValueOnce({ result: 'plan' })
      .mockResolvedValueOnce({ result: 'code' })
      .mockRejectedValueOnce(new Error('code retry 1'))
      .mockRejectedValueOnce(new Error('code retry 2'))
      .mockResolvedValueOnce({ result: 'review' });

    const results = await orchestrate('task', '/tmp', { type: 'cli' });
    expect(results).toHaveLength(4);
    expect(results[0].success).toBe(false);
  });
});
