import { executeShell } from './shell.js';

export async function sendNotification(params: {
  title?: string;
  message: string;
  subtitle?: string;
  sound?: boolean;
}): Promise<void> {
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
  const result = await executeShell(`osascript -e '${script}'`);
  if (result.exitCode !== 0) throw new Error(`Failed to send notification: ${result.stderr}`);
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
