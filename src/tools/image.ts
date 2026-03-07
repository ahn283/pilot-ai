import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ImageAttachment } from '../messenger/adapter.js';

/**
 * Downloads an image from URL and returns the local file path.
 */
export async function downloadImage(attachment: ImageAttachment): Promise<string> {
  const ext = extensionFromMime(attachment.mimeType);
  const filename = attachment.filename ?? `pilot-image-${Date.now()}${ext}`;
  const filepath = path.join(os.tmpdir(), filename);

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filepath, buffer);
  return filepath;
}

/**
 * Reads an image file and returns base64-encoded string.
 */
export async function imageToBase64(filepath: string): Promise<string> {
  const buffer = await fs.readFile(filepath);
  return buffer.toString('base64');
}

/**
 * Reads an image file and returns a data URL for Claude Vision.
 */
export async function imageToDataUrl(filepath: string, mimeType?: string): Promise<string> {
  const mime = mimeType ?? mimeFromExtension(filepath);
  const base64 = await imageToBase64(filepath);
  return `data:${mime};base64,${base64}`;
}

function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  return map[mime] ?? '.png';
}

function mimeFromExtension(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return map[ext] ?? 'image/png';
}
