import { App, type LogLevel } from '@slack/bolt';
import type { MessengerAdapter, IncomingMessage } from './adapter.js';

export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export class SlackAdapter implements MessengerAdapter {
  private app: App;
  private messageHandler?: (msg: IncomingMessage) => void;
  private approvalHandler?: (taskId: string, approved: boolean) => void;

  constructor(config: SlackConfig) {
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
    // 일반 메시지 수신
    this.app.message(async ({ message }) => {
      if (!this.messageHandler) return;
      if (message.subtype) return; // bot messages, edits 등 무시

      const msg = message as { user?: string; channel?: string; thread_ts?: string; text?: string; ts?: string };
      if (!msg.user || !msg.text) return;

      this.messageHandler({
        platform: 'slack',
        userId: msg.user,
        channelId: msg.channel ?? '',
        threadId: msg.thread_ts,
        text: msg.text,
        timestamp: new Date(parseFloat(msg.ts ?? '0') * 1000),
      });
    });

    // 승인/거부 버튼 액션
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
              text: { type: 'plain_text', text: '승인' },
              style: 'primary',
              action_id: 'approve_task',
              value: taskId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '거부' },
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
