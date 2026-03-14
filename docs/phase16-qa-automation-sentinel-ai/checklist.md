# Phase 16: QA 자동화 — Sentinel AI MCP 연동 체크리스트

## A. MCP 레지스트리 업데이트

- [x] A1. `McpServerEntry.category` 타입에 `'qa'` 추가
- [x] A2. sentinel-ai 엔트리: category `'development'` → `'qa'` 변경
- [x] A3. sentinel-ai 엔트리: `envVars`에 `SENTINEL_REGISTRY_DIR`, `SENTINEL_REPORTS_DIR` 추가

## B. init 선택 흐름

- [x] B1. `getInitToolChoices()`의 `catOrder`에 `qa: 5` 추가 (QA / Testing 카테고리 표시)
- [x] B2. `collectAndRegisterMcpTool()`에 sentinel-ai 전용 분기 추가 (설치 모드 선택 + 환경변수 설정)

## C. addtool 설정 흐름

- [x] C1. `runAddTool()`에 sentinel-ai 전용 분기 추가
- [x] C2. 설치 모드 선택 프롬프트 구현 (npx / Local build)
- [x] C3. 로컬 빌드 모드: 엔트리포인트 경로 입력 + 파일 존재 검증
- [x] C4. 선택적 환경변수 설정 프롬프트 (SENTINEL_REGISTRY_DIR, SENTINEL_REPORTS_DIR)
- [x] C5. 이미 등록된 상태에서 재설정 여부 프롬프트

## D. MCP 등록 로직

- [x] D1. `registerSentinelAi()` 함수 구현 (npx / 로컬 빌드 분기, 환경변수 포함)
- [x] D2. `mcp-config.json` 저장 + Claude Code sync

## E. 테스트

- [x] E1. mcp-registry 카테고리 확장 테스트
- [x] E2. registerSentinelAi() npx 모드 테스트
- [x] E3. registerSentinelAi() 로컬 빌드 모드 테스트
- [x] E4. 환경변수 포함 등록 테스트
