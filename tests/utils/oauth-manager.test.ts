import { describe, it, expect, afterEach } from 'vitest';
import { OAuthManager } from '../../src/utils/oauth-manager.js';
import { deleteSecret, getSecret } from '../../src/config/keychain.js';

const TEST_KEY = 'test-oauth-manager';

describe('OAuthManager', () => {
  afterEach(async () => {
    await deleteSecret(TEST_KEY);
  });

  function createManager() {
    return new OAuthManager({
      keychainKey: TEST_KEY,
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
  }

  it('saves and loads tokens via Keychain', async () => {
    const manager = createManager();
    const tokens = {
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: Date.now() + 3600_000,
    };

    await manager.saveTokens(tokens);
    const loaded = await manager.loadTokens();
    expect(loaded).not.toBeNull();
    expect(loaded!.accessToken).toBe('access-123');
    expect(loaded!.refreshToken).toBe('refresh-456');
  });

  it('deletes tokens from Keychain', async () => {
    const manager = createManager();
    await manager.saveTokens({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
    });

    await manager.deleteTokens();
    const loaded = await manager.loadTokens();
    expect(loaded).toBeNull();
  });

  it('returns cached access token when not expired', async () => {
    const manager = createManager();
    await manager.saveTokens({
      accessToken: 'valid-token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600_000, // 1 hour from now
    });

    const token = await manager.getAccessToken();
    expect(token).toBe('valid-token');
  });

  it('throws when no tokens available', async () => {
    const manager = createManager();
    await expect(manager.getAccessToken()).rejects.toThrow('No OAuth tokens available');
  });

  it('returns null for loadTokens when no tokens stored', async () => {
    const manager = createManager();
    const loaded = await manager.loadTokens();
    expect(loaded).toBeNull();
  });

  it('handles corrupted keychain data gracefully', async () => {
    const { setSecret } = await import('../../src/config/keychain.js');
    await setSecret(TEST_KEY, 'not-json');
    const manager = createManager();
    const loaded = await manager.loadTokens();
    expect(loaded).toBeNull();
  });
});
