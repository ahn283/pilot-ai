# Phase 6: MCP 설정 Claude Code 네이티브 동기화

## 1. 개요

`pilot-ai init`에서 수집한 MCP 서버 설정을 Claude Code의 네이티브 설정에 동기화하여, pilot-ai 에이전트뿐 아니라 Claude Code를 직접 실행할 때도 MCP 도구가 즉시 사용 가능하도록 개선한다.

---

## 2. 문제 분석

### 2.1 현상

사용자가 `pilot-ai init`에서 Figma, Notion, Google Drive 등의 액세스 토큰을 입력하고 MCP 서버가 등록되었다는 메시지를 확인함. 그러나 Claude Code를 직접 실행하면 해당 MCP 도구를 사용할 수 없음.

```
# pilot-ai 에이전트 (Slack/Telegram) → 작동 ✅
claude -p --mcp-config ~/.pilot/mcp-config.json "Figma 디자인 분석해줘"

# Claude Code 직접 실행 → MCP 없음 ❌
claude "Figma 디자인 분석해줘"
```

### 2.2 근본 원인

**이중 설정 구조의 단절:**

| 구분 | 설정 위치 | 사용 시점 | 상태 |
|------|-----------|----------|------|
| pilot-ai MCP 설정 | `~/.pilot/mcp-config.json` | pilot-ai 에이전트가 `--mcp-config` 플래그로 전달 | ✅ 등록됨 |
| Claude Code 네이티브 설정 | **`~/.claude.json`** 내 `mcpServers` 필드 | Claude Code 직접 실행 시 자동 로드 | ❌ 동기화 안 됨 |

> ⚠️ **중요**: Claude Code 설정 파일은 `~/.claude/settings.json`이 **아니라** **`~/.claude.json`**이다 (실제 검증 완료).

**코드 흐름 분석:**

1. `init.ts` → `collectAndRegisterMcpTool()` → `installMcpServer()` 호출
2. `mcp-manager.ts` → `installMcpServer()` → `saveMcpConfig()` 호출
3. `figma-mcp.ts` → `saveMcpConfig()` → `~/.pilot/mcp-config.json`에만 저장
4. Claude Code 실행 시 → `core.ts` line 286: `getMcpConfigPathIfExists()` → `--mcp-config` 플래그로 전달
5. **Claude Code 네이티브 설정(`~/.claude.json`)에는 아무것도 쓰지 않음**

### 2.3 Claude Code 설정 구조 (실제 검증 완료)

**설정 파일**: `~/.claude.json`

**구조** (실제 파일에서 확인):
```json
{
  "projects": {
    "/Users/woojin": {
      "mcpServers": { }
    },
    "/": {
      "mcpServers": {
        "figma": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@anthropic-ai/figma-mcp"],
          "env": { "FIGMA_PERSONAL_ACCESS_TOKEN": "..." }
        }
      }
    }
  },
  "mcpServers": {
    "global-server": { ... }
  }
}
```

**scope 구분** (실제 테스트로 검증):

| scope | 저장 위치 | 적용 범위 | CLI 옵션 |
|-------|----------|----------|---------|
| `local` (기본) | `~/.claude.json` → `projects[cwd].mcpServers` | 해당 디렉토리에서 실행 시만 | `claude mcp add` |
| **`user`** | `~/.claude.json` → **최상위** `mcpServers` | **모든 프로젝트에서 사용 가능** | `claude mcp add -s user` |
| `project` | 프로젝트 내 `.mcp.json` | 해당 프로젝트만 | `claude mcp add -s project` |

> **결론**: pilot-ai 도구는 프로젝트에 종속되지 않으므로 **`user` scope**를 사용해야 한다.

### 2.4 관리 CLI 검증 결과

Claude Code MCP 관리 CLI 실제 테스트:

```bash
# 추가 테스트 (성공)
$ claude mcp add -s user figma-test -e FIGMA_PERSONAL_ACCESS_TOKEN=test -- npx -y @anthropic-ai/figma-mcp
> Added stdio MCP server figma-test with command: npx -y @anthropic-ai/figma-mcp to user config
> File modified: /Users/woojin/.claude.json

# 제거 테스트 (성공)
$ claude mcp remove -s user figma-test
> Removed MCP server figma-test from user config
> File modified: /Users/woojin/.claude.json
```

**`claude mcp add` vs `claude mcp add-json`** (공식 문서 + 실제 테스트 교차 검증):

공식 문서 (https://code.claude.com/docs/en/mcp):
> All options (`--transport`, `--env`, `--scope`, `--header`) must come **before** the server name.

그러나 실제 테스트에서 `-e`(variadic `<env...>`)가 name까지 소비하는 문제 발견:
- `claude mcp add -s user -e KEY=val name -- cmd` → **에러**
- `claude mcp add -s user name -e KEY=val -- cmd` → 성공 (name을 먼저 배치)

**권장 방식 — `claude mcp add-json`**: JSON 직접 전달로 인자 순서 문제를 원천 차단:
```bash
# Figma (테스트 완료 ✅)
claude mcp add-json -s user figma '{"type":"stdio","command":"npx","args":["-y","@anthropic-ai/figma-mcp"],"env":{"FIGMA_PERSONAL_ACCESS_TOKEN":"figd_..."}}'

# Notion — JSON 환경변수 값도 정상 처리 (테스트 완료 ✅)
claude mcp add-json -s user notion '{"type":"stdio","command":"npx","args":["-y","@notionhq/notion-mcp-server"],"env":{"OPENAPI_MCP_HEADERS":"{\"Authorization\":\"Bearer ntn_...\",\"Notion-Version\":\"2022-06-28\"}"}}'
```

`add-json`의 장점:
1. 인자 순서 문제 없음 — name과 JSON만 전달
2. 환경변수 내 특수문자(JSON 문자열 등) 안전 처리
3. pilot-ai의 `mcp-config.json`과 동일한 구조 → 변환 로직 최소화
4. 공식 문서에서 `--scope user` 지원 확인

### 2.5 사용자 영향

- pilot-ai 에이전트를 통하지 않고 Claude Code를 직접 사용하는 경우 MCP 도구 접근 불가
- 사용자가 동일한 토큰을 두 번 설정해야 하는 혼란
- "init에서 분명 설정했는데 왜 안 되지?" → 신뢰도 저하

---

## 3. 요구사항

### 3.1 핵심 요구사항

- **R1**: `pilot-ai init`에서 MCP 서버 등록 시, Claude Code의 네이티브 설정에도 동시에 동기화
- **R2**: `pilot-ai addtool`로 도구 추가 시에도 Claude Code 설정에 동기화
- **R3**: `pilot-ai removetool`로 도구 제거 시 Claude Code 설정에서도 제거
- **R4**: 기존 `~/.pilot/mcp-config.json`과의 하위 호환성 유지 (pilot-ai 에이전트 모드 계속 지원)

### 3.2 동기화 전략 요구사항

- **R5**: **`claude mcp add-json -s user` CLI 명령**을 사용하여 동기화 (`~/.claude.json` 직접 수정 금지)
- **R6**: **`claude mcp remove -s user` CLI 명령**을 사용하여 제거
- **R7**: 동기화 실패 시 init/addtool이 중단되지 않아야 함 (pilot-ai 자체 설정은 정상 저장)
- **R8**: Claude Code CLI가 설치되지 않은 환경에서도 init이 정상 동작해야 함 (동기화만 스킵)

### 3.3 추가 요구사항

- **R9**: `pilot-ai sync-mcp` 명령 추가 — 기존 `~/.pilot/mcp-config.json`을 Claude Code 설정으로 일괄 동기화 (기존 사용자 마이그레이션용)
- **R10**: 동기화 상태 확인 — `pilot-ai tools`에서 Claude Code 동기화 여부 표시

---

## 4. 설계

### 4.1 구현 전략: `claude mcp` CLI 위임

**`~/.claude.json` 직접 수정 대신 `claude mcp` CLI를 사용하는 이유:**

1. `~/.claude.json` 구조가 복잡 (`projects`, scope별 중첩, feature flags 등 200+ 필드)
2. Claude Code 업데이트 시 구조가 변경될 수 있음 → CLI는 하위 호환 보장
3. 실제 테스트에서 CLI `add`, `remove` 모두 정상 작동 확인
4. 충돌 방지, `type: "stdio"` 자동 추가 등의 복잡성을 Claude Code CLI가 처리
5. 비표준 메타데이터(`_managedBy` 등) 삽입 불필요 → 호환성 문제 원천 차단

### 4.2 동기화 모듈 설계

**새 파일**: `src/config/claude-code-sync.ts`

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkClaudeCli } from '../agent/claude.js';

const execFileAsync = promisify(execFile);

/**
 * Claude Code에 MCP 서버를 user scope로 등록.
 * `claude mcp add-json -s user <name> '<json>'` 사용.
 *
 * add-json을 사용하는 이유:
 * - `claude mcp add`의 `-e` 플래그가 variadic이라 인자 순서 문제 발생
 * - JSON 환경변수 값(Notion OPENAPI_MCP_HEADERS 등) 안전 전달
 * - pilot-ai mcp-config.json과 동일 구조 → 변환 로직 최소화
 */
export async function syncToClaudeCode(
  serverId: string,
  serverConfig: { command: string; args: string[]; env?: Record<string, string> }
): Promise<{ success: boolean; error?: string }> {
  const cliExists = await checkClaudeCli();
  if (!cliExists) {
    return { success: false, error: 'Claude Code CLI not installed' };
  }

  try {
    // 기존 서버가 있으면 먼저 제거 (업데이트 시나리오)
    await execFileAsync('claude', ['mcp', 'remove', '-s', 'user', serverId], {
      timeout: 10_000,
    }).catch(() => {}); // 없으면 무시

    // claude mcp add-json -s user <name> '<json>'
    const jsonConfig: Record<string, unknown> = {
      type: 'stdio',
      command: serverConfig.command,
      args: serverConfig.args,
    };
    if (serverConfig.env) {
      jsonConfig.env = serverConfig.env;
    }

    await execFileAsync('claude', [
      'mcp', 'add-json', '-s', 'user',
      serverId,
      JSON.stringify(jsonConfig),
    ], { timeout: 10_000 });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Claude Code에서 MCP 서버를 user scope로 제거.
 */
export async function removeFromClaudeCode(
  serverId: string
): Promise<{ success: boolean; error?: string }> {
  const cliExists = await checkClaudeCli();
  if (!cliExists) {
    return { success: false, error: 'Claude Code CLI not installed' };
  }

  try {
    await execFileAsync('claude', ['mcp', 'remove', '-s', 'user', serverId], {
      timeout: 10_000,
    });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * ~/.pilot/mcp-config.json의 모든 서버를 Claude Code에 일괄 동기화.
 */
export async function syncAllToClaudeCode(
  mcpConfig: { mcpServers: Record<string, any> }
): Promise<{ synced: string[]; failed: string[] }> {
  const synced: string[] = [];
  const failed: string[] = [];

  for (const [serverId, config] of Object.entries(mcpConfig.mcpServers)) {
    const result = await syncToClaudeCode(serverId, config);
    if (result.success) {
      synced.push(serverId);
    } else {
      failed.push(serverId);
    }
  }

  return { synced, failed };
}

/**
 * Claude Code에 특정 MCP 서버가 등록되어 있는지 확인.
 */
export async function checkClaudeCodeSync(serverId: string): Promise<boolean> {
  try {
    await execFileAsync('claude', ['mcp', 'get', serverId], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
```

### 4.3 동기화 흐름

#### init / addtool 시:

```
사용자 토큰 입력
    ↓
installMcpServer()
    ├→ saveMcpConfig()  →  ~/.pilot/mcp-config.json  (기존, 유지)
    └→ syncToClaudeCode()  →  claude mcp add-json -s user ...  (신규)
          ↓
    성공: "Figma configured (MCP server registered + synced to Claude Code)."
    실패: "Figma configured. Note: Claude Code sync skipped (CLI not found)."
```

#### removetool 시:

```
uninstallMcpServer()
    ├→ saveMcpConfig()  →  ~/.pilot/mcp-config.json에서 제거
    └→ removeFromClaudeCode()  →  claude mcp remove -s user ...
```

### 4.4 mcp-manager.ts 변경

```typescript
// 기존 import에 추가
import { syncToClaudeCode, removeFromClaudeCode } from '../config/claude-code-sync.js';

export async function installMcpServer(serverId, envValues, options = {}) {
  // ... 기존 로직 (keychain 저장, serverConfig 생성) ...

  config.mcpServers[serverId] = serverConfig;
  await saveMcpConfig(config);

  // Claude Code 네이티브 설정에 동기화 (실패해도 계속 진행)
  const syncResult = await syncToClaudeCode(serverId, serverConfig);
  if (syncResult.success) {
    console.log(`  (synced to Claude Code)`);
  } else if (syncResult.error !== 'Claude Code CLI not installed') {
    console.log(`  Note: Claude Code sync failed (${syncResult.error})`);
  }

  return { success: true, claudeCodeSynced: syncResult.success };
}

export async function uninstallMcpServer(serverId) {
  const config = await loadMcpConfig();
  delete config.mcpServers[serverId];
  await saveMcpConfig(config);

  // Claude Code에서도 제거 (실패 무시)
  await removeFromClaudeCode(serverId).catch(() => {});
}
```

### 4.5 sync-mcp CLI 명령

기존 사용자가 업그레이드 후 기존 설정을 동기화:

```
$ pilot-ai sync-mcp

Syncing MCP servers to Claude Code (user scope)...
  ✅ figma — synced
  ✅ notion — synced
  ✅ google-drive — synced

3 servers synced. Run "claude mcp list" to verify.
```

### 4.6 tools 명령 확장

`claude mcp get <name>` 실행 결과로 동기화 여부 확인:

```
$ pilot-ai tools

Tool             Status    Type     Claude Code
─────────────────────────────────────────────────
Figma            active    MCP      ✅ synced
Notion           active    MCP      ❌ not synced
Google Drive     active    MCP      ✅ synced
GitHub           active    CLI      —
Linear           inactive  MCP      —
```

---

## 5. 영향 범위

### 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/config/claude-code-sync.ts` | **신규** — `claude mcp` CLI를 통한 동기화 모듈 |
| `src/agent/mcp-manager.ts` | `installMcpServer()`, `uninstallMcpServer()`에 동기화 호출 추가 |
| `src/cli/tools.ts` | `runTools()`에 Claude Code 동기화 상태 컬럼 추가 |
| `src/index.ts` | `sync-mcp` 서브커맨드 등록 |

### 변경하지 않는 파일

| 파일 | 사유 |
|------|------|
| `src/cli/init.ts` | 변경 불필요 — `installMcpServer()` 내부에서 동기화 처리 |
| `src/agent/core.ts` | `--mcp-config` 플래그 전달 방식 유지 (하위 호환) |
| `src/tools/figma-mcp.ts` | `~/.pilot/mcp-config.json` I/O 로직 유지 |

---

## 6. 구현 순서

1. `src/config/claude-code-sync.ts` 구현 (`syncToClaudeCode`, `removeFromClaudeCode`, `syncAllToClaudeCode`, `checkClaudeCodeSync`)
2. `src/agent/mcp-manager.ts`의 `installMcpServer()`에 `syncToClaudeCode()` 호출 추가
3. `src/agent/mcp-manager.ts`의 `uninstallMcpServer()`에 `removeFromClaudeCode()` 호출 추가
4. `src/index.ts`에 `sync-mcp` 서브커맨드 등록 + 핸들러 구현
5. `src/cli/tools.ts`의 `runTools()`에 동기화 상태 표시 추가
6. 테스트 작성

---

## 7. 리스크

| 리스크 | 완화 |
|--------|------|
| Claude Code CLI 미설치 환경 | `checkClaudeCli()` 체크 후 동기화 스킵. init/addtool은 정상 완료. |
| `claude mcp add-json` CLI 인터페이스 변경 | CLI는 하위 호환이 일반적. `add-json`은 단순 인터페이스(`name` + `json`)라 변경 가능성 낮음. |
| 환경변수 값에 특수문자 포함 (Notion의 JSON 헤더 등) | `add-json`으로 JSON 직접 전달 — 실제 Notion JSON 헤더 테스트 완료. `execFile` 사용으로 shell 인젝션 방지. |
| 동일 이름 서버가 이미 Claude Code에 존재 | `remove` → `add` 순서로 처리하여 업데이트. |
| `claude mcp add` 실행 시 타임아웃 | timeout 10초 설정. 실패 시 경고만 출력, init 계속 진행. |

---

## 8. 검증 기준

- [ ] `pilot-ai init`에서 Figma 토큰 입력 후 `claude mcp list`에 figma 서버가 user scope로 나타남
- [ ] Claude Code 직접 실행 시 (아무 디렉토리에서나) Figma MCP 도구가 사용 가능
- [ ] `pilot-ai addtool notion` 후 `claude mcp get notion`이 성공
- [ ] `pilot-ai removetool figma` 후 `claude mcp get figma`가 실패 (제거됨)
- [ ] `pilot-ai sync-mcp`로 기존 `~/.pilot/mcp-config.json`의 모든 서버가 Claude Code에 동기화
- [ ] `pilot-ai tools`에서 각 서버의 Claude Code 동기화 상태 확인 가능
- [ ] Claude Code CLI가 없는 환경에서 init이 정상 완료됨 (동기화만 스킵, 경고 출력)
- [ ] 환경변수에 JSON 문자열이 포함된 경우 (Notion `OPENAPI_MCP_HEADERS`) 정상 동기화

---

## 9. 참고 자료

### 공식 문서
- [Claude Code MCP 공식 문서](https://code.claude.com/docs/en/mcp) — scope, CLI 명령, 설정 구조 전체 참조

### 검증 이력

| 검증 항목 | 방법 | 결과 |
|-----------|------|------|
| 설정 파일 위치 | `~/.claude.json` 직접 확인 + 공식 문서 | `~/.claude.json` (NOT `~/.claude/settings.json`) |
| user scope 저장 위치 | `claude mcp add -s user` 후 `~/.claude.json` diff 확인 | 최상위 `mcpServers` 필드 |
| `add-json` 동작 | Figma, Notion 서버 등록/제거 실제 테스트 | 성공 (JSON 환경변수 포함) |
| `-e` 플래그 순서 이슈 | `add` 명령으로 테스트 | variadic `-e`가 name까지 소비 → `add-json` 권장 |
| scope 우선순위 | 공식 문서 확인 | local > project > user |
