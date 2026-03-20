/**
 * CLI commands: pilot-ai auth google / pilot-ai auth figma
 */
import { exec } from 'node:child_process';
import { loadConfig } from '../config/store.js';
import { getSecret } from '../config/keychain.js';
import {
  configureGoogle,
  getGoogleAuthUrl,
  exchangeGoogleCode,
  deleteGoogleTokens,
  loadGoogleTokens,
  writeGmailMcpCredentials,
  writeGoogleMcpTokens,
  type GoogleOAuthConfig,
  GOOGLE_SCOPES,
} from '../tools/google-auth.js';
import { startOAuthCallbackServer } from '../utils/oauth-callback-server.js';
import { checkClaudeCodeSync, syncToClaudeCode } from '../config/claude-code-sync.js';
import { loadMcpConfig, saveMcpConfig } from '../tools/figma-mcp.js';

/**
 * Run the Google OAuth authentication flow.
 */
export async function runAuthGoogle(options: {
  services?: string;
  revoke?: boolean;
}): Promise<void> {
  // Handle --revoke
  if (options.revoke) {
    await deleteGoogleTokens();
    console.log('  Google OAuth tokens revoked.\n');
    return;
  }

  // Load config and credentials
  const clientId = await getSecret('google-client-id');
  const clientSecret = await getSecret('google-client-secret');

  if (!clientId || !clientSecret) {
    console.error('  Error: Google credentials not found.');
    console.error('  Run "pilot-ai init" first to set up Google OAuth credentials.\n');
    process.exit(1);
  }

  // Determine services
  let services: Array<keyof typeof GOOGLE_SCOPES>;
  if (options.services) {
    services = options.services.split(',').map((s) => s.trim()) as Array<keyof typeof GOOGLE_SCOPES>;
  } else {
    try {
      const config = await loadConfig();
      services = (config.google?.services as Array<keyof typeof GOOGLE_SCOPES>) ?? ['gmail', 'calendar', 'drive'];
    } catch {
      services = ['gmail', 'calendar', 'drive'];
    }
  }

  // Configure the Google OAuth module
  configureGoogle({ clientId, clientSecret } as GoogleOAuthConfig);

  // Start loopback callback server
  console.log('\n  Starting OAuth callback server...');
  const server = await startOAuthCallbackServer();

  try {
    // Generate auth URL with PKCE and state
    const { url: authUrl, codeVerifier, state: expectedState } = getGoogleAuthUrl(services, server.redirectUri);

    // Open browser
    console.log('  Opening browser for Google sign-in...');
    console.log(`  (If the browser doesn't open, visit: ${authUrl})\n`);
    exec(`open "${authUrl}"`);

    // Wait for callback
    console.log('  Waiting for authorization...');
    const { code, state: returnedState } = await server.waitForCode();
    if (returnedState !== expectedState) {
      throw new Error('OAuth state mismatch — possible CSRF attack. Please try again.');
    }

    // Exchange code for tokens
    console.log('  Exchanging authorization code for tokens...');
    const newTokens = await exchangeGoogleCode(code, services, server.redirectUri, codeVerifier);

    // Sync Gmail MCP credentials if gmail is in the services
    if (services.includes('gmail')) {
      await syncGmailMcpTokens(clientId, clientSecret, newTokens);
    }

    // Sync tokens to Calendar/Drive MCP servers
    await writeGoogleMcpTokens(newTokens);
    console.log('  Google MCP tokens synced to Calendar/Drive MCP servers.');

    console.log(`\n  Google authenticated! (${services.join(', ')})\n`);

    // Check if the user has published the app and remind if not
    console.log('  ────────────────────────────────────────────────────────');
    console.log('  ⚠ Did you publish your OAuth app to Production?');
    console.log('');
    console.log('  If your app is still in "Testing" mode:');
    console.log('    • Refresh tokens expire after 7 days');
    console.log('    • ALL Google integrations (Gmail, Calendar, Drive) will stop working');
    console.log('    • You\'ll see automatic Google login popups every time Claude Code starts');
    console.log('');
    console.log('  → Fix: https://console.cloud.google.com/apis/credentials/consent');
    console.log('    Click "PUBLISH APP" — no Google review needed for personal use (<100 users).');
    console.log('  ────────────────────────────────────────────────────────\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  Authentication failed: ${msg}`);
    console.error('  Please try again with "pilot-ai auth google".\n');
    process.exit(1);
  } finally {
    server.close();
  }
}

/**
 * Sync Gmail MCP credentials after re-authentication.
 * Updates ~/.gmail-mcp/ files, mcp-config.json, and Claude Code registration.
 */
async function syncGmailMcpTokens(
  clientId: string,
  clientSecret: string,
  tokens: import('../tools/google-auth.js').GoogleTokens,
): Promise<void> {
  try {
    // 1. Update ~/.gmail-mcp/ credential files
    await writeGmailMcpCredentials(clientId, clientSecret, tokens);
    console.log('  Gmail MCP credential files updated (~/.gmail-mcp/)');

    // 2. Update mcp-config.json REFRESH_TOKEN
    const mcpConfig = await loadMcpConfig();
    const gmailServer = mcpConfig.mcpServers['gmail'];
    if (gmailServer?.env) {
      gmailServer.env['REFRESH_TOKEN'] = tokens.refreshToken;
      gmailServer.env['CLIENT_ID'] = clientId;
      gmailServer.env['CLIENT_SECRET'] = clientSecret;
      await saveMcpConfig(mcpConfig);

      // 3. Re-register in Claude Code
      const syncResult = await syncToClaudeCode('gmail', gmailServer);
      if (syncResult.success) {
        console.log('  Gmail MCP server re-synced to Claude Code');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  Note: Gmail MCP sync skipped (${msg})`);
  }
}

/**
 * Show Figma PAT authentication guide and check registration status.
 */
export async function runAuthFigma(): Promise<void> {
  console.log('\n  Figma Personal Access Token Guide\n');
  console.log('  1. Go to https://www.figma.com/settings');
  console.log('  2. Scroll to "Personal access tokens"');
  console.log('  3. Click "Generate new token"');
  console.log('  4. Give it a name (e.g. "Pilot-AI") and copy the token');
  console.log('  5. Token starts with figd_\n');
  console.log('  To reconfigure, run: pilot-ai init (select Figma)\n');

  const synced = await checkClaudeCodeSync('figma');
  if (synced) {
    console.log('  ✓ Figma MCP server is registered in Claude Code.\n');
  } else {
    console.log('  ✗ Figma MCP server is NOT registered.');
    console.log('  Run: pilot-ai init (select Figma) or: pilot-ai addtool figma\n');
  }
}
