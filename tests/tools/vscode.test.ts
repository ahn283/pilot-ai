import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteShell = vi.fn();
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: (...args: unknown[]) => mockExecuteShell(...args),
}));

const {
  isVscodeAvailable,
  openInVscode,
  openDiff,
  runInTerminal,
  gitCommit,
  gitPush,
  createPullRequest,
} = await import('../../src/tools/vscode.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isVscodeAvailable', () => {
  it('returns true when code CLI exists', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '/usr/local/bin/code', stderr: '' });
    expect(await isVscodeAvailable()).toBe(true);
  });

  it('returns false when code CLI not found', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found' });
    expect(await isVscodeAvailable()).toBe(false);
  });
});

describe('openInVscode', () => {
  it('opens a file', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await openInVscode('/path/to/file.ts');
    expect(mockExecuteShell).toHaveBeenCalledWith('code /path/to/file.ts');
  });

  it('opens with --reuse-window', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await openInVscode('/path', { reuse: true });
    expect(mockExecuteShell).toHaveBeenCalledWith('code --reuse-window /path');
  });

  it('opens with --goto line', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await openInVscode('/path/file.ts', { goto: '42' });
    expect(mockExecuteShell).toHaveBeenCalledWith('code --goto /path/file.ts:42');
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error' });
    await expect(openInVscode('/bad')).rejects.toThrow('Failed to open VSCode');
  });
});

describe('openDiff', () => {
  it('opens a diff view', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await openDiff('/a.ts', '/b.ts');
    expect(mockExecuteShell).toHaveBeenCalledWith('code --diff /a.ts /b.ts');
  });
});

describe('runInTerminal', () => {
  it('executes command and returns output', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: 'build ok', stderr: '' });
    const result = await runInTerminal('npm run build', '/project');
    expect(result).toBe('build ok');
    expect(mockExecuteShell).toHaveBeenCalledWith('npm run build', { cwd: '/project' });
  });
});

describe('gitCommit', () => {
  it('stages and commits', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '[main abc123] msg', stderr: '' });
    const result = await gitCommit('fix bug', '/project');
    expect(result).toContain('abc123');
    expect(mockExecuteShell).toHaveBeenCalledWith(
      expect.stringContaining('git add -A && git commit'),
      { cwd: '/project' },
    );
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'nothing to commit' });
    await expect(gitCommit('msg', '/project')).rejects.toThrow('Git commit failed');
  });
});

describe('gitPush', () => {
  it('pushes to origin', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: 'To github.com...' });
    const result = await gitPush('/project');
    expect(mockExecuteShell).toHaveBeenCalledWith('git push origin', { cwd: '/project' });
    expect(result).toContain('github.com');
  });

  it('pushes with force', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await gitPush('/project', { force: true, branch: 'feature' });
    expect(mockExecuteShell).toHaveBeenCalledWith('git push --force origin feature', { cwd: '/project' });
  });
});

describe('createPullRequest', () => {
  it('creates PR via gh CLI', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: 'https://github.com/repo/pull/1', stderr: '' });
    const url = await createPullRequest({ title: 'My PR', cwd: '/project' });
    expect(url).toContain('github.com');
    expect(mockExecuteShell).toHaveBeenCalledWith(
      expect.stringContaining('gh pr create'),
      { cwd: '/project' },
    );
  });
});
