import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

export interface ClaudeCliOptions {
  prompt: string;
  systemPrompt?: string;
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

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (agentic tasks take longer)

/** Default tools to pre-approve for claude -p so it can operate agentically */
export const DEFAULT_ALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',
  'WebSearch',
  'WebFetch',
  'Task',
];

/**
 * Checks whether the Claude CLI binary is installed.
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
 * Checks whether the Claude CLI is authenticated using `claude auth status`.
 */
export async function checkClaudeCliAuth(binary: string = 'claude'): Promise<boolean> {
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const { stdout } = await execFileAsync(binary, ['auth', 'status'], {
      timeout: 5_000,
      env,
    });
    return stdout.includes('"loggedIn": true') || stdout.includes('"loggedIn":true');
  } catch {
    return false;
  }
}

/**
 * Invokes the Claude Code CLI as a subprocess.
 * Runs `claude -p --output-format json` and parses the JSON response.
 */
export async function invokeClaudeCli(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  const { prompt, systemPrompt, cwd, allowedTools, mcpConfigPath, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const args = ['-p', '--output-format', 'json'];

  if (cwd) {
    args.push('--cwd', cwd);
  }

  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt);
  }

  if (allowedTools && allowedTools.length > 0) {
    for (const tool of allowedTools) {
      args.push('--allowedTools', tool);
    }
  }

  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath);
  }

  // Prompt is passed via stdin to avoid OS arg length limits

  return new Promise<ClaudeCliResult>((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env,
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Claude CLI execution failed: ${err.message}`));
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;

      if (exitCode !== 0 && !stdout) {
        reject(new Error(`Claude CLI error (exit ${exitCode}): ${stderr || 'Unknown error'}`));
        return;
      }

      const result = parseClaudeJsonOutput(stdout);
      resolve({ result, exitCode });
    });
  });
}

/**
 * Parses Claude CLI JSON output and extracts the final text result.
 * --output-format json outputs multiple messages in JSONL format.
 */
export function parseClaudeJsonOutput(output: string): string {
  const lines = output.trim().split('\n').filter(Boolean);
  const texts: string[] = [];

  for (const line of lines) {
    try {
      const msg: ClaudeJsonMessage = JSON.parse(line);

      // Extract text from assistant messages
      if (msg.type === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            texts.push(block.text);
          }
        }
      }

      // Result message
      if (msg.type === 'result' && typeof msg.result === 'string') {
        texts.push(msg.result);
      }
    } catch {
      // On JSON parse failure, treat as raw text
      texts.push(line);
    }
  }

  return texts.join('\n') || output;
}

/**
 * Fallback mode that directly calls the Anthropic API.
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
