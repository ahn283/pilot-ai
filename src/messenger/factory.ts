import type { PilotConfig } from '../config/schema.js';
import type { MessengerAdapter } from './adapter.js';
import { SlackAdapter } from './slack.js';
import { TelegramAdapter } from './telegram.js';

export function createMessengerAdapter(config: PilotConfig): MessengerAdapter {
  const { platform } = config.messenger;

  if (platform === 'slack') {
    if (!config.messenger.slack) {
      throw new Error('Slack configuration not found. Run "npx pilot-ai init" to set up.');
    }
    return new SlackAdapter(config.messenger.slack);
  }

  if (platform === 'telegram') {
    if (!config.messenger.telegram) {
      throw new Error('Telegram configuration not found. Run "npx pilot-ai init" to set up.');
    }
    return new TelegramAdapter(config.messenger.telegram);
  }

  throw new Error(`Unsupported messenger platform: ${platform}`);
}
