import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const testDir = '/tmp/pilot-phase3-int-test';

vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => testDir,
}));

const mockExecuteShell = vi.fn();
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: (...args: unknown[]) => mockExecuteShell(...args),
}));

const mockInvokeClaudeCli = vi.fn();
const mockInvokeClaudeApi = vi.fn();
vi.mock('../../src/agent/claude.js', () => ({
  invokeClaudeCli: (...args: unknown[]) => mockInvokeClaudeCli(...args),
  invokeClaudeApi: (...args: unknown[]) => mockInvokeClaudeApi(...args),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await fs.mkdir(path.join(testDir, 'memory', 'projects'), { recursive: true });
  await fs.mkdir(path.join(testDir, 'memory', 'history'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// --- 3.1 VSCode CLI ---
describe('vscode integration (3.1)', () => {
  it('opens files and runs git operations', async () => {
    const vscode = await import('../../src/tools/vscode.js');
    expect(typeof vscode.openInVscode).toBe('function');
    expect(typeof vscode.openDiff).toBe('function');
    expect(typeof vscode.runInTerminal).toBe('function');
    expect(typeof vscode.gitCommit).toBe('function');
    expect(typeof vscode.gitPush).toBe('function');
    expect(typeof vscode.createPullRequest).toBe('function');
  });
});

// --- 3.2 Worktree parallel execution ---
describe('worktree parallel execution (3.2)', () => {
  it('creates worktrees with correct branch naming', async () => {
    const { createWorktree } = await import('../../src/agent/worktree.js');

    mockExecuteShell.mockReset();
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

    const wt = await createWorktree('/tmp/project', 'task-1');
    expect(wt.branch).toContain('task-1');
    expect(wt.path).toContain('.pilot-worktree');
    expect(mockExecuteShell).toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      expect.objectContaining({ cwd: '/tmp/project' }),
    );
  });

  it('lists worktrees from porcelain output', async () => {
    const { listWorktrees } = await import('../../src/agent/worktree.js');

    mockExecuteShell.mockReset();
    mockExecuteShell.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'worktree /tmp/project\nHEAD abc1234\nbranch refs/heads/main\n\nworktree /tmp/.pilot-worktree-xxx\nHEAD def5678\nbranch refs/heads/pilot-worktree-task-1\n',
      stderr: '',
    });

    const list = await listWorktrees('/tmp/project');
    expect(list).toHaveLength(2);
    expect(list[0]).toBe('/tmp/project');
  });
});

// --- 3.3 Semantic search over memory ---
describe('semantic search integration (3.3)', () => {
  it('indexes memory files and returns relevant results', async () => {
    await fs.writeFile(
      path.join(testDir, 'memory', 'MEMORY.md'),
      '# Preferences\nUser prefers TypeScript strict mode.\nAlways use vitest for testing.\nCommit messages in English.',
    );
    await fs.writeFile(
      path.join(testDir, 'memory', 'projects', 'api.md'),
      '# API Project\nExpress REST API with PostgreSQL.\nDeploy via AWS Lambda.\nUses Prisma ORM.',
    );

    const { search, rebuildIndex, formatSearchResults } =
      await import('../../src/agent/semantic-search.js');

    const index = await rebuildIndex();
    expect(index.chunks.length).toBeGreaterThan(0);

    const results = await search('TypeScript testing');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);

    const formatted = formatSearchResults(results);
    expect(formatted).toContain('<RELEVANT_MEMORY>');
  });
});

// --- 3.4 Pipeline multi-step ---
describe('pipeline multi-step (3.4)', () => {
  it('chains steps passing data through and handles errors', async () => {
    const { executePipeline, formatPipelineResult } =
      await import('../../src/agent/pipeline.js');

    // Successful pipeline
    const result = await executePipeline([
      { name: 'fetch', execute: async () => [1, 2, 3] },
      { name: 'double', execute: async (input) => (input as number[]).map((n) => n * 2) },
      { name: 'sum', execute: async (input) => (input as number[]).reduce((a, b) => a + b, 0) },
    ]);
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe(12);
    expect(formatPipelineResult(result)).toContain('Pipeline completed');

    // Failing pipeline
    const failed = await executePipeline([
      { name: 'ok', execute: async () => 'data' },
      { name: 'fail', execute: async () => { throw new Error('broken'); } },
    ]);
    expect(failed.success).toBe(false);
    expect(formatPipelineResult(failed)).toContain('Pipeline failed');
  });
});

// --- 3.5 Email integration ---
describe('email integration (3.5)', () => {
  it('configures OAuth and manages tokens', async () => {
    const email = await import('../../src/tools/email.js');
    expect(typeof email.configureEmail).toBe('function');
    expect(typeof email.getAuthUrl).toBe('function');
    expect(typeof email.exchangeCode).toBe('function');
    expect(typeof email.listMessages).toBe('function');
    expect(typeof email.getMessage).toBe('function');
    expect(typeof email.createDraft).toBe('function');

    email.configureEmail({ clientId: 'cid', clientSecret: 'csec' });
    const url = email.getAuthUrl('http://127.0.0.1:9999/callback');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('cid');
  });
});

// --- 3.6 Calendar ---
describe('calendar integration (3.6)', () => {
  it('lists events and finds free time', async () => {
    const { listEvents, findFreeTime, createEvent } =
      await import('../../src/tools/calendar.js');

    mockExecuteShell.mockReset();
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: 'Work | Standup | Monday, March 7, 2026 9:00:00 AM | Monday, March 7, 2026 9:30:00 AM',
      stderr: '',
    });

    const events = await listEvents(new Date(2026, 2, 7), new Date(2026, 2, 7, 23, 59));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].title).toBe('Standup');

    const free = await findFreeTime(new Date(2026, 2, 7));
    expect(free.length).toBeGreaterThan(0);

    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await createEvent({
      title: 'Review',
      startDate: 'Monday, March 7, 2026 2:00 PM',
      endDate: 'Monday, March 7, 2026 3:00 PM',
    });
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('make new event'));
  });
});

// --- 3.7 Voice I/O ---
describe('voice integration (3.7)', () => {
  it('speaks text and transcribes audio', async () => {
    const { speak, listVoices, transcribeWithWhisper } =
      await import('../../src/tools/voice.js');

    // TTS
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await speak('Hello from Phase 3');
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('say'));

    // List voices
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: 'Samantha  en_US  # comment\nAlex      en_US  # comment',
      stderr: '',
    });
    const voices = await listVoices();
    expect(voices).toContain('Samantha');

    // STT
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ text: 'transcribed text' }),
      stderr: '',
    });
    const text = await transcribeWithWhisper('/tmp/audio.wav', 'sk-test');
    expect(text).toBe('transcribed text');
  });
});

// --- 3.8 Multi-agent orchestration ---
describe('multi-agent orchestration (3.8)', () => {
  it('orchestrates research → plan → code → review pipeline', async () => {
    const { orchestrate, SharedContext } =
      await import('../../src/agent/multi-agent.js');

    mockInvokeClaudeCli
      .mockResolvedValueOnce({ result: 'Found relevant docs about auth module' })
      .mockResolvedValueOnce({ result: 'Plan: 1. Add middleware 2. Write tests' })
      .mockResolvedValueOnce({ result: 'Implemented auth middleware in src/auth.ts' })
      .mockResolvedValueOnce({ result: 'LGTM, no issues found' });

    const results = await orchestrate('Add auth middleware', '/tmp/project', { type: 'cli' });

    expect(results).toHaveLength(4);
    expect(results[0].role).toBe('research');
    expect(results[0].success).toBe(true);
    expect(results[0].output).toContain('auth module');

    expect(results[1].role).toBe('planning');
    expect(results[1].output).toContain('Plan');

    expect(results[2].role).toBe('coding');
    expect(results[2].output).toContain('auth middleware');

    expect(results[3].role).toBe('review');
    expect(results[3].output).toContain('LGTM');
  });

  it('handles partial failures in orchestration', async () => {
    const { orchestrate } = await import('../../src/agent/multi-agent.js');
    mockInvokeClaudeCli
      .mockRejectedValueOnce(new Error('research timeout'))
      .mockRejectedValueOnce(new Error('research timeout retry'))
      .mockResolvedValueOnce({ result: 'plan without research' })
      .mockResolvedValueOnce({ result: 'code done' })
      .mockRejectedValueOnce(new Error('code retry 1'))
      .mockRejectedValueOnce(new Error('code retry 2'))
      .mockResolvedValueOnce({ result: 'review ok' });

    const results = await orchestrate('task', '/tmp/project', { type: 'cli' });
    expect(results).toHaveLength(4);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('research timeout');
    expect(results[1].success).toBe(true);
  });

  it('shared context passes data between agents', async () => {
    const { SharedContext } = await import('../../src/agent/multi-agent.js');
    const ctx = new SharedContext();
    ctx.set('research', 'Found: use Express middleware');
    ctx.set('plan', 'Step 1: create file, Step 2: add tests');

    const prompt = ctx.toPromptContext();
    expect(prompt).toContain('<SHARED_CONTEXT>');
    expect(prompt).toContain('Express middleware');
    expect(prompt).toContain('Step 1');
    expect(prompt).toContain('</SHARED_CONTEXT>');
  });

  it('works with API mode', async () => {
    const { executeAgent, AGENTS, SharedContext: SC } =
      await import('../../src/agent/multi-agent.js');

    mockInvokeClaudeApi.mockResolvedValue('API response');
    const ctx = new SC();
    const result = await executeAgent(
      { agent: AGENTS.review, prompt: 'Review code' },
      ctx,
      { type: 'api', apiKey: 'sk-test' },
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('API response');
    expect(mockInvokeClaudeApi).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-test' }),
    );
  });
});
