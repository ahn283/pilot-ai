# Phase 8: Figma 공식 OAuth MCP 인증 + Google OAuth 안정화 + Init Hang 해결 PRD

## 1. 배경 및 핵심 문제

### 상황

- Figma는 공식 Remote MCP 서버(`https://mcp.figma.com/mcp`)를 제공하며, **OAuth 인증**만 지원
- 현재 코드에서 `init.ts`의 figma case가 아무것도 하지 않음 — 브라우저도 안 열리고 토큰도 수집 안 함
- `claude-code-sync.ts`에서 `execFileAsync`로 `claude mcp add`를 실행하여 OAuth 프롬프트가 사용자에게 보이지 않음
- Google OAuth는 동작하나 **init 후 프로세스가 종료되지 않는 hang 버그** 존재
- Google OAuth 토큰 검증 부재로 잘못된 토큰이 저장될 수 있음

### Figma Remote MCP OAuth 동작 방식

[Figma 공식 문서](https://help.figma.com/hc/en-us/articles/35281350665623-Figma-MCP-collection-How-to-set-up-the-Figma-remote-MCP-server) 및 [Claude Code MCP 문서](https://code.claude.com/docs/en/mcp) 확인:

1. **등록**: `claude mcp add --transport http -s user figma https://mcp.figma.com/mcp`
2. **인증**: Claude Code 인터렉티브 세션에서 `/mcp` → figma 서버 선택 → 브라우저에서 Figma OAuth 완료
3. 이후 Claude Code가 자동으로 토큰을 관리하며, MCP 도구 사용 가능

> **중요**: `claude mcp add` 명령 자체가 dynamic client registration을 지원하는 서버에 대해 OAuth를 트리거할 수 있으나, 현재 코드가 `execFileAsync`(stdout 캡처)를 사용하므로 브라우저 프롬프트가 보이지 않음. `spawn({ stdio: 'inherit' })`로 변경하면 사용자가 직접 OAuth 프롬프트를 볼 수 있음.

> **pilot-ai 제약**: pilot-ai는 `claude -p` (비인터렉티브 모드)를 사용하므로, `/mcp` 인증은 별도의 Claude Code 인터렉티브 세션에서 수행해야 함. 따라서 init에서는 등록만 하고, OAuth 인증 가이드를 출력.

---

## 2. 코드 라인별 근본 원인 분석

### 2.1 Figma: init에서 아무것도 안 함 (P0)

#### 원인 A: init.ts figma case가 비어있음

**파일:** `src/cli/init.ts:462-468`

```typescript
case 'figma': {
  console.log('\n  Figma uses the official remote MCP server (OAuth).');
  console.log('  A browser window will open for Figma authentication.');  // 거짓 — 브라우저 안 열림
  console.log('  Please complete the OAuth flow in your browser.\n');
  console.log('  Registering Figma MCP server...');
  // HTTP transport — no env vars needed, OAuth handled by Figma remote server
  break;  // envValues = {} 상태로 빠져나감 → 등록은 되지만 OAuth 인증 안 됨
}
```

**문제:** 사용자에게 "브라우저가 열린다"고 안내하지만 실제로는 아무 일도 일어나지 않음. `envValues`가 비어있어 등록 후에도 인증 미완료.

#### 원인 B: syncHttpToClaudeCode가 execFileAsync 사용

**파일:** `src/config/claude-code-sync.ts:141-147`

```typescript
await execFileAsync('claude', [
  'mcp', 'add', '--transport', 'http', '-s', 'user', serverId, url,
], { timeout: httpTimeoutMs });
```

**문제:** `execFileAsync`는 stdout/stderr를 캡처하므로, `claude mcp add`가 OAuth를 트리거해도 브라우저 오픈 프롬프트가 사용자에게 **보이지 않음**. `spawn({ stdio: 'inherit' })`로 변경 필요.

#### 원인 C: registerFigmaMcp()가 죽은 코드

**파일:** `src/tools/figma-mcp.ts:42-55`, `src/cli/init.ts:10`

`init.ts:10`에서 `import { registerFigmaMcp }`하지만 **어디에서도 호출하지 않음**. HTTP 전환 후 사장된 죽은 코드.

#### 원인 D: mcp-registry.ts의 모순된 설정

**파일:** `src/tools/mcp-registry.ts:34-44`

```typescript
{
  id: 'figma',
  npmPackage: 'figma-developer-mcp',  // ← stdio용 패키지인데
  transport: 'http',                   // ← http transport
  url: 'https://mcp.figma.com/mcp',   // ← remote OAuth 서버
}
```

**문제:** `npmPackage`는 PAT+stdio용(`figma-developer-mcp`)인데 `transport: 'http'`로 설정. HTTP transport에는 npmPackage가 불필요.

---

### 2.2 Init 프로세스 hang: HTTP 서버 keep-alive 미종료 (P0)

#### 원인 E: server.close()가 기존 연결을 끊지 않음

**파일:** `src/utils/oauth-callback-server.ts:92-95`

```typescript
function cleanup(): void {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  server.close();  // ← 새 연결만 차단, 기존 keep-alive 연결은 유지
}
```

Node.js `http.Server.close()`는 **새 연결 수락만 중단**. 브라우저가 OAuth callback 후 TCP keep-alive 연결을 유지하면 event loop가 드레인되지 않아 프로세스 hang.

#### 원인 F: Connection: close 헤더 미설정

**파일:** `src/utils/oauth-callback-server.ts:57-90`

HTTP 응답에 `Connection: close` 헤더를 설정하지 않아 브라우저가 keep-alive 시도.

---

### 2.3 Google OAuth: 토큰 검증 부재 (P1)

#### 원인 G: exchangeGoogleCode() 후 검증 없음

**파일:** `src/tools/google-auth.ts:136-188`, `src/cli/init.ts:634-636`

```typescript
await exchangeGoogleCode(code, services, server.redirectUri);
console.log(`  ✓ Google authenticated! (${services.join(', ')})\n`);
// ← 토큰 검증 없이 성공 메시지 출력
```

---

## 3. 해결 방안

### 3.1 Figma: 공식 OAuth Remote MCP 제대로 동작시키기

#### 3.1.1 `mcp-registry.ts` — HTTP transport 정리

```typescript
// 변경 전
{
  id: 'figma',
  npmPackage: 'figma-developer-mcp',  // 모순
  transport: 'http',
  url: 'https://mcp.figma.com/mcp',
}

// 변경 후
{
  id: 'figma',
  name: 'Figma',
  description: 'Access Figma designs, components, variables, and comments',
  npmPackage: '',                        // HTTP transport에는 npm 패키지 불필요
  transport: 'http',
  url: 'https://mcp.figma.com/mcp',
  keywords: ['figma', 'design', 'ui', 'component', 'prototype', 'frame', 'design token'],
  category: 'design',
  // envVars 없음 — OAuth는 Claude Code가 관리
}
```

`npmPackage`를 빈 문자열로 설정하여 npm install을 건너뛰게 함.

#### 3.1.2 `claude-code-sync.ts` — spawn으로 변경하여 OAuth 프롬프트 노출

**파일:** `src/config/claude-code-sync.ts`의 `syncHttpToClaudeCode()` 함수

```typescript
// 변경 전 — execFileAsync (stdout 캡처, 프롬프트 안 보임)
await execFileAsync('claude', [
  'mcp', 'add', '--transport', 'http', '-s', 'user', serverId, url,
], { timeout: httpTimeoutMs });

// 변경 후 — spawn with stdio inherit (프롬프트 사용자에게 보임)
import { spawn } from 'node:child_process';

await new Promise<void>((resolve, reject) => {
  const child = spawn('claude', [
    'mcp', 'add', '--transport', 'http', '-s', 'user', serverId, url,
  ], { stdio: 'inherit' });

  const timer = setTimeout(() => {
    child.kill();
    reject(new Error(`claude mcp add timed out after ${httpTimeoutMs}ms`));
  }, httpTimeoutMs);

  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`claude mcp add exited with code ${code}`));
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    reject(err);
  });
});
```

이로써 `claude mcp add --transport http`가 OAuth를 트리거하면 브라우저 오픈 등이 사용자에게 직접 보임.

#### 3.1.3 `init.ts` figma case — 올바른 안내 메시지

```typescript
case 'figma': {
  console.log('\n  Figma uses the official Remote MCP server with OAuth.');
  console.log('  Registering Figma MCP server...\n');
  // envValues 비워둠 — HTTP transport, OAuth는 Claude Code가 관리
  // 등록 후 인증 가이드는 아래 3.1.4에서 출력
  break;
}
```

거짓 "browser will open" 메시지 제거. 실제로 등록만 하고, 등록 성공 후 OAuth 인증 가이드를 출력.

#### 3.1.4 Figma 등록 후 OAuth 인증 가이드 출력

`registerMcpTool()` 성공 후, figma인 경우 인증 가이드 박스를 출력:

```typescript
if (toolId === 'figma') {
  console.log('  ┌──────────────────────────────────────────────────────┐');
  console.log('  │  Figma OAuth Authentication Guide                    │');
  console.log('  │                                                      │');
  console.log('  │  Figma MCP server has been registered.               │');
  console.log('  │  To complete OAuth authentication:                   │');
  console.log('  │                                                      │');
  console.log('  │  1. Open Claude Code (interactive session)           │');
  console.log('  │  2. Type: /mcp                                      │');
  console.log('  │  3. Select "figma" server                           │');
  console.log('  │  4. Click "Authenticate" in the browser             │');
  console.log('  │  5. Allow access to your Figma account              │');
  console.log('  │                                                      │');
  console.log('  │  Or run: pilot-ai auth figma                        │');
  console.log('  └──────────────────────────────────────────────────────┘');
}
```

#### 3.1.5 `checkClaudeCodeSync('figma')` 검증 추가

`mcp-manager.ts`의 `installMcpServer()` HTTP 경로에서, `syncHttpToClaudeCode()` 성공 후 `checkClaudeCodeSync(serverId)` 호출하여 실제 등록 여부 확인.

#### 3.1.6 `pilot-ai auth figma` 명령 추가

**파일:** `src/cli/auth.ts`, `src/index.ts`

```typescript
// auth.ts
export async function runAuthFigma(): Promise<void> {
  console.log('\n  Figma OAuth Authentication Guide\n');
  console.log('  Figma uses OAuth via the official Remote MCP server.');
  console.log('  Authentication must be completed in an interactive Claude Code session.\n');
  console.log('  Steps:');
  console.log('  1. Open Claude Code (run: claude)');
  console.log('  2. Type: /mcp');
  console.log('  3. Select "figma" server');
  console.log('  4. Click "Authenticate" in the browser');
  console.log('  5. Allow access to your Figma account\n');

  // Check if figma is registered
  const { checkClaudeCodeSync } = await import('../config/claude-code-sync.js');
  const synced = await checkClaudeCodeSync('figma');
  if (synced) {
    console.log('  ✓ Figma MCP server is registered in Claude Code.');
    console.log('  If tools are not working, re-authenticate via /mcp in Claude Code.\n');
  } else {
    console.log('  ✗ Figma MCP server is NOT registered.');
    console.log('  Run: pilot-ai init (select Figma) or:');
    console.log('  claude mcp add --transport http -s user figma https://mcp.figma.com/mcp\n');
  }
}

// index.ts — auth subcommand에 figma 추가
authCmd
  .command('figma')
  .description('Show Figma OAuth authentication guide')
  .action(async () => {
    const { runAuthFigma } = await import('./cli/auth.js');
    await runAuthFigma();
  });
```

#### 3.1.7 죽은 코드 정리

- `src/tools/figma-mcp.ts`: `registerFigmaMcp()`, `unregisterFigmaMcp()` 삭제. 유틸 함수(`loadMcpConfig`, `saveMcpConfig`, `getMcpConfigPathIfExists`)만 유지.
- `src/cli/init.ts`: `import { registerFigmaMcp }` 죽은 import 제거.

---

### 3.2 Init 프로세스 hang 해결

#### 3.2.1 `oauth-callback-server.ts` — 서버 완전 종료

```typescript
function cleanup(): void {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  server.close();
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();  // Node 18.2+ — 모든 활성 연결 강제 종료
  }
}
```

#### 3.2.2 `oauth-callback-server.ts` — keep-alive 방지

```typescript
const server = http.createServer((req, res) => {
  res.setHeader('Connection', 'close');  // 브라우저에 keep-alive 하지 말라고 지시
  // ... 기존 로직
});
server.keepAliveTimeout = 0;
```

---

### 3.3 Google OAuth: 토큰 검증 추가

#### 3.3.1 `google-auth.ts` — verifyGoogleTokens() 함수 추가

```typescript
/**
 * Verifies that a Google access token is valid using the tokeninfo endpoint.
 */
export async function verifyGoogleTokens(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`
    );
    return res.ok;
  } catch {
    return false;
  }
}
```

#### 3.3.2 `init.ts` runGoogleOAuthFlow() — 토큰 교환 후 검증

```typescript
const tokens = await exchangeGoogleCode(code, services, server.redirectUri);
const valid = await verifyGoogleTokens(tokens.accessToken);
if (valid) {
  console.log(`  ✓ Google authenticated and verified! (${services.join(', ')})\n`);
} else {
  console.log(`  ⚠ Tokens saved but verification failed. Try: pilot-ai auth google\n`);
}
```

---

## 4. 영향 범위

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/tools/mcp-registry.ts` | **수정** | Figma: `npmPackage: ''`, `transport`/`url` 유지, `envVars` 제거 확인 |
| `src/config/claude-code-sync.ts` | **수정** | `syncHttpToClaudeCode`: `execFileAsync` → `spawn({ stdio: 'inherit' })` |
| `src/cli/init.ts` | **수정** | Figma: 거짓 안내 제거, 등록 후 OAuth 가이드 출력. Google: 토큰 검증. import 정리 |
| `src/tools/figma-mcp.ts` | **수정** | `registerFigmaMcp()`/`unregisterFigmaMcp()` 제거 |
| `src/cli/auth.ts` | **수정** | `runAuthFigma()` 추가 |
| `src/index.ts` | **수정** | `auth figma` 서브커맨드 추가 |
| `src/agent/mcp-manager.ts` | **수정** | HTTP 등록 후 `checkClaudeCodeSync()` 검증 추가 |
| `src/utils/oauth-callback-server.ts` | **수정** | `closeAllConnections()`, `Connection: close` 헤더 |
| `src/tools/google-auth.ts` | **수정** | `verifyGoogleTokens()` 추가 |
| `tests/` | **수정** | 관련 테스트 업데이트 |

---

## 5. 참고 자료

- [Figma Remote MCP 서버 설정 가이드](https://help.figma.com/hc/en-us/articles/35281350665623-Figma-MCP-collection-How-to-set-up-the-Figma-remote-MCP-server) — 공식 OAuth 방식
- [Figma MCP 개발자 문서](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
- [Claude Code MCP 설정](https://code.claude.com/docs/en/mcp) — `claude mcp add --transport http`
- [Figma Forum: Remote MCP는 OAuth만 지원](https://forum.figma.com/ask-the-community-7/support-for-pat-personal-access-token-based-auth-in-figma-remote-mcp-47465)
- [Google OAuth tokeninfo 엔드포인트](https://oauth2.googleapis.com/tokeninfo)
- [Node.js server.closeAllConnections()](https://nodejs.org/api/http.html#serverclosecallback) — Node 18.2+
