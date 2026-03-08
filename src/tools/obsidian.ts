import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Obsidian integration — operates on local markdown files in a vault directory.
 * No Obsidian API needed; it's just a filesystem with conventions.
 */

export async function readNote(vaultPath: string, notePath: string): Promise<string> {
  const filepath = resolveNotePath(vaultPath, notePath);
  return fs.readFile(filepath, 'utf-8');
}

export async function writeNote(vaultPath: string, notePath: string, content: string): Promise<void> {
  const filepath = resolveNotePath(vaultPath, notePath);
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, content, 'utf-8');
}

export async function appendToNote(vaultPath: string, notePath: string, content: string): Promise<void> {
  const filepath = resolveNotePath(vaultPath, notePath);
  try {
    const existing = await fs.readFile(filepath, 'utf-8');
    await fs.writeFile(filepath, existing + '\n' + content, 'utf-8');
  } catch {
    await writeNote(vaultPath, notePath, content);
  }
}

export async function getDailyNote(vaultPath: string, date?: Date): Promise<{ path: string; content: string }> {
  const d = date ?? new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const notePath = `Daily/${dateStr}.md`;
  const filepath = resolveNotePath(vaultPath, notePath);

  try {
    const content = await fs.readFile(filepath, 'utf-8');
    return { path: notePath, content };
  } catch {
    // Create with template
    const template = `# ${dateStr}\n\n## Tasks\n\n## Notes\n`;
    await writeNote(vaultPath, notePath, template);
    return { path: notePath, content: template };
  }
}

export async function searchNotes(vaultPath: string, query: string): Promise<Array<{ path: string; matches: string[] }>> {
  const results: Array<{ path: string; matches: string[] }> = [];
  const regex = new RegExp(query, 'gi');

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const matchingLines = lines.filter((l) => regex.test(l));
        if (matchingLines.length > 0) {
          results.push({
            path: path.relative(vaultPath, fullPath),
            matches: matchingLines.slice(0, 5), // limit context
          });
        }
        regex.lastIndex = 0;
      }
    }
  }

  await walk(vaultPath);
  return results;
}

export async function listNotes(vaultPath: string, subdir?: string): Promise<string[]> {
  const dir = subdir ? path.join(vaultPath, subdir) : vaultPath;
  const notes: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        notes.push(path.relative(vaultPath, fullPath));
      }
    }
  }

  await walk(dir);
  return notes.sort();
}

/**
 * Resolves a path following symlinks where possible.
 * If the full path doesn't exist, resolves the deepest existing ancestor.
 */
function resolveReal(p: string): string {
  try {
    return fsSync.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    const base = path.basename(p);
    if (parent === p) return p;
    return path.join(resolveReal(parent), base);
  }
}

function resolveNotePath(vaultPath: string, notePath: string): string {
  const normalized = notePath.endsWith('.md') ? notePath : notePath + '.md';
  const resolved = path.resolve(vaultPath, normalized);
  const resolvedVault = path.resolve(vaultPath);
  // Resolve symlinks to prevent symlink-based bypass
  const realResolved = resolveReal(resolved);
  const realVault = resolveReal(resolvedVault);
  if (!realResolved.startsWith(realVault + path.sep) && realResolved !== realVault) {
    throw new Error('Path traversal detected: note path is outside vault');
  }
  return realResolved;
}
