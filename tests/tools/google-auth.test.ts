import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => '/tmp/test-pilot',
}));

import {
  configureGoogle,
  getGoogleConfig,
  getGoogleAuthUrl,
  GOOGLE_SCOPES,
} from '../../src/tools/google-auth.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('google-auth', () => {
  it('configureGoogle sets config and sanitizes credentials', () => {
    configureGoogle({ clientId: 'test-id', clientSecret: 'test-secret' });
    expect(getGoogleConfig()).toEqual({ clientId: 'test-id', clientSecret: 'test-secret' });
  });

  it('configureGoogle strips invisible characters', () => {
    configureGoogle({ clientId: 'test\u200B-id\u00A0', clientSecret: '\uFEFFsecret\u200D' });
    const cfg = getGoogleConfig();
    expect(cfg?.clientId).toBe('test-id');
    expect(cfg?.clientSecret).toBe('secret');
  });

  it('getGoogleAuthUrl returns url, codeVerifier, and state', () => {
    configureGoogle({ clientId: 'my-client-id', clientSecret: 'my-secret' });
    const result = getGoogleAuthUrl(['gmail', 'calendar'], 'http://127.0.0.1:12345');
    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('codeVerifier');
    expect(result).toHaveProperty('state');
    expect(result.url).toContain('client_id=my-client-id');
    expect(result.url).toContain('accounts.google.com');
    expect(result.url).toContain('access_type=offline');
    expect(result.url).toContain('gmail');
    expect(result.url).toContain('calendar');
    expect(result.url).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A12345');
    expect(result.url).toContain('code_challenge=');
    expect(result.url).toContain('code_challenge_method=S256');
    expect(result.url).toContain(`state=${result.state}`);
    expect(result.url).not.toContain('oob');
    expect(result.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(result.state.length).toBe(32);
  });

  it('configureGoogle throws on null input', () => {
    expect(() => configureGoogle(null as unknown as { clientId: string; clientSecret: string })).toThrow();
  });

  it('GOOGLE_SCOPES contains expected services', () => {
    expect(GOOGLE_SCOPES.gmail).toBeDefined();
    expect(GOOGLE_SCOPES.calendar).toBeDefined();
    expect(GOOGLE_SCOPES.drive).toBeDefined();
    expect(GOOGLE_SCOPES.gmail.length).toBeGreaterThan(0);
    expect(GOOGLE_SCOPES.calendar.length).toBeGreaterThan(0);
    expect(GOOGLE_SCOPES.drive.length).toBeGreaterThan(0);
  });

  it('getGoogleAuthUrl includes drive scopes', () => {
    configureGoogle({ clientId: 'cid', clientSecret: 'cs' });
    const { url } = getGoogleAuthUrl(['drive'], 'http://127.0.0.1:9999');
    expect(url).toContain('drive');
  });
});
