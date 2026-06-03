console.log('[tab-alerter/isolated] script loaded, posting CONTENT_SCRIPT_READY');
const targetOrigin = (window.location.origin === 'null' || window.location.protocol === 'file:') ? '*' : window.location.origin;
window.postMessage({ type: 'CONTENT_SCRIPT_READY' }, targetOrigin);

// Guard: chrome.runtime may be undefined in certain sandboxed contexts.
function runtimeAvailable() {
  return typeof chrome !== 'undefined' && !!chrome.runtime;
}

function relaySendMessage(msg, responseCallback) {
  if (!runtimeAvailable()) {
    console.warn('[tab-alerter/isolated] chrome.runtime unavailable — cannot send:', msg.type);
    return;
  }
  try {
    if (responseCallback) {
      chrome.runtime.sendMessage(msg, responseCallback);
    } else {
      chrome.runtime.sendMessage(msg);
    }
  } catch (e) {
    if (e.message && e.message.includes('Extension context invalidated')) {
      // The extension was reloaded, updated, or disabled. This content script
      // instance is permanently orphaned and cannot communicate with the
      // background. Log and stop — retrying would create an infinite loop.
      console.warn('[tab-alerter/isolated] Extension context invalidated — content script is orphaned');
    } else {
      console.warn('[tab-alerter/isolated] sendMessage error:', e.message);
    }
  }
}

window.addEventListener('message', (event) => {
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
    relaySendMessage({ type: 'TRIGGER_ALERT' });

  } else if (event.data && event.data.type === 'DOM_OBSERVER_READY') {
    console.log('[tab-alerter/isolated] received DOM_OBSERVER_READY, sending GET_DOM_TRIGGERS to background');
    relaySendMessage({ type: 'GET_DOM_TRIGGERS' }, (selectors) => {
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
