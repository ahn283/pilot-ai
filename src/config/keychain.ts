import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SERVICE_PREFIX = 'pilot-ai';

function serviceKey(key: string): string {
  return `${SERVICE_PREFIX}:${key}`;
}

export async function setSecret(key: string, value: string): Promise<void> {
  const service = serviceKey(key);
  // Delete existing entry first (ignore error if not found)
  try {
    await execFileAsync('security', ['delete-generic-password', '-s', service]);
  } catch {
    // Not found, ignore
  }

  await execFileAsync('security', [
    'add-generic-password',
    '-s',
    service,
    '-a',
    SERVICE_PREFIX,
    '-w',
    value,
    '-U',
  ]);
}

export async function getSecret(key: string): Promise<string | null> {
  const service = serviceKey(key);
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      service,
      '-a',
      SERVICE_PREFIX,
      '-w',
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  const service = serviceKey(key);
  try {
    await execFileAsync('security', ['delete-generic-password', '-s', service]);
  } catch {
    // Not found, ignore
  }
}
