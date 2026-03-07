import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import {
  parseSkill,
  listSkills,
  getSkill,
  createSkill,
  deleteSkill,
  buildSkillsContext,
  formatSkillList,
} from '../../src/agent/skills.js';

vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => '/tmp/pilot-skills-test',
}));

beforeEach(async () => {
  await fs.mkdir('/tmp/pilot-skills-test/skills', { recursive: true });
  // Clean up
  const files = await fs.readdir('/tmp/pilot-skills-test/skills');
  for (const f of files) {
    await fs.unlink(`/tmp/pilot-skills-test/skills/${f}`);
  }
});

const SAMPLE_SKILL = `# Deploy

## Trigger
When the user asks to deploy, release, or ship code.

## Steps
1. Run tests
2. Build the project
3. Deploy to production

## Reference
- Only deploy from main branch
- Always run tests first
`;

describe('parseSkill', () => {
  it('parses a valid skill file', () => {
    const skill = parseSkill(SAMPLE_SKILL, 'deploy.md');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('Deploy');
    expect(skill!.trigger).toContain('deploy');
    expect(skill!.steps).toContain('Run tests');
    expect(skill!.reference).toContain('main branch');
  });

  it('returns null for invalid content', () => {
    expect(parseSkill('no heading here', 'bad.md')).toBeNull();
  });

  it('handles missing reference section', () => {
    const content = `# Simple\n\n## Trigger\nDo something\n\n## Steps\n1. Step one\n`;
    const skill = parseSkill(content, 'simple.md');
    expect(skill!.reference).toBeUndefined();
  });
});

describe('CRUD', () => {
  it('creates and lists skills', async () => {
    await createSkill({
      name: 'Deploy',
      trigger: 'When user asks to deploy',
      steps: '1. Build\n2. Ship',
    });

    const skills = await listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('Deploy');
  });

  it('gets a skill by name (case-insensitive)', async () => {
    await createSkill({ name: 'Deploy', trigger: 'deploy', steps: 'steps' });
    const skill = await getSkill('deploy');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('Deploy');
  });

  it('returns null for unknown skill', async () => {
    expect(await getSkill('nonexistent')).toBeNull();
  });

  it('deletes a skill', async () => {
    await createSkill({ name: 'ToDelete', trigger: 't', steps: 's' });
    expect(await deleteSkill('ToDelete')).toBe(true);
    expect(await listSkills()).toHaveLength(0);
  });

  it('returns false when deleting nonexistent skill', async () => {
    expect(await deleteSkill('nope')).toBe(false);
  });

  it('creates skill with reference', async () => {
    const filename = await createSkill({
      name: 'Review',
      trigger: 'code review',
      steps: '1. Check PR',
      reference: 'Follow team guidelines',
    });
    expect(filename).toBe('review.md');

    const skill = await getSkill('Review');
    expect(skill!.reference).toContain('team guidelines');
  });
});

describe('buildSkillsContext', () => {
  it('returns null when no skills', async () => {
    expect(await buildSkillsContext()).toBeNull();
  });

  it('builds XML context with skills', async () => {
    await createSkill({ name: 'Deploy', trigger: 'deploy code', steps: '1. Build' });
    await createSkill({ name: 'Review', trigger: 'review PR', steps: '1. Check' });

    const ctx = await buildSkillsContext();
    expect(ctx).toContain('<SKILLS>');
    expect(ctx).toContain('<skill name="Deploy">');
    expect(ctx).toContain('<skill name="Review">');
    expect(ctx).toContain('</SKILLS>');
  });
});

describe('formatSkillList', () => {
  it('formats empty list', () => {
    expect(formatSkillList([])).toBe('No skills registered.');
  });

  it('formats skills', () => {
    const output = formatSkillList([
      { name: 'Deploy', filename: 'deploy.md', trigger: 'When deploying', steps: '', raw: '' },
    ]);
    expect(output).toContain('Deploy');
    expect(output).toContain('deploy.md');
  });
});
