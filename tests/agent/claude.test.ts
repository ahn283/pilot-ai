import { describe, it, expect, vi } from 'vitest';
import { parseClaudeJsonOutput, checkClaudeCli } from '../../src/agent/claude.js';

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

  it('여러 줄의 JSONL을 처리한다', () => {
    const lines = [
      JSON.stringify({ type: 'system', message: 'init' }),
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: '분석 중...' }] }),
      JSON.stringify({ type: 'result', result: '완료' }),
    ];
    const output = lines.join('\n');
    const result = parseClaudeJsonOutput(output);
    expect(result).toContain('분석 중...');
    expect(result).toContain('완료');
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
