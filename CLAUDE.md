# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pilot-ai is a personal AI agent for macOS that receives commands via Slack or Telegram and autonomously controls browser, Notion, VSCode, filesystem, and shell. It runs as a local daemon via launchd and uses Claude Code CLI (`claude -p`) as its LLM backend. Published as an npm package (`npx pilot-ai`).

## Commands

- `npm run build` - Compile TypeScript (`tsc`)
- `npm run dev` - Watch mode compilation
- `npm run lint` - ESLint (`eslint src/`)
- `npm run format` - Prettier (`prettier --write 'src/**/*.ts'`)
- `npm test` - Run tests with vitest
- `node dist/index.js <command>` - Run CLI locally after build

## Architecture

See `docs/PRD.md` for full specification and `docs/checklist.md` for implementation progress.

**Planned structure** (being built incrementally):

- `src/index.ts` - CLI entry point (commander.js). Bin name: `pilot-ai`.
- `src/cli/` - CLI subcommands (init, start, stop, status, logs, project)
- `src/agent/` - Core agent logic (message loop, Claude CLI integration, task queue, project registry, memory, safety)
- `src/messenger/` - MessengerAdapter interface + Slack/Telegram implementations
- `src/tools/` - Tool wrappers (filesystem, shell, browser, notion, vscode)
- `src/security/` - Auth, sandbox, prompt injection guard, audit logging
- `src/config/` - Config store (~/.pilot/), keychain integration, schema

**Key data flow:** Messenger message -> Auth check -> Claude CLI subprocess (`claude -p --cwd <project>`) -> Tool execution -> Safety check (dangerous actions need approval) -> Response via messenger

**Runtime data directory:** `~/.pilot/` (config, memory, logs, projects registry)

## Development Workflow (MANDATORY)

Every feature/fix MUST follow this exact sequence. Never skip or reorder steps:

1. **개발** - 코드 작성
2. **빌드** - `npm run build` 통과 확인
3. **단위 테스트** - `npm test` 작성 및 통과 확인
4. **체크리스트 업데이트** - `docs/checklist.md`에서 완료 항목 체크 (`- [x]`)
5. **커밋** - 위 4단계가 모두 완료된 후에만 커밋

빌드 실패, 테스트 미작성/실패, 체크리스트 미반영 상태에서 절대 커밋하지 않는다.

## Conventions

- ESM modules (`"type": "module"` in package.json)
- TypeScript with strict mode, target ES2022, module Node16
- ESLint flat config (`eslint.config.js`)
- Korean language for user-facing docs and commit messages
- Phased development: Phase 1 (MVP) -> Phase 2 -> Phase 3. Check `docs/checklist.md` for current phase.
