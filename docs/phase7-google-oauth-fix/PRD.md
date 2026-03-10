# Phase 7: Google OAuth 연동 개선 PRD

## 1. 배경 및 문제 분석

### 1.1 현재 상태

`pilot-ai init` 시 Google Client ID와 Client Secret을 입력받지만, 실제로 Google 서비스(Gmail, Calendar, Drive)와의 연결이 제대로 동작하지 않는 **치명적 버그** 다수 존재.

### 1.2 발견된 문제점

#### P0 (Critical) — OOB 방식 사용으로 인한 완전 차단

| 파일 | 라인 | 문제 |
|------|------|------|
| `src/tools/google-auth.ts` | L100 | `redirectUri` 기본값이 `urn:ietf:wg:oauth:2.0:oob` |
| `src/tools/email.ts` | L98 | 동일하게 OOB redirect URI 사용 |

**Google은 2023년 1월 31일부로 OOB 방식을 완전 차단했다.** 이 redirect URI를 사용하면 `"Access blocked: This app's request is invalid"` 에러가 발생하며, 토큰 교환 자체가 불가능하다.

> 참고: [Google OOB Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/oob-migration)

#### P0 (Critical) — `configureGoogle()` / `configureEmail()` 호출 누락

| 파일 | 문제 |
|------|------|
| `src/agent/core.ts` 등 agent 시작 경로 | `configureGoogle()` 호출하는 코드가 **존재하지 않음** |
| `src/tools/google-calendar.ts` | `getGoogleAccessToken()` 호출 시 `config`가 `null`이어서 항상 에러 |
| `src/tools/google-drive.ts` | 동일 |
| `src/tools/email.ts` | `configureEmail()` 호출하는 코드가 agent 어디에도 없음 |

init에서 Keychain에 credentials를 저장하지만, agent 시작 시 `loadConfig()` → `resolveKeychainSecrets()`로 config에서 clientId/clientSecret을 복원한 후 **`configureGoogle()`을 호출하여 모듈 레벨 상태를 초기화하는 코드가 없다.** 결과적으로 모든 Google API 호출이 `"Google OAuth not configured"` 에러로 실패한다.

#### P1 (High) — OAuth 인증 플로우 미구현

| 항목 | 문제 |
|------|------|
| OAuth consent → code 교환 플로우 | init에서 Client ID/Secret만 저장하고, **실제 브라우저 기반 OAuth consent 플로우를 실행하지 않음** |
| 토큰 획득 | `exchangeGoogleCode()` / `exchangeCode()`를 호출하는 경로가 없음 |
| 결과 | Keychain에 `google-oauth-tokens`가 저장되지 않아 API 호출 불가 |

#### P1 (High) — Gmail 이중 구현 (토큰 충돌)

| 파일 | Keychain 키 | 비고 |
|------|-------------|------|
| `src/tools/google-auth.ts` | `google-oauth-tokens` | 통합 OAuth (gmail 스코프 포함) |
| `src/tools/email.ts` | `gmail-oauth-tokens` | 별도 OAuth |

Gmail 관련 토큰이 **두 곳에 분리 저장**되어, 어느 것이 사용되는지 혼란. 통합 모듈 도입 의도와 충돌.

#### P1 (High) — Slack/Telegram `msg_too_long` 에러

| 파일 | 라인 | 문제 |
|------|------|------|
| `src/messenger/slack.ts` | L184-190 | `updateText()`에서 `splitMessage()` 미사용 (`chat.update` 직접 호출) |
| `src/messenger/telegram.ts` | L123-131 | `updateText()`에서 `splitMessage()` 미사용 |
| `src/messenger/telegram.ts` | L133-151 | `sendApproval()`에서 `splitMessage()` 미사용 |
| `src/agent/core.ts` | L167 | Claude 응답을 `updateText()`로 전송 (주요 응답 경로) |

**Slack `chat.update` API의 text 필드 최대 길이는 4,000자이며, 초과 시 `msg_too_long` 에러를 반환한다.** (일반 메시지 truncation 한도는 40,000자이나, `chat.update` API 호출 자체는 4,000자에서 거부된다.) Telegram도 4,096자 제한이 있다. `sendText()`는 `splitMessage()`로 분할 처리하지만, `updateText()`는 양쪽 플랫폼 모두 분할 없이 직접 전송한다.

Claude의 응답이 플랫폼 제한을 초과하면 `core.ts:167`에서 `updateText()`를 호출하고, Slack/Telegram API가 `msg_too_long` 에러를 반환한다. **사용자가 슬랙에서 자주 겪는 에러의 직접 원인이다.**

**추가 문제:**
- `updateText()`는 Slack `chat.update` / Telegram `editMessageText` API를 사용하는데, 이 API는 **기존 메시지 하나를 수정**하는 것이므로 본질적으로 분할 전송이 불가능하다. 긴 응답의 경우 기존 "Thinking..." 메시지 수정 방식에서 **새 메시지 전송 방식으로 전환**이 필요하다.
- Slack의 `sendApproval()`은 Block Kit 기반인데, section block은 3,000자 제한이 있어 더 일찍 에러가 발생할 수 있다.
- Telegram의 `sendApproval()`도 동일하게 길이 제한 미처리.

#### P2 (Medium) — 에러 핸들링 미흡

- `exchangeGoogleCode()`: `data.error` 외의 HTTP 에러(4xx, 5xx) 미처리
- `getGoogleAccessToken()`: refresh 실패 시 재인증 안내 없음
- `loadConfig()`에서 google config가 없을 때의 graceful fallback 없음

#### P2 (Medium) — init 가이드 부정확

- init에서 "Desktop app" 타입으로 OAuth 클라이언트 생성 안내하면서 OOB redirect URI 사용 → 모순
- Loopback 방식 사용 시 redirect URI 설정 안내 필요

---

## 2. 개선 목표

1. **OOB → Loopback 전환**: `urn:ietf:wg:oauth:2.0:oob` 대신 `http://127.0.0.1:{port}/callback` 사용
2. **OAuth 인증 플로우 완성**: init 또는 별도 `pilot-ai auth google` 명령에서 브라우저 기반 OAuth consent 실행
3. **Agent 시작 시 Google config 초기화**: `configureGoogle()` / `configureEmail()` 자동 호출
4. **Gmail 이중 구현 통합**: `email.ts`를 `google-auth.ts` 기반으로 리팩토링
5. **에러 핸들링 강화**: 토큰 만료/취소 시 재인증 안내
6. **Telegram msg_too_long 해결**: 긴 응답 시 메시지 분할 전송 처리

---

## 3. 상세 설계

### 3.1 Loopback OAuth 서버 (`src/utils/oauth-callback-server.ts` 신규)

```typescript
interface OAuthCallbackResult {
  code: string;
  state?: string;
}

/**
 * 로컬 HTTP 서버를 시작하여 OAuth callback을 수신한다.
 * - 127.0.0.1 바인딩 (localhost 대신 IP 사용 — 방화벽 이슈 방지)
 * - 랜덤 포트 사용 (1024 이상)
 * - callback 수신 후 자동 종료
 * - 타임아웃 (120초)
 */
async function startOAuthCallbackServer(): Promise<{
  port: number;
  redirectUri: string;
  waitForCode(): Promise<OAuthCallbackResult>;
  close(): void;
}>
```

- `node:http` 사용 (외부 의존성 없음)
- 브라우저에 성공/실패 HTML 페이지 응답
- Google Console에서 redirect URI는 `http://127.0.0.1` (포트 무관 — Google이 loopback은 포트 무시)

### 3.2 Google OAuth 인증 명령 (`pilot-ai auth google`)

```
pilot-ai auth google [--services gmail,calendar,drive]
```

**플로우:**
1. `loadConfig()`에서 clientId/clientSecret 로드
2. `startOAuthCallbackServer()` 시작 → 랜덤 포트 할당
3. `getGoogleAuthUrl(services)` 생성 (redirect_uri = `http://127.0.0.1:{port}/callback`)
4. `open` (macOS) 명령으로 시스템 브라우저에 auth URL 열기
5. 사용자가 Google 동의 → callback으로 code 수신
6. `exchangeGoogleCode(code, services)` 호출 → 토큰 Keychain 저장
7. 서버 종료, 성공 메시지 출력

### 3.3 Agent 시작 시 Google 초기화 (`src/agent/core.ts` 수정)

```typescript
// agent 시작 시 (startAgent 또는 유사 함수)
const config = await loadConfig();
if (config.google) {
  configureGoogle({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
  });
  // email.ts도 같은 credentials로 초기화 (통합 전 임시)
  configureEmail({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
  });
}
```

### 3.4 Gmail 통합 (`email.ts` 리팩토링)

- `email.ts`의 자체 OAuth 로직 제거
- `google-auth.ts`의 `getGoogleAccessToken()` 사용하도록 변경
- `gmail-oauth-tokens` Keychain 키 deprecated 처리 (마이그레이션 후 삭제)
- `configureEmail()` 제거, `configureGoogle()` 하나로 통합

### 3.5 init / addtool 가이드 업데이트

#### 3.5.1 `src/cli/init.ts` (L352-401) 변경

**변경 전** (현재 — 4단계, OAuth 인증 미안내):
```
Google OAuth2 Setup Guide:
1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new OAuth 2.0 Client ID (Desktop app)
3. Enable Gmail API, Google Calendar API, Google Drive API
4. Copy the Client ID and Client Secret
```
→ Client ID/Secret 입력 후 "Google configured" 출력하고 끝.

**변경 후** (7단계, OAuth 인증까지 완전 안내):
```
Google OAuth2 Setup Guide:

  Step 1: Google Cloud Console 설정
  ──────────────────────────────────
  1. Go to https://console.cloud.google.com/apis/credentials
  2. Click "+ CREATE CREDENTIALS" → "OAuth client ID"
     - Application type: Desktop app
     - Name: pilot-ai (or any name)
     - Click "Create"
     (No redirect URI configuration needed)
  3. Copy the Client ID and Client Secret shown in the popup

  Step 2: API 활성화
  ──────────────────
  Go to https://console.cloud.google.com/apis/library
  Search and enable each:
  - Gmail API
  - Google Calendar API
  - Google Drive API
```
→ Client ID/Secret 입력 + 서비스 선택 후:

```
  Step 3: Google 계정 인증
  ─────────────────────────
  Opening browser for Google sign-in...
  (Please sign in and grant access to the selected services)
```
→ **init 내에서 바로 OAuth 인증 플로우 자동 실행** (startOAuthCallbackServer → 브라우저 열기 → code 수신 → 토큰 저장)

성공 시:
```
  ✓ Google authenticated! (gmail, calendar, drive)
```

실패/스킵 시:
```
  ⚠ Google credentials saved, but authentication was skipped.
    Run "pilot-ai auth google" later to complete authentication.
```

**핵심 변경: Client ID/Secret 입력 직후에 OAuth 인증까지 이어서 진행.** 별도 `pilot-ai auth google` 실행이 필요 없도록 UX 개선. 인증 실패/취소 시에만 나중에 `pilot-ai auth google`으로 재시도 안내.

#### 3.5.2 `src/cli/tools.ts` addtool (L190-198) 변경

**변경 전** (현재 — 안내 전무):
```
// google-drive 선택 시 Client ID/Secret만 묻고 MCP 서버 등록
```

**변경 후:**
```
  Google Drive Setup:
  1. If you haven't created OAuth credentials yet:
     → Go to https://console.cloud.google.com/apis/credentials
     → Create OAuth 2.0 Client ID (Desktop app)
     → Enable "Google Drive API" in API Library
  2. Enter your Client ID and Client Secret below
```
→ Client ID/Secret 입력 후:
```
  3. Opening browser for Google sign-in...
```
→ OAuth 인증 플로우 자동 실행 (이미 토큰이 있으면 "Already authenticated" 표시 + 재인증 여부 확인)

#### 3.5.3 `pilot-ai auth google` 명령 (fallback용으로 유지)

init/addtool에서 OAuth 인증을 바로 진행하되, 아래 상황에서 수동 재인증용으로 `auth google` 명령도 유지:
- init 시 인증 스킵/실패한 경우
- 토큰 만료/취소된 경우
- 서비스 추가/변경이 필요한 경우 (`--services` 옵션)

### 3.6 Slack/Telegram 긴 메시지 처리

**문제 핵심:** `core.ts:167`에서 Claude 응답을 `updateText()`로 전송하는데, 이 메서드는 Slack `chat.update` / Telegram `editMessageText`를 사용하므로 하나의 메시지만 수정 가능. 긴 응답을 분할 "수정"하는 것은 불가능하다.

**해결 전략 — `core.ts` 응답 전송 로직 변경 (권장):**

가장 깔끔한 해결은 `core.ts`에서 긴 응답의 전송 방식을 변경하는 것이다:

```typescript
// core.ts L164-167 변경
log(`Claude response (${response.length} chars): "${response.slice(0, 100)}..."`);
await this.messenger.removeReaction?.(msg.channelId, incomingTs, 'gear');
await this.messenger.addReaction?.(msg.channelId, incomingTs, 'white_check_mark');

const maxLen = this.config.messenger.platform === 'slack'
  ? MAX_MESSAGE_LENGTH.slack
  : MAX_MESSAGE_LENGTH.telegram;

if (response.length <= maxLen) {
  // 짧은 응답: 기존 "Thinking..." 메시지를 응답으로 수정
  await this.messenger.updateText(msg.channelId, statusMsgId, response);
} else {
  // 긴 응답: "Thinking..." 메시지를 완료 상태로 수정 + 응답은 새 메시지로 전송
  await this.messenger.updateText(msg.channelId, statusMsgId, '✅ Done');
  await this.messenger.sendText(msg.channelId, response, msg.threadId);
}
```

**추가로 adapter 레벨 방어 (안전망):**

Slack `updateText()`:
```typescript
async updateText(channelId: string, messageId: string, text: string): Promise<void> {
  // chat.update도 길이 제한이 있으므로, 초과 시 truncate + 경고
  const safeText = text.length > MAX_MESSAGE_LENGTH.slack
    ? text.slice(0, MAX_MESSAGE_LENGTH.slack - 50) + '\n\n_(message truncated)_'
    : text;
  await this.app.client.chat.update({
    channel: channelId, ts: messageId, text: safeText,
  });
}
```

Telegram `updateText()`:
```typescript
async updateText(channelId: string, messageId: string, text: string): Promise<void> {
  if (text.length <= MAX_MESSAGE_LENGTH.telegram) {
    await this.bot.telegram.editMessageText(
      channelId, parseInt(messageId, 10), undefined,
      text, { parse_mode: 'Markdown' },
    );
  } else {
    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH.telegram);
    await this.bot.telegram.editMessageText(
      channelId, parseInt(messageId, 10), undefined,
      chunks[0], { parse_mode: 'Markdown' },
    );
    for (let i = 1; i < chunks.length; i++) {
      await this.rateLimiter.acquire();
      await this.bot.telegram.sendMessage(channelId, chunks[i], {
        parse_mode: 'Markdown',
        reply_parameters: { message_id: parseInt(messageId, 10) },
      });
    }
  }
}
```

**`sendApproval()` 수정:**
- Slack: section block 3,000자 제한 고려, 긴 텍스트는 truncate 후 버튼 첨부
- Telegram: `splitMessage()` 적용, 마지막 chunk에만 inline keyboard 버튼 첨부

### 3.7 `pilot-ai doctor` 진단 추가 (`src/cli/doctor.ts`)

Google 연동 상태 진단 항목 추가:
- Keychain에 `google-client-id`, `google-client-secret` 존재 확인
- Keychain에 `google-oauth-tokens` 존재 확인
- 토큰 만료 여부 확인
- 각 API endpoint에 대한 connectivity test (optional)

---

## 4. 영향 범위

| 파일 | 변경 유형 |
|------|-----------|
| `src/utils/oauth-callback-server.ts` | **신규** — Loopback OAuth callback 서버 |
| `src/tools/google-auth.ts` | **수정** — OOB → loopback, redirect URI 동적 설정 |
| `src/tools/email.ts` | **수정** — 자체 OAuth 제거, google-auth.ts 사용 |
| `src/cli/init.ts` | **수정** — 안내 문구 변경, auth 명령 안내 추가 |
| `src/cli/auth.ts` | **신규** — `pilot-ai auth google` 서브커맨드 |
| `src/agent/core.ts` | **수정** — 시작 시 `configureGoogle()` 호출 추가 |
| `src/cli/doctor.ts` | **수정** — Google 진단 항목 추가 |
| `src/index.ts` | **수정** — auth 서브커맨드 등록 |
| `tests/tools/google-auth.test.ts` | **수정** — loopback 관련 테스트 |
| `tests/tools/email.test.ts` | **수정** — 통합 후 테스트 업데이트 |
| `tests/utils/oauth-callback-server.test.ts` | **신규** |
| `src/agent/core.ts` | **수정** — 긴 응답 시 `updateText()` → `sendText()` 전환 로직 |
| `src/messenger/slack.ts` | **수정** — `updateText()` truncate 안전망, `sendApproval()` 길이 처리 |
| `src/messenger/telegram.ts` | **수정** — `updateText()`, `sendApproval()` 메시지 분할 처리 |
| `src/messenger/split.ts` | **검토** — 분할 로직 정합성 확인 |

---

## 5. 구현 우선순위

| 순서 | 작업 | 중요도 |
|------|------|--------|
| 1 | Loopback OAuth callback 서버 구현 | P0 |
| 2 | `google-auth.ts` OOB → loopback 전환 | P0 |
| 3 | `pilot-ai auth google` 명령 구현 | P0 |
| 4 | Agent 시작 시 `configureGoogle()` 호출 추가 | P0 |
| 5 | `email.ts` → `google-auth.ts` 통합 | P1 |
| 6 | init 안내 문구 업데이트 | P1 |
| 7 | `pilot-ai doctor` Google 진단 추가 | P2 |
| 8 | `core.ts` 긴 응답 전송 로직 변경 (`updateText` → `sendText` 전환) | P0 |
| 9 | Slack/Telegram `updateText()` adapter 레벨 안전망 추가 | P0 |
| 10 | Slack/Telegram `sendApproval()` 길이 처리 | P1 |
| 10 | 에러 핸들링 강화 | P2 |

---

## 6. 참고 자료

- [Google OOB Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/oob-migration)
- [Google OAuth 2.0 for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Loopback IP Address Flow Migration](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)
- [Making Google OAuth interactions safer](https://developers.googleblog.com/making-google-oauth-interactions-safer-by-using-more-secure-oauth-flows/)
- [Slack: Truncating really long messages](https://docs.slack.dev/changelog/2018-truncating-really-long-messages/)
- [Slack: chat.update method](https://docs.slack.dev/reference/methods/chat.update/) — text 필드 4,000자 제한
- [Slack: Section block](https://docs.slack.dev/reference/block-kit/blocks/section-block/) — text 3,000자 제한
- [Telegram Bot API](https://core.telegram.org/bots/api) — sendMessage/editMessageText 4,096자 제한
