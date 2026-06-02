window.addEventListener('message', (event) => {
  // Ensure the message comes from our own window to prevent cross-origin injection
  if (event.source !== window) return;
  if (!event.data) return;

  if (event.data.type === 'TAB_ALERTER_NOTIFICATION') {
    // Relay native Notification intercept (and DOM observer alerts) to background
    chrome.runtime.sendMessage({ type: 'TRIGGER_ALERT' });

  } else if (event.data.type === 'DOM_OBSERVER_READY') {
    // MAIN world is ready to receive DOM trigger selectors.
    // Read from storage (only accessible in ISOLATED world) and reply.
    chrome.storage.local.get(['tabDomTriggers'], (result) => {
      if (chrome.runtime.lastError) return;
      if (Array.isArray(result.tabDomTriggers) && result.tabDomTriggers.length > 0) {
        window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors: result.tabDomTriggers }, '*');
      }
    });
  }
});
