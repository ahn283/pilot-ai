import { describe, it, expect } from 'vitest';
import { startOAuthCallbackServer } from '../../src/utils/oauth-callback-server.js';

describe('oauth-callback-server', () => {
  it('starts server and returns port and redirectUri', async () => {
    const server = await startOAuthCallbackServer();
    try {
      expect(server.port).toBeGreaterThan(1023);
      expect(server.redirectUri).toBe(`http://127.0.0.1:${server.port}`);
    } finally {
      server.close();
    }
  });

  it('receives authorization code from callback', async () => {
    const server = await startOAuthCallbackServer();
    try {
      // Simulate Google redirecting back with a code
      const codePromise = server.waitForCode();
      const res = await fetch(`${server.redirectUri}?code=test-auth-code-123&state=mystate`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Authentication Successful');

      const result = await codePromise;
      expect(result.code).toBe('test-auth-code-123');
      expect(result.state).toBe('mystate');
    } finally {
      server.close();
    }
  });

  it('receives code without state parameter', async () => {
    const server = await startOAuthCallbackServer();
    try {
      const codePromise = server.waitForCode();
      await fetch(`${server.redirectUri}?code=abc`);
      const result = await codePromise;
      expect(result.code).toBe('abc');
      expect(result.state).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it('rejects on error parameter from OAuth provider', async () => {
    const server = await startOAuthCallbackServer();
    try {
      const codePromise = server.waitForCode();
      const res = await fetch(`${server.redirectUri}?error=access_denied`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Authentication Failed');
      expect(html).toContain('access_denied');

      await expect(codePromise).rejects.toThrow('OAuth error: access_denied');
    } finally {
      server.close();
    }
  });

  it('rejects when no code is provided', async () => {
    const server = await startOAuthCallbackServer();
    try {
      const codePromise = server.waitForCode();
      const res = await fetch(`${server.redirectUri}`);
      expect(res.status).toBe(400);

      await expect(codePromise).rejects.toThrow('No authorization code');
    } finally {
      server.close();
    }
  });

  it('returns 404 for non-callback paths', async () => {
    const server = await startOAuthCallbackServer();
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/other`);
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('times out when no callback is received', async () => {
    const server = await startOAuthCallbackServer(500); // 500ms timeout
    const codePromise = server.waitForCode();
    await expect(codePromise).rejects.toThrow('timed out');
  });
});
