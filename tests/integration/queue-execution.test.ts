import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../../src/agent/queue.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Queue execution integration', () => {
  it('same-project tasks execute sequentially', async () => {
    const queue = new TaskQueue();
    const order: number[] = [];

    queue.onTask(async (task) => {
      if (task.command === 'task1') {
        await delay(30);
        order.push(1);
      } else if (task.command === 'task2') {
        order.push(2);
      } else if (task.command === 'task3') {
        order.push(3);
      }
    });

    queue.enqueue({ command: 'task1', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'task2', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'task3', project: 'api', channelId: 'C1', userId: 'U1' });

    await delay(200);

    expect(order).toEqual([1, 2, 3]);
  });

  it('getStatus returns running and queued arrays', () => {
    const queue = new TaskQueue();
    queue.onTask(async () => {
      await delay(500);
    });

    queue.enqueue({ command: 'build', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'test', project: 'api', channelId: 'C1', userId: 'U1' });

    const status = queue.getStatus();
    expect(status.running.length + status.queued.length).toBeGreaterThan(0);
  });

  it('cancel a queued task', () => {
    const queue = new TaskQueue();
    queue.onTask(async () => {
      await delay(500);
    });

    queue.enqueue({ command: 'slow-task', project: 'api', channelId: 'C1', userId: 'U1' });
    const task2 = queue.enqueue({ command: 'to-cancel', project: 'api', channelId: 'C1', userId: 'U1' });
    const cancelled = queue.cancel(task2.id);
    expect(cancelled).toBe(true);
    expect(task2.status).toBe('cancelled');
  });
});
