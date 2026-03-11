# Phase 13: Conversation Overflow 근본 해결 + Gmail MCP 안정화 PRD

## 1. 문제 상황

### 1.1 Gmail MCP 서버 시작 실패 — 포트 충돌 (근본 원인 확인)

**근본 원인:** `@shinzolabs/gmail-mcp@1.7.4`는 Stdio MCP 서버 외에 **Smithery HTTP 서버**도 항상 시작하며, 기본 포트 3000을 사용. 다른 프로세스(Next.js 등)가 3000을 점유하면 `EADDRINUSE` 에러로 전체 프로세스 크래시 → Claude Code에서 Gmail 도구가 안 보임.

**추가 문제:** `~/.gmail-mcp/` 디렉토리에 `gcp-oauth.keys.json`과 `credentials.json`이 생성되지 않았음 (Phase 12 코드가 실행되지 않았거나 이전 init에서 해당 코드 부재).

**해결:** `PORT=3456` 환경변수 추가 → 설정 파일 + 코드 모두 수정 완료.

### 1.2 "Conversation too long. Session has been reset" 빈번 발생

사용자가 Slack/Telegram으로 복잡한 작업 요청 시, Claude CLI 세션의 context window가 넘쳐서 대화가 강제 리셋됨. 현재 방어 메커니즘(20턴 제한, msg_too_long fallback)이 불충분.

**증상:**
- 복잡한 코딩/검색 작업 중 갑자기 "Conversation too long" 에러
- 세션 리셋 후 이전 대화 맥락 소실
- 10번 넘게 반복 발생 (사용자 보고)

### 1.2 Gmail MCP 안정성 미검증

Phase 12에서 구현했지만 아직 실제 작동 검증 미완료 (checklist 미체크 항목 3개).

---

## 2. 근본 원인 분석

### 2.1 [P0] 시스템 프롬프트 비대 — Context 낭비

**파일:** `src/agent/core.ts:269-313`

시스템 프롬프트가 약 2,000자+ (토큰 ~800+):
- 코어 규칙 9개 (Rules 1-9)
- 크레덴셜 관리 지침
- MCP context (설치된 서버 목록 + 가용 서버 목록)
- Memory context (프로젝트 히스토리)
- Skills context
- Tool descriptions

**문제:** Claude CLI의 200K context window에서 시스템 프롬프트만으로 상당 비율 차지. 매 세션마다 반복 주입.

### 2.2 [P0] `--max-turns` 미사용 — 단일 호출 무제한 확장

**파일:** `src/agent/claude.ts:131-241`

Claude CLI 호출 시 `--max-turns` 플래그를 사용하지 않음. 복잡한 요청 하나가 30-50개의 tool call을 생성하면 단일 turn 내에서 context 폭발.

**예시:** "fridgify 배포 내역 확인해줘" → `gh release list`, `git log`, file reads, web searches 등 10+ tool calls → 각 tool result가 수백~수천 토큰 → 하나의 turn에서 50K+ 토큰 소비.

### 2.3 [P0] 세션 턴 제한 20이 과도

**파일:** `src/agent/session.ts:31`

```typescript
const MAX_SESSION_TURNS = 20;
```

Tool-heavy 대화에서는 10턴 전에 context limit 도달. 20턴은 단순 Q&A에나 적합. agentic 작업에서는 턴당 평균 5-15 tool calls → 10턴이면 50-150 tool results 축적.

### 2.4 [P1] Conversation Summary 빈약 — Fallback 품질 저하

**파일:** `src/agent/conversation-summary.ts`

현재 summary 한계:
- `MAX_ACTION_LEN = 300` — agent 응답의 첫 300자만 보존 (실제 context의 ~5%)
- `extractKeyDecisions()` — commit 메시지만 감지. 대부분의 의사결정 누락
- `extractModifiedFiles()` — regex 패턴 매칭만. 실제 tool_use 결과 파싱 미지원
- `MAX_TURNS = 10` — 10턴 히스토리만 보존

**결과:** msg_too_long fallback 시 주입되는 summary가 너무 부족해서, 새 세션이 이전 맥락을 거의 모름.

### 2.5 [P1] 프로액티브 컴팩션/리셋 없음

Context가 위험 수준에 도달하기 전에 미리 대응하는 로직이 전혀 없음:
- 현재 턴 수 기반 리셋만 존재 (turnCount >= 20)
- 실제 토큰 사용량 모니터링 없음
- Claude CLI의 exit code나 warning 활용 없음

### 2.6 [P2] Gmail MCP 추가 개선점

**웹 리서치 결과:**

1. `@shinzolabs/gmail-mcp`는 `GMAIL_CREDENTIALS_PATH`와 `GMAIL_OAUTH_PATH` 환경변수 지원 — 현재 코드에서 미사용. 커스텀 경로 지정으로 안정성 향상 가능.

2. Google OAuth 앱 "Testing" → "Production" 전환 안내가 init/auth 시점에 더 강조되어야 함. Testing 상태에서 refresh token 7일 만료가 반복 실패의 주원인.

---

## 3. 해결 방안

### 3.1 [P0] 시스템 프롬프트 경량화

```typescript
// core.ts — 시스템 프롬프트를 핵심만 남기고 압축
const CORE_SYSTEM_PROMPT = `You are Pilot-AI, a personal AI agent on macOS.

RULES:
1. INVESTIGATE FIRST — Use tools (Bash, Read, Glob, Grep, WebSearch) before responding.
2. NEVER ASK CLARIFYING QUESTIONS if you can figure it out yourself.
3. CHAIN TOOLS — One tool call is rarely enough. Keep going until done.
4. BE CONCISE — Report results directly. No filler.
5. CODING — understand → implement → build → test → fix → report.`;
```

**변경 사항:**
- 9개 규칙 → 5개 핵심 규칙으로 압축 (~60% 축소)
- 크레덴셜 관리 지침 제거 (이미 도구에 내장)
- PROJECT WORKFLOW 규칙 제거 (CLAUDE.md에 이미 있음)
- MCP context는 유지 (필수)
- Memory/Skills context 최대 길이 제한 추가

### 3.2 [P0] `--max-turns` 플래그 도입

```typescript
// claude.ts — ClaudeCliOptions에 maxTurns 추가
export interface ClaudeCliOptions {
  // ... 기존 필드
  maxTurns?: number;
}

// invokeClaudeCliInner — args에 --max-turns 추가
if (maxTurns) {
  args.push('--max-turns', String(maxTurns));
}
```

```typescript
// core.ts — invokeClaudeCli 호출 시 maxTurns 전달
const result = await invokeClaudeCli({
  prompt: msg.text,
  maxTurns: 25, // 단일 호출에서 최대 25 tool turns
  // ...
});
```

**효과:** 하나의 메시지 처리에서 tool call 횟수 제한 → 단일 호출 context 폭발 방지.

### 3.3 [P0] 세션 턴 제한 감소

```typescript
// session.ts
const MAX_SESSION_TURNS = 10; // 20 → 10 (agentic 작업 기준)
```

**보완:** 턴 제한 도달 시 conversation summary 자동 주입으로 맥락 유지.

### 3.4 [P1] Conversation Summary 강화

```typescript
// conversation-summary.ts — 개선

// 1. Action summary 길이 증가
const MAX_ACTION_LEN = 800; // 300 → 800

// 2. 최대 턴 수 증가
const MAX_TURNS = 15; // 10 → 15

// 3. Agent 응답에서 더 풍부한 정보 추출
export function extractActionSummary(agentResponse: string): string {
  // 기존: 첫 300자 잘라냄
  // 개선: 마크다운 헤더, 코드 블록 시작/끝, 주요 키워드 기반 추출
  const sections: string[] = [];

  // 1) 첫 문단 (주요 결론)
  const firstPara = agentResponse.split('\n\n')[0];
  if (firstPara) sections.push(firstPara.slice(0, 300));

  // 2) 에러/성공 메시지
  const errorLines = agentResponse.match(/(?:❌|✅|⚠️|Error:|Success:|Failed:).*/g);
  if (errorLines) sections.push(...errorLines.slice(0, 3));

  // 3) 커밋 메시지
  const commitLines = agentResponse.match(/commit [0-9a-f]+.*/gi);
  if (commitLines) sections.push(...commitLines.slice(0, 2));

  return sections.join(' | ').slice(0, MAX_ACTION_LEN);
}

// 4. key decisions 추출 강화
export function extractKeyDecisions(agentResponse: string): string[] {
  const decisions: string[] = [];

  // 기존: commit 메시지만
  // 추가: "decided to", "chose", "선택", "결정", 설정 변경, 파일 생성/삭제
  const patterns = [
    /commit\s+[0-9a-f]+\s*[—–-]\s*(.+)/gi,
    /(?:decided|chose|choosing|selected|picked)\s+(?:to\s+)?(.{10,100})/gi,
    /(?:Created|Deleted|Installed|Configured|Updated|Fixed)\s+(.{10,80})/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(agentResponse)) !== null) {
      decisions.push(match[1].trim().slice(0, 200));
    }
  }

  return decisions;
}
```

### 3.5 [P1] 프로액티브 세션 관리

```typescript
// session.ts — 턴 수 기반 경고

/**
 * Returns remaining turns before session expires.
 * Used for proactive context management.
 */
export function getRemainingTurns(entry: SessionEntry): number {
  return MAX_SESSION_TURNS - entry.turnCount;
}
```

```typescript
// core.ts — 세션 잔여 턴 경고를 시스템 프롬프트에 주입

if (existingSession) {
  const remaining = getRemainingTurns(existingSession);
  if (remaining <= 3) {
    // 잔여 턴 적을 때 Claude에게 간결 응답 유도
    systemParts.push(
      `⚠️ Session context is running low (${remaining} turns remaining). ` +
      `Be extra concise. Summarize rather than showing full outputs.`
    );
  }
}
```

### 3.6 [P2] Gmail MCP 환경변수 개선

```typescript
// init.ts — Gmail MCP 등록 시 경로 환경변수 추가

await registerMcpTool('gmail', {
  CLIENT_ID: trimmedClientId,
  CLIENT_SECRET: trimmedClientSecret,
  REFRESH_TOKEN: tokens.refreshToken,
  GMAIL_OAUTH_PATH: path.join(os.homedir(), '.gmail-mcp', 'gcp-oauth.keys.json'),
  GMAIL_CREDENTIALS_PATH: path.join(os.homedir(), '.gmail-mcp', 'credentials.json'),
});
```

### 3.7 [P2] Google OAuth "Production" 전환 강력 안내

```typescript
// init.ts / auth.ts — OAuth 완료 후 안내 강화

console.log(`
⚠️  IMPORTANT: Google OAuth 앱이 "Testing" 상태이면 refresh token이 7일 후 만료됩니다.
    Google Cloud Console → OAuth consent screen → "PUBLISH APP" 클릭하세요.
    내부 사용(100명 이하)이면 Google 검수 없이 즉시 게시 가능합니다.
    게시하지 않으면 7일마다 "pilot-ai auth google"을 다시 실행해야 합니다.
`);
```

---

## 4. 구현 우선순위

| 우선순위 | 항목 | 영향도 | 난이도 | 파일 |
|---------|------|--------|--------|------|
| **P0** | `--max-turns 25` 플래그 도입 | 단일 호출 context 폭발 방지 | 낮음 | `claude.ts`, `core.ts` |
| **P0** | `MAX_SESSION_TURNS` 20 → 10 감소 | 세션 context 누적 방지 | 낮음 | `session.ts` |
| **P0** | 시스템 프롬프트 경량화 (~60% 축소) | context 여유 확보 | 중간 | `core.ts` |
| **P1** | Conversation Summary 강화 (800자, 15턴) | fallback 품질 향상 | 중간 | `conversation-summary.ts` |
| **P1** | 프로액티브 세션 경고 (잔여 턴 ≤3) | context 관리 개선 | 낮음 | `core.ts`, `session.ts` |
| **P1** | msg_too_long 시 summary 없어도 graceful fallback | 첫 턴 에러 방지 | 낮음 | `core.ts` |
| **P2** | Gmail MCP `GMAIL_OAUTH_PATH` / `GMAIL_CREDENTIALS_PATH` 환경변수 추가 | Gmail 인증 안정성 | 낮음 | `init.ts`, `tools.ts` |
| **P2** | Google OAuth "Production" 전환 안내 강화 | 7일 만료 방지 | 낮음 | `init.ts`, `auth.ts` |

---

## 5. 영향 범위

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/agent/claude.ts` | **수정** | `maxTurns` 옵션 추가, `--max-turns` 플래그 전달 |
| `src/agent/core.ts` | **수정** | 시스템 프롬프트 경량화, maxTurns 전달, 프로액티브 경고 |
| `src/agent/session.ts` | **수정** | MAX_SESSION_TURNS 20→10, getRemainingTurns() 추가 |
| `src/agent/conversation-summary.ts` | **수정** | Summary 강화 (길이, 추출 로직) |
| `src/cli/init.ts` | **수정** | Gmail 환경변수 추가, Production 안내 강화 |
| `src/cli/auth.ts` | **수정** | Production 안내 강화 |
| `src/cli/tools.ts` | **수정** | Gmail 환경변수 추가 |

---

## 6. 검증 계획

- [ ] `npm run build` 성공
- [ ] 기존 테스트 통과
- [ ] 10턴 초과 대화에서 자동 세션 리셋 + summary 주입 확인
- [ ] `--max-turns` 동작 확인 (Claude CLI `--help`에서 지원 여부 확인 필요)
- [ ] msg_too_long 발생 시 graceful fallback 확인
- [ ] Gmail MCP 도구 실제 작동 확인

---

## 7. 참고 자료

- [Claude Code compaction broken - Issue #18211](https://github.com/anthropics/claude-code/issues/18211) — /compact 실패 이슈
- [Claude Code compaction at 48% - Issue #23751](https://github.com/anthropics/claude-code/issues/23751) — 200K의 48%에서 실패
- [Claude Code conversation too long - Issue #23469](https://github.com/anthropics/claude-code/issues/23469)
- [Building /reload for Claude Code](https://www.panozzaj.com/blog/2026/02/07/building-a-reload-command-for-claude-code/) — exit code 129 활용
- [@shinzolabs/gmail-mcp docs](https://github.com/shinzo-labs/gmail-mcp) — GMAIL_CREDENTIALS_PATH, GMAIL_OAUTH_PATH 환경변수
- [Google OAuth token expiry](https://developers.google.com/identity/protocols/oauth2) — Testing 모드 7일 만료
