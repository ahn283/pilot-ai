import { executeShell, type ShellResult } from './shell.js';

async function gh(args: string, cwd?: string): Promise<ShellResult> {
  return executeShell(`gh ${args}`, { cwd });
}

// --- Auth ---

export async function isGhAuthenticated(): Promise<boolean> {
  const result = await gh('auth status');
  return result.exitCode === 0;
}

/**
 * Ensure gh CLI is authenticated before running a command.
 * Throws a user-friendly error if not authenticated.
 */
async function ensureGhAuth(): Promise<void> {
  const authed = await isGhAuthenticated();
  if (!authed) {
    throw new Error(
      'GitHub CLI is not authenticated. Run "gh auth login" in your terminal to connect your GitHub account.',
    );
  }
}

// --- Pull Requests ---

export async function createPr(params: {
  title: string;
  body?: string;
  base?: string;
  draft?: boolean;
  cwd?: string;
}): Promise<string> {
  await ensureGhAuth();
  const args = ['pr', 'create', '--title', JSON.stringify(params.title)];
  if (params.body) args.push('--body', JSON.stringify(params.body));
  if (params.base) args.push('--base', params.base);
  if (params.draft) args.push('--draft');
  const result = await gh(args.join(' '), params.cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to create PR: ${result.stderr}`);
  return result.stdout.trim();
}

export async function listPrs(opts?: {
  state?: 'open' | 'closed' | 'merged' | 'all';
  cwd?: string;
}): Promise<string> {
  await ensureGhAuth();
  const state = opts?.state ?? 'open';
  const result = await gh(`pr list --state ${state} --json number,title,state,author --limit 20`, opts?.cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to list PRs: ${result.stderr}`);
  return result.stdout;
}

export async function getPr(numberOrBranch: string, cwd?: string): Promise<string> {
  await ensureGhAuth();
  const result = await gh(`pr view ${numberOrBranch} --json number,title,state,body,reviews,statusCheckRollup`, cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to get PR: ${result.stderr}`);
  return result.stdout;
}

export async function mergePr(number: number, opts?: {
  method?: 'merge' | 'squash' | 'rebase';
  cwd?: string;
}): Promise<string> {
  await ensureGhAuth();
  const method = opts?.method ?? 'squash';
  const result = await gh(`pr merge ${number} --${method} --delete-branch`, opts?.cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to merge PR: ${result.stderr}`);
  return result.stdout.trim();
}

export async function getPrDiff(number: number, cwd?: string): Promise<string> {
  await ensureGhAuth();
  const result = await gh(`pr diff ${number}`, cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to get PR diff: ${result.stderr}`);
  return result.stdout;
}

// --- Issues ---

export async function createIssue(params: {
  title: string;
  body?: string;
  labels?: string[];
  cwd?: string;
}): Promise<string> {
  await ensureGhAuth();
  const args = ['issue', 'create', '--title', JSON.stringify(params.title)];
  if (params.body) args.push('--body', JSON.stringify(params.body));
  if (params.labels?.length) args.push('--label', params.labels.join(','));
  const result = await gh(args.join(' '), params.cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to create issue: ${result.stderr}`);
  return result.stdout.trim();
}

export async function listIssues(opts?: {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  cwd?: string;
}): Promise<string> {
  await ensureGhAuth();
  const state = opts?.state ?? 'open';
  const args = [`issue list --state ${state} --json number,title,state,labels --limit 20`];
  if (opts?.labels?.length) args.push(`--label ${opts.labels.join(',')}`);
  const result = await gh(args.join(' '), opts?.cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to list issues: ${result.stderr}`);
  return result.stdout;
}

export async function closeIssue(number: number, opts?: {
  reason?: 'completed' | 'not_planned';
  cwd?: string;
}): Promise<string> {
  await ensureGhAuth();
  const reason = opts?.reason ?? 'completed';
  const result = await gh(`issue close ${number} --reason ${reason}`, opts?.cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to close issue: ${result.stderr}`);
  return result.stdout.trim();
}

// --- CI / Checks ---

export async function getChecks(ref?: string, cwd?: string): Promise<string> {
  await ensureGhAuth();
  const target = ref ?? 'HEAD';
  const result = await gh(`run list --commit ${target} --json status,conclusion,name,databaseId --limit 10`, cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to get checks: ${result.stderr}`);
  return result.stdout;
}

export async function getRunLog(runId: number, cwd?: string): Promise<string> {
  await ensureGhAuth();
  const result = await gh(`run view ${runId} --log-failed`, cwd);
  if (result.exitCode !== 0) throw new Error(`Failed to get run log: ${result.stderr}`);
  return result.stdout;
}
