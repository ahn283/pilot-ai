# Phase 15: MCP 통합 아키텍처 개선 PRD

## 1. 문제 상황

### 1.1 트리거 이슈: Google OAuth 팝업

Google 툴을 등록하지 않은 다른 컴퓨터에서 질문만 해도 **Google OAuth 팝업이 반복 발생**한다.

**재현 경로:**
1. 컴퓨터 A에서 `pilot-ai init` → Google OAuth 설정 → `config.google` 저장
2. 컴퓨터 B에 `~/.pilot/config.json` 동기화 (dotfiles sync)
3. 컴퓨터 B에서 `pilot-ai start` → `config.google` 존재 → `configureGoogle()` + `startTokenRefresher()` 무조건 실행
4. TokenRefresher → `runHealthCheck()` → 토큰 없음 → `syncRefreshedTokensToMcp()` → OAuth 팝업

### 1.2 전체 MCP 통합 아키텍처 문제

Google OAuth 이슈를 조사하면서 **전체 18개 MCP 서버 통합에 걸친 구조적 문제**가 드러남:

| # | 문제 | 영향 범위 | 심각도 |
|---|------|-----------|--------|
| 1 | **Config = Auth Trigger**: config 존재만으로 인증 프로세스 시작 | Google (3개 서버) | P0 |
| 2 | **Startup side-effect**: `start()`에서 외부 서비스 호출/OAuth 팝업 유발 | Google, Figma (HTTP) | P0 |
| 3 | **Credential 이중 저장**: Keychain + `~/.claude.json` 평문 복사 | 전체 MCP 서버 | P1 |
| 4 | **Health check 부재**: 대부분 MCP 서버에 런타임 상태 확인 없음 | Google 외 전부 | P1 |
| 5 | **인증 방식 파편화**: 서버마다 다른 인증 패턴 (env var, file, OAuth) | 전체 | P2 |
| 6 | **Multi-device 미고려**: config sync 시 기기별 상태 구분 없음 | 전체 | P1 |

---

## 2. 전체 MCP 서버 현황 분석

### 2.1 인증 유형별 분류

#### Type A: API Key / Token (단순 인증)

| 서버 | 패키지 | 인증 | Keychain Key | 위험 수준 |
|------|--------|------|-------------|-----------|
| **figma** | `figma-developer-mcp` | API Key (`figd_...`) | `figma-api-key` | 낮음 |
| **notion** | `@notionhq/notion-mcp-server` | Bearer Token (`ntn_...`) | `notion-api-key` | 낮음 |
| **linear** | `@tacticlaunch/mcp-linear` | API Token (`lin_api_...`) | `linear-api-key` | 낮음 |
| **slack** | `@modelcontextprotocol/server-slack` | Bot Token (`xoxb_...`) | `slack-bot-token` | 낮음 |
| **github** | `@modelcontextprotocol/server-github` | gh CLI | (gh 자체 관리) | 낮음 |
| **sentry** | `@sentry/mcp-server` | Auth Token | Keychain | 낮음 |
| **brave-search** | `@modelcontextprotocol/server-brave-search` | API Key | Keychain | 낮음 |

**현재 상태:** Launcher script로 Keychain에서 런타임 주입. **비교적 안전한 구조.**

#### Type B: OAuth (복합 인증)

| 서버 | 패키지 | 인증 흐름 | 토큰 파일 | 문제점 |
|------|--------|-----------|-----------|--------|
| **gmail** | `@shinzolabs/gmail-mcp` | OAuth + env vars + 파일 | `~/.gmail-mcp/credentials.json` | 환경변수/파일 이중 관리, refresh 불일치 |
| **google-calendar** | `@cocal/google-calendar-mcp` | OAuth Credentials File | `~/.config/google-calendar-mcp/tokens.json` | 자체 OAuth 플로우 실행 |
| **google-drive** | `@piotr-agier/google-drive-mcp` | OAuth Credentials File | `~/.config/google-drive-mcp/tokens.json` | 자체 OAuth 플로우 실행 |

**현재 상태:** 3개 패키지가 각각 다른 인증 라이프사이클. **가장 문제가 많은 영역.**

#### Type C: 자격증명 (사용자/비밀번호 유형)

| 서버 | 패키지 | 인증 | Keychain Key |
|------|--------|------|-------------|
| **jira** | `@aashari/mcp-server-atlassian-jira` | Site + Email + API Token | `atlassian-api-token-jira` |
| **confluence** | `@aashari/mcp-server-atlassian-confluence` | Site + Email + API Token | `atlassian-api-token-confluence` |

**현재 상태:** Launcher script로 Keychain 주입. **구조적으로는 양호.**

#### Type D: 인증 불필요

| 서버 | 비고 |
|------|------|
| **postgres** | Connection string |
| **sqlite** | 파일 경로 |
| **puppeteer** | 없음 |
| **filesystem** | 접근 제어 |
| **memory** | 없음 |

### 2.2 문제별 영향 매핑

```
문제 1: Config = Auth Trigger
  └─ Google (gmail, calendar, drive) ← core.ts에서 config.google 체크

문제 2: Startup side-effect
  ├─ Google ← TokenRefresher가 start()에서 즉시 실행
  └─ Figma ← syncHttpToClaudeCode()가 stdio:'inherit'로 OAuth 팝업

문제 3: Credential 이중 저장
  ├─ Gmail ← Keychain + mcp-config.json env + ~/.gmail-mcp/credentials.json
  ├─ Notion ← Keychain + claude mcp add-json으로 평문 전달
  ├─ Figma ← Keychain + claude mcp add-json으로 평문 전달
  ├─ Slack ← Keychain + claude mcp add-json으로 평문 전달
  ├─ Linear ← Keychain + claude mcp add-json으로 평문 전달
  ├─ Jira ← Keychain + claude mcp add-json으로 평문 전달
  └─ Confluence ← Keychain + claude mcp add-json으로 평문 전달
  ※ Launcher script 도입 후 claude mcp add-json은 launcher 경로만 전달 → 개선됨
  ※ 단, migrateToSecureLaunchers() 이전 설치분은 여전히 평문

문제 4: Health check 부재
  ├─ Google ← TokenRefresher가 1시간 주기로 체크 (유일)
  ├─ GitHub ← hourly auth check (유일)
  └─ 나머지 전부 ← 런타임 상태 확인 없음. 서버 죽어도 모름.

문제 5: 인증 방식 파편화
  ├─ Gmail ← env vars (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN) + 파일 2개
  ├─ Calendar ← gcp-oauth.keys.json 파일 경로 → 자체 OAuth
  ├─ Drive ← gcp-oauth.keys.json 파일 경로 → 자체 OAuth
  ├─ Notion ← OPENAPI_MCP_HEADERS (JSON with Bearer)
  ├─ Figma ← FIGMA_API_KEY
  ├─ Slack ← SLACK_BOT_TOKEN + SLACK_TEAM_ID
  └─ Jira/Confluence ← ATLASSIAN_SITE_NAME + EMAIL + API_TOKEN

문제 6: Multi-device 미고려
  └─ config.json 동기화 시 모든 통합이 영향받을 수 있음
     ├─ Google ← config.google 존재 → TokenRefresher 시작 (버그)
     ├─ Notion ← config.notion 존재 → mcp-config.json에 없으면 문제 없음
     └─ 기타 ← config에 저장되지만 startup에서 eager action 없음
```

---

## 3. 아키텍처 진단

### 3.1 현재 아키텍처: Eager + Coupled

```
pilot-ai start
    │
    ├─ config.google 존재? ─── YES ──┐
    │                                 │
    │                    configureGoogle()          ← 무조건 실행
    │                    startTokenRefresher()      ← 무조건 실행
    │                         │
    │                    runHealthCheck() (즉시)
    │                         │
    │                    ┌─ 토큰 있음 → verify → refresh → syncToMcp
    │                    └─ 토큰 없음 → 'not_configured' (BUT side-effect 이미 발생)
    │
    ├─ migrateToSecureLaunchers()  ← config에 등록된 MCP 서버 전부 migration
    │
    ├─ GitHub auth check (hourly)
    │
    └─ 나머지 MCP 서버 ← startup에서 아무것도 안 함 (health check 없음)
```

**문제점:**

1. **Google만 특수 처리**: Google은 eager + active refresh, 나머지는 fire-and-forget
2. **Configuration과 Authentication 결합**: `config.google` = "사용 의도"로 가정
3. **Startup side-effect**: 시작 시 MCP 등록/동기화 → OAuth 팝업 유발
4. **통일된 MCP 라이프사이클 없음**: 서버마다 다른 관리 패턴

### 3.2 목표 아키텍처: Lazy Auth + Unified Lifecycle

```
pilot-ai start
    │
    ├─ [Phase 1] MCP Registry Check
    │   └─ mcp-config.json에서 등록된 서버 목록 로드
    │
    ├─ [Phase 2] Credential Verification (per server, non-blocking)
    │   ├─ 각 서버별 Keychain에서 credential 존재 확인
    │   ├─ 있음 → status: 'ready'
    │   └─ 없음 → status: 'auth_required' (경고 로그만, side-effect 없음)
    │
    ├─ [Phase 3] Conditional Services (토큰 존재 + MCP 등록 확인 후에만)
    │   ├─ Google: tokens 있고 + MCP 등록됨 → startTokenRefresher()
    │   ├─ GitHub: config.github.enabled → hourly auth check
    │   └─ 나머지: 추가 startup action 없음
    │
    ├─ [Phase 4] Migration (기존 호환)
    │   └─ migrateToSecureLaunchers() ← 등록된 서버만 대상
    │
    └─ [Phase 5] Status Report
        └─ 로그: "MCP: gmail(ready), notion(ready), figma(auth_required), ..."
```

---

## 4. 설계 원칙 (Best Practices 기반)

### 4.1 Lazy OAuth Initialization

> **원칙: OAuth/인증 흐름은 실제로 필요한 시점까지 지연한다.**

- **출처**: OAuth 2.1 Best Current Practice, Auth0 Token Best Practices
- **적용**: 모든 MCP 서버에 대해 — config 존재만으로 인증 프로세스를 시작하지 않는다
- **패턴**:
  ```
  CredentialProvider.verify(serverId):
    if keychain[serverId] exists and valid → 'ready'
    if keychain[serverId] exists but expired → attempt refresh (background, no UI)
    if keychain[serverId] missing → 'auth_required' (log only)
  ```

### 4.2 Per-Device Authentication

> **원칙: 인증 상태(토큰)는 기기별로 독립적이다. 설정(config)만 동기화하고, 토큰은 동기화하지 않는다.**

- **출처**: OAuth Security BCP (RFC 6819), 전체 MCP 클라이언트 업계 합의
- **적용 (전 서버 공통)**:
  - `~/.pilot/config.json`: 동기화 가능 (어떤 서비스를 설정했는지)
  - Keychain: 기기별 독립 (실제 토큰/키)
  - `~/.pilot/mcp-config.json`: 기기별 독립 (이 기기에서 활성화된 MCP 서버)

### 4.3 Configuration ≠ Registration ≠ Authentication

> **원칙: 세 가지 상태를 명확히 분리한다.**

```
config.json에 설정 있음         → "이 사용자가 서비스 자격증명을 가지고 있다"
mcp-config.json에 등록됨        → "이 기기에서 MCP 서버를 사용하겠다"
Keychain에 유효한 토큰 있음      → "이 기기에서 인증이 완료되었다"

세 가지가 모두 충족될 때만 서버가 'ready' 상태.
하나라도 없으면 graceful degradation.
```

### 4.4 Fail-Safe Startup

> **원칙: 시작 시점에 외부 서비스 의존성으로 인한 실패나 사용자 상호작용을 유발하지 않는다.**

- `AgentCore.start()`에서 OAuth 브라우저 팝업을 절대 트리거하지 않음
- MCP 서버 등록/동기화는 startup critical path에서 제외
- 실패 시 graceful degradation: 로그 경고만 남기고 나머지 기능은 정상 동작

### 4.5 Explicit Intent

> **원칙: 사용자가 명시적으로 요청한 작업만 수행한다.**

- OAuth 팝업, API 인증은 `pilot-ai init`, `pilot-ai addtool`, `pilot-ai auth` 등 **사용자 명시적 명령**에서만
- 데몬 시작, 토큰 갱신, health check에서는 절대 발생하지 않아야 함

---

## 5. 상세 변경 사항

### Phase A: 즉시 해결 (Google OAuth 팝업 차단)

#### 5.1 [P0] AgentCore.start()에서 TokenRefresher 조건부 시작

**파일:** `src/agent/core.ts`

**현재:**
```typescript
if (this.config.google) {
  configureGoogle({ clientId, clientSecret });  // 무조건
  startTokenRefresher(/* ... */);                // 무조건
}
```

**변경:**
```typescript
// configureGoogle은 유지 (메모리 설정만, side-effect 없음)
if (this.config.google) {
  configureGoogle({ clientId: this.config.google.clientId, clientSecret: this.config.google.clientSecret });
}

// TokenRefresher는 토큰 + MCP 등록 확인 후에만
if (this.config.google) {
  const tokens = await loadGoogleTokens();
  const mcpConfig = await loadMcpConfig();
  const hasGoogleMcp = hasRegisteredGoogleServers(mcpConfig);

  if (tokens && hasGoogleMcp) {
    startTokenRefresher(/* ... */);
    log('Google token refresher started.');
  } else if (!tokens && hasGoogleMcp) {
    log('Google MCP servers registered but no tokens found. Run "pilot-ai auth google".');
  } else {
    log('Google OAuth configured but not active on this device.');
  }
}
```

#### 5.2 [P0] syncRefreshedTokensToMcp() 토큰 guard 강화

**파일:** `src/agent/token-refresher.ts`

```typescript
async function syncRefreshedTokensToMcp(clientId, clientSecret, tokens): Promise<void> {
  // Guard: 유효한 토큰이 있을 때만 sync
  if (!tokens.accessToken || !tokens.refreshToken) {
    log('Skipping MCP sync: incomplete token set');
    return;
  }
  // ... 기존 sync 로직 (stdio만, HTTP sync 금지)
}
```

#### 5.3 [P0] runHealthCheck()에서 not_configured 시 자동 중지

**파일:** `src/agent/token-refresher.ts`

```typescript
case 'not_configured':
  log('Health check: Google not configured on this device. Stopping refresher.');
  stopTokenRefresher();
  break;
case 'expired':
  // 만료 후 반복 시도 방지
  stopTokenRefresher();
  break;
```

### Phase B: Startup Side-Effect 제거 (전 MCP 서버)

#### 5.4 [P1] syncHttpToClaudeCode() interactive 모드 분리

**파일:** `src/config/claude-code-sync.ts`

**현재:** `spawn(binary, [...], { stdio: 'inherit' })` — 항상 OAuth 팝업 가능

**변경:**
```typescript
export async function syncHttpToClaudeCode(
  serverId: string,
  url: string,
  options: { interactive?: boolean; binary?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  const { interactive = false, binary = 'claude' } = options;
  const stdio = interactive ? 'inherit' : 'pipe';
  // interactive=true: init, addtool (사용자 명시적 명령)
  // interactive=false: daemon, migration, token-refresher (백그라운드)
  // ...
}
```

**호출부 변경:**
- `pilot-ai init`, `pilot-ai addtool`: `{ interactive: true }`
- `migrateToSecureLaunchers()`, `token-refresher`: `{ interactive: false }` (기본값)

#### 5.5 [P1] migrateToSecureLaunchers()에서 등록된 서버만 대상

**파일:** `src/agent/mcp-manager.ts`

**현재:** config.json에 있는 모든 통합 대상으로 migration 시도
**변경:** `mcp-config.json`에 실제 등록된 서버만 대상

```typescript
async function migrateToSecureLaunchers(): Promise<void> {
  const mcpConfig = await loadMcpConfig();
  const registeredServers = Object.keys(mcpConfig.mcpServers);

  for (const serverId of registeredServers) {
    // 이 기기에 등록된 서버만 migration
    await migrateServer(serverId, mcpConfig.mcpServers[serverId]);
  }
}
```

### Phase C: 통합 MCP Health Check 체계

#### 5.6 [P1] 전체 MCP 서버 Credential 검증 (startup)

**파일:** `src/agent/mcp-manager.ts` (신규 함수)

현재 health check는 Google (TokenRefresher)과 GitHub (hourly)에만 존재.
나머지 서버(Notion, Figma, Slack, Jira 등)는 credential이 삭제/만료되어도 알 수 없음.

```typescript
export type McpServerStatus = 'ready' | 'auth_required' | 'not_registered' | 'error';

export async function checkAllMcpServerStatus(): Promise<Record<string, McpServerStatus>> {
  const mcpConfig = await loadMcpConfig();
  const results: Record<string, McpServerStatus> = {};

  for (const [serverId, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
    const entry = MCP_REGISTRY.find(e => e.id === serverId);
    if (!entry) { results[serverId] = 'error'; continue; }

    // Launcher script 기반 서버: Keychain에서 credential 존재 확인
    if (serverConfig.command === 'bash' && serverConfig.args?.[0]?.includes('mcp-launchers')) {
      const secretKeys = getSecretKeysForServer(serverId);
      const allSecretsExist = await Promise.all(
        secretKeys.map(key => getSecret(key).then(v => !!v))
      );
      results[serverId] = allSecretsExist.every(Boolean) ? 'ready' : 'auth_required';
    } else {
      // 직접 env var 전달 서버 (legacy 또는 비밀 없는 서버)
      results[serverId] = 'ready';
    }
  }

  return results;
}
```

**Startup 통합:**
```typescript
// core.ts start() 끝에
const statuses = await checkAllMcpServerStatus();
const statusSummary = Object.entries(statuses)
  .map(([id, status]) => `${id}(${status})`)
  .join(', ');
log(`MCP servers: ${statusSummary || 'none registered'}`);

// auth_required 서버가 있으면 알림
const authRequired = Object.entries(statuses)
  .filter(([_, s]) => s === 'auth_required')
  .map(([id]) => id);
if (authRequired.length > 0) {
  log(`⚠ Auth required for: ${authRequired.join(', ')}. Run "pilot-ai addtool <name>" to re-authenticate.`);
}
```

#### 5.7 [P2] 주기적 MCP 서버 연결 상태 확인

**파일:** `src/agent/mcp-health.ts` (신규)

Google의 TokenRefresher와 GitHub의 hourly check를 **통합된 health check 체계**로 일반화.

```typescript
interface McpHealthChecker {
  serverId: string;
  interval: number;  // ms
  check(): Promise<McpServerStatus>;
}

// 서버 유형별 health check 전략
const healthCheckers: Record<string, () => Promise<McpServerStatus>> = {
  // Google: 토큰 만료 확인 + proactive refresh
  'gmail': async () => { /* checkGoogleTokenHealth() 위임 */ },
  'google-calendar': async () => { /* 동일 */ },
  'google-drive': async () => { /* 동일 */ },

  // GitHub: gh auth status
  'github': async () => { /* execFile('gh', ['auth', 'status']) */ },

  // API Key 기반: Keychain 존재 확인 (키 유효성은 확인 불가)
  'notion': async () => { /* getSecret('notion-api-key') ? 'ready' : 'auth_required' */ },
  'figma': async () => { /* getSecret('figma-api-key') ? 'ready' : 'auth_required' */ },
  // ...
};
```

### Phase D: Credential 보안 강화

#### 5.8 [P1] Claude Code Sync 시 평문 토큰 전달 제거

**파일:** `src/config/claude-code-sync.ts`, `src/agent/mcp-manager.ts`

**현재 흐름 (migrateToSecureLaunchers 적용 후):**
```
installMcpServer()
  → secrets를 Keychain에 저장
  → launcher script 생성 (~/.pilot/mcp-launchers/<id>.sh)
  → claude mcp add-json에 launcher 경로 전달 (secrets 미포함)
```

**문제:** `migrateToSecureLaunchers()` 실행 전에 설치된 서버는 `~/.claude.json`에 평문 env var가 남아있을 수 있음.

**변경:**
```typescript
// migrateToSecureLaunchers() 실행 후, 기존 평문 등록 정리
async function cleanupLegacyPlaintextSync(): Promise<void> {
  const mcpConfig = await loadMcpConfig();
  for (const [serverId, config] of Object.entries(mcpConfig.mcpServers)) {
    // launcher script로 전환된 서버만 대상
    if (config.command === 'bash' && config.args?.[0]?.includes('mcp-launchers')) {
      // Claude Code에 launcher 버전으로 재등록 (기존 평문 덮어쓰기)
      await syncToClaudeCode(serverId, config);
    }
  }
}
```

#### 5.9 [P2] Atlassian (Jira/Confluence) credential 검증 개선

**현재 문제:** Jira/Confluence는 설정 시 credential 유효성을 API 호출로 검증하지 않음. 잘못된 API 토큰이 저장되어도 MCP 서버 시작 시에만 실패.

**변경:**
```typescript
// tools.ts addtool jira/confluence 시
const isValid = await verifyAtlassianCredentials(siteName, email, apiToken);
if (!isValid) {
  console.log('❌ Atlassian API 인증 실패. 자격증명을 확인해주세요.');
  return;
}
```

#### 5.10 [P2] Slack SLACK_TEAM_ID 매핑 오류 수정

**파일:** `src/cli/init.ts`, `src/cli/tools.ts`

**현재:** `SLACK_TEAM_ID`에 App Token(`xapp-...`)이 들어가는 케이스 존재
**변경:** Team ID 입력 시 `T`로 시작하는지 검증, 또는 Slack API로 자동 조회

```typescript
// Slack 설정 시 Team ID 자동 조회
const teamInfo = await fetch('https://slack.com/api/auth.test', {
  headers: { 'Authorization': `Bearer ${botToken}` },
}).then(r => r.json());
const teamId = teamInfo.team_id;  // T로 시작하는 실제 Team ID
```

### Phase E: Multi-Device 안전성

#### 5.11 [P1] config.json 동기화 시 side-effect 방지

**원칙:** `config.json`이 동기화되어도, 이 기기에서 명시적으로 `addtool`을 실행하지 않았다면 어떤 외부 동작도 하지 않는다.

**현재 문제 서버별:**

| config 필드 | startup 동작 | 위험도 |
|------------|-------------|--------|
| `config.google` | TokenRefresher 시작 → OAuth 팝업 | **높음** |
| `config.notion` | 없음 (mcp-config.json 기반) | 안전 |
| `config.figma` | 없음 | 안전 |
| `config.linear` | 없음 | 안전 |
| `config.github` | hourly auth check | **낮음** (팝업 없음) |

**변경:** config.google의 startup 동작을 mcp-config.json 기반으로 전환 (5.1에서 해결).
GitHub hourly check도 동일 패턴 적용:

```typescript
// GitHub도 mcp-config.json 기반으로 전환
if (this.config.github?.enabled) {
  const mcpConfig = await loadMcpConfig();
  if ('github' in mcpConfig.mcpServers) {
    startGithubAuthCheck();
  } else {
    log('GitHub configured but not registered as MCP server on this device.');
  }
}
```

---

## 6. 구현 우선순위

### Phase A: 즉시 해결 — Google OAuth 팝업 차단

| # | 항목 | 파일 | 난이도 |
|---|------|------|--------|
| A1 | `start()`에서 TokenRefresher 조건부 시작 | `core.ts` | 낮음 |
| A2 | `syncRefreshedTokensToMcp()` 토큰 guard 강화 | `token-refresher.ts` | 낮음 |
| A3 | `runHealthCheck()`에서 not_configured 시 자동 중지 | `token-refresher.ts` | 낮음 |

### Phase B: Startup Side-Effect 제거

| # | 항목 | 파일 | 난이도 |
|---|------|------|--------|
| B1 | `syncHttpToClaudeCode()` interactive 모드 분리 | `claude-code-sync.ts` | 중간 |
| B2 | `migrateToSecureLaunchers()` 등록 서버만 대상 | `mcp-manager.ts` | 낮음 |
| B3 | GitHub auth check도 mcp-config.json 기반 전환 | `core.ts` | 낮음 |

### Phase C: 통합 Health Check + 진단

| # | 항목 | 파일 | 난이도 |
|---|------|------|--------|
| C1 | startup 시 전체 MCP credential 검증 | `mcp-manager.ts` | 중간 |
| C2 | startup MCP 상태 요약 로그 + actionable 에러 | `core.ts` | 낮음 |
| C3 | `pilot-ai doctor` 명령 (3-layer 일관성 진단) | `cli/doctor.ts` (신규) | 중간 |
| C4 | 서버 상태에 `connecting` 추가 | `mcp-manager.ts` | 낮음 |
| C5 | 런타임 401/403 reactive 감지 (선택) | `mcp-health.ts` (신규) | 높음 |

### Phase D: Credential 보안

| # | 항목 | 파일 | 난이도 |
|---|------|------|--------|
| D1 | legacy 평문 sync 정리 | `mcp-manager.ts` | 낮음 |
| D2 | Atlassian credential 설정 시 검증 | `tools.ts` | 중간 |
| D3 | Slack SLACK_TEAM_ID 매핑 수정 | `init.ts`, `tools.ts` | 낮음 |
| D4 | launcher script PATH 하드코딩 + 절대경로 npx | `mcp-launcher.ts` | 낮음 |

### Phase E: Multi-Device

| # | 항목 | 파일 | 난이도 |
|---|------|------|--------|
| E1 | config.json sync side-effect 전면 차단 | `core.ts` | 낮음 (A1에서 대부분 해결) |

---

## 7. 영향 범위

| 파일 | 변경 유형 | 관련 Phase |
|------|-----------|------------|
| `src/agent/core.ts` | **수정** | A1, B3, C2, E1 |
| `src/agent/token-refresher.ts` | **수정** | A2, A3 |
| `src/config/claude-code-sync.ts` | **수정** | B1 |
| `src/agent/mcp-manager.ts` | **수정** | B2, C1, C4, D1 |
| `src/agent/mcp-launcher.ts` | **수정** | D4 |
| `src/agent/mcp-health.ts` | **신규** | C5 (선택) |
| `src/cli/doctor.ts` | **신규** | C3 |
| `src/cli/tools.ts` | **수정** | D2, D3 |
| `src/cli/init.ts` | **수정** | B1, D3 |

---

## 8. 타 MCP 클라이언트 아키텍처 비교

### 8.1 비교 매트릭스

| 항목 | **pilot-ai (현재)** | **Claude Code** | **Claude Desktop** | **Cursor** | **Windsurf** | **Continue.dev** |
|------|-------------------|-----------------|--------------------|-----------|--------------|-|
| **Config 위치** | `~/.pilot/config.json` + `mcp-config.json` | `~/.claude.json`, `.mcp.json` | `claude_desktop_config.json` | `.cursor/mcp.json` | `mcp_config.json` | `config.yaml`, `mcp.json` |
| **서버 초기화** | **Eager** (config 존재만으로 전부 시작) | **Eager** (도구는 Tool Search로 lazy) | **Eager** (앱 시작 시 전부) | **Eager** | **Eager** (추정) | 미문서화 |
| **OAuth 지원** | 자체 구현 (환경변수 전달) | 네이티브 (DCR + PKCE) | Connectors UI (DCR 필수) | DCR 기반 | 환경변수/헤더 | IDE credential store |
| **토큰 저장** | Keychain + `~/.claude.json` 평문 복사 | **System Keychain** | 내부 저장소 | 미문서화 | 환경변수 | IDE SecretStorage API |
| **토큰 갱신** | TokenRefresher (1시간 주기) | 자동 | 지원 | 미문서화 | 미문서화 | 미문서화 |
| **멀티디바이스** | config 동기화 시 부작용 발생 (**버그**) | **없음** (`.mcp.json`만 공유) | **없음** | **없음** (프로젝트 config만 공유) | **없음** | Hub 기반 공유 |
| **Auth 미완료 처리** | OAuth 팝업 강제 실행 (**버그**) | `/mcp` 명령으로 수동 인증 | Connectors UI에서 안내 | 불명확 | 미문서화 | 첫 사용 시 브라우저 프롬프트 |
| **Config-Auth 분리** | **미분리** (config = 인증 의도) | **분리** (config ≠ 인증) | **분리** (Connectors = 인증) | **분리** | **분리** | **분리** |

### 8.2 핵심 차이 분석

#### (1) pilot-ai만 겪는 문제: Config Sync = Auth Trigger

모든 주요 MCP 클라이언트는 **config 파일 동기화와 인증 상태를 완전히 분리**한다:

- **Claude Code**: `~/.claude.json`에 MCP 서버를 등록해도, OAuth가 필요한 서버는 `/mcp` 명령으로 **사용자가 명시적으로 인증**해야 동작. 인증 없으면 서버가 목록에는 있되 비활성 상태.
- **Claude Desktop**: Remote MCP 서버는 `claude_desktop_config.json`이 아니라 **Settings > Connectors UI**에서 추가. 설정 파일을 복사해도 인증이 따라오지 않음.
- **Cursor**: `.cursor/mcp.json`을 팀과 공유 가능하지만, OAuth는 각 개발자가 개별 수행.

pilot-ai는 `config.json`에 `google` 객체가 있으면 → TokenRefresher 시작 → sync 시도 → OAuth 팝업. **config 존재 자체가 인증 트리거로 작동하는 유일한 구현체.**

#### (2) 업계 표준: OAuth는 항상 Lazy

| 패턴 | 설명 | 채택 |
|------|------|------|
| 서버 등록: Eager | Config에 있으면 서버 프로세스 시작 시도 | Claude Code, Desktop, Cursor 전부 |
| 도구 로딩: Lazy (선택적) | 도구 수가 많으면 on-demand 검색 | Claude Code (Tool Search) |
| **OAuth: 항상 Lazy** | 인증이 필요한 시점에 사용자에게 프롬프트 | **전원 합의** |

pilot-ai는 OAuth까지 eager로 실행하는 **유일한** 구현체이다.

#### (3) 토큰 저장: Keychain이 업계 표준

| 구현체 | 저장 방식 |
|--------|-----------|
| Claude Code | **System Keychain** (평문 config에 토큰 미저장) |
| Continue.dev | **IDE SecretStorage API** (VS Code, JetBrains) |
| pilot-ai | Keychain에 저장 **+ `~/.claude.json`에 평문 복사** |

pilot-ai는 Keychain 저장 후에도 `syncToClaudeCode()` 과정에서 평문 복사가 발생할 수 있는 이중 구조.
Launcher script 도입으로 개선되었으나, migration 이전 설치분에 잔존 위험.

#### (4) Multi-Device: 어떤 클라이언트도 인증 동기화를 하지 않는다

| 동기화 대상 | 동기화 가능 | 동기화 금지 |
|------------|------------|------------|
| 서버 목록 (어떤 MCP 서버를 쓸 것인가) | `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor) | - |
| OAuth 자격증명 (clientId, clientSecret) | 가능 (프로젝트 설정) | - |
| **인증 토큰 (access/refresh token)** | - | **전원 합의: 기기별 독립** |
| **인증 상태 (authenticated 여부)** | - | **전원 합의: 기기별 독립** |

### 8.3 pilot-ai에 적용할 교훈

| # | 교훈 | 출처 | pilot-ai 적용 |
|---|------|------|--------------|
| 1 | **OAuth는 반드시 사용자 명시적 액션에서만** | Claude Code (`/mcp`), Claude Desktop (Connectors UI) | `start()`에서 OAuth 트리거 제거. `init`/`addtool`/`auth`에서만 허용 |
| 2 | **Config ≠ Auth State** | 전체 | config 존재 ≠ 인증 의도. `mcp-config.json` 등록 + Keychain 토큰이 true source |
| 3 | **토큰은 Keychain Only** | Claude Code, Continue.dev | 평문 토큰 잔존 정리. Launcher script 체계 일관 적용 |
| 4 | **Multi-device = Config만 공유** | 전체 (어떤 클라이언트도 토큰 sync 안 함) | config sync 시 인증 side-effect 없도록 guard |
| 5 | **Auth 미완료는 정상 상태** | Claude Code (목록에 있되 비활성), Cursor | "등록됐지만 인증 안 됨"을 에러 아닌 정상으로 처리 |
| 6 | **Health check는 passive** | Claude Code (서버 상태 UI), Zed (green dot) | 상태 확인은 하되 자동 복구로 side-effect 유발하지 않음 |

---

## 9. 외부 검증 결과

10개 설계 결정에 대해 웹 조사 기반으로 업계 표준 대비 검증을 수행했다.

### 9.1 검증 요약

| # | 설계 결정 | 검증 결과 | 보완 필요 |
|---|-----------|-----------|-----------|
| 1 | Lazy OAuth init (토큰 없으면 시작 안 함) | **정확** | daemon을 중앙 토큰 매니저로 활용 검토 |
| 2 | 3-Layer 분리 (config / mcp-config / Keychain) | **정확** | `pilot-ai doctor` 명령으로 레이어 간 일관성 검증 추가 |
| 3 | auth_required를 정상 상태로 처리 | **대체로 정확** | 로그만으론 부족, CLI 출력에서 상태 표시 + 조작 시 actionable 에러 필요 |
| 4 | Keychain-backed launcher script | **현실적으로 최선** | env var 노출 위험 인지하되, 현재 대안 없음 |
| 5 | 평문 토큰 이중 저장 제거 | **정확** | Claude Code가 Keychain 네이티브 지원 안 함 → launcher script가 유일한 대안 |
| 6 | Per-device 인증 (토큰 sync 금지) | **강하게 정확** | RFC 9700이 명시적으로 device binding 권장 |
| 7 | 통합 health check (credential 존재 확인) | **부분적** | credential 존재만으론 불충분, 실제 서버 ping 필요 |
| 8 | Google만 active refresh, 나머지 passive | **갭 있음** | API key 서버도 주기적 검증 또는 런타임 401/403 감지 필요 |
| 9 | 서버 상태: ready/auth_required/not_registered/error | **부분적** | `connecting` 상태 누락, `disabled` 상태 검토 필요 |
| 10 | Interactive vs daemon 모드 분리 | **완전 정확** | 업계 전원 합의, daemon에서 사용자 상호작용은 안티패턴 |

### 9.2 주요 보완 사항 (PRD 반영)

#### 보완 1: Daemon을 중앙 토큰 매니저로 활용

**출처:** Claude Code OAuth race condition issues ([#24317](https://github.com/anthropics/claude-code/issues/24317), [#25609](https://github.com/anthropics/claude-code/issues/25609), [#27933](https://github.com/anthropics/claude-code/issues/27933))

여러 Claude Code 세션이 동시에 single-use refresh token을 사용하면 race condition 발생 (주 3회 인증 소실 보고). pilot-ai daemon이 이미 TokenRefresher를 운영하므로, **모든 토큰 refresh를 daemon 경유로 단일화**하면 이 문제를 근본적으로 해결 가능.

```
[Claude Code Session 1] ──┐
[Claude Code Session 2] ──┤──→ pilot-ai daemon (mutex) ──→ Google OAuth Server
[Claude Code Session 3] ──┘         └─ file lock on refresh
```

**적용:** Phase C 확장 — TokenRefresher에 file lock 또는 Unix socket IPC 도입 검토 (P2)

#### 보완 2: `pilot-ai doctor` 명령 추가

**출처:** chezmoi의 `chezmoi doctor`, Homebrew의 `brew doctor` 패턴

3-Layer 구조에서 레이어 간 불일치 진단:
```bash
$ pilot-ai doctor
✓ config.json: google, notion, figma, slack configured
✓ mcp-config.json: gmail, notion, figma, slack registered
✗ Keychain: figma-api-key MISSING
✓ Keychain: notion-api-key OK
✓ Keychain: slack-bot-token OK
✗ Google tokens: expired (run "pilot-ai auth google")
✓ Claude Code sync: 4/4 servers synced

Recommendations:
  - Run "pilot-ai addtool figma" to re-authenticate Figma
  - Run "pilot-ai auth google" to refresh Google tokens
```

**적용:** Phase C에 신규 항목 추가 (P1)

#### 보완 3: auth_required 시 actionable 에러

**출처:** AWS CLI 패턴 (expired credentials → 명확한 에러 메시지 + 해결 명령어), Circuit Breaker 패턴

로그 경고만으로는 부족. 사용자가 해당 서버의 도구를 사용하려 할 때 **actionable 에러**를 반환:

```
⚠ Figma MCP server requires authentication.
  Run: pilot-ai addtool figma
```

**적용:** Phase C의 5.6에 통합 — startup 상태 로그 + 런타임 사용 시 에러 메시지

#### 보완 4: 서버 상태에 `connecting` 추가

**출처:** MCP Lifecycle Spec (Initialization → Operation → Shutdown), Cloudflare MCP OAuth 구현

현재 상태 모델에 `connecting`(초기화 중) 추가:

```typescript
export type McpServerStatus =
  | 'ready'           // 인증 완료, 사용 가능
  | 'connecting'      // 서버 시작/초기화 중
  | 'auth_required'   // 인증 필요
  | 'not_registered'  // mcp-config.json에 미등록
  | 'error';          // 시작 실패 또는 런타임 에러
```

**적용:** 5.6의 McpServerStatus 타입 업데이트

#### 보완 5: 런타임 401/403 감지 (Reactive Health)

**출처:** Notion MCP Server issue [#225](https://github.com/makenotion/notion-mcp-server/issues/225) (토큰 만료로 주 3회 재인증), API key management best practices

API key 기반 서버(Notion, Figma, Slack 등)의 credential이 런타임에 무효화되는 경우 감지:

**방안 A: 주기적 lightweight API call (P2)**
```typescript
// 30분마다 cheap API call로 키 유효성 검증
'notion': async () => {
  const res = await fetch('https://api.notion.com/v1/users/me', {
    headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
  });
  return res.ok ? 'ready' : 'auth_required';
}
```

**방안 B: Reactive 감지 (P1, 권장)**
- MCP 서버 프로세스의 stderr/stdout 모니터링
- 401/403 에러 패턴 감지 시 상태를 `auth_required`로 전환
- 사용자에게 알림 (Slack/Telegram 또는 다음 상호작용 시 표시)

**적용:** Phase C에 신규 항목 추가

#### 보완 6: Launcher Script 보안 강화

**출처:** Trail of Bits MCP 보안 감사, Apple Shell Script Security 문서, `ps -E`로 환경변수 노출 가능

현재 launcher script의 알려진 위험:
- `ps -E`로 실행 중인 프로세스의 환경변수 조회 가능 (같은 시스템의 다른 사용자)
- `exec npx`에 PATH가 하드코딩되지 않아 PATH 조작 공격 가능

**개선:**
```bash
#!/bin/bash
# 1. PATH 하드코딩
export PATH="/usr/local/bin:/usr/bin:/bin"

# 2. Keychain에서 읽기 (기존과 동일)
export API_KEY=$(security find-generic-password -s "pilot-ai:mcp-notion-api-key" -a "pilot-ai" -w 2>/dev/null)

# 3. 절대 경로로 npx 실행
exec /usr/local/bin/npx -y "@notionhq/notion-mcp-server"
```

**적용:** Phase D에 추가 (P2) — `mcp-launcher.ts`의 script 생성 로직 수정

### 9.3 검증에서 발견된 추가 위험

| 위험 | 출처 | 심각도 | 대응 |
|------|------|--------|------|
| Config sync 시 악성 MCP 서버 URL 주입 | 보안 조사 | 중간 | config integrity check 또는 allowlist 검토 (Phase E) |
| Claude Code Keychain 권한 에러 | [#19456](https://github.com/anthropics/claude-code/issues/19456) | 낮음 | HTTP MCP 서버의 Claude Code 네이티브 OAuth 사용 시 인지 |
| Keychain 항목 생성 시 ACL 설정 | Apple 문서 | 낮음 | `-T` 플래그로 접근 허용 범위 제한 검토 |
| Claude Code sandbox(bwrap)가 외부 credential manager 차단 | [#23642](https://github.com/anthropics/claude-code/issues/23642) | 낮음 | 현재 Keychain 직접 사용으로 영향 없음 |

---

## 10. 참고 자료

### Best Practices 출처

| 주제 | 핵심 원칙 | 출처 |
|------|-----------|------|
| OAuth Token 관리 | Short-lived access token + per-device refresh token, 기기 간 토큰 동기화 금지 | [Auth0 Token Best Practices](https://auth0.com/docs/secure/tokens/token-best-practices), [RFC 9700](https://datatracker.ietf.org/doc/rfc9700/) |
| Refresh Token Rotation | 사용 시마다 새 토큰 발급, reuse detection으로 탈취 감지 | [Auth0 Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) |
| Credential Sync | 설정만 동기화, 인증 상태는 기기별 독립 | [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b/syncable/) |
| Lazy Initialization | 인증 흐름을 실제 사용 시점까지 지연, startup에서 외부 의존성 제거 | [Microsoft Daemon Resilience](https://learn.microsoft.com/en-us/entra/architecture/resilience-daemon-app) |
| MCP Lifecycle | Initialization → Operation → Shutdown 3단계, 시작 시 capability negotiation 필수 | [MCP Lifecycle Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) |
| MCP Server 보안 | Keychain 저장, 평문 credential 파일 금지 | [Trail of Bits MCP Audit](https://blog.trailofbits.com/2025/04/30/insecure-credential-storage-plagues-mcp/), [MITRE ATT&CK T1552.001](https://attack.mitre.org/techniques/T1552/001/) |
| MCP Health Check | ping mechanism + startup/readiness/liveness 분리 | [MCP Ping Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/ping), [MCPcat Health Check Guide](https://mcpcat.io/guides/implementing-connection-health-checks/) |
| Graceful Degradation | 의존성 미가용 시 crash 대신 degraded 응답 | [Azure Circuit Breaker](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker), [Mercari Production Readiness](https://github.com/mercari/production-readiness-checklist/) |
| Shell Script 보안 | PATH 하드코딩, Keychain ACL, env var 노출 위험 인지 | [Apple Shell Script Security](https://developer.apple.com/library/archive/documentation/OpenSource/Conceptual/ShellScripting/ShellScriptSecurity/ShellScriptSecurity.html) |
| OAuth Race Condition | 동시 refresh token 사용 시 인증 소실, 중앙 토큰 매니저 필요 | Claude Code [#24317](https://github.com/anthropics/claude-code/issues/24317), [#25609](https://github.com/anthropics/claude-code/issues/25609) |

### 내부 관련 문서

- `docs/phase7-google-oauth-fix/PRD.md` — Google OAuth 400 에러 수정
- `docs/phase8-figma-google-oauth-fix/PRD.md` — Figma OAuth 팝업 이슈
- `docs/phase12-google-mcp-integration-fix/PRD.md` — Gmail MCP 통합 연동 실패

---

## 10. 검증 시나리오

### 시나리오 1: Google 미등록 기기에서 시작
- **조건**: `config.google` 있음, Keychain 토큰 없음, `mcp-config.json`에 Google MCP 없음
- **기대**: OAuth 팝업 없음, "Google OAuth configured but not active on this device" 로그
- **검증**: `pilot-ai start` 후 브라우저 열리지 않음 확인

### 시나리오 2: Google 등록 기기에서 토큰 만료
- **조건**: `config.google` 있음, Keychain 토큰 만료, `mcp-config.json`에 gmail 등록됨
- **기대**: refresh 시도 → 실패 시 알림 전송, OAuth 팝업 없음, TokenRefresher 자동 중지
- **검증**: Slack에 "⚠️ Google OAuth token expired" 메시지 수신

### 시나리오 3: 정상 동작 기기
- **조건**: `config.google` 있음, 유효한 토큰 있음, `mcp-config.json`에 gmail 등록됨
- **기대**: TokenRefresher 정상 시작, 1시간 주기 health check
- **검증**: 로그에 "Health check: tokens OK" 출력

### 시나리오 4: addtool로 새 서비스 추가
- **조건**: 기존에 미등록, 사용자가 `pilot-ai addtool gmail` 실행
- **기대**: interactive OAuth 팝업 정상 표시, 토큰 발급, MCP 등록
- **검증**: `claude mcp get gmail`로 등록 확인

### 시나리오 5: Notion API 키 Keychain에서 삭제됨
- **조건**: Notion MCP 등록됨, Keychain에서 `notion-api-key` 수동 삭제
- **기대**: startup 시 "notion(auth_required)" 상태 로그, 자동 인증 시도 없음
- **검증**: `pilot-ai start` 후 로그에 auth_required 표시, 팝업/에러 없음

### 시나리오 6: Slack TEAM_ID 잘못 설정
- **조건**: `SLACK_TEAM_ID`에 App Token이 들어감
- **기대**: addtool 시 Team ID 형식 검증 또는 API로 자동 조회
- **검증**: `T`로 시작하지 않는 값 입력 시 경고

### 시나리오 7: config.json만 동기화된 새 기기
- **조건**: config.json에 google, notion, figma, slack 전부 설정됨, mcp-config.json 없음
- **기대**: 모든 MCP 서버 미등록 상태, 어떤 인증 시도도 없음, startup 정상
- **검증**: "No MCP servers registered" 로그, 정상 동작
