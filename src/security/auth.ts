import type { IncomingMessage } from '../messenger/adapter.js';
import type { PilotConfig } from '../config/schema.js';

/**
 * Checks whether the message sender is an authorized user.
 * Messages from unauthorized users are silently ignored (no response).
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
