import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { maskSecrets } from '../../src/security/audit.js';

// writeAuditLog는 파일 I/O가 필요하므로 maskSecrets만 단위 테스트

describe('maskSecrets', () => {
  it('Slack bot token을 마스킹한다', () => {
    const result = maskSecrets('token: xoxb-1234567890-abcdefghij');
    expect(result).not.toContain('xoxb-1234567890-abcdefghij');
    expect(result).toContain('***');
  });

  it('Slack app token을 마스킹한다', () => {
    const result = maskSecrets('app: xapp-1-A0B1C2D3E4-12345');
    expect(result).not.toContain('xapp-1-A0B1C2D3E4-12345');
  });

  it('Telegram bot token을 마스킹한다', () => {
    const result = maskSecrets('bot: bot123456789:ABCdefGHIjklMNO');
    expect(result).not.toContain('bot123456789:ABCdefGHIjklMNO');
  });

  it('Notion API key를 마스킹한다', () => {
    const result = maskSecrets('notion: ntn_abcdef123456789');
    expect(result).not.toContain('ntn_abcdef123456789');
  });

  it('Anthropic API key를 마스킹한다', () => {
    const result = maskSecrets('key: sk-ant-api03-abcdefghijklmnop');
    expect(result).not.toContain('sk-ant-api03-abcdefghijklmnop');
  });

  it('민감하지 않은 텍스트는 변경하지 않는다', () => {
    const text = '일반 텍스트입니다. 파일을 수정했습니다.';
    expect(maskSecrets(text)).toBe(text);
  });
});
