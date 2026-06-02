import { test as base, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve to the repo root (two levels up from tests/integration/)
const extensionPath = path.resolve(__dirname, '../../');

// On CI there is no display server — run headless.
// Locally, run headed so the extension UI is visible during development.
const headless = Boolean(process.env.CI);

export const test = base.extend({
  /**
   * Persistent browser context with the unpacked extension loaded.
   * launchPersistentContext is required — extensions cannot be loaded
   * into a regular Playwright browser context.
   *
   * The first argument is the fixtures object — no fixtures are needed
   * for context creation, so it uses an empty destructure.
   */
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless,
      args: [
        // Required for extensions: headless=new is the supported headless
        // mode for Chromium 112+ when running with extensions.
        ...(headless ? ['--headless=new'] : []),
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },

  /**
   * The extension's MV3 service worker.
   * Waits for the SW to register if it hasn't fired yet.
   */
  serviceWorker: async ({ context }, use) => {
    const sw =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await use(sw);
  },

  /**
   * Helper: read keys from chrome.storage.local via the SW context.
   * Usage: const data = await getStorage(['monitoredTabs']);
   *
   * The callback passed to evaluate() is serialised and executed inside
   * the extension service worker — `chrome` is valid there, not here.
   *
   * @param {string[]} keys
   * @returns {Promise<Record<string, unknown>>}
   */
  getStorage: async ({ serviceWorker }, use) => {
    const get = (keys) =>
      serviceWorker.evaluate(
        // eslint-disable-next-line no-undef
        (k) => chrome.storage.local.get(k),
        keys
      );
    await use(get);
  },

  /**
   * Helper: clear all extension storage.
   * Call at the start or end of tests that mutate storage to prevent
   * state leaking between test cases.
   *
   * The callback is executed inside the extension SW — `chrome` is valid there.
   */
  clearStorage: async ({ serviceWorker }, use) => {
    await use(() =>
      // eslint-disable-next-line no-undef
      serviceWorker.evaluate(() => chrome.storage.local.clear())
    );
  },
});

export { expect } from '@playwright/test';
