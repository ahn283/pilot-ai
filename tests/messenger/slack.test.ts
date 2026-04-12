import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from '../../src/messenger/adapter.js';

/**
 * SlackAdapter is tightly coupled to @slack/bolt App.
 * We test the core logic by mocking the App and capturing registered listeners.
 */

// Capture listeners registered via app.message() and app.event()
let messageListener: (args: { message: Record<string, unknown> }) => Promise<void>;
let appMentionListener: (args: { event: Record<string, unknown> }) => Promise<void>;
let actionListeners: Record<string, (args: { action: Record<string, unknown>; ack: () => Promise<void>; body: unknown }) => Promise<void>>;

vi.mock('@slack/bolt', () => {
  return {
    App: class MockApp {
      message(listener: (args: { message: Record<string, unknown> }) => Promise<void>) {
        messageListener = listener;
      }
      event(name: string, listener: (args: { event: Record<string, unknown> }) => Promise<void>) {
        if (name === 'app_mention') appMentionListener = listener;
      }
      action(name: string, listener: (args: { action: Record<string, unknown>; ack: () => Promise<void>; body: unknown }) => Promise<void>) {
        actionListeners[name] = listener;
      }
      error(_handler: unknown) {}
      client = {
        chat: { postMessage: vi.fn(), update: vi.fn() },
        reactions: { add: vi.fn(), remove: vi.fn() },
      };
      start = vi.fn();
      stop = vi.fn();
    },
  };
});

import { SlackAdapter } from '../../src/messenger/slack.js';

describe('SlackAdapter', () => {
  let adapter: SlackAdapter;
  let received: IncomingMessage[];

  beforeEach(() => {
    actionListeners = {};
    received = [];
    adapter = new SlackAdapter({
      botToken: 'xoxb-test-token',
      appToken: 'xapp-test-token',
      signingSecret: 'test-secret',
    });
    adapter.onMessage((msg) => {
      received.push(msg);
    });
  });

  describe('DM vs Channel filtering', () => {
    it('should process DM messages (channel_type=im)', async () => {
      await messageListener({
        message: {
          user: 'U123',
          channel: 'D456',
          channel_type: 'im',
          text: 'hello from DM',
          ts: '1000.001',
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('hello from DM');
      expect(received[0].channelId).toBe('D456');
    });

    it('should ignore channel messages (channel_type=channel)', async () => {
      await messageListener({
        message: {
          user: 'U123',
          channel: 'C789',
          channel_type: 'channel',
          text: 'hello from channel',
          ts: '1000.002',
        },
      });

      expect(received).toHaveLength(0);
    });

    it('should ignore group messages (channel_type=group)', async () => {
      await messageListener({
        message: {
          user: 'U123',
          channel: 'G789',
          channel_type: 'group',
          text: 'hello from group',
          ts: '1000.003',
        },
      });

      expect(received).toHaveLength(0);
    });
  });

  describe('app_mention handler', () => {
    it('should process @mention events in channels', async () => {
      await appMentionListener({
        event: {
          user: 'U123',
          channel: 'C789',
          text: '<@UBOT123> do something',
          ts: '2000.001',
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('do something');
      expect(received[0].channelId).toBe('C789');
    });

    it('should strip multiple bot mentions from text', async () => {
      await appMentionListener({
        event: {
          user: 'U123',
          channel: 'C789',
          text: '<@UBOT123> hey <@UOTHER456> check this',
          ts: '2000.002',
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('hey  check this');
    });

    it('should ignore app_mention with empty text after stripping', async () => {
      await appMentionListener({
        event: {
          user: 'U123',
          channel: 'C789',
          text: '<@UBOT123>',
          ts: '2000.003',
        },
      });

      expect(received).toHaveLength(0);
    });

    it('should extract images from app_mention events', async () => {
      await appMentionListener({
        event: {
          user: 'U123',
          channel: 'C789',
          text: '<@UBOT123> check this image',
          ts: '2000.004',
          files: [
            { url_private: 'https://files.slack.com/img.png', mimetype: 'image/png', name: 'screenshot.png' },
          ],
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].images).toHaveLength(1);
      expect(received[0].images![0].url).toBe('https://files.slack.com/img.png');
      expect(received[0].images![0].authHeader).toBe('Bearer xoxb-test-token');
    });
  });

  describe('deduplication', () => {
    it('should not process same ts twice (message then app_mention)', async () => {
      await messageListener({
        message: {
          user: 'U123',
          channel: 'D456',
          channel_type: 'im',
          text: 'hello',
          ts: '3000.001',
        },
      });

      await appMentionListener({
        event: {
          user: 'U123',
          channel: 'D456',
          text: '<@UBOT123> hello',
          ts: '3000.001',
        },
      });

      expect(received).toHaveLength(1);
    });

    it('should not process same ts twice (app_mention then message)', async () => {
      await appMentionListener({
        event: {
          user: 'U123',
          channel: 'C789',
          text: '<@UBOT123> hello',
          ts: '3000.002',
        },
      });

      await messageListener({
        message: {
          user: 'U123',
          channel: 'D456',
          channel_type: 'im',
          text: 'hello',
          ts: '3000.002',
        },
      });

      expect(received).toHaveLength(1);
    });
  });

  describe('message filtering', () => {
    it('should ignore messages with non-file_share subtypes', async () => {
      await messageListener({
        message: {
          subtype: 'bot_message',
          user: 'U123',
          channel: 'D456',
          channel_type: 'im',
          text: 'bot says hi',
          ts: '4000.001',
        },
      });

      expect(received).toHaveLength(0);
    });

    it('should allow file_share subtype', async () => {
      await messageListener({
        message: {
          subtype: 'file_share',
          user: 'U123',
          channel: 'D456',
          channel_type: 'im',
          text: 'shared a file',
          ts: '4000.002',
        },
      });

      expect(received).toHaveLength(1);
    });

    it('should ignore messages without user field', async () => {
      await messageListener({
        message: {
          channel: 'D456',
          channel_type: 'im',
          text: 'system message',
          ts: '4000.003',
        },
      });

      expect(received).toHaveLength(0);
    });

    it('should ignore messages without text or files', async () => {
      await messageListener({
        message: {
          user: 'U123',
          channel: 'D456',
          channel_type: 'im',
          ts: '4000.004',
        },
      });

      expect(received).toHaveLength(0);
    });
  });

  describe('image extraction', () => {
    it('should extract image files from DM messages', async () => {
      await messageListener({
        message: {
          user: 'U123',
          channel: 'D456',
          channel_type: 'im',
          text: 'look at this',
          ts: '5000.001',
          files: [
            { url_private: 'https://files.slack.com/a.jpg', mimetype: 'image/jpeg', name: 'photo.jpg' },
            { url_private: 'https://files.slack.com/b.pdf', mimetype: 'application/pdf', name: 'doc.pdf' },
          ],
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].images).toHaveLength(1);
      expect(received[0].images![0].filename).toBe('photo.jpg');
    });

    it('should set undefined images when no image files present', async () => {
      await messageListener({
        message: {
          user: 'U123',
          channel: 'D456',
          channel_type: 'im',
          text: 'no images',
          ts: '5000.002',
          files: [
            { url_private: 'https://files.slack.com/b.pdf', mimetype: 'application/pdf', name: 'doc.pdf' },
          ],
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].images).toBeUndefined();
    });
  });
});
