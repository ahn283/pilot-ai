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
  /** npm package to run via npx */
  npmPackage: string;
  /** Extra args after the package name */
  args?: string[];
  /** Environment variables required (key -> description) */
  envVars?: Record<string, string>;
  /** Keywords that trigger auto-discovery */
  keywords: string[];
  /** Category for grouping */
  category: 'design' | 'productivity' | 'development' | 'data' | 'communication';
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
    npmPackage: '@anthropic-ai/figma-mcp',
    envVars: { FIGMA_PERSONAL_ACCESS_TOKEN: 'Figma Personal Access Token' },
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
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Search, read, and create files in Google Drive',
    npmPackage: '@anthropic-ai/google-drive-mcp',
    envVars: {
      GOOGLE_CLIENT_ID: 'Google OAuth Client ID',
      GOOGLE_CLIENT_SECRET: 'Google OAuth Client Secret',
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
    keywords: ['notion', 'notion page', 'notion database', 'wiki'],
    category: 'productivity',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Manage Linear issues, projects, and cycles',
    npmPackage: '@anthropic-ai/linear-mcp',
    envVars: { LINEAR_API_KEY: 'Linear API Key (lin_api_...)' },
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
    npmPackage: '@modelcontextprotocol/server-sqlite',
    envVars: {},
    keywords: ['sqlite', 'sqlite3', 'local database'],
    category: 'data',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation and web scraping via Puppeteer',
    npmPackage: '@anthropic-ai/puppeteer-mcp',
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
    npmPackage: '@modelcontextprotocol/server-sentry',
    envVars: { SENTRY_AUTH_TOKEN: 'Sentry Auth Token' },
    keywords: ['sentry', 'error tracking', 'crash', 'exception'],
    category: 'development',
  },
];

/**
 * Finds registry entries matching any of the given keywords.
 * Uses case-insensitive partial matching.
 */
export function findMatchingServers(text: string): McpServerEntry[] {
  const lower = text.toLowerCase();
  return MCP_REGISTRY.filter((entry) =>
    entry.keywords.some((kw) => lower.includes(kw.toLowerCase())),
  );
}

/**
 * Gets a registry entry by ID.
 */
export function getRegistryEntry(id: string): McpServerEntry | undefined {
  return MCP_REGISTRY.find((e) => e.id === id);
}
