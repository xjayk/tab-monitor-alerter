const { name, version, version_name } = chrome.runtime.getManifest();
const _v = version_name ?? version;
console.log(`[tab-alerter/isolated] \uD83D\uDD16 ${name} v${_v} loaded`);

const targetOrigin = (window.location.origin === 'null' || window.location.protocol === 'file:') ? '*' : window.location.origin;
window.postMessage({ type: 'CONTENT_SCRIPT_READY' }, targetOrigin);

// Guard: chrome.runtime may be undefined in subframes or sandboxed contexts.
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
      console.warn('[tab-alerter/isolated] Extension context invalidated — content script is orphaned');
    } else {
      console.warn('[tab-alerter/isolated] sendMessage error:', e.message);
    }
  }
}

window.addEventListener('message', (event) => {
  // Bail out early for any frame where chrome.runtime is not available
  // (cross-origin iframes, sandboxed frames). content-main.js only runs in
  // the MAIN world of the top frame, but content-isolated.js is injected
  // into every frame. Without this guard, subframe instances attempt to
  // relay messages and spam warnings without ever succeeding.
  if (!runtimeAvailable()) return;

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

  // CS_PING: manual test page handshake — reply with CS_PONG so the page
  // can confirm content scripts are injected without relying on the
  // fire-and-forget CONTENT_SCRIPT_READY message (which is always posted
  // before the page's listener is attached).
  if (event.data && event.data.type === 'CS_PING') {
    console.log('[tab-alerter/isolated] CS_PING received, sending CS_PONG');
    window.postMessage({ type: 'CS_PONG' }, targetOrigin);

  } else if (event.data && event.data.type === 'TAB_ALERTER_NOTIFICATION') {
    console.log('[tab-alerter/isolated] relaying TRIGGER_ALERT to background, source:', event.data.source);
    relaySendMessage({ type: 'TRIGGER_ALERT', source: event.data.source || 'notification' });

  } else if (event.data && event.data.type === 'DOM_OBSERVER_READY') {
    console.log('[tab-alerter/isolated] received DOM_OBSERVER_READY, sending GET_DOM_TRIGGERS to background');
    relaySendMessage({ type: 'GET_DOM_TRIGGERS' }, (selectors) => {
      // Use optional chaining: chrome.runtime may become undefined between
      // the sendMessage call and this async callback firing (context
      // invalidated mid-flight). Bare access would throw a TypeError.
      if (chrome.runtime?.lastError) {
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
