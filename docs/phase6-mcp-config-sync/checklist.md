# Phase 6: MCP 설정 Claude Code 동기화 — 구현 체크리스트

## 1. 동기화 모듈 구현

- [x] `src/config/claude-code-sync.ts` 생성
  - [x] `syncToClaudeCode()` — `claude mcp add-json -s user` 호출
  - [x] `removeFromClaudeCode()` — `claude mcp remove -s user` 호출
  - [x] `syncAllToClaudeCode()` — 전체 서버 일괄 동기화
  - [x] `checkClaudeCodeSync()` — `claude mcp get` 으로 등록 여부 확인
  - [x] CLI 미설치 시 `{ success: false }` 반환 (에러 아님)

## 2. mcp-manager 연동

- [x] `src/agent/mcp-manager.ts` — `installMcpServer()`에 `syncToClaudeCode()` 호출 추가
- [x] `src/agent/mcp-manager.ts` — `uninstallMcpServer()`에 `removeFromClaudeCode()` 호출 추가
- [x] 동기화 실패 시 경고만 출력, 기존 로직은 정상 완료

## 3. sync-mcp CLI 명령

- [x] `src/index.ts`에 `sync-mcp` 서브커맨드 등록
- [x] `syncAllToClaudeCode()` 호출 + 결과 출력 핸들러 구현

## 4. tools 명령 확장

- [x] `src/cli/tools.ts` — `runTools()`에 Claude Code 동기화 상태 컬럼 추가
- [x] `checkClaudeCodeSync()` 호출로 각 서버 sync 상태 표시

## 5. 테스트

- [x] `claude-code-sync.ts` 단위 테스트 (CLI mock)
- [x] `installMcpServer()` 동기화 통합 테스트
- [x] CLI 미설치 환경 graceful 처리 테스트

## 6. 빌드 & 검증

- [x] `npm run build` 성공
- [x] `pilot-ai sync-mcp` 실행 → `claude mcp list`에서 서버 확인 (수동 검증)
- [x] Claude Code 직접 실행 시 MCP 도구 사용 가능 확인 (수동 검증)
