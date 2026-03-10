# Phase 7: Google OAuth 연동 개선 & msg_too_long 수정 체크리스트

> PRD 기반 세분화 태스크. 각 항목은 독립적으로 빌드/테스트/커밋 가능한 단위.

---

## 7.1 Loopback OAuth Callback 서버 (P0)

**신규 파일:** `src/utils/oauth-callback-server.ts`

- [x] 7.1.1 `startOAuthCallbackServer()` 함수 시그니처 정의 (`port`, `redirectUri`, `waitForCode()`, `close()` 반환)
- [x] 7.1.2 `node:http`로 HTTP 서버 생성, `127.0.0.1`에 바인딩 (방화벽 이슈 방지)
- [x] 7.1.3 랜덤 포트 할당 (port 0 사용 → OS가 1024+ 사용 가능 포트 할당)
- [x] 7.1.4 `/callback` GET 요청 핸들러: URL query에서 `code`, `error` 파싱
- [x] 7.1.5 성공 시 브라우저에 "인증 완료, 이 탭을 닫아도 됩니다" HTML 응답 반환
- [x] 7.1.6 실패 시 (`error` 파라미터 존재) 에러 HTML 응답 반환
- [x] 7.1.7 `waitForCode()`: Promise 기반, code 수신 시 resolve / 에러 시 reject
- [x] 7.1.8 타임아웃 처리: 120초 내 callback 미수신 시 reject + 서버 종료
- [x] 7.1.9 `close()`: 서버 즉시 종료 (`server.close()`)
- [x] 7.1.10 `tests/utils/oauth-callback-server.test.ts` 작성
  - [x] 서버 시작 후 포트 반환 확인
  - [x] `http://127.0.0.1:{port}/callback?code=test123` 요청 시 code 수신 확인
  - [x] `?error=access_denied` 요청 시 reject 확인
  - [x] 타임아웃 동작 확인 (짧은 타임아웃으로 테스트)
- [x] 7.1.11 빌드 확인 (`npm run build`)

---

## 7.2 google-auth.ts OOB → Loopback 전환 (P0)

**수정 파일:** `src/tools/google-auth.ts`

- [ ] 7.2.1 `GoogleOAuthConfig` 인터페이스에서 `redirectUri` 필드 유지 (optional → 기본값 변경)
- [ ] 7.2.2 `getGoogleAuthUrl()`: 기본 `redirectUri` `'urn:ietf:wg:oauth:2.0:oob'` 제거, `redirectUri` 파라미터 필수화 (또는 호출 시 명시적 전달)
- [ ] 7.2.3 `exchangeGoogleCode()`: `redirectUri` 파라미터 필수화, OOB 기본값 제거
- [ ] 7.2.4 `email.ts`의 `getAuthUrl()`, `exchangeCode()`도 동일하게 OOB 기본값 제거 (7.5 통합 전 임시 수정)
- [ ] 7.2.5 `tests/tools/google-auth.test.ts` 업데이트
  - [ ] `getGoogleAuthUrl()` 호출 시 redirectUri 전달하도록 수정
  - [ ] 생성된 URL에 `redirect_uri=http%3A%2F%2F127.0.0.1` 포함 확인
  - [ ] OOB URI가 URL에 포함되지 않음 확인
- [ ] 7.2.6 빌드 확인

---

## 7.3 `pilot-ai auth google` 명령 구현 (P0)

**신규 파일:** `src/cli/auth.ts`
**수정 파일:** `src/index.ts`

- [ ] 7.3.1 `src/cli/auth.ts` 생성: `authCommand` 함수 export
- [ ] 7.3.2 `auth google` 서브커맨드 기본 골격 (commander.js)
- [ ] 7.3.3 `--services` 옵션 파싱 (기본값: config에서 읽기, 없으면 `['gmail', 'calendar', 'drive']`)
- [ ] 7.3.4 `loadConfig()`로 clientId/clientSecret 로드 + 누락 시 에러 메시지 ("pilot-ai init 먼저 실행")
- [ ] 7.3.5 `configureGoogle()` 호출하여 모듈 상태 초기화
- [ ] 7.3.6 `startOAuthCallbackServer()` 호출 → 포트 할당, redirectUri 생성
- [ ] 7.3.7 `getGoogleAuthUrl(services)` 호출 시 redirectUri 전달
- [ ] 7.3.8 `child_process.exec('open <url>')` (macOS)로 시스템 브라우저 열기
- [ ] 7.3.9 콘솔에 "브라우저에서 Google 계정 인증을 완료해주세요..." 안내 출력
- [ ] 7.3.10 `waitForCode()` 대기 → code 수신
- [ ] 7.3.11 `exchangeGoogleCode(code, services)` 호출 → 토큰 Keychain 저장
- [ ] 7.3.12 성공 메시지 출력 ("Google 인증 완료! 활성화된 서비스: gmail, calendar, drive")
- [ ] 7.3.13 실패 시 에러 메시지 출력 + callback 서버 종료
- [ ] 7.3.14 `auth google --revoke` 옵션: `deleteGoogleTokens()` 호출 + 확인 메시지
- [ ] 7.3.15 `src/index.ts`에 `auth` 서브커맨드 등록 (`program.command('auth')`)
- [ ] 7.3.16 빌드 확인

---

## 7.4 Agent 시작 시 Google config 초기화 (P0)

**수정 파일:** `src/agent/core.ts`

- [ ] 7.4.1 `core.ts` 상단에 `configureGoogle`, `configureEmail` import 추가
- [ ] 7.4.2 agent 초기화 경로 (constructor 또는 start 메서드) 에서 `this.config.google` 존재 여부 확인
- [ ] 7.4.3 존재 시 `configureGoogle({ clientId, clientSecret })` 호출
- [ ] 7.4.4 존재 시 `configureEmail({ clientId, clientSecret })` 임시 호출 (7.5 통합 전까지)
- [ ] 7.4.5 `config.google` 없을 시 로그만 남기고 skip (에러 발생 X)
- [ ] 7.4.6 빌드 확인
- [ ] 7.4.7 기존 테스트 영향 없음 확인 (`npm test`)

---

## 7.5 Gmail 이중 구현 통합 (P1)

**수정 파일:** `src/tools/email.ts`, `src/tools/google-auth.ts`

- [ ] 7.5.1 `email.ts`에서 `getGoogleAccessToken` import 추가 (`google-auth.ts`에서)
- [ ] 7.5.2 `email.ts`의 `refreshAccessToken()` 내부를 `getGoogleAccessToken()` 호출로 교체
- [ ] 7.5.3 `email.ts`의 `configureEmail()`, `exchangeCode()`, `getAuthUrl()` 함수 제거
- [ ] 7.5.4 `email.ts`의 자체 `config`, `tokens` 모듈 변수 제거
- [ ] 7.5.5 `email.ts`의 `loadTokens()`, `saveTokens()`, `deleteTokens()` 제거 (google-auth.ts 것 사용)
- [ ] 7.5.6 `gmail-oauth-tokens` → `google-oauth-tokens` 마이그레이션: `google-auth.ts`의 `loadGoogleTokens()`에서 `gmail-oauth-tokens` fallback 추가
- [ ] 7.5.7 마이그레이션 성공 시 `gmail-oauth-tokens` Keychain 키 삭제
- [ ] 7.5.8 `gmailFetch()` 헬퍼의 토큰 획득을 `getGoogleAccessToken()` 사용으로 변경
- [ ] 7.5.9 `email.ts`에서 불필요한 import 정리 (`fs`, `path`, `getPilotDir`, `getSecret`, `setSecret`, `deleteSecret`)
- [ ] 7.5.10 `core.ts`에서 `configureEmail()` 호출 제거 (7.4.4에서 추가한 임시 코드)
- [ ] 7.5.11 `tests/tools/email.test.ts` 업데이트: `configureEmail()` → `configureGoogle()` 사용
- [ ] 7.5.12 빌드 확인 + 전체 테스트 통과

---

## 7.6 init / addtool 안내 및 OAuth 플로우 통합 (P1)

### 7.6-A. init 가이드 개선 (`src/cli/init.ts`)

- [ ] 7.6.1 Google Console 설정 가이드 문구 교체 (L353-357)
  - Step 1: Console 설정 (OAuth client ID 생성 — Desktop app, redirect URI 불필요)
  - Step 2: API 활성화 (Gmail API, Calendar API, Drive API — 라이브러리 URL 포함)
- [ ] 7.6.2 Client ID/Secret 입력 + 서비스 선택 후, "Step 3: Google 계정 인증" 안내 출력
- [ ] 7.6.3 `startOAuthCallbackServer()` 호출 → 포트 할당
- [ ] 7.6.4 `configureGoogle()` 호출하여 모듈 초기화
- [ ] 7.6.5 `getGoogleAuthUrl(services)` 생성 (redirectUri = loopback)
- [ ] 7.6.6 `child_process.exec('open <url>')` 로 브라우저 열기
- [ ] 7.6.7 `waitForCode()` 대기 → `exchangeGoogleCode()` 호출 → 토큰 저장
- [ ] 7.6.8 성공 시 `"✓ Google authenticated! (gmail, calendar, drive)"` 출력
- [ ] 7.6.9 실패/타임아웃 시 `"⚠ Run 'pilot-ai auth google' later"` 안내 출력 (init 중단 X)
- [ ] 7.6.10 빌드 확인

### 7.6-B. addtool 가이드 개선 (`src/cli/tools.ts`)

- [ ] 7.6.11 google-drive addtool 시 Console 설정 가이드 추가 (L190 이전)
- [ ] 7.6.12 Client ID/Secret 입력 후 OAuth 인증 플로우 자동 실행
- [ ] 7.6.13 이미 `google-oauth-tokens`가 Keychain에 있으면 "Already authenticated" 표시 + 재인증 여부 confirm
- [ ] 7.6.14 빌드 확인

---

## 7.7 doctor 진단 추가 (P2)

**수정 파일:** `src/cli/doctor.ts`

- [ ] 7.7.1 Google 진단 섹션 추가: "Google OAuth" 헤더
- [ ] 7.7.2 `getSecret('google-client-id')` 존재 확인 → 결과 출력 (✓/✗)
- [ ] 7.7.3 `getSecret('google-client-secret')` 존재 확인 → 결과 출력
- [ ] 7.7.4 `getSecret('google-oauth-tokens')` 존재 확인 → 결과 출력
- [ ] 7.7.5 토큰 존재 시 `expiresAt` 파싱하여 만료 여부 표시 (만료됨/유효)
- [ ] 7.7.6 토큰 없을 시 안내: `"Run 'pilot-ai auth google' to authenticate"`
- [ ] 7.7.7 빌드 확인

---

## 7.8 Slack/Telegram msg_too_long 에러 수정 (P0)

### 7.8-A. core.ts 응답 전송 로직 변경

**수정 파일:** `src/agent/core.ts`

- [ ] 7.8.1 `split.ts`에서 `MAX_MESSAGE_LENGTH` import 추가
- [ ] 7.8.2 플랫폼별 maxLen 결정 로직 추가 (slack: 4000, telegram: 4096)
- [ ] 7.8.3 L167 `updateText()` 호출 전 `response.length <= maxLen` 분기 추가
- [ ] 7.8.4 짧은 응답: 기존 방식 유지 (`updateText(channelId, statusMsgId, response)`)
- [ ] 7.8.5 긴 응답: `updateText(channelId, statusMsgId, '✅ Done')` + `sendText(channelId, response, threadId)`
- [ ] 7.8.6 에러 응답 (L190-193) 도 동일 패턴 적용: 에러 메시지 길이 초과 시 분기
- [ ] 7.8.7 빌드 확인

### 7.8-B. Slack adapter 안전망

**수정 파일:** `src/messenger/slack.ts`

- [ ] 7.8.8 `updateText()`에 truncate 안전망 추가: `text.length > MAX_MESSAGE_LENGTH.slack` 시 잘라내기 + `_(message truncated)_` 경고 첨부
- [ ] 7.8.9 `sendApproval()`: section block text를 3,000자로 truncate 처리
- [ ] 7.8.10 빌드 확인

### 7.8-C. Telegram adapter 안전망

**수정 파일:** `src/messenger/telegram.ts`

- [ ] 7.8.11 `updateText()` 분기 추가: `text.length <= MAX_MESSAGE_LENGTH.telegram` 시 기존 방식, 초과 시 첫 chunk edit + 나머지 chunk 새 메시지 전송
- [ ] 7.8.12 `sendApproval()`: `splitMessage()` 적용, 마지막 chunk에만 inline keyboard 첨부
- [ ] 7.8.13 빌드 확인

### 7.8-D. split.ts 검증 및 테스트

**수정/검토 파일:** `src/messenger/split.ts`

- [ ] 7.8.14 `splitMessage()`: code block (```) 분할 시 열림/닫힘 쌍 정합성 재확인
- [ ] 7.8.15 Markdown 볼드(`**`), 이탤릭(`_`), 링크(`[]()`) 분할 시 구문 깨짐 여부 검토
- [ ] 7.8.16 빈 문자열, 정확히 maxLength 길이, maxLength+1 길이 엣지 케이스 테스트 추가

### 7.8-E. 통합 테스트

- [ ] 7.8.17 `tests/messenger/slack.test.ts`: 4,000자 초과 메시지로 `updateText()` 호출 시 truncate 동작 확인
- [ ] 7.8.18 `tests/messenger/telegram.test.ts`: 4,096자 초과 메시지로 `updateText()` 호출 시 분할 동작 확인
- [ ] 7.8.19 `tests/agent/core.test.ts`: 긴 응답 시 `updateText` → `sendText` 전환 동작 확인 (mock messenger)
- [ ] 7.8.20 전체 테스트 통과 확인 (`npm test`)

---

## 7.9 에러 핸들링 강화 (P2)

**수정 파일:** `src/tools/google-auth.ts`, `src/tools/email.ts`

- [ ] 7.9.1 `exchangeGoogleCode()`: `res.ok` 체크 추가, HTTP 4xx/5xx 시 상태코드 포함 에러 throw
- [ ] 7.9.2 `getGoogleAccessToken()`: refresh 실패 시 `"토큰이 만료되었습니다. 'pilot-ai auth google' 실행"` 안내 메시지
- [ ] 7.9.3 `getGoogleAccessToken()`: `invalid_grant` 에러 감지 → 토큰 삭제 + 재인증 안내
- [ ] 7.9.4 `email.ts`의 `gmailFetch()`: HTTP 401 시 토큰 만료 안내 메시지 추가
- [ ] 7.9.5 빌드 확인 + 테스트 통과
