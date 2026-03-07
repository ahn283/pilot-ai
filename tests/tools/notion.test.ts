import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPages = {
  create: vi.fn().mockResolvedValue({ id: 'page-123' }),
  retrieve: vi.fn().mockResolvedValue({ id: 'page-123', object: 'page', properties: {} }),
  update: vi.fn().mockResolvedValue({}),
};

const mockDatabases = {
  retrieve: vi.fn().mockResolvedValue({ id: 'db-123', object: 'database', title: [] }),
};

const mockBlocks = {
  children: {
    append: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue({
      results: [
        { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello' }] } },
        { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'World' }] } },
      ],
    }),
  },
};

const mockSearch = vi.fn().mockResolvedValue({
  results: [{ id: 'page-1', object: 'page' }],
});

vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(() => ({
    pages: mockPages,
    databases: mockDatabases,
    blocks: mockBlocks,
    search: mockSearch,
  })),
}));

const {
  initNotion,
  resetNotion,
  isNotionInitialized,
  createPage,
  getPage,
  updatePage,
  archivePage,
  getDatabase,
  searchNotion,
  appendBlocks,
  getPageContent,
  textBlock,
} = await import('../../src/tools/notion.js');

beforeEach(() => {
  vi.clearAllMocks();
  resetNotion();
});

describe('initialization', () => {
  it('initializes and reports status', () => {
    expect(isNotionInitialized()).toBe(false);
    initNotion('ntn_test');
    expect(isNotionInitialized()).toBe(true);
  });

  it('throws when not initialized', async () => {
    await expect(getPage('x')).rejects.toThrow('Notion not initialized');
  });
});

describe('pages', () => {
  beforeEach(() => initNotion('ntn_test'));

  it('creates a page in a database', async () => {
    const id = await createPage({
      parentId: 'db-1',
      parentType: 'database',
      title: 'New Page',
      content: 'Some content',
    });
    expect(id).toBe('page-123');
    expect(mockPages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { database_id: 'db-1' },
      }),
    );
  });

  it('creates a page under a page', async () => {
    await createPage({ parentId: 'page-parent', parentType: 'page', title: 'Child' });
    expect(mockPages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { page_id: 'page-parent' },
      }),
    );
  });

  it('retrieves a page', async () => {
    const page = await getPage('page-123');
    expect(page.id).toBe('page-123');
  });

  it('updates page properties', async () => {
    await updatePage('page-123', { Status: { select: { name: 'Done' } } });
    expect(mockPages.update).toHaveBeenCalledWith(
      expect.objectContaining({ page_id: 'page-123' }),
    );
  });

  it('archives a page', async () => {
    await archivePage('page-123');
    expect(mockPages.update).toHaveBeenCalledWith(
      expect.objectContaining({ page_id: 'page-123', archived: true }),
    );
  });
});

describe('databases', () => {
  beforeEach(() => initNotion('ntn_test'));

  it('retrieves database metadata', async () => {
    const db = await getDatabase('db-123');
    expect(db.id).toBe('db-123');
  });
});

describe('search', () => {
  beforeEach(() => initNotion('ntn_test'));

  it('searches Notion', async () => {
    const results = await searchNotion('meeting notes');
    expect(results).toHaveLength(1);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'meeting notes' }),
    );
  });
});

describe('blocks', () => {
  beforeEach(() => initNotion('ntn_test'));

  it('appends blocks to a page', async () => {
    await appendBlocks('page-1', [textBlock('New paragraph')]);
    expect(mockBlocks.children.append).toHaveBeenCalled();
  });

  it('reads page content', async () => {
    const content = await getPageContent('page-1');
    expect(content).toBe('Hello\nWorld');
  });
});

describe('textBlock helper', () => {
  it('creates a paragraph block', () => {
    const block = textBlock('Hello');
    expect(block.type).toBe('paragraph');
  });
});
