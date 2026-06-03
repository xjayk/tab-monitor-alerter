if (!window.__tabMonitorIsolated) {
  window.__tabMonitorIsolated = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'TAB_ALERTER_NOTIFICATION') {
      // Relay native Notification intercept (and DOM observer alerts) to background
      chrome.runtime.sendMessage({ type: 'TRIGGER_ALERT' });

    } else if (event.data.type === 'DOM_OBSERVER_READY') {
      // MAIN world is ready to receive DOM trigger selectors.
      // tabDomTriggers is keyed by tab ID to prevent cross-tab overwrites.
      // We resolve our own tab ID via chrome.tabs.getCurrent before reading.
      chrome.tabs.getCurrent((tab) => {
        if (chrome.runtime.lastError || !tab) return;
        const tabId = tab.id;

        chrome.storage.local.get(['tabDomTriggers'], (result) => {
          if (chrome.runtime.lastError) return;
          const allTriggers = result.tabDomTriggers || {};
          const selectors = allTriggers[tabId];
          if (Array.isArray(selectors) && selectors.length > 0) {
            window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors }, '*');
          }
        });
      });
    }
  });
}
