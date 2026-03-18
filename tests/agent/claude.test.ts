import { describe, it, expect, vi } from 'vitest';
import { parseClaudeJsonOutput, parseStreamEvent, checkClaudeCli } from '../../src/agent/claude.js';

describe('parseClaudeJsonOutput', () => {
  it('result 타입 메시지에서 텍스트를 추출한다', () => {
    const output = JSON.stringify({ type: 'result', result: '작업 완료' });
    expect(parseClaudeJsonOutput(output)).toBe('작업 완료');
  });

  it('assistant 메시지의 text content를 추출한다', () => {
    const output = JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'text', text: '안녕하세요' },
        { type: 'text', text: '도움이 필요하신가요?' },
      ],
    });
    expect(parseClaudeJsonOutput(output)).toBe('안녕하세요\n도움이 필요하신가요?');
  });

  it('여러 줄의 JSONL에서 result를 우선 반환한다', () => {
    const lines = [
      JSON.stringify({ type: 'system', message: 'init' }),
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: '분석 중...' }] }),
      JSON.stringify({ type: 'result', result: '완료' }),
    ];
    const output = lines.join('\n');
    const result = parseClaudeJsonOutput(output);
    // result 타입이 있으면 그것만 반환 (중간 assistant 메시지는 제외)
    expect(result).toBe('완료');
  });

  it('빈 content 배열을 처리한다', () => {
    const output = JSON.stringify({ type: 'assistant', content: [] });
    // 텍스트가 없으면 원본 반환
    expect(parseClaudeJsonOutput(output)).toBeTruthy();
  });

  it('잘못된 JSON은 원문 텍스트로 반환한다', () => {
    const output = 'this is not json';
    expect(parseClaudeJsonOutput(output)).toBe('this is not json');
  });

  it('truncated/partial JSON returns raw text', () => {
    const output = '{"type":"result","result":"incom';
    expect(parseClaudeJsonOutput(output)).toBe(output);
  });

  it('empty string returns empty string', () => {
    expect(parseClaudeJsonOutput('')).toBe('');
  });

  it('tool_use content 블록은 무시한다', () => {
    const output = JSON.stringify({
      type: 'assistant',
      content: [
        { type: 'tool_use', id: 'tool1', name: 'read_file' },
        { type: 'text', text: '파일을 읽었습니다' },
      ],
    });
    expect(parseClaudeJsonOutput(output)).toBe('파일을 읽었습니다');
  });
});

describe('parseClaudeJsonOutput - stream-json format', () => {
  it('extracts text from stream-json assistant message wrapper', () => {
    const output = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello from stream-json' }],
      },
    });
    expect(parseClaudeJsonOutput(output)).toBe('Hello from stream-json');
  });

  it('extracts result from stream-json result message', () => {
    const output = JSON.stringify({ type: 'result', result: 'Done via stream' });
    expect(parseClaudeJsonOutput(output)).toBe('Done via stream');
  });

  it('handles mixed legacy and stream-json lines — returns only final result', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'legacy line' }] }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'stream line' }] } }),
      JSON.stringify({ type: 'result', result: 'final' }),
    ];
    const result = parseClaudeJsonOutput(lines.join('\n'));
    // Only the result message is returned, not intermediate assistant messages
    expect(result).toBe('final');
  });

  it('falls back to last assistant text when no result message', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'first' }] }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'last answer' }] } }),
    ];
    const result = parseClaudeJsonOutput(lines.join('\n'));
    // Without a result message, returns the last assistant text
    expect(result).toBe('last answer');
  });
});

describe('parseStreamEvent', () => {
  it('detects thinking_delta events', () => {
    const thinkingChunks: string[] = [];
    const msg = {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'Let me analyze this...' },
    };
    parseStreamEvent(msg, undefined, (text) => thinkingChunks.push(text));
    expect(thinkingChunks).toEqual(['Let me analyze this...']);
  });

  it('detects tool_use in assistant content', () => {
    const toolStatuses: string[] = [];
    const msg = {
      type: 'assistant',
      content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      ],
    };
    parseStreamEvent(msg, (status) => toolStatuses.push(status));
    expect(toolStatuses.length).toBe(1);
    expect(toolStatuses[0]).toContain('Running');
  });

  it('detects tool_use in stream-json assistant message wrapper', () => {
    const toolStatuses: string[] = [];
    const msg = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: {} },
        ],
      },
    };
    parseStreamEvent(msg, (status) => toolStatuses.push(status));
    expect(toolStatuses.length).toBe(1);
    expect(toolStatuses[0]).toContain('Reading');
  });

  it('ignores non-thinking content_block_delta', () => {
    const thinkingChunks: string[] = [];
    const msg = {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello' },
    };
    parseStreamEvent(msg, undefined, (text) => thinkingChunks.push(text));
    expect(thinkingChunks).toEqual([]);
  });

  it('does nothing when callbacks are undefined', () => {
    const msg = {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'test' },
    };
    // Should not throw
    parseStreamEvent(msg, undefined, undefined);
  });
});

describe('checkClaudeCli', () => {
  it('존재하는 바이너리를 확인한다 (node)', async () => {
    const exists = await checkClaudeCli('node');
    expect(exists).toBe(true);
  });

  it('존재하지 않는 바이너리는 false를 반환한다', async () => {
    const exists = await checkClaudeCli('nonexistent-binary-xyz-12345');
    expect(exists).toBe(false);
  });
});
