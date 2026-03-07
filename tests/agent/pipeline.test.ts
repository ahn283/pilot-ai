import { describe, it, expect } from 'vitest';
import { executePipeline, formatPipelineResult, type PipelineStep } from '../../src/agent/pipeline.js';

describe('executePipeline', () => {
  it('executes steps in sequence passing data through', async () => {
    const steps: PipelineStep[] = [
      { name: 'fetch', execute: async () => ({ items: [1, 2, 3] }) },
      { name: 'transform', execute: async (input) => (input as { items: number[] }).items.map((n) => n * 2) },
      { name: 'format', execute: async (input) => (input as number[]).join(', ') },
    ];

    const result = await executePipeline(steps);
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.finalOutput).toBe('2, 4, 6');
  });

  it('stops on first failure', async () => {
    const steps: PipelineStep[] = [
      { name: 'ok', execute: async () => 'data' },
      { name: 'fail', execute: async () => { throw new Error('broken'); } },
      { name: 'never', execute: async () => 'unreachable' },
    ];

    const result = await executePipeline(steps);
    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].error).toBe('broken');
  });

  it('passes initial input to first step', async () => {
    const steps: PipelineStep[] = [
      { name: 'double', execute: async (n) => (n as number) * 2 },
    ];

    const result = await executePipeline(steps, 5);
    expect(result.finalOutput).toBe(10);
  });
});

describe('formatPipelineResult', () => {
  it('formats successful pipeline', () => {
    const result = {
      success: true,
      steps: [
        { name: 'fetch', output: 'data fetched' },
        { name: 'save', output: 'saved' },
      ],
      finalOutput: 'saved',
    };
    const formatted = formatPipelineResult(result);
    expect(formatted).toContain('✅ Pipeline completed');
    expect(formatted).toContain('fetch');
    expect(formatted).toContain('save');
  });

  it('formats failed pipeline', () => {
    const result = {
      success: false,
      steps: [
        { name: 'ok', output: 'fine' },
        { name: 'fail', output: null, error: 'timeout' },
      ],
      finalOutput: null,
    };
    const formatted = formatPipelineResult(result);
    expect(formatted).toContain('❌ Pipeline failed');
    expect(formatted).toContain('timeout');
  });
});
