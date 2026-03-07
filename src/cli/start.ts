import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPilotDir, configExists } from '../config/store.js';

const execFileAsync = promisify(execFile);

const PLIST_NAME = 'com.pilot-ai.agent';
const PLIST_DIR = path.join(process.env.HOME ?? '', 'Library', 'LaunchAgents');

export function getPlistPath(): string {
  return path.join(PLIST_DIR, `${PLIST_NAME}.plist`);
}

function getDaemonPath(): string {
  return path.join(getPilotDir(), '..', '..', 'node_modules', '.bin', 'pilot-ai');
}

export function buildPlist(nodePath: string, scriptPath: string, logDir: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'agent.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'agent-error.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>`;
}

export async function runStart(): Promise<void> {
  if (!(await configExists())) {
    console.error('No configuration found. Run "npx pilot-ai init" first.');
    process.exitCode = 1;
    return;
  }

  // Check if already running
  if (await isLoaded()) {
    console.log('Agent is already running.');
    return;
  }

  const nodePath = process.execPath;
  // Resolve the actual pilot-ai bin script
  const scriptPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'index.js',
  );
  const logDir = path.join(getPilotDir(), 'logs');
  await fs.mkdir(logDir, { recursive: true });

  const plistContent = buildPlist(nodePath, scriptPath, logDir);

  await fs.mkdir(PLIST_DIR, { recursive: true });
  await fs.writeFile(getPlistPath(), plistContent);

  try {
    await execFileAsync('launchctl', ['load', getPlistPath()]);
    console.log('Agent started.');
    console.log(`  Logs: ${logDir}/agent.log`);
  } catch (err) {
    console.error('launchctl load failed:', (err as Error).message);
    process.exitCode = 1;
  }
}

export async function isLoaded(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('launchctl', ['list']);
    return stdout.includes(PLIST_NAME);
  } catch {
    return false;
  }
}
