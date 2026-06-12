import { test, expect } from './fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up a monitored tab at https://example.com and return its tabId.
 * Pushes a second blank page so the monitored tab is in the background
 * (avoids active-tab suppression from alertOnActive=false).
 */
async function setupMonitoredTab(context, serviceWorker) {
  const page = await context.newPage();
  await page.goto('https://example.com');

  const tabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
    return tabs[0]?.id;
  });

  await serviceWorker.evaluate(
    (id) => chrome.storage.local.set({ monitoredTabs: { [String(id)]: { pattern: '' } } }),
    tabId,
  );

  // Push the monitored tab into the background.
  await context.newPage();

  return { page, tabId };
}

// ---------------------------------------------------------------------------
// TC-INT-20–24: Per-type monitor toggle gates
// ---------------------------------------------------------------------------
test.describe.serial('TC-INT-20–24: Per-type monitor toggle gates', () => {

  // -------------------------------------------------------------------------
  // TC-INT-20: monitorWebNotifications=false suppresses notification alerts
  // -------------------------------------------------------------------------
  test('TC-INT-20: monitorWebNotifications=false suppresses TRIGGER_ALERT from notification source', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker);

    // Disable notification-type alerts.
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({ monitorWebNotifications: false }),
    );

    // Simulate Path 1 — notification source.
    await page.evaluate(() =>
      window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION', source: 'notification' }, '*'),
    );

    await page.waitForTimeout(800);

    const storage = await getStorage(['alertingTabId']);
    expect(storage.alertingTabId).toBeUndefined();
    void tabId; // used by setupMonitoredTab
  });

  // -------------------------------------------------------------------------
  // TC-INT-21: monitorWebNotifications=true still fires (control case)
  // -------------------------------------------------------------------------
  test('TC-INT-21: monitorWebNotifications=true still fires alert from notification source', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker);

    // Explicitly enable (mirrors default / freshly-set true).
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({ monitorWebNotifications: true }),
    );

    await page.evaluate(() =>
      window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION', source: 'notification' }, '*'),
    );

    await expect.poll(async () => {
      const s = await getStorage(['alertingTabId']);
      return s.alertingTabId;
    }, { timeout: 4000 }).toBe(tabId);
  });

  // -------------------------------------------------------------------------
  // TC-INT-22: monitorDomTriggers=false suppresses DOM trigger alerts
  // -------------------------------------------------------------------------
  test('TC-INT-22: monitorDomTriggers=false suppresses TRIGGER_ALERT from dom_trigger source', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker);

    // Seed DOM triggers so content-main.js arms its observer.
    await page.evaluate(() =>
      window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors: ['button[aria-label="Approve"]'] }, '*'),
    );

    // Disable DOM-trigger-type alerts.
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({ monitorDomTriggers: false }),
    );

    // Inject a matching node (Path 2 — childList mutation).
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Approve');
      document.body.appendChild(btn);
    });

    await page.waitForTimeout(800);

    const storage = await getStorage(['alertingTabId']);
    expect(storage.alertingTabId).toBeUndefined();
    void tabId;
  });

  // -------------------------------------------------------------------------
  // TC-INT-23: monitorDomTriggers=true still fires (control case)
  // -------------------------------------------------------------------------
  test('TC-INT-23: monitorDomTriggers=true still fires alert from dom_trigger source', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker);

    await page.evaluate(() =>
      window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors: ['button[aria-label="Approve"]'] }, '*'),
    );

    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({ monitorDomTriggers: true }),
    );

    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Approve');
      document.body.appendChild(btn);
    });

    await expect.poll(async () => {
      const s = await getStorage(['alertingTabId']);
      return s.alertingTabId;
    }, { timeout: 5000 }).toBe(tabId);
  });

  // -------------------------------------------------------------------------
  // TC-INT-24: monitorTitleUpdates=false suppresses title-change alerts
  //
  // Title changes are handled by chrome.tabs.onUpdated in the background SW,
  // not by content scripts. We mutate document.title and wait long enough for
  // the onUpdated event to have fired — if the toggle is respected, no alert.
  // -------------------------------------------------------------------------
  test('TC-INT-24: monitorTitleUpdates=false suppresses alert on title change', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker);

    // Disable title-update alerts.
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({ monitorTitleUpdates: false }),
    );

    // Change the title (Path 4).
    await page.evaluate(() => { document.title = '(test) title changed'; });

    // Allow time for onUpdated to fire and background to process.
    await page.waitForTimeout(1500);

    const storage = await getStorage(['alertingTabId']);
    expect(storage.alertingTabId).toBeUndefined();
    void tabId;
  });

});
