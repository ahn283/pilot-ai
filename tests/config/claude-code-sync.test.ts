import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock claude.ts checkClaudeCli
const mockCheckClaudeCli = vi.fn().mockResolvedValue(true);
vi.mock('../../src/agent/claude.js', () => ({
  checkClaudeCli: (...args: unknown[]) => mockCheckClaudeCli(...args),
}));

// Mock child_process
const mockExecFile = vi.fn(
  (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, result: { stdout: string }) => void) => {
    cb(null, { stdout: '' });
  },
);
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import {
  syncToClaudeCode,
  removeFromClaudeCode,
  syncAllToClaudeCode,
  checkClaudeCodeSync,
} from '../../src/config/claude-code-sync.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckClaudeCli.mockResolvedValue(true);
});

describe('claude-code-sync', () => {
  describe('syncToClaudeCode', () => {
    it('returns success when CLI is available', async () => {
      const result = await syncToClaudeCode('figma', {
        command: 'npx',
        args: ['-y', '@anthropic-ai/figma-mcp'],
        env: { FIGMA_PERSONAL_ACCESS_TOKEN: 'test-token' },
      });
      expect(result.success).toBe(true);
    });

    it('calls claude mcp add-json with correct args', async () => {
      await syncToClaudeCode('figma', {
        command: 'npx',
        args: ['-y', '@anthropic-ai/figma-mcp'],
        env: { FIGMA_PERSONAL_ACCESS_TOKEN: 'test-token' },
      });

      // Second call should be add-json (first is remove)
      const addJsonCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('add-json'),
      );
      expect(addJsonCall).toBeDefined();
      const args = addJsonCall![1] as string[];
      expect(args).toContain('-s');
      expect(args).toContain('user');
      expect(args).toContain('figma');
      // Last arg should be JSON config
      const jsonArg = args[args.length - 1];
      const parsed = JSON.parse(jsonArg);
      expect(parsed.type).toBe('stdio');
      expect(parsed.command).toBe('npx');
      expect(parsed.env.FIGMA_PERSONAL_ACCESS_TOKEN).toBe('test-token');
    });

    it('returns error when CLI is not installed', async () => {
      mockCheckClaudeCli.mockResolvedValue(false);
      const result = await syncToClaudeCode('figma', {
        command: 'npx',
        args: ['-y', '@anthropic-ai/figma-mcp'],
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude Code CLI not installed');
    });

    it('omits env when no env vars provided', async () => {
      await syncToClaudeCode('test-server', {
        command: 'npx',
        args: ['-y', '@test/pkg'],
      });

      const addJsonCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('add-json'),
      );
      const jsonArg = (addJsonCall![1] as string[])[(addJsonCall![1] as string[]).length - 1];
      const parsed = JSON.parse(jsonArg);
      expect(parsed.env).toBeUndefined();
    });
  });

  describe('removeFromClaudeCode', () => {
    it('returns success when removal succeeds', async () => {
      const result = await removeFromClaudeCode('figma');
      expect(result.success).toBe(true);
    });

    it('calls claude mcp remove with correct args', async () => {
      await removeFromClaudeCode('figma');
      const removeCall = mockExecFile.mock.calls.find(
        (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[]).includes('remove'),
      );
      expect(removeCall).toBeDefined();
      expect(removeCall![0]).toBe('claude');
      const args = removeCall![1] as string[];
      expect(args).toContain('-s');
      expect(args).toContain('user');
      expect(args).toContain('figma');
    });

    it('returns error when CLI is not installed', async () => {
      mockCheckClaudeCli.mockResolvedValue(false);
      const result = await removeFromClaudeCode('figma');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude Code CLI not installed');
    });
  });

  describe('syncAllToClaudeCode', () => {
    it('syncs all servers and returns results', async () => {
      const result = await syncAllToClaudeCode({
        figma: { command: 'npx', args: ['-y', '@anthropic-ai/figma-mcp'] },
        notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] },
      });
      expect(result.synced).toContain('figma');
      expect(result.synced).toContain('notion');
      expect(result.failed).toHaveLength(0);
    });

    it('reports failures without stopping', async () => {
      // Make execFile throw for the second server
      let addJsonCount = 0;
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: object, cb: (err: Error | null, result: { stdout: string }) => void) => {
          if (Array.isArray(args) && args.includes('add-json')) {
            addJsonCount++;
            if (addJsonCount === 2) {
              cb(new Error('sync failed'), { stdout: '' });
              return;
            }
          }
          cb(null, { stdout: '' });
        },
      );

      const result = await syncAllToClaudeCode({
        figma: { command: 'npx' },
        notion: { command: 'npx' },
      });
      expect(result.synced).toContain('figma');
      expect(result.failed).toContain('notion');
    });
  });

  describe('checkClaudeCodeSync', () => {
    it('returns true when server is registered', async () => {
      const result = await checkClaudeCodeSync('figma');
      expect(result).toBe(true);
    });

    it('returns false when CLI is not installed', async () => {
      mockCheckClaudeCli.mockResolvedValue(false);
      const result = await checkClaudeCodeSync('figma');
      expect(result).toBe(false);
    });

    it('returns false when execFile throws', async () => {
      mockCheckClaudeCli.mockResolvedValue(true);
      mockExecFile.mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null) => void) => {
          cb(new Error('not found'));
        },
      );
      // Need checkClaudeCli to succeed first, then the mcp get to fail
      const result = await checkClaudeCodeSync('nonexistent');
      expect(result).toBe(false);
    });
  });
});
