import { executeShell } from './shell.js';

/**
 * Checks if the `code` CLI is available.
 */
export async function isVscodeAvailable(): Promise<boolean> {
  const result = await executeShell('which code');
  return result.exitCode === 0;
}

/**
 * Opens a file or folder in VSCode.
 */
export async function openInVscode(pathOrUri: string, opts?: { reuse?: boolean; goto?: string }): Promise<void> {
  const args: string[] = [];
  if (opts?.reuse) args.push('--reuse-window');
  if (opts?.goto) {
    args.push('--goto', `${pathOrUri}:${opts.goto}`);
  } else {
    args.push(pathOrUri);
  }
  const result = await executeShell(`code ${args.join(' ')}`);
  if (result.exitCode !== 0) throw new Error(`Failed to open VSCode: ${result.stderr}`);
}

/**
 * Opens a diff between two files in VSCode.
 */
export async function openDiff(leftPath: string, rightPath: string, title?: string): Promise<void> {
  const args = ['--diff', leftPath, rightPath];
  if (title) args.push('--title', `"${title}"`);
  const result = await executeShell(`code ${args.join(' ')}`);
  if (result.exitCode !== 0) throw new Error(`Failed to open diff: ${result.stderr}`);
}

/**
 * Runs a command in the VSCode integrated terminal.
 * Opens a new terminal and sends the command.
 */
export async function runInTerminal(command: string, cwd?: string): Promise<string> {
  const result = await executeShell(command, { cwd });
  return result.stdout;
}

/**
 * Git commit with message in the given project directory.
 */
export async function gitCommit(message: string, cwd: string): Promise<string> {
  const result = await executeShell(`git add -A && git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd });
  if (result.exitCode !== 0) throw new Error(`Git commit failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * Git push to remote.
 */
export async function gitPush(cwd: string, opts?: { remote?: string; branch?: string; force?: boolean }): Promise<string> {
  const remote = opts?.remote ?? 'origin';
  const branch = opts?.branch ?? '';
  const force = opts?.force ? ' --force' : '';
  const result = await executeShell(`git push${force} ${remote} ${branch}`.trim(), { cwd });
  if (result.exitCode !== 0) throw new Error(`Git push failed: ${result.stderr}`);
  return result.stdout || result.stderr;
}

/**
 * Creates a PR using gh CLI (delegates to github tool).
 */
export async function createPullRequest(params: {
  title: string;
  body?: string;
  base?: string;
  cwd: string;
}): Promise<string> {
  const args = [`gh pr create --title "${params.title.replace(/"/g, '\\"')}"`];
  if (params.body) args.push(`--body "${params.body.replace(/"/g, '\\"')}"`);
  if (params.base) args.push(`--base ${params.base}`);
  const result = await executeShell(args.join(' '), { cwd: params.cwd });
  if (result.exitCode !== 0) throw new Error(`PR creation failed: ${result.stderr}`);
  return result.stdout;
}
