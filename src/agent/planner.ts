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
 * Parses Claude's response into an execution plan.
 * Requests a structured plan from Claude and parses the result.
 */
export function parsePlan(claudeResponse: string): ExecutionPlan {
  const steps: PlanStep[] = [];
  const lines = claudeResponse.split('\n');

  let summary = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Parse "1. [tool] description" format
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

    // First non-empty line becomes the summary
    if (!summary && trimmed && !trimmed.startsWith('#')) {
      summary = trimmed;
    }
  }

  return {
    summary: summary || 'Execute task',
    steps,
    hasDangerousSteps: steps.some((s) => s.safetyLevel === 'dangerous'),
  };
}

/**
 * Formats the plan into a human-readable form.
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
    lines.push('\n⚠️ Contains dangerous operations. Approval required.');
  }

  return lines.join('\n');
}
