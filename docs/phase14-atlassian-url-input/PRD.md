# Phase 14: Atlassian (Jira/Confluence) 연동 시 URL 입력 방식 전환

## 1. 배경 및 문제

### 1.1 현재 상태

Jira/Confluence 연동 시 사용자에게 "Atlassian site name"을 입력받고 있다.

```
? Atlassian site name: mycompany
```

이 값은 `ATLASSIAN_SITE_NAME` 환경 변수로 MCP 서버에 전달되며, 내부적으로 `https://{siteName}.atlassian.net` 형태로 API 호출에 사용된다.

### 1.2 문제점

1. **"site name"이 무엇인지 직관적이지 않음** — 사용자가 URL에서 어떤 부분을 추출해야 하는지 혼동
2. **커스텀 도메인 대응 불가** — 많은 조직이 `jira.company.com` 같은 커스텀 도메인을 사용하며, 이 경우 "site name"이라는 개념이 맞지 않음
3. **사용자 경험** — URL을 복사해서 붙여넣는 것이 site name을 추출하는 것보다 자연스러움

## 2. 해결 방안

### 2.1 URL 입력으로 전환

site name 대신 Atlassian URL을 직접 입력받도록 변경한다.

**변경 전:**
```
? Atlassian site name: mycompany
```

**변경 후:**
```
? Atlassian URL (e.g. https://mycompany.atlassian.net): https://mycompany.atlassian.net
  → Site name: mycompany
```

### 2.2 URL 파싱 로직 (`parseAtlassianSiteName`)

다양한 입력 형태를 지원하는 파서 함수를 추가한다:

| 입력 | 파싱 결과 | 설명 |
|------|----------|------|
| `https://mycompany.atlassian.net` | `mycompany` | 표준 Atlassian Cloud URL |
| `https://mycompany.atlassian.net/wiki` | `mycompany` | 경로 포함 URL |
| `mycompany.atlassian.net` | `mycompany` | 프로토콜 생략 |
| `mycompany` | `mycompany` | 기존 site name 직접 입력 (하위 호환) |
| `https://jira.custom-domain.com` | `jira.custom-domain.com` | 커스텀 도메인 → 호스트네임 전체 반환 |

### 2.3 참고: MCP 패키지 제약

현재 사용 중인 `@aashari/mcp-server-atlassian-jira` 및 `@aashari/mcp-server-atlassian-confluence` 패키지는 **Jira Cloud만 지원**하며, `ATLASSIAN_SITE_NAME` 환경 변수만 인식한다.

커스텀 도메인 사용 시 MCP 패키지가 정상 동작하지 않을 수 있으며, 이 경우 사용자에게 추출된 site name을 표시하여 확인할 수 있도록 한다 (`→ Site name: ...`).

## 3. 변경 범위

### 3.1 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/tools/mcp-registry.ts` | `parseAtlassianSiteName()` 헬퍼 함수 추가, envVars 설명 업데이트 |
| `src/cli/tools.ts` | `addtool` 플로우에서 URL 입력으로 변경, 파싱 결과 표시 |
| `src/cli/init.ts` | `init` 플로우에서 URL 입력으로 변경, 파싱 결과 표시 |
| `src/agent/mcp-launcher.ts` | `SITE_URL` 패턴을 non-secret으로 분류 추가 |
| `tests/tools/mcp-registry.test.ts` | `parseAtlassianSiteName` 단위 테스트 추가 |

### 3.2 변경하지 않는 것

- MCP 패키지 교체 또는 수정 (upstream 패키지 제약)
- `ATLASSIAN_SITE_NAME` 환경 변수명 변경 (MCP 패키지 호환성 유지)
- 기존 설정 마이그레이션 (이미 설정된 사용자에게 영향 없음)

## 4. 사용자 플로우

### 4.1 `pilot-ai addtool jira` (또는 confluence)

```
  Atlassian Jira Setup Guide:
  1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
  2. Click "Create API token" and copy it
  3. Copy your Atlassian URL (e.g. https://mycompany.atlassian.net)

? Atlassian URL (e.g. https://mycompany.atlassian.net): https://acme.atlassian.net
  → Site name: acme
? Atlassian account email: user@acme.com
? Atlassian API Token: ****

  Jira configured (MCP server registered).
```

### 4.2 `pilot-ai init` (통합 셋업)

동일한 URL 입력 방식 적용.
