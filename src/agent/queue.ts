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
 * Task queue with project-based parallel execution.
 * - Different projects run in parallel
 * - Same project tasks run sequentially
 * - Null-project tasks (Notion, browser) run in parallel with everything
 * - Max concurrent limit to respect Claude CLI rate limits
 */
export class TaskQueue {
  private queue: Task[] = [];
  private runningTasks: Set<Task> = new Set();
  private handler: TaskHandler | null = null;
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

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
    if (this.runningTasks.size >= this.maxConcurrent) return;

    const nextTask = this.findNextRunnable();
    if (!nextTask) return;

    this.runningTasks.add(nextTask);
    nextTask.status = 'running';
    nextTask.startedAt = new Date();

    // Run async without blocking processNext
    this.executeTask(nextTask).finally(() => {
      this.runningTasks.delete(nextTask);
      // Try to start more tasks
      this.processNext();
    });

    // Try to start more parallel tasks immediately
    if (this.runningTasks.size < this.maxConcurrent) {
      this.processNext();
    }
  }

  /**
   * Finds the next task that can run based on project parallelism rules.
   */
  private findNextRunnable(): Task | null {
    const runningProjects = new Set<string>();
    for (const task of this.runningTasks) {
      if (task.project) runningProjects.add(task.project);
    }

    for (const task of this.queue) {
      if (task.status !== 'queued') continue;

      // Null-project tasks can always run (no project conflict)
      if (task.project === null) return task;

      // Project tasks can run only if no other task for the same project is running
      if (!runningProjects.has(task.project)) return task;
    }

    return null;
  }

  private async executeTask(task: Task): Promise<void> {
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
    }
  }

  cancel(taskId: string): boolean {
    const task = this.queue.find((t) => t.id === taskId && t.status === 'queued');
    if (!task) return false;
    task.status = 'cancelled';
    task.completedAt = new Date();
    return true;
  }

  getStatus(): { running: Task[]; queued: Task[]; completed: Task[] } {
    return {
      running: [...this.runningTasks],
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

  getRunningCount(): number {
    return this.runningTasks.size;
  }

  formatStatus(): string {
    const { running, queued } = this.getStatus();
    const lines: string[] = ['Task Queue:'];

    for (const task of running) {
      const elapsed = Math.floor((Date.now() - (task.startedAt?.getTime() ?? Date.now())) / 1000);
      const proj = task.project ? `[${task.project}] ` : '';
      lines.push(`  [${task.id}] running - ${proj}${task.command} (${elapsed}s)`);
    }

    for (const task of queued) {
      const proj = task.project ? `[${task.project}] ` : '';
      lines.push(`  [${task.id}] queued - ${proj}${task.command}`);
    }

    if (running.length === 0 && queued.length === 0) {
      lines.push('  No pending tasks.');
    }

    return lines.join('\n');
  }
}
