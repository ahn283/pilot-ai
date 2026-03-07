import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile, deleteFile, moveFile, copyFile, listDir, searchFiles } from '../../src/tools/filesystem.js';
import type { PilotConfig } from '../../src/config/schema.js';

const testDir = path.join(os.tmpdir(), `pilot-fs-test-${Date.now()}`);

const config = {
  security: {
    filesystemSandbox: {
      allowedPaths: [testDir],
      blockedPaths: [],
    },
  },
} as PilotConfig;

const blockedConfig = {
  security: {
    filesystemSandbox: {
      allowedPaths: [testDir],
      blockedPaths: [path.join(testDir, 'secret')],
    },
  },
} as PilotConfig;

beforeEach(async () => {
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('filesystem', () => {
  it('파일을 쓰고 읽을 수 있다', async () => {
    const filePath = path.join(testDir, 'test.txt');
    await writeFile(filePath, 'hello world', config);
    const content = await readFile(filePath, config);
    expect(content).toBe('hello world');
  });

  it('파일을 삭제할 수 있다', async () => {
    const filePath = path.join(testDir, 'to-delete.txt');
    await writeFile(filePath, 'delete me', config);
    await deleteFile(filePath, config);
    await expect(readFile(filePath, config)).rejects.toThrow();
  });

  it('파일을 이동할 수 있다', async () => {
    const src = path.join(testDir, 'src.txt');
    const dest = path.join(testDir, 'sub', 'dest.txt');
    await writeFile(src, 'move me', config);
    await moveFile(src, dest, config);
    const content = await readFile(dest, config);
    expect(content).toBe('move me');
  });

  it('파일을 복사할 수 있다', async () => {
    const src = path.join(testDir, 'original.txt');
    const dest = path.join(testDir, 'copy.txt');
    await writeFile(src, 'copy me', config);
    await copyFile(src, dest, config);
    expect(await readFile(src, config)).toBe('copy me');
    expect(await readFile(dest, config)).toBe('copy me');
  });

  it('디렉토리 목록을 반환한다', async () => {
    await writeFile(path.join(testDir, 'a.txt'), 'a', config);
    await fs.mkdir(path.join(testDir, 'subdir'), { recursive: true });
    const list = await listDir(testDir, config);
    expect(list).toContain('a.txt');
    expect(list).toContain('subdir/');
  });

  it('파일을 이름으로 검색한다', async () => {
    await writeFile(path.join(testDir, 'hello.ts'), 'code', config);
    await writeFile(path.join(testDir, 'world.ts'), 'code', config);
    await writeFile(path.join(testDir, 'readme.md'), 'doc', config);
    const results = await searchFiles(testDir, '\\.ts$', config);
    expect(results).toHaveLength(2);
    expect(results).toContain('hello.ts');
    expect(results).toContain('world.ts');
  });

  it('차단된 경로에 접근하면 에러를 던진다', async () => {
    const secretPath = path.join(testDir, 'secret', 'data.txt');
    await expect(writeFile(secretPath, 'secret', blockedConfig)).rejects.toThrow('접근이 차단된 경로');
  });
});
