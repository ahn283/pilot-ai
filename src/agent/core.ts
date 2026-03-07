import type { MessengerAdapter, IncomingMessage } from '../messenger/adapter.js';
import type { PilotConfig } from '../config/schema.js';
import { isAuthorizedUser } from '../security/auth.js';
import { writeAuditLog } from '../security/audit.js';
import { invokeClaudeCli, invokeClaudeApi, DEFAULT_ALLOWED_TOOLS } from './claude.js';
import { ApprovalManager } from './safety.js';
import { buildMemoryContext } from './memory.js';
import { resolveProject, touchProject } from './project.js';
import { handleMemoryCommand } from './memory-commands.js';
import { detectAndSavePreference } from './preference-detector.js';
import { analyzeProjectIfNew } from './project-analyzer.js';
import { buildSkillsContext } from './skills.js';
import { buildToolDescriptions } from './tool-descriptions.js';
import { getMcpConfigPathIfExists } from '../tools/figma-mcp.js';
import { detectPermissionError, PermissionWatcher } from '../security/permissions.js';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export class AgentCore {
  private messenger: MessengerAdapter;
  private config: PilotConfig;
  private approvalManager: ApprovalManager;
  private permissionWatcher: PermissionWatcher;

  constructor(messenger: MessengerAdapter, config: PilotConfig) {
    this.messenger = messenger;
    this.config = config;
    this.approvalManager = new ApprovalManager();
    this.permissionWatcher = new PermissionWatcher((message) => {
      log(`Permission: ${message}`);
      // Notify the first allowed user on the configured platform
      const users = config.messenger.platform === 'slack'
        ? config.security.allowedUsers.slack
        : config.security.allowedUsers.telegram;
      if (users.length > 0) {
        this.messenger.sendText(users[0], `🔐 ${message}`).catch(() => {});
      }
    });

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
    await this.permissionWatcher.start();
    log('Permission watcher started.');
  }

  async stop(): Promise<void> {
    this.permissionWatcher.stop();
    log('Stopping messenger...');
    await this.messenger.stop();
  }

  private async handleMessage(msg: IncomingMessage): Promise<void> {
    try {
      log(`Message received from ${msg.platform}:${msg.userId} in ${msg.channelId}: "${msg.text}"`);
      log(`Allowed users: ${JSON.stringify(this.config.security.allowedUsers)}`);

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

      // 5. Add thinking reaction and send status message
      log('Sending thinking status...');
      const incomingTs = msg.threadId ?? '';
      await this.messenger.addReaction?.(msg.channelId, incomingTs, 'thinking_face');
      const statusMsgId = await this.messenger.sendText(
        msg.channelId, '🤔 Thinking...', msg.threadId,
      );
      log(`Thinking message sent (id: ${statusMsgId}). Invoking Claude...`);

      try {
        await this.messenger.removeReaction?.(msg.channelId, incomingTs, 'thinking_face');
        await this.messenger.addReaction?.(msg.channelId, incomingTs, 'gear');

        const response = await this.invokeClaudeWithContext(msg, async (status: string) => {
          try {
            await this.messenger.updateText(msg.channelId, statusMsgId, status);
          } catch {
            // Ignore update failures (e.g. message already deleted)
          }
        });

        log(`Claude response (${response.length} chars): "${response.slice(0, 100)}..."`);
        await this.messenger.removeReaction?.(msg.channelId, incomingTs, 'gear');
        await this.messenger.addReaction?.(msg.channelId, incomingTs, 'white_check_mark');
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
        await this.messenger.removeReaction?.(msg.channelId, incomingTs, 'gear');
        await this.messenger.addReaction?.(msg.channelId, incomingTs, 'x');

        // Check if this is a macOS permission error and provide actionable guidance
        const permissionHint = detectPermissionError(errorMsg);
        const displayMsg = permissionHint
          ? `❌ ${permissionHint}`
          : `❌ Error: ${errorMsg}`;
        await this.messenger.updateText(msg.channelId, statusMsgId, displayMsg);

        await writeAuditLog({
          timestamp: new Date().toISOString(),
          type: 'error',
          userId: msg.userId,
          platform: msg.platform,
          content: errorMsg,
        });
      }
    } catch (err) {
      log(`FATAL error in handleMessage: ${err instanceof Error ? err.stack : String(err)}`);
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

    // Build system-level context (memory, skills, tool descriptions)
    const memoryContext = await buildMemoryContext(projectName);
    const skillsContext = await buildSkillsContext();
    const toolDescriptions = buildToolDescriptions();

    const systemParts: string[] = [];
    systemParts.push(`You are Pilot-AI, a personal AI agent running on the user's macOS machine.

CORE PRINCIPLE: You are an AGENT, not a chatbot. NEVER ask the user a question you could answer yourself by using tools. Think harder.

RULES:
1. INVESTIGATE FIRST — Before responding, use Bash, Read, Glob, Grep, WebSearch, and WebFetch to gather information. Run "ls", "find", "gh", "git log", "cat" etc. to explore the filesystem and projects.
2. NEVER ASK CLARIFYING QUESTIONS if you can figure it out yourself. If the user says "fridgify 배포 내역", search ~/Github for a fridgify repo, then run "gh release list" or "git log --oneline" there. Do NOT ask "which repo?".
3. CHAIN MULTIPLE TOOLS — One tool call is rarely enough. Read a file, then grep for context, then run a command. Keep going until you have the full answer.
4. USE THE RIGHT TOOL — For GitHub: use "gh" CLI. For files: use "ls", "cat", "find". For web info: use WebSearch. For Notion: use the Notion API. Think about what tool fits before defaulting to asking the user.
5. THINK STEP BY STEP — Before acting, plan your approach. "The user wants X. To find X, I need to check Y, which means I should run Z."
6. COMPLETE THE TASK — Do not stop halfway. If a command fails, try another approach. If you need more info, search for it. Only respond to the user when you have a concrete answer or have completed the action.
7. BE CONCISE — Report results directly. No filler, no "I'd be happy to help", no restating the question.`);
    if (memoryContext) systemParts.push(memoryContext);
    if (skillsContext) systemParts.push(skillsContext);
    if (toolDescriptions) systemParts.push(toolDescriptions);

    const systemPrompt = systemParts.join('\n\n');

    await onStatus?.('⚙️ Processing...');

    if (this.config.claude.mode === 'api' && this.config.claude.apiKey) {
      // API mode: inject context into user prompt (no system prompt support)
      const apiPrompt = `${systemPrompt}\n\n<USER_COMMAND>\n${msg.text}\n</USER_COMMAND>`;
      return invokeClaudeApi({
        prompt: apiPrompt,
        apiKey: this.config.claude.apiKey,
      });
    }

    const mcpConfigPath = await getMcpConfigPathIfExists() ?? undefined;
    const result = await invokeClaudeCli({
      prompt: msg.text,
      systemPrompt,
      cwd: projectPath,
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      mcpConfigPath,
      onToolUse: (status) => onStatus?.(status),
    });
    return result.result;
  }
}
