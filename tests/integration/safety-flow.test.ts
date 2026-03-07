import { describe, it, expect } from 'vitest';
import { classifySafety, ApprovalManager } from '../../src/agent/safety.js';

describe('위험 작업 승인/거부 플로우', () => {
  it('safe 작업은 승인 불필요', () => {
    expect(classifySafety('ls -la')).toBe('safe');
    expect(classifySafety('cat package.json')).toBe('safe');
  });

  it('moderate 작업은 moderate로 분류', () => {
    expect(classifySafety('git commit -m "test"')).toBe('moderate');
    expect(classifySafety('npm install lodash')).toBe('moderate');
  });

  it('dangerous 작업은 dangerous로 분류', () => {
    expect(classifySafety('git push origin main')).toBe('dangerous');
    expect(classifySafety('rm -rf /home')).toBe('dangerous');
    expect(classifySafety('npm publish')).toBe('dangerous');
  });

  it('승인 요청 후 승인하면 resolve(true)', async () => {
    const manager = new ApprovalManager();
    const promise = manager.requestApproval('task-1');
    manager.handleResponse('task-1', true);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('승인 요청 후 거부하면 resolve(false)', async () => {
    const manager = new ApprovalManager();
    const promise = manager.requestApproval('task-2');
    manager.handleResponse('task-2', false);
    const result = await promise;
    expect(result).toBe(false);
  });
});
