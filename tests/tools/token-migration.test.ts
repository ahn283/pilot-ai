import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setSecret, getSecret, deleteSecret } from '../../src/config/keychain.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../../src/config/store.js';

// We test load/save via the actual keychain on macOS (integration-style).
// Mock only the filesystem to test migration logic.

describe('google-auth token Keychain integration', () => {
  const keychainKey = 'google-oauth-tokens';
  const testTokens = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600_000,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  };

  afterEach(async () => {
    await deleteSecret(keychainKey);
  });

  it('saveGoogleTokens stores tokens in Keychain', async () => {
    // Dynamically import to get fresh module state
    const { saveGoogleTokens } = await import('../../src/tools/google-auth.js');
    await saveGoogleTokens(testTokens);

    const stored = await getSecret(keychainKey);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.accessToken).toBe('test-access-token');
    expect(parsed.refreshToken).toBe('test-refresh-token');
  });

  it('loadGoogleTokens reads from Keychain', async () => {
    await setSecret(keychainKey, JSON.stringify(testTokens));

    const { loadGoogleTokens } = await import('../../src/tools/google-auth.js');
    const loaded = await loadGoogleTokens();
    expect(loaded).not.toBeNull();
    expect(loaded!.accessToken).toBe('test-access-token');
  });

  it('loadGoogleTokens returns null when Keychain has no entry and no legacy file', async () => {
    // Ensure nothing in keychain
    await deleteSecret(keychainKey);

    const { loadGoogleTokens } = await import('../../src/tools/google-auth.js');
    const loaded = await loadGoogleTokens();
    expect(loaded).toBeNull();
  });

  it('deleteGoogleTokens removes tokens from Keychain', async () => {
    await setSecret(keychainKey, JSON.stringify(testTokens));
    const { deleteGoogleTokens } = await import('../../src/tools/google-auth.js');
    await deleteGoogleTokens();
    const stored = await getSecret(keychainKey);
    expect(stored).toBeNull();
  });
});

describe('email token Keychain integration', () => {
  const keychainKey = 'gmail-oauth-tokens';
  const testTokens = {
    accessToken: 'gmail-access-token',
    refreshToken: 'gmail-refresh-token',
    expiresAt: Date.now() + 3600_000,
  };

  afterEach(async () => {
    await deleteSecret(keychainKey);
  });

  it('saveTokens stores tokens in Keychain', async () => {
    const { saveTokens } = await import('../../src/tools/email.js');
    await saveTokens(testTokens);

    const stored = await getSecret(keychainKey);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.accessToken).toBe('gmail-access-token');
  });

  it('loadTokens reads from Keychain', async () => {
    await setSecret(keychainKey, JSON.stringify(testTokens));

    const { loadTokens } = await import('../../src/tools/email.js');
    const loaded = await loadTokens();
    expect(loaded).not.toBeNull();
    expect(loaded!.accessToken).toBe('gmail-access-token');
  });

  it('loadTokens returns null when no tokens exist', async () => {
    await deleteSecret(keychainKey);

    const { loadTokens } = await import('../../src/tools/email.js');
    const loaded = await loadTokens();
    expect(loaded).toBeNull();
  });

  it('deleteTokens removes tokens from Keychain', async () => {
    await setSecret(keychainKey, JSON.stringify(testTokens));
    const { deleteTokens } = await import('../../src/tools/email.js');
    await deleteTokens();
    const stored = await getSecret(keychainKey);
    expect(stored).toBeNull();
  });
});
