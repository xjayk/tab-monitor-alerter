let _name, _v;
try {
  const { name, version, version_name } = chrome.runtime.getManifest();
  _name = name;
  _v = version_name ?? version;
  console.log(`[tab-alerter/isolated] 🔖 ${_name} v${_v} loaded`);
} catch (e) {
  // Extension context already invalidated at injection time — bail out entirely.
  // This can happen if the service worker reloads while the script is being eval'd.
  console.warn('[tab-alerter/isolated] getManifest() failed at load — context already invalidated:', e.message);
}

const targetOrigin = (window.location.origin === 'null' || window.location.protocol === 'file:') ? '*' : window.location.origin;
try {
  window.postMessage({ type: 'CONTENT_SCRIPT_READY' }, targetOrigin);
} catch (e) {
  if (e.message && e.message.includes('Extension context invalidated')) {
    // Orphaned script — expected when the SW reloads before this runs.
  } else {
    console.warn('[tab-alerter/isolated] postMessage failed at load:', e.message);
  }
}

// Guard: chrome.runtime may be undefined in subframes or sandboxed contexts.
function runtimeAvailable() {
  return typeof chrome !== 'undefined' && !!chrome.runtime;
}

// Guard: chrome.runtime exists but the extension context may have been
// invalidated (service worker reloaded). chrome.runtime.id becomes undefined
// in that state — use it as a cheap liveness probe.
function contextValid() {
  return runtimeAvailable() && !!chrome.runtime.id;
}

function relaySendMessage(msg, responseCallback) {
  if (!contextValid()) {
    // Suppress noisy warnings for orphaned scripts — this is expected when
    // the extension updates or the service worker restarts.
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
      // Orphaned content script — expected after SW reload.
      console.warn('[tab-alerter/isolated] context invalidated (orphaned) — dropping:', msg.type);
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
  if (!contextValid()) return;

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
      // The context may have been invalidated between sendMessage and this
      // async callback firing. Wrap entirely to prevent any access on a dead
      // chrome.runtime from throwing a TypeError.
      try {
        if (chrome.runtime?.lastError) {
          console.warn('[tab-alerter/isolated] GET_DOM_TRIGGERS error:', chrome.runtime.lastError.message);
          return;
        }
        console.log('[tab-alerter/isolated] GET_DOM_TRIGGERS response:', selectors);
        if (Array.isArray(selectors) && selectors.length > 0) {
          window.postMessage({ type: 'SET_DOM_TRIGGERS', selectors }, targetOrigin);
        }
      } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
          console.warn('[tab-alerter/isolated] context invalidated mid-flight in GET_DOM_TRIGGERS callback');
        } else {
          console.warn('[tab-alerter/isolated] GET_DOM_TRIGGERS callback error:', e.message);
        }
      }
    });
  }
});
