/**
 * Conversation Summary Buffer for thread-based conversation continuity.
 *
 * Maintains a rolling summary of each thread's conversation so that
 * context can be restored when a Claude CLI session is reset (e.g. msg_too_long).
 *
 * Strategy: hybrid — normal flow uses --resume for full context,
 * this summary is the fallback injected into a fresh session's system prompt.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

export interface TurnSummary {
  /** User message (truncated to 500 chars) */
  userMessage: string;
  /** Agent action summary (truncated to 300 chars) */
  agentAction: string;
  /** ISO timestamp */
  timestamp: string;
}

export interface ConversationSummary {
  /** Unique key: platform:channelId:threadId */
  threadKey: string;
  /** Project path associated with this thread */
  projectPath?: string;
  /** Recent turn summaries (FIFO, max 10) */
  turns: TurnSummary[];
  /** Accumulated key decisions */
  keyDecisions: string[];
  /** Accumulated modified file paths */
  modifiedFiles: string[];
  /** ISO timestamp of last update */
  lastUpdated: string;
}

const MAX_TURNS = 10;
const MAX_DECISIONS = 20;
const MAX_FILES = 30;
const MAX_USER_MSG_LEN = 500;
const MAX_ACTION_LEN = 300;
const SUMMARY_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function getConversationsDir(): string {
  return path.join(getPilotDir(), 'conversations');
}

function getSummaryPath(threadKey: string): string {
  // Replace colons with underscores for filesystem safety
  const filename = threadKey.replace(/:/g, '_') + '.json';
  return path.join(getConversationsDir(), filename);
}

function buildThreadKey(platform: string, channelId: string, threadId: string): string {
  return `${platform}:${channelId}:${threadId}`;
}

/**
 * Loads a conversation summary from disk, or returns null if not found.
 */
export async function loadSummary(
  platform: string, channelId: string, threadId: string,
): Promise<ConversationSummary | null> {
  const key = buildThreadKey(platform, channelId, threadId);
  const filePath = getSummaryPath(key);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as ConversationSummary;
  } catch {
    return null;
  }
}

/**
 * Saves a conversation summary to disk.
 */
export async function saveSummary(summary: ConversationSummary): Promise<void> {
  const filePath = getSummaryPath(summary.threadKey);
  await fs.mkdir(getConversationsDir(), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(summary, null, 2), { mode: 0o600 });
}

/**
 * Extracts an action summary from an agent response.
 * Takes the first 300 characters, trimming to the last sentence boundary if possible.
 */
export function extractActionSummary(agentResponse: string): string {
  const cleaned = agentResponse.replace(/\n+/g, ' ').trim();
  if (cleaned.length <= MAX_ACTION_LEN) return cleaned;

  const truncated = cleaned.slice(0, MAX_ACTION_LEN);
  // Try to cut at the last sentence boundary
  const lastPeriod = truncated.lastIndexOf('. ');
  const lastNewline = truncated.lastIndexOf('。');
  const cutPoint = Math.max(lastPeriod, lastNewline);
  if (cutPoint > MAX_ACTION_LEN * 0.5) {
    return truncated.slice(0, cutPoint + 1);
  }
  return truncated + '...';
}

/**
 * Extracts file paths from an agent response by detecting common patterns.
 */
export function extractModifiedFiles(agentResponse: string): string[] {
  const patterns = [
    // "Writing src/foo.ts", "✏️ src/foo.ts", "Editing src/foo.ts"
    /(?:Writing|Editing|Creating|Modifying|✏️)\s+([\w./-]+\.\w+)/gi,
    // "wrote to src/foo.ts", "saved src/foo.ts"
    /(?:wrote to|saved|updated|created|modified)\s+([\w./-]+\.\w+)/gi,
    // Common commit-style: "src/foo.ts | 10 +"
    /^\s*([\w./-]+\.\w+)\s*\|/gm,
  ];

  const files = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(agentResponse)) !== null) {
      const filePath = match[1];
      // Filter out obviously non-file matches
      if (filePath && filePath.includes('/') && !filePath.startsWith('http')) {
        files.add(filePath);
      }
    }
  }
  return [...files];
}

/**
 * Extracts key decisions from an agent response.
 * Looks for commit messages, configuration changes, and explicit decision language.
 */
export function extractKeyDecisions(agentResponse: string): string[] {
  const decisions: string[] = [];

  // Commit messages: "commit abc1234 — fix: ..."
  const commitPattern = /commit\s+[0-9a-f]+\s*[—–-]\s*(.+)/gi;
  let match;
  while ((match = commitPattern.exec(agentResponse)) !== null) {
    decisions.push(match[1].trim().slice(0, 200));
  }

  return decisions;
}

/**
 * Updates the conversation summary for a thread after a turn completes.
 */
export async function updateConversationSummary(
  platform: string,
  channelId: string,
  threadId: string,
  userMessage: string,
  agentResponse: string,
  projectPath?: string,
): Promise<void> {
  const key = buildThreadKey(platform, channelId, threadId);
  const existing = await loadSummary(platform, channelId, threadId);

  const summary: ConversationSummary = existing ?? {
    threadKey: key,
    projectPath,
    turns: [],
    keyDecisions: [],
    modifiedFiles: [],
    lastUpdated: new Date().toISOString(),
  };

  // Update projectPath if newly resolved
  if (projectPath && !summary.projectPath) {
    summary.projectPath = projectPath;
  }

  // Add turn summary
  const turn: TurnSummary = {
    userMessage: userMessage.slice(0, MAX_USER_MSG_LEN),
    agentAction: extractActionSummary(agentResponse),
    timestamp: new Date().toISOString(),
  };
  summary.turns.push(turn);
  if (summary.turns.length > MAX_TURNS) {
    summary.turns = summary.turns.slice(-MAX_TURNS);
  }

  // Extract and accumulate modified files
  const newFiles = extractModifiedFiles(agentResponse);
  for (const f of newFiles) {
    if (!summary.modifiedFiles.includes(f)) {
      summary.modifiedFiles.push(f);
    }
  }
  if (summary.modifiedFiles.length > MAX_FILES) {
    summary.modifiedFiles = summary.modifiedFiles.slice(-MAX_FILES);
  }

  // Extract and accumulate key decisions
  const newDecisions = extractKeyDecisions(agentResponse);
  for (const d of newDecisions) {
    if (!summary.keyDecisions.includes(d)) {
      summary.keyDecisions.push(d);
    }
  }
  if (summary.keyDecisions.length > MAX_DECISIONS) {
    summary.keyDecisions = summary.keyDecisions.slice(-MAX_DECISIONS);
  }

  summary.lastUpdated = new Date().toISOString();
  await saveSummary(summary);
}

/**
 * Formats a conversation summary for injection into a system prompt.
 * Returns null if no summary exists.
 */
export async function getConversationSummaryText(
  platform: string,
  channelId: string,
  threadId: string,
): Promise<string | null> {
  const summary = await loadSummary(platform, channelId, threadId);
  if (!summary || summary.turns.length === 0) return null;

  const lines: string[] = [];
  lines.push('This is the conversation history from this thread. Use this context to respond to the user\'s follow-up request.');
  lines.push('');

  // Turn history
  lines.push(`## Previous conversation (${summary.turns.length} turns)`);
  for (let i = 0; i < summary.turns.length; i++) {
    const turn = summary.turns[i];
    const time = new Date(turn.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    lines.push(`${i + 1}. [${time}] User: "${turn.userMessage}"`);
    lines.push(`   → Agent: ${turn.agentAction}`);
    lines.push('');
  }

  // Modified files
  if (summary.modifiedFiles.length > 0) {
    lines.push('## Modified files');
    for (const f of summary.modifiedFiles) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  // Key decisions
  if (summary.keyDecisions.length > 0) {
    lines.push('## Key decisions');
    for (const d of summary.keyDecisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Removes conversation summary files older than TTL.
 */
export async function cleanupExpiredSummaries(): Promise<number> {
  const dir = getConversationsDir();
  let removed = 0;
  try {
    const files = await fs.readdir(dir);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(dir, file);
      try {
        const data = await fs.readFile(filePath, 'utf-8');
        const summary = JSON.parse(data) as ConversationSummary;
        const age = now - new Date(summary.lastUpdated).getTime();
        if (age > SUMMARY_TTL_MS) {
          await fs.unlink(filePath);
          removed++;
        }
      } catch {
        // Corrupt file — remove it
        await fs.unlink(filePath).catch(() => {});
        removed++;
      }
    }
  } catch {
    // Directory doesn't exist yet — nothing to clean
  }
  return removed;
}
