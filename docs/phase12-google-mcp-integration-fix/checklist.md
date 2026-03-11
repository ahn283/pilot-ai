# Phase 12: Google MCP 서버 통합 연동 실패 근본 해결 — Checklist

## P0: Gmail MCP 즉시 작동

- [x] **Gmail MCP `~/.gmail-mcp/` 파일 생성**
  - `src/tools/google-auth.ts` — `writeGmailMcpCredentials()` 유틸 함수 추가
  - `src/cli/init.ts` — Gmail 선택 시 `~/.gmail-mcp/gcp-oauth.keys.json` + `credentials.json` 생성
  - `src/cli/tools.ts` — `addtool gmail` 시에도 동일 적용
  - 기존 환경변수 전달도 유지 (dual support)

- [x] **MCP 서버 등록 후 시작 검증 (헬스체크)**
  - `src/agent/mcp-manager.ts` — `verifyMcpServerStartup()` 함수 추가
  - `installMcpServer()` 후 서버 프로세스 시작 가능 여부 검증
  - 실패 시 경고 메시지 출력

- [x] **Testing 모드 refresh_token 7일 만료 경고**
  - `src/cli/init.ts` — OAuth 완료 후 Testing 모드 경고 메시지 출력
  - `src/cli/auth.ts` — 동일 적용
  - `src/tools/google-auth.ts` — invalid_grant 발생 시 Testing 모드 안내 포함

## P1: 토큰 동기화 및 안정성

- [x] **`pilot-ai auth google` 시 MCP 토큰 동기화**
  - `src/cli/auth.ts` — `syncGmailMcpTokens()` 함수 추가
  - 재인증 후 `~/.gmail-mcp/credentials.json` 업데이트
  - 재인증 후 `mcp-config.json` REFRESH_TOKEN 업데이트
  - Claude Code에 재등록 (`syncToClaudeCode`)

- [x] **Gmail MCP 패키지 대안 평가**
  - `@gongrzhe/server-gmail-autoauth-mcp` 비교 완료: MCP SDK ^0.4.0 (구버전), GitHub 404, 18개 도구만 제공
  - `@shinzolabs/gmail-mcp` 유지 결정: MCP SDK 1.16.0, 50+ 도구, 활발한 유지보수

- [x] **Slack MCP SLACK_TEAM_ID 수정**
  - `src/cli/init.ts` — Slack 전용 case 추가, Team ID(T...) 별도 입력 + validation
  - `src/cli/tools.ts` — `addtool slack` 시에도 동일 적용

- [x] **Google MCP 통합 토큰 관리**
  - `src/agent/token-refresher.ts` — 주기적 토큰 유효성 검사 모듈 신규 작성
  - `src/agent/core.ts` — start 시 토큰 헬스체크 스케줄링 (1시간 간격)

## P2: 보안 및 운영

- [ ] **`~/.claude.json` 시크릿 평문 노출 방지**
  - MCP 서버 env에 직접 시크릿 대신 파일 참조 또는 wrapper script
  - Keychain 연동 MCP launcher 검토

- [x] **`pilot-ai start` 주기적 토큰 헬스체크**
  - 1시간마다 Google OAuth 토큰 유효성 확인
  - 만료 임박 시 자동 갱신 + Slack/Telegram 알림

## 검증

- [x] `npm run build` 성공
- [x] 기존 테스트 통과 (80 files, 680 tests)
- [ ] Gmail MCP 도구 Claude Code에서 사용 가능 확인
- [ ] `pilot-ai auth google` 후 MCP 토큰 자동 갱신 확인
- [ ] Google Calendar, Drive MCP 영향 없음 확인
