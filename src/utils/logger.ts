/**
 * Structured JSON logger with correlation IDs, log levels, and file output.
 * Replaces ad-hoc console.error() calls throughout the codebase.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  [key: string]: unknown;
}

let currentCorrelationId: string | undefined;
let minLevel: LogLevel = 'info';

/** Metrics counters */
const metrics = {
  requestCount: 0,
  errorCount: 0,
  totalResponseTimeMs: 0,
};

/**
 * Set the minimum log level (default: info).
 */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/**
 * Set the current correlation ID for request tracing.
 */
export function setCorrelationId(id: string | undefined): void {
  currentCorrelationId = id;
}

/**
 * Generate a new correlation ID for a message processing cycle.
 */
export function generateCorrelationId(): string {
  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentCorrelationId = id;
  return id;
}

/**
 * Get the current correlation ID.
 */
export function getCorrelationId(): string | undefined {
  return currentCorrelationId;
}

function getLogDir(): string {
  return path.join(getPilotDir(), 'logs');
}

function getLogFilePath(): string {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(getLogDir(), `pilot-${today}.log`);
}

function writeLog(entry: LogEntry): void {
  if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[minLevel]) return;

  const line = JSON.stringify(entry);

  // Write to file (sync append for reliability)
  try {
    const logDir = getLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(getLogFilePath(), line + '\n');
  } catch {
    // Best-effort logging
  }

  // Also write errors to stderr
  if (entry.level === 'error') {
    console.error(`[${entry.timestamp}] ERROR: ${entry.message}`);
  }
}

export function log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level,
    message,
    correlationId: currentCorrelationId,
    ...extra,
  });
}

export function debug(message: string, extra?: Record<string, unknown>): void {
  log('debug', message, extra);
}

export function info(message: string, extra?: Record<string, unknown>): void {
  log('info', message, extra);
}

export function warn(message: string, extra?: Record<string, unknown>): void {
  log('warn', message, extra);
}

export function error(message: string, extra?: Record<string, unknown>): void {
  log('error', message, extra);
}

// --- Metrics ---

export function recordRequest(): void {
  metrics.requestCount++;
}

export function recordError(): void {
  metrics.errorCount++;
}

export function recordResponseTime(ms: number): void {
  metrics.totalResponseTimeMs += ms;
}

export function getMetrics(): {
  requestCount: number;
  errorCount: number;
  avgResponseTimeMs: number;
} {
  return {
    requestCount: metrics.requestCount,
    errorCount: metrics.errorCount,
    avgResponseTimeMs: metrics.requestCount > 0
      ? Math.round(metrics.totalResponseTimeMs / metrics.requestCount)
      : 0,
  };
}

/**
 * No-op for backward compatibility. Sync writes need no cleanup.
 */
export function closeLogger(): void {
  // No-op: using appendFileSync, no stream to close
}
