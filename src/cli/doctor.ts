import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { accessSync, constants as fsConstants } from 'node:fs';
import { checkClaudeCli, checkClaudeCliAuth } from '../agent/claude.js';
import { isGhAuthenticated } from '../tools/github.js';
import { getSecret } from '../config/keychain.js';
import { checkAllMcpServerStatus } from '../agent/mcp-manager.js';
import { loadMcpConfig } from '../tools/figma-mcp.js';
import { checkClaudeCodeSync } from '../config/claude-code-sync.js';
import { loadConfig } from '../config/store.js';
import { getRegistryEntry } from '../tools/mcp-registry.js';

const execFileAsync = promisify(execFile);

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export async function runDoctor(): Promise<void> {
  console.log('\n── Pilot-AI Doctor ──\n');

  const results: CheckResult[] = [];

  // Run all checks
  results.push(await checkNode());
  results.push(await checkClaudeCliStatus());
  results.push(await checkGhCli());
  results.push(await checkPlaywright());
  results.push(await checkGoogleOAuth());
  results.push(await checkAutomationPermission());
  results.push(await checkScreenRecordingPermission());
  results.push(await checkAccessibilityPermission());
  results.push(await checkFullDiskAccessPermission());

  // Print results
  console.log('\n  Results:\n');
  for (const r of results) {
    const icon = r.ok ? '  [ok]' : '  [!!]';
    console.log(`${icon} ${r.name}: ${r.detail}`);
    if (!r.ok && r.fix) {
      console.log(`       Fix: ${r.fix}`);
    }
  }

  // 3-layer MCP consistency check
  await runMcpDiagnosis();

  const failed = results.filter(r => !r.ok);
  if (failed.length === 0) {
    console.log('\n  All checks passed!\n');
  } else {
    console.log(`\n  ${failed.length} issue(s) found. Follow the fix instructions above.\n`);

    // Node binary path for permission settings
    try {
      const { stdout } = await execFileAsync('which', ['node']);
      console.log(`  Tip: Your node binary is at: ${stdout.trim()}`);
      console.log('  Use this path when adding "node" to System Settings permissions.\n');
    } catch {
      // ignore
    }

    // TCC reset hint
    console.log('  If you previously clicked "Don\'t Allow" on a permission popup:');
    console.log('    tccutil reset AppleEvents    # Reset all Automation permissions');
    console.log('    npx pilot-ai init            # Re-run setup to re-trigger popups\n');
  }
}

async function checkNode(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync('node', ['--version']);
    const version = stdout.trim();
    return { name: 'Node.js', ok: true, detail: version };
  } catch {
    return { name: 'Node.js', ok: false, detail: 'not found', fix: 'Install Node.js from https://nodejs.org' };
  }
}

async function checkClaudeCliStatus(): Promise<CheckResult> {
  const installed = await checkClaudeCli();
  if (!installed) {
    return {
      name: 'Claude CLI',
      ok: false,
      detail: 'not installed',
      fix: 'npm install -g @anthropic-ai/claude-code',
    };
  }
  const authed = await checkClaudeCliAuth();
  if (!authed) {
    return {
      name: 'Claude CLI',
      ok: false,
      detail: 'installed but not authenticated',
      fix: 'Run "claude" in terminal to log in',
    };
  }
  return { name: 'Claude CLI', ok: true, detail: 'installed and authenticated' };
}

async function checkGhCli(): Promise<CheckResult> {
  try {
    await execFileAsync('which', ['gh']);
  } catch {
    return {
      name: 'GitHub CLI (gh)',
      ok: false,
      detail: 'not installed',
      fix: 'brew install gh',
    };
  }
  const authed = await isGhAuthenticated();
  if (!authed) {
    return {
      name: 'GitHub CLI (gh)',
      ok: false,
      detail: 'installed but not authenticated',
      fix: 'gh auth login --scopes repo,read:org,workflow',
    };
  }
  return { name: 'GitHub CLI (gh)', ok: true, detail: 'installed and authenticated' };
}

async function checkGoogleOAuth(): Promise<CheckResult> {
  const clientId = await getSecret('google-client-id');
  const clientSecret = await getSecret('google-client-secret');

  if (!clientId || !clientSecret) {
    return {
      name: 'Google OAuth',
      ok: false,
      detail: 'credentials not configured',
      fix: 'Run "pilot-ai init" or "pilot-ai addtool google-oauth" to set up Google OAuth',
    };
  }

  const tokensRaw = await getSecret('google-oauth-tokens');
  if (!tokensRaw) {
    return {
      name: 'Google OAuth',
      ok: false,
      detail: 'credentials set but not authenticated',
      fix: 'Run "pilot-ai auth google" to complete OAuth sign-in',
    };
  }

  try {
    const tokens = JSON.parse(tokensRaw) as { expiresAt?: number };
    if (tokens.expiresAt && tokens.expiresAt < Date.now()) {
      return {
        name: 'Google OAuth',
        ok: true,
        detail: 'authenticated (token expired, will auto-refresh)',
      };
    }
    return { name: 'Google OAuth', ok: true, detail: 'authenticated' };
  } catch {
    return {
      name: 'Google OAuth',
      ok: false,
      detail: 'corrupted token data',
      fix: 'Run "pilot-ai auth google" to re-authenticate',
    };
  }
}

async function checkPlaywright(): Promise<CheckResult> {
  try {
    await execFileAsync('npx', ['playwright', '--version'], { timeout: 15_000 });
    return { name: 'Playwright', ok: true, detail: 'installed' };
  } catch {
    return {
      name: 'Playwright',
      ok: false,
      detail: 'not installed',
      fix: 'npx playwright install chromium',
    };
  }
}

async function checkAutomationPermission(): Promise<CheckResult> {
  try {
    await execFileAsync('osascript', [
      '-e', 'tell application "System Events" to get name of first process',
    ], { timeout: 10_000 });
    return { name: 'Automation (AppleEvents)', ok: true, detail: 'granted' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not allowed') || msg.includes('1743') || msg.includes('not permitted')) {
      return {
        name: 'Automation (AppleEvents)',
        ok: false,
        detail: 'denied',
        fix: 'System Settings > Privacy & Security > Automation — add your terminal or node',
      };
    }
    return { name: 'Automation (AppleEvents)', ok: true, detail: 'granted' };
  }
}

async function checkScreenRecordingPermission(): Promise<CheckResult> {
  try {
    await execFileAsync('screencapture', ['-x', '-t', 'png', '/tmp/pilot-ai-doctor.png'], {
      timeout: 10_000,
    });
    const { stdout } = await execFileAsync('wc', ['-c', '/tmp/pilot-ai-doctor.png']);
    const size = parseInt(stdout.trim().split(/\s+/)[0], 10);
    await execFileAsync('rm', ['-f', '/tmp/pilot-ai-doctor.png']);
    if (size > 100) {
      return { name: 'Screen Recording', ok: true, detail: 'granted' };
    }
    return {
      name: 'Screen Recording',
      ok: false,
      detail: 'denied',
      fix: 'System Settings > Privacy & Security > Screen Recording — add your terminal or node',
    };
  } catch {
    return {
      name: 'Screen Recording',
      ok: false,
      detail: 'unable to verify',
      fix: 'System Settings > Privacy & Security > Screen Recording — add your terminal or node',
    };
  }
}

async function checkAccessibilityPermission(): Promise<CheckResult> {
  try {
    await execFileAsync('osascript', [
      '-e', 'tell application "System Events" to keystroke ""',
    ], { timeout: 10_000 });
    return { name: 'Accessibility', ok: true, detail: 'granted' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not allowed') || msg.includes('1743') || msg.includes('assistive')) {
      return {
        name: 'Accessibility',
        ok: false,
        detail: 'denied',
        fix: 'System Settings > Privacy & Security > Accessibility — add your terminal or node',
      };
    }
    return { name: 'Accessibility', ok: true, detail: 'granted' };
  }
}

function checkFullDiskAccessPermission(): CheckResult {
  try {
    accessSync(`${process.env.HOME}/Library/Mail`, fsConstants.R_OK);
    return { name: 'Full Disk Access', ok: true, detail: 'granted' };
  } catch {
    return {
      name: 'Full Disk Access',
      ok: false,
      detail: 'not granted (optional)',
      fix: 'System Settings > Privacy & Security > Full Disk Access — add node binary. This resolves most "access data from other apps" popups.',
    };
  }
}

/**
 * 3-layer MCP consistency diagnosis:
 * 1. config.json — configured integrations
 * 2. mcp-config.json — registered MCP servers
 * 3. Keychain — stored credentials
 * + Claude Code sync status
 */
async function runMcpDiagnosis(): Promise<void> {
  console.log('\n── MCP Integration Diagnosis ──\n');

  // Layer 1: config.json integrations
  let configuredIntegrations: string[] = [];
  try {
    const config = await loadConfig();
    if (config.google) configuredIntegrations.push('google');
    if (config.github?.enabled) configuredIntegrations.push('github');
  } catch {
    console.log('  [!!] Could not load config.json');
    return;
  }

  // Layer 2: mcp-config.json registered servers
  const mcpConfig = await loadMcpConfig();
  const registeredServers = Object.keys(mcpConfig.mcpServers);

  // Layer 3: Keychain credential status
  const statuses = await checkAllMcpServerStatus();

  if (registeredServers.length === 0) {
    console.log('  No MCP servers registered. Run "pilot-ai addtool <name>" to add tools.\n');
    return;
  }

  // Print per-server status table
  console.log('  Server              Status          Claude Code');
  console.log('  ─────────────────── ─────────────── ───────────');

  for (const serverId of registeredServers) {
    const status = statuses.find(s => s.serverId === serverId);
    const statusStr = status?.status ?? 'unknown';
    const claudeSynced = await checkClaudeCodeSync(serverId);
    const syncStr = claudeSynced ? 'synced' : 'not synced';

    const name = getRegistryEntry(serverId)?.name ?? serverId;
    const displayName = `${name}`.padEnd(19);
    const displayStatus = statusStr.padEnd(15);

    const icon = statusStr === 'ready' && claudeSynced ? '  [ok]' : '  [!!]';
    console.log(`${icon} ${displayName} ${displayStatus} ${syncStr}`);
  }

  // Recommendations
  const recommendations: string[] = [];

  const authRequired = statuses.filter(s => s.status === 'auth_required');
  if (authRequired.length > 0) {
    for (const s of authRequired) {
      recommendations.push(`Run "pilot-ai addtool ${s.serverId}" to re-authenticate ${s.serverId}`);
    }
  }

  const notSynced: string[] = [];
  for (const serverId of registeredServers) {
    const synced = await checkClaudeCodeSync(serverId);
    if (!synced) notSynced.push(serverId);
  }
  if (notSynced.length > 0) {
    recommendations.push(`Run "pilot-ai sync-mcp" to sync ${notSynced.join(', ')} to Claude Code`);
  }

  // Check config.json ↔ mcp-config.json consistency
  if (configuredIntegrations.includes('google')) {
    const googleServers = ['gmail', 'google-calendar', 'google-drive'];
    const hasAnyGoogle = googleServers.some(id => registeredServers.includes(id));
    if (!hasAnyGoogle) {
      recommendations.push('Google OAuth is configured but no Google MCP servers registered. Run "pilot-ai addtool gmail"');
    }
  }

  if (recommendations.length > 0) {
    console.log('\n  Recommendations:');
    for (const rec of recommendations) {
      console.log(`    → ${rec}`);
    }
  }

  console.log('');
}
