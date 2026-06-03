// Post a sentinel so test pages can detect that the content script was injected.
console.log('[tab-alerter/isolated] script loaded, posting CONTENT_SCRIPT_READY');
const targetOrigin = (window.location.origin === 'null' || window.location.protocol === 'file:') ? '*' : window.location.origin;
window.postMessage({ type: 'CONTENT_SCRIPT_READY' }, targetOrigin);

window.addEventListener('message', (event) => {
  // Log EVERY message before any guard.
  if (event.data && event.data.type) {
    console.log(
      '[tab-alerter/isolated] message received:',
      event.data.type,
      '| event.origin:', event.origin,
      '| window.location.origin:', window.location.origin,
      '| same?', event.origin === window.location.origin,
      '| event.source === window:', event.source === window
    );
  }

  if (event.source !== window) return;

  // On file:// pages the browser sets event.origin to the string "null"
  // (opaque origin per spec) while window.location.origin is "file://".
  // Allow either: same origin as the page, or the opaque-origin sentinel.
  // The event.source === window guard above is the real same-page proof.
  const originOk =
    event.origin === window.location.origin ||
    event.origin === 'null';

  if (!originOk) {
    console.warn('[tab-alerter/isolated] DROPPING message due to origin mismatch:', event.data?.type,
      '| event.origin:', JSON.stringify(event.origin),
      '| window.location.origin:', JSON.stringify(window.location.origin)
    );
    return;
  }

  if (event.data && event.data.type === 'TAB_ALERTER_NOTIFICATION') {
    console.log('[tab-alerter/isolated] relaying TRIGGER_ALERT to background');
    chrome.runtime.sendMessage({ type: 'TRIGGER_ALERT' });

  } else if (event.data && event.data.type === 'DOM_OBSERVER_READY') {
    console.log('[tab-alerter/isolated] received DOM_OBSERVER_READY, sending GET_DOM_TRIGGERS to background');
    chrome.runtime.sendMessage({ type: 'GET_DOM_TRIGGERS' }, (selectors) => {
      if (chrome.runtime.lastError) {
        console.warn('[tab-alerter/isolated] GET_DOM_TRIGGERS error:', chrome.runtime.lastError.message);
        return;
      }
      console.log('[tab-alerter/isolated] GET_DOM_TRIGGERS response:', selectors);
      if (Array.isArray(selectors) && selectors.length > 0) {
        window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors }, targetOrigin);
      }
    });
  }
});
