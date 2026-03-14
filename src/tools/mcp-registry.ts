/**
 * Built-in registry of known MCP servers.
 * The agent uses this to auto-discover and propose MCP server installations.
 */

export interface McpServerEntry {
  /** Unique key (used in mcp-config.json) */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this server provides */
  description: string;
  /** npm package to run via npx (for stdio transport) */
  npmPackage: string;
  /** Extra args after the package name */
  args?: string[];
  /** Environment variables required (key -> description) */
  envVars?: Record<string, string>;
  /** Keywords that trigger auto-discovery */
  keywords: string[];
  /** Category for grouping */
  category: 'design' | 'productivity' | 'development' | 'data' | 'communication' | 'qa';
  /** Transport type: 'stdio' (default, npx) or 'http' (remote URL) */
  transport?: 'stdio' | 'http';
  /** Remote URL for http transport servers */
  url?: string;
}

/**
 * Built-in registry of well-known MCP servers.
 * This list is used for auto-discovery — the agent matches user requests
 * against keywords and proposes installing relevant servers.
 */
export const MCP_REGISTRY: McpServerEntry[] = [
  {
    id: 'figma',
    name: 'Figma',
    description: 'Access Figma designs, components, variables, and comments',
    npmPackage: 'figma-developer-mcp',
    args: ['--stdio'],
    envVars: { FIGMA_API_KEY: 'Figma Personal Access Token (figd_...)' },
    keywords: ['figma', 'design', 'ui', 'component', 'prototype', 'frame', 'design token'],
    category: 'design',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage GitHub repos, issues, PRs, and actions',
    npmPackage: '@modelcontextprotocol/server-github',
    envVars: { GITHUB_PERSONAL_ACCESS_TOKEN: 'GitHub Personal Access Token' },
    keywords: ['github', 'repo', 'pull request', 'pr', 'issue', 'actions', 'workflow'],
    category: 'development',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and send Slack messages, manage channels',
    npmPackage: '@modelcontextprotocol/server-slack',
    envVars: { SLACK_BOT_TOKEN: 'Slack Bot Token (xoxb-...)', SLACK_TEAM_ID: 'Slack Team/Workspace ID' },
    keywords: ['slack', 'channel', 'workspace', 'slack message'],
    category: 'communication',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, search, send, and manage Gmail messages',
    npmPackage: '@shinzolabs/gmail-mcp',
    envVars: {
      CLIENT_ID: 'Google OAuth Client ID',
      CLIENT_SECRET: 'Google OAuth Client Secret',
      REFRESH_TOKEN: 'Google OAuth Refresh Token',
      PORT: 'HTTP transport port (default 3456 to avoid conflicts)',
      GMAIL_OAUTH_PATH: 'Path to gcp-oauth.keys.json',
      GMAIL_CREDENTIALS_PATH: 'Path to credentials.json',
    },
    keywords: ['gmail', 'email', 'mail', 'inbox', 'google mail'],
    category: 'communication',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'List, create, update, and delete calendar events',
    npmPackage: '@cocal/google-calendar-mcp',
    envVars: {
      GOOGLE_OAUTH_CREDENTIALS: 'Path to Google OAuth credentials JSON file',
    },
    keywords: ['calendar', 'event', 'schedule', 'meeting', 'google calendar'],
    category: 'productivity',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Search, read, and create files in Google Drive, Docs, Sheets, and Slides',
    npmPackage: '@piotr-agier/google-drive-mcp',
    envVars: {
      GOOGLE_DRIVE_OAUTH_CREDENTIALS: 'Path to Google OAuth credentials JSON file',
    },
    keywords: ['google drive', 'gdrive', 'drive', 'google docs', 'google sheets', 'spreadsheet'],
    category: 'productivity',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search, read, create, and update Notion pages and databases',
    npmPackage: '@notionhq/notion-mcp-server',
    envVars: { OPENAPI_MCP_HEADERS: 'Notion API headers JSON (Authorization: Bearer ntn_...)' },
    keywords: ['notion', 'notion page', 'notion database'],
    category: 'productivity',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Manage Linear issues, projects, and cycles',
    npmPackage: '@tacticlaunch/mcp-linear',
    envVars: { LINEAR_API_TOKEN: 'Linear API Token' },
    keywords: ['linear', 'linear issue', 'sprint', 'cycle', 'backlog'],
    category: 'development',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and manage PostgreSQL databases',
    npmPackage: '@modelcontextprotocol/server-postgres',
    envVars: { POSTGRES_CONNECTION_STRING: 'PostgreSQL connection string (postgresql://...)' },
    keywords: ['postgres', 'postgresql', 'database', 'sql', 'db query'],
    category: 'data',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query SQLite databases',
    npmPackage: 'mcp-server-sqlite-npx',
    envVars: {},
    keywords: ['sqlite', 'sqlite3', 'local database'],
    category: 'data',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation and web scraping via Puppeteer',
    npmPackage: '@modelcontextprotocol/server-puppeteer',
    envVars: {},
    keywords: ['puppeteer', 'headless browser', 'web scraping', 'screenshot'],
    category: 'development',
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files with access control',
    npmPackage: '@modelcontextprotocol/server-filesystem',
    envVars: {},
    keywords: ['filesystem', 'file access', 'directory'],
    category: 'development',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent memory via knowledge graph',
    npmPackage: '@modelcontextprotocol/server-memory',
    envVars: {},
    keywords: ['memory', 'knowledge graph', 'remember', 'persistent memory'],
    category: 'productivity',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave Search API',
    npmPackage: '@modelcontextprotocol/server-brave-search',
    envVars: { BRAVE_API_KEY: 'Brave Search API Key' },
    keywords: ['brave', 'web search', 'search api'],
    category: 'productivity',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'View and manage Sentry error tracking issues',
    npmPackage: '@sentry/mcp-server',
    envVars: { SENTRY_AUTH_TOKEN: 'Sentry Auth Token' },
    keywords: ['sentry', 'error tracking', 'crash', 'exception'],
    category: 'development',
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Manage Jira issues, boards, and sprints',
    npmPackage: '@aashari/mcp-server-atlassian-jira',
    envVars: {
      ATLASSIAN_SITE_NAME: 'Atlassian site name (extracted from URL)',
      ATLASSIAN_USER_EMAIL: 'Atlassian account email',
      ATLASSIAN_API_TOKEN: 'Atlassian API Token',
    },
    keywords: ['jira', 'jira issue', 'jira board', 'sprint', 'atlassian', 'ticket'],
    category: 'development',
  },
  {
    id: 'confluence',
    name: 'Confluence',
    description: 'Search, read, and create Confluence pages and spaces',
    npmPackage: '@aashari/mcp-server-atlassian-confluence',
    envVars: {
      ATLASSIAN_SITE_NAME: 'Atlassian site name (extracted from URL)',
      ATLASSIAN_USER_EMAIL: 'Atlassian account email',
      ATLASSIAN_API_TOKEN: 'Atlassian API Token',
    },
    keywords: ['confluence', 'confluence page', 'confluence space', 'atlassian wiki', 'wiki'],
    category: 'productivity',
  },
  {
    id: 'wiki',
    name: 'Wiki (MediaWiki)',
    description: 'Search and read MediaWiki pages (Wikipedia, internal wikis)',
    npmPackage: '@professional-wiki/mediawiki-mcp-server',
    envVars: {
      CONFIG: 'Path to MediaWiki config JSON file',
    },
    keywords: ['wiki', 'mediawiki', 'wikipedia', 'wiki page'],
    category: 'productivity',
  },
  {
    id: 'sentinel-qa',
    name: 'Sentinel AI',
    description: 'QA automation — run Playwright/Maestro E2E tests, manage test cases, and generate reports',
    npmPackage: 'sentinel-qa',
    envVars: {
      SENTINEL_REGISTRY_DIR: 'App registry directory path (optional)',
      SENTINEL_REPORTS_DIR: 'Report output directory path (optional)',
    },
    keywords: ['test', 'qa', 'testing', 'playwright', 'maestro', 'e2e', 'sentinel', 'test runner', 'analytics', 'data log'],
    category: 'qa',
  },
];

/**
 * Extracts the Atlassian site name from a URL or raw site name input.
 * Accepts:
 *   - Full URL: https://mycompany.atlassian.net or https://mycompany.atlassian.net/...
 *   - Domain: mycompany.atlassian.net
 *   - Site name only: mycompany
 * Returns the site name (e.g. "mycompany").
 */
export function parseAtlassianSiteName(input: string): string {
  const trimmed = input.trim();

  // Try to parse as URL or domain
  try {
    // Add protocol if missing to make URL parsing work
    const urlStr = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const url = new URL(urlStr);
    const hostname = url.hostname;

    // Standard Atlassian Cloud: mycompany.atlassian.net
    if (hostname.endsWith('.atlassian.net')) {
      return hostname.replace('.atlassian.net', '');
    }

    // Custom domain or full hostname — return the full hostname
    // so users with custom domains get a meaningful value
    if (hostname.includes('.')) {
      return hostname;
    }
  } catch {
    // Not a URL, treat as raw site name
  }

  return trimmed;
}

/**
 * Finds registry entries matching any of the given keywords.
 * Uses case-insensitive partial matching.
 * Results are sorted by match specificity (longer keyword match = higher priority).
 */
export function findMatchingServers(text: string): McpServerEntry[] {
  const lower = text.toLowerCase();

  type ScoredEntry = { entry: McpServerEntry; maxKeywordLen: number };
  const scored: ScoredEntry[] = [];

  for (const entry of MCP_REGISTRY) {
    let maxLen = 0;
    for (const kw of entry.keywords) {
      const kwLower = kw.toLowerCase();
      if (lower.includes(kwLower) && kwLower.length > maxLen) {
        maxLen = kwLower.length;
      }
    }
    if (maxLen > 0) {
      scored.push({ entry, maxKeywordLen: maxLen });
    }
  }

  // Sort by longest matching keyword first (more specific match wins)
  scored.sort((a, b) => b.maxKeywordLen - a.maxKeywordLen);
  return scored.map((s) => s.entry);
}

/**
 * Gets a registry entry by ID.
 */
export function getRegistryEntry(id: string): McpServerEntry | undefined {
  return MCP_REGISTRY.find((e) => e.id === id);
}
