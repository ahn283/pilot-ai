# Phase 11: Google OAuth 400 Fix — Checklist

## P0: 즉시 수정 (400 에러 직접 원인)

- [x] **redirect_uri 경로 제거**
  - `src/utils/oauth-callback-server.ts:115` — `/callback` 경로 제거
  - `src/utils/oauth-callback-server.ts:63` — pathname 체크를 `/` 포함하도록 수정
  - redirect_uri: `http://127.0.0.1:{port}` (경로 없음)

- [x] **client_id sanitization + URL 인코딩**
  - `src/tools/google-auth.ts` — `sanitizeCredential()` 함수 추가, `configureGoogle()`에서 적용
  - `src/tools/google-auth.ts` — `URLSearchParams` 사용으로 자동 인코딩

- [x] **OAuth 400 에러 메시지 파싱**
  - `src/tools/google-auth.ts` — redirect_uri_mismatch, invalid_client, invalid_grant 감지
  - 각 에러별 구체적 해결 가이드 출력

- [x] **init 안내 메시지 개선**
  - `src/cli/init.ts` — Step 0: OAuth Consent Screen 설정 안내 추가
  - Desktop app 타입 강조 (⚠️ 경고)

## P1: 보안 베스트 프랙티스

- [x] **PKCE 도입**
  - `src/tools/google-auth.ts` — generateCodeVerifier(), generateCodeChallenge() 추가
  - `getGoogleAuthUrl()` — code_challenge, code_challenge_method, state 파라미터 추가
  - `exchangeGoogleCode()` — code_verifier 파라미터 추가
  - 호출부 수정: `init.ts`, `auth.ts`, `tools.ts`

- [x] **state 파라미터 검증**
  - `src/tools/google-auth.ts` — getGoogleAuthUrl()에서 state 생성/반환
  - 콜백 수신 시 state 일치 검증 (init.ts, auth.ts, tools.ts)

- [x] **gcp-oauth.keys.json redirect_uri 수정**
  - `src/cli/init.ts` — `http://localhost:3000/oauth2callback` → `http://127.0.0.1`
  - `src/cli/tools.ts` — 동일 적용

## 검증

- [x] `npm run build` 성공
- [x] 기존 테스트 통과 (79 files, 672 tests)
