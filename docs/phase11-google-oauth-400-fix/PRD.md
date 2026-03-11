# Phase 11: Google OAuth 400 에러 근본 원인 분석 및 해결 PRD

## 1. 문제 상황

`pilot-ai` npm 설치 후 `pilot-ai init` 실행 시, Google OAuth 인증 과정에서 **HTTP 400 에러**가 발생하여 인증이 완료되지 않음.
- OAuth 클라이언트 타입: **Desktop app** (확인됨)

---

## 2. 근본 원인 분석 (Root Cause Analysis)

### 2.1 [P0] redirect_uri 경로 불일치 — 가장 유력한 원인

**파일:** `src/utils/oauth-callback-server.ts:115`

```typescript
const redirectUri = `http://127.0.0.1:${port}/callback`;
//                                           ^^^^^^^^^
//                  Google Console에 등록되지 않은 경로
```

**Google 공식 문서 (Native App OAuth):**
> "The value must **exactly match** one of the authorized redirect URIs for the OAuth 2.0 client"
> 단, loopback에서 **포트는 무시** (RFC 8252), **경로는 매칭 대상**

**Desktop app 생성 시 Google Console이 자동 등록하는 URI:**
- `http://localhost` (경로 없음, 포트 없음)

**현재 코드가 보내는 URI:**
- `http://127.0.0.1:{random_port}/callback`

**불일치 지점 3가지:**

| 항목 | Console 등록값 | 코드 전송값 | 문제 |
|------|---------------|------------|------|
| 호스트 | `localhost` | `127.0.0.1` | Google이 별도 취급 가능 |
| 포트 | 없음 | 랜덤 포트 | RFC 8252에 의해 무시됨 (OK) |
| **경로** | **없음** | **`/callback`** | **exact match 실패 → 400** |

**결론:** Desktop app이라도 **경로(`/callback`)가 Console 등록 URI에 없으면 `redirect_uri_mismatch` 400 에러 발생**.

### 2.2 [P0] `client_id` URL 인코딩 누락

**파일:** `src/tools/google-auth.ts:126`

```typescript
return `...?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&...`;
//                     ^^^^^^^^^^^^^^^^                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                     URL 인코딩 없음 ✗              URL 인코딩 있음 ✓
```

- `redirect_uri`, `scope`는 `encodeURIComponent()` 처리됨
- `client_id`만 raw 문자열 삽입
- Google Client ID(`xxx.apps.googleusercontent.com`)는 보통 URL-safe 문자만 포함
- **하지만:** copy-paste 시 **invisible characters** (Zero-Width Space `U+200B`, Non-Breaking Space `U+00A0`, BOM `U+FEFF`) 포함 가능
- `.trim()`은 일반 공백만 제거하고 이런 invisible char은 남겨둠
- invisible char가 포함되면 URL이 깨지거나 Google이 `invalid_client` 400 반환

### 2.3 [P1] `gcp-oauth.keys.json` redirect_uri 모순

**파일:** `src/cli/init.ts:474-480`

```typescript
redirect_uris: ['http://localhost:3000/oauth2callback'],
```

MCP 서버(`@piotr-agier/google-drive-mcp`, `@cocal/google-calendar-mcp`)가 이 파일을 읽어 자체 OAuth 시도 시, Google Console에 `http://localhost:3000/oauth2callback`이 등록되어 있지 않으면 동일한 400 에러 발생.

### 2.4 [P1] OAuth Consent Screen 미구성

- Google Cloud Console에서 OAuth consent screen이 구성되지 않으면 authorization endpoint에서 400 반환
- "Testing" 모드에서 본인 계정이 test user로 추가되지 않으면 인증 불가
- 현재 init 안내에 consent screen 설정 단계가 **누락**되어 있음

### 2.5 [P2] PKCE 미사용

- Google은 Desktop app에 PKCE를 **강력 권장** (`code_challenge` 파라미터가 recommended로 표기)
- 현재 400의 직접 원인은 아니지만, Google이 향후 필수로 전환 시 즉시 장애 발생
- OAuth 2.1 표준에서는 PKCE 필수

### 2.6 [P2] `state` 파라미터 미사용

- 콜백 서버가 `state`를 수신하지만 (`oauth-callback-server.ts:87`) 생성/검증하지 않음
- CSRF 공격에 취약
- 400의 직접 원인은 아님

---

## 3. 해결 방안

### 3.1 [P0] redirect_uri 수정 — 경로 제거 + 호스트 통일

**파일:** `src/utils/oauth-callback-server.ts`

```typescript
// 변경 전 (line 115)
const redirectUri = `http://127.0.0.1:${port}/callback`;

// 변경 후 — 경로 제거, 호스트 유지 (127.0.0.1)
const redirectUri = `http://127.0.0.1:${port}`;
```

콜백 서버의 request handler도 수정:
```typescript
// 변경 전 (line 63)
if (url.pathname !== '/callback') {

// 변경 후 — root path 또는 어떤 path든 수용
// Google은 redirect_uri에 경로가 없으면 root path(/)로 redirect
if (url.pathname !== '/' && url.pathname !== '/callback') {
```

**대안 (더 안전):** Google Cloud Console에서 수동으로 `http://127.0.0.1/callback`을 Authorized redirect URI에 추가하도록 안내. 단, Desktop app에서 사용자에게 redirect URI 설정을 요구하는 것은 UX 저하.

**베스트 프랙티스:** Google 공식 문서에 따르면 loopback redirect는 경로 없이 `http://127.0.0.1:{port}`만 사용하는 것이 표준.

### 3.2 [P0] client_id sanitization 강화

**파일:** `src/tools/google-auth.ts` + `src/cli/init.ts`

```typescript
// init.ts — 기존 trim() 강화
const trimmedClientId = googleAnswers.clientId
  .trim()
  .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g, '');  // invisible char 제거

// google-auth.ts:126 — client_id URL 인코딩
return `...?client_id=${encodeURIComponent(config.clientId)}&...`;
```

### 3.3 [P0] OAuth 에러 핸들링 강화

**파일:** `src/tools/google-auth.ts` — `exchangeGoogleCode()`

현재 에러 처리:
```typescript
// line 156-158
if (!res.ok) {
  const text = await res.text().catch(() => '');
  throw new Error(`Google OAuth token exchange failed (HTTP ${res.status}): ${text}`);
}
```

개선:
```typescript
if (!res.ok) {
  const text = await res.text().catch(() => '');

  if (res.status === 400) {
    if (text.includes('redirect_uri_mismatch')) {
      throw new Error(
        'Google OAuth error: redirect_uri_mismatch\n\n' +
        '  The redirect URI does not match what is registered in Google Cloud Console.\n' +
        '  Solutions:\n' +
        '  1. Verify OAuth client type is "Desktop app" (not "Web application")\n' +
        '  2. Or add http://127.0.0.1 to Authorized redirect URIs in Console\n'
      );
    }
    if (text.includes('invalid_client')) {
      throw new Error(
        'Google OAuth error: invalid_client\n\n' +
        '  The Client ID or Client Secret is incorrect.\n' +
        '  Fix: Go to Google Cloud Console → Credentials → Copy correct values\n' +
        '  Tip: Re-run "pilot-ai init" or "pilot-ai auth google"\n'
      );
    }
    if (text.includes('invalid_grant')) {
      throw new Error(
        'Google OAuth error: invalid_grant\n\n' +
        '  The authorization code has expired or was already used.\n' +
        '  Fix: Re-run "pilot-ai auth google" to get a new code\n'
      );
    }
  }

  throw new Error(`Google OAuth token exchange failed (HTTP ${res.status}): ${text}`);
}
```

### 3.4 [P0] init 안내 메시지 개선

**파일:** `src/cli/init.ts:395-409`

```typescript
console.log('\n── Google OAuth2 Setup ──\n');
console.log('  Step 0: Configure OAuth Consent Screen');
console.log('  ──────────────────────────────────────');
console.log('  1. Go to https://console.cloud.google.com/apis/credentials/consent');
console.log('  2. Select "External" user type → Create');
console.log('  3. Fill in App name, User support email, Developer email');
console.log('  4. Add Scopes: gmail, calendar, drive (as needed)');
console.log('  5. Add your Google account as a Test user');
console.log('  6. Save\n');

console.log('  Step 1: Create OAuth Client ID');
console.log('  ─────────────────────────────');
console.log('  1. Go to https://console.cloud.google.com/apis/credentials');
console.log('  2. Click "+ CREATE CREDENTIALS" → "OAuth client ID"');
console.log('  ⚠️  3. Application type: MUST be "Desktop app"');
console.log('       (NOT "Web application" — this will cause a 400 error)');
console.log('  4. Name: "Pilot-AI"');
console.log('  5. Click "Create" and copy the Client ID & Client Secret\n');
```

### 3.5 [P1] gcp-oauth.keys.json redirect_uri 수정

**파일:** `src/cli/init.ts:474-480`

```typescript
// 변경 전
redirect_uris: ['http://localhost:3000/oauth2callback'],

// 변경 후 — MCP 서버 호환성 확인 후 결정
// Option A: 경로 없는 loopback (표준)
redirect_uris: ['http://127.0.0.1'],
// Option B: MCP 서버가 특정 경로를 기대하면 해당 경로 사용
// → @piotr-agier/google-drive-mcp, @cocal/google-calendar-mcp 소스 확인 필요
```

### 3.6 [P1] PKCE 도입

**파일:** `src/tools/google-auth.ts`

```typescript
import crypto from 'node:crypto';

// PKCE 유틸
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// getGoogleAuthUrl() 수정
export function getGoogleAuthUrl(
  services: Array<keyof typeof GOOGLE_SCOPES>,
  redirectUri: string,
): { url: string; codeVerifier: string } {
  if (!config) throw new Error('Google OAuth not configured.');
  const scopes = services.flatMap((s) => GOOGLE_SCOPES[s]).join(' ');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    codeVerifier,
  };
}

// exchangeGoogleCode() 수정 — codeVerifier 파라미터 추가
export async function exchangeGoogleCode(
  code: string,
  services: Array<keyof typeof GOOGLE_SCOPES>,
  redirectUri: string,
  codeVerifier: string,  // 추가
): Promise<GoogleTokens> {
  // ... 기존 코드 + body에 code_verifier 추가
  body: new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,  // 추가
  }),
}
```

**이점:**
- Authorization code 가로채기 공격 방지 (RFC 7636)
- Google 공식 권장사항 준수
- OAuth 2.1에서 PKCE 필수 → 미래 호환성
- `URLSearchParams`를 사용하면 **자동 URL 인코딩** → 2.2 이슈도 동시 해결

### 3.7 [P1] State 파라미터 검증

3.6의 PKCE와 함께 구현. `getGoogleAuthUrl()`에서 `state` 반환, 콜백에서 검증:

```typescript
// 콜백 수신 시
const { code, state: returnedState } = await server.waitForCode();
if (returnedState !== expectedState) {
  throw new Error('OAuth state mismatch — possible CSRF attack');
}
```

### 3.8 [P2] OAuth 타임아웃 UX 개선

**파일:** `src/utils/oauth-callback-server.ts`

```typescript
// 60초 경과 시 중간 안내
const warningHandle = setTimeout(() => {
  console.log('\n  Still waiting for Google authorization...');
  console.log('  If you see a 400 error in the browser:');
  console.log('  1. Check OAuth client type is "Desktop app"');
  console.log('  2. Check OAuth consent screen is configured');
  console.log('  3. Press Ctrl+C and re-run "pilot-ai auth google"\n');
}, 60_000);
```

---

## 4. 구현 우선순위

| 우선순위 | 항목 | 파일 | 난이도 |
|----------|------|------|--------|
| **P0** | redirect_uri 경로 `/callback` 제거 | `oauth-callback-server.ts` | 낮음 |
| **P0** | client_id invisible char 제거 + URL 인코딩 | `google-auth.ts`, `init.ts` | 낮음 |
| **P0** | OAuth 400 에러 메시지 파싱/가이드 출력 | `google-auth.ts` | 낮음 |
| **P0** | init 안내에 consent screen 설정 추가 | `init.ts` | 낮음 |
| **P1** | PKCE 도입 (code_verifier/code_challenge) | `google-auth.ts`, `init.ts`, `auth.ts`, `tools.ts` | 중간 |
| **P1** | State 파라미터 생성 및 검증 | `google-auth.ts`, `oauth-callback-server.ts` | 낮음 |
| **P1** | gcp-oauth.keys.json redirect_uri 정합성 | `init.ts`, `tools.ts` | 중간 |
| **P2** | OAuth 타임아웃 중간 안내 메시지 | `oauth-callback-server.ts` | 낮음 |
| **P2** | Incremental Authorization | `google-auth.ts` | 중간 |

---

## 5. 영향 범위

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/utils/oauth-callback-server.ts` | **수정** | redirect_uri 경로 제거, 타임아웃 UX |
| `src/tools/google-auth.ts` | **수정** | PKCE, state, URL 인코딩, 에러 핸들링 |
| `src/cli/init.ts` | **수정** | 안내 메시지, client_id sanitization, gcp-oauth.keys.json |
| `src/cli/auth.ts` | **수정** | PKCE/state 연동 |
| `src/cli/tools.ts` | **수정** | PKCE/state 연동, gcp-oauth.keys.json |
| `tests/` | **추가/수정** | PKCE, state, 에러 핸들링 테스트 |

---

## 6. 즉시 해결 가이드

현재 400 에러를 코드 수정 없이 해결하려면:

### Step 1: OAuth Consent Screen 구성
1. https://console.cloud.google.com/apis/credentials/consent 접속
2. "External" user type 선택 → Create
3. App name, User support email, Developer email 입력
4. Scopes 추가 (Gmail, Calendar, Drive)
5. **Test users에 본인 Google 계정 추가** (External 타입 필수)
6. Save

### Step 2: OAuth Client에 redirect URI 수동 등록
1. https://console.cloud.google.com/apis/credentials 접속
2. 기존 Desktop app OAuth 클라이언트 클릭
3. "Authorized redirect URIs" 섹션에 추가:
   - `http://127.0.0.1`
4. Save

### Step 3: API 활성화 확인
- Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com
- Calendar API: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
- Drive API: https://console.cloud.google.com/apis/library/drive.googleapis.com

### Step 4: 재인증
```bash
pilot-ai auth google --revoke
pilot-ai auth google
```

---

## 7. 참고 자료

- [Google OAuth 2.0 for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app) — 공식 가이드
- [RFC 8252: OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252) — Loopback redirect URI 표준 (포트 무시, 경로 매칭)
- [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636) — Proof Key for Code Exchange
- [Google OAuth Error Responses](https://developers.google.com/identity/protocols/oauth2/native-app#handlingresponse) — 에러 코드 목록
- [Google OAuth Scopes](https://developers.google.com/identity/protocols/oauth2/scopes) — 전체 스코프 목록
