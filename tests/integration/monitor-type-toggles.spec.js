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
 * Arm the MutationObserver in content-main.js with the test selector.
 * Must be called before any fireDomTrigger* call on a given page.
 */
async function armDomObserver(page) {
  await page.evaluate(() =>
    window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors: ['button[aria-label="Approve"]'] }, '*'),
  );
  // Allow content-main.js to attach the MutationObserver.
  await page.waitForTimeout(200);
}

/**
 * Path 2 — childList mutation: append a new fully-attributed node.
 * Assumes the observer has already been armed via armDomObserver().
 */
async function fireDomTriggerChildList(page) {
  await page.evaluate(() => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Approve');
    document.body.appendChild(btn);
  });
}

/**
 * Monotonically increasing counter so every fireDomTriggerAttr() call
 * injects a node with a unique ID — even when called multiple times
 * within the same page/test. Re-using a hardcoded ID would make the
 * second setAttribute call a no-op (aria-label already set) and the
 * MutationObserver would never fire.
 */
let attrTargetSeq = 0;

/**
 * Path 3 — attribute mutation: create a plain node then set aria-label.
 * A unique ID is generated per call so repeated invocations on the same
 * page each target a fresh, unattributed node.
 * Assumes the observer has already been armed via armDomObserver().
 */
async function fireDomTriggerAttr(page) {
  const nodeId = `attr-mutation-target-${++attrTargetSeq}`;
  // Step 1: append node WITHOUT the triggering attribute (childList fires
  // but the selector won't match, so no alert is triggered here).
  await page.evaluate((id) => {
    const btn = document.createElement('button');
    btn.id = id;
    document.body.appendChild(btn);
  }, nodeId);
  // Step 2: set the triggering attribute — this is the attribute mutation
  // that the observer is watching for.
  await page.evaluate((id) => {
    document.getElementById(id).setAttribute('aria-label', 'Approve');
  }, nodeId);
}


/**
 * Clear the current alert between sub-checks. The service worker mirrors this
 * storage removal into its in-memory alert/debounce state via storage.onChanged.
 */
async function clearActiveAlert(serviceWorker) {
  await serviceWorker.evaluate(() => chrome.storage.local.remove(['alertingTabId']));
  // Give chrome.storage.onChanged in the service worker a turn to synchronize
  // its in-memory alertingTabId/lastAlertTime with the persisted removal.
  await serviceWorker.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

/**
 * Arm the observer once then fire both DOM mutation paths sequentially.
 * Calls assertFn with the mutation type string after each fire, then
 * resets alertingTabId so the next sub-check starts clean.
 *
 * @param {object}   page
 * @param {Function} assertFn        Called with ('childList'|'attr').
 * @param {Function} getStorage
 * @param {object}   serviceWorker   Resets alertingTabId between sub-checks.
 */
async function fireBothDomPaths(page, assertFn, getStorage, serviceWorker) {
  await armDomObserver(page);

  // Path 2 — childList
  await fireDomTriggerChildList(page);
  await assertFn('childList');
  await clearActiveAlert(serviceWorker);

  // Path 3 — attribute (unique node ID guaranteed by attrTargetSeq)
  await fireDomTriggerAttr(page);
  await assertFn('attr');
  await clearActiveAlert(serviceWorker);
}

/**
 * Change document.title on the page (Path 4 — onUpdated in background SW).
 */
async function fireTitleChange(page) {
  await page.evaluate(() => { document.title = '(test) title updated'; });
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

  test('TC-INT-22: monitorDomTriggers=false suppresses both DOM mutation paths', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page } = await setupMonitoredTab(context, serviceWorker, {
      monitorDomTriggers: false,
    });

    await armDomObserver(page);

    // Path 2 — childList
    await fireDomTriggerChildList(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    // Path 3 — attribute
    await fireDomTriggerAttr(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

  test('TC-INT-23: monitorDomTriggers=true fires both DOM mutation paths', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      monitorDomTriggers: true,
    });

    await fireBothDomPaths(
      page,
      async (mutationType) => {
        await expect.poll(
          () => getStorage(['alertingTabId']).then(s => s.alertingTabId),
          { timeout: 5000, message: `DOM ${mutationType} mutation should fire alert` },
        ).toBe(tabId);
      },
      getStorage,
      serviceWorker,
    );
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

  test('TC-INT-26: monitorWebNotifications=false still allows both DOM paths and title alert', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupMonitoredTab(context, serviceWorker, {
      monitorWebNotifications: false,
      monitorDomTriggers: true,
      monitorTitleUpdates: true,
    });

    // Notification must be suppressed.
    await fireNotification(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    // Both DOM paths must still fire.
    await fireBothDomPaths(
      page,
      async (mutationType) => {
        await expect.poll(
          () => getStorage(['alertingTabId']).then(s => s.alertingTabId),
          { timeout: 5000, message: `DOM ${mutationType} should fire when only notifications disabled` },
        ).toBe(tabId);
      },
      getStorage,
      serviceWorker,
    );

    // Title change must still fire.
    await fireTitleChange(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
    await clearActiveAlert(serviceWorker);
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

    // Both DOM paths must be suppressed.
    await armDomObserver(page);
    await fireDomTriggerChildList(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    await fireDomTriggerAttr(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    // Notification must still fire.
    await fireNotification(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 4000 }).toBe(tabId);
    await clearActiveAlert(serviceWorker);

    // Title change must still fire.
    await fireTitleChange(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
    await clearActiveAlert(serviceWorker);
  });

  test('TC-INT-28: monitorTitleUpdates=false still allows notification and both DOM paths', async ({
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
    await clearActiveAlert(serviceWorker);

    // Both DOM paths must still fire.
    await fireBothDomPaths(
      page,
      async (mutationType) => {
        await expect.poll(
          () => getStorage(['alertingTabId']).then(s => s.alertingTabId),
          { timeout: 5000, message: `DOM ${mutationType} should fire when only title updates disabled` },
        ).toBe(tabId);
      },
      getStorage,
      serviceWorker,
    );
  });

});

// ---------------------------------------------------------------------------
// TC-INT-29–30: alertOnActive toggle
// ---------------------------------------------------------------------------
test.describe.serial('TC-INT-29–30: alertOnActive toggle', () => {

  test('TC-INT-29: alertOnActive=false suppresses all paths when tab is active', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page } = await setupMonitoredTab(context, serviceWorker, {
      alertOnActive: false,
      monitorWebNotifications: true,
      monitorDomTriggers: true,
      monitorTitleUpdates: true,
    }, true); // keepActive=true

    await fireNotification(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    await armDomObserver(page);
    await fireDomTriggerChildList(page);
    await page.waitForTimeout(600);
    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();

    await fireDomTriggerAttr(page);
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

    // Notification.
    await fireNotification(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 4000 }).toBe(tabId);
    await clearActiveAlert(serviceWorker);

    // Both DOM paths.
    await fireBothDomPaths(
      page,
      async (mutationType) => {
        await expect.poll(
          () => getStorage(['alertingTabId']).then(s => s.alertingTabId),
          { timeout: 5000, message: `DOM ${mutationType} should fire with alertOnActive=true` },
        ).toBe(tabId);
      },
      getStorage,
      serviceWorker,
    );

    // Title change.
    await fireTitleChange(page);
    await expect.poll(() => getStorage(['alertingTabId']).then(s => s.alertingTabId),
      { timeout: 5000 }).toBe(tabId);
  });

});

// ---------------------------------------------------------------------------
// TC-INT-31–35: monitorAllTabs toggle
// ---------------------------------------------------------------------------
test.describe.serial('TC-INT-31–35: monitorAllTabs toggle', () => {

  async function setupUnmonitoredTab(context, serviceWorker, extraStorage = {}, keepActive = false) {
    const page = await context.newPage();
    await page.goto('https://example.com');

    const tabId = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
      return tabs[0]?.id;
    });

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

  test('TC-INT-32: monitorAllTabs=true fires both DOM mutation paths on unmonitored tab', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page, tabId } = await setupUnmonitoredTab(context, serviceWorker, {
      monitorAllTabs: true,
      monitorDomTriggers: true,
    });

    await fireBothDomPaths(
      page,
      async (mutationType) => {
        await expect.poll(
          () => getStorage(['alertingTabId']).then(s => s.alertingTabId),
          { timeout: 5000, message: `DOM ${mutationType} should fire under monitorAllTabs` },
        ).toBe(tabId);
      },
      getStorage,
      serviceWorker,
    );
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

    await fireNotification(page);
    await armDomObserver(page);
    await fireDomTriggerChildList(page);
    await fireDomTriggerAttr(page);
    await fireTitleChange(page);
    await page.waitForTimeout(1500);

    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

  test('TC-INT-35: type toggles are still respected under monitorAllTabs=true', async ({
    context, serviceWorker, getStorage, clearStorage,
  }) => {
    await clearStorage();
    const { page } = await setupUnmonitoredTab(context, serviceWorker, {
      monitorAllTabs: true,
      monitorWebNotifications: false,
      monitorDomTriggers: false,
      monitorTitleUpdates: false,
    });

    await fireNotification(page);
    await armDomObserver(page);
    await fireDomTriggerChildList(page);
    await fireDomTriggerAttr(page);
    await fireTitleChange(page);
    await page.waitForTimeout(1500);

    expect((await getStorage(['alertingTabId'])).alertingTabId).toBeUndefined();
  });

});
