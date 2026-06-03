import { shouldDebounce, titleMatchesPattern, migrateMonitoredTabs } from './src/utils.js';

const DEBOUNCE_MS = 1000;
const CLEANUP_DELAY_MS = 5000;
const lastAlertTime = {};

let badgeInterval = null;
let isRed = false;
let alertingTabId = null;
let offscreenCreating = null;

// Track monitored tabs as a map of tabId -> { pattern: '' }.
// Storage shape: monitoredTabs = { "123": { pattern: "" }, "456": { pattern: "" } }
let monitoredTabs = {};

// Top-level await: suspend SW module execution here until storage is read.
let res = {};
try {
  res = await chrome.storage.local.get(['monitoredTabs']);
} catch (err) {
  console.error('Failed to read monitoredTabs from storage:', err);
}
monitoredTabs = migrateMonitoredTabs(res.monitoredTabs);
// Defer cleanup so it doesn't block SW startup or race against session
// restore. setTimeout gives Chrome time to finish restoring tabs before
// we cross-reference IDs.
setTimeout(() => {
  cleanupStaleMonitoredTabs().catch(console.error);
}, CLEANUP_DELAY_MS);

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

/**
 * Cross-reference monitored tab IDs against currently open tabs and remove
 * any stale entries (e.g. from a previous browser session where tabs were
 * closed while the extension was not running). This prevents orphaned IDs
 * from accumulating indefinitely.
 */
async function cleanupStaleMonitoredTabs() {
  const keys = Object.keys(monitoredTabs);
  if (keys.length === 0) return;

  const allTabs = await chrome.tabs.query({});
  const liveIds = new Set(allTabs.map(t => t.id));

  let changed = false;
  for (const key of keys) {
    if (!liveIds.has(Number(key))) {
      delete monitoredTabs[key];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ monitoredTabs });
  }
}

// Update memory when popup changes storage
chrome.storage.onChanged.addListener((changes) => {
  if (changes.monitoredTabs) {
    const raw = changes.monitoredTabs.newValue;
    const newTabs = raw && typeof raw === 'object' ? raw : {};
    const oldKeys = Object.keys(monitoredTabs);
    const newKeys = Object.keys(newTabs);

    const oldSet = new Set(oldKeys);
    const newSet = new Set(newKeys);

    for (const key of newKeys) {
      if (!oldSet.has(key)) {
        maybeInjectDomTriggers(Number(key));
      }
    }
    for (const key of oldKeys) {
      if (!newSet.has(key)) {
        removeDomTriggers(Number(key));
      }
    }
    monitoredTabs = newTabs;
  }
});

// 1. Listen for Title Updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.title) return;
  const config = monitoredTabs[String(tabId)];
  if (!config) return;
  if (!titleMatchesPattern(changeInfo.title, config.pattern)) return;
  triggerAlert(tabId);
});

// 2. Listen for Web Notification intercepts and Popup Actions
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'TRIGGER_ALERT' && sender.tab && monitoredTabs[String(sender.tab.id)]) {
    triggerAlert(sender.tab.id);
  } else if (message.type === 'CLEAR_ALERT') {
    clearAlert();
  } else if (message.type === 'MONITOR_TAB' && !sender.tab) {
    if (typeof message.tabId === 'number') {
      const updated = { ...monitoredTabs, [String(message.tabId)]: { pattern: '' } };
      chrome.storage.local.set({ monitoredTabs: updated }).catch(console.error);
    }
  } else if (message.type === 'UNMONITOR_TAB' && !sender.tab) {
    if (typeof message.tabId === 'number') {
      const updated = { ...monitoredTabs };
      delete updated[String(message.tabId)];
      chrome.storage.local.set({ monitoredTabs: updated }).catch(console.error);
    }
  } else if (message.type === 'AUDIO_BLOCKED') {
    chrome.action.setBadgeText({ text: '??' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF8C00' });
    chrome.storage.local.set({ audioBlocked: true });
  } else if (message.type === 'AUDIO_OK') {
    chrome.storage.local.remove(['audioBlocked']);
    if (alertingTabId === null) {
      chrome.action.setBadgeText({ text: '' });
    }
  }
  return false;
});

// Clean up if the alerting tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === alertingTabId) clearAlert();
  const key = String(tabId);
  if (monitoredTabs[key]) {
    const updated = { ...monitoredTabs };
    delete updated[key];
    chrome.storage.local.set({ monitoredTabs: updated }).catch(console.error);
  }
  delete lastAlertTime[tabId];
});

function triggerAlert(tabId) {
  if (shouldDebounce(lastAlertTime, tabId, Date.now(), DEBOUNCE_MS)) return;
  lastAlertTime[tabId] = Date.now();

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
