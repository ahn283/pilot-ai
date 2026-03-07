import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteShell = vi.fn();
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: (...args: unknown[]) => mockExecuteShell(...args),
}));

const mockImageToDataUrl = vi.fn().mockResolvedValue('data:image/png;base64,abc123');
vi.mock('../../src/tools/image.js', () => ({
  imageToDataUrl: (...args: unknown[]) => mockImageToDataUrl(...args),
}));

const { readClipboard, writeClipboard, takeScreenshot, takeWindowScreenshot, captureScreenForVision, captureWindowForVision } =
  await import('../../src/tools/clipboard.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readClipboard', () => {
  it('returns clipboard content', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: 'copied text', stderr: '' });
    const result = await readClipboard();
    expect(result).toBe('copied text');
    expect(mockExecuteShell).toHaveBeenCalledWith('pbpaste');
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error' });
    await expect(readClipboard()).rejects.toThrow('Failed to read clipboard');
  });
});

describe('writeClipboard', () => {
  it('writes text to clipboard', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await writeClipboard('hello');
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('pbcopy'));
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error' });
    await expect(writeClipboard('fail')).rejects.toThrow('Failed to write clipboard');
  });
});

describe('takeScreenshot', () => {
  it('captures screenshot to default path', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const filepath = await takeScreenshot();
    expect(filepath).toContain('pilot-screenshot');
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('screencapture -x'));
  });

  it('captures screenshot to custom path', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const filepath = await takeScreenshot('/tmp/custom.png');
    expect(filepath).toBe('/tmp/custom.png');
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error' });
    await expect(takeScreenshot()).rejects.toThrow('Failed to take screenshot');
  });
});

describe('takeWindowScreenshot', () => {
  it('captures frontmost window', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const filepath = await takeWindowScreenshot();
    expect(filepath).toContain('pilot-window');
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('-w'));
  });
});

describe('captureScreenForVision', () => {
  it('takes a screenshot and returns data URL', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const dataUrl = await captureScreenForVision();
    expect(dataUrl).toContain('data:image/png;base64');
    expect(mockImageToDataUrl).toHaveBeenCalled();
  });
});

describe('captureWindowForVision', () => {
  it('takes a window screenshot and returns data URL', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const dataUrl = await captureWindowForVision();
    expect(dataUrl).toContain('data:image/png;base64');
    expect(mockImageToDataUrl).toHaveBeenCalled();
  });
});
