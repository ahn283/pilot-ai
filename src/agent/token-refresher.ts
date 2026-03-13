/**
 * Periodic Google OAuth token health checker.
 * Validates tokens on startup and refreshes them proactively before expiry.
 * Notifies the user via messenger if re-authentication is needed.
 */
import {
  loadGoogleTokens,
  getGoogleAccessToken,
  verifyGoogleTokens,
  writeGmailMcpCredentials,
  writeGoogleMcpTokens,
  configureGoogle,
  getGoogleConfig,
  type GoogleTokens,
} from '../tools/google-auth.js';
import { loadMcpConfig, saveMcpConfig } from '../tools/figma-mcp.js';
import { syncToClaudeCode } from '../config/claude-code-sync.js';
import { getSecret } from '../config/keychain.js';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const EXPIRY_WARNING_MS = 2 * 60 * 60 * 1000; // Warn 2 hours before expiry

export interface TokenRefresherNotifier {
  sendText(channelId: string, text: string): Promise<string>;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let notifier: TokenRefresherNotifier | null = null;
let notifyChannelId: string | null = null;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [token-refresher] ${message}`);
}

/**
 * Checks Google token validity and proactively refreshes if needed.
 * Returns a status object describing the result.
 */
export async function checkGoogleTokenHealth(): Promise<{
  status: 'healthy' | 'refreshed' | 'expired' | 'not_configured';
  message: string;
}> {
  const tokens = await loadGoogleTokens();
  if (!tokens) {
    return { status: 'not_configured', message: 'No Google tokens found' };
  }

  const config = getGoogleConfig();
  if (!config) {
    return { status: 'not_configured', message: 'Google OAuth not configured' };
  }

  const now = Date.now();
  const timeUntilExpiry = tokens.expiresAt - now;

  // Token still valid and not close to expiry
  if (timeUntilExpiry > EXPIRY_WARNING_MS) {
    // Quick verify the access token is actually valid
    const valid = await verifyGoogleTokens(tokens.accessToken);
    if (valid) {
      return { status: 'healthy', message: 'Google tokens are valid' };
    }
    // Token reported valid by time but failed verification — try refresh
  }

  // Token expired or close to expiry — attempt refresh
  try {
    const newAccessToken = await getGoogleAccessToken();

    // Sync refreshed tokens to Gmail MCP files
    const updatedTokens = await loadGoogleTokens();
    if (updatedTokens) {
      await syncRefreshedTokensToMcp(config.clientId, config.clientSecret, updatedTokens);
    }

    log(`Token refreshed successfully (new expiry: ${new Date(updatedTokens?.expiresAt ?? 0).toISOString()})`);
    return { status: 'refreshed', message: 'Google tokens refreshed successfully' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Token refresh failed: ${msg}`);
    return {
      status: 'expired',
      message: `Google token refresh failed: ${msg}`,
    };
  }
}

/**
 * Syncs refreshed tokens to Gmail MCP credential files and mcp-config.json.
 */
async function syncRefreshedTokensToMcp(
  clientId: string,
  clientSecret: string,
  tokens: GoogleTokens,
): Promise<void> {
  // Guard: only sync when we have a complete token set
  if (!tokens.accessToken || !tokens.refreshToken) {
    log('Skipping MCP sync: incomplete token set');
    return;
  }

  try {
    // Update ~/.gmail-mcp/ files
    await writeGmailMcpCredentials(clientId, clientSecret, tokens);

    // Update Calendar/Drive MCP token files
    await writeGoogleMcpTokens(tokens);

    // Update mcp-config.json
    const mcpConfig = await loadMcpConfig();
    const gmailServer = mcpConfig.mcpServers['gmail'];
    if (gmailServer?.env) {
      gmailServer.env['REFRESH_TOKEN'] = tokens.refreshToken;
      await saveMcpConfig(mcpConfig);

      // Re-sync to Claude Code
      await syncToClaudeCode('gmail', gmailServer).catch(() => {});
    }
  } catch {
    // Non-critical — log but don't fail
    log('Failed to sync refreshed tokens to MCP');
  }
}

/**
 * Runs a single health check cycle and notifies if action is needed.
 */
async function runHealthCheck(): Promise<void> {
  const result = await checkGoogleTokenHealth();

  switch (result.status) {
    case 'healthy':
      log('Health check: tokens OK');
      break;
    case 'refreshed':
      log('Health check: tokens refreshed');
      break;
    case 'expired':
      log(`Health check: ${result.message}`);
      if (notifier && notifyChannelId) {
        await notifier.sendText(
          notifyChannelId,
          `\u26a0\ufe0f Google OAuth token expired. Run \`pilot-ai auth google\` to re-authenticate.`,
        ).catch(() => {});
      }
      // Stop refresher to prevent repeated failed attempts
      stopTokenRefresher();
      break;
    case 'not_configured':
      log('Health check: Google not configured on this device. Stopping refresher.');
      stopTokenRefresher();
      break;
  }
}

/**
 * Starts the periodic token health checker.
 */
export function startTokenRefresher(
  messenger?: TokenRefresherNotifier,
  channelId?: string,
): void {
  if (intervalHandle) return;

  if (messenger && channelId) {
    notifier = messenger;
    notifyChannelId = channelId;
  }

  // Run immediately on startup
  runHealthCheck().catch(() => {});

  // Then check every hour
  intervalHandle = setInterval(() => {
    runHealthCheck().catch(() => {});
  }, CHECK_INTERVAL_MS);

  log('Token refresher started (interval: 1h)');
}

/**
 * Stops the periodic token health checker.
 */
export function stopTokenRefresher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    notifier = null;
    notifyChannelId = null;
    log('Token refresher stopped');
  }
}

export function isTokenRefresherRunning(): boolean {
  return intervalHandle !== null;
}
