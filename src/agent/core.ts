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
import { buildSkillsContext } from './skills.js';
import { buildToolDescriptions } from './tool-descriptions.js';
import { getMcpConfigPathIfExists } from '../tools/figma-mcp.js';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

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
    log('Connecting to messenger...');
    await this.messenger.start();
    log('Messenger connected. Waiting for messages...');
  }

  async stop(): Promise<void> {
    log('Stopping messenger...');
    await this.messenger.stop();
  }

  private async handleMessage(msg: IncomingMessage): Promise<void> {
    log(`Message received from ${msg.platform}:${msg.userId} in ${msg.channelId}: "${msg.text}"`);

    // 1. Auth check
    if (!isAuthorizedUser(msg, this.config)) {
      log(`BLOCKED: user ${msg.userId} is not in allowedUsers`);
      await writeAuditLog({
        timestamp: new Date().toISOString(),
        type: 'command',
        userId: msg.userId,
        platform: msg.platform,
        content: `[BLOCKED] ${msg.text}`,
      });
      return;
    }

    log(`Authorized user ${msg.userId}`);

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
      log('Handled as memory command');
      await this.messenger.sendText(msg.channelId, memResult.response!, msg.threadId);
      return;
    }

    // 4. Detect user preferences (async, non-blocking)
    detectAndSavePreference(msg.text).catch(() => {});

    // 5. Send thinking status and invoke Claude
    log('Invoking Claude...');
    const statusMsgId = await this.messenger.sendText(
      msg.channelId, '🤔 Thinking...', msg.threadId,
    );

    try {
      const response = await this.invokeClaudeWithContext(msg, async (status: string) => {
        try {
          await this.messenger.updateText(msg.channelId, statusMsgId, status);
        } catch {
          // Ignore update failures (e.g. message already deleted)
        }
      });

      log(`Claude response (${response.length} chars): "${response.slice(0, 100)}..."`);
      await this.messenger.updateText(msg.channelId, statusMsgId, response);

      await writeAuditLog({
        timestamp: new Date().toISOString(),
        type: 'result',
        userId: msg.userId,
        platform: msg.platform,
        content: response,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`Claude error: ${errorMsg}`);
      await this.messenger.updateText(
        msg.channelId, statusMsgId, `❌ Error: ${errorMsg}`,
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
  private async invokeClaudeWithContext(
    msg: IncomingMessage,
    onStatus?: (status: string) => Promise<void>,
  ): Promise<string> {
    // Resolve project from message text
    const project = await resolveProject(msg.text);
    const projectName = project?.name;
    const projectPath = project?.path;

    // If project resolved, analyze on first use and update lastUsed
    if (projectName && projectPath) {
      await touchProject(projectName);
      await analyzeProjectIfNew(projectName, projectPath);
    }

    // Build memory context, skills context, and tool descriptions
    const memoryContext = await buildMemoryContext(projectName);
    const skillsContext = await buildSkillsContext();
    const toolDescriptions = buildToolDescriptions();

    const contextParts: string[] = [];
    if (memoryContext) contextParts.push(memoryContext);
    if (skillsContext) contextParts.push(skillsContext);
    if (toolDescriptions) contextParts.push(toolDescriptions);

    const prompt = contextParts.length > 0
      ? `${contextParts.join('\n\n')}\n\n<USER_COMMAND>\n${msg.text}\n</USER_COMMAND>`
      : msg.text;

    await onStatus?.('⚙️ Processing...');

    if (this.config.claude.mode === 'api' && this.config.claude.apiKey) {
      return invokeClaudeApi({
        prompt,
        apiKey: this.config.claude.apiKey,
      });
    }

    const mcpConfigPath = await getMcpConfigPathIfExists() ?? undefined;
    const result = await invokeClaudeCli({
      prompt,
      cwd: projectPath,
      mcpConfigPath,
    });
    return result.result;
  }
}
