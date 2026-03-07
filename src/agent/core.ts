import type { MessengerAdapter, IncomingMessage } from '../messenger/adapter.js';
import type { PilotConfig } from '../config/schema.js';
import { isAuthorizedUser } from '../security/auth.js';
import { writeAuditLog } from '../security/audit.js';
import { invokeClaudeCli, invokeClaudeApi } from './claude.js';
import { ApprovalManager, classifySafety } from './safety.js';

export class AgentCore {
  private messenger: MessengerAdapter;
  private config: PilotConfig;
  private approvalManager: ApprovalManager;

  constructor(messenger: MessengerAdapter, config: PilotConfig) {
    this.messenger = messenger;
    this.config = config;
    this.approvalManager = new ApprovalManager();

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.messenger.onMessage((msg) => this.handleMessage(msg));
    this.messenger.onApproval((taskId, approved) => {
      this.approvalManager.handleResponse(taskId, approved);
    });
  }

  async start(): Promise<void> {
    await this.messenger.start();
  }

  async stop(): Promise<void> {
    await this.messenger.stop();
  }

  private async handleMessage(msg: IncomingMessage): Promise<void> {
    // 1. 인증 검증
    if (!isAuthorizedUser(msg, this.config)) {
      await writeAuditLog({
        timestamp: new Date().toISOString(),
        type: 'command',
        userId: msg.userId,
        platform: msg.platform,
        content: `[BLOCKED] ${msg.text}`,
      });
      return; // 무시 (응답 없음)
    }

    // 2. 감사 로그
    await writeAuditLog({
      timestamp: new Date().toISOString(),
      type: 'command',
      userId: msg.userId,
      platform: msg.platform,
      content: msg.text,
    });

    // 3. Claude에 프롬프트 전달
    try {
      const response = await this.invokeClaudeWithContext(msg);

      // 4. 결과를 메신저로 전송 (스레드 유지)
      const threadId = msg.threadId;
      await this.messenger.sendText(msg.channelId, response, threadId);

      await writeAuditLog({
        timestamp: new Date().toISOString(),
        type: 'result',
        userId: msg.userId,
        platform: msg.platform,
        content: response,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.messenger.sendText(
        msg.channelId,
        `오류가 발생했습니다: ${errorMsg}`,
        msg.threadId,
      );

      await writeAuditLog({
        timestamp: new Date().toISOString(),
        type: 'error',
        userId: msg.userId,
        platform: msg.platform,
        content: errorMsg,
      });
    }
  }

  /**
   * 메모리 컨텍스트를 포함하여 Claude를 호출한다.
   */
  private async invokeClaudeWithContext(msg: IncomingMessage): Promise<string> {
    // TODO: Phase 1.9에서 메모리 주입 구현
    // TODO: Phase 1.8에서 프로젝트 인식 + --cwd 구현
    const prompt = msg.text;

    if (this.config.claude.mode === 'api' && this.config.claude.apiKey) {
      return invokeClaudeApi({
        prompt,
        apiKey: this.config.claude.apiKey,
      });
    }

    const result = await invokeClaudeCli({ prompt });
    return result.result;
  }
}
