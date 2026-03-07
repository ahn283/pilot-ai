# Pilot - Development Checklist

## Phase 0: Project Setup

### 프로젝트 초기화
- [x] npm 패키지 초기화 (`package.json`, `tsconfig.json`)
- [x] TypeScript + ESLint + Prettier 설정
- [x] 프로젝트 디렉토리 구조 생성 (`src/`, `tests/`, `guides/`)
- [x] bin 엔트리 설정 (`npx pilot-ai` / `pilot-ai` 명령어 동작)
- [x] 기본 빌드 & 실행 파이프라인 확인

---

## Phase 1: MVP

### 1.1 Config & Keychain
- [x] `~/.pilot/` 디렉토리 자동 생성
- [x] `config/schema.ts` - 설정 스키마 정의 (zod 등)
- [x] `config/store.ts` - config.json 읽기/쓰기
- [x] `config/keychain.ts` - macOS Keychain 연동 (토큰/키 암호화 저장)
- [x] `chmod 600` 파일 퍼미션 자동 설정

### 1.2 Claude Code CLI 연동
- [x] `agent/claude.ts` - `claude -p` subprocess 호출 기본 구현
- [x] `--cwd` 옵션으로 작업 디렉토리 지정
- [x] `--output-format json` 응답 파싱
- [x] `--allowedTools` 옵션 연동
- [x] CLI 바이너리 존재 여부 확인 (`which claude`)
- [x] API Key fallback 모드 구현 (`@anthropic-ai/sdk`)
- [x] 타임아웃 및 에러 핸들링

### 1.3 Messenger Adapter
- [x] `messenger/adapter.ts` - MessengerAdapter 인터페이스 정의
- [x] `messenger/factory.ts` - config 기반 어댑터 팩토리
- [x] **Slack 구현체**
  - [x] `messenger/slack.ts` - Slack Bolt SDK 연동
  - [x] Socket Mode 설정 (외부 서버 불필요)
  - [x] 메시지 수신 핸들링
  - [x] 텍스트 응답 전송
  - [x] 스레드 기반 대화
  - [x] Interactive Message 버튼 (승인/거부)
- [x] **Telegram 구현체**
  - [x] `messenger/telegram.ts` - telegraf 연동
  - [x] Long Polling 설정
  - [x] 메시지 수신 핸들링
  - [x] 텍스트 응답 전송
  - [x] Reply 기반 대화
  - [x] Inline Keyboard 버튼 (승인/거부)

### 1.4 Security (기본)
- [ ] `security/auth.ts` - User ID / Chat ID 화이트리스트
- [ ] 인가되지 않은 사용자 메시지 무시 (응답 없음)
- [ ] Slack request signing 검증
- [ ] `security/sandbox.ts` - Filesystem path 제한
  - [ ] 허용 경로 화이트리스트
  - [ ] 차단 경로 (`~/.pilot`, `~/.ssh`, `~/.gnupg`, `~/.aws`)
  - [ ] Path traversal 방지 (경로 정규화 후 검증)
- [ ] Shell 명령어 블랙리스트 (`rm -rf /`, `curl|sh` 등)
- [ ] subprocess 환경변수 격리
- [ ] `security/prompt-guard.ts` - 프롬프트 인젝션 방어
  - [ ] System prompt에 외부 데이터 지시 무시 명시
  - [ ] 사용자 명령과 도구 결과 분리 태깅
- [ ] `security/audit.ts` - 감사 로그
  - [ ] 모든 명령/실행/결과를 `~/.pilot/logs/audit.jsonl`에 기록
  - [ ] 토큰/키 마스킹 처리

### 1.5 Agent Core
- [ ] `agent/core.ts` - 메인 에이전트 루프
  - [ ] 메신저에서 메시지 수신
  - [ ] 인증 검증
  - [ ] Claude에 프롬프트 전달 (메모리 컨텍스트 포함)
  - [ ] 응답 파싱 및 도구 실행 판단
  - [ ] 결과를 메신저로 전송
- [ ] `agent/planner.ts` - 작업 계획 수립
  - [ ] Claude에게 실행 계획 요청
  - [ ] 계획의 위험도 분류
- [ ] `agent/safety.ts` - 위험도 판단
  - [ ] Safe / Moderate / Dangerous 분류 로직
  - [ ] Dangerous 작업 시 메신저로 승인 요청
  - [ ] 승인/거부 콜백 처리
  - [ ] 승인 타임아웃 (기본 30분)

### 1.6 Tools (기본)
- [ ] `tools/filesystem.ts` - 파일/폴더 CRUD
  - [ ] 읽기, 쓰기, 생성, 삭제, 이동, 복사
  - [ ] 파일 검색 (이름, 내용)
  - [ ] 디렉토리 구조 탐색
  - [ ] sandbox 경로 검증 연동
- [ ] `tools/shell.ts` - Shell 명령 실행
  - [ ] 명령어 블랙리스트 검증 연동
  - [ ] stdout/stderr 캡처
  - [ ] 타임아웃 설정
  - [ ] 환경변수 격리

### 1.7 Task Queue
- [ ] `agent/queue.ts` - 순차 실행 큐 (FIFO)
  - [ ] Task 인터페이스 정의 (id, status, project, command 등)
  - [ ] 큐 진입 & 순차 실행
  - [ ] 상태 관리 (queued → running → completed/failed)
  - [ ] 각 작업을 메신저 스레드에 매핑
  - [ ] 진행 상황 실시간 업데이트
  - [ ] 큐 상태 조회 ("작업 현황")
  - [ ] 대기 중 작업 취소

### 1.8 Multi-Project Management
- [ ] `agent/project.ts` - 프로젝트 레지스트리
  - [ ] `~/.pilot/projects.json` 읽기/쓰기
  - [ ] 프로젝트 등록 (이름 + 경로)
  - [ ] 루트 디렉토리 자동 스캔 (package.json, .git 등 감지)
  - [ ] 프로젝트 이름 매칭 (정확 → 경로 → fuzzy → 질문)
  - [ ] 새 프로젝트 생성 시 자동 등록
- [ ] `cli/project.ts` - CLI 명령어
  - [ ] `npx pilot-ai project add <name> <path>`
  - [ ] `npx pilot-ai project list`
  - [ ] `npx pilot-ai project scan <root-dirs...>`
  - [ ] `npx pilot-ai project remove <name>`

### 1.9 Persistent Memory
- [ ] `agent/memory.ts` - 메모리 관리
  - [ ] `~/.pilot/memory/` 디렉토리 구조 생성
  - [ ] `MEMORY.md` 읽기/쓰기 (핵심 사용자 선호)
  - [ ] `projects/{name}.md` 읽기/쓰기 (프로젝트 지식)
  - [ ] `history/{date}.md` 작업 히스토리 자동 기록
  - [ ] Claude 프롬프트에 관련 메모리 자동 주입
  - [ ] 토큰 관리 (MEMORY.md 200줄 제한, 요약본 사용)
  - [ ] 사용자 선호 자동 감지 & 저장
  - [ ] 프로젝트 첫 작업 시 스택/구조 분석 & 메모리 생성
- [ ] 메신저 명령 연동
  - [ ] "내 메모리 보여줘" → MEMORY.md 전송
  - [ ] "api 프로젝트 메모리 보여줘" → projects/api.md 전송
  - [ ] "커밋 메시지 영어로 바꿔줘" → MEMORY.md 업데이트
  - [ ] "메모리 초기화해줘" → 확인 후 초기화

### 1.10 Onboarding CLI
- [ ] `cli/init.ts` - 대화형 셋업 위저드
  - [ ] Claude Code CLI 설치 확인 + `claude -p` 테스트
  - [ ] (대안) API Key 입력 & 검증
  - [ ] 메신저 선택 (Slack / Telegram)
  - [ ] Slack: App 생성 가이드 → 토큰 입력 → 연결 테스트
  - [ ] Telegram: BotFather 가이드 → Bot Token 입력 → 연결 테스트
  - [ ] User ID / Chat ID 자동 등록 (화이트리스트)
  - [ ] 토큰을 macOS Keychain에 저장
  - [ ] 연결 테스트 (메신저로 테스트 메시지 전송)

### 1.11 Process Management (launchd)
- [ ] `cli/start.ts` - 에이전트 시작
  - [ ] plist 파일 생성 (`~/Library/LaunchAgents/com.pilot.agent.plist`)
  - [ ] Node.js 경로 & daemon.js 경로 자동 감지
  - [ ] `launchctl load` 실행
  - [ ] 시작 확인 메시지
- [ ] `cli/stop.ts` - 에이전트 중지
  - [ ] `launchctl unload` 실행
  - [ ] plist 파일 제거
- [ ] `cli/status.ts` - 상태 확인
  - [ ] `launchctl list` 파싱
  - [ ] PID, 실행 시간 표시
- [ ] `cli/logs.ts` - 로그 조회
  - [ ] `~/.pilot/logs/` 로그 파일 tail
  - [ ] `--follow` 옵션

### 1.12 통합 테스트 (MVP)
- [ ] 온보딩 플로우 E2E 테스트
- [ ] 메신저 → Claude → Filesystem 전체 파이프라인
- [ ] 위험 작업 승인/거부 플로우
- [ ] 프로젝트 인식 & `--cwd` 실행
- [ ] 작업 큐 순차 실행
- [ ] 메모리 쓰기/읽기/프롬프트 주입
- [ ] 보안: 비인가 사용자 차단, sandbox 검증

---

## Phase 2

### 2.1 Browser (Playwright)
- [ ] `tools/browser.ts` - Playwright 연동
  - [ ] Chromium 브라우저 실행/종료
  - [ ] 페이지 탐색 (URL 이동)
  - [ ] 요소 클릭, 텍스트 입력, 폼 제출
  - [ ] 페이지 콘텐츠 추출 (텍스트, 테이블)
  - [ ] 스크린샷 캡처 → 메신저로 전송
  - [ ] 파일 다운로드 관리
  - [ ] 브라우저 프로필 격리 (기본 프로필과 분리)
  - [ ] 세션/쿠키 관리 (암호화 저장)
- [ ] 온보딩에 Playwright 브라우저 자동 설치 추가

### 2.2 Notion Integration
- [ ] `tools/notion.ts` - @notionhq/client 연동
  - [ ] 페이지 생성, 읽기, 수정
  - [ ] 데이터베이스 쿼리, 항목 추가/수정
  - [ ] 페이지 검색
  - [ ] 콘텐츠 요약/보고서 생성
- [ ] 온보딩에 Notion Integration 가이드 + API 키 입력 추가

### 2.3 프로젝트 간 병렬 실행
- [ ] `agent/queue.ts` 업데이트
  - [ ] 서로 다른 프로젝트 작업은 동시 실행
  - [ ] 같은 프로젝트 작업은 순차 유지
  - [ ] 프로젝트 무관 작업 (Notion, 브라우저) 병렬 가능
  - [ ] 동시 실행 개수 제한 (Claude CLI rate limit 고려)

### 2.4 Heartbeat Scheduler
- [ ] `agent/heartbeat.ts` - 스케줄러 구현
  - [ ] 타이머 기반 주기적 실행 (node-cron 또는 자체 구현)
  - [ ] `~/.pilot/HEARTBEAT.md` 파싱 & 실행
  - [ ] `~/.pilot/cron-jobs.json` 관리
  - [ ] cron 표현식 파싱
  - [ ] 각 예약 작업을 독립 세션으로 실행
  - [ ] 실행 결과 메신저로 보고 (요약)
  - [ ] 실패 시 에러 알림
  - [ ] Dangerous 작업은 실행 전 승인 요청
- [ ] 메신저 명령 연동
  - [ ] "매일 9시에 ~~해줘" → cron job 등록
  - [ ] "예약 작업 목록" → 전체 조회
  - [ ] "예약 N번 취소" → 삭제
  - [ ] "예약 N번 비활성화/활성화" → enabled 토글

### 2.5 Skills System
- [ ] `agent/skills.ts` - 스킬 관리
  - [ ] `~/.pilot/skills/` 디렉토리 스캔
  - [ ] 스킬 Markdown 파싱 (트리거, 절차, 참고)
  - [ ] 사용자 메시지와 트리거 매칭
  - [ ] 매칭된 스킬 절차를 Claude 프롬프트에 주입
  - [ ] 매칭 안 되면 일반 추론으로 fallback
- [ ] 메신저 명령 연동
  - [ ] "스킬 목록" → 전체 조회
  - [ ] "새 스킬 만들어줘 - ~~" → 스킬 파일 생성
  - [ ] "~~ 스킬 보여줘" → 스킬 내용 전송

### 2.6 통합 테스트 (Phase 2)
- [ ] 브라우저 자동화 E2E (페이지 탐색, 폼 입력, 스크린샷)
- [ ] Notion CRUD 테스트
- [ ] 병렬 실행 테스트 (다른 프로젝트 동시 작업)
- [ ] Heartbeat 스케줄 실행 테스트
- [ ] 스킬 매칭 & 실행 테스트

---

## Phase 3

### 3.1 VSCode Integration
- [ ] `tools/vscode.ts` - VSCode CLI 연동
  - [ ] `code` CLI 존재 확인
  - [ ] 파일/폴더 열기
  - [ ] 터미널 명령 실행
  - [ ] Git 작업 (commit, push, PR 생성)

### 3.2 동일 프로젝트 Worktree 병렬
- [ ] `agent/queue.ts` 업데이트
  - [ ] 같은 프로젝트 동시 작업 요청 시 git worktree 생성
  - [ ] 각 worktree에서 독립 실행
  - [ ] 완료 후 PR 생성
  - [ ] worktree 자동 정리

### 3.3 Semantic Search
- [ ] 임베딩 모델 선택 (로컬 모델 또는 API)
- [ ] 메모리/히스토리 Markdown 청크 분할
- [ ] 청크별 임베딩 벡터 생성
- [ ] SQLite + vector extension 로컬 인덱스
- [ ] 사용자 질문 → 유사도 검색 → 관련 메모리 반환
- [ ] 메모리 변경 시 인덱스 자동 업데이트

### 3.4 복합 작업
- [ ] 여러 도구를 조합한 멀티스텝 작업 지원
  - [ ] 예: "Linear 이슈 가져와서 → Notion에 정리 → 메신저로 링크 공유"
- [ ] 작업 간 데이터 전달 파이프라인

### 3.5 통합 테스트 (Phase 3)
- [ ] VSCode 연동 테스트
- [ ] Worktree 병렬 실행 & PR 생성 테스트
- [ ] Semantic Search 정확도 테스트
- [ ] 복합 작업 E2E 테스트
