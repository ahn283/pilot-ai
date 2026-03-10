export interface ImageAttachment {
  url: string;
  mimeType: string;
  filename?: string;
  authHeader?: string;
}

export interface IncomingMessage {
  platform: 'slack' | 'telegram';
  userId: string;
  channelId: string;
  threadId?: string;
  text: string;
  images?: ImageAttachment[];
  timestamp: Date;
}

export interface MessengerAdapter {
  /** Start connection */
  start(): Promise<void>;

  /** Stop connection */
  stop(): Promise<void>;

  /** Register incoming message callback */
  onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): void;

  /** Send a text message. Returns message ID */
  sendText(channelId: string, text: string, threadId?: string): Promise<string>;

  /** Update an existing message by its ID */
  updateText(channelId: string, messageId: string, text: string, threadId?: string): Promise<void>;

  /** Add a reaction to a message (best-effort, no-op if unsupported) */
  addReaction?(channelId: string, messageTs: string, emoji: string): Promise<void>;

  /** Remove a reaction from a message (best-effort, no-op if unsupported) */
  removeReaction?(channelId: string, messageTs: string, emoji: string): Promise<void>;

  /** Send an approval message with Approve/Reject buttons */
  sendApproval(
    channelId: string,
    text: string,
    taskId: string,
    threadId?: string,
  ): Promise<void>;

  /** Register approval/rejection callback */
  onApproval(handler: (taskId: string, approved: boolean) => void): void;
}
