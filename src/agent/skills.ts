import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

export interface Skill {
  name: string;
  filename: string;
  trigger: string;
  steps: string;
  reference?: string;
  raw: string;
}

function getSkillsDir(): string {
  return path.join(getPilotDir(), 'skills');
}

/**
 * Parses a skill Markdown file.
 *
 * Expected format:
 * ```
 * # Skill Name
 *
 * ## Trigger
 * When the user asks to deploy, release, or ship code.
 *
 * ## Steps
 * 1. Run tests
 * 2. Build the project
 * 3. Deploy to production
 *
 * ## Reference (optional)
 * - Only deploy from main branch
 * ```
 */
export function parseSkill(content: string, filename: string): Skill | null {
  const nameMatch = content.match(/^#\s+(.+)/m);
  if (!nameMatch) return null;

  const sections = extractSections(content);

  return {
    name: nameMatch[1].trim(),
    filename,
    trigger: sections['trigger'] ?? '',
    steps: sections['steps'] ?? '',
    reference: sections['reference'],
    raw: content,
  };
}

function extractSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)/);
    if (sectionMatch) {
      if (currentSection) {
        sections[currentSection] = currentLines.join('\n').trim();
      }
      currentSection = sectionMatch[1].trim().toLowerCase();
      currentLines = [];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }

  if (currentSection) {
    sections[currentSection] = currentLines.join('\n').trim();
  }

  return sections;
}

/**
 * Scans ~/.pilot/skills/ and returns all parsed skills.
 */
export async function listSkills(): Promise<Skill[]> {
  const dir = getSkillsDir();
  try {
    await fs.access(dir);
  } catch {
    return [];
  }

  const files = await fs.readdir(dir);
  const skills: Skill[] = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const content = await fs.readFile(path.join(dir, file), 'utf-8');
    const skill = parseSkill(content, file);
    if (skill) skills.push(skill);
  }

  return skills;
}

/**
 * Gets a single skill by name (case-insensitive).
 */
export async function getSkill(name: string): Promise<Skill | null> {
  const skills = await listSkills();
  const lower = name.toLowerCase();
  return skills.find((s) => s.name.toLowerCase() === lower) ?? null;
}

/**
 * Creates a new skill file.
 */
export async function createSkill(params: {
  name: string;
  trigger: string;
  steps: string;
  reference?: string;
}): Promise<string> {
  const dir = getSkillsDir();
  await fs.mkdir(dir, { recursive: true });

  const filename = params.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '.md';
  const filepath = path.join(dir, filename);

  const lines = [
    `# ${params.name}`,
    '',
    '## Trigger',
    params.trigger,
    '',
    '## Steps',
    params.steps,
  ];

  if (params.reference) {
    lines.push('', '## Reference', params.reference);
  }

  await fs.writeFile(filepath, lines.join('\n') + '\n', 'utf-8');
  return filename;
}

/**
 * Deletes a skill file by name.
 */
export async function deleteSkill(name: string): Promise<boolean> {
  const skill = await getSkill(name);
  if (!skill) return false;

  const filepath = path.join(getSkillsDir(), skill.filename);
  await fs.unlink(filepath);
  return true;
}

/**
 * Builds a prompt snippet with all skills for LLM context injection.
 * The LLM decides which skill to apply based on trigger descriptions.
 */
export async function buildSkillsContext(): Promise<string | null> {
  const skills = await listSkills();
  if (skills.length === 0) return null;

  const lines = ['<SKILLS>'];
  for (const skill of skills) {
    lines.push(`<skill name="${skill.name}">`);
    lines.push(`<trigger>${skill.trigger}</trigger>`);
    lines.push(`<steps>${skill.steps}</steps>`);
    if (skill.reference) {
      lines.push(`<reference>${skill.reference}</reference>`);
    }
    lines.push('</skill>');
  }
  lines.push('</SKILLS>');

  return lines.join('\n');
}

/**
 * Formats skill list for display.
 */
export function formatSkillList(skills: Skill[]): string {
  if (skills.length === 0) return 'No skills registered.';

  const lines = ['Skills:'];
  for (const skill of skills) {
    lines.push(`  - ${skill.name} (${skill.filename}): ${skill.trigger.slice(0, 60)}...`);
  }
  return lines.join('\n');
}
