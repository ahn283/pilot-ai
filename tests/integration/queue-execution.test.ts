import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../../src/agent/queue.js';

describe('작업 큐 순차 실행', () => {
  it('여러 작업을 순차적으로 실행한다', async () => {
    const queue = new TaskQueue();
    const order: number[] = [];

    queue.onTask(async (task) => {
      if (task.command === '작업1') {
        await new Promise((r) => setTimeout(r, 30));
        order.push(1);
      } else if (task.command === '작업2') {
        order.push(2);
      } else if (task.command === '작업3') {
        order.push(3);
      }
    });

    queue.enqueue({ command: '작업1', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: '작업2', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: '작업3', channelId: 'C1', userId: 'U1' });

    // Wait for all tasks to complete
    await new Promise((r) => setTimeout(r, 200));

    expect(order).toEqual([1, 2, 3]);
  });

  it('큐 상태를 조회할 수 있다', () => {
    const queue = new TaskQueue();
    queue.onTask(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });

    queue.enqueue({ command: '빌드', project: 'api', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: '테스트', project: 'api', channelId: 'C1', userId: 'U1' });

    const status = queue.getStatus();
    // One should be running or queued
    expect(status.running !== null || status.queued.length > 0).toBe(true);
  });

  it('대기 중 작업을 취소할 수 있다', () => {
    const queue = new TaskQueue();
    queue.onTask(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });

    // First task will start running
    queue.enqueue({ command: '느린작업', channelId: 'C1', userId: 'U1' });
    // Second task will be queued
    const task2 = queue.enqueue({ command: '취소될작업', channelId: 'C1', userId: 'U1' });
    const cancelled = queue.cancel(task2.id);
    expect(cancelled).toBe(true);
    expect(task2.status).toBe('cancelled');
  });
});
