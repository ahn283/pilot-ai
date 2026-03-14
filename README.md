<p align="center">
  <a href="https://github.com/ahn283/pilot-ai">
    <img src="https://raw.githubusercontent.com/ahn283/pilot-ai/main/design/pilot_ai.png" alt="Pilot-AI Logo" width="480" />
  </a>
</p>

<p align="center">
  <strong>Personal AI agent that controls your macOS via Slack or Telegram</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pilot-ai"><img src="https://img.shields.io/npm/v/pilot-ai.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/pilot-ai"><img src="https://img.shields.io/npm/dm/pilot-ai.svg" alt="npm downloads" /></a>
  <img src="https://img.shields.io/badge/platform-macOS-blue.svg" alt="macOS" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node.js" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
</p>

---

Pilot-AI is a local AI agent that lives on your Mac. Send it natural-language commands from **Slack** or **Telegram**, and it autonomously controls your browser, files, shell, GitHub, Notion, Figma, Google Workspace, and more — powered by [Claude Code](https://code.claude.com/) CLI.

## How it works

```
┌──────────────────┐     ┌─────────────────┐     ┌──────────────────────┐
│  Slack / Telegram │────▶│   Pilot-AI Agent │────▶│   Claude Code CLI     │
│  (your phone/PC)  │◀────│   (local daemon) │◀────│   (agentic reasoning) │
└──────────────────┘     └────────┬────────┘     └──────────────────────┘
                                 │
                   ┌─────────────┼─────────────┐
                   ▼             ▼             ▼
             🌐 Browser    📁 Files      🔧 Shell
             (Playwright)  (Read/Write)  (Bash/Git/gh)
                   ▼             ▼             ▼
             📝 Notion     🔗 GitHub     📋 Linear
             (MCP)         (CLI/MCP)     (MCP)
                   ▼             ▼             ▼
             📧 Gmail      📅 Calendar  📁 Google Drive
             (OAuth2/MCP)  (OAuth2/MCP)  (OAuth2/MCP)
                   ▼             ▼             ▼
             🎨 Figma      🐛 Jira      📖 Confluence
             (MCP)         (MCP)         (MCP)
                   ▼
             🧪 Sentinel AI
             (QA Automation / MCP)
```

- **Runs locally** — your data never leaves your machine
- **Always on** — managed by macOS launchd, auto-restarts on crash
- **Agentic** — doesn't just answer, it investigates, acts, and follows through
- **Secure** — user allowlist, dangerous action approval, macOS Keychain for secrets

## Features

- **Messenger integration** — Slack (Socket Mode) or Telegram (Long Polling), no server needed
- **Browser automation** — navigate, click, screenshot, fill forms via Playwright
- **File & shell access** — read, write, search files and run shell commands
- **GitHub integration** — releases, PRs, issues via `gh` CLI
- **Notion integration** — search, create, update pages and databases via MCP
- **Google integration** — Gmail, Google Calendar, and Google Drive via OAuth2 with automatic token sync
- **Figma integration** — access designs, components, variables, and comments via MCP
- **Atlassian integration** — Jira issues/sprints and Confluence pages via MCP
- **MCP auto-discovery** — agent detects needed MCP servers and proposes installation with one-click approval
- **Claude Code MCP sync** — auto-registers MCP servers to `~/.claude.json` for native Claude Code access
- **Keychain-backed secrets** — MCP server credentials stored securely in macOS Keychain with launcher scripts
- **Coding agent** — writes code, runs builds, executes tests, and iterates until the task is done
- **Session continuity** — messages in the same thread share a Claude session with conversation summary buffer
- **Scheduled tasks** — cron-like jobs with natural language scheduling
- **Skills system** — teach the agent reusable procedures
- **Project awareness** — resolves projects, remembers context per project
- **Live status updates** — see what the agent is doing in real-time
- **Token health checker** — automatically refreshes and monitors OAuth token validity
- **QA automation** — generate, save, and run E2E tests via Sentinel AI MCP (Playwright/Maestro), with Markdown reports
- **Multi-device safe** — config sync across devices never triggers auth popups or side effects; credentials are device-local
- **MCP startup diagnostics** — logs credential status for every registered MCP server on startup
- **Credential management** — agent can request and store API keys via chat
- **Safety controls** — dangerous actions require explicit approval via messenger buttons

## Prerequisites

- **macOS** (launchd is macOS-only)
- **Node.js** >= 18
- **Claude Code CLI** — install and authenticate:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude  # login with your Claude Pro/Max account
  ```

## Quick Start

### 1. Install

```bash
npm install -g pilot-ai
```

### 2. Setup

```bash
pilot-ai init
```

The interactive wizard guides you through:

1. **Claude connection** — detects CLI auth or configures API key
2. **Messenger** — choose Slack or Telegram, enter tokens
3. **Integrations** — optionally connect Google (Gmail, Calendar, Drive), Notion, Figma, Linear, Jira, Confluence
4. **Browser** — installs Playwright Chromium
5. **Permissions** — requests macOS permissions (Accessibility, Automation, etc.)

### 3. Start

```bash
pilot-ai start
```

That's it. Open Slack or Telegram and start chatting with your agent.

### Follow logs in real-time

```bash
pilot-ai start -f
# or
pilot-ai logs -f
```

## Usage Examples

Just message your agent in Slack or Telegram:

| Command | What happens |
|---------|-------------|
| `What projects are in ~/Github?` | Lists directories, shows project names |
| `Show me recent releases for fridgify` | Finds the repo, runs `gh release list` |
| `Create today's meeting notes in Notion` | Creates a new Notion page with meeting notes |
| `Open browser and show top 5 from Hacker News` | Opens Playwright, scrapes HN, reports results |
| `Every day at 9am, notify me of GitHub PR reviews` | Creates a scheduled cron job |
| `Check my Google Calendar for today's schedule` | Reads Google Calendar events and summarizes |
| `Send a draft email to john@example.com` | Composes a Gmail draft with the given content |
| `List files in my Google Drive "Projects" folder` | Browses Google Drive and lists folder contents |
| `Show me the latest Figma designs for the homepage` | Fetches Figma file data and component details |
| `Run QA tests for arden-web` | Executes Playwright E2E tests via Sentinel AI and reports results |

### Coding Sessions

The agent can write, build, test, and iterate on code — just like Claude Code. Messages in the same thread maintain full conversation context:

```
You:    "Add a /health endpoint to the API server in fridgify"
Agent:  ✏️ Editing file... ⚡ Running: npm run build... ✅ Done!
        Added GET /health endpoint returning { status: "ok", uptime: ... }
        Build passes, tests pass.

You:    "Also add a test for it"             ← same thread, agent remembers context
Agent:  ✏️ Writing test... ⚡ Running: npm test...
        Added test in tests/api/health.test.ts — 3 assertions, all pass.

You:    "Commit and push"
Agent:  📂 Checking git... ⚡ Running: git commit...
        Committed: "feat: add /health endpoint" and pushed to origin/main.
```

Each Slack/Telegram thread maps to a persistent Claude session. The agent retains full context across messages — no need to repeat yourself.

### Project Development

For larger features or new projects, the agent follows a structured development workflow — planning first, then implementing step by step:

```
You:    "Add OAuth2 login to the fridgify API"
Agent:  📋 Let me plan this out first.

        **PRD (Product Requirements)**
        - Add OAuth2 authorization code flow with Google provider
        - Endpoints: /auth/login, /auth/callback, /auth/me
        - Store tokens in DB, issue JWT sessions
        - ...

        **Checklist**
        - [ ] Add google-auth config schema
        - [ ] Implement /auth/login redirect endpoint
        - [ ] Implement /auth/callback token exchange
        - [ ] Add JWT session middleware
        - [ ] Add /auth/me endpoint
        - [ ] Write tests for each endpoint

        Does this look good?

You:    "Looks good, go ahead"
Agent:  ⚡ Starting checklist item 1: google-auth config schema
        ✏️ Writing src/config/auth.ts...
        🔨 npm run build — ✅ passed
        🧪 npm test — ✅ 3 new tests pass
        ✅ Committed: "feat: add google-auth config schema"

        ⚡ Item 2: /auth/login redirect endpoint
        ✏️ Writing src/routes/auth.ts...
        🔨 npm run build — ✅ passed
        🧪 npm test — ✅ 5 new tests pass
        ✅ Committed: "feat: add /auth/login redirect endpoint"

        ... (continues through checklist)

        ✅ All 6 checklist items complete. OAuth2 login is ready.

You:    "Actually, also support GitHub login"      ← requirements change
Agent:  📋 Updating PRD and checklist first...
        Added 3 new checklist items for GitHub provider.
        Proceeding with implementation...
```

The agent writes a PRD and checklist before touching any code, gets your confirmation, then works through each item with build/test verification — just like a real development workflow.

## CLI Reference

```bash
# Core
pilot-ai init                   # Interactive setup wizard
pilot-ai start [-f]             # Start agent daemon (-f to follow logs)
pilot-ai stop                   # Stop agent daemon
pilot-ai status                 # Check if agent is running
pilot-ai logs [-f]              # View agent logs
pilot-ai doctor                 # 3-layer MCP consistency diagnosis (config ↔ mcp-config ↔ Keychain ↔ Claude Code)

# User management
pilot-ai adduser <platform> <userId>     # Authorize a user
pilot-ai removeuser <platform> <userId>  # Remove a user
pilot-ai listusers                       # List authorized users

# Tool / MCP management
pilot-ai tools                  # List all available tools with active/inactive status
pilot-ai addtool <name>         # Add and configure a tool (e.g. notion, figma, gmail)
pilot-ai removetool <name>      # Remove a tool
pilot-ai sync-mcp               # Sync MCP servers to Claude Code native settings

# Authentication
pilot-ai auth google [--services gmail,calendar,drive]  # Google OAuth login
pilot-ai auth google --revoke                           # Revoke Google tokens
pilot-ai auth figma                                     # Figma authentication guide

# Project management
pilot-ai project add <name> <path>       # Register a project
pilot-ai project list                    # List projects
pilot-ai project remove <name>           # Remove a project
```

## Slack App Setup

1. Create a new app at [api.slack.com/apps](https://api.slack.com/apps)
2. **Socket Mode** — Enable
3. **Event Subscriptions** — Subscribe to: `message.im`, `app_mention`
4. **OAuth Scopes** — `chat:write`, `reactions:write`, `im:history`, `im:read`, `im:write`, `app_mentions:read`, `channels:history`
5. **App Home** — Turn on Messages Tab
6. Install to workspace, then use tokens in `pilot-ai init`

## Telegram Bot Setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Copy the bot token
3. Use it in `pilot-ai init`

## Google Integration Setup

Pilot-AI supports **Gmail**, **Google Calendar**, and **Google Drive** via Google OAuth2.

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services** > **Library**

### 2. Enable APIs

Enable the following APIs for your project:

- **Gmail API** — for reading/sending emails
- **Google Calendar API** — for viewing/creating calendar events
- **Google Drive API** — for browsing/reading/creating files

### 3. Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. If prompted, configure the **OAuth consent screen**:
   - User Type: **External** (or Internal for Workspace)
   - Add your email as a test user
4. Application type: **Desktop app**
5. Copy the **Client ID** and **Client Secret**

### 4. Configure in Pilot-AI

Run `pilot-ai init` and select **Yes** when asked about Google integration. Enter your Client ID and Client Secret, and choose which services to enable.

Alternatively, use the CLI:
```bash
pilot-ai auth google --services gmail,calendar,drive
```

### 5. Authorize on First Use

When you first ask the agent to access Gmail, Calendar, or Drive, it will:
1. Open a local OAuth loopback server and launch your browser
2. You grant permissions in the browser
3. The agent stores the tokens securely in macOS Keychain and proceeds with the task

After initial authorization, tokens refresh automatically — the token health checker monitors validity and refreshes as needed.

### Supported Commands

| Service | Example commands |
|---------|-----------------|
| **Gmail** | `Check my recent emails`, `Send a draft to john@example.com`, `Search emails about "invoice"` |
| **Google Calendar** | `What's on my calendar today?`, `Schedule a meeting tomorrow at 2pm`, `Find free time this week` |
| **Google Drive** | `List files in my Drive`, `Search for "budget" in Drive`, `Read the contents of "Meeting Notes"` |

## MCP Server Management

Pilot-AI includes a built-in registry of 18+ MCP (Model Context Protocol) servers. Instead of manually configuring each integration, the agent **automatically detects** when a task needs an MCP server and proposes installation.

### How it works

1. You ask the agent to do something (e.g., "Check my Sentry errors")
2. The agent detects that the Sentry MCP server would help
3. It sends you an approval message via Slack/Telegram:
   > **MCP Server: Sentry** — View and manage Sentry error tracking issues
   > Package: `@sentry/mcp-server`
   > Required: SENTRY_AUTH_TOKEN
4. You approve and provide the required credentials
5. The server is installed, credentials stored in Keychain, and immediately available

### Built-in Registry

| Category | Servers |
|----------|---------|
| **Design** | Figma |
| **Development** | GitHub, Sentry, Puppeteer, Filesystem, Jira |
| **Productivity** | Notion, Google Drive, Google Calendar, Memory, Brave Search, Confluence, Wiki (MediaWiki) |
| **Communication** | Slack, Gmail |
| **Data** | PostgreSQL, SQLite |
| **QA / Testing** | Sentinel AI (Playwright/Maestro E2E) |

### CLI Management

```bash
pilot-ai tools                  # List all tools with status
pilot-ai addtool notion         # Install and configure Notion MCP
pilot-ai removetool notion      # Remove Notion MCP
pilot-ai sync-mcp               # Sync to Claude Code native settings
```

You can also manage MCP servers conversationally: `Install the GitHub MCP server`, `Remove the Slack MCP server`, or `List MCP servers`.

## Architecture

```
src/
├── index.ts                    # CLI entry point (commander.js)
├── cli/                        # CLI subcommands
│   ├── init.ts                 #   Interactive setup wizard
│   ├── start.ts / stop.ts      #   Daemon lifecycle
│   ├── status.ts / logs.ts     #   Monitoring
│   ├── doctor.ts               #   System diagnostics
│   ├── tools.ts                #   MCP tool management (addtool/removetool/sync-mcp)
│   ├── auth.ts                 #   OAuth authentication (google/figma)
│   ├── user.ts                 #   User allowlist management
│   ├── project.ts              #   Project registry
│   └── connection-test.ts      #   Connection verification
├── agent/
│   ├── core.ts                 # Main agent loop: message → auth → Claude → response
│   ├── claude.ts               # Claude Code CLI subprocess with streaming JSONL parsing
│   ├── session.ts              # Thread-to-session mapping
│   ├── conversation-summary.ts # Conversation summary buffer for thread continuity
│   ├── heartbeat.ts            # Cron scheduler + approval flow
│   ├── skills.ts               # Teachable skill engine
│   ├── memory.ts               # Per-project memory context
│   ├── safety.ts               # Dangerous action approval manager
│   ├── planner.ts              # PRD/checklist-driven development workflow
│   ├── mcp-manager.ts          # MCP server lifecycle management
│   ├── mcp-launcher.ts         # Keychain-backed MCP launcher scripts
│   ├── token-refresher.ts      # OAuth token health monitoring and auto-refresh
│   ├── project.ts              # Project resolution and analysis
│   ├── project-analyzer.ts     # Project structure analysis
│   ├── queue.ts                # Message queue
│   ├── pipeline.ts             # Message processing pipeline
│   ├── multi-agent.ts          # Multi-agent coordination
│   ├── worktree.ts             # Git worktree management
│   └── tool-descriptions.ts    # Tool description registry
├── messenger/
│   ├── adapter.ts              # MessengerAdapter interface
│   ├── factory.ts              # Messenger factory
│   ├── slack.ts                # Slack Bolt SDK (Socket Mode)
│   ├── telegram.ts             # Telegraf (Long Polling)
│   └── split.ts                # Long message splitting
├── tools/                      # Tool wrappers and MCP integrations
│   ├── mcp-registry.ts         #   Built-in MCP server registry (18+ servers)
│   ├── google-auth.ts          #   Shared Google OAuth module
│   ├── browser.ts              #   Playwright browser automation
│   ├── filesystem.ts           #   File read/write/search
│   ├── shell.ts                #   Shell command execution
│   ├── github.ts               #   GitHub CLI integration
│   ├── notion.ts               #   Notion API
│   ├── figma.ts / figma-mcp.ts #   Figma integration
│   ├── email.ts                #   Gmail
│   ├── google-calendar.ts      #   Google Calendar
│   ├── google-drive.ts         #   Google Drive
│   ├── linear.ts               #   Linear
│   └── ...                     #   clipboard, image, notification, obsidian, voice, vscode
├── security/
│   ├── auth.ts                 # User allowlist check
│   ├── permissions.ts          # macOS TCC permission management
│   ├── audit.ts                # Audit logging
│   ├── prompt-guard.ts         # Prompt injection detection
│   └── sandbox.ts              # Filesystem sandbox
└── config/
    ├── schema.ts               # Config schema (zod)
    ├── store.ts                # ~/.pilot/ config + credentials store
    ├── keychain.ts             # macOS Keychain integration
    ├── claude-code-sync.ts     # Sync MCP config to ~/.claude.json
    └── claude-code-sync.test.ts
```

## How It Stays Secure

- **User allowlist** — only authorized Slack/Telegram user IDs can interact
- **Approval flow** — dangerous actions (file deletion, shell commands, etc.) prompt for confirmation via messenger buttons
- **macOS Keychain** — all tokens, API keys, and MCP secrets are stored encrypted in Keychain
- **Keychain-backed launchers** — MCP servers receive secrets via launcher scripts that read from Keychain at runtime, never from disk
- **Filesystem sandbox** — configurable allowed/blocked paths
- **Audit log** — every command and result is logged to `~/.pilot/logs/audit.jsonl`
- **Prompt injection guard** — detection for prompt injection attempts
- **Token health monitoring** — OAuth tokens are automatically validated and refreshed

## Configuration

All config lives in `~/.pilot/`:

```
~/.pilot/
├── config.json       # Main configuration
├── credentials/      # Service API keys (chmod 700)
├── mcp-config.json   # MCP server configuration
├── mcp-launchers/    # Keychain-backed MCP launcher scripts
├── memory/           # Agent memory per project
├── skills/           # Registered skills
└── logs/             # Agent and audit logs
```

## Development

```bash
git clone https://github.com/ahn283/pilot-ai.git
cd pilot-ai
npm install
npm run build      # Compile TypeScript
npm run dev        # Watch mode
npm test           # Run tests (vitest)
npm run lint       # ESLint
npm run format     # Prettier
```

## License

[MIT](LICENSE)
