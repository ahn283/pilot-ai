import { loadRawConfig, saveConfig, configExists } from '../config/store.js';
import { configSchema } from '../config/schema.js';

const VALID_PLATFORMS = ['slack', 'telegram'] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

function validatePlatform(platform: string): Platform {
  if (!VALID_PLATFORMS.includes(platform as Platform)) {
    throw new Error(`Invalid platform "${platform}". Use "slack" or "telegram".`);
  }
  return platform as Platform;
}

export async function addUser(platform: string, userId: string): Promise<void> {
  const p = validatePlatform(platform);

  if (!(await configExists())) {
    console.error('Configuration not found. Run "npx pilot-ai init" first.');
    process.exit(1);
  }

  const raw = await loadRawConfig();
  const config = configSchema.parse(raw);

  const users = config.security.allowedUsers[p];
  if (users.includes(userId)) {
    console.log(`User "${userId}" is already authorized on ${p}.`);
    return;
  }

  users.push(userId);

  // Save back the raw config with updated allowedUsers
  const security = (raw.security ?? {}) as Record<string, unknown>;
  const allowedUsers = (security.allowedUsers ?? {}) as Record<string, unknown>;
  allowedUsers[p] = users;
  security.allowedUsers = allowedUsers;
  raw.security = security;

  await saveConfig(raw as Parameters<typeof saveConfig>[0]);
  console.log(`Added user "${userId}" to ${p} authorized users.`);
}

export async function removeUser(platform: string, userId: string): Promise<void> {
  const p = validatePlatform(platform);

  if (!(await configExists())) {
    console.error('Configuration not found. Run "npx pilot-ai init" first.');
    process.exit(1);
  }

  const raw = await loadRawConfig();
  const config = configSchema.parse(raw);

  const users = config.security.allowedUsers[p];
  const index = users.indexOf(userId);
  if (index === -1) {
    console.log(`User "${userId}" is not in ${p} authorized users.`);
    return;
  }

  users.splice(index, 1);

  const security = (raw.security ?? {}) as Record<string, unknown>;
  const allowedUsers = (security.allowedUsers ?? {}) as Record<string, unknown>;
  allowedUsers[p] = users;
  security.allowedUsers = allowedUsers;
  raw.security = security;

  await saveConfig(raw as Parameters<typeof saveConfig>[0]);
  console.log(`Removed user "${userId}" from ${p} authorized users.`);
}

export async function listUsers(): Promise<void> {
  if (!(await configExists())) {
    console.error('Configuration not found. Run "npx pilot-ai init" first.');
    process.exit(1);
  }

  const raw = await loadRawConfig();
  const config = configSchema.parse(raw);

  const { slack, telegram } = config.security.allowedUsers;

  console.log('Authorized users:');
  console.log(`  Slack:    ${slack.length > 0 ? slack.join(', ') : '(none)'}`);
  console.log(`  Telegram: ${telegram.length > 0 ? telegram.join(', ') : '(none)'}`);
}
