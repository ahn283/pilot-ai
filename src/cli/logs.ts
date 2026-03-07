import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

export function getLogPath(): string {
  return path.join(getPilotDir(), 'logs', 'agent.log');
}

export async function runLogs(options: { follow?: boolean } = {}): Promise<void> {
  const logPath = getLogPath();

  try {
    await fs.access(logPath);
  } catch {
    console.log('로그 파일이 아직 없습니다.');
    return;
  }

  if (options.follow) {
    const child = spawn('tail', ['-f', logPath], { stdio: 'inherit' });
    process.on('SIGINT', () => {
      child.kill();
      process.exit(0);
    });
  } else {
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.split('\n');
    // Show last 50 lines
    const tail = lines.slice(-50).join('\n');
    console.log(tail);
  }
}
