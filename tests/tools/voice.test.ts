import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteShell = vi.fn();
vi.mock('../../src/tools/shell.js', () => ({
  executeShell: (...args: unknown[]) => mockExecuteShell(...args),
}));

const { speak, listVoices, textToAudioFile, transcribeWithWhisper, recordAudio } =
  await import('../../src/tools/voice.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('speak', () => {
  it('calls say command', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await speak('Hello world');
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('say'));
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('Hello world'));
  });

  it('passes voice and rate options', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    await speak('Test', { voice: 'Samantha', rate: 200 });
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('-v'));
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('-r'));
  });

  it('throws on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'no audio' });
    await expect(speak('fail')).rejects.toThrow('TTS failed');
  });
});

describe('listVoices', () => {
  it('parses voice list', async () => {
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: 'Samantha  en_US  # Most people...\nAlex      en_US  # ...',
      stderr: '',
    });
    const voices = await listVoices();
    expect(voices).toContain('Samantha');
    expect(voices).toContain('Alex');
  });

  it('returns empty on failure', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error' });
    const voices = await listVoices();
    expect(voices).toHaveLength(0);
  });
});

describe('textToAudioFile', () => {
  it('saves audio to file', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const path = await textToAudioFile('Hello', '/tmp/out.aiff');
    expect(path).toBe('/tmp/out.aiff');
    expect(mockExecuteShell).toHaveBeenCalledWith(expect.stringContaining('-o'));
  });
});

describe('transcribeWithWhisper', () => {
  it('transcribes audio via Whisper API', async () => {
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ text: 'Hello world' }),
      stderr: '',
    });
    const text = await transcribeWithWhisper('/tmp/audio.wav', 'sk-test');
    expect(text).toBe('Hello world');
  });

  it('throws without API key', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(transcribeWithWhisper('/tmp/audio.wav')).rejects.toThrow('API key required');
    if (origKey) process.env.OPENAI_API_KEY = origKey;
  });

  it('throws on Whisper API error', async () => {
    mockExecuteShell.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ error: { message: 'Invalid file' } }),
      stderr: '',
    });
    await expect(transcribeWithWhisper('/tmp/bad.wav', 'sk-test')).rejects.toThrow('Invalid file');
  });
});

describe('recordAudio', () => {
  it('uses sox when available', async () => {
    mockExecuteShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const path = await recordAudio('/tmp/rec.wav', 5);
    expect(path).toBe('/tmp/rec.wav');
    expect(mockExecuteShell).toHaveBeenCalledWith(
      expect.stringContaining('rec'),
      expect.objectContaining({ timeoutMs: 10000 }),
    );
  });

  it('falls back to ffmpeg', async () => {
    mockExecuteShell
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'sox not found' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const path = await recordAudio('/tmp/rec.wav', 5);
    expect(path).toBe('/tmp/rec.wav');
    expect(mockExecuteShell).toHaveBeenCalledTimes(2);
  });

  it('throws when no tool available', async () => {
    mockExecuteShell
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    await expect(recordAudio('/tmp/rec.wav')).rejects.toThrow('No audio recording tool');
  });
});
