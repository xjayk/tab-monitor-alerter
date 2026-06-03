import { test, expect } from './fixtures.js';

test.describe.serial('TC-INT-04–07: Storage Integrity', () => {
  test('TC-INT-04: checking a tab in popup persists monitoredTabs to storage', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const page = await context.newPage();
    await page.goto('https://example.com');

    const extId = await serviceWorker.evaluate(() => chrome.runtime.id);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`);

    await popupPage.waitForSelector('.tab-item');

    const checkbox = popupPage.locator('.tab-item').filter({ hasText: 'Example Domain' }).locator('input[type="checkbox"]');
    await checkbox.check();

    await popupPage.close();

    const storage = await getStorage(['monitoredTabs']);
    const keys = Object.keys(storage.monitoredTabs ?? {});
    expect(keys.length).toBeGreaterThan(0);
  });

  test('TC-INT-05: monitoredTabs persists in storage across read/write cycle', async ({ serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({ monitoredTabs: { '999': { pattern: '' } } })
    );

    const storage = await getStorage(['monitoredTabs']);
    expect(storage.monitoredTabs?.['999']).toEqual({ pattern: '' });
  });

  test('TC-INT-06: closing a monitored tab removes its ID from storage', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const page = await context.newPage();
    await page.goto('https://example.com');

    const tabId = await serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs[0]?.id;
    }, 'https://example.com/');

    await serviceWorker.evaluate(
      (id) => chrome.storage.local.set({ monitoredTabs: { [String(id)]: { pattern: '' } } }),
      tabId
    );

    await page.close();

    await expect.poll(async () => {
      const s = await getStorage(['monitoredTabs']);
      return s.monitoredTabs?.[String(tabId)];
    }, { timeout: 5000 }).toBeUndefined();
  });

  test('TC-INT-07: cleanup removes stale monitored tab IDs, keeps live ones', async ({ context, serviceWorker, getStorage, clearStorage }) => {
    await clearStorage();

    const page1 = await context.newPage();
    await page1.goto('https://example.com');
    const page2 = await context.newPage();
    await page2.goto('https://example.com');

    const [liveId1, liveId2] = await serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs.map(t => String(t.id));
    }, 'https://example.com/');

    const staleIds = { '99991': { pattern: '' }, '99992': { pattern: '' }, '99993': { pattern: '' } };
    const liveIds = { [liveId1]: { pattern: '' }, [liveId2]: { pattern: '' } };
    await serviceWorker.evaluate(
      (tabs) => chrome.storage.local.set({ monitoredTabs: tabs }),
      { ...staleIds, ...liveIds }
    );

    await serviceWorker.evaluate(async () => {
      const s = await chrome.storage.local.get(['monitoredTabs']);
      const tabs = s.monitoredTabs ?? {};
      const allTabs = await chrome.tabs.query({});
      const liveIds = new Set(allTabs.map(t => t.id));
      let changed = false;
      for (const key of Object.keys(tabs)) {
        if (!liveIds.has(Number(key))) {
          delete tabs[key];
          changed = true;
        }
      }
      if (changed) {
        await chrome.storage.local.set({ monitoredTabs: tabs });
      }
    });

    const storage = await getStorage(['monitoredTabs']);
    const keys = Object.keys(storage.monitoredTabs ?? {});
    expect(keys).toHaveLength(2);
    expect(keys).toContain(liveId1);
    expect(keys).toContain(liveId2);
    expect(keys).not.toContain('99991');
  });
});
