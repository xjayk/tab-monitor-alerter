let badgeInterval = null;
let isRed = false;
let alertingTabId = null;
let offscreenCreating = null;

// Track monitored tabs in memory (sync with storage)
let monitoredTabs = new Set();

// Top-level await: suspend SW module execution here until storage is read.
// This is intentional — all event listeners below are registered AFTER this
// resolves, guaranteeing monitoredTabs is populated before any event can fire.
// MV3 service workers fully support top-level await.
const res = await chrome.storage.local.get(['monitoredTabs']);
if (res.monitoredTabs) {
  monitoredTabs = new Set(res.monitoredTabs);
}

// ---------------------------------------------------------------------------
// Default DOM trigger selectors per hostname.
// When a tab on a known host is added to monitoredTabs, these selectors are
// written to tabDomTriggers[tabId] so the MutationObserver in content-main.js
// activates without any manual user configuration.
//
// Storage shape: tabDomTriggers = { [tabId: number]: string[] }
// Each tab owns its own entry — no cross-tab overwrite possible.
//
// Selector confirmed via live MutationObserver log (issue #11).
// ---------------------------------------------------------------------------
const DEFAULT_DOM_TRIGGERS = {
  'www.perplexity.ai': ['button[aria-label="Approve"]'],
};

/**
 * If the tab's URL matches a known host in DEFAULT_DOM_TRIGGERS, write
 * those selectors into tabDomTriggers[tabId] in storage so content-isolated.js
 * can deliver them to content-main.js via the SET_DOM_TRIGGERS handshake.
 * Safe to call on every tab registration — no-op for unknown hosts.
 *
 * @param {number} tabId
 */
function maybeInjectDomTriggers(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    // Guard: tab may be undefined if it was closed between registration and
    // this callback firing, or if chrome.tabs.get errors out.
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    try {
      const host = new URL(tab.url).hostname;
      const selectors = DEFAULT_DOM_TRIGGERS[host];
      if (!selectors) return;

      // Read, merge, write — preserves other tabs' entries
      chrome.storage.local.get(['tabDomTriggers'], (result) => {
        if (chrome.runtime.lastError) return;
        const current = result.tabDomTriggers || {};
        chrome.storage.local.set({
          tabDomTriggers: { ...current, [tabId]: selectors },
        });
      });
    } catch {
      // Unparseable URL (e.g. chrome:// pages) — ignore
    }
  });
}

/**
 * Remove a tab's DOM trigger entry from storage when it is unmonitored
 * or closed, to avoid unbounded storage growth.
 *
 * @param {number} tabId
 */
function removeDomTriggers(tabId) {
  chrome.storage.local.get(['tabDomTriggers'], (result) => {
    if (chrome.runtime.lastError) return;
    const current = result.tabDomTriggers || {};
    if (!(tabId in current)) return;
    const updated = { ...current };
    delete updated[tabId];
    chrome.storage.local.set({ tabDomTriggers: updated });
  });
}

// Update memory when popup changes storage
chrome.storage.onChanged.addListener((changes) => {
  if (changes.monitoredTabs) {
    // Fallback to [] guards against newValue being undefined/null when
    // the storage key is cleared entirely.
    const newTabs = new Set(changes.monitoredTabs.newValue || []);
    // Inject domTriggers for any newly added tabs
    for (const tabId of newTabs) {
      if (!monitoredTabs.has(tabId)) {
        maybeInjectDomTriggers(tabId);
      }
    }
    // Clean up domTriggers for tabs that were just removed from monitoring
    for (const tabId of monitoredTabs) {
      if (!newTabs.has(tabId)) {
        removeDomTriggers(tabId);
      }
    }
    monitoredTabs = newTabs;
  }
});

// 1. Listen for Title Updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.title && monitoredTabs.has(tabId)) {
    triggerAlert(tabId);
  }
});

// 2. Listen for Web Notification intercepts and Popup Actions
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'TRIGGER_ALERT' && sender.tab && monitoredTabs.has(sender.tab.id)) {
    triggerAlert(sender.tab.id);
  } else if (message.type === 'CLEAR_ALERT') {
    clearAlert();
  } else if (message.type === 'MONITOR_TAB' && !sender.tab) {
    if (typeof message.tabId === 'number') {
      monitoredTabs.add(message.tabId);
      chrome.storage.local.set({ monitoredTabs: Array.from(monitoredTabs) }).catch(console.error);
    }
  } else if (message.type === 'UNMONITOR_TAB' && !sender.tab) {
    if (typeof message.tabId === 'number') {
      monitoredTabs.delete(message.tabId);
      chrome.storage.local.set({ monitoredTabs: Array.from(monitoredTabs) }).catch(console.error);
    }
  }
});

// Clean up if the alerting tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === alertingTabId) clearAlert();
  if (monitoredTabs.has(tabId)) {
    monitoredTabs.delete(tabId);
    removeDomTriggers(tabId);
    chrome.storage.local.set({ monitoredTabs: Array.from(monitoredTabs) });
  }
});

function triggerAlert(tabId) {
  if (alertingTabId === tabId) return; // Already alerting for this tab

  alertingTabId = tabId;
  chrome.storage.local.set({ alertingTabId });
  playSound();

  if (!badgeInterval) {
    badgeInterval = setInterval(() => {
      chrome.action.setBadgeBackgroundColor({ color: isRed ? '#FF0000' : '#000000' });
      chrome.action.setBadgeText({ text: '!' });
      isRed = !isRed;
    }, 500);
  }
}

function clearAlert() {
  alertingTabId = null;
  chrome.storage.local.remove(['alertingTabId']);
  if (badgeInterval) {
    clearInterval(badgeInterval);
    badgeInterval = null;
  }
  chrome.action.setBadgeText({ text: '' });
}

async function playSound() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existing.length > 0) {
    chrome.runtime.sendMessage({ type: 'PLAY_AUDIO' });
    return;
  }

  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play alert beep'
    });
  }

  try {
    await offscreenCreating;
    chrome.runtime.sendMessage({ type: 'PLAY_AUDIO' });
  } catch (e) {
    console.error('Failed to create offscreen document:', e);
  } finally {
    offscreenCreating = null;
  }
}
