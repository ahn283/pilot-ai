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

describe('gmail-oauth-tokens migration', () => {
  const legacyKey = 'gmail-oauth-tokens';
  const newKey = 'google-oauth-tokens';
  const legacyTokens = {
    accessToken: 'gmail-access-token',
    refreshToken: 'gmail-refresh-token',
    expiresAt: Date.now() + 3600_000,
  };

  afterEach(async () => {
    await deleteSecret(legacyKey);
    await deleteSecret(newKey);
  });

  it('migrates gmail-oauth-tokens to google-oauth-tokens on load', async () => {
    // Store tokens under old key
    await setSecret(legacyKey, JSON.stringify(legacyTokens));
    // Ensure new key is empty
    await deleteSecret(newKey);

    const { loadGoogleTokens } = await import('../../src/tools/google-auth.js');
    const loaded = await loadGoogleTokens();

    expect(loaded).not.toBeNull();
    expect(loaded!.accessToken).toBe('gmail-access-token');

    // Should be migrated to new key
    const newStored = await getSecret(newKey);
    expect(newStored).not.toBeNull();

    // Legacy key should be removed
    const legacyStored = await getSecret(legacyKey);
    expect(legacyStored).toBeNull();
  });
});
