window.addEventListener('message', (event) => {
  // Ensure the message comes from our own window to prevent cross-origin injection
  if (event.source !== window) return;
  if (event.data && event.data.type === 'TAB_ALERTER_NOTIFICATION') {
    chrome.runtime.sendMessage({ type: 'TRIGGER_ALERT' });
  }
});
