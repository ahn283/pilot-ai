import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      const result = mockExecFile(...args);
      if (result instanceof Error) {
        cb(result, '', result.message);
      } else {
        cb(null, result?.stdout ?? '', result?.stderr ?? '');
      }
    }
    return { stdout: '', stderr: '' };
  },
}));

// Mock claude
vi.mock('../../src/agent/claude.js', () => ({
  checkClaudeCli: vi.fn(),
  checkClaudeCliAuth: vi.fn(),
}));

// Mock github
vi.mock('../../src/tools/github.js', () => ({
  isGhAuthenticated: vi.fn(),
}));

// Mock shell (needed by github.js transitive dep)
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));

import { checkClaudeCli, checkClaudeCliAuth } from '../../src/agent/claude.js';
import { isGhAuthenticated } from '../../src/tools/github.js';

// We test the exported function by importing after mocks
const { runDoctor } = await import('../../src/cli/doctor.js');

beforeEach(() => {
  vi.clearAllMocks();
  // Default: everything succeeds
  mockExecFile.mockReturnValue({ stdout: 'v20.0.0\n', stderr: '' });
  vi.mocked(checkClaudeCli).mockResolvedValue(true);
  vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
  vi.mocked(isGhAuthenticated).mockResolvedValue(true);
});

describe('runDoctor', () => {
  it('runs without throwing', async () => {
    await expect(runDoctor()).resolves.not.toThrow();
  });

  it('detects when Claude CLI is not installed', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(false);
    const consoleSpy = vi.spyOn(console, 'log');
    await runDoctor();
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Claude CLI');
    expect(output).toContain('not installed');
    consoleSpy.mockRestore();
  });

  it('detects when GitHub CLI is not authenticated', async () => {
    vi.mocked(isGhAuthenticated).mockResolvedValue(false);
    const consoleSpy = vi.spyOn(console, 'log');
    await runDoctor();
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('GitHub CLI');
    expect(output).toContain('not authenticated');
    consoleSpy.mockRestore();
  });

  it('shows fix instructions for failed checks', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(false);
    vi.mocked(isGhAuthenticated).mockResolvedValue(false);
    const consoleSpy = vi.spyOn(console, 'log');
    await runDoctor();
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Fix:');
    expect(output).toContain('issue(s) found');
    consoleSpy.mockRestore();
  });
});
