/**
 * Gmail integration via Google APIs.
 * Uses shared Google OAuth module (google-auth.ts) for authentication.
 */
import { getGoogleAccessToken } from './google-auth.js';

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

async function gmailFetch<T>(path: string): Promise<T> {
  const token = await getGoogleAccessToken();
  const res = await fetch(`${GMAIL_API}/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Gmail API authentication failed (401). Token may be expired. Run "pilot-ai auth google" to re-authenticate.');
    }
    throw new Error(`Gmail API error: ${res.status}`);
  }
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

  const token = await getGoogleAccessToken();
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

  const token = await getGoogleAccessToken();
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
