import { App, type LogLevel } from '@slack/bolt';
import type { MessengerAdapter, IncomingMessage, ImageAttachment } from './adapter.js';

export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export class SlackAdapter implements MessengerAdapter {
  private app: App;
  private botToken: string;
  private messageHandler?: (msg: IncomingMessage) => void;
  private approvalHandler?: (taskId: string, approved: boolean) => void;

  constructor(config: SlackConfig) {
    this.botToken = config.botToken;
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      logLevel: 'ERROR' as LogLevel,
    });

    this.setupListeners();
  }

  private setupListeners(): void {
    // Receive incoming messages
    this.app.message(async ({ message }) => {
      if (!this.messageHandler) return;
      if (message.subtype) return; // Ignore bot messages, edits, etc.

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

      this.messageHandler({
        platform: 'slack',
        userId: msg.user,
        channelId: msg.channel ?? '',
        threadId: msg.thread_ts,
        text: msg.text ?? '',
        images: images.length > 0 ? images : undefined,
        timestamp: new Date(parseFloat(msg.ts ?? '0') * 1000),
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
    await this.app.start();
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendText(channelId: string, text: string, threadId?: string): Promise<string> {
    const result = await this.app.client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadId,
    });
    return result.ts ?? '';
  }

  async sendApproval(
    channelId: string,
    text: string,
    taskId: string,
    threadId?: string,
  ): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadId,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              action_id: 'approve_task',
              value: taskId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject' },
              style: 'danger',
              action_id: 'reject_task',
              value: taskId,
            },
          ],
        },
      ],
    });
  }

  onApproval(handler: (taskId: string, approved: boolean) => void): void {
    this.approvalHandler = handler;
  }
}
