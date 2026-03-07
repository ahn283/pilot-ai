import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteShell = vi.fn();
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: (...args: unknown[]) => mockExecuteShell(...args),
}));

const { sendNotification } = await import('../../src/tools/notification.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendNotification', () => {
  it('sends a basic notification', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await sendNotification({ message: 'Build done' });
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('display notification'));
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('Pilot AI'));
  });

  it('includes subtitle', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await sendNotification({ message: 'Done', subtitle: 'api project' });
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('subtitle'));
  });

  it('custom title', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await sendNotification({ title: 'Custom', message: 'msg' });
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('Custom'));
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'err' });
    await expect(sendNotification({ message: 'fail' })).rejects.toThrow('Failed to send notification');
  });

  it('escapes special characters', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await sendNotification({ message: 'He said "hello"' });
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('\\"hello\\"'));
  });
});
