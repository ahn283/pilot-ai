# Code Review: Slack 채널 멘션 필터링 + 개발 워크플로우 코드리뷰 단계 추가

**Date**: 2026-04-13
**Reviewer**: Senior Code Review Agent
**Scope**: `src/messenger/slack.ts`, `src/cli/start.ts`, `CLAUDE.md`, `.claude/agents/senior-code-reviewer.md`
**Commit(s)**: uncommitted working tree (base: dac9bb0)

## Summary

Slack 채널에서 모든 메시지에 응답하던 동작을 `@mention`에만 응답하도록 변경하고, DM은 기존대로 유지하는 변경. launchd plist의 PATH에 `~/.local/bin`을 추가하는 소규모 인프라 수정도 포함. 개발 워크플로우에 코드리뷰 단계를 추가하는 CLAUDE.md 업데이트와 신규 코드리뷰 에이전트 정의 파일이 함께 포함됨. 전체적으로 깔끔한 변경이나, Slack `app_mention` 이벤트에서 이미지 첨부파일 처리가 누락된 기능 갭과 몇 가지 개선점이 발견됨.

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 3 |
| LOW | 2 |
| INFO | 2 |

**Overall Grade**: B+

## Critical & High Findings

### H1. `app_mention` 이벤트에서 이미지 첨부파일(files) 미처리

- **Severity**: HIGH
- **Category**: Messenger / 기능 갭
- **File**: `src/messenger/slack.ts:117-140`
- **Issue**: `message` 이벤트 핸들러에서는 `msg.files`를 파싱하여 `ImageAttachment[]`를 구성하고 `messageHandler`에 전달하지만, `app_mention` 이벤트 핸들러에서는 이미지 처리가 전혀 없음. 채널에서 `@mention` + 이미지를 함께 보내면 이미지가 무시됨.
- **Impact**: 채널에서 멘션과 함께 이미지(스크린샷, 디자인 등)를 보낸 경우 에이전트가 이미지를 인식하지 못해 불완전한 응답을 제공함. 이번 변경으로 채널 메시지는 오직 `app_mention`으로만 처리되므로, 채널에서의 이미지 전달 경로가 완전히 차단됨.
- **Current code**:
  ```typescript
  // app_mention handler (line 118-140) - no image handling
  this.app.event('app_mention', async ({ event }) => {
    // ...
    await this.messageHandler({
      platform: 'slack',
      userId: event.user as string,
      channelId: event.channel,
      threadId: event.thread_ts ?? event.ts,
      text,
      timestamp: new Date(parseFloat(event.ts) * 1000),
      // images 필드 누락
    });
  });
  ```
- **Recommended fix**:
  ```typescript
  this.app.event('app_mention', async ({ event }) => {
    console.log(`[${new Date().toISOString()}] Slack event: app_mention from ${event.user} in ${event.channel}`);
    if (!this.messageHandler) return;

    if (this.isDuplicate(event.ts)) {
      console.log(`[${new Date().toISOString()}] Slack: skipping duplicate app_mention ts=${event.ts}`);
      return;
    }

    const text = (event.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!text || !event.user) return;

    // Extract image attachments from files (if present)
    const images: ImageAttachment[] = [];
    const files = (event as { files?: Array<{ url_private: string; mimetype: string; name: string }> }).files;
    if (files) {
      for (const file of files) {
        if (file.mimetype?.startsWith('image/')) {
          images.push({
            url: file.url_private,
            mimeType: file.mimetype,
            filename: file.name,
            authHeader: `Bearer ${this.botToken}`,
          });
        }
      }
    }

    await this.messageHandler({
      platform: 'slack',
      userId: event.user as string,
      channelId: event.channel,
      threadId: event.thread_ts ?? event.ts,
      text,
      images: images.length > 0 ? images : undefined,
      timestamp: new Date(parseFloat(event.ts) * 1000),
    });
  });
  ```
  추가로 이미지 추출 로직이 `message` 핸들러와 `app_mention` 핸들러에서 중복되므로, private helper 메서드로 추출하는 것을 권장:
  ```typescript
  private extractImages(files?: Array<{ url_private: string; mimetype: string; name: string }>): ImageAttachment[] {
    if (!files) return [];
    return files
      .filter(f => f.mimetype?.startsWith('image/'))
      .map(f => ({
        url: f.url_private,
        mimeType: f.mimetype,
        filename: f.name,
        authHeader: `Bearer ${this.botToken}`,
      }));
  }
  ```

## Medium & Low Findings

### M1. `channel_type` 값이 `undefined`인 경우의 방어 처리

- **Severity**: MEDIUM
- **Category**: Messenger / 방어적 프로그래밍
- **File**: `src/messenger/slack.ts:79-83`
- **Issue**: `channel_type`이 Slack 이벤트 페이로드에서 누락될 수 있음(Slack API 문서상 일부 이벤트에서 optional). 현재 코드는 `channelType !== 'im'`으로 체크하므로, `undefined`인 경우에도 채널 메시지로 간주하여 무시함. 이는 의도된 동작일 수 있으나, 로그 메시지에서 `channel_type=undefined`가 출력되어 디버깅 시 혼란을 줄 수 있음.
- **Recommendation**: 현재 로직은 안전한 방향(undefined일 때 무시)으로 동작하므로 기능상 문제는 없음. 다만 `channel_type`이 undefined인 경우를 명시적으로 구분하면 디버깅이 용이:
  ```typescript
  const channelType = (message as { channel_type?: string }).channel_type;
  if (channelType && channelType !== 'im') {
    console.log(`[...] Slack: ignoring channel message (channel_type=${channelType}), waiting for app_mention`);
    return;
  }
  if (!channelType) {
    console.log(`[...] Slack: channel_type missing, treating as channel message, waiting for app_mention`);
    return;
  }
  ```

### M2. launchd plist PATH에 `${process.env.HOME}` 런타임 보간 사용

- **Severity**: MEDIUM
- **Category**: Infrastructure / 경로 해석
- **File**: `src/cli/start.ts:44`
- **Issue**: plist 문자열 내에서 `${process.env.HOME}`을 JavaScript 템플릿 리터럴로 사용하고 있음. 이는 plist 생성 시점에 올바르게 보간되므로 기능상 문제는 없으나, `process.env.HOME`이 undefined인 극단적 경우(예: 일부 CI 환경) `undefined/.local/bin`이 PATH에 포함됨.
- **Current code**:
  ```typescript
  <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${process.env.HOME}/.local/bin</string>
  ```
- **Recommendation**: 이미 line 10에서 `process.env.HOME ?? ''`를 사용하는 패턴이 있으므로 일관성 유지:
  ```typescript
  <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${process.env.HOME ?? ''}/.local/bin</string>
  ```

### M3. 테스트 부재

- **Severity**: MEDIUM
- **Category**: Testing
- **File**: `src/messenger/slack.ts` (전체)
- **Issue**: `SlackAdapter`에 대한 단위 테스트 파일이 프로젝트에 존재하지 않음. 이번 변경(DM vs channel 필터링)은 특히 테스트가 중요한 동작 변경임에도 테스트로 검증되지 않음.
- **Recommendation**: `@slack/bolt`의 `App`을 모킹하여 다음 시나리오를 최소한 커버하는 테스트 작성을 권장:
  1. DM(`channel_type === 'im'`) 메시지 -> `messageHandler` 호출됨
  2. 채널 메시지(`channel_type === 'channel'`) -> `messageHandler` 호출되지 않음
  3. `app_mention` 이벤트 -> `messageHandler` 호출됨
  4. 같은 `ts`로 message + app_mention 연속 발생 -> 중복 처리 방지

### L1. `app_mention` 핸들러의 bot mention 스트립 regex가 소문자 bot ID를 처리하지 않음

- **Severity**: LOW
- **Category**: Code Quality
- **File**: `src/messenger/slack.ts:129`
- **Issue**: `/<@[A-Z0-9]+>/g` 패턴은 대문자+숫자만 매칭. Slack bot user ID는 일반적으로 대문자이지만, 스펙상 보장되지 않음.
- **Current code**:
  ```typescript
  const text = (event.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();
  ```
- **Recommendation**: 소문자도 포함하면 더 안전:
  ```typescript
  const text = (event.text ?? '').replace(/<@[A-Za-z0-9]+>/g, '').trim();
  ```

### L2. 이미지 추출 로직 DRY 위반

- **Severity**: LOW
- **Category**: Code Quality / DRY
- **File**: `src/messenger/slack.ts:92-103`
- **Issue**: `message` 핸들러의 이미지 추출 로직이 H1에서 제안한 `app_mention` 핸들러에도 동일하게 필요. private helper 메서드로 추출하면 중복 제거.
- **Recommendation**: H1의 `extractImages()` helper 참조.

## Info

### I1. CLAUDE.md 코드리뷰 단계 추가 - 적절한 변경

- **Severity**: INFO
- **Category**: Project Compliance
- **File**: `CLAUDE.md:53-66`
- **Note**: Phase B 워크플로우에 코드리뷰 단계를 3번으로 추가하고 Rules에도 반영한 것은 개발 품질 게이트를 강화하는 좋은 변경. 빌드 이후, 테스트 이전에 코드리뷰를 배치한 순서도 합리적 -- 빌드가 안 되는 코드를 리뷰할 필요 없고, 리뷰에서 발견된 이슈를 테스트 작성 시 반영할 수 있음.

### I2. `senior-code-reviewer.md` 에이전트 정의 - 잘 구조화됨

- **Severity**: INFO
- **Category**: Architecture
- **File**: `.claude/agents/senior-code-reviewer.md`
- **Note**: pilot-ai 프로젝트의 기술 스택과 아키텍처에 맞춘 7단계 리뷰 프로세스, OWASP 기반 보안 체크리스트, 그리고 messenger/agent/MCP 특화 패턴 검증 항목이 잘 정의되어 있음. 특히 DM vs Channel 동작 설명(line 76-79)이 이번 slack.ts 변경과 정확히 일치하여, 에이전트가 프로젝트 컨텍스트를 충분히 반영하고 있음.

## Positive Observations

1. **DM vs Channel 분리 로직이 깔끔함**: `channel_type` 체크를 기존 dedup 로직 앞에 배치하여, 불필요한 dedup Set 오염을 방지. 채널 메시지가 dedup Set에 추가되지 않으므로 `app_mention`에서의 처리가 정상 동작.
2. **로그 메시지 일관성**: 새로 추가된 로그가 기존 `[ISO timestamp] Slack:` 패턴을 정확히 따르고, `channel_type` 값을 포함하여 디버깅에 유용.
3. **기존 dedup 메커니즘과의 호환성**: `app_mention` 핸들러가 이미 존재하고 dedup이 적용되어 있으므로, message 핸들러에서 non-DM을 조기 리턴하는 것만으로 전환이 완결됨. 최소한의 코드 변경으로 동작을 전환한 점이 좋음.
4. **launchd PATH 확장**: `~/.local/bin` 추가는 `pipx`, `uv` 등 Python 도구 경로를 지원하기 위한 실용적 변경.
5. **코드리뷰 에이전트 정의**: 프로젝트 특화 컨텍스트(MCP, messenger adapter, Claude CLI 통합 등)를 상세히 기술하여, 범용 리뷰어 대비 훨씬 높은 정밀도의 리뷰가 가능하도록 설계.

## Action Items

- [ ] (HIGH) `app_mention` 핸들러에 이미지 첨부파일 처리 추가 + `extractImages()` helper 추출
- [ ] (MEDIUM) `channel_type` undefined 케이스 명시적 처리 검토
- [ ] (MEDIUM) `process.env.HOME` nullish 방어 (`?? ''`) 추가 (start.ts:44)
- [ ] (MEDIUM) SlackAdapter 단위 테스트 작성 (DM/channel 필터링 + dedup 시나리오)
- [ ] (LOW) bot mention regex에 소문자 포함 (`[A-Za-z0-9]`)
