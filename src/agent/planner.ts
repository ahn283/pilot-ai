import { classifySafety, type SafetyLevel } from './safety.js';

export interface PlanStep {
  description: string;
  tool: string;
  safetyLevel: SafetyLevel;
}

export interface ExecutionPlan {
  summary: string;
  steps: PlanStep[];
  hasDangerousSteps: boolean;
}

/**
 * Claude의 응답을 실행 계획으로 파싱한다.
 * Claude에게 구조화된 계획을 요청하고 결과를 파싱한다.
 */
export function parsePlan(claudeResponse: string): ExecutionPlan {
  const steps: PlanStep[] = [];
  const lines = claudeResponse.split('\n');

  let summary = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // "1. [tool] description" 형태 파싱
    const stepMatch = trimmed.match(/^\d+\.\s*\[(\w+)\]\s*(.+)$/);
    if (stepMatch) {
      const tool = stepMatch[1];
      const description = stepMatch[2];
      steps.push({
        description,
        tool,
        safetyLevel: classifySafety(description),
      });
      continue;
    }

    // 첫 번째 비어있지 않은 줄이 summary
    if (!summary && trimmed && !trimmed.startsWith('#')) {
      summary = trimmed;
    }
  }

  return {
    summary: summary || '작업 실행',
    steps,
    hasDangerousSteps: steps.some((s) => s.safetyLevel === 'dangerous'),
  };
}

/**
 * 계획을 사람이 읽을 수 있는 형태로 포맷한다.
 */
export function formatPlanForUser(plan: ExecutionPlan): string {
  const lines = [`**${plan.summary}**\n`];

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const icon =
      step.safetyLevel === 'dangerous' ? '🔴' :
      step.safetyLevel === 'moderate' ? '🟡' : '🟢';
    lines.push(`${i + 1}. ${icon} [${step.tool}] ${step.description}`);
  }

  if (plan.hasDangerousSteps) {
    lines.push('\n⚠️ 위험한 작업이 포함되어 있습니다. 승인이 필요합니다.');
  }

  return lines.join('\n');
}
