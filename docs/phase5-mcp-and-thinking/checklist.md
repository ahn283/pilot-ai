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
