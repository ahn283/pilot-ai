import { describe, it, expect } from 'vitest';
import type { MessengerAdapter, IncomingMessage } from '../../src/messenger/adapter.js';

describe('MessengerAdapter 인터페이스', () => {
  it('인터페이스를 구현하는 mock 어댑터가 동작한다', () => {
    const messages: IncomingMessage[] = [];

    const adapter: MessengerAdapter = {
      start: async () => {},
      stop: async () => {},
      onMessage: (handler) => {
        handler({
          platform: 'slack',
          userId: 'U123',
          channelId: 'C456',
          text: '테스트 메시지',
          timestamp: new Date(),
        });
      },
      sendText: async (channelId, text, threadId) => {
        return 'msg-id-1';
      },
      sendApproval: async () => {},
      onApproval: () => {},
    };

    adapter.onMessage((msg) => messages.push(msg));
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('테스트 메시지');
    expect(messages[0].platform).toBe('slack');
  });
});
