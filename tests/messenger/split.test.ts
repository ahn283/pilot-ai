import { describe, it, expect } from 'vitest';
import { splitMessage, MAX_MESSAGE_LENGTH } from '../../src/messenger/split.js';

describe('splitMessage', () => {
  it('returns single chunk for short messages', () => {
    const result = splitMessage('Hello world', 100);
    expect(result).toEqual(['Hello world']);
  });

  it('returns single chunk at exact limit', () => {
    const text = 'a'.repeat(100);
    const result = splitMessage(text, 100);
    expect(result).toEqual([text]);
  });

  it('splits long message into multiple chunks', () => {
    const text = 'a'.repeat(250);
    const result = splitMessage(text, 100);
    expect(result.length).toBe(3);
    expect(result.join('').length).toBe(250);
  });

  it('prefers splitting at newlines', () => {
    const text = 'line1\nline2\nline3\nline4';
    const result = splitMessage(text, 12);
    expect(result[0]).toBe('line1\nline2\n');
  });

  it('prefers splitting at spaces when no newline available', () => {
    const text = 'word1 word2 word3 word4';
    const result = splitMessage(text, 12);
    expect(result[0]).toBe('word1 word2 ');
  });

  it('closes and reopens code blocks across splits', () => {
    const text = '```\n' + 'x'.repeat(100) + '\n```';
    const result = splitMessage(text, 60);
    expect(result.length).toBeGreaterThan(1);
    // First chunk should end with closing ```
    expect(result[0].endsWith('```')).toBe(true);
    // Second chunk should start with opening ```
    expect(result[1].startsWith('```')).toBe(true);
  });

  it('does not add extra markers when code block is properly closed', () => {
    const text = '```\ncode\n```\n\nNormal text here.';
    const result = splitMessage(text, 1000);
    expect(result).toEqual([text]);
  });

  it('handles empty string', () => {
    expect(splitMessage('', 100)).toEqual(['']);
  });

  it('all chunks are within the limit (ignoring code block closers)', () => {
    const text = 'Hello world! '.repeat(500);
    const limit = 100;
    const chunks = splitMessage(text, limit);
    // Each chunk should be roughly within limit
    // (code block closers may add a few chars)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(limit + 10);
    }
  });
});

describe('MAX_MESSAGE_LENGTH', () => {
  it('has correct Slack limit', () => {
    expect(MAX_MESSAGE_LENGTH.slack).toBe(4000);
  });

  it('has correct Telegram limit', () => {
    expect(MAX_MESSAGE_LENGTH.telegram).toBe(4096);
  });
});
