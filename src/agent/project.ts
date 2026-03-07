import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

export interface ProjectEntry {
  path: string;
  description?: string;
  lastUsed?: string;
}

export interface ProjectRegistry {
  scanRoots: string[];
  detectBy: string[];
  projects: Record<string, ProjectEntry>;
}

const DEFAULT_DETECT_BY = ['package.json', '.git', 'Cargo.toml', 'pyproject.toml', 'go.mod'];

function getRegistryPath(): string {
  return path.join(getPilotDir(), 'projects.json');
}

export async function loadRegistry(): Promise<ProjectRegistry> {
  try {
    const content = await fs.readFile(getRegistryPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return { scanRoots: [], detectBy: DEFAULT_DETECT_BY, projects: {} };
  }
}

async function saveRegistry(registry: ProjectRegistry): Promise<void> {
  const content = JSON.stringify(registry, null, 2) + '\n';
  await fs.writeFile(getRegistryPath(), content);
}

export async function addProject(name: string, projectPath: string, description?: string): Promise<void> {
  const registry = await loadRegistry();
  registry.projects[name] = {
    path: projectPath,
    description,
    lastUsed: new Date().toISOString(),
  };
  await saveRegistry(registry);
}

export async function removeProject(name: string): Promise<boolean> {
  const registry = await loadRegistry();
  if (!(name in registry.projects)) return false;
  delete registry.projects[name];
  await saveRegistry(registry);
  return true;
}

export async function listProjects(): Promise<Record<string, ProjectEntry>> {
  const registry = await loadRegistry();
  return registry.projects;
}

/**
 * 지정된 루트 디렉토리들을 스캔하여 프로젝트를 자동 감지한다.
 */
export async function scanProjects(roots: string[]): Promise<Record<string, string>> {
  const registry = await loadRegistry();
  const detected: Record<string, string> = {};

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    let entries;
    try {
      entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const dirPath = path.join(resolvedRoot, entry.name);
      const isProject = await detectProject(dirPath, registry.detectBy);
      if (isProject) {
        const name = entry.name;
        if (!(name in registry.projects)) {
          registry.projects[name] = { path: dirPath, lastUsed: new Date().toISOString() };
          detected[name] = dirPath;
        }
      }
    }

    // scanRoots에 추가
    if (!registry.scanRoots.includes(resolvedRoot)) {
      registry.scanRoots.push(resolvedRoot);
    }
  }

  await saveRegistry(registry);
  return detected;
}

async function detectProject(dirPath: string, markers: string[]): Promise<boolean> {
  for (const marker of markers) {
    try {
      await fs.access(path.join(dirPath, marker));
      return true;
    } catch {
      // 다음 마커 시도
    }
  }
  return false;
}

/**
 * 사용자 메시지에서 프로젝트를 매칭한다.
 * 우선순위: 정확한 이름 → 절대경로 → fuzzy match
 */
export async function resolveProject(query: string): Promise<{ name: string; path: string } | null> {
  const registry = await loadRegistry();
  const projects = registry.projects;

  // 1. 정확한 이름 매칭
  if (query in projects) {
    return { name: query, path: projects[query].path };
  }

  // 2. 절대경로 포함 여부
  if (query.startsWith('/') || query.startsWith('~')) {
    return { name: path.basename(query), path: path.resolve(query) };
  }

  // 3. Fuzzy match (부분 문자열)
  const lowerQuery = query.toLowerCase();
  for (const [name, entry] of Object.entries(projects)) {
    if (name.toLowerCase().includes(lowerQuery) || lowerQuery.includes(name.toLowerCase())) {
      return { name, path: entry.path };
    }
  }

  return null;
}

export async function touchProject(name: string): Promise<void> {
  const registry = await loadRegistry();
  if (name in registry.projects) {
    registry.projects[name].lastUsed = new Date().toISOString();
    await saveRegistry(registry);
  }
}
