# Phase 9: MCP 서버 신뢰성 개선 — Figma PAT 전환 + Google MCP 정상화

## 1. 배경 및 핵심 문제

### 1.1 Figma: HTTP OAuth 실패 → PAT stdio 전환

- Figma Remote MCP(`https://mcp.figma.com/mcp`)는 OAuth만 지원, PAT 미지원 ([Forum 확인](https://forum.figma.com/ask-the-community-7/support-for-pat-personal-access-token-based-auth-in-figma-remote-mcp-47465))
- `claude -p` (비인터렉티브)에서 OAuth 토큰 접근 불가 → 근본적으로 동작 안 함
- **해결**: `figma-developer-mcp` npm + PAT(figd_...) + stdio transport

### 1.2 Google: OAuth 이중화 + MCP 서버 부재/버그

| 서비스 | 현재 상태 | 문제 |
|--------|----------|------|
| Gmail | MCP 서버 없음 | OAuth 토큰 Keychain에만 저장, Claude 접근 불가 |
| Calendar | MCP 서버 없음 | 동일 |
| Drive | `@modelcontextprotocol/server-gdrive` | 2025.05 아카이브, 토큰 리프레시 버그 |

**근본 원인**: pilot-ai OAuth 토큰과 MCP 서버 토큰이 분리된 아키텍처

### 1.3 조사 결과 — 최적 MCP 서버 선정

#### Gmail MCP
| 패키지 | 상태 | 도구 수 | 토큰 전달 | 판정 |
|--------|------|---------|----------|------|
| [`@shinzolabs/gmail-mcp`](https://github.com/shinzo-labs/gmail-mcp) | **활발** (42스타) | 45+ | env var `CLIENT_ID`/`CLIENT_SECRET`/`REFRESH_TOKEN` | **채택** |
| `@gongrzhe/server-gmail-autoauth-mcp` | 아카이브 (2026.03) | ~17 | 파일 기반 | 탈락 |

**선정 이유**: env var로 토큰 직접 전달 → pilot-ai 기존 OAuth 토큰 재사용 가능, 이중 OAuth 불필요

#### Calendar MCP
| 패키지 | 상태 | 인증 | 판정 |
|--------|------|------|------|
| [`@cocal/google-calendar-mcp`](https://github.com/nspady/google-calendar-mcp) | **활발** | `GOOGLE_OAUTH_CREDENTIALS` 파일 | **채택** |

#### Drive MCP
| 패키지 | 상태 | 추가 지원 | 판정 |
|--------|------|----------|------|
| [`@piotr-agier/google-drive-mcp`](https://github.com/piotr-agier/google-drive-mcp) | **활발** (58스타) | Docs, Sheets, Slides, Calendar 포함 | **채택** |
| `@modelcontextprotocol/server-gdrive` | 아카이브 + 버그 | Drive만 | 교체 |

#### 탈락한 대안
- **`gws` (Google 공식 CLI)**: MCP 기능 출시 2일 만에 삭제 (2026.03.06). 200~400개 도구가 컨텍스트 4~10만 토큰 소비 → 추론 성능 저하. [출처](https://dev.to/gys/not-everything-needs-mcp-what-google-workspace-cli-taught-us-about-ai-agent-architecture-2doe)
- **`workspace-mcp` (taylorwilsdon)**: Python(uvx) 의존성 → Node.js 기반 pilot-ai에 부적합
- **`gogcli`/`gcalcli`**: CLI 도구일 뿐, MCP 서버 아님

---

## 2. 해결 방안

### 2.1 Figma: PAT + stdio 전환

**레지스트리 변경** (`mcp-registry.ts`):
```typescript
// 변경 전: transport: 'http', url: 'https://mcp.figma.com/mcp'
// 변경 후:
{
  id: 'figma',
  npmPackage: 'figma-developer-mcp',
  args: ['--stdio'],
  transport: 'stdio',
  envVars: { FIGMA_API_KEY: 'Figma Personal Access Token (figd_...)' },
}
```

**init 플로우** (`init.ts`):
1. PAT 발급 안내 (Figma Settings → Personal access tokens)
2. `figd_` 접두사 검증 + `https://api.figma.com/v1/me` API 검증
3. Keychain 저장 + MCP 등록

**mcp-config.json 결과**:
```json
{ "figma": { "command": "npx", "args": ["-y", "figma-developer-mcp", "--stdio"], "env": { "FIGMA_API_KEY": "figd_xxx" } } }
```

### 2.2 Gmail: MCP 서버 추가 (`@shinzolabs/gmail-mcp`)

**레지스트리 추가** (`mcp-registry.ts`):
```typescript
{
  id: 'gmail',
  name: 'Gmail',
  description: 'Read, search, send, and manage Gmail messages',
  npmPackage: '@shinzolabs/gmail-mcp',
  envVars: { CLIENT_ID: '...', CLIENT_SECRET: '...', REFRESH_TOKEN: '...' },
  keywords: ['gmail', 'email', 'mail', 'inbox'],
  category: 'communication',
}
```

**init 통합**: Google OAuth 완료 후 토큰을 env var로 직접 전달 (이중 OAuth 없음)

```json
{ "gmail": { "command": "npx", "args": ["-y", "@shinzolabs/gmail-mcp"], "env": { "CLIENT_ID": "xxx", "CLIENT_SECRET": "xxx", "REFRESH_TOKEN": "xxx" } } }
```

### 2.3 Calendar: MCP 서버 추가 (`@cocal/google-calendar-mcp`)

**레지스트리 추가** (`mcp-registry.ts`):
```typescript
{
  id: 'google-calendar',
  name: 'Google Calendar',
  description: 'List, create, update, delete calendar events',
  npmPackage: '@cocal/google-calendar-mcp',
  envVars: { GOOGLE_OAUTH_CREDENTIALS: '~/.pilot/credentials/gcp-oauth.keys.json' },
  keywords: ['calendar', 'event', 'schedule', 'meeting'],
  category: 'productivity',
}
```

**init 통합**: Google OAuth client credentials를 `gcp-oauth.keys.json` 파일로 내보내기 → 서버가 자체 인증 플로우 실행

### 2.4 Drive: MCP 서버 교체 (`@piotr-agier/google-drive-mcp`)

**레지스트리 수정** (`mcp-registry.ts`):
```typescript
// 변경 전: npmPackage: '@modelcontextprotocol/server-gdrive'
// 변경 후:
{
  id: 'google-drive',
  npmPackage: '@piotr-agier/google-drive-mcp',
  envVars: { GOOGLE_DRIVE_OAUTH_CREDENTIALS: '~/.pilot/credentials/gcp-oauth.keys.json' },
}
```

### 2.5 Google OAuth 토큰 브리지

**핵심 변경**: pilot-ai init의 Google OAuth 결과를 각 MCP 서버가 사용할 수 있는 형태로 내보내기

```
pilot-ai init → Google OAuth 수행
  ├→ Gmail MCP:    CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN (env var 직접 전달)
  ├→ Calendar MCP: gcp-oauth.keys.json 파일 생성 → 서버 자체 auth 실행
  └→ Drive MCP:    gcp-oauth.keys.json 파일 공유 → 서버 자체 auth 실행
```

### 2.6 Init 안내 메시지 개선

**Google 선택 시 서브 서비스**:
```
? Google services:
  ✔ Gmail        ← Gmail MCP 서버 등록 (env var 토큰)
  ✔ Calendar     ← Calendar MCP 서버 등록 (파일 기반 OAuth)
  ◻ Google Drive ← Drive MCP 서버 등록 (파일 기반 OAuth)
```

**Figma 선택지**: `Figma (Personal Access Token)` 표기

---

## 3. 영향 범위

| 파일 | 변경 | 설명 |
|------|------|------|
| `src/tools/mcp-registry.ts` | 수정 | Figma→stdio, Gmail/Calendar 추가, Drive 교체 |
| `src/cli/init.ts` | 수정 | Figma PAT 수집, Google OAuth 토큰 브리지, Gmail/Calendar MCP 등록 |
| `src/cli/auth.ts` | 수정 | Figma: OAuth→PAT 가이드 변경 |
| `src/cli/tools.ts` | 수정 | Gmail/Calendar addtool 플로우 |
| `src/agent/mcp-manager.ts` | 수정 | Gmail/Calendar auto-discovery 키워드 |
| `src/tools/figma-mcp.ts` | 수정 | 죽은 코드 정리 |

---

## 4. DM 세션 무한 누적 → `msg_too_long` 에러

### 4.1 문제

- DM에서 `threadId`가 없으므로 `msg.threadId ?? msg.channelId`로 대체됨 (`core.ts:313`)
- 모든 DM 메시지가 동일 세션 키(`slack:<channelId>:<channelId>`)로 묶임
- `claude -p --resume <sessionId>`로 같은 세션을 계속 resume → 컨텍스트 무한 누적
- Claude API 컨텍스트 한도 초과 시 `msg_too_long` 에러 발생
- 이후 모든 DM 메시지가 같은 깨진 세션을 resume하므로 **연쇄 실패**

### 4.2 현재 세션 관리

| 항목 | 현재 값 | 문제 |
|------|--------|------|
| `SESSION_TTL_MS` | 24시간 | DM이 하루 종일 하나의 세션 |
| 턴 수 제한 | 없음 | 무한 턴 가능 |
| DM 세션 분리 | 없음 | thread 없는 DM = 전부 같은 세션 |
| 에러 복구 | 없음 | `msg_too_long` 이후에도 같은 세션 resume 시도 |

### 4.3 해결 방안

#### 4.3.1 DM 메시지별 새 세션 (핵심 수정)

`core.ts`에서 DM(threadId 없음)은 매 메시지마다 새 세션 생성:

```typescript
// 현재: DM은 channelId로 세션 공유
const threadId = msg.threadId ?? msg.channelId;

// 변경: DM은 매 메시지마다 새 세션
const threadId = msg.threadId ?? `dm-${Date.now()}`;
```

또는 **세션 없이 호출** (resume 안 함):
```typescript
if (!msg.threadId) {
  // DM top-level: 항상 새 세션 (이전 컨텍스트 없음)
  sessionId = crypto.randomUUID();
  // resumeSessionId는 undefined → resume 안 함
}
```

#### 4.3.2 세션 턴 수 제한 (안전망)

`session.ts`에서 최대 턴 수 초과 시 세션 만료:

```typescript
const MAX_SESSION_TURNS = 20;  // 20턴 후 새 세션

export async function getSession(...): Promise<SessionEntry | null> {
  // ... 기존 TTL 체크
  if (entry.turnCount >= MAX_SESSION_TURNS) {
    sessions.delete(key);
    await save();
    return null;  // 새 세션 시작
  }
  return entry;
}
```

#### 4.3.3 `msg_too_long` 에러 시 세션 자동 리셋

`core.ts` 에러 핸들러에서 `msg_too_long` 감지 시 세션 삭제:

```typescript
} catch (err) {
  const errorMsg = err instanceof Error ? err.message : String(err);

  // msg_too_long: 세션 컨텍스트 초과 → 세션 삭제하여 다음 메시지부터 정상화
  if (errorMsg.includes('msg_too_long')) {
    await deleteSession(msg.platform, msg.channelId, threadId);
    displayMsg = '❌ 대화가 너무 길어졌습니다. 새 세션으로 시작합니다. 다시 메시지를 보내주세요.';
  }
}
```

#### 4.3.4 세션 종료 시 장기 메모리 저장

세션이 만료(TTL/턴 수 초과)되거나 리셋될 때, 핵심 정보를 장기 메모리에 저장:

```typescript
// session.ts — 세션 만료 시
async function onSessionExpire(entry: SessionEntry): Promise<void> {
  // 마지막 세션의 요약을 히스토리에 기록
  await appendHistory(`Session ${entry.sessionId} ended (${entry.turnCount} turns, project: ${entry.projectPath ?? 'none'})`);
}
```

**장기 메모리 구조** (현재):
- `~/.pilot/memory/MEMORY.md` — 사용자 선호사항 (200줄 한도)
- `~/.pilot/memory/projects/<name>.md` — 프로젝트별 컨텍스트
- `~/.pilot/memory/history/<date>.md` — 일별 히스토리

**개선 방향** (Phase 10 고려):
- 세션 종료 시 Claude에게 "이 대화에서 기억할 것 요약해줘" 요청 → 자동 메모리 추출
- 프로젝트 메모리에 작업 결과/결정사항 자동 기록
- 현재 Phase 9에서는 세션 분리 + 에러 복구만 구현

### 4.4 영향 범위

| 파일 | 변경 | 설명 |
|------|------|------|
| `src/agent/core.ts` | 수정 | DM 세션 분리 + `msg_too_long` 에러 복구 |
| `src/agent/session.ts` | 수정 | 턴 수 제한 + `deleteSession()` 추가 |

---

## 5. 구현 우선순위

| 우선순위 | 항목 | 상태 |
|---------|------|------|
| P0 | Figma PAT 전환 | ✅ 완료 |
| P0 | Gmail MCP 추가 | ✅ 완료 |
| P0 | Calendar MCP 추가 | ✅ 완료 |
| P0 | **DM 세션 무한 누적 + `msg_too_long` 수정** | 미구현 |
| P1 | Drive MCP 교체 | ✅ 완료 |
| P1 | Init 안내 메시지 통일 | ✅ 완료 |
| P2 | 죽은 코드 정리 + 마이그레이션 로직 | ✅ 완료 |

---

## 5. 참고 자료

- [figma-developer-mcp](https://www.npmjs.com/package/figma-developer-mcp) — PAT 기반 Figma MCP
- [Figma PAT 관리](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens)
- [@shinzolabs/gmail-mcp](https://github.com/shinzo-labs/gmail-mcp) — Gmail MCP (env var 토큰, 45+ 도구)
- [@cocal/google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) — Calendar MCP
- [@piotr-agier/google-drive-mcp](https://github.com/piotr-agier/google-drive-mcp) — Drive+Docs+Sheets+Calendar MCP
- [gws MCP 삭제 분석](https://dev.to/gys/not-everything-needs-mcp-what-google-workspace-cli-taught-us-about-ai-agent-architecture-2doe)
