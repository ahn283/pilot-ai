# Phase 12: Google MCP 서버 통합 연동 실패 근본 해결 PRD

## 1. 문제 상황

`pilot-ai init`에서 Google OAuth Client ID/Secret을 입력하고, OAuth 인증까지 성공적으로 완료했지만, **Claude Code에서 Gmail MCP 서버 도구가 사용 불가능**한 상태.

- `~/.claude.json`에 gmail MCP 서버가 등록되어 있음 (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN 환경변수 포함)
- `~/.pilot/mcp-config.json`에도 동일하게 등록됨
- 하지만 Claude Code에서 `mcp__gmail__*` 도구가 available-deferred-tools에 나타나지 않음
- Google Calendar, Google Drive MCP 도구는 정상 작동 중

---

## 2. 근본 원인 분석 (Line-by-Line)

### 2.1 [P0] `@shinzolabs/gmail-mcp` 인증 메커니즘 불일치 — 핵심 원인

**패키지의 인증 모드 2가지:**

| 모드 | 작동 방식 | pilot-ai 지원 |
|------|-----------|--------------|
| **파일 기반 (로컬)** | `~/.gmail-mcp/gcp-oauth.keys.json` + `npx @shinzolabs/gmail-mcp auth` 실행 → `~/.gmail-mcp/credentials.json` 생성 | **미지원** |
| **환경변수 기반 (리모트)** | `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN` 환경변수 전달 | pilot-ai가 사용하는 모드 |

**현재 상태 확인:**

```
~/.gmail-mcp/
├── (비어있음 — gcp-oauth.keys.json 없음)
└── (비어있음 — credentials.json 없음)
```

**문제:** `@shinzolabs/gmail-mcp` 패키지가 환경변수 모드로 실행될 때, 내부적으로 `~/.gmail-mcp/credentials.json` 파일 존재 여부를 먼저 체크하고, 없으면 파일 기반 인증을 시도할 가능성이 높음. 환경변수만으로는 서버가 정상 시작되지 않거나, 시작 후 토큰 갱신에 실패할 수 있음.

**코드 추적:**

- `src/cli/init.ts:466-471` — Gmail MCP 등록 시 환경변수만 전달:
  ```typescript
  // init.ts:466-471
  if ((googleServices as string[]).includes('gmail') && tokens?.refreshToken) {
    await registerMcpTool('gmail', {
      CLIENT_ID: trimmedClientId,
      CLIENT_SECRET: trimmedClientSecret,
      REFRESH_TOKEN: tokens.refreshToken,
    });
  }
  ```
- `~/.gmail-mcp/gcp-oauth.keys.json` 파일은 **생성하지 않음**
- `npx @shinzolabs/gmail-mcp auth` 명령은 **실행하지 않음**
- `~/.gmail-mcp/credentials.json` 파일도 **생성하지 않음**

### 2.2 [P0] MCP 서버 시작 실패 무시 (Silent Failure)

**파일:** `src/config/claude-code-sync.ts:31-66`

```typescript
// claude-code-sync.ts:56-60
await execFileAsync(binary, [
  'mcp', 'add-json', '-s', 'user',
  serverId,
  JSON.stringify(jsonConfig),
], { timeout: TIMEOUT_MS });
```

Claude Code에 MCP 서버를 등록(`claude mcp add-json`)하면, 등록 자체는 성공하지만 **서버가 실제로 시작 가능한지 검증하지 않음**. 서버가 시작에 실패해도:

1. `installMcpServer()` → `{ success: true }` 반환
2. 사용자에게 "configured (MCP server registered)" 출력
3. 실제로 Claude Code가 서버 프로세스를 spawn할 때 실패 → **도구 목록에 안 나타남**

### 2.3 [P0] Google OAuth Testing 모드 refresh_token 7일 만료

**Google Cloud Console에서 OAuth 앱이 "Testing" 상태일 때:**
- Refresh token이 **7일 후 자동 만료**
- 만료 후 `invalid_grant` 에러 발생
- pilot-ai init 시점에 발급받은 refresh token이 7일 후 무효화

**현재 코드의 대응:**
- `src/tools/google-auth.ts:309-313` — `invalid_grant` 감지 시 토큰 삭제 + 재인증 안내
- 하지만 이는 pilot-ai 자체 OAuth 흐름에만 적용됨
- **MCP 서버에 전달된 환경변수의 REFRESH_TOKEN은 업데이트되지 않음**
- `~/.claude.json`과 `~/.pilot/mcp-config.json`에 하드코딩된 REFRESH_TOKEN은 만료 후 영구적으로 무효

### 2.4 [P1] 3개 Google MCP 패키지의 인증 방식 파편화

| MCP 패키지 | 인증 방식 | 토큰 저장 | pilot-ai 연동 |
|-----------|-----------|----------|--------------|
| `@shinzolabs/gmail-mcp` | 환경변수 OR `~/.gmail-mcp/` 파일 | 환경변수 / 파일 | 환경변수만 전달, 파일 미생성 |
| `@cocal/google-calendar-mcp` | `gcp-oauth.keys.json` 파일 경로 | 자체 토큰 파일 | `~/.pilot/credentials/gcp-oauth.keys.json` 경로 전달 |
| `@piotr-agier/google-drive-mcp` | `gcp-oauth.keys.json` 파일 경로 | 자체 토큰 파일 | `~/.pilot/credentials/gcp-oauth.keys.json` 경로 전달 |

**문제:**
- Calendar/Drive는 `gcp-oauth.keys.json` 파일을 받아서 **자체 OAuth 플로우**를 실행 (자체 refresh token 발급/관리)
- Gmail은 pilot-ai가 발급한 refresh token을 **정적 환경변수로 전달** → 갱신 불가
- 3개 패키지의 인증 라이프사이클이 완전히 다름

### 2.5 [P1] Slack MCP 환경변수 매핑 오류

**파일:** `~/.pilot/mcp-config.json:34-44`

```json
"slack": {
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_TEAM_ID": "xapp-1-A0ACLFP1QSZ-..."  // ← 이것은 APP TOKEN!
  }
}
```

`SLACK_TEAM_ID`에 App Token(`xapp-...`)이 들어가 있음. Team ID는 `T`로 시작하는 워크스페이스 식별자여야 함. 이 오류로 Slack MCP도 정상 작동하지 않을 수 있음.

### 2.6 [P2] `~/.claude.json`에 시크릿 평문 노출

**파일:** `~/.claude.json:233-303`

MCP 서버 환경변수에 OAuth 토큰, API 키 등이 **평문으로 저장**됨:
- Gmail: CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN
- Figma: FIGMA_API_KEY
- Notion: Bearer token
- Slack: Bot Token

`~/.pilot/config.json`은 `***keychain***` 플레이스홀더로 시크릿을 Keychain에 저장하지만, Claude Code의 `~/.claude.json`에는 그대로 평문 기록. git에 커밋되거나 백업에 포함될 위험.

---

## 3. 해결 방안

### 3.1 [P0] Gmail MCP 패키지 변경 또는 파일 기반 인증 추가

**Option A: `@shinzolabs/gmail-mcp` 파일 기반 모드 지원 (권장)**

```typescript
// init.ts — Gmail MCP 등록 시 ~/.gmail-mcp/ 파일도 생성
if ((googleServices as string[]).includes('gmail') && tokens?.refreshToken) {
  // 1. ~/.gmail-mcp/gcp-oauth.keys.json 생성
  const gmailMcpDir = path.join(os.homedir(), '.gmail-mcp');
  await fs.mkdir(gmailMcpDir, { recursive: true });
  await fs.writeFile(
    path.join(gmailMcpDir, 'gcp-oauth.keys.json'),
    JSON.stringify({
      installed: {
        client_id: trimmedClientId,
        client_secret: trimmedClientSecret,
        redirect_uris: ['http://127.0.0.1'],
      },
    }),
    'utf-8',
  );

  // 2. ~/.gmail-mcp/credentials.json 생성 (refresh token 포함)
  await fs.writeFile(
    path.join(gmailMcpDir, 'credentials.json'),
    JSON.stringify({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: 'Bearer',
      expiry_date: tokens.expiresAt,
    }),
    'utf-8',
  );

  // 3. 환경변수도 함께 전달 (dual support)
  await registerMcpTool('gmail', {
    CLIENT_ID: trimmedClientId,
    CLIENT_SECRET: trimmedClientSecret,
    REFRESH_TOKEN: tokens.refreshToken,
  });
}
```

**Option B: `@gongrzhe/server-gmail-autoauth-mcp`로 패키지 변경**

이 패키지는:
- `~/.gmail-mcp/gcp-oauth.keys.json`만 있으면 **자동 인증** 지원
- 별도 환경변수 불필요
- Calendar/Drive와 동일한 파일 기반 패턴

```typescript
// mcp-registry.ts — Gmail 패키지 변경
{
  id: 'gmail',
  name: 'Gmail',
  npmPackage: '@gongrzhe/server-gmail-autoauth-mcp',
  envVars: {},  // 환경변수 불필요
  // ...
}
```

**Option C: 하이브리드 (A + 헬스체크)**

파일 기반 인증 설정 후, 실제로 MCP 서버가 시작 가능한지 검증:

```typescript
// mcp-manager.ts — 등록 후 헬스체크
async function verifyMcpServerHealth(serverId: string): Promise<boolean> {
  try {
    const result = await execFileAsync('npx', ['-y', entry.npmPackage, '--version'], {
      timeout: 15_000,
      env: { ...process.env, ...envValues },
    });
    return true;
  } catch {
    return false;
  }
}
```

### 3.2 [P0] MCP 서버 등록 후 시작 검증

**파일:** `src/agent/mcp-manager.ts`

```typescript
// installMcpServer() 마지막에 추가
export async function installMcpServer(...): Promise<{ success: boolean; error?: string }> {
  // ... 기존 등록 로직 ...

  // Claude Code에서 실제 서버 시작 가능 여부 확인
  const isHealthy = await verifyMcpServerStartup(serverId, entry, envValues);
  if (!isHealthy) {
    console.log(`  ⚠ Warning: ${entry.name} MCP server registered but may not start correctly.`);
    console.log(`  Run "claude mcp get ${serverId}" to check status.`);
  }

  return { success: true };
}
```

### 3.3 [P0] Refresh Token 자동 갱신 메커니즘

**문제:** 환경변수에 하드코딩된 REFRESH_TOKEN은 만료 시 갱신 불가

**해결:**

```typescript
// 새 파일: src/agent/token-refresher.ts
export async function refreshGmailMcpToken(): Promise<void> {
  const tokens = await loadGoogleTokens();
  if (!tokens?.refreshToken) return;

  // 1. pilot-ai Keychain의 최신 refresh token 가져오기
  const latestRefreshToken = tokens.refreshToken;

  // 2. mcp-config.json 업데이트
  const config = await loadMcpConfig();
  if (config.mcpServers['gmail']?.env) {
    config.mcpServers['gmail'].env.REFRESH_TOKEN = latestRefreshToken;
    await saveMcpConfig(config);
  }

  // 3. Claude Code에 재등록
  await syncToClaudeCode('gmail', config.mcpServers['gmail']);

  // 4. ~/.gmail-mcp/credentials.json도 업데이트
  await updateGmailMcpCredentials(tokens);
}
```

`pilot-ai start` 시 주기적으로 (예: 1시간마다) 토큰 유효성 검사 + 갱신.

### 3.4 [P1] Google MCP 서버 인증 통합 아키텍처

현재 3개 패키지가 각각 다른 인증 방식을 사용하는 것을 통합:

```
┌─────────────────────────────────────────────────────┐
│                pilot-ai init                         │
│                                                      │
│  Google OAuth Flow (한 번만 실행)                      │
│  └→ access_token, refresh_token 발급                  │
│                                                      │
│  ┌──────────────────────┐                            │
│  │ Token Distribution   │                            │
│  │                      │                            │
│  │ Gmail:               │                            │
│  │  ├─ ENV vars         │  ← 현재 (불안정)            │
│  │  ├─ ~/.gmail-mcp/    │  ← 추가 필요               │
│  │  │   ├─ gcp-oauth.keys.json                       │
│  │  │   └─ credentials.json                          │
│  │  └─ Keychain         │  ← 갱신 소스               │
│  │                      │                            │
│  │ Calendar:            │                            │
│  │  └─ gcp-oauth.keys.json → 자체 OAuth 플로우       │
│  │                      │                            │
│  │ Drive:               │                            │
│  │  └─ gcp-oauth.keys.json → 자체 OAuth 플로우       │
│  └──────────────────────┘                            │
└─────────────────────────────────────────────────────┘
```

### 3.5 [P1] `pilot-ai auth google` 명령 개선

```typescript
// auth.ts — re-auth 시 MCP 서버 토큰도 함께 갱신
export async function runAuthGoogle(): Promise<void> {
  // 1. OAuth 플로우 실행 → 새 토큰 발급
  // 2. Keychain 업데이트
  // 3. ~/.gmail-mcp/credentials.json 업데이트
  // 4. ~/.pilot/credentials/gcp-oauth.keys.json 업데이트
  // 5. mcp-config.json의 REFRESH_TOKEN 업데이트
  // 6. Claude Code에 재등록 (claude mcp add-json)
  // 7. 헬스체크
}
```

### 3.6 [P1] Slack MCP 환경변수 수정

**파일:** `src/cli/init.ts` — Slack MCP 등록 시

```typescript
// 현재: SLACK_TEAM_ID에 App Token을 잘못 전달
// 수정: SLACK_TEAM_ID를 별도로 입력받기
const { slackTeamId } = await inquirer.prompt([{
  type: 'input',
  name: 'slackTeamId',
  message: 'Slack Workspace/Team ID (T로 시작):',
  validate: (input: string) => input.startsWith('T') || 'Team ID는 T로 시작합니다.',
}]);

await registerMcpTool('slack', {
  SLACK_BOT_TOKEN: answers.botToken,
  SLACK_TEAM_ID: slackTeamId,
});
```

### 3.7 [P2] 시크릿 보안 강화

Claude Code `~/.claude.json`에 평문 시크릿 저장 방지:

**Option A:** Claude Code가 Keychain을 지원하지 않으므로, 시크릿을 별도 파일에 저장하고 MCP 서버 실행 시 파일에서 읽도록 wrapper script 사용
**Option B:** MCP 서버 설정에서 env vars 대신 `.env` 파일 경로를 참조

---

## 4. 구현 우선순위

| 우선순위 | 항목 | 영향도 | 난이도 |
|---------|------|--------|--------|
| **P0** | Gmail MCP `~/.gmail-mcp/` 파일 생성 (gcp-oauth.keys.json + credentials.json) | Gmail 즉시 작동 | 낮음 |
| **P0** | MCP 서버 등록 후 시작 검증 (헬스체크) | 등록 실패 조기 감지 | 중간 |
| **P0** | Testing 모드 refresh_token 7일 만료 경고 및 대응 | 토큰 만료 방지 | 낮음 |
| **P1** | `pilot-ai auth google` 시 MCP 토큰 동기화 | 재인증 후 MCP 자동 갱신 | 중간 |
| **P1** | Gmail MCP 패키지를 `@gongrzhe/server-gmail-autoauth-mcp`로 변경 검토 | 근본적 안정성 향상 | 중간 |
| **P1** | Slack MCP SLACK_TEAM_ID 매핑 오류 수정 | Slack MCP 정상화 | 낮음 |
| **P1** | Google MCP 통합 토큰 관리 아키텍처 | 장기 안정성 | 높음 |
| **P2** | `~/.claude.json` 시크릿 평문 노출 방지 | 보안 강화 | 높음 |
| **P2** | `pilot-ai start` 시 주기적 토큰 헬스체크 | 자동 복구 | 중간 |

---

## 5. 영향 범위

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/cli/init.ts` | **수정** | Gmail MCP 파일 생성, Slack 환경변수 수정 |
| `src/cli/auth.ts` | **수정** | 재인증 시 MCP 토큰 동기화 |
| `src/agent/mcp-manager.ts` | **수정** | MCP 서버 헬스체크 추가 |
| `src/tools/mcp-registry.ts` | **수정** | Gmail 패키지 변경 시 |
| `src/agent/token-refresher.ts` | **신규** | 주기적 토큰 갱신 모듈 |
| `src/config/claude-code-sync.ts` | **수정** | 토큰 업데이트 시 재등록 |

---

## 6. 즉시 해결 가이드 (코드 수정 전)

### Step 1: `~/.gmail-mcp/` 디렉토리에 인증 파일 수동 생성

```bash
mkdir -p ~/.gmail-mcp
```

`~/.gmail-mcp/gcp-oauth.keys.json` 생성:
```json
{
  "installed": {
    "client_id": "<YOUR_CLIENT_ID>.apps.googleusercontent.com",
    "client_secret": "GOCSPX-<YOUR_SECRET>",
    "redirect_uris": ["http://127.0.0.1"]
  }
}
```

### Step 2: Gmail MCP 자체 인증 실행

```bash
npx @shinzolabs/gmail-mcp auth
```

브라우저에서 Google 로그인 → 권한 승인 → `~/.gmail-mcp/credentials.json` 자동 생성

### Step 3: Claude Code 재시작

```bash
# Claude Code에서
/mcp
# 또는 Claude Code 앱 재시작
```

### Step 4: Google OAuth 앱 게시 (선택사항)

Testing 모드의 7일 refresh token 만료를 피하려면:
1. Google Cloud Console → OAuth consent screen
2. "PUBLISH APP" 클릭 (내부 사용이면 "Internal"로 변경)
3. 또는 7일마다 `pilot-ai auth google` 재실행

---

## 7. 참고 자료

- [@shinzolabs/gmail-mcp npm](https://www.npmjs.com/package/@shinzolabs/gmail-mcp) — 공식 패키지
- [@shinzolabs/gmail-mcp GitHub](https://github.com/shinzo-labs/gmail-mcp) — 소스 코드 및 설정 가이드
- [@gongrzhe/server-gmail-autoauth-mcp GitHub](https://github.com/GongRzhe/Gmail-MCP-Server) — 자동 인증 대안 패키지
- [Claude Code MCP 설정 가이드](https://code.claude.com/docs/en/mcp) — 공식 문서
- [Gmail OAuth Hang Issue #30166](https://github.com/anthropics/claude-code/issues/30166) — Claude Code Gmail OAuth 이슈
- [MCP OAuth Reconnection Issue #10250](https://github.com/anthropics/claude-code/issues/10250) — 인증 후 재연결 실패
- [MCP Token Expiry Issue #26281](https://github.com/anthropics/claude-code/issues/26281) — 토큰 만료 무시 이슈
- [MCP Scopes Issue #7744](https://github.com/anthropics/claude-code/issues/7744) — offline_access 스코프 누락
- [Gmail MCP Codefinity 가이드](https://codefinity.com/courses/v2/f8077647-b97c-44c3-83d8-6832f9c79c57/637b583a-a2bb-4287-aceb-c952b3d3e98b/81db8c9a-e6c9-4c7c-91be-d3d7a827af23) — 설치/구성 튜토리얼
- [MCP Authentication Guide 2026](https://www.truefoundry.com/blog/mcp-authentication-in-claude-code) — MCP 인증 베스트 프랙티스
