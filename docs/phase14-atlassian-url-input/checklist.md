# Phase 14: Atlassian URL 입력 전환 — 체크리스트

## 구현

- [x] `src/tools/mcp-registry.ts` — `parseAtlassianSiteName()` 헬퍼 함수 추가
- [x] `src/tools/mcp-registry.ts` — Jira/Confluence envVars 설명 업데이트
- [x] `src/cli/tools.ts` — `addtool` 플로우: site name → URL 입력으로 변경
- [x] `src/cli/init.ts` — `init` 플로우: site name → URL 입력으로 변경
- [x] `src/agent/mcp-launcher.ts` — `SITE_URL` 패턴을 non-secret으로 분류 추가

## 가이드 메시지 업데이트

- [x] `tools.ts` — setup guide 메시지에서 "site name" → "URL" 안내로 변경
- [x] `init.ts` — setup guide 메시지에서 "site name" → "URL" 안내로 변경

## 테스트

- [x] `npm run build` 통과
- [x] `npm test` 전체 통과 (700 tests)
- [x] `parseAtlassianSiteName` 단위 테스트 추가 (7개 케이스)
