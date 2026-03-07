import type { IncomingMessage } from '../messenger/adapter.js';
import type { PilotConfig } from '../config/schema.js';

/**
 * 메시지 발신자가 허용된 사용자인지 확인한다.
 * 허용되지 않은 사용자의 메시지는 무시한다 (응답 없음).
 */
export function isAuthorizedUser(msg: IncomingMessage, config: PilotConfig): boolean {
  const { allowedUsers } = config.security;

  if (msg.platform === 'slack') {
    return allowedUsers.slack.includes(msg.userId);
  }

  if (msg.platform === 'telegram') {
    return allowedUsers.telegram.includes(msg.userId);
  }

  return false;
}
