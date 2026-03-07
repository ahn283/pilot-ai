import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { configSchema, type PilotConfig } from './schema.js';
import { getSecret } from './keychain.js';

export function getPilotDir(): string {
  return path.join(os.homedir(), '.pilot');
}

export function getConfigPath(): string {
  return path.join(getPilotDir(), 'config.json');
}

const PILOT_SUBDIRS = ['logs', 'memory', 'memory/projects', 'memory/history', 'skills'];

export async function ensurePilotDir(): Promise<void> {
  await fs.mkdir(getPilotDir(), { recursive: true });
  for (const sub of PILOT_SUBDIRS) {
    await fs.mkdir(path.join(getPilotDir(), sub), { recursive: true });
  }
}

export async function loadConfig(): Promise<PilotConfig> {
  await ensurePilotDir();

  let raw: unknown;
  try {
    const content = await fs.readFile(getConfigPath(), 'utf-8');
    raw = JSON.parse(content);
  } catch {
    throw new Error(`Configuration file not found. Run "npx pilot-ai init" first.`);
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid configuration file:\n${result.error.format()._errors.join('\n')}`);
  }

  return resolveKeychainSecrets(result.data);
}

/**
 * Resolves ***keychain*** placeholders with actual values from macOS Keychain.
 */
async function resolveKeychainSecrets(config: PilotConfig): Promise<PilotConfig> {
  const resolved = structuredClone(config);

  // Slack tokens
  if (resolved.messenger.slack) {
    if (resolved.messenger.slack.botToken === '***keychain***') {
      resolved.messenger.slack.botToken = (await getSecret('slack-bot-token')) ?? '';
    }
    if (resolved.messenger.slack.appToken === '***keychain***') {
      resolved.messenger.slack.appToken = (await getSecret('slack-app-token')) ?? '';
    }
    if (resolved.messenger.slack.signingSecret === '***keychain***') {
      resolved.messenger.slack.signingSecret = (await getSecret('slack-signing-secret')) ?? '';
    }
  }

  // Telegram token
  if (resolved.messenger.telegram?.botToken === '***keychain***') {
    resolved.messenger.telegram.botToken = (await getSecret('telegram-bot-token')) ?? '';
  }

  // Claude API key
  if (resolved.claude.apiKey === '***keychain***') {
    resolved.claude.apiKey = (await getSecret('anthropic-api-key')) ?? null;
  }

  // Notion
  if (resolved.notion?.apiKey === '***keychain***') {
    resolved.notion.apiKey = (await getSecret('notion-api-key')) ?? '';
  }

  // Figma
  if (resolved.figma?.personalAccessToken === '***keychain***') {
    resolved.figma.personalAccessToken = (await getSecret('figma-personal-access-token')) ?? '';
  }

  // Linear
  if (resolved.linear?.apiKey === '***keychain***') {
    resolved.linear.apiKey = (await getSecret('linear-api-key')) ?? '';
  }

  return resolved;
}

export async function loadRawConfig(): Promise<Record<string, unknown>> {
  const content = await fs.readFile(getConfigPath(), 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

export async function saveConfig(config: Partial<PilotConfig>): Promise<void> {
  await ensurePilotDir();

  const content = JSON.stringify(config, null, 2) + '\n';
  await fs.writeFile(getConfigPath(), content, { mode: 0o600 });
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}
