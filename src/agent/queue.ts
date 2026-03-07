import { createWorktree, removeWorktree, type WorktreeInfo } from './worktree.js';

export type TaskStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  status: TaskStatus;
  project: string | null;
  projectPath?: string;
  command: string;
  threadId?: string;
  channelId: string;
  userId: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  result?: string;
  error?: string;
  worktree?: WorktreeInfo;
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
  private worktreeEnabled: boolean;

  constructor(maxConcurrent: number = 3, worktreeEnabled: boolean = false) {
    this.maxConcurrent = maxConcurrent;
    this.worktreeEnabled = worktreeEnabled;
  }

  onTask(handler: TaskHandler): void {
    this.handler = handler;
  }

  enqueue(params: {
    command: string;
    project?: string;
    projectPath?: string;
    channelId: string;
    userId: string;
    threadId?: string;
  }): Task {
    const task: Task = {
      id: generateTaskId(),
      status: 'queued',
      project: params.project ?? null,
      projectPath: params.projectPath,
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
   * With worktree enabled, same-project tasks can run in parallel via worktrees.
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

      // No conflict - run directly
      if (!runningProjects.has(task.project)) return task;

      // Worktree mode: allow same-project if projectPath is available
      if (this.worktreeEnabled && task.projectPath) return task;
    }

    return null;
  }

  private async executeTask(task: Task): Promise<void> {
    // If same project is already running and worktree is enabled, create worktree
    if (this.worktreeEnabled && task.project && task.projectPath) {
      const alreadyRunning = [...this.runningTasks].some(
        (t) => t !== task && t.project === task.project && !t.worktree,
      );
      if (alreadyRunning) {
        try {
          task.worktree = await createWorktree(task.projectPath, task.id);
        } catch {
          // Worktree creation failed - fall back to sequential wait handled elsewhere
        }
      }
    }

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
      // Clean up worktree
      if (task.worktree && task.projectPath) {
        try {
          await removeWorktree(task.projectPath, task.worktree.path, task.worktree.branch);
        } catch {
          // Best-effort cleanup
        }
      }
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
