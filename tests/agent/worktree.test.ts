import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteShell = vi.fn();
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: (...args: unknown[]) => mockExecuteShell(...args),
}));

const {
  createWorktree,
  removeWorktree,
  listWorktrees,
  createWorktreePr,
} = await import('../../src/agent/worktree.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createWorktree', () => {
  it('creates a git worktree with a unique branch', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const info = await createWorktree('/project', 'task-123');

    expect(info.branch).toContain('pilot-worktree-task-123');
    expect(info.path).toContain('.pilot-worktree-');
    expect(mockExecuteShell).toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      { cwd: '/project' },
    );
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not a git repo' });
    await expect(createWorktree('/bad', 'x')).rejects.toThrow('Failed to create worktree');
  });
});

describe('removeWorktree', () => {
  it('removes worktree and branch', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await removeWorktree('/project', '/project/../.pilot-worktree-abc', 'pilot-worktree-abc');

    expect(mockExecuteShell).toHaveBeenCalledTimes(2);
    expect(mockExecuteShell).toHaveBeenCalledWith(
      expect.stringContaining('git worktree remove'),
      { cwd: '/project' },
    );
    expect(mockExecuteShell).toHaveBeenCalledWith(
      expect.stringContaining('git branch -D'),
      { cwd: '/project' },
    );
  });

  it('removes worktree without branch deletion', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await removeWorktree('/project', '/worktree');
    expect(mockExecuteShell).toHaveBeenCalledTimes(1);
  });
});

describe('listWorktrees', () => {
  it('parses worktree list output', async () => {
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: 'worktree /project\nHEAD abc123\nbranch refs/heads/main\n\nworktree /project/.wt\nHEAD def456\nbranch refs/heads/feature\n',
      stderr: '',
    });
    const worktrees = await listWorktrees('/project');
    expect(worktrees).toEqual(['/project', '/project/.wt']);
  });

  it('returns empty on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' });
    expect(await listWorktrees('/bad')).toEqual([]);
  });
});

describe('createWorktreePr', () => {
  it('pushes branch and creates PR', async () => {
    mockExecuteShell
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // push
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'https://github.com/repo/pull/5', stderr: '' }); // pr create

    const url = await createWorktreePr({
      projectPath: '/project',
      worktreePath: '/wt',
      branch: 'pilot-wt-123',
      title: 'Auto PR',
    });
    expect(url).toContain('github.com');
  });

  it('throws when push fails', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'auth failed' });
    await expect(createWorktreePr({
      projectPath: '/project',
      worktreePath: '/wt',
      branch: 'br',
      title: 'PR',
    })).rejects.toThrow('Failed to push');
  });
});
