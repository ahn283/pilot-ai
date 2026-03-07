import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const testDir = '/tmp/pilot-phase2-int-test';

vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => testDir,
}));

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, 'skills'), { recursive: true });
  await fs.mkdir(path.join(testDir, 'browser-profile'), { recursive: true });
  try { await fs.unlink(path.join(testDir, 'cron-jobs.json')); } catch {}
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

// --- 2.1 Browser session persistence ---
const _mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue('Test'),
  url: vi.fn().mockReturnValue('https://test.com'),
  screenshot: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  fill: vi.fn().mockResolvedValue(undefined),
  keyboard: { press: vi.fn() },
  $: vi.fn(),
  $$eval: vi.fn(),
  innerText: vi.fn(),
  waitForEvent: vi.fn(),
  waitForLoadState: vi.fn(),
};
const _mockCtx = {
  newPage: vi.fn().mockResolvedValue(_mockPage),
  close: vi.fn().mockResolvedValue(undefined),
  storageState: vi.fn().mockResolvedValue({
    cookies: [{ name: 'session', value: 'abc', domain: 'test.com' }],
    origins: [],
  }),
};
const _mockBrowser = {
  newContext: vi.fn().mockResolvedValue(_mockCtx),
  close: vi.fn().mockResolvedValue(undefined),
  isConnected: vi.fn().mockReturnValue(true),
};

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn().mockResolvedValue(_mockBrowser) },
}));

describe('browser session persistence (2.1)', () => {

  it('saves encrypted session and restores on next launch', async () => {
    const { launchBrowser, closeBrowser } = await import('../../src/tools/browser.js');
    await launchBrowser();
    await closeBrowser();

    const sessionPath = path.join(testDir, 'browser-profile', 'session.enc');
    const stat = await fs.stat(sessionPath);
    expect(stat.size).toBeGreaterThan(0);

    _mockBrowser.newContext.mockClear();
    await launchBrowser();
    expect(_mockBrowser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ storageState: expect.any(Object) }),
    );
    await closeBrowser();
  });
});

// --- 2.4 Heartbeat scheduled execution ---
describe('heartbeat schedule execution (2.4)', () => {
  it('executes matching cron jobs and reports to messenger', async () => {
    const {
      addCronJob,
      onJobExecute,
      tick,
      setHeartbeatReporter,
    } = await import('../../src/agent/heartbeat.js');

    const results: string[] = [];
    const mockReporter = {
      sendText: vi.fn(async () => 'ts'),
      sendApproval: vi.fn(async () => {}),
    };
    setHeartbeatReporter(mockReporter, 'C123');
    onJobExecute(async (job) => { results.push(job.command); return `done: ${job.command}`; });

    await addCronJob({ cron: '30 14 * * *', command: 'run tests' });
    const executed = await tick(new Date(2026, 2, 7, 14, 30));

    expect(executed).toHaveLength(1);
    expect(results).toEqual(['run tests']);
    expect(mockReporter.sendText).toHaveBeenCalledWith('C123', expect.stringContaining('run tests'));

    setHeartbeatReporter(null as any, '');
  });
});

// --- 2.5 Skills matching ---
describe('skills matching (2.5)', () => {
  it('builds skills context for LLM prompt', async () => {
    const { createSkill, buildSkillsContext } = await import('../../src/agent/skills.js');
    await createSkill({
      name: 'Deploy',
      trigger: 'When the user asks to deploy or ship',
      steps: '1. Run tests\n2. Build\n3. Deploy',
    });

    const context = await buildSkillsContext();
    expect(context).toContain('<SKILLS>');
    expect(context).toContain('Deploy');
    expect(context).toContain('deploy or ship');
  });
});

// --- 2.5/2.4 Tool descriptions for LLM ---
describe('tool descriptions for LLM (2.4/2.5)', () => {
  it('includes heartbeat and skills CRUD tools', async () => {
    const { buildToolDescriptions } = await import('../../src/agent/tool-descriptions.js');
    const desc = buildToolDescriptions();
    expect(desc).toContain('addCronJob');
    expect(desc).toContain('createSkill');
    expect(desc).toContain('listCronJobs');
    expect(desc).toContain('listSkills');
  });
});

// --- 2.6 Webhook endpoint ---
describe('webhook endpoint (2.6)', () => {
  it('responds to health check', async () => {
    const { ApiServer } = await import('../../src/api/server.js');
    const token = ApiServer.generateToken();
    const port = 39141 + Math.floor(Math.random() * 1000);
    const server = new ApiServer(token, port);

    await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const data = await res.json();

    expect(data).toHaveProperty('status', 'running');
    await server.stop();
  });
});

// --- 2.7 GitHub CLI ---
describe('github CLI wrapper (2.7)', () => {
  it('exports all tool functions', async () => {
    const github = await import('../../src/tools/github.js');
    expect(typeof github.createPr).toBe('function');
    expect(typeof github.listIssues).toBe('function');
    expect(typeof github.getChecks).toBe('function');
    expect(typeof github.getPrDiff).toBe('function');
  });
});

// --- 2.9 Multimodal image ---
describe('image utilities (2.9)', () => {
  it('converts image file to data URL', async () => {
    const tmpFile = path.join(testDir, 'test.png');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.writeFile(tmpFile, pngHeader);

    const { imageToDataUrl } = await import('../../src/tools/image.js');
    const dataUrl = await imageToDataUrl(tmpFile);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

// --- 2.11 Obsidian ---
describe('obsidian vault (2.11)', () => {
  it('creates and reads notes', async () => {
    const vaultDir = path.join(testDir, 'vault');
    await fs.mkdir(vaultDir, { recursive: true });

    const { writeNote, readNote, listNotes } = await import('../../src/tools/obsidian.js');
    await writeNote(vaultDir, 'test-note.md', '# Hello\nWorld');
    const content = await readNote(vaultDir, 'test-note.md');
    expect(content).toContain('# Hello');

    const notes = await listNotes(vaultDir);
    expect(notes).toContain('test-note.md');
  });
});

// --- 2.12 Linear ---
describe('linear integration (2.12)', () => {
  it('exports all tool functions', async () => {
    const linear = await import('../../src/tools/linear.js');
    expect(typeof linear.createIssue).toBe('function');
    expect(typeof linear.listMyIssues).toBe('function');
    expect(typeof linear.updateIssueState).toBe('function');
  });
});

// --- 2.13 Figma ---
describe('figma integration (2.13)', () => {
  it('exports all tool functions', async () => {
    const figma = await import('../../src/tools/figma.js');
    expect(typeof figma.configureFigma).toBe('function');
    expect(typeof figma.getFile).toBe('function');
    expect(typeof figma.exportImages).toBe('function');
    expect(typeof figma.getFileComponents).toBe('function');
    expect(typeof figma.getLocalVariables).toBe('function');
    expect(typeof figma.getComments).toBe('function');
    expect(typeof figma.postComment).toBe('function');
  });

  it('throws when not configured', async () => {
    const { configureFigma, getFile } = await import('../../src/tools/figma.js');
    configureFigma(null as any);
    await expect(getFile('test')).rejects.toThrow('Figma not configured');
  });
});
