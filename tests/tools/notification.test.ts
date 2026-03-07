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

  it('uses terminal-notifier for click URL when available', async () => {
    mockExecuteShell
      .mockResolvedValueOnce({ exitCode: 0, stdout: '/usr/local/bin/terminal-notifier', stderr: '' }) // which
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // terminal-notifier
    await sendNotification({ message: 'Click me', clickUrl: 'https://example.com' });
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('terminal-notifier'));
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('-open'));
  });

  it('falls back to osascript if terminal-notifier not found', async () => {
    mockExecuteShell
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'not found' }) // which fails
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // osascript
    await sendNotification({ message: 'Fallback', clickUrl: 'https://example.com' });
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('osascript'));
  });
});
