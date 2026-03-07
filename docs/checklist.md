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
- [x] `security/auth.ts` - User ID / Chat ID 화이트리스트
- [x] 인가되지 않은 사용자 메시지 무시 (응답 없음)
- [x] Slack request signing 검증
- [x] `security/sandbox.ts` - Filesystem path 제한
  - [x] 허용 경로 화이트리스트
  - [x] 차단 경로 (`~/.pilot`, `~/.ssh`, `~/.gnupg`, `~/.aws`)
  - [x] Path traversal 방지 (경로 정규화 후 검증)
- [x] Shell 명령어 블랙리스트 (`rm -rf /`, `curl|sh` 등)
- [x] subprocess 환경변수 격리
- [x] `security/prompt-guard.ts` - 프롬프트 인젝션 방어
  - [x] System prompt에 외부 데이터 지시 무시 명시
  - [x] 사용자 명령과 도구 결과 분리 태깅
- [x] `security/audit.ts` - 감사 로그
  - [x] 모든 명령/실행/결과를 `~/.pilot/logs/audit.jsonl`에 기록
  - [x] 토큰/키 마스킹 처리

### 1.5 Agent Core
- [x] `agent/core.ts` - 메인 에이전트 루프
  - [x] 메신저에서 메시지 수신
  - [x] 인증 검증
  - [x] Claude에 프롬프트 전달 (메모리 컨텍스트 포함)
  - [x] 응답 파싱 및 도구 실행 판단
  - [x] 결과를 메신저로 전송
- [x] `agent/planner.ts` - 작업 계획 수립
  - [x] Claude에게 실행 계획 요청
  - [x] 계획의 위험도 분류
- [x] `agent/safety.ts` - 위험도 판단
  - [x] Safe / Moderate / Dangerous 분류 로직
  - [x] Dangerous 작업 시 메신저로 승인 요청
  - [x] 승인/거부 콜백 처리
  - [x] 승인 타임아웃 (기본 30분)

### 1.6 Tools (기본)
- [x] `tools/filesystem.ts` - 파일/폴더 CRUD
  - [x] 읽기, 쓰기, 생성, 삭제, 이동, 복사
  - [x] 파일 검색 (이름, 내용)
  - [x] 디렉토리 구조 탐색
  - [x] sandbox 경로 검증 연동
- [x] `tools/shell.ts` - Shell 명령 실행
  - [x] 명령어 블랙리스트 검증 연동
  - [x] stdout/stderr 캡처
  - [x] 타임아웃 설정
  - [x] 환경변수 격리

### 1.7 Task Queue
- [x] `agent/queue.ts` - 순차 실행 큐 (FIFO)
  - [x] Task 인터페이스 정의 (id, status, project, command 등)
  - [x] 큐 진입 & 순차 실행
  - [x] 상태 관리 (queued → running → completed/failed)
  - [x] 각 작업을 메신저 스레드에 매핑
  - [x] 진행 상황 실시간 업데이트
  - [x] 큐 상태 조회 ("작업 현황")
  - [x] 대기 중 작업 취소

### 1.8 Multi-Project Management
- [x] `agent/project.ts` - 프로젝트 레지스트리
  - [x] `~/.pilot/projects.json` 읽기/쓰기
  - [x] 프로젝트 등록 (이름 + 경로)
  - [x] 루트 디렉토리 자동 스캔 (package.json, .git 등 감지)
  - [x] 프로젝트 이름 매칭 (정확 → 경로 → fuzzy → 질문)
  - [x] 새 프로젝트 생성 시 자동 등록
- [x] `cli/project.ts` - CLI 명령어
  - [x] `npx pilot-ai project add <name> <path>`
  - [x] `npx pilot-ai project list`
  - [x] `npx pilot-ai project scan <root-dirs...>`
  - [x] `npx pilot-ai project remove <name>`

### 1.9 Persistent Memory
- [x] `agent/memory.ts` - 메모리 관리
  - [x] `~/.pilot/memory/` 디렉토리 구조 생성
  - [x] `MEMORY.md` 읽기/쓰기 (핵심 사용자 선호)
  - [x] `projects/{name}.md` 읽기/쓰기 (프로젝트 지식)
  - [x] `history/{date}.md` 작업 히스토리 자동 기록
  - [x] Claude 프롬프트에 관련 메모리 자동 주입
  - [x] 토큰 관리 (MEMORY.md 200줄 제한, 요약본 사용)
  - [x] 사용자 선호 자동 감지 & 저장
  - [x] 프로젝트 첫 작업 시 스택/구조 분석 & 메모리 생성
- [x] 메신저 명령 연동
  - [x] "내 메모리 보여줘" → MEMORY.md 전송
  - [x] "api 프로젝트 메모리 보여줘" → projects/api.md 전송
  - [x] "커밋 메시지 영어로 바꿔줘" → MEMORY.md 업데이트
  - [x] "메모리 초기화해줘" → 확인 후 초기화

### 1.10 Onboarding CLI
- [x] `cli/init.ts` - 대화형 셋업 위저드
  - [x] Claude Code CLI 설치 확인 + `claude -p` 테스트
  - [x] (대안) API Key 입력 & 검증
  - [x] 메신저 선택 (Slack / Telegram)
  - [x] Slack: App 생성 가이드 → 토큰 입력 → 연결 테스트
  - [x] Telegram: BotFather 가이드 → Bot Token 입력 → 연결 테스트
  - [x] User ID / Chat ID 자동 등록 (화이트리스트)
  - [x] 토큰을 macOS Keychain에 저장
  - [x] 연결 테스트 (메신저로 테스트 메시지 전송)

### 1.11 Process Management (launchd)
- [x] `cli/start.ts` - 에이전트 시작
  - [x] plist 파일 생성 (`~/Library/LaunchAgents/com.pilot-ai.agent.plist`)
  - [x] Node.js 경로 & daemon.js 경로 자동 감지
  - [x] `launchctl load` 실행
  - [x] 시작 확인 메시지
- [x] `cli/stop.ts` - 에이전트 중지
  - [x] `launchctl unload` 실행
  - [x] plist 파일 제거
- [x] `cli/status.ts` - 상태 확인
  - [x] `launchctl list` 파싱
  - [x] PID, 실행 시간 표시
- [x] `cli/logs.ts` - 로그 조회
  - [x] `~/.pilot/logs/` 로그 파일 tail
  - [x] `--follow` 옵션

### 1.12 통합 테스트 (MVP)
- [x] 온보딩 플로우 E2E 테스트
- [x] 메신저 → Claude → Filesystem 전체 파이프라인
- [x] 위험 작업 승인/거부 플로우
- [x] 프로젝트 인식 & `--cwd` 실행
- [x] 작업 큐 순차 실행
- [x] 메모리 쓰기/읽기/프롬프트 주입
- [x] 보안: 비인가 사용자 차단, sandbox 검증

---

## Phase 2

### 2.1 Browser (Playwright)
- [x] `tools/browser.ts` - Playwright 연동
  - [x] Chromium 브라우저 실행/종료
  - [x] 페이지 탐색 (URL 이동)
  - [x] 요소 클릭, 텍스트 입력, 폼 제출
  - [x] 페이지 콘텐츠 추출 (텍스트, 테이블)
  - [x] 스크린샷 캡처 → 메신저로 전송
  - [x] 파일 다운로드 관리
  - [x] 브라우저 프로필 격리 (기본 프로필과 분리)
  - [ ] 세션/쿠키 관리 (암호화 저장)
- [ ] 온보딩에 Playwright 브라우저 자동 설치 추가

### 2.2 Notion Integration
- [x] `tools/notion.ts` - @notionhq/client 연동
  - [x] 페이지 생성, 읽기, 수정
  - [x] 데이터베이스 조회
  - [x] 페이지 검색
  - [x] 콘텐츠 블록 추가/읽기
- [ ] 온보딩에 Notion Integration 가이드 + API 키 입력 추가

### 2.3 프로젝트 간 병렬 실행
- [x] `agent/queue.ts` 업데이트
  - [x] 서로 다른 프로젝트 작업은 동시 실행
  - [x] 같은 프로젝트 작업은 순차 유지
  - [x] 프로젝트 무관 작업 (Notion, 브라우저) 병렬 가능
  - [x] 동시 실행 개수 제한 (Claude CLI rate limit 고려)

### 2.4 Heartbeat Scheduler
- [x] `agent/heartbeat.ts` - 스케줄러 엔진
  - [x] 타이머 기반 주기적 실행 (자체 구현, 60초 interval)
  - [x] `~/.pilot/HEARTBEAT.md` 파싱 & 실행
  - [x] `~/.pilot/cron-jobs.json` CRUD 관리
  - [x] cron 표현식 파싱 (5-field: min, hour, dom, mon, dow)
  - [x] 각 예약 작업을 독립 세션으로 실행 (tick → executor)
  - [x] 실패 시 lastError 기록
  - [ ] 실행 결과 메신저로 보고 (요약)
  - [ ] Dangerous 작업은 실행 전 승인 요청
- [ ] 스케줄 관련 자연어 명령은 LLM이 해석 → heartbeat CRUD 함수 호출 (tool 연동)

### 2.5 Skills System
- [x] `agent/skills.ts` - 스킬 엔진
  - [x] `~/.pilot/skills/` 디렉토리 스캔
  - [x] 스킬 Markdown 파싱 (트리거, 절차, 참고)
  - [x] 스킬 CRUD (create, get, list, delete)
  - [x] `buildSkillsContext()` - 전체 스킬을 XML로 Claude 프롬프트에 주입
  - [x] LLM이 trigger 기반으로 매칭 판단 (regex 매칭 없음)
- [ ] 스킬 관련 자연어 명령은 LLM이 해석 → skills CRUD 함수 호출 (tool 연동)

### 2.6 Webhook / HTTP API Endpoint
- [x] `api/server.ts` - node:http 로컬 HTTP 서버 (외부 의존성 없음)
  - [x] `POST /api/command` 엔드포인트
  - [x] `GET /health` 헬스체크
  - [x] Bearer token 인증
  - [x] localhost 전용 바인딩 (127.0.0.1)
  - [x] Rate limiting (30 req/min)
  - [x] `ApiServer.generateToken()` 랜덤 토큰 생성
- [ ] Apple Shortcuts 연동 가이드 작성
- [ ] Raycast extension 예제

### 2.7 GitHub Integration
- [ ] `tools/github.ts` - `gh` CLI 래퍼
  - [ ] PR 생성/조회/머지
  - [ ] 이슈 생성/조회/닫기
  - [ ] CI 상태 확인
  - [ ] diff 조회 및 리뷰

### 2.8 Clipboard / Screenshot
- [ ] `tools/clipboard.ts` - macOS 클립보드 연동
  - [ ] `pbpaste` 읽기
  - [ ] `pbcopy` 쓰기
  - [ ] `screencapture` 스크린샷
  - [ ] Claude Vision으로 이미지 분석

### 2.9 Multi-modal Input
- [ ] 메신저 어댑터 이미지 수신 지원
  - [ ] Slack: files:read로 이미지 다운로드
  - [ ] Telegram: getFile API로 이미지 다운로드
  - [ ] Base64 인코딩 → Claude Vision API

### 2.10 macOS Notifications
- [ ] `tools/notification.ts` - osascript 알림
  - [ ] 작업 완료/실패 시 데스크톱 알림
  - [ ] terminal-notifier 클릭 액션 (선택)

### 2.11 Obsidian Integration
- [ ] Obsidian vault 경로 config 등록
  - [ ] 마크다운 파일 읽기/쓰기 (filesystem 도구 활용)
  - [ ] Daily note 자동 생성/업데이트
  - [ ] 노트 검색

### 2.12 Linear / Jira Integration
- [ ] `tools/linear.ts` - Linear GraphQL API
  - [ ] 이슈 생성/조회/수정
  - [ ] 상태 변경
  - [ ] 백로그 조회
- [ ] 온보딩에 Linear API 키 입력 추가

### 2.13 Figma Integration
- [ ] Figma MCP 서버 연동 (claude -p에 MCP 설정 전달)
- [ ] `tools/figma.ts` - REST API 래퍼
  - [ ] 파일/프레임/컴포넌트 조회
  - [ ] 이미지 내보내기 (PNG/SVG)
  - [ ] 디자인 토큰/변수 조회
  - [ ] 코멘트 읽기/쓰기
- [ ] 온보딩에 Figma Personal Access Token 입력 추가

### 2.14 통합 테스트 (Phase 2)
- [ ] 브라우저 자동화 E2E (페이지 탐색, 폼 입력, 스크린샷)
- [ ] Notion CRUD 테스트
- [ ] 병렬 실행 테스트 (다른 프로젝트 동시 작업)
- [ ] Heartbeat 스케줄 실행 테스트
- [ ] 스킬 매칭 & 실행 테스트
- [ ] Webhook 엔드포인트 테스트
- [ ] GitHub CLI 연동 테스트
- [ ] 클립보드/스크린샷 테스트
- [ ] 이미지 멀티모달 테스트

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

### 3.5 Email Integration
- [ ] `tools/email.ts` - Gmail / Outlook 연동
  - [ ] OAuth2 인증 플로우
  - [ ] 이메일 목록 조회 / 검색
  - [ ] 이메일 내용 읽기 / 요약
  - [ ] 이메일 초안 작성
  - [ ] [Dangerous] 이메일 전송
  - [ ] 토큰 자동 refresh

### 3.6 Calendar Management
- [ ] `tools/calendar.ts` - Google Calendar / Apple Calendar
  - [ ] 일정 조회 (오늘/내일/이번 주)
  - [ ] 일정 생성/수정/삭제
  - [ ] 시간대 자동 처리
  - [ ] 빈 시간 검색 (focus block 자동 생성)

### 3.7 Voice Input/Output
- [ ] TTS: macOS `say` 명령 또는 ElevenLabs API
- [ ] STT: Whisper API 또는 Apple Speech
- [ ] Apple Shortcuts Dictate Text → Webhook 연동

### 3.8 Multi-Agent Orchestration
- [ ] 역할 기반 서브 에이전트 분업
  - [ ] Research / Planning / Coding / Review Agent
  - [ ] 공유 컨텍스트 관리
  - [ ] 에러 복구 및 재시도

### 3.9 통합 테스트 (Phase 3)
- [ ] VSCode 연동 테스트
- [ ] Worktree 병렬 실행 & PR 생성 테스트
- [ ] Semantic Search 정확도 테스트
- [ ] 복합 작업 E2E 테스트
- [ ] Email 연동 테스트
- [ ] Calendar 연동 테스트
- [ ] Voice I/O 테스트
