/**
 * Session store for mapping messenger threads to Claude CLI sessions.
 * Enables multi-turn conversations where each Slack/Telegram thread
 * maintains a continuous Claude session with full context.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPilotDir } from '../config/store.js';

export interface SessionEntry {
  /** Claude CLI session ID (UUID) */
  sessionId: string;
  /** Messenger thread ID */
  threadId: string;
  /** Channel ID */
  channelId: string;
  /** Platform */
  platform: 'slack' | 'telegram';
  /** Project path (if resolved) */
  projectPath?: string;
  /** When this session was created */
  createdAt: string;
  /** When this session was last used */
  lastUsedAt: string;
  /** Number of turns in this session */
  turnCount: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSION_TURNS = 20; // Force new session after 20 turns to prevent context overflow

function getSessionStorePath(): string {
  return path.join(getPilotDir(), 'sessions.json');
}

let sessions: Map<string, SessionEntry> = new Map();
let loadPromise: Promise<void> | null = null;

/**
 * Builds a unique key for thread identification.
 */
function threadKey(platform: string, channelId: string, threadId: string): string {
  return `${platform}:${channelId}:${threadId}`;
}

/**
 * Loads sessions from disk. Serialized via Promise to prevent race conditions.
 */
async function ensureLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const data = await fs.readFile(getSessionStorePath(), 'utf-8');
      const entries = JSON.parse(data) as SessionEntry[];
      sessions = new Map(entries.map((e) => [threadKey(e.platform, e.channelId, e.threadId), e]));
    } catch {
      sessions = new Map();
    }
  })();
  return loadPromise;
}

/**
 * Persists sessions to disk.
 */
async function save(): Promise<void> {
  const entries = Array.from(sessions.values());
  await fs.writeFile(getSessionStorePath(), JSON.stringify(entries, null, 2), { mode: 0o600 });
}

/**
 * Gets an existing session for a thread, or null if none exists.
 * Expired sessions (older than TTL) are automatically cleaned up.
 */
export async function getSession(
  platform: string,
  channelId: string,
  threadId: string,
): Promise<SessionEntry | null> {
  await ensureLoaded();
  const key = threadKey(platform, channelId, threadId);
  const entry = sessions.get(key);

  if (!entry) return null;

  // Check TTL
  const age = Date.now() - new Date(entry.lastUsedAt).getTime();
  if (age > SESSION_TTL_MS) {
    sessions.delete(key);
    await save();
    return null;
  }

  // Check turn count limit — force new session to prevent context overflow
  if (entry.turnCount >= MAX_SESSION_TURNS) {
    sessions.delete(key);
    await save();
    return null;
  }

  return entry;
}

/**
 * Creates a new session for a thread.
 */
export async function createSession(
  platform: 'slack' | 'telegram',
  channelId: string,
  threadId: string,
  projectPath?: string,
): Promise<SessionEntry> {
  await ensureLoaded();

  const entry: SessionEntry = {
    sessionId: crypto.randomUUID(),
    threadId,
    channelId,
    platform,
    projectPath,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: 1,
  };

  const key = threadKey(platform, channelId, threadId);
  sessions.set(key, entry);
  await save();
  return entry;
}

/**
 * Updates a session's lastUsedAt and increments turn count.
 */
export async function touchSession(
  platform: string,
  channelId: string,
  threadId: string,
): Promise<void> {
  await ensureLoaded();
  const key = threadKey(platform, channelId, threadId);
  const entry = sessions.get(key);
  if (entry) {
    entry.lastUsedAt = new Date().toISOString();
    entry.turnCount++;
    await save();
  }
}

/**
 * Deletes a specific session. Used for error recovery (e.g. msg_too_long).
 */
export async function deleteSession(
  platform: string,
  channelId: string,
  threadId: string,
): Promise<boolean> {
  await ensureLoaded();
  const key = threadKey(platform, channelId, threadId);
  const deleted = sessions.delete(key);
  if (deleted) await save();
  return deleted;
}

/**
 * Removes expired sessions. Called periodically.
 */
export async function cleanupSessions(): Promise<number> {
  await ensureLoaded();
  const now = Date.now();
  let removed = 0;

  for (const [key, entry] of sessions) {
    const age = now - new Date(entry.lastUsedAt).getTime();
    if (age > SESSION_TTL_MS) {
      sessions.delete(key);
      removed++;
    }
  }

  if (removed > 0) await save();
  return removed;
}

/**
 * Gets session count (for monitoring).
 */
export async function getSessionCount(): Promise<number> {
  await ensureLoaded();
  return sessions.size;
}

/**
 * Resets loaded state (for testing).
 */
export function resetSessionStore(): void {
  sessions = new Map();
  loadPromise = null;
}
