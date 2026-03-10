/**
 * Shared Google OAuth2 module for Gmail, Google Calendar, and Google Drive.
 * Manages a single set of OAuth2 tokens with combined scopes.
 */
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
  config = cfg;
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
 * Returns the OAuth2 authorization URL for user consent.
 * Requests all enabled scopes at once.
 *
 * @param services - Google services to request scopes for
 * @param redirectUri - Loopback redirect URI (e.g. http://127.0.0.1:PORT/callback)
 */
export function getGoogleAuthUrl(
  services: Array<keyof typeof GOOGLE_SCOPES>,
  redirectUri: string,
): string {
  if (!config) throw new Error('Google OAuth not configured. Run "pilot-ai init" first.');
  const scopes = services.flatMap((s) => GOOGLE_SCOPES[s]).join(' ');
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
}

/**
 * Exchanges authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @param services - Google services to store scopes for
 * @param redirectUri - Must match the redirect URI used in getGoogleAuthUrl
 */
export async function exchangeGoogleCode(
  code: string,
  services: Array<keyof typeof GOOGLE_SCOPES>,
  redirectUri: string,
): Promise<GoogleTokens> {
  if (!config) throw new Error('Google OAuth not configured');
  const redirect = redirectUri;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
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
        'Google token has been revoked or expired. Tokens cleared. Run "pilot-ai auth google" to re-authenticate.',
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
