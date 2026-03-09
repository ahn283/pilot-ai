import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { accessSync, constants as fsConstants } from 'node:fs';

const execFileAsync = promisify(execFile);

export interface PermissionCheckResult {
  name: string;
  granted: boolean;
  error?: string;
}

/**
 * Checks and triggers macOS TCC permissions that pilot-ai needs.
 * Each check attempts an operation that requires the permission,
 * triggering the system prompt if not yet granted.
 */
export async function requestPermissions(): Promise<PermissionCheckResult[]> {
  console.log('\n── macOS Permissions ──\n');
  console.log('  Pilot-AI needs macOS permissions to control your Mac.');
  console.log('  IMPORTANT: Accessibility permission is required — it enables');
  console.log('  Pilot-AI to auto-approve other permission popups at runtime.');
  console.log('  Please click "Allow" on any popups that appear.\n');

  const results: PermissionCheckResult[] = [];

  // 1. Automation (AppleEvents) - needed for controlling apps via AppleScript
  results.push(await checkAutomation());

  // 2. Screen Recording - needed for screenshots
  results.push(await checkScreenRecording());

  // 3. Accessibility - needed for UI automation (must be added manually)
  results.push(await checkAccessibility());

  // 4. Full Disk Access - needed for reading files outside sandbox
  results.push(checkFullDiskAccess());

  console.log('\n  Permission check summary:');
  for (const r of results) {
    const icon = r.granted ? '  [ok]' : '  [!!]';
    const suffix = r.error ? ` — ${r.error}` : '';
    console.log(`${icon} ${r.name}${suffix}`);
  }
  console.log('');

  const missing = results.filter(r => !r.granted);
  const accessibilityGranted = results.find(r => r.name === 'Accessibility')?.granted ?? false;

  if (!accessibilityGranted) {
    console.log('  !! Accessibility is NOT granted.');
    console.log('     Without it, Pilot-AI cannot auto-approve other permissions at runtime.');
    console.log('     Open: System Settings > Privacy & Security > Accessibility');
    console.log('     Add your terminal app (e.g. Terminal, iTerm2) or "node".\n');
  }

  if (missing.length > 0 && accessibilityGranted) {
    console.log('  Some optional permissions are missing but Accessibility is granted.');
    console.log('  Pilot-AI will auto-approve popups for missing permissions at runtime.\n');
  } else if (missing.length === 0) {
    console.log('  All permissions granted!\n');
  }

  return results;
}

async function checkAutomation(): Promise<PermissionCheckResult> {
  process.stdout.write('  Checking Automation (AppleEvents)... ');
  try {
    await execFileAsync('osascript', ['-e', 'tell application "System Events" to get name of first process'], {
      timeout: 10_000,
    });
    console.log('granted');
    return { name: 'Automation (AppleEvents)', granted: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not allowed') || msg.includes('1743') || msg.includes('not permitted')) {
      console.log('denied (click Allow if a popup appeared, then re-run init)');
      return { name: 'Automation (AppleEvents)', granted: false, error: 'Click Allow on the popup and re-run' };
    }
    // If osascript ran but returned an error, permission was still granted
    console.log('granted');
    return { name: 'Automation (AppleEvents)', granted: true };
  }
}

async function checkScreenRecording(): Promise<PermissionCheckResult> {
  process.stdout.write('  Checking Screen Recording... ');
  try {
    await execFileAsync('screencapture', ['-x', '-t', 'png', '/tmp/pilot-ai-permtest.png'], {
      timeout: 10_000,
    });
    // Check if the screenshot is not just a blank/tiny file (permission denied produces a 0-byte or tiny file)
    const { stdout } = await execFileAsync('wc', ['-c', '/tmp/pilot-ai-permtest.png']);
    const size = parseInt(stdout.trim().split(/\s+/)[0], 10);
    // Clean up
    await execFileAsync('rm', ['-f', '/tmp/pilot-ai-permtest.png']);
    if (size > 100) {
      console.log('granted');
      return { name: 'Screen Recording', granted: true };
    }
    console.log('denied');
    return { name: 'Screen Recording', granted: false, error: 'Add terminal/node in System Settings > Screen Recording' };
  } catch {
    console.log('unable to verify');
    return { name: 'Screen Recording', granted: false, error: 'Add terminal/node in System Settings > Screen Recording' };
  }
}

async function checkAccessibility(): Promise<PermissionCheckResult> {
  process.stdout.write('  Checking Accessibility... ');
  try {
    // Try a simple AXIsProcessTrusted check via AppleScript + System Events
    await execFileAsync('osascript', [
      '-e', 'tell application "System Events" to keystroke ""',
    ], { timeout: 10_000 });
    console.log('granted');
    return { name: 'Accessibility', granted: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not allowed') || msg.includes('1743') || msg.includes('assistive')) {
      console.log('denied');
      return { name: 'Accessibility', granted: false, error: 'Add terminal/node in System Settings > Accessibility' };
    }
    // If it ran without the specific denial error, it's likely granted
    console.log('granted');
    return { name: 'Accessibility', granted: true };
  }
}

function checkFullDiskAccess(): PermissionCheckResult {
  // Full Disk Access cannot be triggered programmatically — only guided
  process.stdout.write('  Checking Full Disk Access... ');
  try {
    // Try reading a TCC-protected path
    accessSync(`${process.env.HOME}/Library/Mail`, fsConstants.R_OK);
    console.log('granted');
    return { name: 'Full Disk Access', granted: true };
  } catch {
    console.log('not granted (optional)');
    return { name: 'Full Disk Access', granted: false, error: 'Add terminal/node in System Settings > Full Disk Access (optional)' };
  }
}

/**
 * Background watcher that detects macOS TCC permission dialogs and auto-clicks "Allow".
 * Requires Accessibility permission to be pre-granted during init.
 * Reports auto-approved permissions and failures via the notify callback.
 */
export class PermissionWatcher {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private notify: (message: string) => void;
  private hasAccessibility = false;
  private consecutiveFailures = 0;

  constructor(notify: (message: string) => void) {
    this.notify = notify;
  }

  async start(): Promise<void> {
    // Verify we have Accessibility before starting
    this.hasAccessibility = await this.checkHasAccessibility();
    if (!this.hasAccessibility) {
      this.notify(
        'Pilot-AI cannot auto-approve macOS permission popups because Accessibility is not granted. ' +
        'Add "node" to System Settings > Privacy & Security > Accessibility, then restart.',
      );
    }

    // Poll every 3 seconds for TCC dialogs
    this.intervalId = setInterval(() => this.scan(), 3000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async checkHasAccessibility(): Promise<boolean> {
    try {
      await execFileAsync('osascript', [
        '-e', 'tell application "System Events" to get name of first process',
      ], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  private async scan(): Promise<void> {
    if (!this.hasAccessibility) return;

    try {
      // Use AppleScript to find TCC consent dialogs and click Allow
      const script = `
tell application "System Events"
  set dialogResults to ""
  repeat with proc in (every process whose visible is true)
    repeat with win in (every window of proc)
      try
        set winName to name of win
        set allButtons to name of every button of win
        if allButtons contains "Allow" and allButtons contains "Don\u2019t Allow" then
          set dialogResults to dialogResults & winName & "|"
          click button "Allow" of win
        end if
        if allButtons contains "Allow" and allButtons contains "Don't Allow" then
          set dialogResults to dialogResults & winName & "|"
          click button "Allow" of win
        end if
      end try
    end repeat
  end repeat
  return dialogResults
end tell`;

      const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 8_000 });
      // Successful scan (with or without dialogs) resets the failure counter
      this.consecutiveFailures = 0;
      const approved = stdout.trim();
      if (approved) {
        const dialogNames = approved.split('|').filter(Boolean);
        for (const name of dialogNames) {
          this.notify(`Auto-approved macOS permission: "${name}"`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only count permission-related failures, not timeouts or transient errors
      if (msg.includes('not allowed') || msg.includes('1743') || msg.includes('assistive')) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures === 3) {
          this.notify(
            'Auto-approve failed 3 times in a row. ' +
            'Please manually handle macOS permission popups or check Accessibility settings.',
          );
        }
      }
    }
  }
}

/**
 * Target apps for bulk Automation permission triggering.
 * Each entry triggers a TCC popup for the source app (Terminal/node) → target app combination.
 */
const TCC_TARGET_APPS = [
  { name: 'System Events', script: 'tell application "System Events" to get name of first process' },
  { name: 'Finder', script: 'tell application "Finder" to get name of first Finder window' },
  { name: 'Calendar', script: 'tell application "Calendar" to get name of first calendar' },
  { name: 'Mail', script: 'tell application "Mail" to get mailbox count of first account' },
  { name: 'Safari', script: 'tell application "Safari" to get name of first window' },
  { name: 'Terminal', script: 'tell application "Terminal" to get name of first window' },
];

/**
 * Triggers Automation (AppleEvents) permission for multiple target apps at once.
 * Each call causes a TCC popup for apps not yet authorized.
 * Returns per-app results.
 */
export async function triggerBulkAutomationPermissions(): Promise<PermissionCheckResult[]> {
  console.log('\n  Triggering Automation permissions for common apps...');
  console.log('  Multiple permission popups may appear. Click "Allow" on each.\n');

  const results: PermissionCheckResult[] = [];
  for (const app of TCC_TARGET_APPS) {
    process.stdout.write(`  ${app.name}... `);
    try {
      await execFileAsync('osascript', ['-e', app.script], { timeout: 15_000 });
      console.log('ok');
      results.push({ name: app.name, granted: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not allowed') || msg.includes('1743') || msg.includes('not permitted')) {
        console.log('denied (click Allow if popup appeared)');
        results.push({ name: app.name, granted: false, error: 'Permission denied' });
      } else {
        // App not running or other non-permission error — treat as ok
        console.log('ok (app not running)');
        results.push({ name: app.name, granted: true });
      }
    }
  }

  const denied = results.filter(r => !r.granted);
  if (denied.length === 0) {
    console.log('\n  All Automation permissions granted!');
  } else {
    console.log(`\n  ${denied.length} app(s) need permission. Re-run or add manually in System Settings.`);
  }

  return results;
}

/**
 * Detects permission-related errors in Claude CLI output or tool execution errors.
 * Returns a user-friendly message if a permission issue is detected.
 */
export function detectPermissionError(errorMessage: string): string | null {
  const patterns: Array<{ pattern: RegExp; permission: string; setting: string }> = [
    {
      pattern: /not allowed assistive|accessibility/i,
      permission: 'Accessibility',
      setting: 'Privacy & Security > Accessibility',
    },
    {
      pattern: /screen recording|screen capture.*not permitted/i,
      permission: 'Screen Recording',
      setting: 'Privacy & Security > Screen Recording',
    },
    {
      pattern: /not allowed to send keystrokes|1743.*System Events/i,
      permission: 'Automation',
      setting: 'Privacy & Security > Automation',
    },
    {
      pattern: /operation not permitted|EPERM/i,
      permission: 'Full Disk Access',
      setting: 'Privacy & Security > Full Disk Access',
    },
    {
      pattern: /camera.*denied|AVFoundation.*camera/i,
      permission: 'Camera',
      setting: 'Privacy & Security > Camera',
    },
    {
      pattern: /microphone.*denied|AVFoundation.*microphone/i,
      permission: 'Microphone',
      setting: 'Privacy & Security > Microphone',
    },
    {
      pattern: /access.*contacts.*denied|CNContactStore/i,
      permission: 'Contacts',
      setting: 'Privacy & Security > Contacts',
    },
    {
      pattern: /access.*calendar.*denied|EKEventStore/i,
      permission: 'Calendar',
      setting: 'Privacy & Security > Calendars',
    },
    {
      pattern: /would like to access data from other apps/i,
      permission: 'Automation / Cross-app data',
      setting: 'Privacy & Security > Automation',
    },
  ];

  for (const { pattern, permission, setting } of patterns) {
    if (pattern.test(errorMessage)) {
      return `macOS ${permission} permission required. Open System Settings > ${setting} and add "node" or your terminal app. Then restart pilot-ai.`;
    }
  }

  return null;
}
