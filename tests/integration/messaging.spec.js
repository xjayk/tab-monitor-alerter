import { test, expect } from './fixtures.js';

test.describe.serial('TC-INT-01–03: Background ↔ Content Script Messaging', () => {
  test('TC-INT-01: postMessage from MAIN world triggers alert via background', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const page = await context.newPage();
    await page.goto('https://example.com');

    const tabId = await serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs[0]?.id;
    }, 'https://example.com/');
    expect(tabId).toBeDefined();

    await serviceWorker.evaluate(
      (id) => chrome.storage.local.set({ monitoredTabs: { [String(id)]: { pattern: '' } } }),
      tabId
    );

    await page.evaluate(() => {
      window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, '*');
    });

    await expect.poll(async () => {
      const s = await getStorage(['alertingTabId']);
      return s.alertingTabId;
    }, { timeout: 3000 }).toBe(tabId);
  });

  test('TC-INT-02: postMessage with wrong type does not trigger alert', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const page = await context.newPage();
    await page.goto('https://example.com');

    const tabId = await serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs[0]?.id;
    }, 'https://example.com/');
    expect(tabId).toBeDefined();

    await serviceWorker.evaluate(
      (id) => chrome.storage.local.set({ monitoredTabs: { [String(id)]: { pattern: '' } } }),
      tabId
    );

    await page.evaluate(() => {
      window.postMessage({ type: 'WRONG_TYPE', payload: 'should-be-ignored' }, '*');
    });

    await page.waitForTimeout(500);

    const storage = await getStorage(['alertingTabId']);
    expect(storage.alertingTabId).toBeUndefined();
  });

  test('TC-INT-03: 10 postMessages within 500ms trigger 1 alert (debounce)', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const page = await context.newPage();
    await page.goto('https://example.com');

    const tabId = await serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs[0]?.id;
    }, 'https://example.com/');
    expect(tabId).toBeDefined();

    await serviceWorker.evaluate(
      (id) => chrome.storage.local.set({ monitoredTabs: { [String(id)]: { pattern: '' } } }),
      tabId
    );

    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) {
        window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, '*');
      }
    });

    await expect.poll(async () => {
      const s = await getStorage(['alertingTabId']);
      return s.alertingTabId;
    }, { timeout: 3000 }).toBe(tabId);
  });
});
