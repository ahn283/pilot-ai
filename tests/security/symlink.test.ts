import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isPathAllowed } from '../../src/security/sandbox.js';
import type { PilotConfig } from '../../src/config/schema.js';

const tmpDir = path.join(os.tmpdir(), `pilot-symlink-test-${Date.now()}`);
const safeDir = path.join(tmpDir, 'safe');
const secretDir = path.join(tmpDir, 'secret');

const config = {
  security: {
    filesystemSandbox: {
      allowedPaths: [safeDir],
      blockedPaths: [secretDir],
    },
  },
} as PilotConfig;

beforeAll(() => {
  fs.mkdirSync(safeDir, { recursive: true });
  fs.mkdirSync(secretDir, { recursive: true });
  fs.writeFileSync(path.join(secretDir, 'key.pem'), 'SECRET');

  // Create a symlink inside safe dir that points to secret dir
  fs.symlinkSync(secretDir, path.join(safeDir, 'escape-link'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('symlink path traversal defense', () => {
  it('allows normal file in safe dir', () => {
    const testFile = path.join(safeDir, 'normal.txt');
    fs.writeFileSync(testFile, 'ok');
    expect(isPathAllowed(testFile, config)).toBe(true);
  });

  it('blocks direct access to secret dir', () => {
    expect(isPathAllowed(path.join(secretDir, 'key.pem'), config)).toBe(false);
  });

  it('blocks symlink that points to blocked path', () => {
    const symlinkPath = path.join(safeDir, 'escape-link', 'key.pem');
    // Without realpath defense, this would appear to be under safeDir
    expect(isPathAllowed(symlinkPath, config)).toBe(false);
  });

  it('blocks symlink directory itself when it resolves to blocked path', () => {
    const symlinkPath = path.join(safeDir, 'escape-link');
    expect(isPathAllowed(symlinkPath, config)).toBe(false);
  });
});
