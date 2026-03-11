# Phase 13: Conversation Overflow 근본 해결 + Gmail MCP 안정화 — Checklist

## P0: Gmail MCP 포트 충돌 해결

- [x] **Gmail MCP `PORT=3456` 환경변수 추가**
  - `~/.claude.json` — Gmail MCP env에 `PORT: "3456"` 추가 (수동 수정 완료)
  - `~/.pilot/mcp-config.json` — 동일 적용 (수동 수정 완료)
  - `~/.gmail-mcp/gcp-oauth.keys.json` + `credentials.json` 생성 (수동 생성 완료)
  - `src/tools/mcp-registry.ts` — Gmail envVars에 `PORT` 추가
  - `src/cli/init.ts` — Gmail 등록 시 `PORT: '3456'` 전달
  - `src/cli/tools.ts` — `addtool gmail` 시에도 동일 적용
  - `src/agent/mcp-launcher.ts` — `PORT`를 non-secret으로 분류

## P0: Context Overflow 즉시 방지

- [x] **`--max-turns` 플래그 도입**
  - `src/agent/claude.ts` — `ClaudeCliOptions`에 `maxTurns?: number` 추가
  - `src/agent/claude.ts` — `invokeClaudeCliInner()`에서 `--max-turns` 인자 전달
  - `src/agent/core.ts` — `invokeClaudeCli()` 호출 시 `maxTurns: 25` 전달 (본 호출 + fallback 모두)

- [x] **`MAX_SESSION_TURNS` 20 → 10 감소**
  - `src/agent/session.ts` — `MAX_SESSION_TURNS = 10`으로 변경

- [x] **시스템 프롬프트 경량화 (~60% 축소)**
  - `src/agent/core.ts` — 9개 규칙 → 7개 핵심 규칙 압축
  - 크레덴셜 관리 지침 간소화
  - PROJECT WORKFLOW 규칙 제거 (CLAUDE.md에 존재)
  - Memory context 최대 2000자, Skills/Tools context 최대 1000자 제한

## P1: Fallback 품질 + 프로액티브 관리

- [x] **Conversation Summary 강화**
  - `src/agent/conversation-summary.ts` — `MAX_ACTION_LEN` 300 → 800
  - `src/agent/conversation-summary.ts` — `MAX_TURNS` 10 → 15
  - `extractActionSummary()` 개선: 첫 문단 + 에러/성공/경고 라인 + 커밋 메시지 추출
  - `extractKeyDecisions()` 개선: commit 외 "Created/Fixed/Updated/..." 패턴 추가
  - 테스트: 새 추출 로직 단위 테스트 업데이트

- [x] **프로액티브 세션 경고 (잔여 턴 ≤ 3)**
  - `src/agent/session.ts` — `getRemainingTurns()` export 함수 추가
  - `src/agent/core.ts` — 잔여 턴 ≤ 3일 때 "Be concise" 시스템 프롬프트 주입

- [x] **msg_too_long 시 summary 없어도 graceful fallback**
  - `src/agent/core.ts` — `conversationSummaryText`가 null이어도 새 세션으로 재시도

## P2: Gmail MCP 추가 안정화

- [x] **Gmail MCP 경로 환경변수 추가**
  - `src/cli/init.ts` — `GMAIL_OAUTH_PATH`, `GMAIL_CREDENTIALS_PATH` 환경변수 전달
  - `src/cli/tools.ts` — `addtool gmail` 시에도 동일 적용
  - `src/tools/mcp-registry.ts` — Gmail envVars에 경로 변수 추가

- [x] **Google OAuth "Production" 전환 안내 강화**
  - `src/cli/init.ts` — OAuth 완료 후 "PUBLISH APP" 안내 + Cloud Console URL 포함
  - `src/cli/auth.ts` — 동일 적용

## 검증

- [x] `npm run build` 성공
- [x] `npm test` 통과 (699/700, 실패 1건은 Keychain 환경 이슈)
- [ ] Gmail MCP 도구 Claude Code에서 사용 가능 확인 (Claude Code 재시작 필요)
- [ ] 10턴 이상 대화에서 자동 세션 리셋 + summary 주입 확인
- [ ] msg_too_long 발생 시 graceful recovery 확인
