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
- `src/tools/` - Tool wrappers (filesystem, shell, browser, notion, github, clipboard, obsidian, linear, notification, image)
- `src/api/` - Local HTTP webhook server (node:http, Bearer auth, rate limiting)
- `src/security/` - Auth, sandbox, prompt injection guard, audit logging
- `src/config/` - Config store (~/.pilot/), keychain integration, schema

**Key data flow:** Messenger message -> Auth check -> Claude CLI subprocess (`claude -p --cwd <project>`) -> Tool execution -> Safety check (dangerous actions need approval) -> Response via messenger

**Runtime data directory:** `~/.pilot/` (config, memory, logs, projects registry)

## Development Workflow (MANDATORY)

Every project/feature MUST follow this two-phase process. Never skip or reorder steps.

### Phase A: Planning (before writing any code)

1. **요구사항 파악** — 사용자의 요청을 명확히 이해. 모호하면 질문.
2. **PRD 업데이트** — `docs/PRD.md`에 해당 섹션 작성/수정. 한국어.
3. **체크리스트 작성** — `docs/checklist.md`에 `- [ ]` 항목 추가. 작고 테스트 가능한 단위로 분해. 한국어.
4. **사용자 확인** — PRD와 체크리스트를 사용자에게 제시하고 승인받은 후 구현 시작.

### Phase B: Implementation (체크리스트 항목별 반복)

각 체크리스트 항목마다 아래 사이클을 실행:

1. **구현** — 하나의 체크리스트 항목에 대한 코드 작성.
2. **빌드** — `npm run build` 통과 확인.
3. **단위 테스트** — `npm test` 작성 및 통과 확인.
4. **체크리스트 업데이트** — `docs/checklist.md`에서 완료 항목 체크 (`- [x]`).
5. **커밋** — 위 1-4 모두 통과 후에만 커밋.

그 다음 체크리스트의 다음 항목으로 이동하여 반복.

### Rules

- PRD와 체크리스트 없이 코딩 시작 절대 금지.
- 빌드 실패, 테스트 미작성/실패, 체크리스트 미반영 상태에서 절대 커밋하지 않는다.
- 커밋은 체크리스트 항목 단위로 atomic하게.
- 구현 중 요구사항 변경 시, Phase A로 돌아가 PRD/체크리스트 먼저 수정.

## Conventions

- ESM modules (`"type": "module"` in package.json)
- TypeScript with strict mode, target ES2022, module Node16
- ESLint flat config (`eslint.config.js`)
- Commit messages in English
- System comments and user-facing messages in English
- Docs (PRD, checklist) in Korean
- Natural language parsing should be delegated to LLM, not regex rules — expose functions as tools
- Phased development: Phase 1 (MVP) ✅ -> Phase 2 (in progress) -> Phase 3. Check `docs/checklist.md` for current phase.
