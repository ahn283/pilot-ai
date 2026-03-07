export type TaskStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  status: TaskStatus;
  project: string | null;
  command: string;
  threadId?: string;
  channelId: string;
  userId: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  result?: string;
  error?: string;
}

export type TaskHandler = (task: Task) => Promise<void>;

let taskCounter = 0;

function generateTaskId(): string {
  return `task-${Date.now()}-${++taskCounter}`;
}

/**
 * 순차 실행 큐 (FIFO). Phase 1은 모든 작업을 순차 처리한다.
 */
export class TaskQueue {
  private queue: Task[] = [];
  private running: Task | null = null;
  private handler: TaskHandler | null = null;

  onTask(handler: TaskHandler): void {
    this.handler = handler;
  }

  enqueue(params: {
    command: string;
    project?: string;
    channelId: string;
    userId: string;
    threadId?: string;
  }): Task {
    const task: Task = {
      id: generateTaskId(),
      status: 'queued',
      project: params.project ?? null,
      command: params.command,
      channelId: params.channelId,
      userId: params.userId,
      threadId: params.threadId,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };

    this.queue.push(task);
    this.processNext();
    return task;
  }

  private async processNext(): Promise<void> {
    if (this.running) return;

    const task = this.queue.find((t) => t.status === 'queued');
    if (!task) return;

    this.running = task;
    task.status = 'running';
    task.startedAt = new Date();

    try {
      if (this.handler) {
        await this.handler(task);
      }
      task.status = 'completed';
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
    } finally {
      task.completedAt = new Date();
      this.running = null;
      this.processNext();
    }
  }

  cancel(taskId: string): boolean {
    const task = this.queue.find((t) => t.id === taskId && t.status === 'queued');
    if (!task) return false;
    task.status = 'cancelled';
    task.completedAt = new Date();
    return true;
  }

  getStatus(): { running: Task | null; queued: Task[]; completed: Task[] } {
    return {
      running: this.running,
      queued: this.queue.filter((t) => t.status === 'queued'),
      completed: this.queue.filter((t) => t.status === 'completed' || t.status === 'failed'),
    };
  }

  getTask(taskId: string): Task | undefined {
    return this.queue.find((t) => t.id === taskId);
  }

  getQueueLength(): number {
    return this.queue.filter((t) => t.status === 'queued').length;
  }

  formatStatus(): string {
    const { running, queued } = this.getStatus();
    const lines: string[] = ['현재 작업 큐:'];

    if (running) {
      const elapsed = Math.floor((Date.now() - (running.startedAt?.getTime() ?? Date.now())) / 1000);
      lines.push(`  [${running.id}] running - ${running.command} (${elapsed}초 경과)`);
    }

    for (const task of queued) {
      lines.push(`  [${task.id}] queued - ${task.command}`);
    }

    if (!running && queued.length === 0) {
      lines.push('  대기 중인 작업이 없습니다.');
    }

    return lines.join('\n');
  }
}
