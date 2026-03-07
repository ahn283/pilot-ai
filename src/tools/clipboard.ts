import { executeShell } from './shell.js';
import path from 'node:path';
import os from 'node:os';

export async function readClipboard(): Promise<string> {
  const result = await executeShell('pbpaste');
  if (result.exitCode !== 0) throw new Error(`Failed to read clipboard: ${result.stderr}`);
  return result.stdout;
}

export async function writeClipboard(text: string): Promise<void> {
  // Use printf to avoid echo adding newline issues with special chars
  const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  const result = await executeShell(`printf '%s' '${escaped}' | pbcopy`);
  if (result.exitCode !== 0) throw new Error(`Failed to write clipboard: ${result.stderr}`);
}

export async function takeScreenshot(outputPath?: string): Promise<string> {
  const filePath = outputPath ?? path.join(os.tmpdir(), `pilot-screenshot-${Date.now()}.png`);
  const result = await executeShell(`screencapture -x ${filePath}`);
  if (result.exitCode !== 0) throw new Error(`Failed to take screenshot: ${result.stderr}`);
  return filePath;
}

export async function takeWindowScreenshot(outputPath?: string): Promise<string> {
  const filePath = outputPath ?? path.join(os.tmpdir(), `pilot-window-${Date.now()}.png`);
  // -w flag captures the frontmost window
  const result = await executeShell(`screencapture -x -w ${filePath}`);
  if (result.exitCode !== 0) throw new Error(`Failed to take window screenshot: ${result.stderr}`);
  return filePath;
}
