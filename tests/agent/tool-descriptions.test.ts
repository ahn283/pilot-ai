import { describe, it, expect } from 'vitest';
import { buildToolDescriptions } from '../../src/agent/tool-descriptions.js';

describe('buildToolDescriptions', () => {
  it('returns XML with available tools', () => {
    const result = buildToolDescriptions();
    expect(result).toContain('<AVAILABLE_TOOLS>');
    expect(result).toContain('</AVAILABLE_TOOLS>');
  });

  it('includes heartbeat CRUD tools', () => {
    const result = buildToolDescriptions();
    expect(result).toContain('addCronJob');
    expect(result).toContain('removeCronJob');
    expect(result).toContain('toggleCronJob');
    expect(result).toContain('listCronJobs');
  });

  it('includes skills CRUD tools', () => {
    const result = buildToolDescriptions();
    expect(result).toContain('createSkill');
    expect(result).toContain('deleteSkill');
    expect(result).toContain('listSkills');
  });

  it('includes cron expression param for addCronJob', () => {
    const result = buildToolDescriptions();
    expect(result).toContain('5-field cron expression');
  });
});
