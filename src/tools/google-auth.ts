/**
 * Shared Google OAuth2 module for Gmail, Google Calendar, and Google Drive.
 * Manages a single set of OAuth2 tokens with combined scopes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';
import { getSecret, setSecret, deleteSecret } from '../config/keychain.js';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Removes invisible Unicode characters that can be introduced by copy-paste.
 */
function sanitizeCredential(value: string): string {
  return value.trim().replace(/[\u200B\u200C\u200D\uFEFF\u00A0\u2028\u2029]/g, '');
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export interface GoogleAuthUrlResult {
  url: string;
  codeVerifier: string;
  state: string;
}

export const GOOGLE_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  drive: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ],
};

const KEYCHAIN_KEY = 'google-oauth-tokens';
const LEGACY_GMAIL_KEY = 'gmail-oauth-tokens';

function getLegacyTokenPath(): string {
  return path.join(getPilotDir(), 'credentials', 'google-tokens.json');
}

let config: GoogleOAuthConfig | null = null;
let tokens: GoogleTokens | null = null;

export function configureGoogle(cfg: GoogleOAuthConfig): void {
  config = {
    ...cfg,
    clientId: sanitizeCredential(cfg.clientId),
    clientSecret: sanitizeCredential(cfg.clientSecret),
  };
}

export function getGoogleConfig(): GoogleOAuthConfig | null {
  return config;
}

export async function loadGoogleTokens(): Promise<GoogleTokens | null> {
  // Try Keychain first
  const secret = await getSecret(KEYCHAIN_KEY);
  if (secret) {
    try {
      tokens = JSON.parse(secret) as GoogleTokens;
      return tokens;
    } catch {
      // Corrupted keychain entry, fall through to legacy
    }
  }

  // Try legacy gmail-oauth-tokens key and migrate if found
  const legacyGmailSecret = await getSecret(LEGACY_GMAIL_KEY);
  if (legacyGmailSecret) {
    try {
      const parsed = JSON.parse(legacyGmailSecret) as GoogleTokens;
      // Ensure scopes field exists (legacy tokens may not have it)
      if (!parsed.scopes) {
        parsed.scopes = GOOGLE_SCOPES.gmail;
      }
      await saveGoogleTokens(parsed);
      // Remove legacy key
      await deleteSecret(LEGACY_GMAIL_KEY).catch(() => {});
      return tokens;
    } catch {
      // Corrupted, fall through
    }
  }

  // Try legacy JSON file and migrate if found
  try {
    const data = await fs.readFile(getLegacyTokenPath(), 'utf-8');
    const parsed = JSON.parse(data) as GoogleTokens;
    // Migrate to Keychain
    await saveGoogleTokens(parsed);
    // Remove legacy file
    await fs.unlink(getLegacyTokenPath()).catch(() => {});
    return tokens;
  } catch {
    return null;
  }
}

export async function saveGoogleTokens(t: GoogleTokens): Promise<void> {
  tokens = t;
  await setSecret(KEYCHAIN_KEY, JSON.stringify(t));
}

export async function deleteGoogleTokens(): Promise<void> {
  tokens = null;
  await deleteSecret(KEYCHAIN_KEY);
}

/**
 * Writes Gmail MCP credential files to ~/.gmail-mcp/ so that
 * @shinzolabs/gmail-mcp can authenticate using file-based mode.
 *
 * Creates two files:
 *  - gcp-oauth.keys.json  (client credentials)
 *  - credentials.json      (access + refresh tokens)
 */
export async function writeGmailMcpCredentials(
  clientId: string,
  clientSecret: string,
  googleTokens: GoogleTokens,
): Promise<void> {
  const os = await import('node:os');
  const gmailMcpDir = path.join(os.default.homedir(), '.gmail-mcp');
  await fs.mkdir(gmailMcpDir, { recursive: true });

  await fs.writeFile(
    path.join(gmailMcpDir, 'gcp-oauth.keys.json'),
    JSON.stringify({
      installed: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: ['http://127.0.0.1'],
      },
    }),
    'utf-8',
  );

  await fs.writeFile(
    path.join(gmailMcpDir, 'credentials.json'),
    JSON.stringify({
      access_token: googleTokens.accessToken,
      refresh_token: googleTokens.refreshToken,
      token_type: 'Bearer',
      expiry_date: googleTokens.expiresAt,
    }),
    'utf-8',
  );
}

/**
 * Writes token files for Google Calendar and Drive MCP servers.
 * These packages store their own tokens at ~/.config/<package>/tokens.json
 * and won't use pilot-ai's Keychain tokens directly.
 */
export async function writeGoogleMcpTokens(
  googleTokens: GoogleTokens,
): Promise<void> {
  const os = await import('node:os');
  const homedir = os.default.homedir();

  const tokenData = {
    access_token: googleTokens.accessToken,
    refresh_token: googleTokens.refreshToken,
    token_type: 'Bearer',
    expiry_date: googleTokens.expiresAt,
    scope: googleTokens.scopes.join(' '),
  };

  const targets = [
    path.join(homedir, '.config', 'google-calendar-mcp'),
    path.join(homedir, '.config', 'google-drive-mcp'),
  ];

  for (const dir of targets) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'tokens.json'),
      JSON.stringify(tokenData, null, 2),
      { mode: 0o600 },
    );
  }
}

/**
 * Returns the OAuth2 authorization URL for user consent with PKCE and state.
 *
 * @param services - Google services to request scopes for
 * @param redirectUri - Loopback redirect URI (e.g. http://127.0.0.1:PORT)
 */
export function getGoogleAuthUrl(
  services: Array<keyof typeof GOOGLE_SCOPES>,
  redirectUri: string,
): GoogleAuthUrlResult {
  if (!config) throw new Error('Google OAuth not configured. Run "pilot-ai init" first.');
  const scopes = services.flatMap((s) => GOOGLE_SCOPES[s]).join(' ');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    codeVerifier,
    state,
  };
}

/**
 * Exchanges authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @param services - Google services to store scopes for
 * @param redirectUri - Must match the redirect URI used in getGoogleAuthUrl
 * @param codeVerifier - PKCE code verifier used when generating the auth URL
 */
export async function exchangeGoogleCode(
  code: string,
  services: Array<keyof typeof GOOGLE_SCOPES>,
  redirectUri: string,
  codeVerifier: string,
): Promise<GoogleTokens> {
  if (!config) throw new Error('Google OAuth not configured');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');

    if (res.status === 400) {
      if (text.includes('redirect_uri_mismatch')) {
        throw new Error(
          'Google OAuth error: redirect_uri_mismatch\n\n' +
          '  The redirect URI does not match what is registered in Google Cloud Console.\n' +
          '  Solutions:\n' +
          '  1. Verify OAuth client type is "Desktop app" (not "Web application")\n' +
          '  2. Or add http://127.0.0.1 to Authorized redirect URIs in Console\n',
        );
      }
      if (text.includes('invalid_client')) {
        throw new Error(
          'Google OAuth error: invalid_client\n\n' +
          '  The Client ID or Client Secret is incorrect.\n' +
          '  Fix: Go to Google Cloud Console → Credentials → Copy correct values\n' +
          '  Then re-run: pilot-ai auth google\n',
        );
      }
      if (text.includes('invalid_grant')) {
        throw new Error(
          'Google OAuth error: invalid_grant\n\n' +
          '  The authorization code has expired or was already used.\n' +
          '  Fix: Re-run "pilot-ai auth google" to get a new code\n',
        );
      }
    }

    throw new Error(`Google OAuth token exchange failed (HTTP ${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    error?: string;
    error_description?: string;
  };
  if (data.error) throw new Error(`Google OAuth error: ${data.error} — ${data.error_description ?? ''}`);

  if (!data.access_token || typeof data.access_token !== 'string' || data.access_token.length < 10) {
    throw new Error(`Google OAuth returned invalid access_token. Response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  if (!data.refresh_token || typeof data.refresh_token !== 'string' || data.refresh_token.length < 10) {
    throw new Error(`Google OAuth returned invalid refresh_token. Ensure access_type=offline and prompt=consent are set.`);
  }
  if (!data.expires_in || typeof data.expires_in !== 'number') {
    throw new Error(`Google OAuth returned invalid expires_in: ${data.expires_in}`);
  }

  const t: GoogleTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: services.flatMap((s) => GOOGLE_SCOPES[s]),
  };
  await saveGoogleTokens(t);
  return t;
}

/**
 * Verifies that a Google access token is valid using the tokeninfo endpoint.
 */
export async function verifyGoogleTokens(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Returns a valid access token, refreshing if expired.
 */
export async function getGoogleAccessToken(): Promise<string> {
  if (!config) throw new Error('Google OAuth not configured');
  if (!tokens) {
    const loaded = await loadGoogleTokens();
    if (!loaded) throw new Error('No Google tokens. Run OAuth flow first.');
    tokens = loaded;
  }

  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens.accessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    let errorBody = '';
    try { errorBody = await res.text(); } catch {}

    // Detect invalid_grant — token revoked or expired permanently
    if (res.status === 400 && errorBody.includes('invalid_grant')) {
      await deleteGoogleTokens();
      throw new Error(
        'Google token has been revoked or expired. Tokens cleared.\n' +
        '  This often happens when the OAuth app is in "Testing" mode (tokens expire after 7 days).\n' +
        '  Run "pilot-ai auth google" to re-authenticate (this will also update Gmail MCP tokens).',
      );
    }

    throw new Error(
      `Google token refresh failed (HTTP ${res.status}). Run "pilot-ai auth google" to re-authenticate.`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    error?: string;
    error_description?: string;
  };
  if (data.error) {
    if (data.error === 'invalid_grant') {
      await deleteGoogleTokens();
      throw new Error(
        'Google token has been revoked or expired. Tokens cleared. Run "pilot-ai auth google" to re-authenticate.',
      );
    }
    throw new Error(
      `Google token refresh failed: ${data.error}. Run "pilot-ai auth google" to re-authenticate.`,
    );
  }

  tokens.accessToken = data.access_token;
  tokens.expiresAt = Date.now() + data.expires_in * 1000;
  await saveGoogleTokens(tokens);
  return tokens.accessToken;
}
