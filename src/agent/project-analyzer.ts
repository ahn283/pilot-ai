import fs from 'node:fs/promises';
import path from 'node:path';
import { readProjectMemory, writeProjectMemory } from './memory.js';

interface ProjectAnalysis {
  name: string;
  stack: string[];
  structure: string[];
}

const STACK_DETECTORS: Array<{ file: string; label: string }> = [
  { file: 'package.json', label: 'Node.js' },
  { file: 'tsconfig.json', label: 'TypeScript' },
  { file: 'Cargo.toml', label: 'Rust' },
  { file: 'pyproject.toml', label: 'Python' },
  { file: 'go.mod', label: 'Go' },
  { file: 'pom.xml', label: 'Java (Maven)' },
  { file: 'build.gradle', label: 'Java (Gradle)' },
  { file: 'Gemfile', label: 'Ruby' },
  { file: 'docker-compose.yml', label: 'Docker Compose' },
  { file: 'Dockerfile', label: 'Docker' },
  { file: '.github/workflows', label: 'GitHub Actions' },
];

const FRAMEWORK_DETECTORS: Array<{ dep: string; label: string }> = [
  { dep: 'next', label: 'Next.js' },
  { dep: 'react', label: 'React' },
  { dep: 'vue', label: 'Vue.js' },
  { dep: 'express', label: 'Express' },
  { dep: 'fastify', label: 'Fastify' },
  { dep: 'nestjs', label: 'NestJS' },
  { dep: '@angular/core', label: 'Angular' },
  { dep: 'svelte', label: 'Svelte' },
  { dep: 'vitest', label: 'Vitest' },
  { dep: 'jest', label: 'Jest' },
  { dep: 'mocha', label: 'Mocha' },
  { dep: 'prisma', label: 'Prisma' },
  { dep: 'drizzle-orm', label: 'Drizzle' },
  { dep: 'tailwindcss', label: 'Tailwind CSS' },
];

/**
 * Analyzes a project directory and generates a summary.
 * Only runs if project memory is empty (first time).
 */
export async function analyzeProjectIfNew(projectName: string, projectPath: string): Promise<string | null> {
  const existing = await readProjectMemory(projectName);
  if (existing) return null; // Already analyzed

  const analysis = await analyzeProject(projectName, projectPath);
  if (analysis.stack.length === 0 && analysis.structure.length === 0) {
    return null; // Nothing detected
  }

  const lines: string[] = [`# ${projectName}`];

  if (analysis.stack.length > 0) {
    lines.push('', `## Stack`, analysis.stack.map((s) => `- ${s}`).join('\n'));
  }

  if (analysis.structure.length > 0) {
    lines.push('', `## Structure`, analysis.structure.map((s) => `- ${s}`).join('\n'));
  }

  const content = lines.join('\n');
  await writeProjectMemory(projectName, content);
  return content;
}

async function analyzeProject(name: string, projectPath: string): Promise<ProjectAnalysis> {
  const stack: string[] = [];
  const structure: string[] = [];

  // Detect stack from marker files
  for (const { file, label } of STACK_DETECTORS) {
    try {
      await fs.access(path.join(projectPath, file));
      stack.push(label);
    } catch {
      // Not found
    }
  }

  // Detect frameworks from package.json
  try {
    const pkgContent = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const { dep, label } of FRAMEWORK_DETECTORS) {
      if (dep in allDeps) {
        stack.push(label);
      }
    }

    if (pkg.scripts) {
      const scripts = Object.keys(pkg.scripts);
      if (scripts.length > 0) {
        structure.push(`Scripts: ${scripts.slice(0, 8).join(', ')}`);
      }
    }
  } catch {
    // No package.json or invalid
  }

  // Detect top-level directory structure
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name)
      .slice(0, 10);

    if (dirs.length > 0) {
      structure.push(`Directories: ${dirs.join(', ')}`);
    }
  } catch {
    // Can't read
  }

  return { name, stack, structure };
}
