import { Client } from '@notionhq/client';
import type {
  PageObjectResponse,
  DatabaseObjectResponse,
  CreatePageParameters,
  BlockObjectRequest,
} from '@notionhq/client/build/src/api-endpoints.js';

let client: Client | null = null;

export function initNotion(apiKey: string): void {
  client = new Client({ auth: apiKey });
}

function ensureClient(): Client {
  if (!client) throw new Error('Notion not initialized. Call initNotion() first.');
  return client;
}

// --- Pages ---

export async function createPage(params: {
  parentId: string;
  parentType: 'page' | 'database';
  title: string;
  content?: string;
  properties?: CreatePageParameters['properties'];
}): Promise<string> {
  const notion = ensureClient();

  const parent =
    params.parentType === 'database'
      ? { database_id: params.parentId }
      : { page_id: params.parentId };

  const children: BlockObjectRequest[] = [];
  if (params.content) {
    children.push(textBlock(params.content));
  }

  const properties: CreatePageParameters['properties'] = params.properties ?? {
    title: { title: [{ text: { content: params.title } }] },
  };

  const page = await notion.pages.create({ parent, properties, children });
  return page.id;
}

export async function getPage(pageId: string): Promise<PageObjectResponse> {
  const notion = ensureClient();
  return (await notion.pages.retrieve({ page_id: pageId })) as PageObjectResponse;
}

export async function updatePage(
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const notion = ensureClient();
  await notion.pages.update({
    page_id: pageId,
    properties: properties as CreatePageParameters['properties'],
  });
}

export async function archivePage(pageId: string): Promise<void> {
  const notion = ensureClient();
  await notion.pages.update({ page_id: pageId, archived: true });
}

// --- Databases ---

export async function getDatabase(databaseId: string): Promise<DatabaseObjectResponse> {
  const notion = ensureClient();
  return (await notion.databases.retrieve({ database_id: databaseId })) as DatabaseObjectResponse;
}

// --- Search ---

export async function searchNotion(
  query: string,
  options?: { filter?: 'page'; pageSize?: number },
): Promise<Array<PageObjectResponse | DatabaseObjectResponse>> {
  const notion = ensureClient();
  const response = await notion.search({
    query,
    filter: options?.filter ? { value: options.filter, property: 'object' } : undefined,
    page_size: options?.pageSize ?? 10,
  });
  return response.results as Array<PageObjectResponse | DatabaseObjectResponse>;
}

// --- Blocks (content) ---

export async function appendBlocks(pageId: string, blocks: BlockObjectRequest[]): Promise<void> {
  const notion = ensureClient();
  await notion.blocks.children.append({ block_id: pageId, children: blocks });
}

export async function getPageContent(pageId: string): Promise<string> {
  const notion = ensureClient();
  const response = await notion.blocks.children.list({ block_id: pageId });

  const textParts: string[] = [];
  for (const block of response.results) {
    const b = block as Record<string, unknown>;
    const blockType = b['type'] as string;
    const blockData = b[blockType] as { rich_text?: Array<{ plain_text: string }> } | undefined;
    if (blockData?.rich_text) {
      textParts.push(blockData.rich_text.map((t) => t.plain_text).join(''));
    }
  }
  return textParts.join('\n');
}

export function textBlock(content: string): BlockObjectRequest {
  return {
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: {
      rich_text: [{ type: 'text' as const, text: { content } }],
    },
  };
}

export function isNotionInitialized(): boolean {
  return client !== null;
}

export function resetNotion(): void {
  client = null;
}
