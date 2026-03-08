# Phase 5: MCP 자동 등록 및 사고 과정 스트리밍

## 1. 개요

두 가지 핵심 개선:

1. **MCP 자동 등록**: `pilot-ai init`에서 API 키 입력 시 MCP 서버를 자동 등록하여 별도 설치 없이 즉시 사용 가능하게
2. **사고 과정 스트리밍**: Claude의 thinking 과정을 실시간으로 캡처하여 사용자에게 전달

---

## 2. 문제 분석

### 2.1 MCP 자동 등록 미비

**현상**: 사용자가 `pilot-ai init`에서 Notion/Linear/Google 키를 입력해도 도구가 작동하지 않음.

**원인 분석**:

| 도구 | 키 저장 | MCP 등록 | init 시 동작 |
|------|---------|----------|-------------|
| Figma | ✅ Keychain | ✅ `registerFigmaMcp()` 호출 | 정상 작동 |
| Notion | ✅ Keychain | ❌ 등록 안 함 | **작동 안 함** |
| Linear | ✅ Keychain | ❌ 등록 안 함 | **작동 안 함** |
| Google | ✅ Keychain | ❌ 등록 안 함 | **작동 안 함** |
| GitHub | gh CLI 위임 | — | 정상 작동 |

**근본 원인**:
- `src/cli/init.ts` line 336에서 Figma만 `registerFigmaMcp(figmaToken)` 호출
- Notion, Linear, Google는 키만 Keychain에 저장하고 MCP 등록을 하지 않음
- `src/tools/mcp-registry.ts`에 Notion(`@notionhq/notion-mcp-server`), Linear(`@anthropic-ai/linear-mcp`) 등 이미 정의되어 있음
- `src/agent/mcp-manager.ts`에 `installMcpServer()` 함수도 이미 존재
- 하지만 init 과정에서 이 함수들을 호출하지 않아 연결 끊김

**추가 문제**: `src/tools/notion.ts`, `linear.ts` 등의 직접 API 래퍼도 `initNotion()`, `initLinear()` 등 초기화 함수가 호출되지 않아 사용 불가. 이 래퍼들은 MCP 전환 시 사실상 불필요해짐 (dead code).

### 2.2 사고 과정 표시 미비

**현상**: Claude가 작업 중일 때 사용자에게 "Processing..." 또는 도구 사용 상태만 표시. 내부 사고 과정(thinking)은 볼 수 없음.

**현재 구조** (`src/agent/claude.ts`):
- `claude -p --output-format json` 사용 (line 138-140)
- `onToolUse` 콜백으로 도구 사용 시 상태 전달 (line 188-211)
- thinking 블록은 파싱하지 않음

**Claude Code CLI의 thinking 지원 현황** (2026.03 기준):

| 기능 | 상태 | 비고 |
|------|------|------|
| `--output-format stream-json --verbose` | ✅ 작동 | `thinking_delta` 이벤트로 thinking 스트리밍 |
| `--include-partial-messages` | ✅ 작동 | 실시간 스트리밍 활성화 |
| interactive TUI verbose 모드 | ⚠️ 버그 | v2.1.29부터 thinking 블록 미표시 (issue #25980) |
| 실시간 thinking 스트리밍 (TUI) | ❌ 미지원 | 요청됨 (issue #30660) |

**핵심 발견**: `--output-format stream-json --verbose --include-partial-messages` 조합으로 thinking을 실시간 캡처 가능. 현재 pilot-ai는 `json` 포맷만 사용 중이라 이 데이터를 놓치고 있음.

**관련 환경변수**:
- `MAX_THINKING_TOKENS`: thinking 토큰 예산 (기본 31,999)
- `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`: adaptive thinking 비활성화

---

## 3. 요구사항

### 3.1 MCP 자동 등록

- **R1**: init에서 Notion 키 입력 시 `@notionhq/notion-mcp-server` MCP 서버 자동 등록
- **R2**: init에서 Linear 키 입력 시 `@anthropic-ai/linear-mcp` MCP 서버 자동 등록
- **R3**: init에서 Google 키 입력 시 `@anthropic-ai/google-drive-mcp` MCP 서버 자동 등록
- **R4**: 기존 Figma 등록 로직을 일반화 — `installMcpServer()` 재사용
- **R5**: 등록 후 연결 테스트 (가능한 경우)
- **R6**: 직접 API 래퍼(`src/tools/notion.ts`, `linear.ts` 등) dead code 정리

### 3.2 사고 과정 스트리밍

- **R7**: Claude CLI 호출을 `stream-json` 포맷으로 전환
- **R8**: `thinking_delta` 이벤트를 파싱하여 사고 과정 캡처
- **R9**: 메신저(Slack/Telegram)로 사고 과정 요약 전달 (선택적, 너무 자주 보내지 않도록 throttle)
- **R10**: 기존 `onToolUse` 콜백과 공존 — `onThinking` 콜백 추가
- **R11**: 사고 과정 표시 on/off 설정 지원

---

## 4. 설계

### 4.1 MCP 자동 등록 — init 흐름 개선

**변경 파일**: `src/cli/init.ts`

현재 Notion 설정 (line 279-298):
```typescript
// AS-IS: 키만 저장
await setSecret('notion-api-key', notionApiKey);
result.notion = { apiKey: '***keychain***' };
```

개선:
```typescript
// TO-BE: 키 저장 + MCP 서버 등록
await setSecret('notion-api-key', notionApiKey);
await installMcpServer('notion', {
  OPENAPI_MCP_HEADERS: JSON.stringify({
    'Authorization': `Bearer ${notionApiKey}`,
    'Notion-Version': '2022-06-28',
  }),
});
result.notion = { apiKey: '***keychain***' };
console.log('  Notion configured (MCP server registered).\n');
```

동일 패턴을 Linear, Google에도 적용.

**Figma 리팩토링**: 기존 `registerFigmaMcp()` 대신 `installMcpServer('figma', ...)` 사용하여 통일.

### 4.2 MCP 등록 헬퍼 함수

**변경 파일**: `src/agent/mcp-manager.ts` 또는 새 유틸

init에서 사용할 수 있도록 `installMcpServer()`의 의존성을 정리:
- 현재 `installMcpServer()`가 `npx` 검증을 시도하는데, init 시점에선 불필요할 수 있음
- init 전용 경량 등록 함수를 고려하거나, 기존 함수에서 검증을 선택적으로 스킵

### 4.3 사고 과정 스트리밍 — Claude CLI 호출 변경

**변경 파일**: `src/agent/claude.ts`

```typescript
// AS-IS (line 138-140)
args.push('-p', '--output-format', 'json');

// TO-BE
args.push('-p', '--output-format', 'stream-json', '--verbose');
```

**stream-json 이벤트 파싱**:

`stream-json` 포맷은 NDJSON으로 각 줄이 하나의 이벤트:
```jsonl
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"사고 내용..."}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"응답 텍스트..."}}}
```

파싱 로직:
```typescript
// thinking_delta 감지
if (msg.type === 'stream_event') {
  const delta = msg.event?.delta;
  if (delta?.type === 'thinking_delta' && onThinking) {
    onThinking(delta.thinking);
  }
  if (delta?.type === 'text_delta') {
    // 기존 텍스트 수집 로직
  }
}
```

### 4.4 사고 과정 메신저 전달

**변경 파일**: `src/agent/core.ts`

```typescript
// Throttled thinking reporter
let lastThinkingReport = 0;
const THINKING_THROTTLE_MS = 5000; // 5초마다 최대 1회

onThinking: (text: string) => {
  const now = Date.now();
  if (now - lastThinkingReport > THINKING_THROTTLE_MS) {
    messenger.sendStatus(`💭 ${text.slice(0, 200)}...`);
    lastThinkingReport = now;
  }
}
```

### 4.5 설정 스키마 확장

**변경 파일**: `src/config/schema.ts`

```typescript
// agent 섹션에 추가
agent: {
  showThinking: boolean;  // default: true
}
```

---

## 5. 영향 범위

### 변경 파일
| 파일 | 변경 내용 |
|------|----------|
| `src/cli/init.ts` | Notion/Linear/Google MCP 자동 등록 추가 |
| `src/agent/claude.ts` | `stream-json` 전환, thinking 파싱 |
| `src/agent/core.ts` | `onThinking` 콜백 연결, 메신저 전달 |
| `src/config/schema.ts` | `showThinking` 설정 추가 |
| `src/tools/figma-mcp.ts` | `registerFigmaMcp()` → `installMcpServer()` 통일 (선택) |

### 삭제 후보 (dead code)
| 파일 | 사유 |
|------|------|
| `src/tools/notion.ts` | MCP로 대체 — 직접 API 래퍼 불필요 |
| `src/tools/linear.ts` | MCP로 대체 |
| `src/tools/figma.ts` | MCP로 대체 (figma-mcp.ts가 담당) |

> ⚠️ dead code 삭제는 MCP 전환 검증 후 별도 단계에서 진행.

---

## 6. 리스크

| 리스크 | 완화 |
|--------|------|
| `stream-json` 포맷이 기존 JSON 파싱 로직과 호환 안 될 수 있음 | `parseClaudeJsonOutput()` 리팩토링, 기존 테스트 커버리지 확인 |
| MCP 서버 npm 패키지 설치 실패 시 init 중단 | try-catch로 감싸고 경고만 출력, init 계속 진행 |
| thinking throttle이 중요한 사고 내용을 누락할 수 있음 | 전체 thinking은 로그에 기록, 메신저에는 요약만 |
| Notion MCP 서버의 `OPENAPI_MCP_HEADERS` 형식이 변경될 수 있음 | 공식 문서 참조, 연결 테스트로 검증 |

---

## 7. 참고 자료

### Claude Code CLI 관련
- [Issue #30660](https://github.com/anthropics/claude-code/issues/30660) — 실시간 thinking 스트리밍 요청
- [Issue #25980](https://github.com/anthropics/claude-code/issues/25980) — verbose 모드 thinking 미표시 버그
- [Issue #8477](https://github.com/anthropics/claude-code/issues/8477) — always show thinking 설정 요청
- [Issue #15890](https://github.com/anthropics/claude-code/issues/15890) — thinking/tool 분리 verbose 요청
- [Claude Code Headless 문서](https://code.claude.com/docs/en/headless) — `stream-json` 포맷 설명
- [Adaptive Thinking 문서](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)

### MCP 서버 패키지
- `@notionhq/notion-mcp-server` — Notion 공식 MCP
- `@anthropic-ai/linear-mcp` — Linear MCP
- `@anthropic-ai/figma-mcp` — Figma MCP
- `@anthropic-ai/google-drive-mcp` — Google Drive MCP
