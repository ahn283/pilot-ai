import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathAllowed } from '../security/sandbox.js';
import type { PilotConfig } from '../config/schema.js';

/**
 * Resolves the real path (following symlinks) and checks sandbox permissions.
 * Throws if the resolved path is not allowed.
 */
function assertAllowed(targetPath: string, config: PilotConfig): string {
  const resolved = path.resolve(targetPath);
  // Resolve symlinks for existing paths
  let realResolved: string;
  try {
    realResolved = fsSync.realpathSync(resolved);
  } catch {
    realResolved = resolved;
  }
  if (!isPathAllowed(realResolved, config)) {
    throw new Error(`Access denied: blocked path: ${realResolved}`);
  }
  return realResolved;
}

export async function readFile(filePath: string, config: PilotConfig): Promise<string> {
  const resolved = assertAllowed(filePath, config);
  return fs.readFile(resolved, 'utf-8');
}

export async function writeFile(filePath: string, content: string, config: PilotConfig): Promise<void> {
  const resolved = assertAllowed(filePath, config);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content);
}

export async function deleteFile(filePath: string, config: PilotConfig): Promise<void> {
  const resolved = assertAllowed(filePath, config);
  await fs.rm(resolved);
}

export async function moveFile(src: string, dest: string, config: PilotConfig): Promise<void> {
  const resolvedSrc = assertAllowed(src, config);
  const resolvedDest = assertAllowed(dest, config);
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
  await fs.rename(resolvedSrc, resolvedDest);
}

export async function copyFile(src: string, dest: string, config: PilotConfig): Promise<void> {
  const resolvedSrc = assertAllowed(src, config);
  const resolvedDest = assertAllowed(dest, config);
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
  await fs.copyFile(resolvedSrc, resolvedDest);
}

export async function listDir(dirPath: string, config: PilotConfig): Promise<string[]> {
  const resolved = assertAllowed(dirPath, config);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
}

export async function searchFiles(
  dirPath: string,
  pattern: string,
  config: PilotConfig,
): Promise<string[]> {
  const resolved = assertAllowed(dirPath, config);
  const results: string[] = [];
  const regex = new RegExp(pattern, 'i');

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (regex.test(entry.name)) {
        results.push(path.relative(resolved, fullPath));
      }
    }
  }

  await walk(resolved);
  return results;
}
