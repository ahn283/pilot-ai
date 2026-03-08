import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./shell-mock.js', () => ({}));

const mockExecuteShell = vi.fn();
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: (...args: unknown[]) => mockExecuteShell(...args),
}));

const {
  isGhAuthenticated,
  createPr,
  listPrs,
  getPr,
  mergePr,
  getPrDiff,
  createIssue,
  listIssues,
  closeIssue,
  getChecks,
  getRunLog,
} = await import('../../src/tools/github.js');

beforeEach(() => {
  vi.clearAllMocks();
});

/** Helper: mock gh auth status as authenticated, then the actual command */
function mockAuthThen(result: { exitCode: number; stdout: string; stderr: string }) {
  mockExecuteShell
    .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // auth check
    .mockResolvedValueOnce(result);
}

describe('auth', () => {
  it('returns true when gh is authenticated', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    expect(await isGhAuthenticated()).toBe(true);
  });

  it('returns false when gh is not authenticated', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not logged in' });
    expect(await isGhAuthenticated()).toBe(false);
  });
});

describe('auth guard', () => {
  it('throws user-friendly error when not authenticated', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not logged in' });
    await expect(createPr({ title: 'test' })).rejects.toThrow('gh auth login');
  });

  it('throws user-friendly error for listPrs when not authenticated', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not logged in' });
    await expect(listPrs()).rejects.toThrow('gh auth login');
  });

  it('throws user-friendly error for createIssue when not authenticated', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not logged in' });
    await expect(createIssue({ title: 'test' })).rejects.toThrow('gh auth login');
  });

  it('throws user-friendly error for getChecks when not authenticated', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not logged in' });
    await expect(getChecks()).rejects.toThrow('gh auth login');
  });
});

describe('pull requests', () => {
  it('creates a PR', async () => {
    mockAuthThen({ exitCode: 0, stdout: 'https://github.com/repo/pull/1', stderr: '' });
    const url = await createPr({ title: 'feat: new feature', body: 'description', draft: true });
    expect(url).toContain('pull/1');
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('pr create'), expect.anything());
  });

  it('lists PRs', async () => {
    mockAuthThen({ exitCode: 0, stdout: '[{"number":1,"title":"test"}]', stderr: '' });
    const result = await listPrs();
    expect(result).toContain('"number":1');
  });

  it('gets PR details', async () => {
    mockAuthThen({ exitCode: 0, stdout: '{"number":5,"title":"PR"}', stderr: '' });
    const result = await getPr('5');
    expect(result).toContain('"number":5');
  });

  it('merges a PR', async () => {
    mockAuthThen({ exitCode: 0, stdout: 'Merged', stderr: '' });
    const result = await mergePr(5);
    expect(result).toBe('Merged');
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('--squash'), expect.anything());
  });

  it('gets PR diff', async () => {
    mockAuthThen({ exitCode: 0, stdout: '+added line', stderr: '' });
    const diff = await getPrDiff(5);
    expect(diff).toContain('+added');
  });

  it('throws on failure', async () => {
    mockAuthThen({ exitCode: 1, stdout: '', stderr: 'error' });
    await expect(createPr({ title: 'fail' })).rejects.toThrow('Failed to create PR');
  });
});

describe('issues', () => {
  it('creates an issue', async () => {
    mockAuthThen({ exitCode: 0, stdout: 'https://github.com/repo/issues/10', stderr: '' });
    const url = await createIssue({ title: 'Bug', labels: ['bug'] });
    expect(url).toContain('issues/10');
  });

  it('lists issues', async () => {
    mockAuthThen({ exitCode: 0, stdout: '[{"number":1}]', stderr: '' });
    const result = await listIssues({ state: 'open' });
    expect(result).toContain('"number":1');
  });

  it('closes an issue', async () => {
    mockAuthThen({ exitCode: 0, stdout: 'Closed', stderr: '' });
    const result = await closeIssue(10);
    expect(result).toBe('Closed');
  });
});

describe('CI checks', () => {
  it('gets checks for HEAD', async () => {
    mockAuthThen({ exitCode: 0, stdout: '[{"name":"test","status":"completed"}]', stderr: '' });
    const result = await getChecks();
    expect(result).toContain('"name":"test"');
  });

  it('gets failed run log', async () => {
    mockAuthThen({ exitCode: 0, stdout: 'error log here', stderr: '' });
    const log = await getRunLog(12345);
    expect(log).toContain('error log');
  });
});
