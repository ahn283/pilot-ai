/**
 * Google Drive integration via REST API.
 * Uses shared Google OAuth2 module for authentication.
 */
import { getGoogleAccessToken } from './google-auth.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
}

export interface DriveSearchResult {
  files: DriveFile[];
  nextPageToken?: string;
}

async function driveFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGoogleAccessToken();
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Drive API error (${res.status}): ${err}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Lists files in a folder or root.
 */
export async function listFiles(
  folderId?: string,
  maxResults: number = 20,
): Promise<DriveFile[]> {
  const q = folderId
    ? `'${folderId}' in parents and trashed=false`
    : `'root' in parents and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize: String(maxResults),
    fields: 'files(id,name,mimeType,size,modifiedTime,parents,webViewLink)',
    orderBy: 'modifiedTime desc',
  });

  const data = await driveFetch<DriveSearchResult>(`/files?${params}`);
  return data.files ?? [];
}

/**
 * Searches for files by name or content.
 */
export async function searchFiles(
  query: string,
  maxResults: number = 20,
): Promise<DriveFile[]> {
  const q = `name contains '${query.replace(/'/g, "\\'")}' and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize: String(maxResults),
    fields: 'files(id,name,mimeType,size,modifiedTime,parents,webViewLink)',
    orderBy: 'modifiedTime desc',
  });

  const data = await driveFetch<DriveSearchResult>(`/files?${params}`);
  return data.files ?? [];
}

/**
 * Gets file metadata.
 */
export async function getFile(fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,size,modifiedTime,parents,webViewLink',
  });
  return driveFetch<DriveFile>(`/files/${fileId}?${params}`);
}

/**
 * Downloads file content as text. Works for Google Docs (exported as plain text),
 * or regular files.
 */
export async function downloadFileContent(fileId: string, mimeType?: string): Promise<string> {
  const token = await getGoogleAccessToken();

  // Google Docs/Sheets/Slides need export
  const googleDocTypes: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
  };

  const exportMime = mimeType ? googleDocTypes[mimeType] : undefined;
  const url = exportMime
    ? `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `${DRIVE_API}/files/${fileId}?alt=media`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive download error: ${res.status}`);
  return res.text();
}

/**
 * Creates a new file in Google Drive.
 */
export async function createFile(
  name: string,
  content: string,
  mimeType: string = 'text/plain',
  folderId?: string,
): Promise<DriveFile> {
  const token = await getGoogleAccessToken();

  const metadata: Record<string, unknown> = { name, mimeType };
  if (folderId) metadata.parents = [folderId];

  const boundary = '----PilotAIDriveBoundary';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive create error (${res.status}): ${err}`);
  }
  return res.json() as Promise<DriveFile>;
}

/**
 * Lists folders (for navigation).
 */
export async function listFolders(parentId?: string): Promise<DriveFile[]> {
  const parent = parentId ?? 'root';
  const q = `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize: '50',
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'name',
  });

  const data = await driveFetch<DriveSearchResult>(`/files?${params}`);
  return data.files ?? [];
}

/**
 * Finds a folder by name.
 */
export async function findFolder(name: string): Promise<DriveFile | null> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize: '1',
    fields: 'files(id,name,mimeType)',
  });

  const data = await driveFetch<DriveSearchResult>(`/files?${params}`);
  return data.files?.[0] ?? null;
}
