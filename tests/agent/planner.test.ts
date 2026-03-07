import { describe, it, expect } from 'vitest';
import { parsePlan, formatPlanForUser } from '../../src/agent/planner.js';

describe('parsePlan', () => {
  it('구조화된 계획을 파싱한다', () => {
    const response = `README.md 업데이트 후 커밋합니다.
1. [filesystem] README.md 파일 읽기
2. [filesystem] README.md 수정
3. [shell] git commit -m "update README"
4. [shell] git push origin main`;

    const plan = parsePlan(response);
    expect(plan.summary).toBe('README.md 업데이트 후 커밋합니다.');
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0].tool).toBe('filesystem');
    expect(plan.steps[0].safetyLevel).toBe('safe');
    expect(plan.steps[2].safetyLevel).toBe('moderate'); // git commit
    expect(plan.steps[3].safetyLevel).toBe('dangerous'); // git push
    expect(plan.hasDangerousSteps).toBe(true);
  });

  it('dangerous 단계가 없으면 hasDangerousSteps가 false', () => {
    const response = `파일을 읽습니다.
1. [filesystem] 파일 목록 조회
2. [filesystem] test.txt 읽기`;

    const plan = parsePlan(response);
    expect(plan.hasDangerousSteps).toBe(false);
  });

  it('빈 응답은 기본 plan을 반환한다', () => {
    const plan = parsePlan('');
    expect(plan.summary).toBe('Execute task');
    expect(plan.steps).toHaveLength(0);
  });
});

describe('formatPlanForUser', () => {
  it('사람이 읽을 수 있는 형태로 포맷한다', () => {
    const plan = parsePlan(`작업 계획
1. [filesystem] 파일 읽기
2. [shell] git push origin main`);

    const formatted = formatPlanForUser(plan);
    expect(formatted).toContain('🟢'); // safe
    expect(formatted).toContain('🔴'); // dangerous
    expect(formatted).toContain('Approval required');
  });
});
