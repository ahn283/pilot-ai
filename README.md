<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/logo_dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="design/logo_light.svg" />
    <img src="design/logo_light.svg" alt="Pilot-AI Logo" width="360" />
  </picture>
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

Pilot-AI is a local AI agent that lives on your Mac. Send it natural-language commands from **Slack** or **Telegram**, and it autonomously controls your browser, files, shell, GitHub, Notion, and more — powered by [Claude Code](https://code.claude.com/) CLI.

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
              (API)         (CLI)         (API)
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
- **Notion integration** — search, create, update pages and databases
- **Scheduled tasks** — cron-like jobs with natural language scheduling
- **Skills system** — teach the agent reusable procedures
- **Project awareness** — resolves projects, remembers context per project
- **Live status updates** — see what the agent is doing in real-time (🔍 Searching code... ⚡ Running command...)
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
3. **Integrations** — optionally connect Notion, Obsidian, Figma, Linear
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
| `~/Github에 어떤 프로젝트가 있어?` | Lists directories, shows project names |
| `fridgify 최근 배포 내역 알려줘` | Finds the repo, runs `gh release list` |
| `Notion에 오늘 회의록 작성해줘` | Creates a new Notion page with meeting notes |
| `브라우저 열어서 Hacker News 탑 5 보여줘` | Opens Playwright, scrapes HN, reports results |
| `매일 오전 9시에 GitHub PR 리뷰 알려줘` | Creates a scheduled cron job |
| `Google Play 심사 상태 확인해줘` | Checks for API key, asks if missing, then queries |

## CLI Reference

```bash
pilot-ai init          # Interactive setup wizard
pilot-ai start [-f]    # Start agent daemon (-f to follow logs)
pilot-ai stop          # Stop agent daemon
pilot-ai status        # Check if agent is running
pilot-ai logs [-f]     # View agent logs
pilot-ai adduser <platform> <userId>     # Authorize a user
pilot-ai removeuser <platform> <userId>  # Remove a user
pilot-ai listusers     # List authorized users
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

## Architecture

```
src/
├── index.ts              # CLI entry point (commander.js)
├── cli/                  # CLI subcommands (init, start, stop, status, logs, project, user)
├── agent/
│   ├── core.ts           # Main agent loop: message → auth → Claude → response
│   ├── claude.ts         # Claude Code CLI subprocess with streaming JSONL parsing
│   ├── heartbeat.ts      # Cron scheduler + approval flow
│   ├── skills.ts         # Teachable skill engine
│   ├── memory.ts         # Per-project memory context
│   └── safety.ts         # Dangerous action approval manager
├── messenger/
│   ├── adapter.ts        # MessengerAdapter interface
│   ├── slack.ts          # Slack Bolt SDK (Socket Mode)
│   └── telegram.ts       # Telegraf (Long Polling)
├── tools/                # Tool wrappers (browser, notion, github, filesystem, shell, etc.)
├── security/
│   ├── auth.ts           # User allowlist check
│   ├── permissions.ts    # macOS TCC permission management + auto-approver
│   ├── audit.ts          # Audit logging
│   └── sandbox.ts        # Filesystem sandbox
└── config/
    ├── schema.ts         # Config schema (zod)
    ├── store.ts          # ~/.pilot/ config + credentials store
    └── keychain.ts       # macOS Keychain integration
```

## How It Stays Secure

- **User allowlist** — only authorized Slack/Telegram user IDs can interact
- **Approval flow** — dangerous actions (file deletion, shell commands, etc.) prompt for confirmation via messenger buttons
- **macOS Keychain** — all tokens and API keys are stored encrypted
- **Filesystem sandbox** — configurable allowed/blocked paths
- **Audit log** — every command and result is logged to `~/.pilot/logs/audit.jsonl`
- **Prompt injection guard** — basic detection for prompt injection attempts

## Configuration

All config lives in `~/.pilot/`:

```
~/.pilot/
├── config.json       # Main configuration
├── credentials/      # Service API keys (chmod 700)
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
