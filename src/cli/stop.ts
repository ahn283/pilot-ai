import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPlistPath, isLoaded } from './start.js';

const execFileAsync = promisify(execFile);

export async function runStop(): Promise<void> {
  if (!(await isLoaded())) {
    console.log('Agent is not running.');
    return;
  }

  const plistPath = getPlistPath();

  try {
    await execFileAsync('launchctl', ['unload', plistPath]);
  } catch (err) {
    console.error('launchctl unload failed:', (err as Error).message);
    process.exitCode = 1;
    return;
  }

  try {
    await fs.unlink(plistPath);
  } catch {
    // plist already removed, OK
  }

  console.log('Agent stopped.');
}
