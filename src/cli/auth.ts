/**
 * CLI command: pilot-ai auth google
 * Runs the OAuth2 loopback flow to obtain Google access tokens.
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
