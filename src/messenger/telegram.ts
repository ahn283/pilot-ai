import { Telegraf, type Context } from 'telegraf';
import type { MessengerAdapter, IncomingMessage } from './adapter.js';

export interface TelegramConfig {
  botToken: string;
}

export class TelegramAdapter implements MessengerAdapter {
  private bot: Telegraf;
  private messageHandler?: (msg: IncomingMessage) => void;
  private approvalHandler?: (taskId: string, approved: boolean) => void;

  constructor(config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken);
    this.setupListeners();
  }

  private setupListeners(): void {
    // 일반 텍스트 메시지 수신
    this.bot.on('text', (ctx) => {
      if (!this.messageHandler) return;

      const msg = ctx.message;
      this.messageHandler({
        platform: 'telegram',
        userId: String(msg.from.id),
        channelId: String(msg.chat.id),
        threadId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
        text: msg.text,
        timestamp: new Date(msg.date * 1000),
      });
    });

    // 승인/거부 Inline Keyboard 콜백
    this.bot.on('callback_query', async (ctx) => {
      if (!this.approvalHandler) return;

      const query = ctx.callbackQuery;
      if (!('data' in query) || !query.data) return;

      const [action, taskId] = query.data.split(':');
      if (!taskId) return;

      if (action === 'approve') {
        this.approvalHandler(taskId, true);
        await ctx.answerCbQuery('승인됨');
      } else if (action === 'reject') {
        this.approvalHandler(taskId, false);
        await ctx.answerCbQuery('거부됨');
      }
    });
  }

  async start(): Promise<void> {
    // Long Polling 시작 (non-blocking)
    this.bot.launch();
  }

  async stop(): Promise<void> {
    this.bot.stop('SIGTERM');
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendText(channelId: string, text: string, threadId?: string): Promise<string> {
    const result = await this.bot.telegram.sendMessage(channelId, text, {
      parse_mode: 'Markdown',
      ...(threadId ? { reply_parameters: { message_id: parseInt(threadId, 10) } } : {}),
    });
    return String(result.message_id);
  }

  async sendApproval(
    channelId: string,
    text: string,
    taskId: string,
    threadId?: string,
  ): Promise<void> {
    await this.bot.telegram.sendMessage(channelId, text, {
      parse_mode: 'Markdown',
      ...(threadId ? { reply_parameters: { message_id: parseInt(threadId, 10) } } : {}),
      reply_markup: {
        inline_keyboard: [
          [
            { text: '승인', callback_data: `approve:${taskId}` },
            { text: '거부', callback_data: `reject:${taskId}` },
          ],
        ],
      },
    });
  }

  onApproval(handler: (taskId: string, approved: boolean) => void): void {
    this.approvalHandler = handler;
  }
}
