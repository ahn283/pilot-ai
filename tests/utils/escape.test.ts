import { describe, it, expect } from 'vitest';
import { escapeAppleScript, escapeShellArg } from '../../src/utils/escape.js';

describe('escapeAppleScript', () => {
  it('escapes backslashes', () => {
    expect(escapeAppleScript('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes double quotes', () => {
    expect(escapeAppleScript('say "hello"')).toBe('say \\"hello\\"');
  });

  it('escapes backticks', () => {
    expect(escapeAppleScript('run `cmd`')).toBe('run \\`cmd\\`');
  });

  it('escapes dollar signs to prevent $() expansion', () => {
    expect(escapeAppleScript('$(whoami)')).toBe('\\$(whoami)');
  });

  it('handles combined special characters', () => {
    expect(escapeAppleScript('"$HOME\\n`id`')).toBe('\\"\\$HOME\\\\n\\`id\\`');
  });

  it('returns empty string unchanged', () => {
    expect(escapeAppleScript('')).toBe('');
  });

  it('handles unicode characters without modification', () => {
    expect(escapeAppleScript('안녕하세요 🎉')).toBe('안녕하세요 🎉');
  });

  it('handles plain text without modification', () => {
    expect(escapeAppleScript('Hello World')).toBe('Hello World');
  });
});

describe('escapeShellArg', () => {
  it('wraps simple string in single quotes', () => {
    expect(escapeShellArg('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(escapeShellArg("it's")).toBe("'it'\\''s'");
  });

  it('handles multiple single quotes', () => {
    expect(escapeShellArg("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it('wraps empty string in single quotes', () => {
    expect(escapeShellArg('')).toBe("''");
  });

  it('handles strings with spaces', () => {
    expect(escapeShellArg('hello world')).toBe("'hello world'");
  });

  it('preserves special shell characters inside single quotes', () => {
    expect(escapeShellArg('$HOME && rm -rf /')).toBe("'$HOME && rm -rf /'");
  });

  it('handles unicode', () => {
    expect(escapeShellArg('한글 테스트')).toBe("'한글 테스트'");
  });
});
