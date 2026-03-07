import path from 'node:path';
import os from 'node:os';
import type { PilotConfig } from '../config/schema.js';

/**
 * ~ 를 실제 홈 디렉토리로 확장한다.
 */
function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * 주어진 경로가 sandbox 범위 내에 있는지 검증한다.
 * - 경로를 정규화하여 path traversal 방지
 * - 허용 경로 화이트리스트 확인
 * - 차단 경로 블랙리스트 확인
 */
export function isPathAllowed(targetPath: string, config: PilotConfig): boolean {
  const resolved = path.resolve(expandHome(targetPath));

  const { allowedPaths, blockedPaths } = config.security.filesystemSandbox;

  // 차단 경로 확인 (우선)
  for (const blocked of blockedPaths) {
    const resolvedBlocked = path.resolve(expandHome(blocked));
    if (resolved === resolvedBlocked || resolved.startsWith(resolvedBlocked + path.sep)) {
      return false;
    }
  }

  // 허용 경로 확인
  for (const allowed of allowedPaths) {
    const resolvedAllowed = path.resolve(expandHome(allowed));
    if (resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + path.sep)) {
      return true;
    }
  }

  return false;
}

/**
 * Shell 명령어가 블랙리스트에 해당하는지 검사한다.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*-rf\s+)[\/~]/,  // rm -rf / 또는 rm -rf ~
  /curl\s.*\|\s*(?:ba)?sh/,                           // curl | sh, curl | bash
  /wget\s.*\|\s*(?:ba)?sh/,                           // wget | sh
  /chmod\s+777/,                                       // chmod 777
  />\s*\/dev\//,                                       // > /dev/ 디바이스 파일 조작
  /mkfs\./,                                            // mkfs 파일시스템 포맷
  /dd\s+.*of=\/dev\//,                                 // dd of=/dev/
  /:(){ :\|:& };:/,                                    // fork bomb
];

export function isCommandBlocked(command: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * subprocess 실행 시 사용할 격리된 환경변수를 생성한다.
 * 민감한 환경변수를 제거한다.
 */
const SENSITIVE_ENV_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'NOTION_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
];

export function createSafeEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const key of SENSITIVE_ENV_KEYS) {
    delete env[key];
  }
  return env;
}
