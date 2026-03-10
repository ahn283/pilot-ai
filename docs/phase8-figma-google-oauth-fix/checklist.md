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

- [ ] `src/tools/figma-mcp.ts`: 사용되지 않는 import 정리
- [ ] `src/tools/mcp-registry.ts`: Figma OAuth 관련 주석 추가 (고급 사용자 안내)
- [ ] 기존 Figma HTTP 등록(`__http__`)이 mcp-config.json에 남아있는 사용자를 위한 마이그레이션 검토

## 테스트

- [ ] Figma MCP HTTP 등록 + spawn stdio inherit 동작 확인 테스트
- [ ] Google OAuth 토큰 검증 성공/실패 단위 테스트
- [ ] OAuth 콜백 서버 `closeAllConnections` 후 연결 종료 확인 테스트
- [ ] `npm run build` 통과
- [ ] `npm test` 통과
