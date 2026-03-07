import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

export interface ClaudeCliOptions {
  prompt: string;
  cwd?: string;
  allowedTools?: string[];
  mcpConfigPath?: string;
  timeoutMs?: number;
}

export interface ClaudeCliResult {
  result: string;
  exitCode: number;
}

export interface ClaudeJsonMessage {
  type: string;
  subtype?: string;
  result?: string;
  content?: Array<{ type: string; text?: string }>;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5분

/**
 * claude CLI 바이너리가 설치되어 있는지 확인한다.
 */
export async function checkClaudeCli(binary: string = 'claude'): Promise<boolean> {
  try {
    await execFileAsync('which', [binary]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claude Code CLI를 subprocess로 호출한다.
 * `claude -p --output-format json` 형태로 실행하여 JSON 응답을 파싱한다.
 */
export async function invokeClaudeCli(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  const { prompt, cwd, allowedTools, mcpConfigPath, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const args = ['-p', '--output-format', 'json'];

  if (cwd) {
    args.push('--cwd', cwd);
  }

  if (allowedTools && allowedTools.length > 0) {
    for (const tool of allowedTools) {
      args.push('--allowedTools', tool);
    }
  }

  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath);
  }

  args.push(prompt);

  return new Promise<ClaudeCliResult>((resolve, reject) => {
    const child = spawn('claude', args, {
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
      reject(new Error(`Claude CLI 실행 실패: ${err.message}`));
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;

      if (exitCode !== 0 && !stdout) {
        reject(new Error(`Claude CLI 에러 (exit ${exitCode}): ${stderr || '알 수 없는 오류'}`));
        return;
      }

      const result = parseClaudeJsonOutput(stdout);
      resolve({ result, exitCode });
    });
  });
}

/**
 * Claude CLI의 JSON 출력을 파싱하여 최종 텍스트 결과를 추출한다.
 * --output-format json은 JSONL 형태로 여러 메시지를 출력한다.
 */
export function parseClaudeJsonOutput(output: string): string {
  const lines = output.trim().split('\n').filter(Boolean);
  const texts: string[] = [];

  for (const line of lines) {
    try {
      const msg: ClaudeJsonMessage = JSON.parse(line);

      // assistant 메시지에서 텍스트 추출
      if (msg.type === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            texts.push(block.text);
          }
        }
      }

      // result 메시지
      if (msg.type === 'result' && typeof msg.result === 'string') {
        texts.push(msg.result);
      }
    } catch {
      // JSON 파싱 실패 시 원문 텍스트로 처리
      texts.push(line);
    }
  }

  return texts.join('\n') || output;
}

/**
 * Anthropic API를 직접 호출하는 fallback 모드.
 */
export async function invokeClaudeApi(options: {
  prompt: string;
  apiKey: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const { prompt, apiKey, model = 'claude-sonnet-4-20250514', maxTokens = 4096 } = options;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const texts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') {
      texts.push(block.text);
    }
  }

  return texts.join('\n');
}
