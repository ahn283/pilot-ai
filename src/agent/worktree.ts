import { executeShell } from '../tools/shell.js';
import crypto from 'node:crypto';
import path from 'node:path';

export interface WorktreeInfo {
  path: string;
  branch: string;
}

/**
 * Creates a git worktree for parallel work on the same project.
 * Returns the worktree path and branch name.
 */
export async function createWorktree(projectPath: string, taskId: string): Promise<WorktreeInfo> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const branch = `pilot-worktree-${taskId}-${suffix}`;
  const worktreePath = path.join(projectPath, '..', `.pilot-worktree-${suffix}`);

  // Create a new branch and worktree from current HEAD
  const result = await executeShell(
    `git worktree add -b "${branch}" "${worktreePath}"`,
    { cwd: projectPath },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create worktree: ${result.stderr}`);
  }

  return { path: worktreePath, branch };
}

/**
 * Removes a git worktree and optionally its branch.
 */
export async function removeWorktree(projectPath: string, worktreePath: string, branch?: string): Promise<void> {
  await executeShell(`git worktree remove "${worktreePath}" --force`, { cwd: projectPath });
  if (branch) {
    await executeShell(`git branch -D "${branch}"`, { cwd: projectPath });
  }
}

/**
 * Lists existing worktrees for a project.
 */
export async function listWorktrees(projectPath: string): Promise<string[]> {
  const result = await executeShell('git worktree list --porcelain', { cwd: projectPath });
  if (result.exitCode !== 0) return [];

  return result.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.replace('worktree ', ''));
}

/**
 * Creates a PR from a worktree branch back to the base branch.
 */
export async function createWorktreePr(params: {
  projectPath: string;
  worktreePath: string;
  branch: string;
  title: string;
  body?: string;
}): Promise<string> {
  // Push the worktree branch
  const pushResult = await executeShell(
    `git push -u origin "${params.branch}"`,
    { cwd: params.worktreePath },
  );
  if (pushResult.exitCode !== 0) {
    throw new Error(`Failed to push worktree branch: ${pushResult.stderr}`);
  }

  // Create PR
  const prArgs = [`gh pr create --title "${params.title.replace(/"/g, '\\"')}" --head "${params.branch}"`];
  if (params.body) prArgs.push(`--body "${params.body.replace(/"/g, '\\"')}"`);

  const prResult = await executeShell(prArgs.join(' '), { cwd: params.worktreePath });
  if (prResult.exitCode !== 0) {
    throw new Error(`Failed to create PR: ${prResult.stderr}`);
  }

  return prResult.stdout;
}
