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
  type GoogleOAuthConfig,
  GOOGLE_SCOPES,
} from '../tools/google-auth.js';
import { startOAuthCallbackServer } from '../utils/oauth-callback-server.js';
import { checkClaudeCodeSync } from '../config/claude-code-sync.js';

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
    // Generate auth URL
    const authUrl = getGoogleAuthUrl(services, server.redirectUri);

    // Open browser
    console.log('  Opening browser for Google sign-in...');
    console.log(`  (If the browser doesn't open, visit: ${authUrl})\n`);
    exec(`open "${authUrl}"`);

    // Wait for callback
    console.log('  Waiting for authorization...');
    const { code } = await server.waitForCode();

    // Exchange code for tokens
    console.log('  Exchanging authorization code for tokens...');
    await exchangeGoogleCode(code, services, server.redirectUri);

    console.log(`\n  Google authenticated! (${services.join(', ')})\n`);
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
 * Show Figma OAuth authentication guide and check registration status.
 */
export async function runAuthFigma(): Promise<void> {
  console.log('\n  Figma OAuth Authentication Guide\n');
  console.log('  Figma uses OAuth via the official Remote MCP server.');
  console.log('  Authentication must be completed in an interactive Claude Code session.\n');
  console.log('  Steps:');
  console.log('  1. Open Claude Code (run: claude)');
  console.log('  2. Type: /mcp');
  console.log('  3. Select "figma" server');
  console.log('  4. Click "Authenticate" in the browser');
  console.log('  5. Allow access to your Figma account\n');

  const synced = await checkClaudeCodeSync('figma');
  if (synced) {
    console.log('  ✓ Figma MCP server is registered in Claude Code.');
    console.log('  If tools are not working, re-authenticate via /mcp in Claude Code.\n');
  } else {
    console.log('  ✗ Figma MCP server is NOT registered.');
    console.log('  Run: pilot-ai init (select Figma) or:');
    console.log('  claude mcp add --transport http -s user figma https://mcp.figma.com/mcp\n');
  }
}
