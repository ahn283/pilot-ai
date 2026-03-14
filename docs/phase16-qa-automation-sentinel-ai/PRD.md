# Phase 16: QA 자동화 — Sentinel AI MCP 연동 PRD

## 1. 개요

### 1.1 목적

pilot-ai에 QA 자동화 인프라인 **sentinel-ai**를 MCP 서버로 연동한다.
사용자가 `pilot-ai init` 또는 `pilot-ai addtool sentinel-ai`로 sentinel-ai를 선택하면, 설치 방식(로컬 빌드 / npx)을 묻고 MCP 설정을 자동 구성한다.

### 1.2 sentinel-ai란

sentinel-ai는 pilot-ai의 QA 실행 인프라다.
pilot-ai(LLM)가 PRD에서 테스트케이스를 생성하면, sentinel-ai가 Playwright(웹) / Maestro(Flutter, 예정)로 실행하고 결과를 반환한다.

```
pilot-ai (LLM) ──stdio──▶ sentinel-ai (MCP 서버)
                              ├─ Playwright (웹 E2E)
                              ├─ Maestro (Flutter, 예정)
                              └─ Data Log QA (analytics 검증, 예정)
```

> **@playwright/mcp와의 관계:** Microsoft의 `@playwright/mcp`는 "브라우저 직접 제어" MCP이고, sentinel-ai는 "테스트 관리 + 실행 + 리포팅" MCP이다. 경쟁이 아니라 보완 관계.

### 1.3 MCP 도구 (5개)

| 도구 | 설명 |
|------|------|
| `list_apps` | 등록된 앱 목록 반환 |
| `get_selectors` | 앱별 UI selector 매핑 반환 |
| `save_tests` | 생성된 테스트케이스 저장 |
| `run_tests` | Playwright/Maestro 테스트 실행 |
| `get_report` | 최근 테스트 결과 리포트 반환 |

---

## 2. 현재 상태

### 2.1 이미 완료된 부분

- `src/tools/mcp-registry.ts`에 sentinel-ai 엔트리가 등록됨 (id: `sentinel-ai`, category: `development`)
- `init`의 `getInitToolChoices()`에서 `skipMcp`에 포함되지 않아 이미 선택지에 노출됨
- `npmPackage: 'sentinel-ai'`로 npx 실행 경로 설정됨

### 2.2 부족한 부분

| # | 문제 | 설명 |
|---|------|------|
| 1 | **설치 방식 분기 없음** | sentinel-ai는 개발 환경에서는 로컬 빌드(`node /path/to/dist/index.js`), 프로덕션에서는 `npx sentinel-ai`로 실행. 현재는 npx만 지원 |
| 2 | **카테고리 부재** | QA/테스팅은 `development`에 묻혀 있음. 별도 카테고리 또는 명확한 설명 필요 |
| 3 | **addtool 커스텀 설정 흐름 없음** | 로컬 빌드 경로, 환경변수(SENTINEL_REGISTRY_DIR, SENTINEL_REPORTS_DIR) 등 sentinel-ai 전용 설정 프롬프트 부재 |
| 4 | **MCP 카테고리 확장** | `McpServerEntry.category`에 `'qa'` 타입 미존재 |

---

## 3. 설계

### 3.1 사용자 흐름

#### `pilot-ai init` 선택 시

```
Select tools to enable (space to select, enter to confirm):

  Development
    ◻ GitHub — Manage repos, issues, PRs
    ◻ Sentry — View and manage error tracking

  QA / Testing
    ◻ Sentinel AI — QA automation: Playwright/Maestro E2E tests & reports
```

#### `pilot-ai addtool sentinel-ai` 실행 시

```
── Sentinel AI Setup ──

Sentinel AI is a QA automation infrastructure that runs Playwright/Maestro tests.
Docs: https://github.com/eodin/sentinel-ai

? Installation mode:
  ❯ npx (recommended — uses published npm package)
    Local build (use a local clone of sentinel-ai)

[npx 선택 시]
  ✓ Registered sentinel-ai via npx sentinel-ai

[Local build 선택 시]
  Make sure you have built sentinel-ai first: cd sentinel-ai && npm run build
  ? Path to sentinel-ai MCP server entry point:
    (e.g. /Users/you/sentinel-ai/packages/mcp-server/dist/index.js)
  > /Users/ahnwoojin/Github/sentinel-ai/packages/mcp-server/dist/index.js
  ✓ Registered sentinel-ai via local build

? Configure optional environment variables? (y/N)
  [y 선택 시]
  ? SENTINEL_REGISTRY_DIR (app registry directory, default: sentinel-ai built-in):
  > (enter to skip)
  ? SENTINEL_REPORTS_DIR (report output directory, default: sentinel-ai built-in):
  > /Users/ahnwoojin/sentinel-reports

✓ sentinel-ai MCP server registered successfully.
```

### 3.2 MCP 설정 결과

#### npx 모드

```json
{
  "mcpServers": {
    "sentinel-ai": {
      "command": "npx",
      "args": ["-y", "sentinel-ai"]
    }
  }
}
```

#### 로컬 빌드 모드

```json
{
  "mcpServers": {
    "sentinel-ai": {
      "command": "node",
      "args": ["/absolute/path/to/sentinel-ai/packages/mcp-server/dist/index.js"]
    }
  }
}
```

#### 환경변수 설정 시

```json
{
  "mcpServers": {
    "sentinel-ai": {
      "command": "node",
      "args": ["/absolute/path/to/sentinel-ai/packages/mcp-server/dist/index.js"],
      "env": {
        "SENTINEL_REPORTS_DIR": "/Users/ahnwoojin/sentinel-reports"
      }
    }
  }
}
```

### 3.3 카테고리 확장

`McpServerEntry.category` 타입에 `'qa'`를 추가한다.

```typescript
category: 'design' | 'productivity' | 'development' | 'data' | 'communication' | 'qa';
```

sentinel-ai의 카테고리를 `'development'`에서 `'qa'`로 변경한다.
`getInitToolChoices()`의 `catOrder`에 `qa: 5`를 추가하여 development 뒤에 표시한다.

### 3.4 레지스트리 엔트리 업데이트

```typescript
{
  id: 'sentinel-ai',
  name: 'Sentinel AI',
  description: 'QA automation — run Playwright/Maestro E2E tests, manage test cases, and generate reports',
  npmPackage: 'sentinel-ai',
  envVars: {
    SENTINEL_REGISTRY_DIR: 'App registry directory path (optional)',
    SENTINEL_REPORTS_DIR: 'Report output directory path (optional)',
  },
  keywords: ['test', 'qa', 'testing', 'playwright', 'maestro', 'e2e', 'sentinel', 'test runner', 'analytics', 'data log'],
  category: 'qa',
}
```

### 3.5 addtool / init 커스텀 설정 흐름

`src/cli/tools.ts`의 `runAddTool()`과 `src/cli/init.ts`의 `collectAndRegisterMcpTool()`에 sentinel-ai 전용 분기를 추가한다.

**핵심 로직:**

1. **설치 방식 선택**: `npx` vs `Local build` (inquirer list)
2. **로컬 빌드 시**: 엔트리포인트 절대 경로 입력 + 파일 존재 검증
3. **환경변수 (선택)**: `SENTINEL_REGISTRY_DIR`, `SENTINEL_REPORTS_DIR` 입력 (빈 값 시 스킵)
4. **MCP 등록**: 선택한 방식에 따라 `mcp-config.json`에 기록 + Claude Code sync

**로컬 빌드 등록 시 `installMcpServer()` 우회:**
- 기존 `installMcpServer()`는 registry의 `npmPackage`를 기반으로 npx 명령을 생성함
- 로컬 빌드는 `node /path/to/dist/index.js` 형태이므로, `saveMcpConfig()` + `syncToClaudeCode()` 직접 호출 필요
- 별도 함수 `registerSentinelAi(mode, options)` 구현

---

## 4. 변경 대상 파일

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/tools/mcp-registry.ts` | **수정** | category 타입에 `'qa'` 추가, sentinel-ai 엔트리에 envVars 추가, category를 `'qa'`로 변경 |
| `src/cli/tools.ts` | **수정** | `runAddTool()`에 sentinel-ai 전용 설정 분기 추가 |
| `src/cli/init.ts` | **수정** | `getInitToolChoices()`의 catOrder에 qa 추가, `collectAndRegisterMcpTool()`에 sentinel-ai 분기 추가 |
| `src/agent/mcp-manager.ts` | **수정** | `registerSentinelAi()` 함수 추가 (로컬 빌드 모드 지원) |

---

## 5. 상세 구현 사항

### 5.1 mcp-registry.ts 변경

#### 5.1.1 category 타입 확장

```typescript
category: 'design' | 'productivity' | 'development' | 'data' | 'communication' | 'qa';
```

#### 5.1.2 sentinel-ai 엔트리 수정

- `category`: `'development'` → `'qa'`
- `envVars` 추가: `SENTINEL_REGISTRY_DIR`, `SENTINEL_REPORTS_DIR` (둘 다 optional, 경로 기반이므로 non-secret)

### 5.2 tools.ts — addtool sentinel-ai 분기

`runAddTool()`에서 `toolId === 'sentinel-ai'` 분기 추가:

1. 안내 메시지 출력 (sentinel-ai 설명 + GitHub URL)
2. 설치 모드 선택 프롬프트 (`npx` / `Local build`)
3. 로컬 빌드 시: 엔트리포인트 경로 입력 + `fs.existsSync()` 검증
4. 환경변수 설정 여부 + 값 입력
5. `registerSentinelAi()` 호출

### 5.3 init.ts — init 선택 시 sentinel-ai 처리

`collectAndRegisterMcpTool()`에서 `toolId === 'sentinel-ai'` 분기 추가:
- addtool과 동일한 설정 흐름 호출 (공통 함수로 추출)

`getInitToolChoices()`의 `catOrder`에 `qa: 5` 추가.

### 5.4 mcp-manager.ts — registerSentinelAi() 함수

```typescript
interface SentinelAiOptions {
  mode: 'npx' | 'local';
  localPath?: string;  // 로컬 빌드 엔트리포인트 절대 경로
  env?: Record<string, string>;  // 선택적 환경변수
}

export async function registerSentinelAi(options: SentinelAiOptions): Promise<void> {
  const config: McpServerConfig = options.mode === 'npx'
    ? { command: 'npx', args: ['-y', 'sentinel-ai'] }
    : { command: 'node', args: [options.localPath!] };

  if (options.env && Object.keys(options.env).length > 0) {
    config.env = options.env;
  }

  // mcp-config.json에 저장
  const mcpConfig = await loadMcpConfig();
  mcpConfig.mcpServers['sentinel-ai'] = config;
  await saveMcpConfig(mcpConfig);

  // Claude Code에 동기화
  await syncToClaudeCode('sentinel-ai', config);
}
```

---

## 6. 테스트 시나리오

### 시나리오 1: init에서 Sentinel AI 선택 (npx)
- **조건**: `pilot-ai init` → Sentinel AI 체크 → npx 모드 선택
- **기대**: `mcp-config.json`에 `npx sentinel-ai` 설정 등록, Claude Code sync 완료
- **검증**: `claude mcp get sentinel-ai` 출력 확인

### 시나리오 2: addtool sentinel-ai (로컬 빌드)
- **조건**: `pilot-ai addtool sentinel-ai` → Local build 선택 → 유효한 경로 입력
- **기대**: `mcp-config.json`에 `node /path/to/dist/index.js` 설정 등록
- **검증**: `cat ~/.pilot/mcp-config.json` 확인

### 시나리오 3: addtool sentinel-ai (로컬 빌드, 잘못된 경로)
- **조건**: `pilot-ai addtool sentinel-ai` → Local build → 존재하지 않는 경로 입력
- **기대**: 에러 메시지 + 재입력 프롬프트
- **검증**: 에러 메시지 출력 확인, mcp-config.json 미변경

### 시나리오 4: 환경변수 설정
- **조건**: `pilot-ai addtool sentinel-ai` → npx → 환경변수 설정 Y → SENTINEL_REPORTS_DIR 입력
- **기대**: `mcp-config.json`에 env 포함 등록
- **검증**: `mcp-config.json`의 env 필드 확인

### 시나리오 5: QA 카테고리 표시
- **조건**: `pilot-ai init` 실행
- **기대**: 선택 목록에서 "QA / Testing" 카테고리 하에 Sentinel AI 표시
- **검증**: 화면 출력 확인

### 시나리오 6: 이미 등록된 상태에서 addtool
- **조건**: sentinel-ai 이미 등록 → `pilot-ai addtool sentinel-ai` 재실행
- **기대**: "이미 등록됨" 안내 + 재설정 여부 프롬프트
- **검증**: 기존 설정 유지 또는 덮어쓰기 선택 가능

---

## 7. 범위 외 (향후)

- sentinel-ai 도구 사용을 위한 LLM 프롬프트 최적화 (테스트 코드 생성 품질 향상)
- Maestro (Flutter) 테스트 코드 생성 지원
- Data Log QA (analytics 이벤트 검증) 통합
- sentinel-ai 버전 호환성 체크 (`npmPackage: 'sentinel-ai@^0.2.0'` 등)
- heartbeat / 스킬 통합 (정기 QA 실행 자동화)
