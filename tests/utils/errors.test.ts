import { describe, it, expect } from 'vitest';
import {
  PilotError,
  AuthError,
  ToolError,
  ConfigError,
  ExternalApiError,
  TimeoutError,
  getUserMessage,
} from '../../src/utils/errors.js';

describe('PilotError', () => {
  it('has default code and userMessage', () => {
    const err = new PilotError('something broke');
    expect(err.code).toBe('PILOT_ERROR');
    expect(err.userMessage).toBe('something broke');
    expect(err.message).toBe('something broke');
    expect(err.name).toBe('PilotError');
  });

  it('accepts custom code and userMessage', () => {
    const err = new PilotError('internal details', {
      code: 'CUSTOM',
      userMessage: 'Something went wrong',
    });
    expect(err.code).toBe('CUSTOM');
    expect(err.userMessage).toBe('Something went wrong');
  });

  it('preserves cause', () => {
    const cause = new Error('original');
    const err = new PilotError('wrapper', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('AuthError', () => {
  it('has auth-specific defaults', () => {
    const err = new AuthError('token expired');
    expect(err.code).toBe('AUTH_ERROR');
    expect(err.userMessage).toContain('Authentication');
    expect(err.name).toBe('AuthError');
    expect(err).toBeInstanceOf(PilotError);
  });
});

describe('ToolError', () => {
  it('has tool-specific defaults', () => {
    const err = new ToolError('browser crashed');
    expect(err.code).toBe('TOOL_ERROR');
    expect(err.name).toBe('ToolError');
    expect(err).toBeInstanceOf(PilotError);
  });
});

describe('ConfigError', () => {
  it('has config-specific defaults', () => {
    const err = new ConfigError('missing field');
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.userMessage).toContain('pilot-ai init');
    expect(err).toBeInstanceOf(PilotError);
  });
});

describe('ExternalApiError', () => {
  it('includes statusCode', () => {
    const err = new ExternalApiError('Notion API 429', { statusCode: 429 });
    expect(err.code).toBe('EXTERNAL_API_ERROR');
    expect(err.statusCode).toBe(429);
    expect(err).toBeInstanceOf(PilotError);
  });
});

describe('TimeoutError', () => {
  it('has timeout-specific defaults', () => {
    const err = new TimeoutError('15 min exceeded');
    expect(err.code).toBe('TIMEOUT_ERROR');
    expect(err.userMessage).toContain('timed out');
    expect(err).toBeInstanceOf(PilotError);
  });
});

describe('getUserMessage', () => {
  it('returns userMessage for PilotError', () => {
    const err = new AuthError('internal', { userMessage: 'Please re-login' });
    expect(getUserMessage(err)).toBe('Please re-login');
  });

  it('returns message for regular Error', () => {
    expect(getUserMessage(new Error('oops'))).toBe('oops');
  });

  it('converts non-Error to string', () => {
    expect(getUserMessage('string error')).toBe('string error');
    expect(getUserMessage(42)).toBe('42');
  });
});
