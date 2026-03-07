import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock playwright
const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue('Test Page'),
  url: vi.fn().mockReturnValue('https://example.com'),
  click: vi.fn().mockResolvedValue(undefined),
  fill: vi.fn().mockResolvedValue(undefined),
  keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  $: vi.fn(),
  $$eval: vi.fn(),
  innerText: vi.fn().mockResolvedValue('Page text content'),
  screenshot: vi.fn().mockResolvedValue(undefined),
  waitForEvent: vi.fn(),
  waitForLoadState: vi.fn().mockResolvedValue(undefined),
};

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined),
  isConnected: vi.fn().mockReturnValue(true),
};

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

const {
  launchBrowser,
  closeBrowser,
  navigateTo,
  clickElement,
  typeText,
  submitForm,
  extractText,
  extractTable,
  takeScreenshot,
  getCurrentUrl,
  isBrowserRunning,
  waitForLoad,
} = await import('../../src/tools/browser.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('browser lifecycle', () => {
  it('launches and closes browser', async () => {
    await launchBrowser();
    expect(isBrowserRunning()).toBe(true);

    await closeBrowser();
  });
});

describe('navigation', () => {
  it('navigates to a URL and returns title', async () => {
    await launchBrowser();
    const result = await navigateTo('https://example.com');
    expect(result.title).toBe('Test Page');
    expect(result.url).toBe('https://example.com');
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    await closeBrowser();
  });
});

describe('element interaction', () => {
  it('clicks an element', async () => {
    await launchBrowser();
    await clickElement('#submit');
    expect(mockPage.click).toHaveBeenCalledWith('#submit', expect.any(Object));
    await closeBrowser();
  });

  it('types text into an element', async () => {
    await launchBrowser();
    await typeText('#email', 'test@example.com');
    expect(mockPage.fill).toHaveBeenCalledWith('#email', 'test@example.com', expect.any(Object));
    await closeBrowser();
  });

  it('submits a form with selector', async () => {
    await launchBrowser();
    await submitForm('button[type="submit"]');
    expect(mockPage.click).toHaveBeenCalledWith('button[type="submit"]', expect.any(Object));
    await closeBrowser();
  });

  it('submits a form with Enter key', async () => {
    await launchBrowser();
    await submitForm();
    expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
    await closeBrowser();
  });
});

describe('content extraction', () => {
  it('extracts full page text', async () => {
    await launchBrowser();
    const text = await extractText();
    expect(text).toBe('Page text content');
    await closeBrowser();
  });

  it('extracts text from a selector', async () => {
    mockPage.$.mockResolvedValue({ textContent: () => Promise.resolve('Element text') });
    await launchBrowser();
    const text = await extractText('.content');
    expect(text).toBe('Element text');
    await closeBrowser();
  });

  it('throws when element not found', async () => {
    mockPage.$.mockResolvedValue(null);
    await launchBrowser();
    await expect(extractText('.missing')).rejects.toThrow('Element not found');
    await closeBrowser();
  });

  it('extracts table data', async () => {
    mockPage.$$eval.mockResolvedValue([
      ['Name', 'Age'],
      ['Alice', '30'],
    ]);
    await launchBrowser();
    const table = await extractTable();
    expect(table).toEqual([['Name', 'Age'], ['Alice', '30']]);
    await closeBrowser();
  });
});

describe('screenshot', () => {
  it('takes a screenshot', async () => {
    await launchBrowser();
    const filePath = await takeScreenshot('/tmp/test.png');
    expect(filePath).toBe('/tmp/test.png');
    expect(mockPage.screenshot).toHaveBeenCalledWith({ path: '/tmp/test.png', fullPage: false });
    await closeBrowser();
  });
});

describe('utility', () => {
  it('returns current URL', async () => {
    await launchBrowser();
    expect(getCurrentUrl()).toBe('https://example.com');
    await closeBrowser();
  });

  it('waits for load state', async () => {
    await launchBrowser();
    await waitForLoad('networkidle');
    expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', expect.any(Object));
    await closeBrowser();
  });
});
