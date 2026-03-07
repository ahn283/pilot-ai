import { describe, it, expect } from 'vitest';
import type { AgentStatus } from '../../src/cli/status.js';

describe('AgentStatus type', () => {
  it('실행 중 상태를 표현한다', () => {
    const status: AgentStatus = { running: true, pid: 12345, lastExitStatus: null };
    expect(status.running).toBe(true);
    expect(status.pid).toBe(12345);
  });

  it('중지 상태를 표현한다', () => {
    const status: AgentStatus = { running: false, pid: null, lastExitStatus: 0 };
    expect(status.running).toBe(false);
    expect(status.lastExitStatus).toBe(0);
  });
});
