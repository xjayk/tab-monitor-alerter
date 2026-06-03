import { test, expect } from './fixtures.js';

test.describe('Alert Lifecycle (TC-INT-08–10)', () => {

  test('TC-INT-08: alertingTabId is written to storage when title changes on monitored tab', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const page = await context.newPage();
    await page.goto('https://example.com');

    const tabId = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
      return tabs[0]?.id;
    });

    expect(tabId).toBeDefined();

    await serviceWorker.evaluate(
      (id) => chrome.storage.local.set({ monitoredTabs: { [String(id)]: { pattern: '' } } }),
      tabId
    );

    await page.evaluate("document.title = 'New Title — Alert Me'");

    await expect.poll(async () => {
      const storage = await getStorage(['alertingTabId']);
      return storage.alertingTabId;
    }, { timeout: 5000 }).toBe(tabId);
  });

  test('TC-INT-09: alertingTabId cleared from storage after popup navigation', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const page = await context.newPage();
    await page.goto('https://example.com');

    const tabId = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
      return tabs[0]?.id;
    });

    expect(tabId).toBeDefined();

    await serviceWorker.evaluate(
      (id) => chrome.storage.local.set({
        alertingTabId: id,
        monitoredTabs: { [String(id)]: { pattern: '' } },
      }),
      tabId
    );

    const extId = await serviceWorker.evaluate(() => chrome.runtime.id);
    const popupPage = await context.newPage();
    await Promise.all([
      popupPage.waitForEvent('close', { timeout: 5000 }).catch(() => {}),
      popupPage.goto(`chrome-extension://${extId}/popup.html`).catch(() => {}),
    ]);

    await expect.poll(async () => {
      const storage = await getStorage(['alertingTabId']);
      return storage.alertingTabId;
    }, { timeout: 5000 }).toBeUndefined();
  });

  test('TC-INT-10: popup with stale alertingTabId clears state and renders normal UI', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const staleTabId = 999999;

    await serviceWorker.evaluate(
      (id) => chrome.storage.local.set({ alertingTabId: id }),
      staleTabId
    );

    const before = await getStorage(['alertingTabId']);
    expect(before.alertingTabId).toBe(staleTabId);

    const extId = await serviceWorker.evaluate(() => chrome.runtime.id);
    const popupPage = await context.newPage();
    await Promise.all([
      popupPage.waitForEvent('close', { timeout: 5000 }).catch(() => {}),
      popupPage.goto(`chrome-extension://${extId}/popup.html`).catch(() => {}),
    ]);

    await expect.poll(async () => {
      const storage = await getStorage(['alertingTabId']);
      return storage.alertingTabId;
    }, { timeout: 5000 }).toBeUndefined();

    const popupPage2 = await context.newPage();
    await popupPage2.goto(`chrome-extension://${extId}/popup.html`);
    await expect(popupPage2.locator('#ui-container')).toBeVisible({ timeout: 3000 });
  });

});
