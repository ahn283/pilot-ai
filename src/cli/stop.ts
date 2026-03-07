import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPlistPath, isLoaded } from './start.js';

const execFileAsync = promisify(execFile);

export async function runStop(): Promise<void> {
  if (!(await isLoaded())) {
    console.log('에이전트가 실행 중이 아닙니다.');
    return;
  }

  const plistPath = getPlistPath();

  try {
    await execFileAsync('launchctl', ['unload', plistPath]);
  } catch (err) {
    console.error('launchctl unload 실패:', (err as Error).message);
    process.exitCode = 1;
    return;
  }

  try {
    await fs.unlink(plistPath);
  } catch {
    // plist already removed, OK
  }

  console.log('에이전트가 중지되었습니다.');
}
