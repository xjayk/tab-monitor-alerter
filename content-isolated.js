window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'TAB_ALERTER_NOTIFICATION') {
    // Relay native Notification intercept (and DOM observer alerts) to background
    chrome.runtime.sendMessage({ type: 'TRIGGER_ALERT' });

  } else if (event.data && event.data.type === 'DOM_OBSERVER_READY') {
    // MAIN world is ready to receive DOM trigger selectors.
    // chrome.tabs.getCurrent is not available in content scripts — instead
    // we ask the background to resolve our tab ID and read storage for us.
    chrome.runtime.sendMessage({ type: 'GET_DOM_TRIGGERS' }, (selectors) => {
      if (chrome.runtime.lastError) return;
      if (Array.isArray(selectors) && selectors.length > 0) {
        window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors }, window.location.origin);
      }
    });
  }
});
