import { z } from 'zod';

export const configSchema = z.object({
  claude: z.object({
    mode: z.enum(['cli', 'api']).default('cli'),
    cliBinary: z.string().default('claude'),
    apiKey: z.string().nullable().default(null),
  }),
  messenger: z.object({
    platform: z.enum(['slack', 'telegram']),
    slack: z
      .object({
        botToken: z.string(),
        appToken: z.string(),
        signingSecret: z.string(),
      })
      .optional(),
    telegram: z
      .object({
        botToken: z.string(),
      })
      .optional(),
  }),
  notion: z
    .object({
      apiKey: z.string(),
    })
    .optional(),
  obsidian: z
    .object({
      vaultPath: z.string(),
    })
    .optional(),
  linear: z
    .object({
      apiKey: z.string(),
    })
    .optional(),
  figma: z
    .object({
      personalAccessToken: z.string(),
    })
    .optional(),
  github: z
    .object({
      enabled: z.boolean().default(false),
      defaultOrg: z.string().optional(),
      defaultRepo: z.string().optional(),
    })
    .optional(),
  google: z
    .object({
      clientId: z.string(),
      clientSecret: z.string(),
      services: z.array(z.enum(['gmail', 'calendar', 'drive'])).default([]),
    })
    .optional(),
  safety: z.object({
    dangerousActionsRequireApproval: z.boolean().default(true),
    approvalTimeoutMinutes: z.number().default(30),
  }),
  security: z.object({
    allowedUsers: z.object({
      slack: z.array(z.string()).default([]),
      telegram: z.array(z.string()).default([]),
    }),
    dmOnly: z.boolean().default(true),
    filesystemSandbox: z.object({
      allowedPaths: z.array(z.string()).default(['~']),
      blockedPaths: z.array(z.string()).default(['~/.pilot', '~/.ssh', '~/.gnupg', '~/.aws']),
    }),
    autoApprovePermissions: z.boolean().default(true),
    auditLog: z.object({
      enabled: z.boolean().default(true),
      path: z.string().default('~/.pilot/logs/audit.jsonl'),
      maskSecrets: z.boolean().default(true),
    }),
  }),
});

export type PilotConfig = z.infer<typeof configSchema>;

export const defaultConfig: Partial<PilotConfig> = {
  claude: {
    mode: 'cli',
    cliBinary: 'claude',
    apiKey: null,
  },
  safety: {
    dangerousActionsRequireApproval: true,
    approvalTimeoutMinutes: 30,
  },
  security: {
    allowedUsers: { slack: [], telegram: [] },
    dmOnly: true,
    autoApprovePermissions: true,
    filesystemSandbox: {
      allowedPaths: ['~'],
      blockedPaths: ['~/.pilot', '~/.ssh', '~/.gnupg', '~/.aws'],
    },
    auditLog: {
      enabled: true,
      path: '~/.pilot/logs/audit.jsonl',
      maskSecrets: true,
    },
  },
};
