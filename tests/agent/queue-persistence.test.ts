import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TaskQueue } from '../../src/agent/queue.js';
import { getPilotDir } from '../../src/config/store.js';

const queueFilePath = path.join(getPilotDir(), 'task-queue.json');

function cleanupQueueFile() {
  try { fs.unlinkSync(queueFilePath); } catch {}
}

// A handler that blocks forever (tasks stay in running state)
function blockingHandler(): Promise<void> {
  return new Promise(() => {});
}

describe('TaskQueue persistence', () => {
  beforeEach(() => {
    cleanupQueueFile();
  });

  afterEach(() => {
    cleanupQueueFile();
  });

  it('persists queued tasks to disk', async () => {
    const queue = new TaskQueue(1);
    // Set blocking handler so first task stays running, second stays queued
    queue.onTask(blockingHandler);
    queue.enqueue({ command: 'running task', channelId: 'C123', userId: 'U456' });
    queue.enqueue({ command: 'queued task', channelId: 'C123', userId: 'U456' });

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 1200));

    expect(fs.existsSync(queueFilePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
    expect(data.length).toBe(2);
    expect(data.some((t: { command: string; status: string }) => t.command === 'queued task' && t.status === 'queued')).toBe(true);
  });

  it('restores queued tasks from disk', () => {
    const tasks = [
      {
        id: 'task-1',
        status: 'queued',
        project: null,
        command: 'restored command',
        channelId: 'C123',
        userId: 'U456',
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      },
    ];
    fs.writeFileSync(queueFilePath, JSON.stringify(tasks));

    const queue = new TaskQueue(1);
    // Don't set handler so we can inspect restore results before processing
    const restored = queue.restoreFromDisk();
    expect(restored.length).toBe(1);
    expect(restored[0].command).toBe('restored command');
    // Note: without a handler set, processNext will run and complete immediately
    // Check the restored object before processing changes it
    expect(restored[0].id).toBe('task-1');
  });

  it('marks running tasks as failed on restore', () => {
    const tasks = [
      {
        id: 'task-1',
        status: 'running',
        project: null,
        command: 'interrupted task',
        channelId: 'C123',
        userId: 'U456',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    ];
    fs.writeFileSync(queueFilePath, JSON.stringify(tasks));

    const queue = new TaskQueue(1);
    const restored = queue.restoreFromDisk();
    expect(restored[0].status).toBe('failed');
    expect(restored[0].error).toContain('Daemon restarted');
  });

  it('returns empty array when no queue file exists', () => {
    const queue = new TaskQueue(1);
    const restored = queue.restoreFromDisk();
    expect(restored).toEqual([]);
  });
});

describe('TaskQueue max size', () => {
  it('rejects enqueue when queue is full', () => {
    const queue = new TaskQueue(1);
    // Use blocking handler so tasks stay queued/running instead of completing
    queue.onTask(blockingHandler);
    // First task goes to running, rest stay queued
    for (let i = 0; i < 51; i++) {
      queue.enqueue({ command: `task ${i}`, channelId: 'C', userId: 'U' });
    }
    // 1 running + 50 queued = 51 total. Next enqueue should fail
    expect(() => {
      queue.enqueue({ command: 'overflow', channelId: 'C', userId: 'U' });
    }).toThrow('Task queue is full');
  });
});

describe('TaskQueue backpressure', () => {
  it('fires backpressure callback when threshold exceeded', () => {
    const queue = new TaskQueue(1);
    queue.onTask(blockingHandler);
    const cb = vi.fn();
    queue.setBackpressureCallback(cb);

    // First task runs, so we need 22 total to have 21 queued
    for (let i = 0; i < 22; i++) {
      queue.enqueue({ command: `task ${i}`, channelId: 'C', userId: 'U' });
    }
    expect(cb).toHaveBeenCalledWith(21);
  });
});
