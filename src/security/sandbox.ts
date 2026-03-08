import path from 'node:path';
import os from 'node:os';
import type { PilotConfig } from '../config/schema.js';

/**
 * Expands ~ to the actual home directory path.
 */
function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Validates whether a given path is within the sandbox scope.
 * - Normalizes the path to prevent path traversal attacks
 * - Checks against the allowed paths whitelist
 * - Checks against the blocked paths blacklist
 */
export function isPathAllowed(targetPath: string, config: PilotConfig): boolean {
  const resolved = path.resolve(expandHome(targetPath));

  const { allowedPaths, blockedPaths } = config.security.filesystemSandbox;

  // Check blocked paths (takes priority)
  for (const blocked of blockedPaths) {
    const resolvedBlocked = path.resolve(expandHome(blocked));
    if (resolved === resolvedBlocked || resolved.startsWith(resolvedBlocked + path.sep)) {
      return false;
    }
  }

  // Check allowed paths
  for (const allowed of allowedPaths) {
    const resolvedAllowed = path.resolve(expandHome(allowed));
    if (resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + path.sep)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a shell command matches the blocklist.
 * Also splits chained commands (&&, ||, ;, |) and checks each part individually.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*-rf\s+)[\/~]/,  // rm -rf / or rm -rf ~
  /curl\s.*\|\s*(?:ba)?sh/,                           // curl | sh, curl | bash
  /wget\s.*\|\s*(?:ba)?sh/,                           // wget | sh
  /chmod\s+777/,                                       // chmod 777
  />\s*\/dev\//,                                       // > /dev/ device file manipulation
  /mkfs\./,                                            // mkfs filesystem format
  /dd\s+.*of=\/dev\//,                                 // dd of=/dev/
  /:(){ :\|:& };:/,                                    // fork bomb
];

/** Max command length to prevent DoS via extremely long commands */
const MAX_COMMAND_LENGTH = 10_000;

export function isCommandBlocked(command: string): boolean {
  // Length limit
  if (command.length > MAX_COMMAND_LENGTH) return true;

  // Check the full command first
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(command))) return true;

  // Split on shell operators and check each sub-command
  const subCommands = command.split(/\s*(?:&&|\|\||;)\s*/);
  for (const sub of subCommands) {
    const trimmed = sub.trim();
    if (trimmed && BLOCKED_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      return true;
    }
  }

  // Check inside subshell expressions $(...) and backticks
  const subshellMatches = command.match(/\$\(([^)]+)\)/g);
  if (subshellMatches) {
    for (const match of subshellMatches) {
      const inner = match.slice(2, -1);
      if (BLOCKED_PATTERNS.some((pattern) => pattern.test(inner))) {
        return true;
      }
    }
  }
  const backtickMatches = command.match(/`([^`]+)`/g);
  if (backtickMatches) {
    for (const match of backtickMatches) {
      const inner = match.slice(1, -1);
      if (BLOCKED_PATTERNS.some((pattern) => pattern.test(inner))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Creates an isolated environment variable set for subprocess execution.
 * Removes sensitive environment variables.
 */
const SENSITIVE_ENV_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'NOTION_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
];

export function createSafeEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const key of SENSITIVE_ENV_KEYS) {
    delete env[key];
  }
  return env;
}
