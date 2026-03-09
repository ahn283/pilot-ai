import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../agent/claude.js', () => ({
  checkClaudeCli: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { checkClaudeCli } from '../agent/claude.js';
import {
  syncToClaudeCode,
  removeFromClaudeCode,
  syncAllToClaudeCode,
  checkClaudeCodeSync,
} from './claude-code-sync.js';

const mockExecFile = vi.mocked(execFile);
const mockCheckClaudeCli = vi.mocked(checkClaudeCli);

// Helper: make mockExecFile behave like callback-based execFile
function setupExecFile(results: Array<{ resolve?: unknown; reject?: Error }>) {
  let callIndex = 0;
  mockExecFile.mockImplementation(
    ((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result?: unknown) => void;
      const entry = results[callIndex++];
      if (!entry || entry.reject) {
        cb(entry?.reject ?? new Error('exec failed'));
      } else {
        cb(null, entry.resolve ?? { stdout: '', stderr: '' });
      }
    }) as typeof execFile,
  );
}

describe('claude-code-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('syncToClaudeCode', () => {
    it('returns error when Claude CLI is not installed', async () => {
      mockCheckClaudeCli.mockResolvedValue(false);

      const result = await syncToClaudeCode('figma', { command: 'npx', args: ['-y', 'pkg'] });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude Code CLI not installed');
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('calls remove then add-json on success', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      setupExecFile([
        { reject: new Error('not found') }, // remove — ignored
        { resolve: { stdout: '', stderr: '' } }, // add-json
      ]);

      const result = await syncToClaudeCode('figma', {
        command: 'npx',
        args: ['-y', '@anthropic-ai/figma-mcp'],
        env: { FIGMA_PERSONAL_ACCESS_TOKEN: 'tok123' },
      });

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledTimes(2);

      // Verify remove call
      const removeCall = mockExecFile.mock.calls[0];
      expect(removeCall[0]).toBe('claude');
      expect(removeCall[1]).toEqual(['mcp', 'remove', '-s', 'user', 'figma']);

      // Verify add-json call
      const addCall = mockExecFile.mock.calls[1];
      expect(addCall[0]).toBe('claude');
      expect(addCall[1]![0]).toBe('mcp');
      expect(addCall[1]![1]).toBe('add-json');
      expect(addCall[1]![4]).toBe('figma');

      // Verify JSON payload
      const jsonPayload = JSON.parse(addCall[1]![5] as string);
      expect(jsonPayload.type).toBe('stdio');
      expect(jsonPayload.command).toBe('npx');
      expect(jsonPayload.env).toEqual({ FIGMA_PERSONAL_ACCESS_TOKEN: 'tok123' });
    });

    it('omits env from JSON when no env vars', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      setupExecFile([
        { reject: new Error('not found') },
        { resolve: { stdout: '', stderr: '' } },
      ]);

      await syncToClaudeCode('test', { command: 'npx', args: ['-y', 'pkg'] });

      const addCall = mockExecFile.mock.calls[1];
      const jsonPayload = JSON.parse(addCall[1]![5] as string);
      expect(jsonPayload.env).toBeUndefined();
    });

    it('returns error when add-json fails', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      setupExecFile([
        { reject: new Error('not found') },
        { reject: new Error('add-json failed') },
      ]);

      const result = await syncToClaudeCode('figma', { command: 'npx' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('add-json failed');
    });
  });

  describe('removeFromClaudeCode', () => {
    it('returns error when CLI not installed', async () => {
      mockCheckClaudeCli.mockResolvedValue(false);

      const result = await removeFromClaudeCode('figma');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude Code CLI not installed');
    });

    it('calls claude mcp remove with correct args', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      setupExecFile([{ resolve: { stdout: '', stderr: '' } }]);

      const result = await removeFromClaudeCode('notion');

      expect(result.success).toBe(true);
      const call = mockExecFile.mock.calls[0];
      expect(call[0]).toBe('claude');
      expect(call[1]).toEqual(['mcp', 'remove', '-s', 'user', 'notion']);
    });

    it('returns error when remove fails', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      setupExecFile([{ reject: new Error('server not found') }]);

      const result = await removeFromClaudeCode('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('server not found');
    });
  });

  describe('syncAllToClaudeCode', () => {
    it('syncs multiple servers and reports results', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      setupExecFile([
        { reject: new Error('not found') },
        { resolve: { stdout: '', stderr: '' } },
        { reject: new Error('not found') },
        { reject: new Error('notion failed') },
      ]);

      const result = await syncAllToClaudeCode({
        figma: { command: 'npx', args: ['-y', 'figma-pkg'] },
        notion: { command: 'npx', args: ['-y', 'notion-pkg'] },
      });

      expect(result.synced).toEqual(['figma']);
      expect(result.failed).toEqual(['notion']);
    });

    it('returns empty arrays when no servers', async () => {
      const result = await syncAllToClaudeCode({});
      expect(result.synced).toEqual([]);
      expect(result.failed).toEqual([]);
    });
  });

  describe('checkClaudeCodeSync', () => {
    it('returns false when CLI not installed', async () => {
      mockCheckClaudeCli.mockResolvedValue(false);
      expect(await checkClaudeCodeSync('figma')).toBe(false);
    });

    it('returns true when mcp get succeeds', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      setupExecFile([{ resolve: { stdout: '{}', stderr: '' } }]);
      expect(await checkClaudeCodeSync('figma')).toBe(true);
    });

    it('returns false when mcp get fails', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      setupExecFile([{ reject: new Error('not found') }]);
      expect(await checkClaudeCodeSync('nonexistent')).toBe(false);
    });
  });
});
