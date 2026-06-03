(function () {
  // Guard against re-injection (e.g. after a SW restart): prevents duplicate
  // Notification proxies, MutationObserver instances, and message listeners.
  if (window.__tabMonitorMain) return;
  window.__tabMonitorMain = true;

  // ---------------------------------------------------------------------------
  // 1. Notification API Proxy
  // ---------------------------------------------------------------------------
  if (window.Notification) {
    const OriginalNotification = window.Notification;

    console.log('[tab-alerter/main] installing Notification proxy');

    window.Notification = function (title, options) {
// TODO: FIX! Broken by merge conflict resolution. <<<<<<< feat/dynamic-content-script-injection
      window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, window.location.origin);
// TODO: FIX! Broken by merge conflict resolution. =======
      console.log('[tab-alerter/main] Notification intercepted, posting TAB_ALERTER_NOTIFICATION. title:', title);
      window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, '*');
// TODO: FIX! Broken by merge conflict resolution. >>>>>>> trunk
      return new OriginalNotification(title, options);
    };

    Object.assign(window.Notification, OriginalNotification);
    window.Notification.prototype = OriginalNotification.prototype;
  } else {
    console.warn('[tab-alerter/main] window.Notification is not available on this page — proxy not installed');
  }

  // ---------------------------------------------------------------------------
  // 2. DOM MutationObserver — Custom DOM-based alert triggers
  //
  // Some apps render actionable prompts as custom DOM components rather than
  // native window.Notification calls. This observer watches for those.
  //
  // Configuration flow (MAIN world cannot access chrome.storage directly):
  //   1. MAIN world sends DOM_OBSERVER_READY
  //   2. ISOLATED world asks background for selectors via GET_DOM_TRIGGERS
  //   3. Background resolves tab ID from sender.tab.id, reads storage, replies
  //   4. ISOLATED world posts SET_DOM_TRIGGERS to MAIN world
  //   5. MAIN world receives selectors and starts the observer
  //
  // Selector storage shape:
  //   tabDomTriggers[tabId] = ['selector1', 'selector2']
  // ---------------------------------------------------------------------------

  const alertedNodes = new WeakSet();
  let observer = null;

  function checkNode(node, selectors) {
    if (!(node instanceof Element)) return;
    if (alertedNodes.has(node)) return;

    for (const selector of selectors) {
      if (node.matches(selector) || node.querySelector(selector)) {
        alertedNodes.add(node);
        
// TODO: FIX! Broken by merge conflict resolution. <<<<<<< feat/dynamic-content-script-injection
        window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, window.location.origin);
        // Short-circuit: background debounce handles rapid DOM churn
// TODO: FIX! Broken by merge conflict resolution. =======
        console.log('[tab-alerter/main] DOM trigger matched selector:', selector, 'node:', node);
        window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, '*');
// TODO: FIX! Broken by merge conflict resolution. >>>>>>> trunk
        
        return;
      }
    }
  }

  function startObserver(selectors) {
    if (!selectors || selectors.length === 0) return;
    if (!document.body) return;
    if (observer) {
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
    
// TODO: FIX! Broken by merge conflict resolution. <<<<<<< feat/dynamic-content-script-injection

    // Scan existing DOM for elements that already match — the observer only
    // fires for future mutations, so elements present at injection time would
    // otherwise be missed (elements loaded as part of the static page).
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => checkNode(node, selectors));
    }
  }

  /**
   * Initialise the DOM observer.
   *
   * Because MAIN world content scripts cannot access chrome.storage, we use
   * a postMessage handshake with the ISOLATED world script:
   *   MAIN  →  DOM_OBSERVER_READY  →  ISOLATED
   *   MAIN  ←  SET_DOM_TRIGGERS   ←  ISOLATED (asks background, relays reply)
   */
// TODO: FIX! Broken by merge conflict resolution. =======
    console.log('[tab-alerter/main] DOM observer started with selectors:', selectors);
  }

// TODO: FIX! Broken by merge conflict resolution. >>>>>>> trunk
 
  function initDomObserver() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== 'SET_DOM_TRIGGERS') return;

      const selectors = event.data.selectors;
      console.log('[tab-alerter/main] received SET_DOM_TRIGGERS, selectors:', selectors);
      if (!Array.isArray(selectors) || selectors.length === 0) return;

      const validSelectors = selectors.filter((selector) => {
        if (typeof selector !== 'string' || selector.trim() === '') return false;
        try {
          document.querySelector(selector);
          return true;
        } catch {
          console.warn('[tab-alerter/main] invalid domTrigger selector, skipping:', selector);
          return false;
        }
      });

      if (validSelectors.length > 0) {
        startObserver(validSelectors);
      }
    });

// TODO: FIX! Broken by merge conflict resolution. <<<<<<< feat/dynamic-content-script-injection
    // Signal to the ISOLATED world that we are ready to receive triggers
    window.postMessage({ type: 'DOM_OBSERVER_READY' }, window.location.origin);
// TODO: FIX! Broken by merge conflict resolution. =======
    console.log('[tab-alerter/main] sending DOM_OBSERVER_READY');
    window.postMessage({ type: 'DOM_OBSERVER_READY' }, '*');
// TODO: FIX! Broken by merge conflict resolution. >>>>>>> trunk
  
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDomObserver, { once: true });
  } else {
    initDomObserver();
  }

  window.addEventListener('beforeunload', () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }, { once: true });

})();
