# Phase 15: MCP 통합 아키텍처 개선 — Checklist

## Phase A: 즉시 해결 — Google OAuth 팝업 차단

- [x] **A1. `start()`에서 TokenRefresher 조건부 시작**
  - `src/agent/core.ts` — `hasRegisteredGoogleServers()` 헬퍼 함수 추가
  - `start()` 내 TokenRefresher 시작 조건: `loadGoogleTokens()` 존재 AND `mcp-config.json`에 Google MCP 등록됨
  - 4가지 상태별 로그 메시지: tokens+mcp(시작), no-tokens+mcp(경고), tokens+no-mcp(스킵), no-both(스킵)
  - 빌드 확인 (`npm run build`)
  - 테스트 작성: 토큰 없을 때 TokenRefresher 시작 안 되는지

- [x] **A2. `syncRefreshedTokensToMcp()` 토큰 guard 강화**
  - `src/agent/token-refresher.ts` — `syncRefreshedTokensToMcp()` 시작부에 guard 추가
  - `tokens.accessToken` 또는 `tokens.refreshToken` 없으면 즉시 return
  - HTTP sync (`syncHttpToClaudeCode`) 호출 제거 (stdio만 허용)
  - 빌드 확인
  - 테스트 작성: incomplete token set일 때 sync 스킵되는지

- [x] **A3. `runHealthCheck()`에서 not_configured/expired 시 자동 중지**
  - `src/agent/token-refresher.ts` — `not_configured` case에 `stopTokenRefresher()` 추가
  - `expired` case에도 `stopTokenRefresher()` 추가 (반복 시도 방지)
  - 빌드 확인
  - 테스트 작성: not_configured 상태에서 refresher 중지되는지

## Phase B: Startup Side-Effect 제거

- [x] **B1. `syncHttpToClaudeCode()` interactive 모드 분리**
  - `src/config/claude-code-sync.ts` — `options: { interactive?: boolean }` 파라미터 추가
  - `interactive=true`: `stdio: 'inherit'` (CLI 모드: init, addtool)
  - `interactive=false` (기본값): `stdio: 'pipe'` (daemon, migration, refresher)
  - `src/cli/init.ts` — HTTP sync 호출 시 `{ interactive: true }` 전달
  - `src/cli/tools.ts` — HTTP sync 호출 시 `{ interactive: true }` 전달
  - 빌드 확인
  - 테스트 작성: interactive=false일 때 stdio가 'pipe'로 설정되는지

- [x] **B2. `migrateToSecureLaunchers()` 등록 서버만 대상**
  - `src/agent/mcp-manager.ts` — `mcp-config.json`에 등록된 서버 ID만 migration 대상으로 필터링
  - config.json에만 있고 mcp-config.json에 없는 서버는 스킵
  - 빌드 확인
  - 테스트 작성: 미등록 서버가 migration에서 제외되는지

- [x] **B3. GitHub auth check도 mcp-config.json 기반 전환**
  - `src/agent/core.ts` — GitHub hourly check 시작 조건에 `mcp-config.json` 등록 여부 추가
  - 등록 안 되어 있으면 로그만 남기고 스킵
  - 빌드 확인

## Phase C: 통합 Health Check + 진단

- [x] **C1. startup 시 전체 MCP credential 검증**
  - `src/agent/mcp-manager.ts` — `checkAllMcpServerStatus()` 함수 추가
  - `McpServerStatus` 타입 정의: `'ready' | 'connecting' | 'auth_required' | 'not_registered' | 'error'`
  - 각 서버별 Keychain credential 존재 확인 (`getSecretKeysForServer()` 헬퍼)
  - launcher script 기반 서버: 관련 Keychain 항목 전부 존재해야 'ready'
  - 직접 env var 서버: 'ready' (legacy)
  - 빌드 확인
  - 테스트 작성: credential 누락 시 'auth_required' 반환되는지

- [x] **C2. startup MCP 상태 요약 로그 + actionable 에러**
  - `src/agent/core.ts` — `start()` 끝에 `checkAllMcpServerStatus()` 호출
  - 상태 요약 로그: `"MCP servers: gmail(ready), notion(auth_required), ..."`
  - `auth_required` 서버가 있으면 `"Run 'pilot-ai addtool <name>' to re-authenticate"` 안내
  - 빌드 확인

- [ ] **C3. `pilot-ai doctor` 명령**
  - `src/cli/doctor.ts` — 신규 파일 생성
  - 3-layer 일관성 진단:
    - config.json에 설정된 통합 목록
    - mcp-config.json에 등록된 MCP 서버 목록
    - Keychain에 저장된 credential 존재 여부
    - Google tokens 만료 여부
    - Claude Code sync 상태 (`claude mcp get <id>` 확인)
  - 레이어 간 불일치 시 Recommendation 출력
  - `src/index.ts` — `doctor` 커맨드 등록
  - 빌드 확인
  - 테스트 작성: 불일치 감지 시 올바른 recommendation 출력하는지

- [x] **C4. 서버 상태에 `connecting` 추가**
  - `src/agent/mcp-manager.ts` — `McpServerStatus`에 `'connecting'` 추가 (C1에서 함께 작업)
  - MCP 서버 프로세스 시작 중 상태 표현
  - 빌드 확인

## Phase D: Credential 보안

- [ ] **D1. legacy 평문 sync 정리**
  - `src/agent/mcp-manager.ts` — `cleanupLegacyPlaintextSync()` 함수 추가
  - `migrateToSecureLaunchers()` 실행 후, launcher로 전환된 서버를 Claude Code에 재등록
  - 기존 `~/.claude.json`의 평문 env var 엔트리를 launcher 버전으로 덮어쓰기
  - 빌드 확인
  - 테스트 작성: migration 후 Claude Code sync가 launcher 경로만 포함하는지

- [ ] **D2. Atlassian credential 설정 시 검증**
  - `src/cli/tools.ts` — `addtool jira`/`addtool confluence` 시 API 호출로 credential 유효성 검증
  - Atlassian REST API `/rest/api/3/myself` (Jira) 또는 `/wiki/rest/api/user/current` (Confluence) 호출
  - 실패 시 에러 메시지 + 재입력 안내
  - 빌드 확인
  - 테스트 작성: 잘못된 credential일 때 설치 중단되는지

- [ ] **D3. Slack SLACK_TEAM_ID 매핑 수정**
  - `src/cli/init.ts` — Slack 설정 시 `auth.test` API로 Team ID 자동 조회
  - `src/cli/tools.ts` — `addtool slack`에도 동일 적용
  - fallback: 수동 입력 시 `T`로 시작하는지 검증
  - 빌드 확인
  - 테스트 작성: Bot Token으로부터 Team ID 자동 추출되는지

- [ ] **D4. launcher script PATH 하드코딩 + 절대경로 npx**
  - `src/agent/mcp-launcher.ts` — 생성되는 script에 `export PATH="/usr/local/bin:/usr/bin:/bin"` 추가
  - `exec npx` → `exec /usr/local/bin/npx` (또는 `which npx` 결과 사용)
  - 기존 launcher script가 있는 경우 `migrateToSecureLaunchers()` 시 재생성
  - 빌드 확인
  - 테스트 작성: 생성된 script에 절대경로 포함되는지

## Phase E: Multi-Device

- [ ] **E1. config.json sync side-effect 전면 차단**
  - A1에서 Google 해결, B3에서 GitHub 해결 확인
  - 나머지 통합(Notion, Figma, Linear 등)이 config.json만으로 startup side-effect 유발하지 않는지 코드 리뷰
  - config 필드 존재만으로 외부 API 호출/프로세스 시작하는 코드가 있으면 guard 추가
  - 빌드 확인

## 검증

- [ ] `npm run build` 성공
- [ ] 기존 테스트 통과
- [ ] **시나리오 1**: Google 미등록 기기에서 `pilot-ai start` → OAuth 팝업 없음 확인
- [ ] **시나리오 2**: Google 등록 기기에서 토큰 만료 → 알림 전송, OAuth 팝업 없음 확인
- [ ] **시나리오 3**: 정상 기기에서 TokenRefresher 정상 동작 확인
- [ ] **시나리오 4**: `pilot-ai addtool gmail` → interactive OAuth 정상 표시 확인
- [ ] **시나리오 5**: Notion Keychain 삭제 → startup 시 `auth_required` 상태, 에러 없음 확인
- [ ] **시나리오 7**: config.json만 동기화된 새 기기 → 어떤 인증 시도도 없이 정상 시작 확인
- [ ] **시나리오 6**: `pilot-ai doctor` → 3-layer 일관성 진단 정상 출력 확인
