# Phase 5: MCP 자동 등록 & 사고 과정 스트리밍 — Checklist

## 5.1 [P0] init 시 MCP 서버 자동 등록

### Notion MCP 등록
- [x] `init.ts` — Notion 키 입력 후 `installMcpServer('notion', ...)` 호출하여 `~/.pilot/mcp-config.json`에 등록
- [x] `OPENAPI_MCP_HEADERS` 환경변수 형식으로 API 키 전달 (Notion MCP 서버 요구사항)
- [x] 등록 후 "Notion configured (MCP server registered)" 메시지 출력

### Linear MCP 등록
- [x] `init.ts` — Linear 키 입력 후 `installMcpServer('linear', ...)` 호출
- [x] `LINEAR_API_KEY` 환경변수로 API 키 전달
- [x] 등록 후 확인 메시지 출력

### Google Drive MCP 등록
- [x] `init.ts` — Google 키 입력 후 `installMcpServer('google-drive', ...)` 호출
- [x] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 환경변수 전달
- [x] 등록 후 확인 메시지 출력

### Figma 등록 통일
- [x] `init.ts` — 기존 `registerFigmaMcp()` 직접 호출 → `installMcpServer('figma', ...)` 로 통일
- [x] `figma-mcp.ts`의 `registerFigmaMcp()` deprecated 처리 또는 내부에서 `installMcpServer()` 위임

### installMcpServer 개선
- [x] `mcp-manager.ts` — init에서 호출 시 npx 검증 스킵 옵션 추가 (init 시점에는 불필요)
- [x] 등록 실패 시 try-catch로 감싸서 init 중단 방지 (경고만 출력)

### 테스트
- [x] init MCP 등록 단위 테스트 — Notion/Linear/Google/Figma 각각 등록 확인
- [x] `mcp-config.json`에 올바른 형식으로 저장되는지 검증

---

## 5.2 [P1] 사고 과정(Thinking) 스트리밍

### Claude CLI 호출 변경
- [x] `claude.ts` — `--output-format json` → `--output-format stream-json --verbose` 전환
- [x] `ClaudeCliOptions`에 `onThinking?: (text: string) => void` 콜백 추가
- [x] stream-json NDJSON 파싱 — `thinking_delta` 이벤트 감지 및 `onThinking` 콜백 호출
- [x] `parseClaudeJsonOutput()` → stream-json 포맷 호환되도록 리팩토링
- [x] 기존 `onToolUse` 파싱 로직이 stream-json에서도 작동하도록 수정

### 메신저 전달
- [x] `core.ts` — `onThinking` 콜백 연결, throttle 적용 (5초 간격)
- [x] thinking 내용을 메신저에 `💭 {요약}` 형태로 전달
- [x] 너무 긴 thinking은 200자로 잘라서 전달

### 설정
- [x] `schema.ts` — `agent.showThinking: boolean` (default: true) 추가
- [x] `core.ts` — `showThinking` 설정에 따라 thinking 전달 on/off

### 테스트
- [x] stream-json 파싱 단위 테스트 — thinking_delta, text_delta, tool_use 이벤트
- [x] throttle 로직 테스트
- [x] 기존 claude.ts 테스트가 stream-json 전환 후에도 통과하는지 확인

---

## 5.3 [P0] init 통합 도구 선택 UX 리팩토링

- [x] `init.ts` — `setupIntegrations()`를 체크박스 복수 선택 방식으로 리팩토링
- [x] MCP 레지스트리 도구 + 커스텀(GitHub, Obsidian) 통합 리스트 제시
- [x] 선택된 도구만 키/정보 수집 → MCP 등록
- [x] 테스트 — 통합 선택 흐름 테스트

---

## 5.4 [P0] `pilot-ai tools` 명령

- [x] `src/cli/tools.ts` — `runTools()` 구현 (전체 도구 리스트 + active/inactive 상태)
- [x] `src/index.ts` — `tools` 서브커맨드 등록
- [x] 테스트

---

## 5.5 [P0] `pilot-ai addtool <name>` 명령

- [x] `src/cli/tools.ts` — `runAddTool(name)` 구현 (키 수집 → MCP 등록)
- [x] MCP 레지스트리에서 도구 찾기, 가이드 출력, 키 입력 프롬프트
- [x] 커스텀 연동(GitHub, Obsidian)은 기존 setup 함수 재사용
- [x] `src/index.ts` — `addtool` 서브커맨드 등록
- [x] 테스트

---

## 5.6 [P1] `pilot-ai removetool <name>` 명령

- [x] `src/cli/tools.ts` — `runRemoveTool(name)` 구현 (MCP config에서 제거)
- [x] `src/index.ts` — `removetool` 서브커맨드 등록
- [x] 테스트

---

## 5.7 [P0] 버전 관리

- [x] `src/index.ts` — 하드코딩된 version → package.json에서 동적 읽기

---

## 5.8 [P1] MCP 레지스트리 확장 (Jira, Confluence, Wiki)

- [x] `mcp-registry.ts` — Jira 항목 추가 (`@aashari/mcp-server-atlassian-jira`, ATLASSIAN_SITE_NAME/EMAIL/API_TOKEN)
- [x] `mcp-registry.ts` — Confluence 항목 추가 (`@aashari/mcp-server-atlassian-confluence`, 동일 Atlassian 인증)
- [x] `mcp-registry.ts` — Wiki(MediaWiki) 항목 추가 (`@professional-wiki/mediawiki-mcp-server`, CONFIG 경로)
- [x] `init.ts` — Jira/Confluence/Wiki 선택 시 설정 가이드 출력 및 키 수집 로직 추가
- [x] `tools.ts` — `runAddTool()`에 Jira/Confluence/Wiki 설정 가이드 및 키 수집 로직 추가
- [x] 빌드 통과 확인
- [x] 기존 테스트 623개 전체 통과 확인
