import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { configSchema, type PilotConfig } from './schema.js';

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

  return result.data;
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
