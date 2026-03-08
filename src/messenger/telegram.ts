import { Telegraf } from 'telegraf';
import type { MessengerAdapter, IncomingMessage, ImageAttachment } from './adapter.js';
import { splitMessage, MAX_MESSAGE_LENGTH } from './split.js';

export interface TelegramConfig {
  botToken: string;
}

export class TelegramAdapter implements MessengerAdapter {
  private bot: Telegraf;
  private botToken: string;
  private messageHandler?: (msg: IncomingMessage) => void | Promise<void>;
  private approvalHandler?: (taskId: string, approved: boolean) => void;

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken;
    this.bot = new Telegraf(config.botToken);
    this.setupListeners();
  }

  private async getFileUrl(fileId: string): Promise<string> {
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/getFile?file_id=${fileId}`);
    const data = (await res.json()) as { ok: boolean; result?: { file_path: string } };
    if (!data.ok || !data.result) throw new Error('Failed to get Telegram file');
    return `https://api.telegram.org/file/bot${this.botToken}/${data.result.file_path}`;
  }

  private async extractImages(msg: { photo?: Array<{ file_id: string; width: number }> }): Promise<ImageAttachment[]> {
    if (!msg.photo?.length) return [];
    // Telegram sends multiple sizes; pick the largest
    const largest = msg.photo.reduce((a, b) => (a.width > b.width ? a : b));
    try {
      const url = await this.getFileUrl(largest.file_id);
      return [{ url, mimeType: 'image/jpeg', filename: `telegram-${Date.now()}.jpg` }];
    } catch {
      return [];
    }
  }

  private setupListeners(): void {
    // Text messages
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

    // Photo messages
    this.bot.on('photo', async (ctx) => {
      if (!this.messageHandler) return;

      const msg = ctx.message;
      const images = await this.extractImages(msg);

      this.messageHandler({
        platform: 'telegram',
        userId: String(msg.from.id),
        channelId: String(msg.chat.id),
        threadId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
        text: (msg as { caption?: string }).caption ?? '',
        images: images.length > 0 ? images : undefined,
        timestamp: new Date(msg.date * 1000),
      });
    });

    // Approve/Reject inline keyboard callback
    this.bot.on('callback_query', async (ctx) => {
      if (!this.approvalHandler) return;

      const query = ctx.callbackQuery;
      if (!('data' in query) || !query.data) return;

      const [action, taskId] = query.data.split(':');
      if (!taskId) return;

      if (action === 'approve') {
        this.approvalHandler(taskId, true);
        await ctx.answerCbQuery('Approved');
      } else if (action === 'reject') {
        this.approvalHandler(taskId, false);
        await ctx.answerCbQuery('Rejected');
      }
    });
  }

  async start(): Promise<void> {
    // Start long polling (non-blocking)
    this.bot.launch();
  }

  async stop(): Promise<void> {
    this.bot.stop('SIGTERM');
  }

  onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendText(channelId: string, text: string, threadId?: string): Promise<string> {
    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH.telegram);
    let lastId = '';
    for (const chunk of chunks) {
      const result = await this.bot.telegram.sendMessage(channelId, chunk, {
        parse_mode: 'Markdown',
        ...(threadId ? { reply_parameters: { message_id: parseInt(threadId, 10) } } : {}),
      });
      lastId = String(result.message_id);
    }
    return lastId;
  }

  async updateText(channelId: string, messageId: string, text: string): Promise<void> {
    await this.bot.telegram.editMessageText(
      channelId,
      parseInt(messageId, 10),
      undefined,
      text,
      { parse_mode: 'Markdown' },
    );
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
            { text: 'Approve', callback_data: `approve:${taskId}` },
            { text: 'Reject', callback_data: `reject:${taskId}` },
          ],
        ],
      },
    });
  }

  onApproval(handler: (taskId: string, approved: boolean) => void): void {
    this.approvalHandler = handler;
  }
}
