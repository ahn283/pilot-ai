import type { PilotConfig } from '../config/schema.js';
import type { MessengerAdapter } from './adapter.js';
import { SlackAdapter } from './slack.js';
import { TelegramAdapter } from './telegram.js';

export function createMessengerAdapter(config: PilotConfig): MessengerAdapter {
  const { platform } = config.messenger;

  if (platform === 'slack') {
    if (!config.messenger.slack) {
      throw new Error('Slack 설정이 없습니다. "npx pilot-ai init"으로 설정하세요.');
    }
    return new SlackAdapter(config.messenger.slack);
  }

  if (platform === 'telegram') {
    if (!config.messenger.telegram) {
      throw new Error('Telegram 설정이 없습니다. "npx pilot-ai init"으로 설정하세요.');
    }
    return new TelegramAdapter(config.messenger.telegram);
  }

  throw new Error(`지원하지 않는 메신저 플랫폼: ${platform}`);
}
