import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { imageToBase64, imageToDataUrl } from '../../src/tools/image.js';

describe('imageToBase64', () => {
  it('converts file to base64', async () => {
    const filepath = path.join(os.tmpdir(), 'test-image.png');
    await fs.writeFile(filepath, Buffer.from('fake-png-data'));
    const b64 = await imageToBase64(filepath);
    expect(b64).toBe(Buffer.from('fake-png-data').toString('base64'));
    await fs.unlink(filepath);
  });
});

describe('imageToDataUrl', () => {
  it('creates data URL with correct mime type', async () => {
    const filepath = path.join(os.tmpdir(), 'test-image.jpg');
    await fs.writeFile(filepath, Buffer.from('fake-jpg'));
    const url = await imageToDataUrl(filepath);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    await fs.unlink(filepath);
  });

  it('uses provided mime type', async () => {
    const filepath = path.join(os.tmpdir(), 'test-img.bin');
    await fs.writeFile(filepath, Buffer.from('data'));
    const url = await imageToDataUrl(filepath, 'image/webp');
    expect(url).toMatch(/^data:image\/webp;base64,/);
    await fs.unlink(filepath);
  });
});
