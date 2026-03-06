import { describe, it, expect, afterEach } from 'vitest';
import { setSecret, getSecret, deleteSecret } from '../../src/config/keychain.js';

describe('keychain', () => {
  const testKey = `test-${Date.now()}`;

  afterEach(async () => {
    await deleteSecret(testKey);
  });

  it('secret을 저장하고 읽을 수 있다', async () => {
    await setSecret(testKey, 'my-secret-value');
    const value = await getSecret(testKey);
    expect(value).toBe('my-secret-value');
  });

  it('존재하지 않는 키는 null을 반환한다', async () => {
    const value = await getSecret('nonexistent-key-12345');
    expect(value).toBeNull();
  });

  it('secret을 삭제할 수 있다', async () => {
    await setSecret(testKey, 'to-be-deleted');
    await deleteSecret(testKey);
    const value = await getSecret(testKey);
    expect(value).toBeNull();
  });
});
