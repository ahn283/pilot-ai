import { describe, it, expect } from 'vitest';
import { findMatchingServers, getRegistryEntry, MCP_REGISTRY } from '../../src/tools/mcp-registry.js';

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
    expect(entry!.transport).toBe('http');
    expect(entry!.url).toContain('figma');
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
