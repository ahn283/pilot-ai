import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

const MAX_MEMORY_LINES = 200;

function getMemoryDir(): string {
  return path.join(getPilotDir(), 'memory');
}

function getMemoryPath(): string {
  return path.join(getMemoryDir(), 'MEMORY.md');
}

function getProjectMemoryPath(projectName: string): string {
  return path.join(getMemoryDir(), 'projects', `${projectName}.md`);
}

function getHistoryPath(date?: Date): string {
  const d = date ?? new Date();
  const dateStr = d.toISOString().split('T')[0];
  return path.join(getMemoryDir(), 'history', `${dateStr}.md`);
}

// --- MEMORY.md (사용자 선호) ---

export async function readUserMemory(): Promise<string> {
  try {
    return await fs.readFile(getMemoryPath(), 'utf-8');
  } catch {
    return '';
  }
}

export async function writeUserMemory(content: string): Promise<void> {
  const lines = content.split('\n');
  const trimmed = lines.slice(0, MAX_MEMORY_LINES).join('\n');
  await fs.mkdir(getMemoryDir(), { recursive: true });
  await fs.writeFile(getMemoryPath(), trimmed);
}

export async function appendUserMemory(entry: string): Promise<void> {
  const existing = await readUserMemory();
  const updated = existing ? `${existing}\n${entry}` : entry;
  await writeUserMemory(updated);
}

// --- 프로젝트 메모리 ---

export async function readProjectMemory(projectName: string): Promise<string> {
  try {
    return await fs.readFile(getProjectMemoryPath(projectName), 'utf-8');
  } catch {
    return '';
  }
}

export async function writeProjectMemory(projectName: string, content: string): Promise<void> {
  const memPath = getProjectMemoryPath(projectName);
  await fs.mkdir(path.dirname(memPath), { recursive: true });
  await fs.writeFile(memPath, content);
}

// --- 히스토리 ---

export async function appendHistory(entry: string): Promise<void> {
  const histPath = getHistoryPath();
  await fs.mkdir(path.dirname(histPath), { recursive: true });

  const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const line = `- ${timestamp}: ${entry}\n`;

  await fs.appendFile(histPath, line);
}

export async function readHistory(date?: Date): Promise<string> {
  try {
    return await fs.readFile(getHistoryPath(date), 'utf-8');
  } catch {
    return '';
  }
}

export async function getRecentHistory(days: number = 3): Promise<string> {
  const entries: string[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const content = await readHistory(d);
    if (content) {
      const dateStr = d.toISOString().split('T')[0];
      entries.push(`### ${dateStr}\n${content}`);
    }
  }

  return entries.join('\n\n');
}

// --- 프롬프트용 메모리 조립 ---

export async function buildMemoryContext(projectName?: string): Promise<string> {
  const parts: string[] = [];

  const userMemory = await readUserMemory();
  if (userMemory) {
    parts.push(`<USER_PREFERENCES>\n${userMemory}\n</USER_PREFERENCES>`);
  }

  if (projectName) {
    const projectMemory = await readProjectMemory(projectName);
    if (projectMemory) {
      parts.push(`<PROJECT_CONTEXT project="${projectName}">\n${projectMemory}\n</PROJECT_CONTEXT>`);
    }
  }

  const history = await getRecentHistory(3);
  if (history) {
    parts.push(`<RECENT_HISTORY>\n${history}\n</RECENT_HISTORY>`);
  }

  return parts.join('\n\n');
}

// --- 메모리 초기화 ---

export async function resetMemory(): Promise<void> {
  const memDir = getMemoryDir();
  await fs.rm(memDir, { recursive: true, force: true });
  await fs.mkdir(path.join(memDir, 'projects'), { recursive: true });
  await fs.mkdir(path.join(memDir, 'history'), { recursive: true });
}
