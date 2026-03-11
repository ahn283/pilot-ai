# Phase 10: 스레드 내 대화 연속성 (Conversation Continuity)

## 배경

현재 pilot-ai는 같은 Slack 스레드(댓글) 내에서 연속 대화를 해도 **바로 직전 대화를 기억하지 못하는 경우가 발생한다.**

### 근본 원인

**컨텍스트 오버플로우로 인한 리셋이 핵심 원인이다.**

`--resume`을 통한 세션 재개 자체는 작동하지만, tool use가 많은 대화(코드 분석, 파일 수정 등)에서 히스토리가 빠르게 팽창하여:
1. 컨텍스트 윈도우가 가득 참 → `msg_too_long` 에러 발생
2. 에러 핸들러가 세션 삭제 → 다음 메시지부터 완전히 새로운 세션
3. 이전 대화의 결정사항, 수정 파일, 진행 상태 전부 소실

### 실제 발생 시나리오

```
스레드 내 대화:
1. 사용자: "pilot-ai에 ENOENT 에러가 발생해. 코드 분석해줘"
   → 에이전트: 원인 분석 결과 보고 (cliBinary 경로 문제)

2. 사용자: "코드 수정 진행해줘"
   → 에이전트: 수정 완료 (cliBinary 설정값 반영)
   ⚡ 이 시점에서 히스토리가 컨텍스트 윈도우 한계 도달 → msg_too_long → 세션 리셋

3. 사용자: "이 버전 설치하면 해결되는거 아니야?"
   → 에이전트: ❌ 새 세션이라 직전에 자기가 뭘 수정했는지 모름
```

### 추가 발견 버그

**버그 1: resume 시 projectPath 소실**
```typescript
// core.ts:236 — 매 턴 메시지 텍스트에서 프로젝트를 재추출
const project = await resolveProject(msg.text);
const projectPath = project?.path;  // "코드 수정해줘" → null!
```
- 세션에 `projectPath`를 저장하지만, resume 시 저장된 값을 사용하지 않음
- 후속 메시지에 프로젝트명이 없으면 `projectPath = null` → cwd 소실

**버그 2: msg_too_long 에러 핸들러 threadId 불일치**
```typescript
// 세션 생성 시: threadId = msg.threadId ?? `dm-${Date.now()}`
// 에러 복구 시: threadId = msg.threadId ?? msg.channelId  ← 불일치!
```
- DM에서 `msg_too_long` 발생 시, 잘못된 key로 세션 삭제 시도 → 미삭제 → 깨진 세션 resume 무한 반복

### `--resume`의 알려진 결함 (Claude Code GitHub Issues)

| Issue | 문제 | 심각도 |
|-------|------|--------|
| [#15837](https://github.com/anthropics/claude-code/issues/15837) | JSONL 로드 성공하나 실제 컨텍스트 복원 실패 | Critical |
| [#22107](https://github.com/anthropics/claude-code/issues/22107) | parentUUID 체인 깨짐 → 96% 컨텍스트 손실 | Critical |
| [#10161](https://github.com/anthropics/claude-code/issues/10161) | resume 후 시스템 컨텍스트 누락 | High |
| [#14472](https://github.com/anthropics/claude-code/issues/14472) | 컨텍스트 초과 시 resume 불가 + compact 불가 (데드락) | High |

## 목표

1. **컨텍스트 리셋 후에도 대화 맥락 복원** — 핵심 목표
2. **정상 시에는 `--resume` full context 유지** — 성능 최적
3. **msg_too_long 에러 시 graceful fallback** — 자동 복구
4. **구현 최소화** — 기존 아키텍처 유지, 신규 모듈 1개 추가

## 제안 아키텍처: 하이브리드 (--resume + 요약 폴백)

### 핵심 전략

```
┌──────────────────────────────────────────────────────────────┐
│ 정상 흐름 (컨텍스트 여유 있음)                                  │
│                                                              │
│ Turn 1: system_prompt + user_msg → response                   │
│         → 대화 요약 저장 (백그라운드)                            │
│                                                              │
│ Turn 2: --resume + user_msg → response (full context 유지)    │
│         → 대화 요약 갱신 (백그라운드)                            │
│                                                              │
│ Turn N: --resume + user_msg → response                        │
│         → 대화 요약 갱신                                       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ 폴백 흐름 (msg_too_long 또는 resume 실패)                      │
│                                                              │
│ Turn N+1: msg_too_long 발생!                                  │
│           → 세션 삭제                                          │
│           → 저장된 대화 요약 로드                                │
│           → 새 세션 + system_prompt + 대화요약 + user_msg        │
│           → response (맥락 복원!)                              │
│           → 대화 요약 갱신                                      │
│                                                              │
│ Turn N+2: --resume 정상 재개 (새 세션 기준)                     │
└──────────────────────────────────────────────────────────────┘
```

### 핵심 변경: core.ts

```typescript
// === AS-IS ===
if (existingSession) {
  resumeSessionId = existingSession.sessionId;
}
const result = await invokeClaudeCli({
  prompt: msg.text,
  systemPrompt: resumeSessionId ? undefined : systemPrompt,
  sessionId,
  resumeSessionId,
});

// === TO-BE ===
// 1. 세션 존재 시 --resume 시도 (기존과 동일)
if (existingSession) {
  resumeSessionId = existingSession.sessionId;
  // 버그 수정: 세션에서 projectPath 복원
  projectPath = projectPath ?? existingSession.projectPath;
}

// 2. 대화 요약을 항상 로드 (폴백 대비 + 새 세션 시 주입)
const summary = await getConversationSummary(msg.platform, msg.channelId, threadId);

// 3. 새 세션이면 대화 요약을 system prompt에 포함
const fullSystemPrompt = !resumeSessionId && summary
  ? `${systemPrompt}\n\n<CONVERSATION_HISTORY>\n${summary}\n</CONVERSATION_HISTORY>`
  : systemPrompt;

try {
  const result = await invokeClaudeCli({
    prompt: msg.text,
    systemPrompt: resumeSessionId ? undefined : fullSystemPrompt,
    sessionId,
    resumeSessionId,
  });

  // 4. 성공 후 대화 요약 갱신
  await updateConversationSummary(
    msg.platform, msg.channelId, threadId,
    msg.text, result.result, projectPath
  );
  return result.result;

} catch (err) {
  if (isMsgTooLong(err)) {
    // 5. msg_too_long → 세션 삭제 + 대화 요약으로 재시도
    await deleteSession(msg.platform, msg.channelId, threadId);
    log(`msg_too_long: falling back to summary-based session`);

    const retryResult = await invokeClaudeCli({
      prompt: msg.text,
      systemPrompt: summary
        ? `${systemPrompt}\n\n<CONVERSATION_HISTORY>\n${summary}\n</CONVERSATION_HISTORY>`
        : systemPrompt,
      // 새 세션 — resume 없음
    });

    // 새 세션 생성 + 요약 갱신
    const newSession = await createSession(msg.platform, msg.channelId, threadId, projectPath);
    await updateConversationSummary(...);
    return retryResult.result;
  }
  throw err;
}
```

### 대화 요약 모듈 (`conversation-summary.ts` 신규)

```typescript
interface ConversationSummary {
  threadKey: string;           // platform:channelId:threadId
  projectPath?: string;
  turns: TurnSummary[];        // 최근 10턴 요약
  keyDecisions: string[];      // 주요 결정사항 (최대 20개)
  modifiedFiles: string[];     // 수정한 파일 목록 (최대 30개)
  lastUpdated: string;
}

interface TurnSummary {
  userMessage: string;         // 사용자 메시지 원문 (최대 500자)
  agentAction: string;         // 에이전트 행동 요약 (최대 300자)
  timestamp: string;
}
```

**저장소:**
```
~/.pilot/conversations/
  {platform}_{channelId}_{threadId}.json
```

**요약 추출 (규칙 기반, LLM 호출 없음):**
- `userMessage`: 원문 저장 (500자 truncate)
- `agentAction`: 응답 첫 300자 추출
- `modifiedFiles`: 응답에서 파일 경로 패턴 감지 (`Writing src/...`, `✏️ ...`, 등)
- `keyDecisions`: 커밋 메시지, 설정 변경 등의 패턴 감지

**system prompt 주입 포맷:**
```
<CONVERSATION_HISTORY>
이 스레드의 이전 대화 내역입니다. 이 맥락을 기반으로 응답하세요.

## 이전 대화 (3턴)
1. [14:00] 사용자: "ENOENT 에러 분석해줘"
   → 에이전트: cliBinary 경로 하드코딩 문제. config 값 사용하도록 수정 필요.

2. [14:15] 사용자: "코드 수정 진행해줘"
   → 에이전트: src/agent/claude.ts 수정 완료. 빌드/테스트 통과.

3. [14:20] 사용자: "커밋하고 푸시해줘"
   → 에이전트: 커밋 완료 (1b6f1e6).

## 수정된 파일
- src/agent/claude.ts

## 주요 결정사항
- Claude CLI 바이너리 경로를 config에서 읽도록 변경
</CONVERSATION_HISTORY>
```

### 수정 대상 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/agent/conversation-summary.ts` | **신규** — 대화 요약 CRUD, 추출, 포맷팅 |
| `src/agent/core.ts` | msg_too_long 시 요약 폴백, 매 턴 요약 갱신, projectPath 복원 |
| `src/agent/session.ts` | threadId 불일치 버그 수정 |

### 영향 범위

- **정상 흐름**: 변경 없음. `--resume` 그대로 사용. 대화 요약 저장만 추가 (비동기, 비차단).
- **에러 흐름**: `msg_too_long` 시 자동 복구. 사용자에게 "Session reset" 대신 정상 응답.
- **토큰 사용량**: 정상 시 변동 없음. 폴백 시 요약(~1000 토큰) 추가.
- **디스크**: `~/.pilot/conversations/` 디렉토리 추가. 파일당 ~2KB.

## 버그 수정 (Phase 10에 포함)

### 1. projectPath 소실 수정
```typescript
// core.ts — resolveProject 실패 시 세션에서 복원
const project = await resolveProject(msg.text);
let projectPath = project?.path;
if (!projectPath && existingSession?.projectPath) {
  projectPath = existingSession.projectPath;
}
```

### 2. msg_too_long 핸들러 threadId 불일치 수정
```typescript
// core.ts — 세션 생성과 동일한 threadId 로직 사용
const threadId = msg.threadId ?? `dm-${Date.now()}`;
// 에러 핸들러에서도 이 threadId를 그대로 사용 (msg.channelId 사용하지 않음)
```

## 베스트 프랙티스 비교 (업계 vs pilot-ai)

### Anthropic 공식 권고 — Context Engineering

> "Capture the results you need as application state and pass them into a fresh session's prompt. This is often more robust than shipping transcript files around."

pilot-ai의 하이브리드 전략은 이 권고를 따른다:
- 정상 시: `--resume`으로 full context (성능 최적)
- 리셋 시: 저장된 요약을 새 세션에 주입 (안정성)

### LangChain Conversation Summary Buffer

| 비교 항목 | LangChain | pilot-ai (TO-BE) |
|-----------|-----------|-------------------|
| 요약 방식 | LLM rolling summary | 규칙 기반 추출 |
| 트리거 | 토큰 한계 도달 시 | msg_too_long 에러 시 |
| 원문 보존 | 최근 K 메시지 | 최근 10턴 |
| 정상 시 | 항상 요약 사용 | --resume (full context) |

### OpenAI Agents SDK

| 비교 항목 | OpenAI Agents SDK | pilot-ai (TO-BE) |
|-----------|-------------------|-------------------|
| 세션 관리 | SDK 내부 자동 | --resume + 폴백 |
| 히스토리 저장 | DB 백엔드 | 파일 기반 JSON |
| 컨텍스트 제한 | `limit=N` 설정 | 10턴 FIFO |
| 오버플로우 처리 | truncation | 요약 폴백 |

## 범위 외 (Out of Scope)

- 벡터 DB 기반 시맨틱 검색
- 크로스 스레드 메모리 공유
- LLM 기반 요약 (규칙 기반으로 시작)
- DM 세션 연속성 개선 (별도 phase)

## 성공 지표

1. **msg_too_long 발생 후에도 대화 맥락 유지** (핵심)
2. 정상 --resume 시 기존과 동일한 응답 품질
3. 폴백 발생 시 사용자에게 투명 (에러 메시지 없이 정상 응답)
4. 10턴 이상 대화에서도 첫 턴의 핵심 맥락 보존
