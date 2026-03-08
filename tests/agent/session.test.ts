import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-session-test-${Date.now()}`);

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

import fs from 'node:fs/promises';

import {
  getSession,
  createSession,
  touchSession,
  cleanupSessions,
  getSessionCount,
  resetSessionStore,
} from '../../src/agent/session.js';

beforeEach(async () => {
  resetSessionStore();
  await fs.mkdir(path.join(testDir, '.pilot'), { recursive: true });
  // Remove stale sessions file so each test starts clean
  try { await fs.unlink(path.join(testDir, '.pilot', 'sessions.json')); } catch { /* ignore */ }
});

// Clean up after all tests
import { afterAll } from 'vitest';
afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('session store', () => {
  it('returns null for non-existent session', async () => {
    const session = await getSession('slack', 'C123', 'T456');
    expect(session).toBeNull();
  });

  it('creates a new session with UUID', async () => {
    const session = await createSession('slack', 'C123', 'T456');
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.platform).toBe('slack');
    expect(session.channelId).toBe('C123');
    expect(session.threadId).toBe('T456');
    expect(session.turnCount).toBe(1);
  });

  it('retrieves an existing session', async () => {
    const created = await createSession('slack', 'C123', 'T789');
    const retrieved = await getSession('slack', 'C123', 'T789');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sessionId).toBe(created.sessionId);
  });

  it('does not cross-match different threads', async () => {
    await createSession('slack', 'C123', 'T1');
    const other = await getSession('slack', 'C123', 'T2');
    expect(other).toBeNull();
  });

  it('does not cross-match different platforms', async () => {
    await createSession('slack', 'C123', 'T1');
    const other = await getSession('telegram', 'C123', 'T1');
    expect(other).toBeNull();
  });

  it('touchSession increments turn count', async () => {
    await createSession('slack', 'C1', 'T1');
    await touchSession('slack', 'C1', 'T1');
    await touchSession('slack', 'C1', 'T1');
    const session = await getSession('slack', 'C1', 'T1');
    expect(session!.turnCount).toBe(3);
  });

  it('stores projectPath', async () => {
    const session = await createSession('telegram', 'C1', 'T1', '/Users/test/project');
    expect(session.projectPath).toBe('/Users/test/project');
  });

  it('getSessionCount returns correct count', async () => {
    await createSession('slack', 'C1', 'T1');
    await createSession('slack', 'C1', 'T2');
    await createSession('telegram', 'C2', 'T3');
    const count = await getSessionCount();
    expect(count).toBe(3);
  });

  it('cleanupSessions removes nothing when all fresh', async () => {
    await createSession('slack', 'C1', 'T1');
    const removed = await cleanupSessions();
    expect(removed).toBe(0);
    expect(await getSessionCount()).toBe(1);
  });
});
