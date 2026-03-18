import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { CircuitBreaker } from '../utils/circuit-breaker.js';

const execFileAsync = promisify(execFile);

/** Circuit breaker for Claude CLI invocations */
const claudeCircuit = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 120_000, // 2 minutes
});

export interface ClaudeCliOptions {
  prompt: string;
  systemPrompt?: string;
  cwd?: string;
  allowedTools?: string[];
  mcpConfigPath?: string;
  timeoutMs?: number;
  onToolUse?: (status: string) => void;
  /** Callback for thinking/reasoning content streamed in real-time */
  onThinking?: (text: string) => void;
  /** Start a new session with this UUID */
  sessionId?: string;
  /** Resume an existing session by its UUID */
  resumeSessionId?: string;
  /** Path or name of the Claude CLI binary (default: 'claude') */
  cliBinary?: string;
  /** Max tool-use turns per invocation (maps to --max-turns) */
  maxTurns?: number;
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

/** Maps Claude tool names to user-friendly status descriptions */
function describeToolUse(toolName: string, input?: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const cmd = typeof input?.command === 'string' ? input.command.slice(0, 60) : '';
      if (cmd.startsWith('gh ')) return `🔍 Checking GitHub... \`${cmd}\``;
      if (cmd.startsWith('git ')) return `📂 Checking git history...`;
      if (cmd.startsWith('curl ') || cmd.startsWith('wget ')) return `🌐 Fetching URL...`;
      if (cmd.startsWith('npm ') || cmd.startsWith('npx ')) return `📦 Running npm...`;
      return `⚡ Running: \`${cmd || 'command'}\``;
    }
    case 'Read': return `📖 Reading file...`;
    case 'Write': return `✏️ Writing file...`;
    case 'Edit': case 'MultiEdit': return `✏️ Editing file...`;
    case 'Glob': return `🔍 Searching files...`;
    case 'Grep': return `🔍 Searching code...`;
    case 'LS': return `📂 Listing directory...`;
    case 'WebSearch': {
      const q = typeof input?.query === 'string' ? input.query.slice(0, 50) : '';
      return q ? `🌐 Searching: "${q}"` : `🌐 Searching the web...`;
    }
    case 'WebFetch': return `🌐 Fetching web page...`;
    case 'Task': return `🧠 Delegating sub-task...`;
    case 'NotebookRead': case 'NotebookEdit': return `📓 Working with notebook...`;
    default: return `🔧 Using ${toolName}...`;
  }
}

/** Expose circuit breaker state for health checks */
export function getClaudeCircuitState() {
  return claudeCircuit.getState();
}

/**
 * Invokes the Claude Code CLI as a subprocess.
 * Runs `claude -p --output-format json` and parses the JSON response.
 * Protected by a circuit breaker to fail fast when Claude CLI is unavailable.
 */
export async function invokeClaudeCli(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  return claudeCircuit.execute(() => invokeClaudeCliInner(options));
}

async function invokeClaudeCliInner(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  const { prompt, systemPrompt, cwd, allowedTools, mcpConfigPath, timeoutMs = DEFAULT_TIMEOUT_MS, onToolUse, onThinking, sessionId, resumeSessionId, cliBinary = 'claude', maxTurns } = options;

  const args: string[] = [];

  // Session management: --resume takes precedence (continuing existing session)
  // Use stream-json with --verbose to capture thinking deltas
  // --dangerously-skip-permissions: pilot-ai runs headless — no one can approve CLI prompts.
  // pilot-ai has its own auth (allowedUsers) and safety (ApprovalManager) layer.
  if (resumeSessionId) {
    args.push('-p', '--resume', resumeSessionId, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions');
  } else {
    args.push('-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions');
    if (sessionId) {
      args.push('--session-id', sessionId);
    }
  }

  if (cwd) {
    args.push('--cwd', cwd);
  }

  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt);
  }

  // NOTE: --allowedTools is intentionally NOT used.
  // --dangerously-skip-permissions already permits all tools.
  // Combining --allowedTools with bypass mode is buggy (GitHub #12232)
  // and can silently block MCP tools.

  if (maxTurns) {
    args.push('--max-turns', String(maxTurns));
  }

  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath);
  }

  // Prompt is passed via stdin to avoid OS arg length limits

  return new Promise<ClaudeCliResult>((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn(cliBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env,
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      // Stream-parse NDJSON lines to detect tool usage and thinking in real-time
      if (onToolUse || onThinking) {
        lineBuffer += chunk;
        // Prevent unbounded buffer growth (max 1MB)
        if (lineBuffer.length > 1_048_576) {
          lineBuffer = lineBuffer.slice(-524_288); // Keep last 512KB
        }
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            parseStreamEvent(msg, onToolUse, onThinking);
          } catch {
            // Not valid JSON yet, skip
          }
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log stderr in real-time to surface MCP server errors
      for (const line of chunk.split('\n')) {
        if (line.trim()) {
          console.error(`[claude-cli] ${line}`);
        }
      }
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
 * Parses a single stream-json event for tool use and thinking callbacks.
 * Handles both legacy json format (assistant messages) and stream-json format (stream_event).
 */
export function parseStreamEvent(
  msg: Record<string, unknown>,
  onToolUse?: (status: string) => void,
  onThinking?: (text: string) => void,
): void {
  // stream-json format: { type: "assistant", message: { content: [...] } }
  if (msg.type === 'assistant') {
    const content = (msg as ClaudeJsonMessage).content
      ?? ((msg.message as Record<string, unknown>)?.content as ClaudeJsonMessage['content']);
    if (onToolUse && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use' && (block as Record<string, unknown>).name) {
          onToolUse(describeToolUse(
            (block as Record<string, unknown>).name as string,
            (block as Record<string, unknown>).input as Record<string, unknown> | undefined,
          ));
        }
      }
    }
  }

  // stream-json thinking delta: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "..." } }
  if (onThinking && msg.type === 'content_block_delta') {
    const delta = msg.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      onThinking(delta.thinking);
    }
  }
}

/**
 * Parses Claude CLI stream-json output and extracts the final text result.
 * Supports both legacy json format and stream-json format.
 *
 * IMPORTANT: Only returns the final result, NOT intermediate assistant messages.
 * In multi-turn agentic tasks (stream-json with --max-turns), the output contains
 * ALL intermediate assistant messages. Concatenating them all produces a response
 * many times larger than the actual answer, causing msg_too_long errors on Slack/Telegram.
 */
export function parseClaudeJsonOutput(output: string): string {
  const lines = output.trim().split('\n').filter(Boolean);
  let resultText = '';
  let lastAssistantText = '';

  for (const line of lines) {
    try {
      const msg: ClaudeJsonMessage = JSON.parse(line);

      // Track last assistant message text (used as fallback if no result message)
      if (msg.type === 'assistant') {
        const content = Array.isArray(msg.content)
          ? msg.content
          : ((msg.message as Record<string, unknown>)?.content as Array<{ type: string; text?: string }> | undefined);

        if (Array.isArray(content)) {
          const textParts: string[] = [];
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            }
          }
          if (textParts.length > 0) {
            lastAssistantText = textParts.join('\n');
          }
        }
      }

      // Result message — this is the definitive final answer
      if (msg.type === 'result' && typeof msg.result === 'string') {
        resultText = msg.result;
      }
    } catch {
      // On JSON parse failure, treat as raw text (only if no structured output found)
    }
  }

  // Prefer result message, fall back to last assistant text, then raw output
  return resultText || lastAssistantText || output;
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
