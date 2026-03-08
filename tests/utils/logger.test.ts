import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  log, info, warn, error, debug,
  setLogLevel,
  generateCorrelationId,
  getCorrelationId,
  setCorrelationId,
  recordRequest,
  recordError,
  recordResponseTime,
  getMetrics,
  closeLogger,
} from '../../src/utils/logger.js';
import { getPilotDir } from '../../src/config/store.js';

const logDir = path.join(getPilotDir(), 'logs');

describe('logger', () => {
  afterEach(() => {
    closeLogger();
    setCorrelationId(undefined);
    setLogLevel('info');
  });

  it('writes log entries to file', () => {
    info('test message');
    closeLogger(); // flush

    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `pilot-${today}.log`);
    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('test message');
  });

  it('writes JSON format', () => {
    info('json test', { key: 'value' });
    closeLogger();

    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `pilot-${today}.log`);
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.level).toBe('info');
    expect(last.message).toBe('json test');
    expect(last.key).toBe('value');
  });

  it('includes correlation ID when set', () => {
    const id = generateCorrelationId();
    info('correlated message');
    closeLogger();

    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `pilot-${today}.log`);
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.correlationId).toBe(id);
  });

  it('respects log level filtering', () => {
    setLogLevel('warn');
    const linesBefore = getLogLineCount();
    debug('should be filtered');
    info('should be filtered');
    closeLogger();
    const linesAfter = getLogLineCount();
    expect(linesAfter).toBe(linesBefore);
  });

  it('generates unique correlation IDs', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1.startsWith('req-')).toBe(true);
  });

  it('getCorrelationId returns current ID', () => {
    setCorrelationId(undefined);
    expect(getCorrelationId()).toBeUndefined();
    setCorrelationId('test-123');
    expect(getCorrelationId()).toBe('test-123');
  });
});

describe('metrics', () => {
  it('tracks request count and response time', () => {
    recordRequest();
    recordRequest();
    recordResponseTime(100);
    recordResponseTime(200);
    const m = getMetrics();
    expect(m.requestCount).toBeGreaterThanOrEqual(2);
    expect(m.avgResponseTimeMs).toBeGreaterThan(0);
  });

  it('tracks error count', () => {
    const before = getMetrics().errorCount;
    recordError();
    expect(getMetrics().errorCount).toBe(before + 1);
  });
});

function getLogLineCount(): number {
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(logDir, `pilot-${today}.log`);
  try {
    return fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}
