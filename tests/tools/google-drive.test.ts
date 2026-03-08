import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock google-auth
vi.mock('../../src/tools/google-auth.js', () => ({
  getGoogleAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  listFiles,
  searchFiles,
  getFile,
  listFolders,
  findFolder,
} from '../../src/tools/google-drive.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('google-drive', () => {
  it('listFiles calls Drive API with correct params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [{ id: '1', name: 'test.txt', mimeType: 'text/plain' }] }),
    });

    const files = await listFiles();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('googleapis.com/drive');
    expect(url).toContain('root');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('test.txt');
  });

  it('listFiles with folderId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    });

    await listFiles('folder-123');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('folder-123');
  });

  it('searchFiles queries by name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [{ id: '2', name: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] }),
    });

    const files = await searchFiles('budget');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('budget.xlsx');
  });

  it('getFile returns metadata', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'abc', name: 'doc.pdf', mimeType: 'application/pdf' }),
    });

    const file = await getFile('abc');
    expect(file.id).toBe('abc');
    expect(file.name).toBe('doc.pdf');
  });

  it('listFolders filters by folder mimeType', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [{ id: 'f1', name: 'Projects', mimeType: 'application/vnd.google-apps.folder' }] }),
    });

    const folders = await listFolders();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('application%2Fvnd.google-apps.folder');
    expect(folders).toHaveLength(1);
  });

  it('findFolder returns null when not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    });

    const result = await findFolder('nonexistent');
    expect(result).toBeNull();
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });

    await expect(listFiles()).rejects.toThrow('Google Drive API error (403)');
  });
});
