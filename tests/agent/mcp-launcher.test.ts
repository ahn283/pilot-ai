import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock store to control pilot dir
const mockPilotDir = path.join(os.tmpdir(), `pilot-test-launcher-${Date.now()}`);
vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => mockPilotDir,
}));

import {
  generateLauncherScript,
  removeLauncherScript,
  hasLauncherScript,
  getLauncherPath,
  classifyEnvVars,
} from '../../src/agent/mcp-launcher.js';

beforeEach(async () => {
  await fs.mkdir(mockPilotDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(mockPilotDir, { recursive: true, force: true });
});

describe('mcp-launcher', () => {
  describe('classifyEnvVars', () => {
    it('classifies tokens and keys as secrets', () => {
      const { secrets, nonSecrets } = classifyEnvVars({
        SLACK_BOT_TOKEN: 'xoxb-123',
        FIGMA_API_KEY: 'figd_abc',
        LINEAR_API_TOKEN: 'lin_test',
      });
      expect(Object.keys(secrets)).toEqual(['SLACK_BOT_TOKEN', 'FIGMA_API_KEY', 'LINEAR_API_TOKEN']);
      expect(Object.keys(nonSecrets)).toEqual([]);
    });

    it('classifies file paths as non-secrets', () => {
      const { secrets, nonSecrets } = classifyEnvVars({
        GOOGLE_OAUTH_CREDENTIALS: '/home/user/.pilot/credentials/gcp.json',
        GOOGLE_DRIVE_OAUTH_CREDENTIALS: '~/.pilot/credentials/drive.json',
      });
      expect(Object.keys(nonSecrets)).toEqual(['GOOGLE_OAUTH_CREDENTIALS', 'GOOGLE_DRIVE_OAUTH_CREDENTIALS']);
      expect(Object.keys(secrets)).toEqual([]);
    });

    it('classifies site names, emails, team IDs as non-secrets', () => {
      const { secrets, nonSecrets } = classifyEnvVars({
        ATLASSIAN_SITE_NAME: 'mycompany',
        ATLASSIAN_USER_EMAIL: 'user@example.com',
        SLACK_TEAM_ID: 'T123ABC',
        ATLASSIAN_API_TOKEN: 'secret-token',
      });
      expect(Object.keys(nonSecrets)).toEqual(['ATLASSIAN_SITE_NAME', 'ATLASSIAN_USER_EMAIL', 'SLACK_TEAM_ID']);
      expect(Object.keys(secrets)).toEqual(['ATLASSIAN_API_TOKEN']);
    });

    it('returns empty objects for empty input', () => {
      const { secrets, nonSecrets } = classifyEnvVars({});
      expect(secrets).toEqual({});
      expect(nonSecrets).toEqual({});
    });
  });

  describe('generateLauncherScript', () => {
    it('creates a script file with correct permissions', async () => {
      const scriptPath = await generateLauncherScript(
        'gmail',
        '@shinzolabs/gmail-mcp',
        { CLIENT_ID: 'mcp-gmail-client-id', CLIENT_SECRET: 'mcp-gmail-client-secret' },
      );

      expect(scriptPath).toBe(getLauncherPath('gmail'));
      const stat = await fs.stat(scriptPath);
      // Check file is executable (mode 0o700 = rwx------)
      expect(stat.mode & 0o777).toBe(0o700);
    });

    it('generates script that reads from keychain', async () => {
      const scriptPath = await generateLauncherScript(
        'gmail',
        '@shinzolabs/gmail-mcp',
        { CLIENT_ID: 'mcp-gmail-client-id', REFRESH_TOKEN: 'mcp-gmail-refresh-token' },
      );

      const content = await fs.readFile(scriptPath, 'utf-8');
      expect(content).toContain('#!/bin/bash');
      expect(content).toContain('security find-generic-password');
      expect(content).toContain('pilot-ai:mcp-gmail-client-id');
      expect(content).toContain('pilot-ai:mcp-gmail-refresh-token');
      expect(content).toContain('export CLIENT_ID=');
      expect(content).toContain('export REFRESH_TOKEN=');
      expect(content).toContain('exec npx -y "@shinzolabs/gmail-mcp"');
      // Should NOT contain actual secret values
      expect(content).not.toContain('actual-secret');
    });

    it('includes non-secret env vars directly', async () => {
      const scriptPath = await generateLauncherScript(
        'jira',
        '@aashari/mcp-server-atlassian-jira',
        { ATLASSIAN_API_TOKEN: 'mcp-jira-atlassian-api-token' },
        [],
        { ATLASSIAN_SITE_NAME: 'mycompany', ATLASSIAN_USER_EMAIL: 'user@test.com' },
      );

      const content = await fs.readFile(scriptPath, 'utf-8');
      expect(content).toContain('export ATLASSIAN_SITE_NAME="mycompany"');
      expect(content).toContain('export ATLASSIAN_USER_EMAIL="user@test.com"');
      expect(content).toContain('security find-generic-password');
    });

    it('includes extra args in exec command', async () => {
      const scriptPath = await generateLauncherScript(
        'figma',
        'figma-developer-mcp',
        { FIGMA_API_KEY: 'mcp-figma-figma-api-key' },
        ['--stdio'],
      );

      const content = await fs.readFile(scriptPath, 'utf-8');
      expect(content).toContain('exec npx -y "figma-developer-mcp" "--stdio"');
    });
  });

  describe('removeLauncherScript', () => {
    it('removes an existing script', async () => {
      await generateLauncherScript('test', 'test-pkg', { KEY: 'k' });
      expect(await hasLauncherScript('test')).toBe(true);

      await removeLauncherScript('test');
      expect(await hasLauncherScript('test')).toBe(false);
    });

    it('does not throw for non-existent script', async () => {
      await expect(removeLauncherScript('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('hasLauncherScript', () => {
    it('returns false when no script exists', async () => {
      expect(await hasLauncherScript('nope')).toBe(false);
    });

    it('returns true after script is generated', async () => {
      await generateLauncherScript('check', 'pkg', { K: 'v' });
      expect(await hasLauncherScript('check')).toBe(true);
    });
  });

  describe('getLauncherPath', () => {
    it('returns correct path under pilot dir', () => {
      const p = getLauncherPath('gmail');
      expect(p).toBe(path.join(mockPilotDir, 'mcp-launchers', 'gmail.sh'));
    });
  });
});
