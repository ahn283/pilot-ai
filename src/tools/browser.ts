import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

function getUserDataDir(): string {
  return path.join(getPilotDir(), 'browser-profile');
}

function getDownloadDir(): string {
  return path.join(getPilotDir(), 'downloads');
}

/**
 * Launches a Chromium browser with an isolated profile.
 */
export async function launchBrowser(): Promise<void> {
  if (browser) return;

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    userAgent: 'PilotAI/1.0',
    acceptDownloads: true,
  });
  page = await context.newPage();
}

/**
 * Closes the browser and cleans up.
 */
export async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
  page = null;
}

function ensurePage(): Page {
  if (!page) throw new Error('Browser not launched. Call launchBrowser() first.');
  return page;
}

/**
 * Navigates to a URL and returns the page title.
 */
export async function navigateTo(url: string): Promise<{ title: string; url: string }> {
  const p = ensurePage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return { title: await p.title(), url: p.url() };
}

/**
 * Clicks an element matching the selector.
 */
export async function clickElement(selector: string): Promise<void> {
  const p = ensurePage();
  await p.click(selector, { timeout: 10000 });
}

/**
 * Types text into an element matching the selector.
 */
export async function typeText(selector: string, text: string): Promise<void> {
  const p = ensurePage();
  await p.fill(selector, text, { timeout: 10000 });
}

/**
 * Submits a form by clicking a submit button or pressing Enter.
 */
export async function submitForm(selector?: string): Promise<void> {
  const p = ensurePage();
  if (selector) {
    await p.click(selector, { timeout: 10000 });
  } else {
    await p.keyboard.press('Enter');
  }
}

/**
 * Extracts visible text content from the page or a specific selector.
 */
export async function extractText(selector?: string): Promise<string> {
  const p = ensurePage();
  if (selector) {
    const element = await p.$(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);
    return (await element.textContent()) ?? '';
  }
  return p.innerText('body');
}

/**
 * Extracts table data from a <table> element.
 */
export async function extractTable(selector: string = 'table'): Promise<string[][]> {
  const p = ensurePage();
  return p.$$eval(`${selector} tr`, (rows) =>
    rows.map((row) => {
      const cells = row.querySelectorAll('td, th');
      return Array.from(cells).map((cell) => cell.textContent?.trim() ?? '');
    }),
  );
}

/**
 * Takes a screenshot and saves it to the specified path.
 * Returns the file path of the screenshot.
 */
export async function takeScreenshot(outputPath?: string): Promise<string> {
  const p = ensurePage();
  const filePath = outputPath ?? path.join(getPilotDir(), 'screenshots', `screenshot-${Date.now()}.png`);

  await p.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

/**
 * Waits for a download and saves it to the downloads directory.
 * Returns the saved file path.
 */
export async function waitForDownload(action: () => Promise<void>): Promise<string> {
  const p = ensurePage();
  const [download] = await Promise.all([
    p.waitForEvent('download', { timeout: 30000 }),
    action(),
  ]);

  const downloadDir = getDownloadDir();
  const filePath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(filePath);
  return filePath;
}

/**
 * Returns the current page URL.
 */
export function getCurrentUrl(): string {
  return ensurePage().url();
}

/**
 * Waits for navigation or network idle after an action.
 */
export async function waitForLoad(state: 'load' | 'domcontentloaded' | 'networkidle' = 'domcontentloaded'): Promise<void> {
  const p = ensurePage();
  await p.waitForLoadState(state, { timeout: 30000 });
}

/**
 * Returns browser status.
 */
export function isBrowserRunning(): boolean {
  return browser !== null && browser.isConnected();
}
