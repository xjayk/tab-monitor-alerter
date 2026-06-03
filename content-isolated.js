window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'TAB_ALERTER_NOTIFICATION') {
    // Relay native Notification intercept (and DOM observer alerts) to background
    chrome.runtime.sendMessage({ type: 'TRIGGER_ALERT' });

  } else if (event.data.type === 'DOM_OBSERVER_READY') {
    // MAIN world is ready to receive DOM trigger selectors.
    // chrome.tabs is not available in content scripts — the background
    // script resolves the tab ID from sender.tab.id and reads storage
    // on our behalf via the GET_DOM_TRIGGERS message.
    chrome.runtime.sendMessage({ type: 'GET_DOM_TRIGGERS' }, (selectors) => {
      if (chrome.runtime.lastError) return;
      if (Array.isArray(selectors) && selectors.length > 0) {
        window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors }, '*');
      }
    });
  }
});
