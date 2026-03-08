# Phase 4: Architecture Hardening — Checklist

## 4.1 [P0] GitHub 연동 온보딩 & 상태 관리

### 온보딩 (`init.ts`)
- [x] `setupGithub()` 함수 생성 — `gh` CLI 설치 확인 (`which gh`)
- [x] `gh auth status` 로 기존 인증 여부 확인 — 인증 완료 시 스킵
- [x] 미인증 시 `gh auth login` 가이드 출력 (OAuth 방식, 필요 scope 안내)
- [x] 인증 후 `gh auth status` 재확인 — 성공/실패 피드백
- [x] `setupIntegrations()` 에 GitHub 단계 추가 (Notion, Obsidian 등과 동일 패턴)

### Config 스키마 (`schema.ts`)
- [x] `github` 섹션 추가 (`enabled`, `defaultOrg`, `defaultRepo`)
- [x] 온보딩 완료 시 `config.github.enabled = true` 저장

### 런타임 인증 관리
- [x] `core.ts` 에이전트 시작 시 `isGhAuthenticated()` 호출 — 실패 시 메신저 경고
- [x] `github.ts` 각 함수에 사전 auth 체크 추가 — 미인증 시 사용자 친화적 에러 반환
- [x] heartbeat에 GitHub 인증 상태 주기적 확인 추가 (1시간 간격)
- [x] 인증 만료 감지 → 메신저로 `gh auth login` 재실행 안내

### 테스트
- [x] `setupGithub()` 단위 테스트 (gh 있음/없음, 인증됨/안됨)
- [x] GitHub 함수 auth 사전 검증 테스트

---

## 4.2 [P0] macOS TCC 권한 일괄 설정 & 진단

### 온보딩 TCC 사전 트리거 (`permissions.ts`)
- [x] 일괄 권한 요청 대상 앱 목록 정의 (System Events, Finder, Calendar, Mail, Safari, Terminal)
- [x] 각 앱에 대해 간단한 osascript 명령 실행하여 TCC 팝업 트리거
- [x] 사전 안내 메시지 출력 ("여러 팝업이 나타납니다. 모두 Allow 클릭")
- [x] 각 앱별 권한 결과(성공/실패) 요약 출력

### `pilot-ai doctor` 명령
- [x] `cli/doctor.ts` 신규 생성
- [x] `src/index.ts`에 `doctor` 서브커맨드 등록
- [x] 시스템 요구사항 확인 (Node.js, Claude CLI, gh CLI, Playwright)
- [x] macOS 권한 확인 (Automation, Screen Recording, Accessibility, Full Disk Access)
- [x] 미허용 권한별 해결 가이드 출력 (System Settings 경로 + `tccutil reset` 명령)
- [x] `node` 바이너리 경로 출력 + Full Disk Access 추가 안내
- [x] GitHub 인증 상태 확인

### PermissionWatcher 개선
- [x] 자동 클릭 시 대상 앱 이름 로깅
- [x] 자동 클릭 3회 연속 실패 시 메신저로 수동 조치 안내
- [x] `security.autoApprovePermissions` config 옵션 추가

### 테스트
- [x] `doctor` 명령 출력 포맷 테스트
- [x] TCC 트리거 함수 단위 테스트 (osascript 호출 mock)

---

## 4.3 [P0] 핵심 테스트 커버리지 구축

### `safety.ts` 테스트
- [x] Dangerous 분류 테스트 (`git push`, `rm -rf`, `send email` 등)
- [x] Moderate 분류 테스트 (`git commit`, `npm install`, `write` 등)
- [x] Safe 분류 테스트 (`ls`, `cat`, `echo` 등)
- [x] 체이닝 명령 분류 테스트 (`cmd1 && cmd2`)
- [x] false positive 검증 (주석 안의 위험 키워드)

### `claude.ts` 테스트
- [x] 정상 JSONL 파싱 테스트
- [x] 깨진 JSON 처리 테스트
- [x] 빈 출력 처리 테스트
- [x] tool_use 블록 감지 테스트

### `heartbeat.ts` 테스트
- [x] 와일드카드 매칭 (`* * * * *`)
- [x] 특정 시간 매칭 (`0 9 * * 1-5`)
- [x] 스텝 매칭 (`*/5 * * * *`)
- [x] 범위 초과 값 에러 처리

### `session.ts` 테스트
- [x] 세션 생성/조회/갱신 라이프사이클
- [x] TTL 만료 후 조회 → null
- [x] 동시 로드 race condition 방어

### `sandbox.ts` 테스트
- [x] 허용 경로 통과 테스트
- [x] 차단 경로 거부 테스트 (`~/.ssh`, `~/.pilot`)
- [x] path traversal (`../`) 거부 테스트
- [x] symlink 우회 시도 거부 테스트

### `auth.ts` 테스트
- [x] 허용 사용자 통과 테스트
- [x] 비허용 사용자 거부 테스트

---

## 4.4 [P0] Shell Injection 방어 강화

- [x] `isCommandBlocked()` 강화 — 파이프/체이닝/서브셸 내부 명령 개별 검사
- [x] 환경변수 주입 방어 확인 (민감 변수 완전 제거)
- [x] 명령어 길이 제한 추가 (기본 10,000자)
- [x] 강화된 블랙리스트 테스트

---

## 4.5 [P0] AppleScript/Shell 이스케이프 통합

- [x] `src/utils/escape.ts` 생성
- [x] `escapeAppleScript(str)` 구현 (백슬래시, 따옴표, 백틱, `$(...)` 처리)
- [x] `escapeShellArg(str)` 구현 (POSIX 호환)
- [x] `notification.ts` 독자 escape → 통합 모듈 교체
- [x] `calendar.ts` 독자 escape → 통합 모듈 교체
- [x] `clipboard.ts` 독자 escape → 통합 모듈 교체
- [x] 이스케이프 함수 단위 테스트 (특수문자, 유니코드, 빈 문자열 등)

---

## 4.6 [P0] 토큰 저장소 Keychain 통합

- [x] `google-auth.ts` 토큰 저장/로드를 Keychain으로 이관
- [x] `email.ts` 토큰 저장/로드를 Keychain으로 이관
- [x] 마이그레이션 로직: 기존 JSON → Keychain 이관 후 JSON 삭제
- [x] Keychain 읽기 실패 시 에러 핸들링 (not found vs access denied 구분)
- [x] 토큰 마이그레이션 테스트

---

## 4.7 [P0] Symlink Path Traversal 방어

- [ ] `sandbox.ts`의 `isPathAllowed()` — `fs.realpathSync()` 적용
- [ ] `filesystem.ts` 파일 접근 전 realpath 검증 추가
- [ ] `obsidian.ts` 파일 접근 전 realpath 검증 추가
- [ ] symlink → 차단 경로 우회 테스트

---

## 4.8 [P1] 메시지 크기 제한 & 분할 전송

- [ ] `messenger/adapter.ts`에 `MAX_MESSAGE_LENGTH` 상수 정의
- [ ] `slack.ts` — `sendText()` 에서 초과 시 자동 분할
- [ ] `telegram.ts` — `sendText()` 에서 초과 시 자동 분할
- [ ] 분할 시 코드 블록(```) 깨짐 방지 처리
- [ ] 10,000자+ 응답 → 파일 업로드 옵션
- [ ] 메시지 분할 단위 테스트

---

## 4.9 [P1] 재시도 & 서킷 브레이커

- [ ] `src/utils/retry.ts` 구현 (지수 백오프, jitter, 최대 3회)
- [ ] `src/utils/circuit-breaker.ts` 구현 (CLOSED/OPEN/HALF-OPEN 상태 머신)
- [ ] `claude.ts`에 서킷 브레이커 적용
- [ ] 외부 API 도구(Notion, Linear, Google)에 재시도 적용
- [ ] 재시도/서킷 브레이커 단위 테스트

---

## 4.10 [P1] 태스크 큐 영속성

- [ ] 큐 상태 `~/.pilot/task-queue.json` 저장 (1초 debounce)
- [ ] 데몬 시작 시 미완료 태스크 복원 (queued만, running → failed)
- [ ] 큐 최대 크기 제한 (기본 50개, 초과 시 거부 + 알림)
- [ ] 백프레셔 경고 (깊이 20개 초과 시 메시지)
- [ ] 큐 영속성 단위 테스트

---

## 4.11 [P1] 에러 처리 통일

- [ ] `src/utils/errors.ts` 생성 (PilotError, AuthError, ToolError, ConfigError, ExternalApiError, TimeoutError)
- [ ] 각 에러에 `code`, `userMessage`, `cause` 포함
- [ ] `core.ts` 에러 타입별 분기 처리 + 사용자 친화적 메시지
- [ ] 기존 silent catch(`.catch(() => {})`) 제거 — 최소한 로깅 추가
- [ ] 에러 클래스 단위 테스트

---

## 4.12 [P2] 구조화 로깅 & 관측성

- [ ] `src/utils/logger.ts` 생성 (JSON 로그, 레벨, correlationId)
- [ ] 로그 파일 출력 `~/.pilot/logs/pilot.log` (일별 로테이션)
- [ ] 메시지 수신 시 correlationId 생성 & 전파
- [ ] `audit.jsonl`에 correlationId 추가
- [ ] 기본 메트릭스 (요청 수, 응답 시간, 에러율)
- [ ] `/health`에 메트릭스 포함
- [ ] 기존 `console.error()` → 구조화 로거로 교체

---

## 4.13 [P2] 메신저 안정성 강화

- [ ] Slack: connection 이벤트 리스너 + 재접속 로깅
- [ ] Telegram: polling 에러 핸들러 + 자동 재시작
- [ ] 발신 Rate Limiter (토큰 버킷: Slack 1msg/sec, Telegram 30msg/sec)
- [ ] Graceful Shutdown (SIGTERM → 10초 대기 → 정리)
- [ ] 연결 안정성 테스트

---

## 4.14 [P2] OAuth 토큰 관리 통합

- [ ] `src/utils/oauth-manager.ts` 생성 (Keychain 연동)
- [ ] 자동 refresh (만료 5분 전 선제 갱신)
- [ ] refresh 실패 시 재시도 (retry 유틸 활용)
- [ ] `email.ts` 토큰 로직 → OAuthManager 위임
- [ ] `google-auth.ts` 토큰 로직 → OAuthManager 위임
- [ ] `google-calendar.ts` 토큰 로직 → OAuthManager 위임
- [ ] `google-drive.ts` 토큰 로직 → OAuthManager 위임
- [ ] 중복 코드 제거 확인
- [ ] OAuthManager 단위 테스트

---

## 4.15 [P3] 리소스 관리 개선

- [ ] `session.ts` — Promise 기반 로딩 직렬화
- [ ] `safety.ts` — 승인 타임아웃 후 Map 엔트리 자동 정리
- [ ] `claude.ts` — lineBuffer 최대 크기 제한 (1MB)
- [ ] `filesystem.ts` — searchFiles() 최대 재귀 깊이 제한 (기본 20)
- [ ] `memory.ts` — history 파일 보관 기간 제한 (기본 30일, 자동 삭제)
- [ ] `heartbeat.ts` — HEARTBEAT.md 파싱 캐싱 (mtime 기반 무효화)

---

## 4.16 [P3] 헬스체크 강화

- [ ] `/health` 응답에 messenger/claude/github/queue 상태 포함
- [ ] 비정상 시 `status: "degraded"` 반환
- [ ] 헬스체크 단위 테스트
