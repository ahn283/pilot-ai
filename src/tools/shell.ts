import { spawn } from 'node:child_process';
import { isCommandBlocked, createSafeEnv } from '../security/sandbox.js';

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 60_000; // 1분

export async function executeShell(
  command: string,
  options?: { cwd?: string; timeoutMs?: number },
): Promise<ShellResult> {
  // 명령어 블랙리스트 검증
  if (isCommandBlocked(command)) {
    throw new Error(`차단된 명령어입니다: ${command}`);
  }

  const { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {};

  return new Promise<ShellResult>((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      env: createSafeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Shell 실행 실패: ${err.message}`));
    });

    child.on('close', (code) => {
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code ?? 1,
      });
    });
  });
}
