(function () {
  if (window.__tabMonitorMain) return;
  window.__tabMonitorMain = true;
  const targetOrigin = (window.location.origin === 'null' || window.location.protocol === 'file:') ? '*' : window.location.origin;

  // ---------------------------------------------------------------------------
  // 1. Notification API Proxy
  // ---------------------------------------------------------------------------
  if (window.Notification) {
    const OriginalNotification = window.Notification;

    console.log('[tab-alerter/main] installing Notification proxy');

    window.Notification = function (title, options) {
      console.log('[tab-alerter/main] Notification intercepted, posting TAB_ALERTER_NOTIFICATION. title:', title);
      window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, targetOrigin);
      return new OriginalNotification(title, options);
    };

    Object.assign(window.Notification, OriginalNotification);
    window.Notification.prototype = OriginalNotification.prototype;
  } else {
    console.warn('[tab-alerter/main] window.Notification is not available on this page — proxy not installed');
  }

  // ---------------------------------------------------------------------------
  // 2. DOM MutationObserver
  // ---------------------------------------------------------------------------

  const alertedNodes = new WeakSet();
  let observer = null;

  function checkNode(node, selectors) {
    if (!(node instanceof Element)) return;
    if (alertedNodes.has(node)) return;

    for (const selector of selectors) {
      if (node.matches(selector) || node.querySelector(selector)) {
        alertedNodes.add(node);
        console.log('[tab-alerter/main] DOM trigger matched selector:', selector, 'node:', node);
        window.postMessage({ type: 'TAB_ALERTER_NOTIFICATION' }, targetOrigin);
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
    console.log('[tab-alerter/main] DOM observer started with selectors:', selectors);

    // Scan existing DOM for elements that already match — the observer only
    // fires for future mutations, so elements present at injection time would
    // otherwise be missed (elements loaded as part of the static page).
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => checkNode(node, selectors));
    }
  }

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

    console.log('[tab-alerter/main] sending DOM_OBSERVER_READY');
    window.postMessage({ type: 'DOM_OBSERVER_READY' }, targetOrigin);
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
