import type { MessengerAdapter, IncomingMessage } from '../messenger/adapter.js';
import type { PilotConfig } from '../config/schema.js';
import { isAuthorizedUser } from '../security/auth.js';
import { writeAuditLog } from '../security/audit.js';
import { invokeClaudeCli, invokeClaudeApi } from './claude.js';
import { ApprovalManager } from './safety.js';
import { buildMemoryContext } from './memory.js';
import { resolveProject, touchProject } from './project.js';
import { handleMemoryCommand } from './memory-commands.js';
import { detectAndSavePreference } from './preference-detector.js';
import { analyzeProjectIfNew } from './project-analyzer.js';

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
    // 1. Auth check
    if (!isAuthorizedUser(msg, this.config)) {
      await writeAuditLog({
        timestamp: new Date().toISOString(),
        type: 'command',
        userId: msg.userId,
        platform: msg.platform,
        content: `[BLOCKED] ${msg.text}`,
      });
      return;
    }

    // 2. Audit log
    await writeAuditLog({
      timestamp: new Date().toISOString(),
      type: 'command',
      userId: msg.userId,
      platform: msg.platform,
      content: msg.text,
    });

    // 3. Memory command intercept
    const memResult = await handleMemoryCommand(msg.text);
    if (memResult.handled) {
      await this.messenger.sendText(msg.channelId, memResult.response!, msg.threadId);
      return;
    }

    // 4. Detect user preferences (async, non-blocking)
    detectAndSavePreference(msg.text).catch(() => {});

    // 5. Invoke Claude with context
    try {
      const response = await this.invokeClaudeWithContext(msg);
      await this.messenger.sendText(msg.channelId, response, msg.threadId);

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
        `Error: ${errorMsg}`,
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
   * Resolves project from message, builds memory context, and invokes Claude.
   */
  private async invokeClaudeWithContext(msg: IncomingMessage): Promise<string> {
    // Resolve project from message text
    const project = await resolveProject(msg.text);
    const projectName = project?.name;
    const projectPath = project?.path;

    // If project resolved, analyze on first use and update lastUsed
    if (projectName && projectPath) {
      await touchProject(projectName);
      await analyzeProjectIfNew(projectName, projectPath);
    }

    // Build memory context
    const memoryContext = await buildMemoryContext(projectName);
    const prompt = memoryContext
      ? `${memoryContext}\n\n<USER_COMMAND>\n${msg.text}\n</USER_COMMAND>`
      : msg.text;

    if (this.config.claude.mode === 'api' && this.config.claude.apiKey) {
      return invokeClaudeApi({
        prompt,
        apiKey: this.config.claude.apiKey,
      });
    }

    const result = await invokeClaudeCli({
      prompt,
      cwd: projectPath,
    });
    return result.result;
  }
}
