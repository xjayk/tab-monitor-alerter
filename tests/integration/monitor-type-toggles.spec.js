import { test, expect } from './fixtures.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to https://example.com, register the tab in monitoredTabs, seed
 * the given extra storage keys, then open a second blank tab so the monitored
 * tab is in the background (bypasses alertOnActive=false suppression by
 * default). Returns { page, tabId }.
 *
 * @param {object} context
 * @param {object} serviceWorker
 * @param {object} [extraStorage={}]  Additional keys to write into storage.
 * @param {boolean} [keepActive=false] If true, do NOT push tab to background.
 */
async function setupMonitoredTab(context, serviceWorker, extraStorage = {}, keepActive = false) {
  const page = await context.newPage();
  await page.goto('https://example.com');

  const tabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
    return tabs[0]?.id;
  });

  await serviceWorker.evaluate(
    ([id, extra]) => chrome.storage.local.set({
      monitoredTabs: { [String(id)]: { pattern: '' } },
      ...extra,
    }),
    [tabId, extraStorage],
  );

  if (!keepActive) {
    await context.newPage(); // push monitored tab to background
  }

  return { page, tabId };
}

/**
 * Fire a notification-source postMessage on the given page.
 */
async function fireNotification(page) {
  await page.evaluate(() =>
    window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION', source: 'notification' }, '*'),
  );
}

/**
 * Arm the DOM observer with a selector then inject a matching node.
 */
async function fireDomTrigger(page) {
  // Arm the observer first.
  await page.evaluate(() =>
    window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors: ['button[aria-label="Approve"]'] }, '*'),
  );
  // Small settle time so content-main.js can attach the MutationObserver.
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Approve');
    document.body.appendChild(btn);
  });
}

/**
 * Change document.title on the page (Path 4 — onUpdated in background SW).
 */
async function fireTitleChange(page) {
  await page.evaluate(() => { document.title = '(test) title updated'; });
}

/**
 * Poll storage for alertingTabId up to `timeout` ms.
 * Returns the value (or undefined if not set within the window).
 */
async function pollAlertingTabId(getStorage, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const s = await getStorage(['alertingTabId']);
    if (s.alertingTabId !== undefined) return s.alertingTabId;
    await new Promise(r => setTimeout(r, 100));
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// TC-INT-20–25: Single-toggle suppression + control cases
// ---------------------------------------------------------------------------
test.describe.serial('TC-INT-20–25: Single-toggle suppression', () => {

  test('TC-INT-20: monitorWebNotifications=false suppresses notification alert', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page } = await setupMonitoredTab(context, serviceWorker, {
      monitorWebNotifications: false,
    });

    await fireNotification(page);
    await page.waitForTimeout(800);

    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

  test('TC-INT-21: monitorWebNotifications=true fires notification alert', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      monitorWebNotifications: true,
    });

    await fireNotification(page);

    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 4000 }).toBe(tabId);
  });

  test('TC-INT-22: monitorDomTriggers=false suppresses DOM trigger alert', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page } = await setupMonitoredTab(context, serviceWorker, {
      monitorDomTriggers: false,
    });

    await fireDomTrigger(page);
    await page.waitForTimeout(800);

    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

  test('TC-INT-23: monitorDomTriggers=true fires DOM trigger alert', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      monitorDomTriggers: true,
    });

    await fireDomTrigger(page);

    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

  test('TC-INT-24: monitorTitleUpdates=false suppresses title-change alert', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page } = await setupMonitoredTab(context, serviceWorker, {
      monitorTitleUpdates: false,
    });

    await fireTitleChange(page);
    await page.waitForTimeout(1500);

    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

  test('TC-INT-25: monitorTitleUpdates=true fires title-change alert', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      monitorTitleUpdates: true,
    });

    await fireTitleChange(page);

    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

});

// ---------------------------------------------------------------------------
// TC-INT-26–28: Toggle isolation — disabling one path must not affect others
// ---------------------------------------------------------------------------
test.describe.serial('TC-INT-26–28: Toggle isolation', () => {

  test('TC-INT-26: monitorWebNotifications=false still allows DOM trigger and title alerts', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    // Disable notifications only.
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      monitorWebNotifications: false,
      monitorDomTriggers: true,
      monitorTitleUpdates: true,
    });

    // Notification must be suppressed.
    await fireNotification(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    // DOM trigger must still fire.
    await fireDomTrigger(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);

    // Reset for next sub-check.
    await serviceWorker.evaluate(() => chrome.storage.local.remove(['alertingTabId']));

    // Title change must still fire.
    await fireTitleChange(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

  test('TC-INT-27: monitorDomTriggers=false still allows notification and title alerts', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      monitorWebNotifications: true,
      monitorDomTriggers: false,
      monitorTitleUpdates: true,
    });

    // DOM trigger must be suppressed.
    await fireDomTrigger(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    // Notification must still fire.
    await fireNotification(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 4000 }).toBe(tabId);

    await serviceWorker.evaluate(() => chrome.storage.local.remove(['alertingTabId']));

    // Title change must still fire.
    await fireTitleChange(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

  test('TC-INT-28: monitorTitleUpdates=false still allows notification and DOM trigger alerts', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      monitorWebNotifications: true,
      monitorDomTriggers: true,
      monitorTitleUpdates: false,
    });

    // Title change must be suppressed.
    await fireTitleChange(page);
    await page.waitForTimeout(1500);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    // Notification must still fire.
    await fireNotification(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 4000 }).toBe(tabId);

    await serviceWorker.evaluate(() => chrome.storage.local.remove(['alertingTabId']));

    // DOM trigger must still fire.
    await fireDomTrigger(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

});

// ---------------------------------------------------------------------------
// TC-INT-29–30: alertOnActive toggle
//
// alertOnActive controls whether alerts fire when the triggering tab is the
// currently active (foreground) tab. We keep the tab active (keepActive=true)
// for both tests so the suppression condition is in play.
//
// Note: title-change via onUpdated can only be reliably tested for
// alertOnActive because changing document.title always fires onUpdated;
// notification and DOM paths both go through TRIGGER_ALERT which also
// checks the same aoa gate.
// ---------------------------------------------------------------------------
test.describe.serial('TC-INT-29–30: alertOnActive toggle', () => {

  test('TC-INT-29: alertOnActive=false suppresses all paths when tab is active', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    // keepActive=true: do NOT open a second tab, so monitored tab stays active.
    const { page } = await setupMonitoredTab(context, serviceWorker, {
      alertOnActive: false,
      monitorWebNotifications: true,
      monitorDomTriggers: true,
      monitorTitleUpdates: true,
    }, true);

    await fireNotification(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    await fireDomTrigger(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    await fireTitleChange(page);
    await page.waitForTimeout(1500);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

  test('TC-INT-30: alertOnActive=true fires all paths even when tab is active', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      alertOnActive: true,
      monitorWebNotifications: true,
      monitorDomTriggers: true,
      monitorTitleUpdates: true,
    }, true); // keepActive=true

    // Notification path.
    await fireNotification(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 4000 }).toBe(tabId);
    await serviceWorker.evaluate(() => chrome.storage.local.remove(['alertingTabId']));

    // DOM trigger path.
    await fireDomTrigger(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
    await serviceWorker.evaluate(() => chrome.storage.local.remove(['alertingTabId']));

    // Title change path.
    await fireTitleChange(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

});

// ---------------------------------------------------------------------------
// TC-INT-31–35: monitorAllTabs toggle
//
// When monitorAllTabs=true the background treats every tab as monitored,
// regardless of the monitoredTabs storage entry. We intentionally do NOT add
// the tab to monitoredTabs to confirm auto-monitoring is driving the alert.
// ---------------------------------------------------------------------------
test.describe.serial('TC-INT-31–35: monitorAllTabs toggle', () => {

  /**
   * Open a tab at example.com that is deliberately NOT in monitoredTabs.
   * Sets monitorAllTabs + any extra storage keys.
   * Pushes a second tab to background unless keepActive=true.
   */
  async function setupUnmonitoredTab(context, serviceWorker, extraStorage = {}, keepActive = false) {
    const page = await context.newPage();
    await page.goto('https://example.com');

    const tabId = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
      return tabs[0]?.id;
    });

    // Write settings but NO monitoredTabs entry for this tab.
    await serviceWorker.evaluate(
      ([extra]) => chrome.storage.local.set({ monitoredTabs: {}, ...extra }),
      [extraStorage],
    );

    if (!keepActive) await context.newPage();

    return { page, tabId };
  }

  test('TC-INT-31: monitorAllTabs=true fires notification alert on unmonitored tab', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupUnmonitoredTab(context, serviceWorker, {
      monitorAllTabs: true,
      monitorWebNotifications: true,
    });

    await fireNotification(page);

    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 4000 }).toBe(tabId);
  });

  test('TC-INT-32: monitorAllTabs=true fires DOM trigger alert on unmonitored tab', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupUnmonitoredTab(context, serviceWorker, {
      monitorAllTabs: true,
      monitorDomTriggers: true,
    });

    await fireDomTrigger(page);

    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

  test('TC-INT-33: monitorAllTabs=true fires title alert on unmonitored tab', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupUnmonitoredTab(context, serviceWorker, {
      monitorAllTabs: true,
      monitorTitleUpdates: true,
    });

    await fireTitleChange(page);

    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

  test('TC-INT-34: monitorAllTabs=false does NOT alert unmonitored tab', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page } = await setupUnmonitoredTab(context, serviceWorker, {
      monitorAllTabs: false,
    });

    // Fire all three paths — none should produce an alert.
    await fireNotification(page);
    await fireDomTrigger(page);
    await fireTitleChange(page);
    await page.waitForTimeout(1500);

    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

  test('TC-INT-35: type toggles are still respected under monitorAllTabs=true', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    // All type toggles off — even with monitorAllTabs=true nothing should fire.
    const { page } = await setupUnmonitoredTab(context, serviceWorker, {
      monitorAllTabs: true,
      monitorWebNotifications: false,
      monitorDomTriggers: false,
      monitorTitleUpdates: false,
    });

    await fireNotification(page);
    await fireDomTrigger(page);
    await fireTitleChange(page);
    await page.waitForTimeout(1500);

    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

});
