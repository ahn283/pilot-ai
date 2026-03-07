import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPilotDir } from '../config/store.js';
import { classifySafety } from './safety.js';

export interface CronJob {
  id: number;
  cron: string;
  command: string;
  project?: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastError?: string;
}

export type JobExecutor = (job: CronJob) => Promise<string>;

export interface HeartbeatReporter {
  sendText(channelId: string, text: string): Promise<string>;
  sendApproval(channelId: string, text: string, taskId: string): Promise<void>;
}

export interface HeartbeatApprovalRequest {
  requestApproval(taskId: string, action: string, timeoutMs: number): Promise<boolean>;
}

let reporter: HeartbeatReporter | null = null;
let approvalManager: HeartbeatApprovalRequest | null = null;
let reportChannelId: string | null = null;

export function setHeartbeatReporter(r: HeartbeatReporter, channelId: string): void {
  reporter = r;
  reportChannelId = channelId;
}

export function setHeartbeatApproval(a: HeartbeatApprovalRequest): void {
  approvalManager = a;
}

function getCronJobsPath(): string {
  return path.join(getPilotDir(), 'cron-jobs.json');
}

function getHeartbeatPath(): string {
  return path.join(getPilotDir(), 'HEARTBEAT.md');
}

// --- Cron expression parser ---

interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    if (range === '*') {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      for (let i = start; i <= end; i += step) values.add(i);
    } else {
      values.add(parseInt(range, 10));
    }
  }

  return [...values].sort((a, b) => a - b);
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expression}" (expected 5 fields)`);

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

export function cronMatches(expression: string, date: Date): boolean {
  const fields = parseCron(expression);
  return (
    fields.minute.includes(date.getMinutes()) &&
    fields.hour.includes(date.getHours()) &&
    fields.dayOfMonth.includes(date.getDate()) &&
    fields.month.includes(date.getMonth() + 1) &&
    fields.dayOfWeek.includes(date.getDay())
  );
}

// --- HEARTBEAT.md parser ---

export function parseHeartbeat(content: string): Array<{ cron: string; command: string; project?: string }> {
  const jobs: Array<{ cron: string; command: string; project?: string }> = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Format: `CRON_EXPR | command [| project]`
    // Example: `0 9 * * * | git pull && npm test | api`
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    const parts = trimmed.split('|').map((p) => p.trim());
    if (parts.length < 2) continue;

    const cron = parts[0];
    const command = parts[1];
    const project = parts[2] || undefined;

    // Validate cron has 5 fields
    if (cron.split(/\s+/).length !== 5) continue;

    jobs.push({ cron, command, project });
  }

  return jobs;
}

// --- CronJob store ---

export async function loadCronJobs(): Promise<CronJob[]> {
  try {
    const data = await fs.readFile(getCronJobsPath(), 'utf-8');
    return JSON.parse(data) as CronJob[];
  } catch {
    return [];
  }
}

export async function saveCronJobs(jobs: CronJob[]): Promise<void> {
  await fs.writeFile(getCronJobsPath(), JSON.stringify(jobs, null, 2), 'utf-8');
}

function nextId(jobs: CronJob[]): number {
  if (jobs.length === 0) return 1;
  return Math.max(...jobs.map((j) => j.id)) + 1;
}

export async function addCronJob(params: {
  cron: string;
  command: string;
  project?: string;
}): Promise<CronJob> {
  // Validate cron expression
  parseCron(params.cron);

  const jobs = await loadCronJobs();
  const job: CronJob = {
    id: nextId(jobs),
    cron: params.cron,
    command: params.command,
    project: params.project,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  jobs.push(job);
  await saveCronJobs(jobs);
  return job;
}

export async function removeCronJob(id: number): Promise<boolean> {
  const jobs = await loadCronJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return false;
  jobs.splice(idx, 1);
  await saveCronJobs(jobs);
  return true;
}

export async function toggleCronJob(id: number): Promise<CronJob | null> {
  const jobs = await loadCronJobs();
  const job = jobs.find((j) => j.id === id);
  if (!job) return null;
  job.enabled = !job.enabled;
  await saveCronJobs(jobs);
  return job;
}

// --- Scheduler ---

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let executor: JobExecutor | null = null;

export function onJobExecute(handler: JobExecutor): void {
  executor = handler;
}

export async function tick(now?: Date): Promise<CronJob[]> {
  const date = now ?? new Date();
  const executedJobs: CronJob[] = [];

  // Load jobs from cron-jobs.json
  const jobs = await loadCronJobs();

  // Also parse HEARTBEAT.md for additional jobs
  let heartbeatJobs: Array<{ cron: string; command: string; project?: string }> = [];
  try {
    const content = await fs.readFile(getHeartbeatPath(), 'utf-8');
    heartbeatJobs = parseHeartbeat(content);
  } catch {
    // HEARTBEAT.md doesn't exist, that's fine
  }

  // Merge: heartbeat jobs treated as always-enabled virtual jobs
  const allJobs: Array<{ job?: CronJob; cron: string; command: string; project?: string }> = [
    ...jobs.filter((j) => j.enabled).map((j) => ({ job: j, cron: j.cron, command: j.command, project: j.project })),
    ...heartbeatJobs.map((h) => ({ cron: h.cron, command: h.command, project: h.project })),
  ];

  for (const entry of allJobs) {
    if (!cronMatches(entry.cron, date)) continue;

    const cronJob: CronJob = entry.job ?? {
      id: 0,
      cron: entry.cron,
      command: entry.command,
      project: entry.project,
      enabled: true,
      createdAt: '',
    };

    // Check dangerous actions and request approval
    const safety = classifySafety(cronJob.command);
    if (safety === 'dangerous' && approvalManager && reporter && reportChannelId) {
      const taskId = `heartbeat-${cronJob.id}-${crypto.randomUUID().slice(0, 8)}`;
      await reporter.sendApproval(
        reportChannelId,
        `⚠️ Scheduled task requires approval:\n\`${cronJob.command}\`\nCron: ${cronJob.cron}`,
        taskId,
      );
      const approved = await approvalManager.requestApproval(taskId, cronJob.command, 30 * 60 * 1000);
      if (!approved) {
        if (entry.job) {
          entry.job.lastRunAt = date.toISOString();
          entry.job.lastError = 'Approval denied or timed out';
        }
        executedJobs.push(cronJob);
        continue;
      }
    }

    if (executor) {
      try {
        const result = await executor(cronJob);
        if (entry.job) {
          entry.job.lastRunAt = date.toISOString();
          entry.job.lastError = undefined;
        }
        // Report result via messenger
        if (reporter && reportChannelId) {
          const proj = cronJob.project ? ` [${cronJob.project}]` : '';
          const summary = result.length > 500 ? result.slice(0, 500) + '...' : result;
          await reporter.sendText(
            reportChannelId,
            `✅ Scheduled task completed${proj}:\n\`${cronJob.command}\`\n${summary}`,
          ).catch(() => {});
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (entry.job) {
          entry.job.lastRunAt = date.toISOString();
          entry.job.lastError = errorMsg;
        }
        // Report error via messenger
        if (reporter && reportChannelId) {
          await reporter.sendText(
            reportChannelId,
            `❌ Scheduled task failed:\n\`${cronJob.command}\`\nError: ${errorMsg}`,
          ).catch(() => {});
        }
      }
    }

    executedJobs.push(cronJob);
  }

  // Save updated lastRunAt/lastError
  if (executedJobs.some((j) => j.id !== 0)) {
    await saveCronJobs(jobs);
  }

  return executedJobs;
}

export function startScheduler(): void {
  if (intervalHandle) return;
  // Check every 60 seconds
  intervalHandle = setInterval(() => {
    tick().catch(() => {});
  }, 60_000);
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function isSchedulerRunning(): boolean {
  return intervalHandle !== null;
}

export function formatCronJobs(jobs: CronJob[]): string {
  if (jobs.length === 0) return 'No scheduled jobs.';

  const lines = ['Scheduled Jobs:'];
  for (const job of jobs) {
    const status = job.enabled ? 'ON' : 'OFF';
    const proj = job.project ? ` [${job.project}]` : '';
    const lastRun = job.lastRunAt ? ` (last: ${job.lastRunAt})` : '';
    const error = job.lastError ? ` ERROR: ${job.lastError}` : '';
    lines.push(`  #${job.id} [${status}] ${job.cron}${proj} - ${job.command}${lastRun}${error}`);
  }
  return lines.join('\n');
}
