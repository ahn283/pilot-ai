import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

export interface AuditEntry {
  timestamp: string;
  type: 'command' | 'execution' | 'result' | 'error' | 'approval';
  userId?: string;
  platform?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Masks sensitive information in text.
 */
const SECRET_PATTERNS = [
  /xoxb-[a-zA-Z0-9-]+/g,       // Slack bot token
  /xapp-[a-zA-Z0-9-]+/g,       // Slack app token
  /bot\d+:[a-zA-Z0-9_-]+/g,    // Telegram bot token
  /ntn_[a-zA-Z0-9]+/g,         // Notion API key
  /sk-ant-[a-zA-Z0-9-]+/g,     // Anthropic API key
  /sk-[a-zA-Z0-9]{20,}/g,      // Generic API key
];

export function maskSecrets(text: string): string {
  let masked = text;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      if (match.length <= 8) return '***';
      return match.slice(0, 4) + '***' + match.slice(-4);
    });
  }
  return masked;
}

/**
 * Writes an entry to the audit log.
 * Appends one JSON line per entry to ~/.pilot/logs/audit.jsonl.
 */
export async function writeAuditLog(entry: AuditEntry, shouldMask: boolean = true): Promise<void> {
  const logDir = path.join(getPilotDir(), 'logs');
  await fs.mkdir(logDir, { recursive: true });

  const logPath = path.join(logDir, 'audit.jsonl');
  const record = {
    ...entry,
    content: shouldMask ? maskSecrets(entry.content) : entry.content,
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  await fs.appendFile(logPath, JSON.stringify(record) + '\n', { mode: 0o600 });
}
