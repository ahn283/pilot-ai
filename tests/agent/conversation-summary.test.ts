import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const testDir = path.join(os.tmpdir(), `pilot-convsummary-test-${Date.now()}`);

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

import {
  loadSummary,
  saveSummary,
  updateConversationSummary,
  getConversationSummaryText,
  extractActionSummary,
  extractModifiedFiles,
  extractKeyDecisions,
  cleanupExpiredSummaries,
  type ConversationSummary,
} from '../../src/agent/conversation-summary.js';

beforeEach(async () => {
  // Clean conversations dir before each test
  const convDir = path.join(testDir, '.pilot', 'conversations');
  await fs.rm(convDir, { recursive: true, force: true });
  await fs.mkdir(convDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('conversation-summary', () => {
  describe('loadSummary / saveSummary', () => {
    it('returns null for non-existent summary', async () => {
      const result = await loadSummary('slack', 'C123', 'T456');
      expect(result).toBeNull();
    });

    it('saves and loads a summary', async () => {
      const summary: ConversationSummary = {
        threadKey: 'slack:C123:T456',
        turns: [{ userMessage: 'hello', agentAction: 'replied', timestamp: '2026-01-01T00:00:00Z' }],
        keyDecisions: [],
        modifiedFiles: [],
        lastUpdated: '2026-01-01T00:00:00Z',
      };
      await saveSummary(summary);
      const loaded = await loadSummary('slack', 'C123', 'T456');
      expect(loaded).not.toBeNull();
      expect(loaded!.threadKey).toBe('slack:C123:T456');
      expect(loaded!.turns).toHaveLength(1);
    });
  });

  describe('extractActionSummary', () => {
    it('returns short responses as-is', () => {
      const result = extractActionSummary('Done.');
      expect(result).toBe('Done.');
    });

    it('truncates long responses', () => {
      const long = 'A'.repeat(1000);
      const result = extractActionSummary(long);
      expect(result.length).toBeLessThanOrEqual(804); // 800 + "..."
    });

    it('extracts status lines', () => {
      const text = 'Checking files...\n\n✅ Build succeeded\n\n❌ Test failed: foo.test.ts';
      const result = extractActionSummary(text);
      expect(result).toContain('✅ Build succeeded');
      expect(result).toContain('❌ Test failed');
    });

    it('extracts commit messages', () => {
      const text = 'Made changes.\n\ncommit abc1234 fix: resolve auth issue';
      const result = extractActionSummary(text);
      expect(result).toContain('commit abc1234');
    });
  });

  describe('extractModifiedFiles', () => {
    it('extracts "Writing" pattern', () => {
      const response = 'Writing src/agent/core.ts with changes';
      expect(extractModifiedFiles(response)).toContain('src/agent/core.ts');
    });

    it('extracts "updated" pattern', () => {
      const response = 'I updated src/config/store.ts successfully';
      expect(extractModifiedFiles(response)).toContain('src/config/store.ts');
    });

    it('extracts commit diff style', () => {
      const response = ' src/agent/core.ts | 10 ++++---\n src/agent/session.ts | 3 +-';
      const files = extractModifiedFiles(response);
      expect(files).toContain('src/agent/core.ts');
      expect(files).toContain('src/agent/session.ts');
    });

    it('deduplicates files', () => {
      const response = 'Writing src/foo.ts done. Writing src/foo.ts again.';
      expect(extractModifiedFiles(response)).toEqual(['src/foo.ts']);
    });

    it('filters out URLs', () => {
      const response = 'Check https://example.com/foo.ts for details';
      expect(extractModifiedFiles(response)).toEqual([]);
    });

    it('returns empty for no matches', () => {
      expect(extractModifiedFiles('All good, nothing changed.')).toEqual([]);
    });
  });

  describe('extractKeyDecisions', () => {
    it('extracts commit messages', () => {
      const response = 'commit 1b6f1e6 — fix: use configurable cliBinary';
      const decisions = extractKeyDecisions(response);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toContain('fix: use configurable cliBinary');
    });

    it('handles em-dash and en-dash', () => {
      const response = 'commit abc1234 – feat: add OAuth support';
      const decisions = extractKeyDecisions(response);
      expect(decisions).toHaveLength(1);
    });

    it('extracts action verb patterns', () => {
      const response = 'Created src/agent/token-refresher.ts with hourly checks. Fixed the build error in core.ts.';
      const decisions = extractKeyDecisions(response);
      expect(decisions.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty for no patterns', () => {
      expect(extractKeyDecisions('Just a short note.')).toEqual([]);
    });
  });

  describe('updateConversationSummary', () => {
    it('creates a new summary for first turn', async () => {
      await updateConversationSummary(
        'slack', 'C1', 'T1',
        'Fix the ENOENT error', 'Fixed by updating src/agent/claude.ts',
        '/Users/test/project',
      );
      const summary = await loadSummary('slack', 'C1', 'T1');
      expect(summary).not.toBeNull();
      expect(summary!.turns).toHaveLength(1);
      expect(summary!.turns[0].userMessage).toBe('Fix the ENOENT error');
      expect(summary!.projectPath).toBe('/Users/test/project');
    });

    it('appends turns to existing summary', async () => {
      await updateConversationSummary('slack', 'C1', 'T1', 'msg1', 'resp1');
      await updateConversationSummary('slack', 'C1', 'T1', 'msg2', 'resp2');
      await updateConversationSummary('slack', 'C1', 'T1', 'msg3', 'resp3');
      const summary = await loadSummary('slack', 'C1', 'T1');
      expect(summary!.turns).toHaveLength(3);
    });

    it('enforces max 15 turns (FIFO)', async () => {
      for (let i = 0; i < 17; i++) {
        await updateConversationSummary('slack', 'C1', 'T1', `msg${i}`, `resp${i}`);
      }
      const summary = await loadSummary('slack', 'C1', 'T1');
      expect(summary!.turns).toHaveLength(15);
      // First two should have been dropped
      expect(summary!.turns[0].userMessage).toBe('msg2');
    });

    it('accumulates modified files', async () => {
      await updateConversationSummary('slack', 'C1', 'T1', 'fix it', 'Writing src/a.ts done');
      await updateConversationSummary('slack', 'C1', 'T1', 'more', 'Writing src/b.ts done');
      const summary = await loadSummary('slack', 'C1', 'T1');
      expect(summary!.modifiedFiles).toContain('src/a.ts');
      expect(summary!.modifiedFiles).toContain('src/b.ts');
    });

    it('accumulates key decisions', async () => {
      await updateConversationSummary('slack', 'C1', 'T1', 'commit', 'commit abc123 — feat: add login');
      await updateConversationSummary('slack', 'C1', 'T1', 'commit', 'commit def456 — fix: typo');
      const summary = await loadSummary('slack', 'C1', 'T1');
      expect(summary!.keyDecisions).toHaveLength(2);
    });

    it('truncates long user messages', async () => {
      const longMsg = 'X'.repeat(1000);
      await updateConversationSummary('slack', 'C1', 'T1', longMsg, 'ok');
      const summary = await loadSummary('slack', 'C1', 'T1');
      expect(summary!.turns[0].userMessage.length).toBe(500);
    });
  });

  describe('getConversationSummaryText', () => {
    it('returns null for non-existent thread', async () => {
      const text = await getConversationSummaryText('slack', 'C1', 'nonexistent');
      expect(text).toBeNull();
    });

    it('formats summary with turns', async () => {
      await updateConversationSummary('slack', 'C1', 'T1', 'Fix the bug', 'Fixed by updating src/agent/core.ts. commit abc123 — fix: bug resolved');
      const text = await getConversationSummaryText('slack', 'C1', 'T1');
      expect(text).not.toBeNull();
      expect(text).toContain('Previous conversation (1 turns)');
      expect(text).toContain('Fix the bug');
      expect(text).toContain('Key decisions');
    });

    it('returns null for empty turns', async () => {
      const summary: ConversationSummary = {
        threadKey: 'slack:C1:Tempty',
        turns: [],
        keyDecisions: [],
        modifiedFiles: [],
        lastUpdated: new Date().toISOString(),
      };
      await saveSummary(summary);
      const text = await getConversationSummaryText('slack', 'C1', 'Tempty');
      expect(text).toBeNull();
    });
  });

  describe('cleanupExpiredSummaries', () => {
    it('removes summaries older than TTL', async () => {
      const summary: ConversationSummary = {
        threadKey: 'slack:C1:Told',
        turns: [{ userMessage: 'old', agentAction: 'old', timestamp: '2020-01-01T00:00:00Z' }],
        keyDecisions: [],
        modifiedFiles: [],
        lastUpdated: '2020-01-01T00:00:00Z', // Very old
      };
      await saveSummary(summary);

      // Also create a fresh one
      await updateConversationSummary('slack', 'C1', 'Tfresh', 'new msg', 'new resp');

      const removed = await cleanupExpiredSummaries();
      expect(removed).toBe(1);

      // Fresh one should still exist
      const fresh = await loadSummary('slack', 'C1', 'Tfresh');
      expect(fresh).not.toBeNull();
    });

    it('returns 0 when no summaries exist', async () => {
      const convDir = path.join(testDir, '.pilot', 'conversations');
      await fs.rm(convDir, { recursive: true, force: true });
      const removed = await cleanupExpiredSummaries();
      expect(removed).toBe(0);
    });
  });
});
