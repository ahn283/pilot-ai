# Phase 10: 체크리스트

## 1. 대화 요약 모듈 신규 생성

- [x] `src/agent/conversation-summary.ts` — `ConversationSummary`, `TurnSummary` 인터페이스 정의
- [x] `loadSummary()` / `saveSummary()` — `~/.pilot/conversations/` 디렉토리에 JSON 파일 읽기/쓰기
- [x] `updateConversationSummary()` — 사용자 메시지 + 에이전트 응답으로 요약 갱신 (턴 추가, FIFO 10턴)
- [x] `getConversationSummaryText()` — 저장된 요약을 system prompt 주입용 텍스트로 포맷팅
- [x] `extractActionSummary()` — 에이전트 응답에서 핵심 행동 요약 추출 (첫 300자 + 패턴 매칭)
- [x] `extractModifiedFiles()` — 응답에서 수정 파일 경로 패턴 감지
- [x] `cleanupExpiredSummaries()` — 48시간 미사용 요약 파일 자동 삭제
- [x] 단위 테스트 작성 (`conversation-summary.test.ts`) — 25개 테스트 통과

## 2. core.ts 하이브리드 로직 적용

- [x] 매 턴 응답 후 `updateConversationSummary()` 호출 (비동기, 비차단)
- [x] 새 세션 시작 시 (resumeSessionId 없음) 대화 요약을 system prompt에 `<CONVERSATION_HISTORY>` 태그로 주입
- [x] `msg_too_long` 에러 캐치 → 세션 삭제 → 대화 요약 로드 → 새 세션으로 자동 재시도

## 3. 버그 수정

- [x] `core.ts` — resume 시 `existingSession.projectPath`로 projectPath 복원
- [x] `core.ts` — msg_too_long 에러 핸들러에서 threadId 산출을 세션 생성 로직과 일치시키기

## 4. 통합 테스트 및 검증

- [x] 빌드 통과 확인 (`npm run build`)
- [x] 전체 테스트 통과 확인 (`npm test`) — 79파일 671테스트 통과
- [ ] 수동 검증: Slack 스레드에서 5턴 이상 대화 후 맥락 유지 확인
