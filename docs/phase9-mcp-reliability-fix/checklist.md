# Phase 9: MCP 서버 신뢰성 개선 — 체크리스트

## P0: Figma PAT 전환

- [x] `mcp-registry.ts`: Figma HTTP OAuth → stdio PAT (`figma-developer-mcp`, `FIGMA_API_KEY`)
- [x] `init.ts`: Figma PAT 수집 (figd_ 검증) + API 유효성 검증 + Keychain 저장
- [x] `init.ts`: Figma OAuth 안내 박스 제거
- [x] `auth.ts`: `runAuthFigma()` OAuth → PAT 가이드 변경
- [x] `tools.ts` runSyncMcp: `__http__` figma → stdio 마이그레이션 로직
- [x] `tools.ts` runAddTool: Figma PAT 수집 로직 추가
- [x] 빌드 + 테스트

## P0: Gmail MCP 서버 추가

- [x] `mcp-registry.ts`: Gmail 추가 (`@shinzolabs/gmail-mcp`, env var 토큰)
- [x] `init.ts`: Google OAuth 후 `CLIENT_ID`/`CLIENT_SECRET`/`REFRESH_TOKEN` env var로 Gmail MCP 등록
- [x] `tools.ts`: Gmail addtool 플로우 추가
- [x] 빌드 + 테스트

## P0: Calendar MCP 서버 추가

- [x] `mcp-registry.ts`: Calendar 추가 (`@cocal/google-calendar-mcp`)
- [x] `init.ts`: Google OAuth 후 `gcp-oauth.keys.json` 생성 → Calendar MCP 등록
- [x] `tools.ts`: Calendar addtool 플로우 추가
- [x] 빌드 + 테스트

## P0: DM 세션 무한 누적 + `msg_too_long` 수정

- [x] `core.ts`: DM(threadId 없음)에서 매 메시지마다 새 세션 생성 (resume 안 함)
- [x] `session.ts`: 최대 턴 수 제한 추가 (`MAX_SESSION_TURNS = 20`)
- [x] `session.ts`: `deleteSession()` 함수 추가
- [x] `core.ts`: `msg_too_long` 에러 시 해당 세션 자동 삭제 + 안내 메시지
- [x] 빌드 + 테스트

## P1: Google Drive MCP 교체

- [x] `mcp-registry.ts`: `@modelcontextprotocol/server-gdrive` → `@piotr-agier/google-drive-mcp`
- [x] `init.ts`: Drive MCP에 `gcp-oauth.keys.json` 파일 경로 전달
- [x] `tools.ts`: Drive addtool에 OAuth 파일 생성 로직 추가
- [x] 기존 config 마이그레이션 로직 (sync-mcp에서 자동 패키지 교체)
- [x] 빌드 + 테스트

## P1: Init 안내 메시지 정리

- [x] Google OAuth 선택지 `Google (Gmail, Calendar, Drive)` 통합 표기
- [x] Google 서비스 선택에서 Gmail/Calendar 선택 시 MCP 서버 자동 등록 연결
- [ ] 시스템 프롬프트 Figma/Gmail/Calendar 도구 설명 업데이트

## P2: 코드 정리

- [x] `figma-mcp.ts` 확인 (범용 MCP 유틸이므로 유지)
- [x] 테스트 업데이트 (5개 실패 → 전부 통과)
- [x] 전체 빌드 + 테스트 통과 (78 files, 646 tests)
