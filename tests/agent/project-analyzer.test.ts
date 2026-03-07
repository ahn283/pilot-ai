import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-analyzer-test-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

const { analyzeProjectIfNew } = await import('../../src/agent/project-analyzer.js');
const { readProjectMemory, writeProjectMemory } = await import('../../src/agent/memory.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'projects'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'history'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('analyzeProjectIfNew', () => {
  it('analyzes a Node.js + TypeScript project', async () => {
    const projDir = path.join(testDir, 'my-api');
    await fs.mkdir(path.join(projDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(projDir, 'package.json'),
      JSON.stringify({
        dependencies: { express: '^4.0.0' },
        devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
        scripts: { build: 'tsc', test: 'vitest', dev: 'tsx watch' },
      }),
    );
    await fs.writeFile(path.join(projDir, 'tsconfig.json'), '{}');

    const result = await analyzeProjectIfNew('my-api', projDir);

    expect(result).toBeTruthy();
    expect(result).toContain('Node.js');
    expect(result).toContain('TypeScript');
    expect(result).toContain('Express');
    expect(result).toContain('Vitest');
    expect(result).toContain('src');

    // Verify saved to project memory
    const memory = await readProjectMemory('my-api');
    expect(memory).toContain('Express');
  });

  it('skips already analyzed projects', async () => {
    await writeProjectMemory('existing', 'already analyzed');
    const result = await analyzeProjectIfNew('existing', '/some/path');
    expect(result).toBeNull();
  });

  it('returns null for empty directories', async () => {
    const emptyDir = path.join(testDir, 'empty-proj');
    await fs.mkdir(emptyDir, { recursive: true });
    const result = await analyzeProjectIfNew('empty', emptyDir);
    expect(result).toBeNull();
  });

  it('detects git and Docker projects', async () => {
    const projDir = path.join(testDir, 'docker-proj');
    await fs.mkdir(path.join(projDir, '.git'), { recursive: true });
    await fs.writeFile(path.join(projDir, 'Dockerfile'), 'FROM node:18');

    const result = await analyzeProjectIfNew('docker-proj', projDir);
    expect(result).toContain('Docker');
  });
});
