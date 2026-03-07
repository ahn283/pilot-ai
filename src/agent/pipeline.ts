/**
 * Multi-step task pipeline for composing tool operations.
 * Each step receives the output of the previous step.
 */

export interface PipelineStep {
  name: string;
  execute: (input: unknown) => Promise<unknown>;
}

export interface PipelineResult {
  success: boolean;
  steps: Array<{ name: string; output: unknown; error?: string }>;
  finalOutput: unknown;
}

/**
 * Executes a sequence of steps, passing each step's output to the next.
 * Stops on first failure.
 */
export async function executePipeline(steps: PipelineStep[], initialInput?: unknown): Promise<PipelineResult> {
  const results: PipelineResult['steps'] = [];
  let currentInput = initialInput;

  for (const step of steps) {
    try {
      const output = await step.execute(currentInput);
      results.push({ name: step.name, output });
      currentInput = output;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({ name: step.name, output: null, error: errorMsg });
      return {
        success: false,
        steps: results,
        finalOutput: null,
      };
    }
  }

  return {
    success: true,
    steps: results,
    finalOutput: currentInput,
  };
}

/**
 * Formats pipeline results for display.
 */
export function formatPipelineResult(result: PipelineResult): string {
  const lines: string[] = [];
  const status = result.success ? '✅ Pipeline completed' : '❌ Pipeline failed';
  lines.push(status);

  for (const step of result.steps) {
    const icon = step.error ? '❌' : '✅';
    const output = step.error
      ? `Error: ${step.error}`
      : typeof step.output === 'string'
        ? step.output.slice(0, 200)
        : JSON.stringify(step.output).slice(0, 200);
    lines.push(`  ${icon} ${step.name}: ${output}`);
  }

  return lines.join('\n');
}
