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
  /** 연결 시작 */
  start(): Promise<void>;

  /** 연결 종료 */
  stop(): Promise<void>;

  /** 메시지 수신 콜백 등록 */
  onMessage(handler: (msg: IncomingMessage) => void): void;

  /** 텍스트 메시지 전송. 메시지 ID 반환 */
  sendText(channelId: string, text: string, threadId?: string): Promise<string>;

  /** 승인/거부 버튼이 포함된 메시지 전송 */
  sendApproval(
    channelId: string,
    text: string,
    taskId: string,
    threadId?: string,
  ): Promise<void>;

  /** 승인/거부 콜백 등록 */
  onApproval(handler: (taskId: string, approved: boolean) => void): void;
}
