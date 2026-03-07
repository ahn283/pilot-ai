import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-project-test-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

const {
  addProject,
  removeProject,
  listProjects,
  scanProjects,
  resolveProject,
} = await import('../../src/agent/project.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('project registry', () => {
  it('프로젝트를 추가하고 목록에서 확인한다', async () => {
    await addProject('api', '/home/user/projects/api', 'API 서버');
    const projects = await listProjects();
    expect(projects.api).toBeDefined();
    expect(projects.api.path).toBe('/home/user/projects/api');
    expect(projects.api.description).toBe('API 서버');
  });

  it('프로젝트를 제거한다', async () => {
    await addProject('temp', '/tmp/temp');
    const removed = await removeProject('temp');
    expect(removed).toBe(true);
    const projects = await listProjects();
    expect(projects.temp).toBeUndefined();
  });

  it('없는 프로젝트 제거는 false', async () => {
    const removed = await removeProject('nonexistent');
    expect(removed).toBe(false);
  });
});

describe('resolveProject', () => {
  beforeEach(async () => {
    await addProject('api', '/projects/api');
    await addProject('frontend', '/projects/frontend');
  });

  it('정확한 이름으로 매칭한다', async () => {
    const result = await resolveProject('api');
    expect(result?.name).toBe('api');
    expect(result?.path).toBe('/projects/api');
  });

  it('fuzzy match로 매칭한다', async () => {
    const result = await resolveProject('front');
    expect(result?.name).toBe('frontend');
  });

  it('매칭 실패 시 null', async () => {
    const result = await resolveProject('nonexistent-xyz');
    expect(result).toBeNull();
  });

  it('절대경로는 직접 사용한다', async () => {
    const result = await resolveProject('/home/user/custom');
    expect(result?.path).toBe('/home/user/custom');
  });
});

describe('scanProjects', () => {
  it('디렉토리를 스캔하여 프로젝트를 감지한다', async () => {
    const scanRoot = path.join(testDir, 'projects');
    const projA = path.join(scanRoot, 'proj-a');
    const projB = path.join(scanRoot, 'proj-b');
    const notProj = path.join(scanRoot, 'just-a-dir');

    await fs.mkdir(projA, { recursive: true });
    await fs.mkdir(projB, { recursive: true });
    await fs.mkdir(notProj, { recursive: true });
    await fs.writeFile(path.join(projA, 'package.json'), '{}');
    await fs.mkdir(path.join(projB, '.git'), { recursive: true });

    const detected = await scanProjects([scanRoot]);
    expect(detected['proj-a']).toBeDefined();
    expect(detected['proj-b']).toBeDefined();
    expect(detected['just-a-dir']).toBeUndefined();
  });
});
