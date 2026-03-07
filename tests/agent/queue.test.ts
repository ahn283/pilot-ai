import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../../src/agent/queue.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('TaskQueue - basic', () => {
  it('enqueued task runs immediately', async () => {
    const queue = new TaskQueue();
    const executed: string[] = [];

    queue.onTask(async (task) => { executed.push(task.command); });
    queue.enqueue({ command: 'task-1', channelId: 'C1', userId: 'U1' });
    await delay(10);
    expect(executed).toContain('task-1');
  });

  it('cancel queued task', async () => {
    const queue = new TaskQueue(1);
    queue.onTask(async () => { await delay(100); });

    queue.enqueue({ command: 'running', project: 'a', channelId: 'C1', userId: 'U1' });
    const task2 = queue.enqueue({ command: 'to-cancel', project: 'a', channelId: 'C1', userId: 'U1' });

    const cancelled = queue.cancel(task2.id);
    expect(cancelled).toBe(true);
    expect(task2.status).toBe('cancelled');
  });

  it('cannot cancel running task', async () => {
    const queue = new TaskQueue();
    queue.onTask(async () => { await delay(50); });

    const task = queue.enqueue({ command: 'running', channelId: 'C1', userId: 'U1' });
    await delay(5);
    expect(queue.cancel(task.id)).toBe(false);
  });

  it('failed task has error', async () => {
    const queue = new TaskQueue();
    queue.onTask(async () => { throw new Error('boom'); });

    const task = queue.enqueue({ command: 'will-fail', channelId: 'C1', userId: 'U1' });
    await delay(10);
    expect(task.status).toBe('failed');
    expect(task.error).toBe('boom');
  });

  it('formatStatus returns readable string', () => {
    const queue = new TaskQueue();
    expect(queue.formatStatus()).toContain('No pending tasks');
  });
});

describe('TaskQueue - same project sequential', () => {
  it('same project tasks run sequentially', async () => {
    const queue = new TaskQueue();
    const order: number[] = [];

    queue.onTask(async (task) => {
      await delay(20);
      order.push(parseInt(task.command));
    });

    queue.enqueue({ command: '1', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: '2', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: '3', project: 'api', channelId: 'C1', userId: 'U1' });

    await delay(120);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('TaskQueue - different project parallel', () => {
  it('different projects run in parallel', async () => {
    const queue = new TaskQueue();
    const running: string[] = [];
    let maxConcurrent = 0;

    queue.onTask(async (task) => {
      running.push(task.project!);
      maxConcurrent = Math.max(maxConcurrent, running.length);
      await delay(30);
      running.splice(running.indexOf(task.project!), 1);
    });

    queue.enqueue({ command: 'build', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'build', project: 'frontend', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'build', project: 'backend', channelId: 'C1', userId: 'U1' });

    await delay(80);
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
  });

  it('null-project tasks run in parallel with everything', async () => {
    const queue = new TaskQueue();
    const running: string[] = [];
    let maxConcurrent = 0;

    queue.onTask(async (task) => {
      running.push(task.command);
      maxConcurrent = Math.max(maxConcurrent, running.length);
      await delay(30);
      running.splice(running.indexOf(task.command), 1);
    });

    queue.enqueue({ command: 'code', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'notion', channelId: 'C1', userId: 'U1' }); // null project

    await delay(60);
    expect(maxConcurrent).toBe(2);
  });
});

describe('TaskQueue - maxConcurrent', () => {
  it('respects max concurrent limit', async () => {
    const queue = new TaskQueue(2);
    let currentRunning = 0;
    let peakRunning = 0;

    queue.onTask(async () => {
      currentRunning++;
      peakRunning = Math.max(peakRunning, currentRunning);
      await delay(30);
      currentRunning--;
    });

    queue.enqueue({ command: 't1', project: 'a', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 't2', project: 'b', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 't3', project: 'c', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 't4', project: 'd', channelId: 'C1', userId: 'U1' });

    await delay(120);
    expect(peakRunning).toBeLessThanOrEqual(2);
  });

  it('getRunningCount tracks concurrent tasks', async () => {
    const queue = new TaskQueue(3);
    queue.onTask(async () => { await delay(50); });

    queue.enqueue({ command: 't1', project: 'a', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 't2', project: 'b', channelId: 'C1', userId: 'U1' });
    await delay(5);

    expect(queue.getRunningCount()).toBe(2);
  });
});

describe('TaskQueue - mixed', () => {
  it('same project blocks while different project proceeds', async () => {
    const queue = new TaskQueue();
    const completionOrder: string[] = [];

    queue.onTask(async (task) => {
      if (task.command === 'slow-api') await delay(60);
      else await delay(10);
      completionOrder.push(task.command);
    });

    queue.enqueue({ command: 'slow-api', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'fast-fe', project: 'frontend', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'queued-api', project: 'api', channelId: 'C1', userId: 'U1' });

    await delay(120);

    // fast-fe finishes before slow-api because it's a different project
    expect(completionOrder.indexOf('fast-fe')).toBeLessThan(completionOrder.indexOf('slow-api'));
    // queued-api runs after slow-api (same project)
    expect(completionOrder.indexOf('slow-api')).toBeLessThan(completionOrder.indexOf('queued-api'));
  });
});
