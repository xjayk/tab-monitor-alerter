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
  // native window.Notification calls. This observer watches for those.
  //
  // Configuration flow (MAIN world cannot access chrome.storage directly):
  //   1. MAIN world sends DOM_OBSERVER_READY
  //   2. ISOLATED world reads chrome.storage.local and replies SET_DOM_TRIGGERS
  //   3. MAIN world receives selectors and starts the observer
  //
  // Selector storage shape:
  //   monitoredTabs[tabId].domTriggers = ['selector1', 'selector2']
  // ---------------------------------------------------------------------------

  // Track already-alerted nodes to prevent duplicate alerts for the same element
  const alertedNodes = new WeakSet();

  let observer = null;

  /**
   * Test a single DOM node against pre-validated selectors.
   * No try-catch here — selectors are guaranteed valid by initDomObserver.
   * Keeping this path clean allows JS engines to optimise the hot callback.
   *
   * @param {Element} node
   * @param {string[]} selectors - Pre-validated CSS selector strings
   */
  function checkNode(node, selectors) {
    if (!(node instanceof Element)) return;
    if (alertedNodes.has(node)) return;

    for (const selector of selectors) {
      if (node.matches(selector) || node.querySelector(selector)) {
        alertedNodes.add(node);
        window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, '*');
        // Short-circuit: background debounce handles rapid DOM churn
        return;
      }
    }
  }

  /**
   * Start observing document.body for DOM mutations.
   *
   * @param {string[]} selectors - Pre-validated CSS selector strings
   */
  function startObserver(selectors) {
    if (!selectors || selectors.length === 0) return;
    if (!document.body) return;
    if (observer) {
      // Already running (e.g. selectors updated) — restart cleanly
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
   * Initialise the DOM observer.
   *
   * Because MAIN world content scripts cannot access chrome.storage, we use
   * a postMessage handshake with the ISOLATED world script:
   *   MAIN  →  DOM_OBSERVER_READY  →  ISOLATED
   *   MAIN  ←  SET_DOM_TRIGGERS   ←  ISOLATED (reads storage and replies)
   */
  function initDomObserver() {
    // Listen for the storage reply from the ISOLATED world
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== 'SET_DOM_TRIGGERS') return;

      const selectors = event.data.selectors;
      if (!Array.isArray(selectors) || selectors.length === 0) return;

      // Pre-validate selectors here so checkNode hot path needs no try-catch
      const validSelectors = selectors.filter((selector) => {
        if (typeof selector !== 'string' || selector.trim() === '') return false;
        try {
          document.querySelector(selector);
          return true;
        } catch {
          console.warn('[tab-monitor] Invalid domTrigger selector, skipping:', selector);
          return false;
        }
      });

      if (validSelectors.length > 0) {
        startObserver(validSelectors);
      }
    });

    // Signal to the ISOLATED world that we are ready to receive triggers
    window.postMessage({ type: 'DOM_OBSERVER_READY' }, '*');
  }

  // Wait for DOM to be ready before starting the observer to avoid catching
  // static page-load elements as false positives
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomObserver, { once: true });
  } else {
    initDomObserver();
  }

  // Disconnect observer on page unload to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }, { once: true });

})();
