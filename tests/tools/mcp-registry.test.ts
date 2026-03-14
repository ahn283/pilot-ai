import { describe, it, expect } from 'vitest';
import { findMatchingServers, getRegistryEntry, MCP_REGISTRY, parseAtlassianSiteName } from '../../src/tools/mcp-registry.js';

describe('mcp-registry', () => {
  it('MCP_REGISTRY contains known servers', () => {
    expect(MCP_REGISTRY.length).toBeGreaterThan(5);
    const ids = MCP_REGISTRY.map((e) => e.id);
    expect(ids).toContain('figma');
    expect(ids).toContain('github');
    expect(ids).toContain('notion');
    expect(ids).toContain('slack');
    expect(ids).toContain('postgres');
  });

  it('getRegistryEntry returns entry by ID', () => {
    const entry = getRegistryEntry('figma');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Figma');
    expect(entry!.npmPackage).toBe('figma-developer-mcp');
    expect(entry!.envVars).toHaveProperty('FIGMA_API_KEY');
  });

  it('getRegistryEntry returns undefined for unknown ID', () => {
    expect(getRegistryEntry('nonexistent')).toBeUndefined();
  });

  it('findMatchingServers matches by keywords', () => {
    const results = findMatchingServers('I need to check the Figma design');
    expect(results.some((r) => r.id === 'figma')).toBe(true);
  });

  it('findMatchingServers matches case-insensitively', () => {
    const results = findMatchingServers('Check my GITHUB pull request');
    expect(results.some((r) => r.id === 'github')).toBe(true);
  });

  it('findMatchingServers returns empty for no match', () => {
    const results = findMatchingServers('hello world');
    expect(results).toHaveLength(0);
  });

  it('findMatchingServers can match multiple servers', () => {
    const results = findMatchingServers('search slack channel and check github pr');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  describe('parseAtlassianSiteName', () => {
    it('extracts site name from standard Atlassian Cloud URL', () => {
      expect(parseAtlassianSiteName('https://mycompany.atlassian.net')).toBe('mycompany');
    });

    it('extracts site name from URL with path', () => {
      expect(parseAtlassianSiteName('https://mycompany.atlassian.net/wiki/spaces')).toBe('mycompany');
    });

    it('extracts site name from domain without protocol', () => {
      expect(parseAtlassianSiteName('mycompany.atlassian.net')).toBe('mycompany');
    });

    it('returns raw site name as-is for backward compatibility', () => {
      expect(parseAtlassianSiteName('mycompany')).toBe('mycompany');
    });

    it('returns full hostname for custom domains', () => {
      expect(parseAtlassianSiteName('https://jira.custom-domain.com')).toBe('jira.custom-domain.com');
    });

    it('trims whitespace from input', () => {
      expect(parseAtlassianSiteName('  mycompany  ')).toBe('mycompany');
    });

    it('handles hyphenated site names', () => {
      expect(parseAtlassianSiteName('https://acme-corp.atlassian.net')).toBe('acme-corp');
    });
  });

  it('sentinel-ai has qa category and envVars', () => {
    const entry = getRegistryEntry('sentinel-ai');
    expect(entry).toBeDefined();
    expect(entry!.category).toBe('qa');
    expect(entry!.envVars).toHaveProperty('SENTINEL_REGISTRY_DIR');
    expect(entry!.envVars).toHaveProperty('SENTINEL_REPORTS_DIR');
    expect(entry!.keywords).toContain('playwright');
    expect(entry!.keywords).toContain('qa');
  });

  it('category type includes qa', () => {
    const categories = new Set(MCP_REGISTRY.map((e) => e.category));
    expect(categories.has('qa')).toBe(true);
  });

  it('every entry has required fields', () => {
    for (const entry of MCP_REGISTRY) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
      // HTTP transport servers don't need npmPackage
      if (entry.transport !== 'http') {
        expect(entry.npmPackage).toBeTruthy();
      }
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(entry.category).toBeTruthy();
    }
  });
});
