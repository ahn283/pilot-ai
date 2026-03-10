/**
 * Gmail integration via Google APIs OAuth2.
 * Uses googleapis npm package for Gmail API access.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';
import { getSecret, setSecret, deleteSecret } from '../config/keychain.js';

export interface EmailConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  body?: string;
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  cc?: string;
}

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const KEYCHAIN_KEY = 'gmail-oauth-tokens';

function getLegacyTokenPath(): string {
  return path.join(getPilotDir(), 'gmail-tokens.json');
}

let config: EmailConfig | null = null;
let tokens: OAuthTokens | null = null;

export function configureEmail(cfg: EmailConfig): void {
  config = cfg;
}

// --- Token management ---

export async function loadTokens(): Promise<OAuthTokens | null> {
  // Try Keychain first
  const secret = await getSecret(KEYCHAIN_KEY);
  if (secret) {
    try {
      tokens = JSON.parse(secret) as OAuthTokens;
      return tokens;
    } catch {
      // Corrupted keychain entry, fall through to legacy
    }
  }

  // Try legacy JSON file and migrate if found
  try {
    const data = await fs.readFile(getLegacyTokenPath(), 'utf-8');
    const parsed = JSON.parse(data) as OAuthTokens;
    // Migrate to Keychain
    await saveTokens(parsed);
    // Remove legacy file
    await fs.unlink(getLegacyTokenPath()).catch(() => {});
    return tokens;
  } catch {
    return null;
  }
}

export async function saveTokens(t: OAuthTokens): Promise<void> {
  tokens = t;
  await setSecret(KEYCHAIN_KEY, JSON.stringify(t));
}

export async function deleteTokens(): Promise<void> {
  tokens = null;
  await deleteSecret(KEYCHAIN_KEY);
}

/**
 * Returns the OAuth2 authorization URL for user consent.
 */
export function getAuthUrl(redirectUri: string): string {
  if (!config) throw new Error('Email not configured');
  const scopes = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose';
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
}

/**
 * Exchanges authorization code for tokens.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
  if (!config) throw new Error('Email not configured');
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

  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; error?: string };
  if (data.error) throw new Error(`OAuth error: ${data.error}`);

  const t: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await saveTokens(t);
  return t;
}

/**
 * Refreshes the access token if expired.
 */
export async function refreshAccessToken(): Promise<string> {
  if (!config) throw new Error('Email not configured');
  if (!tokens) {
    const loaded = await loadTokens();
    if (!loaded) throw new Error('No Gmail tokens. Run OAuth flow first.');
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

  const data = (await res.json()) as { access_token: string; expires_in: number; error?: string };
  if (data.error) throw new Error(`Token refresh failed: ${data.error}`);

  tokens.accessToken = data.access_token;
  tokens.expiresAt = Date.now() + data.expires_in * 1000;
  await saveTokens(tokens);
  return tokens.accessToken;
}

async function gmailFetch<T>(path: string): Promise<T> {
  const token = await refreshAccessToken();
  const res = await fetch(`${GMAIL_API}/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json() as Promise<T>;
}

// --- Email operations ---

export async function listMessages(query?: string, maxResults: number = 10): Promise<EmailMessage[]> {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set('q', query);

  const data = await gmailFetch<{ messages?: Array<{ id: string; threadId: string }> }>(
    `/messages?${params}`,
  );

  if (!data.messages) return [];

  const messages: EmailMessage[] = [];
  for (const msg of data.messages.slice(0, maxResults)) {
    const detail = await getMessage(msg.id);
    if (detail) messages.push(detail);
  }
  return messages;
}

export async function getMessage(messageId: string): Promise<EmailMessage | null> {
  const data = await gmailFetch<{
    id: string;
    threadId: string;
    snippet: string;
    payload: {
      headers: Array<{ name: string; value: string }>;
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body?: { data?: string } }>;
    };
  }>(`/messages/${messageId}`);

  const headers = data.payload.headers;
  const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  let body = '';
  if (data.payload.body?.data) {
    body = Buffer.from(data.payload.body.data, 'base64url').toString('utf-8');
  } else if (data.payload.parts) {
    const textPart = data.payload.parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
    }
  }

  return {
    id: data.id,
    threadId: data.threadId,
    from: getHeader('From'),
    to: getHeader('To'),
    subject: getHeader('Subject'),
    snippet: data.snippet,
    date: getHeader('Date'),
    body,
  };
}

/**
 * Sends an email. This is a DANGEROUS action.
 */
export async function sendEmail(draft: EmailDraft): Promise<string> {
  const lines = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    draft.body,
  ];
  if (draft.cc) lines.splice(1, 0, `Cc: ${draft.cc}`);

  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

  const token = await refreshAccessToken();
  const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) throw new Error(`Failed to send email: ${res.status}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Creates a draft without sending.
 */
export async function createDraft(draft: EmailDraft): Promise<string> {
  const lines = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    draft.body,
  ];
  if (draft.cc) lines.splice(1, 0, `Cc: ${draft.cc}`);

  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

  const token = await refreshAccessToken();
  const res = await fetch(`${GMAIL_API}/users/me/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!res.ok) throw new Error(`Failed to create draft: ${res.status}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}
