import { describe, it, expect, vi } from 'vitest';
import { classifySafety, ApprovalManager } from '../../src/agent/safety.js';

describe('classifySafety', () => {
  it('git push는 dangerous', () => {
    expect(classifySafety('git push origin main')).toBe('dangerous');
  });

  it('rm -rf는 dangerous', () => {
    expect(classifySafety('rm -rf /tmp/data')).toBe('dangerous');
  });

  it('npm publish는 dangerous', () => {
    expect(classifySafety('npm publish')).toBe('dangerous');
  });

  it('deploy는 dangerous', () => {
    expect(classifySafety('서버에 deploy 실행')).toBe('dangerous');
  });

  it('git commit은 moderate', () => {
    expect(classifySafety('git commit -m "fix"')).toBe('moderate');
  });

  it('npm install은 moderate', () => {
    expect(classifySafety('npm install express')).toBe('moderate');
  });

  it('파일 create는 moderate', () => {
    expect(classifySafety('create new file index.ts')).toBe('moderate');
  });

  it('ls는 safe', () => {
    expect(classifySafety('ls -la')).toBe('safe');
  });

  it('cat 파일 읽기는 safe', () => {
    expect(classifySafety('cat README.md')).toBe('safe');
  });

  it('Notion 조회는 safe', () => {
    expect(classifySafety('Notion 페이지 목록 가져오기')).toBe('safe');
  });
});

describe('ApprovalManager', () => {
  it('승인 요청 후 승인하면 true 반환', async () => {
    const manager = new ApprovalManager();
    const promise = manager.requestApproval('task-1', 'git push', 5000);
    manager.handleResponse('task-1', true);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('승인 요청 후 거부하면 false 반환', async () => {
    const manager = new ApprovalManager();
    const promise = manager.requestApproval('task-2', 'rm -rf', 5000);
    manager.handleResponse('task-2', false);
    const result = await promise;
    expect(result).toBe(false);
  });

  it('타임아웃 시 false 반환', async () => {
    vi.useFakeTimers();
    const manager = new ApprovalManager();
    const promise = manager.requestApproval('task-3', 'deploy', 1000);
    vi.advanceTimersByTime(1001);
    const result = await promise;
    expect(result).toBe(false);
    vi.useRealTimers();
  });

  it('존재하지 않는 taskId 응답은 false', () => {
    const manager = new ApprovalManager();
    expect(manager.handleResponse('nonexistent', true)).toBe(false);
  });

  it('pending 상태를 확인할 수 있다', () => {
    const manager = new ApprovalManager();
    manager.requestApproval('task-4', 'test', 5000);
    expect(manager.hasPending('task-4')).toBe(true);
    expect(manager.getPendingCount()).toBe(1);
    manager.handleResponse('task-4', true);
    expect(manager.hasPending('task-4')).toBe(false);
  });
});
