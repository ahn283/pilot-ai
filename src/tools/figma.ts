/**
 * Figma REST API wrapper for design file operations.
 */

const FIGMA_API = 'https://api.figma.com/v1';

export interface FigmaConfig {
  personalAccessToken: string;
}

let config: FigmaConfig | null = null;

export function configureFigma(cfg: FigmaConfig): void {
  config = cfg;
}

function getHeaders(): Record<string, string> {
  if (!config) throw new Error('Figma not configured. Call configureFigma() first.');
  return { 'X-Figma-Token': config.personalAccessToken };
}

async function figmaFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${FIGMA_API}${path}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function figmaPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${FIGMA_API}${path}`, {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// --- File operations ---

export interface FigmaFile {
  name: string;
  lastModified: string;
  version: string;
  document: FigmaNode;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
}

export async function getFile(fileKey: string): Promise<FigmaFile> {
  return figmaFetch<FigmaFile>(`/files/${fileKey}?depth=2`);
}

export async function getFileNodes(
  fileKey: string,
  nodeIds: string[],
): Promise<Record<string, { document: FigmaNode }>> {
  const ids = nodeIds.join(',');
  const data = await figmaFetch<{ nodes: Record<string, { document: FigmaNode }> }>(
    `/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`,
  );
  return data.nodes;
}

// --- Image export ---

export type ImageFormat = 'png' | 'svg' | 'jpg' | 'pdf';

export async function exportImages(
  fileKey: string,
  nodeIds: string[],
  format: ImageFormat = 'png',
  scale: number = 2,
): Promise<Record<string, string>> {
  const ids = nodeIds.join(',');
  const data = await figmaFetch<{ images: Record<string, string> }>(
    `/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}`,
  );
  return data.images;
}

// --- Components ---

export interface FigmaComponent {
  key: string;
  name: string;
  description: string;
  node_id: string;
  file_key: string;
}

export async function getFileComponents(fileKey: string): Promise<FigmaComponent[]> {
  const data = await figmaFetch<{ meta: { components: FigmaComponent[] } }>(
    `/files/${fileKey}/components`,
  );
  return data.meta.components;
}

// --- Design tokens / variables ---

export interface FigmaVariable {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, unknown>;
}

export async function getLocalVariables(fileKey: string): Promise<FigmaVariable[]> {
  const data = await figmaFetch<{ meta: { variables: Record<string, FigmaVariable> } }>(
    `/files/${fileKey}/variables/local`,
  );
  return Object.values(data.meta.variables);
}

// --- Comments ---

export interface FigmaComment {
  id: string;
  message: string;
  created_at: string;
  user: { handle: string };
  order_id?: string;
}

export async function getComments(fileKey: string): Promise<FigmaComment[]> {
  const data = await figmaFetch<{ comments: FigmaComment[] }>(`/files/${fileKey}/comments`);
  return data.comments;
}

export async function postComment(
  fileKey: string,
  message: string,
  nodeId?: string,
): Promise<FigmaComment> {
  const body: Record<string, unknown> = { message };
  if (nodeId) {
    body.client_meta = { node_id: nodeId, node_offset: { x: 0, y: 0 } };
  }
  return figmaPost<FigmaComment>(`/files/${fileKey}/comments`, body);
}
