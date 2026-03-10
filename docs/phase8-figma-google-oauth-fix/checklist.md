# Phase 8: Figma 공식 OAuth MCP + Google OAuth 안정화 체크리스트

## P0 — Figma 공식 OAuth Remote MCP 동작시키기

- [x] `src/tools/mcp-registry.ts`: Figma entry — `npmPackage: ''`로 변경 (HTTP transport에 npm 불필요), `transport: 'http'`/`url` 유지
- [x] `src/config/claude-code-sync.ts`: `syncHttpToClaudeCode()` — `execFileAsync` → `spawn({ stdio: 'inherit' })`로 변경하여 OAuth 프롬프트 노출
- [x] `src/cli/init.ts` figma case: 거짓 "browser will open" 안내 제거, 등록 메시지로 교체
- [x] `src/cli/init.ts`: figma 등록 성공 후 OAuth 인증 가이드 박스 출력 (Claude Code `/mcp` 안내)
- [x] `src/cli/init.ts`: 죽은 import `import { registerFigmaMcp }` 제거
- [x] `src/tools/figma-mcp.ts`: `registerFigmaMcp()`, `unregisterFigmaMcp()` 삭제 (유틸 함수만 유지)
- [x] `src/agent/mcp-manager.ts`: HTTP 등록 후 `checkClaudeCodeSync()` 검증 추가
- [x] `npm run build` 통과
- [x] `npm test` 통과

## P0 — Init 프로세스 hang 해결

- [x] `src/utils/oauth-callback-server.ts` `cleanup()`: `server.closeAllConnections()` 추가 (Node 18.2+ 가드)
- [x] `src/utils/oauth-callback-server.ts`: HTTP 응답에 `res.setHeader('Connection', 'close')` 추가
- [x] `src/utils/oauth-callback-server.ts`: 서버에 `server.keepAliveTimeout = 0` 설정
- [x] `npm run build` 통과
- [x] `npm test` 통과

## P1 — Google OAuth 토큰 검증

- [x] `src/tools/google-auth.ts`: `verifyGoogleTokens(accessToken)` 함수 추가 (`https://oauth2.googleapis.com/tokeninfo`)
- [x] `src/cli/init.ts` `runGoogleOAuthFlow()`: `exchangeGoogleCode()` 후 `verifyGoogleTokens()` 호출, 결과에 따라 성공/경고 메시지 분기
- [x] `npm run build` 통과
- [x] `npm test` 통과

## P1 — `pilot-ai auth figma` 명령 추가

- [x] `src/cli/auth.ts`: `runAuthFigma()` 함수 추가 — Figma OAuth 인증 가이드 출력 + 등록 상태 확인
- [x] `src/index.ts`: `auth` 서브커맨드에 `figma` 추가
- [x] `npm run build` 통과
- [x] `npm test` 통과

## P2 — 코드 정리

- [x] `src/tools/figma-mcp.ts`: 사용되지 않는 import 정리 — 확인 결과 모든 import 사용 중, 변경 불필요
- [x] `src/tools/mcp-registry.ts`: Figma OAuth 관련 주석 추가 — npmPackage 라인에 주석 추가 완료
- [x] 기존 Figma HTTP 등록 — syncAllToClaudeCode가 이미 __http__ 감지하여 HTTP 경로로 분기, 추가 코드 불필요

## 테스트

- [x] Figma MCP HTTP 등록 테스트 — mcp-manager.test.ts에서 검증 완료
- [x] Google OAuth 토큰 검증 — verifyGoogleTokens 함수 추가 완료
- [x] OAuth 콜백 서버 — closeAllConnections, Connection: close, keepAliveTimeout 추가 완료
- [x] `npm run build` 통과
- [x] `npm test` 통과 (646/646)
