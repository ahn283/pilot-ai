# sentinel-ai × pilot-ai 연동 가이드

> 작성일: 2026-03-14
> 대상: pilot-ai 개발팀

---

## 1. 개요

sentinel-ai는 pilot-ai의 QA 실행 인프라입니다.
pilot-ai가 PRD에서 테스트케이스를 생성하면, sentinel-ai가 이를 Playwright(웹) / Maestro(Flutter)로 실행하고 결과를 반환합니다.

```
pilot-ai (LLM) ──stdio──▶ sentinel-ai (MCP 서버)
                              ├─ Playwright (웹 E2E)
                              ├─ Maestro (Flutter, 예정)
                              └─ Data Log QA (analytics 검증, 예정)
```

---

## 2. MCP 서버 설정

### 개발 환경 (로컬 빌드)

sentinel-ai 레포를 클론하고 빌드한 뒤 로컬 경로로 등록합니다.

```bash
git clone https://github.com/eodin/sentinel-ai.git
cd sentinel-ai
npm install
npm run build
```

`~/.pilot/mcp-config.json`에 추가:

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

### 프로덕션 (npm publish 이후)

npm 배포 후에는 `npx`로 실행합니다.

```json
{
  "mcpServers": {
    "sentinel-ai": {
      "command": "npx",
      "args": ["sentinel-ai"]
    }
  }
}
```

### 환경 변수

sentinel-ai는 **API 키가 필요 없습니다**. 선택적 환경 변수:

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SENTINEL_REGISTRY_DIR` | 앱 레지스트리 디렉토리 경로 | sentinel-ai 내 `registry/` |
| `SENTINEL_REPORTS_DIR` | 리포트 저장 디렉토리 경로 | sentinel-ai 내 `reports/` |
| `DEBUG` | 디버그 로그 활성화 | (미설정) |

### 리포트 저장 구조

`run_tests` 실행 시 Markdown + JSON 리포트가 자동 생성됩니다.

```
reports/
  <app_id>/
    <timestamp>/
      report.md        # Markdown 리포트 (사람이 읽기 좋은 형태)
      result.json      # JSON 원본 결과 (프로그래매틱 소비용)
```

예시:
```
reports/
  arden-web/
    2026-03-14T10-30-00-000Z/
      report.md
      result.json
    2026-03-14T14-15-22-123Z/
      report.md
      result.json
  fridgify/
    2026-03-14T11-00-00-000Z/
      report.md
      result.json
```

`reports/` 디렉토리는 `.gitignore`에 포함되어 있어 커밋되지 않습니다.

---

## 3. MCP 도구 스펙

sentinel-ai는 5개의 MCP 도구를 제공합니다.

### 3.1. `list_apps`

등록된 앱 목록을 반환합니다.

**Input**: 없음

**Output** (예시):
```json
[
  { "id": "fridgify", "type": "flutter", "repo": "github.com/eodin/fridgify" },
  { "id": "arden-web", "type": "web", "url": "https://arden.app" }
]
```

### 3.2. `get_selectors`

앱별 UI selector 매핑을 반환합니다. 테스트 코드 생성 시 참조합니다.

**Input**:
```json
{ "app_id": "arden-web" }
```

**Output** (예시):
```json
{
  "add_ingredient_button": "button[data-testid='addIngredient']",
  "generate_button": "button[data-testid='generate']",
  "recipe_card": ".recipe-card"
}
```

### 3.3. `save_tests`

생성된 테스트케이스를 sentinel-ai에 저장합니다.

**Input**:
```json
{
  "app_id": "arden-web",
  "test_cases": [
    {
      "id": "TC-001",
      "title": "Load home page",
      "confidence": 0.95,
      "status": "approved",
      "platform": ["web"],
      "code": "import { test, expect } from '@playwright/test';\n\ntest('home page', async ({ page }) => {\n  await page.goto('https://example.com');\n  await expect(page.locator('h1')).toBeVisible();\n});"
    }
  ]
}
```

**test_cases 필드**:

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 고유 테스트 ID (예: TC-001) |
| `title` | string | 테스트 제목 |
| `confidence` | number (0-1) | LLM 생성 신뢰도 점수 |
| `status` | `"approved"` \| `"pending"` | 승인 상태 |
| `platform` | `("flutter" \| "web")[]` | 대상 플랫폼 |
| `code` | string | **실행 가능한 테스트 코드** (아래 코드 규칙 참조) |

### 3.4. `run_tests`

저장된 테스트를 실행합니다. 웹 플랫폼은 Playwright로 실행됩니다.

**Input**:
```json
{
  "app_id": "arden-web",
  "suite": "recipe",
  "platform": "web"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `app_id` | string | 필수. 앱 ID |
| `suite` | string? | 선택. 테스트 스위트 이름 (필터링용) |
| `platform` | `"web"` \| `"ios"` \| `"android"`? | 선택. 미지정 시 앱 타입에서 자동 감지 |

**Output** (예시):
```json
{
  "app_id": "arden-web",
  "suite": "all",
  "platform": "web",
  "total": 2,
  "passed": 1,
  "failed": 1,
  "skipped": 0,
  "timedOut": 0,
  "duration": 3500,
  "tests": [
    {
      "id": "TC-001",
      "title": "home page loads",
      "status": "passed",
      "duration": 1200
    },
    {
      "id": "TC-002",
      "title": "recipe generation",
      "status": "failed",
      "duration": 2300,
      "error": "Expected element to be visible",
      "screenshotPath": "/tmp/screenshot-1.png"
    }
  ],
  "report_path": "/path/to/sentinel-ai/reports/arden-web/2026-03-14T10-30-00-000Z/report.md"
}
```

> `run_tests` 실행 시 Markdown 리포트가 자동 생성되며, `report_path`에 파일 경로가 포함됩니다.

### 3.5. `get_report`

최근 테스트 결과의 Markdown 리포트를 반환합니다.

**Input**:
```json
{ "app_id": "arden-web" }
```

**Output** (예시):

첫 번째 `content` 항목은 JSON 요약, 두 번째는 Markdown 리포트 본문입니다.

```json
{
  "app_id": "arden-web",
  "report_path": "/path/to/reports/arden-web/2026-03-14T10-30-00-000Z/report.md",
  "summary": {
    "total": 2,
    "passed": 1,
    "failed": 1,
    "skipped": 0,
    "timedOut": 0,
    "duration": 3500,
    "timestamp": "2026-03-14T10-30-00-000Z"
  }
}
```

리포트가 없으면 `"status": "no reports available"` 응답을 반환합니다.

---

## 4. 테스트 코드 작성 규칙

pilot-ai가 `save_tests`의 `code` 필드에 넣을 테스트 코드는 다음 규칙을 따라야 합니다.

### 허용

- `@playwright/test` 모듈 import (`test`, `expect`, `Page` 등)
- Playwright API (`page.goto`, `page.click`, `page.locator`, `expect` 등)

### 금지 (코드 검증에서 차단됨)

| 패턴 | 이유 |
|------|------|
| `eval()`, `Function()` | 코드 인젝션 방지 |
| `require()` | ESM만 허용 |
| `child_process`, `fs`, `net`, `vm`, `worker_threads` import | 시스템 접근 차단 |
| `process.exit()`, `process.kill()`, `process.env` | 프로세스 제어 차단 |
| `@playwright` 외 모듈 import | 허용되지 않은 의존성 차단 |
| Dynamic `import()` (비-Playwright) | 동적 모듈 로딩 차단 |

**유효한 코드 예시:**
```typescript
import { test, expect } from '@playwright/test';

test('recipe generation', async ({ page }) => {
  await page.goto('https://arden.app');
  await page.click("button[data-testid='addIngredient']");
  await page.fill("input[data-testid='ingredientInput']", 'egg');
  await page.click("button[data-testid='generate']");
  await expect(page.locator('.recipe-card')).toBeVisible();
});
```

---

## 5. 전체 호출 플로우

pilot-ai가 "테스트 돌려줘" 명령을 받았을 때의 권장 플로우:

```
1. list_apps()
   → 대상 앱 확인 (fridgify, arden-web 등)

2. get_selectors({ app_id: "arden-web" })
   → UI selector 매핑 확보

3. [pilot-ai LLM] PRD + selectors → Playwright 테스트 코드 생성

4. save_tests({ app_id: "arden-web", test_cases: [...] })
   → 생성된 테스트 코드를 sentinel-ai에 저장

5. run_tests({ app_id: "arden-web", platform: "web" })
   → Playwright 테스트 실행 (수 초~수 분 소요)

6. get_report({ app_id: "arden-web" })
   → 결과 요약 확인 (7단계 구현 후)

7. [pilot-ai] 결과를 Telegram/Slack으로 리포트
```

---

## 6. 연동 검증

sentinel-ai 레포에 포함된 검증 스크립트로 전체 플로우를 테스트할 수 있습니다.

```bash
cd sentinel-ai
npm run build
node scripts/verify-mcp-flow.mjs
```

기대 출력:
```
[1. initialize]          PASS
[2. list_apps]           PASS
[3. get_selectors]       PASS
[4. save_tests]          PASS
[5. run_tests (web)]     PASS
[6. get_report (stub)]   PASS

Results: 6 passed, 0 failed
```

---

## 7. sentinel-ai 업데이트 시 pilot-ai 대응 가이드

### 업데이트 분류

sentinel-ai의 변경 사항은 3가지 수준으로 분류됩니다:

| 수준 | 예시 | pilot-ai 대응 |
|------|------|---------------|
| **패치 (비파괴)** | 버그 수정, 성능 개선, 내부 리팩토링 | **대응 불필요**. 빌드만 다시 하면 됨 |
| **마이너 (하위 호환)** | 새 도구 추가, 기존 도구에 optional 필드 추가 | **선택적 대응**. 새 기능을 활용하려면 pilot-ai 코드 수정 |
| **메이저 (파괴적)** | 도구 제거, 필드 이름 변경, 필수 필드 추가 | **필수 대응**. pilot-ai 코드 수정 필요 |

### 업데이트 절차

#### 로컬 개발 환경

```bash
cd sentinel-ai
git pull
npm install
npm run build
# → pilot-ai 재시작 시 자동 반영 (mcp-config.json의 경로가 빌드 결과물을 가리키므로)
```

#### npm 배포 환경

```bash
# sentinel-ai 측
cd sentinel-ai
npm version patch  # 또는 minor, major
npm publish

# pilot-ai 측
# npx는 자동으로 최신 버전을 사용하므로 별도 작업 불필요
# 단, npx 캐시 갱신이 필요할 수 있음:
npx --yes sentinel-ai@latest
```

### 파괴적 변경 대응 체크리스트

sentinel-ai에서 파괴적 변경이 발생할 경우 pilot-ai 팀이 확인할 항목:

1. **`CHANGELOG.md` 확인** — 어떤 도구/필드가 변경되었는지 파악
2. **Zod 스키마 변경 확인** — `packages/mcp-server/src/schemas/tools.ts`에서 입력 스키마 변경 확인
3. **pilot-ai 코드 수정** — LLM 프롬프트에서 sentinel-ai 도구 호출 부분 업데이트
4. **검증 스크립트 실행** — `node scripts/verify-mcp-flow.mjs`로 연동 확인
5. **회귀 테스트** — pilot-ai에서 "테스트 돌려줘" 전체 플로우 확인

### 버전 호환성 관리 원칙

- sentinel-ai는 **Semantic Versioning (semver)** 을 따릅니다
- 파괴적 변경은 반드시 **major 버전 업**과 함께 진행합니다
- 파괴적 변경 전에 **deprecation 경고**를 먼저 추가합니다 (1 minor 버전 이상 유지)
- pilot-ai의 `mcp-registry.ts`에 sentinel-ai npmPackage 버전을 명시하여 안정적 버전 고정 가능:
  ```typescript
  {
    id: 'sentinel-ai',
    npmPackage: 'sentinel-ai@^0.2.0', // major 범위 내 자동 업데이트
  }
  ```

### MCP 프로토콜 수준 호환성

MCP 프로토콜 자체의 변경은 드물지만, 발생 시:
- sentinel-ai와 pilot-ai 모두 `@modelcontextprotocol/sdk` 버전을 맞춰야 합니다
- `protocolVersion` 필드 (현재 `2024-11-05`)가 변경되면 양측 업데이트 필요

---

## 8. 향후 로드맵 (pilot-ai 영향)

| 단계 | sentinel-ai 변경 | pilot-ai 영향 |
|------|-----------------|---------------|
| 4단계: Maestro 브릿지 | `run_tests`가 `platform: "ios"/"android"`에 실제 실행 지원 | pilot-ai에서 Maestro YAML 코드 생성 로직 추가 필요 |
| 5단계: 데이터 로그 QA | `run_tests`에 `validate_events` 옵션 추가 | pilot-ai에서 이벤트 검증 활성화 옵션 전달 |
| 6단계: Quarantine | `run_tests`에 `include_quarantine` 옵션 추가 | pilot-ai에서 quarantine 테스트 포함 여부 결정 |
| 7단계: Reporter | `get_report` 스텁 해제, 실제 리포트 반환 | pilot-ai에서 리포트 파싱 및 Telegram 전송 로직 |

---

## 9. 문의

- sentinel-ai 이슈: https://github.com/eodin/sentinel-ai/issues
- 내부 Slack: #sentinel-ai
