window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'TAB_ALERTER_NOTIFICATION') {
    chrome.runtime.sendMessage({ type: 'TRIGGER_ALERT' });
  }
});
