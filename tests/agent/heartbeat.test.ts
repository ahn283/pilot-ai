import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import {
  parseCron,
  cronMatches,
  parseHeartbeat,
  loadCronJobs,
  saveCronJobs,
  addCronJob,
  removeCronJob,
  toggleCronJob,
  onJobExecute,
  tick,
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
  formatCronJobs,
  setHeartbeatReporter,
  setHeartbeatApproval,
  type CronJob,
} from '../../src/agent/heartbeat.js';

vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => '/tmp/pilot-heartbeat-test',
}));

beforeEach(async () => {
  await fs.mkdir('/tmp/pilot-heartbeat-test', { recursive: true });
  // Clean up cron-jobs.json
  try { await fs.unlink('/tmp/pilot-heartbeat-test/cron-jobs.json'); } catch {}
  try { await fs.unlink('/tmp/pilot-heartbeat-test/HEARTBEAT.md'); } catch {}
});

afterEach(() => {
  stopScheduler();
});

describe('parseCron', () => {
  it('parses simple cron expression', () => {
    const fields = parseCron('0 9 * * *');
    expect(fields.minute).toEqual([0]);
    expect(fields.hour).toEqual([9]);
    expect(fields.dayOfMonth).toHaveLength(31);
    expect(fields.month).toHaveLength(12);
    expect(fields.dayOfWeek).toHaveLength(7);
  });

  it('parses ranges and steps', () => {
    const fields = parseCron('*/15 9-17 * * 1-5');
    expect(fields.minute).toEqual([0, 15, 30, 45]);
    expect(fields.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(fields.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses comma-separated values', () => {
    const fields = parseCron('0,30 8,12,18 * * *');
    expect(fields.minute).toEqual([0, 30]);
    expect(fields.hour).toEqual([8, 12, 18]);
  });

  it('throws on invalid expression', () => {
    expect(() => parseCron('invalid')).toThrow('Invalid cron expression');
  });
});

describe('cronMatches', () => {
  it('matches a specific time', () => {
    // 2026-03-07 09:00 Saturday (day=6)
    const date = new Date(2026, 2, 7, 9, 0);
    expect(cronMatches('0 9 * * *', date)).toBe(true);
    expect(cronMatches('0 10 * * *', date)).toBe(false);
  });

  it('matches day of week', () => {
    const saturday = new Date(2026, 2, 7, 9, 0); // Saturday=6
    expect(cronMatches('0 9 * * 6', saturday)).toBe(true);
    expect(cronMatches('0 9 * * 1', saturday)).toBe(false);
  });
});

describe('parseHeartbeat', () => {
  it('parses HEARTBEAT.md format', () => {
    const content = `# Heartbeat Schedule
# Comments are ignored

0 9 * * * | git pull && npm test | api
0 18 * * 1-5 | notion daily summary
`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toEqual({ cron: '0 9 * * *', command: 'git pull && npm test', project: 'api' });
    expect(jobs[1]).toEqual({ cron: '0 18 * * 1-5', command: 'notion daily summary', project: undefined });
  });

  it('skips invalid lines', () => {
    const content = `not a cron line
0 9 * * * | valid job
just text | not enough cron fields`;
    const jobs = parseHeartbeat(content);
    expect(jobs).toHaveLength(1);
  });
});

describe('CronJob CRUD', () => {
  it('adds and loads cron jobs', async () => {
    const job = await addCronJob({ cron: '0 9 * * *', command: 'test build', project: 'api' });
    expect(job.id).toBe(1);
    expect(job.enabled).toBe(true);

    const jobs = await loadCronJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].command).toBe('test build');
  });

  it('auto-increments id', async () => {
    await addCronJob({ cron: '0 9 * * *', command: 'first' });
    const second = await addCronJob({ cron: '0 10 * * *', command: 'second' });
    expect(second.id).toBe(2);
  });

  it('removes a job', async () => {
    await addCronJob({ cron: '0 9 * * *', command: 'to-remove' });
    expect(await removeCronJob(1)).toBe(true);
    expect(await removeCronJob(999)).toBe(false);
    expect(await loadCronJobs()).toHaveLength(0);
  });

  it('toggles a job', async () => {
    await addCronJob({ cron: '0 9 * * *', command: 'toggle-me' });
    const toggled = await toggleCronJob(1);
    expect(toggled?.enabled).toBe(false);
    const again = await toggleCronJob(1);
    expect(again?.enabled).toBe(true);
    expect(await toggleCronJob(999)).toBeNull();
  });

  it('rejects invalid cron on add', async () => {
    await expect(addCronJob({ cron: 'bad', command: 'fail' })).rejects.toThrow();
  });
});

describe('tick', () => {
  it('executes matching jobs', async () => {
    const executed: string[] = [];
    onJobExecute(async (job) => { executed.push(job.command); return 'done'; });

    await addCronJob({ cron: '0 9 * * *', command: 'morning task' });
    await addCronJob({ cron: '0 18 * * *', command: 'evening task' });

    const morning = new Date(2026, 2, 7, 9, 0);
    const result = await tick(morning);

    expect(result).toHaveLength(1);
    expect(executed).toEqual(['morning task']);
  });

  it('skips disabled jobs', async () => {
    const executed: string[] = [];
    onJobExecute(async (job) => { executed.push(job.command); return 'done'; });

    await addCronJob({ cron: '0 9 * * *', command: 'disabled-job' });
    await toggleCronJob(1); // disable

    const result = await tick(new Date(2026, 2, 7, 9, 0));
    expect(result).toHaveLength(0);
    expect(executed).toHaveLength(0);
  });

  it('reads HEARTBEAT.md jobs', async () => {
    const executed: string[] = [];
    onJobExecute(async (job) => { executed.push(job.command); return 'done'; });

    await fs.writeFile('/tmp/pilot-heartbeat-test/HEARTBEAT.md', '0 9 * * * | heartbeat job\n');

    const result = await tick(new Date(2026, 2, 7, 9, 0));
    expect(result).toHaveLength(1);
    expect(executed).toEqual(['heartbeat job']);
  });

  it('records lastError on failure', async () => {
    onJobExecute(async (): Promise<string> => { throw new Error('task failed'); });

    await addCronJob({ cron: '0 9 * * *', command: 'failing-task' });
    await tick(new Date(2026, 2, 7, 9, 0));

    const jobs = await loadCronJobs();
    expect(jobs[0].lastError).toBe('task failed');
    expect(jobs[0].lastRunAt).toBeTruthy();
  });
});

describe('scheduler lifecycle', () => {
  it('starts and stops', () => {
    expect(isSchedulerRunning()).toBe(false);
    startScheduler();
    expect(isSchedulerRunning()).toBe(true);
    stopScheduler();
    expect(isSchedulerRunning()).toBe(false);
  });

  it('does not start twice', () => {
    startScheduler();
    startScheduler(); // should be no-op
    expect(isSchedulerRunning()).toBe(true);
    stopScheduler();
  });
});

describe('formatCronJobs', () => {
  it('formats empty list', () => {
    expect(formatCronJobs([])).toBe('No scheduled jobs.');
  });

  it('formats job list', () => {
    const jobs: CronJob[] = [
      { id: 1, cron: '0 9 * * *', command: 'build', enabled: true, createdAt: '', project: 'api' },
      { id: 2, cron: '0 18 * * *', command: 'deploy', enabled: false, createdAt: '' },
    ];
    const output = formatCronJobs(jobs);
    expect(output).toContain('#1 [ON]');
    expect(output).toContain('[api]');
    expect(output).toContain('#2 [OFF]');
  });
});

describe('messenger reporting', () => {
  it('reports successful execution to messenger', async () => {
    const sent: string[] = [];
    const mockReporter = {
      sendText: vi.fn(async (_ch: string, text: string) => { sent.push(text); return 'ts'; }),
      sendApproval: vi.fn(async () => {}),
    };
    setHeartbeatReporter(mockReporter, 'C123');
    onJobExecute(async () => 'Build succeeded');

    await addCronJob({ cron: '0 9 * * *', command: 'npm run build' });
    await tick(new Date(2026, 2, 7, 9, 0));

    expect(mockReporter.sendText).toHaveBeenCalled();
    expect(sent[0]).toContain('Scheduled task completed');
    expect(sent[0]).toContain('Build succeeded');

    // Clean up
    setHeartbeatReporter(null as any, '');
  });

  it('reports errors to messenger', async () => {
    const sent: string[] = [];
    const mockReporter = {
      sendText: vi.fn(async (_ch: string, text: string) => { sent.push(text); return 'ts'; }),
      sendApproval: vi.fn(async () => {}),
    };
    setHeartbeatReporter(mockReporter, 'C123');
    onJobExecute(async (): Promise<string> => { throw new Error('build failed'); });

    await addCronJob({ cron: '0 9 * * *', command: 'npm run build' });
    await tick(new Date(2026, 2, 7, 9, 0));

    expect(sent[0]).toContain('Scheduled task failed');
    expect(sent[0]).toContain('build failed');

    setHeartbeatReporter(null as any, '');
  });
});

describe('dangerous action approval', () => {
  it('requests approval for dangerous scheduled tasks', async () => {
    const mockReporter = {
      sendText: vi.fn(async () => 'ts'),
      sendApproval: vi.fn(async () => {}),
    };
    const mockApproval = {
      requestApproval: vi.fn(async () => true),
    };
    setHeartbeatReporter(mockReporter, 'C123');
    setHeartbeatApproval(mockApproval);
    onJobExecute(async () => 'deployed');

    await addCronJob({ cron: '0 9 * * *', command: 'deploy to production' });
    await tick(new Date(2026, 2, 7, 9, 0));

    expect(mockReporter.sendApproval).toHaveBeenCalled();
    expect(mockApproval.requestApproval).toHaveBeenCalled();

    setHeartbeatReporter(null as any, '');
    setHeartbeatApproval(null as any);
  });

  it('skips execution when approval denied', async () => {
    const executed: string[] = [];
    const mockReporter = {
      sendText: vi.fn(async () => 'ts'),
      sendApproval: vi.fn(async () => {}),
    };
    const mockApproval = {
      requestApproval: vi.fn(async () => false),
    };
    setHeartbeatReporter(mockReporter, 'C123');
    setHeartbeatApproval(mockApproval);
    onJobExecute(async (job) => { executed.push(job.command); return 'done'; });

    await addCronJob({ cron: '0 9 * * *', command: 'git push --force' });
    await tick(new Date(2026, 2, 7, 9, 0));

    expect(executed).toHaveLength(0);
    const jobs = await loadCronJobs();
    expect(jobs[0].lastError).toContain('Approval denied');

    setHeartbeatReporter(null as any, '');
    setHeartbeatApproval(null as any);
  });
});
