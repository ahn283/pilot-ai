/**
 * Voice I/O using macOS native capabilities.
 * TTS: macOS `say` command
 * STT: Apple Speech via osascript or Whisper API
 */
import { executeShell } from './shell.js';

// --- Text-to-Speech ---

export interface TtsOptions {
  voice?: string;
  rate?: number;
  outputFile?: string;
}

/**
 * Speaks text using macOS `say` command.
 */
export async function speak(text: string, opts?: TtsOptions): Promise<void> {
  const args: string[] = [];
  if (opts?.voice) args.push('-v', `"${opts.voice}"`);
  if (opts?.rate) args.push('-r', String(opts.rate));
  if (opts?.outputFile) args.push('-o', opts.outputFile);

  const escaped = text.replace(/"/g, '\\"');
  const result = await executeShell(`say ${args.join(' ')} "${escaped}"`);
  if (result.exitCode !== 0) throw new Error(`TTS failed: ${result.stderr}`);
}

/**
 * Lists available macOS voices.
 */
export async function listVoices(): Promise<string[]> {
  const result = await executeShell('say -v ?');
  if (result.exitCode !== 0) return [];

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)/);
      return match ? match[1] : '';
    })
    .filter(Boolean);
}

/**
 * Converts text to audio file (AIFF format by default).
 */
export async function textToAudioFile(text: string, outputPath: string, voice?: string): Promise<string> {
  await speak(text, { voice, outputFile: outputPath });
  return outputPath;
}

// --- Speech-to-Text ---

/**
 * Transcribes audio using Whisper API.
 * Requires OPENAI_API_KEY in environment or passed directly.
 */
export async function transcribeWithWhisper(audioPath: string, apiKey?: string): Promise<string> {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API key required for Whisper transcription');

  const result = await executeShell(
    `curl -s -X POST https://api.openai.com/v1/audio/transcriptions ` +
    `-H "Authorization: Bearer ${key}" ` +
    `-F file=@"${audioPath}" ` +
    `-F model=whisper-1`,
  );

  if (result.exitCode !== 0) throw new Error(`Whisper API failed: ${result.stderr}`);

  try {
    const data = JSON.parse(result.stdout) as { text: string; error?: { message: string } };
    if (data.error) throw new Error(`Whisper error: ${data.error.message}`);
    return data.text;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`Invalid Whisper response: ${result.stdout}`);
    throw err;
  }
}

/**
 * Records audio from microphone using macOS sox (if installed) or ffmpeg.
 * Returns the path to the recorded file.
 */
export async function recordAudio(outputPath: string, durationSeconds: number = 10): Promise<string> {
  // Try sox first
  const soxResult = await executeShell(
    `rec -q "${outputPath}" trim 0 ${durationSeconds}`,
    { timeoutMs: (durationSeconds + 5) * 1000 },
  );
  if (soxResult.exitCode === 0) return outputPath;

  // Fallback to ffmpeg
  const ffResult = await executeShell(
    `ffmpeg -f avfoundation -i ":default" -t ${durationSeconds} -y "${outputPath}"`,
    { timeoutMs: (durationSeconds + 5) * 1000 },
  );
  if (ffResult.exitCode === 0) return outputPath;

  throw new Error('No audio recording tool available. Install sox or ffmpeg.');
}
