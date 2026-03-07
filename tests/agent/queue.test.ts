import { describe, it, expect, vi } from 'vitest';
import { TaskQueue } from '../../src/agent/queue.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('TaskQueue', () => {
  it('작업을 큐에 넣으면 즉시 실행된다', async () => {
    const queue = new TaskQueue();
    const executed: string[] = [];

    queue.onTask(async (task) => {
      executed.push(task.command);
    });

    queue.enqueue({ command: 'task-1', channelId: 'C1', userId: 'U1' });
    await delay(10);
    expect(executed).toContain('task-1');
  });

  it('순차적으로 실행된다 (FIFO)', async () => {
    const queue = new TaskQueue();
    const executed: string[] = [];

    queue.onTask(async (task) => {
      await delay(20);
      executed.push(task.command);
    });

    queue.enqueue({ command: 'first', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'second', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'third', channelId: 'C1', userId: 'U1' });

    await delay(100);
    expect(executed).toEqual(['first', 'second', 'third']);
  });

  it('대기 중인 작업을 취소할 수 있다', async () => {
    const queue = new TaskQueue();
    const executed: string[] = [];

    queue.onTask(async (task) => {
      await delay(30);
      executed.push(task.command);
    });

    queue.enqueue({ command: 'running', channelId: 'C1', userId: 'U1' });
    const task2 = queue.enqueue({ command: 'to-cancel', channelId: 'C1', userId: 'U1' });

    const cancelled = queue.cancel(task2.id);
    expect(cancelled).toBe(true);
    expect(task2.status).toBe('cancelled');
  });

  it('실행 중인 작업은 취소할 수 없다', async () => {
    const queue = new TaskQueue();
    queue.onTask(async () => { await delay(50); });

    const task = queue.enqueue({ command: 'running', channelId: 'C1', userId: 'U1' });
    await delay(5);
    const cancelled = queue.cancel(task.id);
    expect(cancelled).toBe(false);
  });

  it('큐 상태를 조회할 수 있다', async () => {
    const queue = new TaskQueue();
    queue.onTask(async () => { await delay(50); });

    queue.enqueue({ command: 'task-1', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 'task-2', channelId: 'C1', userId: 'U1' });
    await delay(5);

    const status = queue.getStatus();
    expect(status.running?.command).toBe('task-1');
    expect(status.queued).toHaveLength(1);
  });

  it('실패한 작업은 failed 상태가 된다', async () => {
    const queue = new TaskQueue();
    queue.onTask(async () => { throw new Error('작업 실패'); });

    const task = queue.enqueue({ command: 'will-fail', channelId: 'C1', userId: 'U1' });
    await delay(10);
    expect(task.status).toBe('failed');
    expect(task.error).toBe('작업 실패');
  });

  it('formatStatus가 읽을 수 있는 문자열을 반환한다', () => {
    const queue = new TaskQueue();
    const status = queue.formatStatus();
    expect(status).toContain('대기 중인 작업이 없습니다');
  });

  it('getQueueLength가 대기 중 작업 수를 반환한다', async () => {
    const queue = new TaskQueue();
    queue.onTask(async () => { await delay(50); });

    queue.enqueue({ command: 't1', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 't2', channelId: 'C1', userId: 'U1' });
    queue.enqueue({ command: 't3', channelId: 'C1', userId: 'U1' });
    await delay(5);

    expect(queue.getQueueLength()).toBe(2); // t1은 running, t2/t3는 queued
  });
});
