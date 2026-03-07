import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureFigma,
  getFile,
  getFileNodes,
  exportImages,
  getFileComponents,
  getLocalVariables,
  getComments,
  postComment,
} from '../../src/tools/figma.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
  configureFigma({ personalAccessToken: 'figd_test_token' });
});

function mockJsonResponse(data: unknown, status = 200) {
  return mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  });
}

describe('getFile', () => {
  it('fetches a Figma file', async () => {
    mockJsonResponse({ name: 'My Design', lastModified: '2026-01-01', version: '1', document: { id: '0:0', name: 'Document', type: 'DOCUMENT' } });
    const file = await getFile('abc123');
    expect(file.name).toBe('My Design');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/files/abc123'),
      expect.objectContaining({ headers: { 'X-Figma-Token': 'figd_test_token' } }),
    );
  });

  it('throws on error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' });
    await expect(getFile('bad')).rejects.toThrow('Figma API error: 403');
  });
});

describe('getFileNodes', () => {
  it('fetches specific nodes', async () => {
    mockJsonResponse({ nodes: { '1:2': { document: { id: '1:2', name: 'Frame', type: 'FRAME' } } } });
    const nodes = await getFileNodes('abc123', ['1:2']);
    expect(nodes['1:2'].document.name).toBe('Frame');
  });
});

describe('exportImages', () => {
  it('exports images as PNG', async () => {
    mockJsonResponse({ images: { '1:2': 'https://figma.com/image.png' } });
    const images = await exportImages('abc123', ['1:2'], 'png', 2);
    expect(images['1:2']).toContain('https://');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('format=png&scale=2'),
      expect.any(Object),
    );
  });

  it('exports images as SVG', async () => {
    mockJsonResponse({ images: { '1:2': 'https://figma.com/image.svg' } });
    const images = await exportImages('abc123', ['1:2'], 'svg');
    expect(images['1:2']).toContain('.svg');
  });
});

describe('getFileComponents', () => {
  it('fetches components list', async () => {
    mockJsonResponse({ meta: { components: [{ key: 'k1', name: 'Button', description: 'Primary', node_id: '3:4', file_key: 'abc' }] } });
    const components = await getFileComponents('abc123');
    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('Button');
  });
});

describe('getLocalVariables', () => {
  it('fetches design tokens/variables', async () => {
    mockJsonResponse({ meta: { variables: { v1: { id: 'v1', name: 'primary-color', resolvedType: 'COLOR', valuesByMode: {} } } } });
    const vars = await getLocalVariables('abc123');
    expect(vars).toHaveLength(1);
    expect(vars[0].name).toBe('primary-color');
  });
});

describe('getComments', () => {
  it('fetches file comments', async () => {
    mockJsonResponse({ comments: [{ id: 'c1', message: 'Nice work', created_at: '2026-01-01', user: { handle: 'user1' } }] });
    const comments = await getComments('abc123');
    expect(comments).toHaveLength(1);
    expect(comments[0].message).toBe('Nice work');
  });
});

describe('postComment', () => {
  it('posts a comment on a file', async () => {
    mockJsonResponse({ id: 'c2', message: 'Looks good', created_at: '2026-01-01', user: { handle: 'me' } });
    const comment = await postComment('abc123', 'Looks good');
    expect(comment.message).toBe('Looks good');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/comments'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('posts a comment on a specific node', async () => {
    mockJsonResponse({ id: 'c3', message: 'Fix this', created_at: '2026-01-01', user: { handle: 'me' } });
    await postComment('abc123', 'Fix this', '1:2');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.client_meta.node_id).toBe('1:2');
  });
});

describe('configuration', () => {
  it('throws if not configured', async () => {
    configureFigma(null as any);
    // Override to clear config - need fresh import
    // Since configureFigma sets to null, getFile will throw
    await expect(getFile('test')).rejects.toThrow('Figma not configured');
  });
});
