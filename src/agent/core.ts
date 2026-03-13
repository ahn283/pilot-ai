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
import { buildMcpContext, migrateToSecureLaunchers, checkAllMcpServerStatus } from './mcp-manager.js';
import { PilotError } from '../utils/errors.js';
import { getSession, createSession, touchSession, deleteSession, cleanupSessions, getRemainingTurns } from './session.js';
import { updateConversationSummary, getConversationSummaryText, cleanupExpiredSummaries } from './conversation-summary.js';
import { detectPermissionError, PermissionWatcher } from '../security/permissions.js';
import { isGhAuthenticated } from '../tools/github.js';
import { configureGoogle, loadGoogleTokens } from '../tools/google-auth.js';
import { startTokenRefresher, stopTokenRefresher } from './token-refresher.js';
import { loadMcpConfig } from '../tools/figma-mcp.js';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export class AgentCore {
  private messenger: MessengerAdapter;
  private config: PilotConfig;
  private approvalManager: ApprovalManager;
  private permissionWatcher: PermissionWatcher;
  private githubCheckInterval: ReturnType<typeof setInterval> | null = null;

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
    // Initialize Google OAuth module if configured
    if (this.config.google) {
      configureGoogle({
        clientId: this.config.google.clientId,
        clientSecret: this.config.google.clientSecret,
      });
      log('Google OAuth configured.');
    }

    log('Connecting to messenger...');
    await this.messenger.start();
    log('Messenger connected. Waiting for messages...');
    await this.permissionWatcher.start();
    log('Permission watcher started.');

    // Check GitHub auth status on startup and periodically (every hour)
    // Only if github MCP server is registered in mcp-config.json
    if (this.config.github?.enabled) {
      const mcpConfigForGh = await loadMcpConfig();
      if ('github' in mcpConfigForGh.mcpServers) {
        this.checkGitHubAuth().catch(() => {});
        this.githubCheckInterval = setInterval(() => {
          this.checkGitHubAuth().catch(() => {});
        }, 60 * 60 * 1000);
      } else {
        log('GitHub enabled in config but not registered as MCP server. Skipping auth check.');
      }
    }

    // Migrate existing MCP servers to secure Keychain-backed launchers
    const migration = await migrateToSecureLaunchers();
    if (migration.migrated.length > 0) {
      log(`Migrated MCP servers to secure launchers: ${migration.migrated.join(', ')}`);
    }

    // Start periodic Google OAuth token health checker (only if tokens exist AND MCP servers registered)
    if (this.config.google) {
      const tokens = await loadGoogleTokens();
      const mcpConfig = await loadMcpConfig();
      const googleServerIds = ['gmail', 'google-calendar', 'google-drive'];
      const hasGoogleMcp = googleServerIds.some(id => id in mcpConfig.mcpServers);

      if (tokens && hasGoogleMcp) {
        const users = this.config.messenger.platform === 'slack'
          ? this.config.security.allowedUsers.slack
          : this.config.security.allowedUsers.telegram;
        const notifyChannel = users.length > 0 ? users[0] : undefined;
        startTokenRefresher(
          notifyChannel ? this.messenger : undefined,
          notifyChannel,
        );
        log('Google token refresher started.');
      } else if (!tokens && hasGoogleMcp) {
        log('Google MCP servers registered but no tokens found. Run "pilot-ai auth google".');
      } else if (tokens && !hasGoogleMcp) {
        log('Google tokens found but no MCP servers registered. Skipping token refresher.');
      } else {
        log('Google OAuth configured but not active on this device.');
      }
    }

    // MCP server credential status summary
    const mcpStatuses = await checkAllMcpServerStatus();
    if (mcpStatuses.length > 0) {
      const summary = mcpStatuses.map(s => `${s.serverId}(${s.status})`).join(', ');
      log(`MCP servers: ${summary}`);

      const authRequired = mcpStatuses.filter(s => s.status === 'auth_required');
      if (authRequired.length > 0) {
        for (const s of authRequired) {
          log(`  ⚠ ${s.serverId}: ${s.message}`);
        }
        log(`Run 'pilot-ai addtool <name>' to re-authenticate.`);
      }
    }
  }

  private async checkGitHubAuth(): Promise<void> {
    if (!this.config.github?.enabled) return;

    const authed = await isGhAuthenticated();
    if (!authed) {
      log('GitHub CLI is not authenticated.');
      const users = this.config.messenger.platform === 'slack'
        ? this.config.security.allowedUsers.slack
        : this.config.security.allowedUsers.telegram;
      if (users.length > 0) {
        await this.messenger.sendText(
          users[0],
          '⚠️ GitHub CLI is not authenticated. Run `gh auth login` to reconnect.',
        );
      }
    } else {
      log('GitHub CLI authenticated.');
    }
  }

  async stop(): Promise<void> {
    if (this.githubCheckInterval) {
      clearInterval(this.githubCheckInterval);
      this.githubCheckInterval = null;
    }
    stopTokenRefresher();
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
            await this.messenger.updateText(msg.channelId, statusMsgId, status, msg.threadId);
          } catch {
            // Ignore update failures (e.g. message already deleted)
          }
        });

        log(`Claude response (${response.length} chars): "${response.slice(0, 100)}..."`);
        await this.messenger.removeReaction?.(msg.channelId, incomingTs, 'gear');
        await this.messenger.addReaction?.(msg.channelId, incomingTs, 'white_check_mark');

        // updateText now handles splitting internally
        await this.messenger.updateText(msg.channelId, statusMsgId, response, msg.threadId);

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

        // Determine user-friendly message based on error type
        let displayMsg: string;
        if (errorMsg.includes('msg_too_long')) {
          // Context overflow — session already handled by invokeClaudeWithContext fallback
          // If we still get here, it means the fallback also failed — delete session as last resort
          const threadId = msg.threadId ?? `dm-${Date.now()}`;
          await deleteSession(msg.platform, msg.channelId, threadId);
          displayMsg = '❌ Conversation too long. Session has been reset — please send your message again.';
          log(`Session deleted due to msg_too_long for ${msg.platform}:${msg.channelId}:${threadId}`);
        } else if (err instanceof PilotError) {
          displayMsg = `❌ ${err.userMessage}`;
        } else {
          // Check if this is a macOS permission error and provide actionable guidance
          const permissionHint = detectPermissionError(errorMsg);
          displayMsg = permissionHint
            ? `❌ ${permissionHint}`
            : `❌ Error: ${errorMsg}`;
        }
        // updateText now handles splitting internally
        await this.messenger.updateText(msg.channelId, statusMsgId, displayMsg, msg.threadId);

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
   * Uses session continuity: messages in the same thread share a Claude session.
   */
  private async invokeClaudeWithContext(
    msg: IncomingMessage,
    onStatus?: (status: string) => Promise<void>,
  ): Promise<string> {
    // Resolve project from message text
    const project = await resolveProject(msg.text);
    const projectName = project?.name;
    let projectPath = project?.path;

    // Build system-level context (memory, skills, tool descriptions)
    const memoryContext = await buildMemoryContext(projectName);
    const skillsContext = await buildSkillsContext();
    const toolDescriptions = buildToolDescriptions();

    const systemParts: string[] = [];
    systemParts.push(`You are Pilot-AI, a personal AI agent on macOS. You are an AGENT, not a chatbot — NEVER ask questions you can answer by using tools.

RULES:
1. INVESTIGATE FIRST — Use Bash, Read, Glob, Grep, WebSearch, WebFetch to gather info before responding. Explore the filesystem and projects with "ls", "find", "gh", "git log", etc.
2. NEVER ASK CLARIFYING QUESTIONS if you can figure it out. Search ~/Github for repos, run "gh" commands, read files — do NOT ask "which repo?" or "where is it?".
3. CHAIN TOOLS — One tool call is rarely enough. Keep investigating until you have the full answer.
4. COMPLETE THE TASK — If a command fails, try another approach. Only respond when you have a concrete answer or completed the action.
5. BE CONCISE — Report results directly. No filler.
6. CODING — understand → implement → build → test → fix → report. Write code directly; never say "I can't".
7. CREDENTIALS — Check ~/.pilot/credentials/ first. If missing, ask the user and save with chmod 600.`);
    // MCP server context (installed + available servers)
    const mcpContext = await buildMcpContext();
    if (mcpContext) systemParts.push(mcpContext);

    // Truncate optional context to limit system prompt size
    if (memoryContext) systemParts.push(memoryContext.slice(0, 2000));
    if (skillsContext) systemParts.push(skillsContext.slice(0, 1000));
    if (toolDescriptions) systemParts.push(toolDescriptions.slice(0, 1000));

    await onStatus?.('⚙️ Processing...');

    if (this.config.claude.mode === 'api' && this.config.claude.apiKey) {
      // API mode: inject context into user prompt (no system prompt support)
      const apiPrompt = `${systemParts.join('\n\n')}\n\n<USER_COMMAND>\n${msg.text}\n</USER_COMMAND>`;
      return invokeClaudeApi({
        prompt: apiPrompt,
        apiKey: this.config.claude.apiKey,
      });
    }

    // Session continuity: map messenger threads to Claude sessions
    const threadId = msg.threadId ?? `dm-${Date.now()}`;
    const existingSession = await getSession(msg.platform, msg.channelId, threadId);

    let sessionId: string | undefined;
    let resumeSessionId: string | undefined;

    if (existingSession) {
      // Resume existing session — Claude retains full conversation context
      resumeSessionId = existingSession.sessionId;
      // Bug fix: restore projectPath from session when not resolved from message text
      if (!projectPath && existingSession.projectPath) {
        projectPath = existingSession.projectPath;
      }
      await touchSession(msg.platform, msg.channelId, threadId);
      log(`Resuming session ${resumeSessionId} (turn ${existingSession.turnCount + 1})`);
    } else {
      // New session — create and store mapping
      const session = await createSession(msg.platform, msg.channelId, threadId, projectPath);
      sessionId = session.sessionId;
      log(`New session ${sessionId}`);
    }

    // If project resolved (from message or session), analyze on first use
    if (projectName && projectPath) {
      await touchProject(projectName);
      await analyzeProjectIfNew(projectName, projectPath);
    }

    // Load conversation summary (used for new sessions & msg_too_long fallback)
    const conversationSummaryText = await getConversationSummaryText(
      msg.platform, msg.channelId, threadId,
    );

    // Proactive warning when session context is running low
    if (existingSession) {
      const remaining = getRemainingTurns(existingSession);
      if (remaining <= 3) {
        systemParts.push(
          `⚠️ Session context is running low (${remaining} turns remaining). Be extra concise. Summarize outputs instead of showing full content.`,
        );
      }
    }

    const systemPrompt = systemParts.join('\n\n');

    // For new sessions with prior conversation, inject summary into system prompt
    const fullSystemPrompt = !resumeSessionId && conversationSummaryText
      ? `${systemPrompt}\n\n<CONVERSATION_HISTORY>\n${conversationSummaryText}\n</CONVERSATION_HISTORY>`
      : systemPrompt;

    // Periodically clean up expired sessions and summaries (non-blocking)
    cleanupSessions().catch(() => {});
    cleanupExpiredSummaries().catch(() => {});

    const mcpConfigPath = await getMcpConfigPathIfExists() ?? undefined;
    log(`MCP config: ${mcpConfigPath ?? 'none'}`);

    // No --allowedTools: --dangerously-skip-permissions already permits all tools.
    // Passing --allowedTools with bypass mode is buggy (GitHub #12232) and can
    // silently block MCP tools even though they should be allowed.

    // Throttled thinking reporter — sends thinking snippets to messenger at most once per 5 seconds
    let lastThinkingReport = 0;
    let thinkingBuffer = '';
    const THINKING_THROTTLE_MS = 5_000;

    const buildThinkingHandler = () => {
      if (this.config.agent?.showThinking === false) return undefined;
      return (text: string) => {
        thinkingBuffer += text;
        const now = Date.now();
        if (now - lastThinkingReport > THINKING_THROTTLE_MS && thinkingBuffer.length > 0) {
          const snippet = thinkingBuffer.length > 200
            ? thinkingBuffer.slice(-200) + '...'
            : thinkingBuffer;
          onStatus?.(`💭 ${snippet}`);
          thinkingBuffer = '';
          lastThinkingReport = now;
        }
      };
    };

    try {
      const result = await invokeClaudeCli({
        prompt: msg.text,
        systemPrompt: resumeSessionId ? undefined : fullSystemPrompt,
        cwd: projectPath,
        mcpConfigPath,
        cliBinary: this.config.claude.cliBinary,
        onToolUse: (status) => onStatus?.(status),
        onThinking: buildThinkingHandler(),
        sessionId,
        resumeSessionId,
        maxTurns: 25,
      });

      // Save conversation summary after successful response (non-blocking)
      updateConversationSummary(
        msg.platform, msg.channelId, threadId,
        msg.text, result.result, projectPath,
      ).catch(() => {});

      return result.result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // msg_too_long: context overflow — fallback to fresh session (with or without summary)
      if (errorMsg.includes('msg_too_long')) {
        log(`msg_too_long: falling back to fresh session for ${threadId} (summary: ${conversationSummaryText ? 'yes' : 'no'})`);
        await deleteSession(msg.platform, msg.channelId, threadId);

        const fallbackSystemPrompt = conversationSummaryText
          ? `${systemPrompt}\n\n<CONVERSATION_HISTORY>\n${conversationSummaryText}\n</CONVERSATION_HISTORY>`
          : systemPrompt;

        // Reset thinking state for retry
        thinkingBuffer = '';
        lastThinkingReport = 0;

        const retryResult = await invokeClaudeCli({
          prompt: msg.text,
          systemPrompt: fallbackSystemPrompt,
          cwd: projectPath,
          mcpConfigPath,
          cliBinary: this.config.claude.cliBinary,
          onToolUse: (status) => onStatus?.(status),
          onThinking: buildThinkingHandler(),
          maxTurns: 25,
        });

        // Create a fresh session for subsequent messages
        await createSession(msg.platform, msg.channelId, threadId, projectPath);

        // Update conversation summary
        updateConversationSummary(
          msg.platform, msg.channelId, threadId,
          msg.text, retryResult.result, projectPath,
        ).catch(() => {});

        return retryResult.result;
      }

      // Re-throw for other errors
      throw err;
    }
  }
}
