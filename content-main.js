(function () {

  // ---------------------------------------------------------------------------
  // 1. Notification API Proxy
  // Intercepts window.Notification() calls (native browser notifications)
  // and fires TAB_ALERTER_NOTIFICATION so the isolated script can relay it.
  // ---------------------------------------------------------------------------
  if (window.Notification) {
    const OriginalNotification = window.Notification;

    window.Notification = function (title, options) {
      window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, '*');
      return new OriginalNotification(title, options);
    };

    Object.assign(window.Notification, OriginalNotification);
    window.Notification.prototype = OriginalNotification.prototype;
  }

  // ---------------------------------------------------------------------------
  // 2. DOM MutationObserver — Custom DOM-based alert triggers
  //
  // Some apps render actionable prompts as custom DOM components rather than
  // native window.Notification calls (e.g. Perplexity action banners, Slack
  // huddle prompts, Notion permission modals). This observer watches for those.
  //
  // Configuration:
  //   Selectors are stored per-tab in chrome.storage.local:
  //   monitoredTabs[tabId].domTriggers = ['CSS selector 1', 'CSS selector 2']
  //
  //   Example for Perplexity:
  //   domTriggers: ['[data-testid="action-banner"]', '.agent-action-required']
  //
  // The observer fires the same TAB_ALERTER_NOTIFICATION postMessage as the
  // Notification proxy above, routing through the existing relay chain with
  // no changes to content-isolated.js or background.js.
  // ---------------------------------------------------------------------------

  // Track already-alerted nodes to prevent duplicate alerts for the same element
  const alertedNodes = new WeakSet();

  let observer = null;

  /**
   * Test a single DOM node against the configured selectors.
   * If it matches any selector and hasn’t already triggered an alert,
   * fire TAB_ALERTER_NOTIFICATION.
   *
   * @param {Element} node
   * @param {string[]} selectors
   */
  function checkNode(node, selectors) {
    if (!(node instanceof Element)) return;
    if (alertedNodes.has(node)) return;

    for (const selector of selectors) {
      try {
        if (node.matches(selector) || node.querySelector(selector)) {
          alertedNodes.add(node);
          window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, '*');
          // Only fire once per mutation batch — background debounce handles
          // rapid DOM churn, but we short-circuit here for efficiency
          return;
        }
      } catch (e) {
        // Invalid CSS selector — skip silently
        // (matches() throws on malformed selectors)
        console.warn('[tab-monitor] Invalid domTrigger selector, skipping:', selector, e);
      }
    }
  }

  /**
   * Start observing document.body for DOM mutations.
   * Called once domTriggers have been loaded from storage.
   *
   * @param {string[]} selectors - CSS selectors to watch for
   */
  function startObserver(selectors) {
    if (!selectors || selectors.length === 0) return;
    if (!document.body) return;
    if (observer) {
      // Already running (e.g. storage updated) — disconnect and restart
      observer.disconnect();
    }

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          checkNode(node, selectors);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Load domTriggers from storage for the current tab and start the observer.
   * Uses chrome.storage.local so the ISOLATED world doesn’t need to be
   * involved — MAIN world scripts have access to chrome.storage in MV3.
   *
   * Storage shape expected:
   *   monitoredTabs: {
   *     "<tabId>": {
   *       pattern: "",
   *       domTriggers: ["selector1", "selector2"]   // optional
   *     }
   *   }
   */
  function initDomObserver() {
    // chrome.tabs.getCurrent is not available in MAIN world content scripts.
    // We use chrome.storage.local.get with the full monitoredTabs map and
    // match by inspecting which entry has domTriggers configured.
    // The background script is responsible for scoping domTriggers to the
    // correct tab — the content script simply reads the storage key injected
    // for this tab via chrome.storage.session or a dedicated key.
    //
    // Simpler approach used here: background.js injects a page-scoped key
    // `tabDomTriggers` into chrome.storage.session for this tab’s context.
    // Fall back to empty if not present.
    chrome.storage.local.get(['tabDomTriggers'], (result) => {
      if (chrome.runtime.lastError) return;
      const selectors = result.tabDomTriggers;
      if (Array.isArray(selectors) && selectors.length > 0) {
        startObserver(selectors);
      }
    });
  }

  // Wait for DOM to be ready before starting the observer to avoid catching
  // static page-load elements as false positives
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomObserver, { once: true });
  } else {
    // Document already parsed (script injected late or page is interactive)
    initDomObserver();
  }

  // Clean up observer on page unload to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }, { once: true });

})();
