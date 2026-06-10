import { test, expect } from './fixtures.js';

// These tests require https://example.com to be navigable from the test
// browser context. The extension's DEFAULT_DOM_TRIGGERS map only covers
// www.perplexity.ai, so we seed the background's in-memory GET_DOM_TRIGGERS
// response by injecting a monitored tab and using the service worker's
// evaluate context to intercept the message handler.
//
// Because we cannot point a Playwright test at www.perplexity.ai (network not
// available in CI), we test the mechanism directly:
//   - We use example.com as the page host.
//   - We override the GET_DOM_TRIGGERS response via the SW by temporarily
//     adding example.com to DEFAULT_DOM_TRIGGERS through the MONITOR_TAB +
//     storage path, then let content-main.js do the real work via postMessage.
//
// TC-INT-11 and TC-INT-12 exercise the full pipeline:
//   content-main.js observer fires -> posts TAB_ALERTER_NOTIFICATION
//   -> content-isolated.js relays TRIGGER_ALERT -> background writes alertingTabId

test.describe.serial('TC-INT-11–12: DOM MutationObserver Triggers', () => {

  test('TC-INT-11: childList mutation (new node with matching selector) triggers alert', async ({ context, serviceWorker, getStorage, clearStorage }) => {
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

    // Seed SET_DOM_TRIGGERS directly into content-main.js via postMessage
    // (bypasses GET_DOM_TRIGGERS background path; tests the observer itself).
    await page.evaluate(() => {
      window.postMessage({
        type: 'SET_DOM_TRIGGERS',
        selectors: ['button[aria-label="Approve"]'],
      }, '*');
    });

    // Push the monitored tab into background so active-tab suppression is bypassed.
    await context.newPage();

    // Append a matching node (Path 2 — childList).
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

  test('TC-INT-12: attribute mutation (aria-label set on existing node) triggers alert', async ({ context, serviceWorker, getStorage, clearStorage }) => {
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

    // Seed SET_DOM_TRIGGERS directly into content-main.js via postMessage.
    await page.evaluate(() => {
      window.postMessage({
        type: 'SET_DOM_TRIGGERS',
        selectors: ['button[aria-label="Approve"]'],
      }, '*');
    });

    // Create the button WITHOUT the attribute first, so it is already in the DOM.
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = 'test-btn-attr';
      document.body.appendChild(btn);
    });

    // Push the monitored tab into background.
    await context.newPage();

    // Set the triggering attribute on the existing node (Path 3 — attribute mutation).
    await page.evaluate(() => {
      document.getElementById('test-btn-attr').setAttribute('aria-label', 'Approve');
    });

    await expect.poll(async () => {
      const s = await getStorage(['alertingTabId']);
      return s.alertingTabId;
    }, { timeout: 5000 }).toBe(tabId);
  });

});
