let badgeInterval = null;
let isRed = false;
let alertingTabId = null;

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
// automatically written to tabDomTriggers so the MutationObserver in
// content-main.js activates without any manual user configuration.
//
// Selector confirmed via live MutationObserver log (issue #11).
// ---------------------------------------------------------------------------
const DEFAULT_DOM_TRIGGERS = {
  'www.perplexity.ai': ['button[aria-label="Approve"]'],
};

/**
 * If the tab's URL matches a known host in DEFAULT_DOM_TRIGGERS,
 * write those selectors to storage so content-main.js picks them up.
 * Safe to call on every tab registration — no-op for unknown hosts.
 *
 * @param {number} tabId
 */
function maybeInjectDomTriggers(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab.url) return;
    try {
      const host = new URL(tab.url).hostname;
      const selectors = DEFAULT_DOM_TRIGGERS[host];
      if (selectors) {
        chrome.storage.local.set({ tabDomTriggers: selectors });
      }
    } catch {
      // Unparseable URL (e.g. chrome:// pages) — ignore
    }
  });
}

// Update memory when popup changes storage
chrome.storage.onChanged.addListener((changes) => {
  if (changes.monitoredTabs) {
    const newTabs = new Set(changes.monitoredTabs.newValue);
    // Inject domTriggers for any newly added tabs
    for (const tabId of newTabs) {
      if (!monitoredTabs.has(tabId)) {
        maybeInjectDomTriggers(tabId);
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
  }
});

// Clean up if the alerting tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === alertingTabId) clearAlert();
  if (monitoredTabs.has(tabId)) {
    monitoredTabs.delete(tabId);
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
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play alert beep'
    });
  }
  chrome.runtime.sendMessage({ type: 'PLAY_AUDIO' });
}
