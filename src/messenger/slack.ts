import { App, type LogLevel } from '@slack/bolt';
import type { MessengerAdapter, IncomingMessage, ImageAttachment } from './adapter.js';
import { splitMessage, MAX_MESSAGE_LENGTH } from './split.js';
import { RateLimiter } from '../utils/rate-limiter.js';

export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export class SlackAdapter implements MessengerAdapter {
  private app: App;
  private botToken: string;
  private botUserId?: string;
  private messageHandler?: (msg: IncomingMessage) => void | Promise<void>;
  private approvalHandler?: (taskId: string, approved: boolean) => void;
  private rateLimiter = new RateLimiter(5, 1); // Slack: ~1 msg/sec, burst 5
  private processedMessages = new Set<string>(); // Dedup message/app_mention events

  constructor(config: SlackConfig) {
    this.botToken = config.botToken;
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      logLevel: 'INFO' as LogLevel,
    });

    this.app.error(async (error) => {
      console.error(`[${new Date().toISOString()}] Slack unhandled error:`, error);
    });

    this.setupListeners();
  }

  /**
   * Dedup guard: returns true if this message ts was already processed.
   * Prevents duplicate handling when Slack sends both message and app_mention events.
   */
  private isDuplicate(ts: string): boolean {
    if (this.processedMessages.has(ts)) return true;
    this.processedMessages.add(ts);
    // Keep set bounded — clear old entries when it gets large
    if (this.processedMessages.size > 1000) {
      const entries = [...this.processedMessages];
      this.processedMessages = new Set(entries.slice(-500));
    }
    return false;
  }

  private setupListeners(): void {
    // Receive incoming messages
    this.app.message(async ({ message }) => {
      console.log(`[${new Date().toISOString()}] Slack event: message received`, JSON.stringify({ subtype: (message as { subtype?: string }).subtype, user: (message as { user?: string }).user, channel: (message as { channel?: string }).channel }));
      if (!this.messageHandler) {
        console.log(`[${new Date().toISOString()}] Slack: no messageHandler registered, ignoring`);
        return;
      }
      if (message.subtype && message.subtype !== 'file_share') {
        console.log(`[${new Date().toISOString()}] Slack: ignoring message with subtype "${message.subtype}"`);
        return;
      }

      const msg = message as {
        user?: string;
        channel?: string;
        thread_ts?: string;
        text?: string;
        ts?: string;
        files?: Array<{ url_private: string; mimetype: string; name: string }>;
      };
      if (!msg.user) return;
      if (!msg.text && !msg.files?.length) return;

      // Dedup: skip if already handled (e.g. via app_mention)
      if (this.isDuplicate(msg.ts ?? '')) {
        console.log(`[${new Date().toISOString()}] Slack: skipping duplicate message ts=${msg.ts}`);
        return;
      }

      // Extract image attachments from Slack files (requires files:read scope)
      const images: ImageAttachment[] = [];
      if (msg.files) {
        for (const file of msg.files) {
          if (file.mimetype?.startsWith('image/')) {
            images.push({
              url: file.url_private,
              mimeType: file.mimetype,
              filename: file.name,
              authHeader: `Bearer ${this.botToken}`,
            });
          }
        }
      }

      await this.messageHandler({
        platform: 'slack',
        userId: msg.user,
        channelId: msg.channel ?? '',
        threadId: msg.thread_ts ?? msg.ts,
        text: msg.text ?? '',
        images: images.length > 0 ? images : undefined,
        timestamp: new Date(parseFloat(msg.ts ?? '0') * 1000),
      });
    });

    // Receive @mentions in channels
    this.app.event('app_mention', async ({ event }) => {
      console.log(`[${new Date().toISOString()}] Slack event: app_mention from ${event.user} in ${event.channel}`);
      if (!this.messageHandler) return;

      // Dedup: skip if already handled via message event
      if (this.isDuplicate(event.ts)) {
        console.log(`[${new Date().toISOString()}] Slack: skipping duplicate app_mention ts=${event.ts}`);
        return;
      }

      // Strip the bot mention from the text
      const text = (event.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text || !event.user) return;

      await this.messageHandler({
        platform: 'slack',
        userId: event.user as string,
        channelId: event.channel,
        threadId: event.thread_ts ?? event.ts,
        text,
        timestamp: new Date(parseFloat(event.ts) * 1000),
      });
    });

    // Approve/Reject button actions
    this.app.action('approve_task', async ({ action, ack, body }) => {
      await ack();
      if (!this.approvalHandler) return;
      const actionObj = action as { value?: string };
      if (actionObj.value) {
        this.approvalHandler(actionObj.value, true);
      }
    });

    this.app.action('reject_task', async ({ action, ack, body }) => {
      await ack();
      if (!this.approvalHandler) return;
      const actionObj = action as { value?: string };
      if (actionObj.value) {
        this.approvalHandler(actionObj.value, false);
      }
    });
  }

  async start(): Promise<void> {
    console.log(`[${new Date().toISOString()}] Slack: connecting via Socket Mode...`);
    await this.app.start();
    console.log(`[${new Date().toISOString()}] Slack: connected and listening for messages`);
  }

  async stop(): Promise<void> {
    console.log(`[${new Date().toISOString()}] Slack: disconnecting...`);
    await this.app.stop();
  }

  onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendText(channelId: string, text: string, threadId?: string): Promise<string> {
    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH.slack);
    let lastTs = '';
    for (const chunk of chunks) {
      await this.rateLimiter.acquire();
      const result = await this.app.client.chat.postMessage({
        channel: channelId,
        text: chunk,
        thread_ts: threadId,
      });
      lastTs = result.ts ?? '';
    }
    return lastTs;
  }

  async updateText(channelId: string, messageId: string, text: string, threadId?: string): Promise<void> {
    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH.slack);
    // Update the original message with the first chunk
    try {
      await this.app.client.chat.update({
        channel: channelId,
        ts: messageId,
        text: chunks[0],
      });
    } catch (err) {
      // If chat.update fails (e.g. msg_too_long, message_not_found), fall back to posting new message
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Slack] chat.update failed: ${errMsg}. Falling back to postMessage.`);
      await this.rateLimiter.acquire();
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: chunks[0],
        thread_ts: threadId ?? messageId,
      });
    }
    // Send remaining chunks as new messages in the same thread
    for (let i = 1; i < chunks.length; i++) {
      await this.rateLimiter.acquire();
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: chunks[i],
        thread_ts: threadId ?? messageId,
      });
    }
  }

  async sendApproval(
    channelId: string,
    text: string,
    taskId: string,
    threadId?: string,
  ): Promise<void> {
    const BLOCK_TEXT_LIMIT = 3000;
    const approvalButtons = {
      type: 'actions' as const,
      elements: [
        {
          type: 'button' as const,
          text: { type: 'plain_text' as const, text: 'Approve' },
          style: 'primary' as const,
          action_id: 'approve_task',
          value: taskId,
        },
        {
          type: 'button' as const,
          text: { type: 'plain_text' as const, text: 'Reject' },
          style: 'danger' as const,
          action_id: 'reject_task',
          value: taskId,
        },
      ],
    };

    if (text.length > BLOCK_TEXT_LIMIT) {
      // Send full text as regular message(s) first, then approval buttons separately
      await this.sendText(channelId, text, threadId);
      await this.rateLimiter.acquire();
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: 'Approve or reject?',
        thread_ts: threadId,
        blocks: [approvalButtons],
      });
    } else {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text,
        thread_ts: threadId,
        blocks: [
          {
            type: 'section' as const,
            text: { type: 'mrkdwn' as const, text },
          },
          approvalButtons,
        ],
      });
    }
  }

  async addReaction(channelId: string, messageTs: string, emoji: string): Promise<void> {
    try {
      await this.app.client.reactions.add({ channel: channelId, timestamp: messageTs, name: emoji });
    } catch {
      // Ignore reaction failures (e.g. already reacted, missing scope)
    }
  }

  async removeReaction(channelId: string, messageTs: string, emoji: string): Promise<void> {
    try {
      await this.app.client.reactions.remove({ channel: channelId, timestamp: messageTs, name: emoji });
    } catch {
      // Ignore reaction failures
    }
  }

  onApproval(handler: (taskId: string, approved: boolean) => void): void {
    this.approvalHandler = handler;
  }
}
