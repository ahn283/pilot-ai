import { executeShell } from './shell.js';
import { escapeAppleScript, escapeShellArg } from '../utils/escape.js';

export async function sendNotification(params: {
  title?: string;
  message: string;
  subtitle?: string;
  sound?: boolean;
  clickUrl?: string;
}): Promise<void> {
  // Try terminal-notifier first for click action support
  if (params.clickUrl) {
    const tnResult = await sendWithTerminalNotifier(params);
    if (tnResult) return;
  }

  const title = params.title ?? 'Pilot AI';
  const parts = [`display notification "${escapeAppleScript(params.message)}"`];
  parts.push(`with title "${escapeAppleScript(title)}"`);
  if (params.subtitle) {
    parts.push(`subtitle "${escapeAppleScript(params.subtitle)}"`);
  }
  if (params.sound !== false) {
    parts.push('sound name "default"');
  }

  const script = parts.join(' ');
  const result = await executeShell(`osascript -e ${escapeShellArg(script)}`);
  if (result.exitCode !== 0) throw new Error(`Failed to send notification: ${result.stderr}`);
}

async function sendWithTerminalNotifier(params: {
  title?: string;
  message: string;
  subtitle?: string;
  sound?: boolean;
  clickUrl?: string;
}): Promise<boolean> {
  const which = await executeShell('which terminal-notifier');
  if (which.exitCode !== 0) return false;

  const args = [
    '-title', escapeShellArg(params.title ?? 'Pilot AI'),
    '-message', escapeShellArg(params.message),
  ];
  if (params.subtitle) {
    args.push('-subtitle', escapeShellArg(params.subtitle));
  }
  if (params.sound !== false) {
    args.push('-sound', 'default');
  }
  if (params.clickUrl) {
    args.push('-open', escapeShellArg(params.clickUrl));
  }

  const result = await executeShell(`terminal-notifier ${args.join(' ')}`);
  return result.exitCode === 0;
}

