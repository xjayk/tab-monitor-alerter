import { shouldDebounce, titleMatchesPattern, migrateMonitoredTabs } from './src/utils.js';

const DEBOUNCE_MS = 1000;
const lastAlertTime = {};

// Tracks the last title we saw per tab so onActivated can detect
// whether a title actually changed while the tab was backgrounded.
const lastKnownTitle = {};

let badgeInterval = null;
let isRed = false;
let alertingTabId = null;
let offscreenCreating = null;
let monitoredTabs = {};

const DEFAULT_DOM_TRIGGERS = {
  'www.perplexity.ai': ['button[aria-label="Approve"]'],
};

// Tracks tab IDs into which content scripts have been injected.
// Used to avoid duplicate injection and to know when to re-inject on navigation.
const injectedTabs = new Set();

function isNonInjectableUrl(url) {
  if (!url) return false;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:')
  );
}

async function init() {
  let res = {};
  try {
    res = await chrome.storage.local.get(['monitoredTabs']);
  } catch (err) {
    console.error('[tab-alerter/bg] Failed to read monitoredTabs from storage:', err);
  }
  monitoredTabs = migrateMonitoredTabs(res.monitoredTabs);

  // Prune stale tab IDs and seed lastKnownTitle before any listener fires.
  await cleanupStaleMonitoredTabs();

  console.log('[tab-alerter/bg] init complete, monitoredTabs:', JSON.stringify(monitoredTabs));

  // Re-inject content-main.js into each surviving monitored tab.
  // content-isolated.js is always injected statically via manifest.json,
  // but content-main.js (MAIN world) may need to be restored after a
  // navigation or SW restart.
  for (const key of Object.keys(monitoredTabs)) {
    injectMonitor(Number(key)).catch(console.error);
  }
}

void init();

function maybeInjectDomTriggers(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    try {
      const host = new URL(tab.url).hostname;
      const selectors = DEFAULT_DOM_TRIGGERS[host];

      chrome.storage.local.get(['tabDomTriggers'], (result) => {
        if (chrome.runtime.lastError) return;
        const current = result.tabDomTriggers || {};

        if (!selectors) {
          // No triggers for this host — clean up stale entry from a
          // previous navigation so the content script does not receive
          // selectors that no longer apply.
          if (tabId in current) {
            const updated = { ...current };
            delete updated[tabId];
            chrome.storage.local.set({ tabDomTriggers: updated });
          }
          return;
        }

        chrome.storage.local.set({
          tabDomTriggers: { ...current, [tabId]: selectors },
        });
      });
    } catch {
      // ignore
    }
  });
}

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

async function cleanupStaleMonitoredTabs() {
  const keys = Object.keys(monitoredTabs);
  // Always query all tabs to seed lastKnownTitle, even if no cleanup needed.
  const allTabs = await chrome.tabs.query({});
  const liveIds = new Set();

  for (const tab of allTabs) {
    if (tab.id === null || tab.id === undefined) continue;
    liveIds.add(tab.id);
    // Seed catch-up baseline so onActivated can detect genuine changes.
    if (tab.title) {
      lastKnownTitle[tab.id] = tab.title;
    }
  }

  if (keys.length === 0) return;

  let changed = false;
  for (const key of keys) {
    if (!liveIds.has(Number(key))) {
      delete monitoredTabs[key];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ monitoredTabs });
    console.log('[tab-alerter/bg] cleaned up stale monitoredTabs, remaining:', JSON.stringify(monitoredTabs));
  }
}

// ---------------------------------------------------------------------------
// Content script injection
// ---------------------------------------------------------------------------

async function injectMonitor(tabId) {
  if (injectedTabs.has(tabId)) return;
  injectedTabs.add(tabId);

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== 'complete') {
      // Not fully loaded yet — the onUpdated 'complete' handler will retry.
      // Must clean up injectedTabs so the retry is not blocked.
      injectedTabs.delete(tabId);
      return;
    }
    if (isNonInjectableUrl(tab.url)) {
      return;
    }
  } catch {
    // Tab closed before we could check — clean up
    injectedTabs.delete(tabId);
    return;
  }

  // Set or clean up DOM triggers for the tab's current URL so the
  // content script receives correct selectors when it requests them.
  maybeInjectDomTriggers(tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-main.js'],
      world: 'MAIN',
    });
  } catch (err) {
    console.error(`Failed to inject content-main.js into tab ${tabId}:`, err.message);
    injectedTabs.delete(tabId);
  }
}

function removeInjectedTab(tabId) {
  injectedTabs.delete(tabId);
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

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
        injectMonitor(Number(key));
      }
    }
    for (const key of oldKeys) {
      if (!newSet.has(key)) {
        removeDomTriggers(Number(key));
        removeInjectedTab(Number(key));
      }
    }
    monitoredTabs = newTabs;
    console.log('[tab-alerter/bg] monitoredTabs updated:', JSON.stringify(monitoredTabs));
  }
});

// 1. Listen for tab updates — handles both navigation/re-injection and title changes.
//    Skips the active tab — the user is already looking at it.
//    Records every seen title in lastKnownTitle so onActivated can
//    detect genuine background title changes.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && monitoredTabs[String(tabId)]) {
    removeInjectedTab(tabId);
  }

  if (changeInfo.status === 'complete' && monitoredTabs[String(tabId)]) {
    injectMonitor(tabId);
  }

  if (!changeInfo.title) return;
  // Always record the latest title regardless of monitoring or active state.
  lastKnownTitle[tabId] = changeInfo.title;

  if (isNonInjectableUrl(tab?.url)) return;
  const config = monitoredTabs[String(tabId)];
  if (!config) return;
  // Suppress alert if the tab is currently in the foreground.
  if (tab?.active) {
    console.log('[tab-alerter/bg] onUpdated skipped (tab is active) | tabId:', tabId, '| title:', changeInfo.title);
    return;
  }
  if (!titleMatchesPattern(changeInfo.title, config.pattern)) return;
  console.log('[tab-alerter/bg] onUpdated triggering alert | tabId:', tabId, '| title:', changeInfo.title);
  triggerAlert(tabId);
});

// 2. Catch-up check on tab activation.
//
// Chrome suppresses tabs.onUpdated title events for background https:// tabs.
// When the tab becomes active we read its current title and alert if it
// changed since we last saw it.
//
// Only alerts on a genuine title change (prev !== current) to avoid:
//   - Spurious alerts when the user simply switches to a monitored tab
//   - TC-INT-09: popup calling tabs.update({active:true}) on the alerting tab
chrome.tabs.onActivated.addListener(({ tabId }) => {
  const config = monitoredTabs[String(tabId)];
  if (!config) return;

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.title) return;
    if (isNonInjectableUrl(tab.url)) return;

    const prev = lastKnownTitle[tabId];
    const current = tab.title;
    lastKnownTitle[tabId] = current;

    if (prev === undefined) {
      console.log('[tab-alerter/bg] onActivated first sight | tabId:', tabId, '| title:', current);
      return;
    }
    if (prev === current) {
      console.log('[tab-alerter/bg] onActivated no title change | tabId:', tabId, '| title:', current);
      return;
    }
    console.log('[tab-alerter/bg] onActivated title changed! | tabId:', tabId, '| prev:', prev, '| current:', current);
    if (!titleMatchesPattern(current, config.pattern)) return;
    triggerAlert(tabId);
  });
});

// 3. Listen for web notification intercepts, popup actions, and content script requests.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRIGGER_ALERT' && sender.tab) {
    const tabId = sender.tab.id;
    if (!monitoredTabs[String(tabId)]) {
      console.warn('[tab-alerter/bg] TRIGGER_ALERT received but tab', tabId, 'is NOT in monitoredTabs.');
      return false;
    }
    (async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.active) {
          console.log('[tab-alerter/bg] TRIGGER_ALERT suppressed (tab is active) | tabId:', tabId);
          return;
        }
        console.log('[tab-alerter/bg] TRIGGER_ALERT accepted for tab:', tabId);
        triggerAlert(tabId);
      } catch {
        // Tab closed before lookup — ignore.
      }
    })();

  } else if (message.type === 'CLEAR_ALERT') {
    clearAlert();

  } else if (message.type === 'GET_DOM_TRIGGERS' && sender.tab) {
    const tabId = sender.tab.id;
    chrome.storage.local.get(['tabDomTriggers'], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse([]);
        return;
      }
      const allTriggers = result.tabDomTriggers || {};
      const selectors = allTriggers[tabId] || [];
      console.log('[tab-alerter/bg] GET_DOM_TRIGGERS for tab', tabId, '-> selectors:', selectors);
      sendResponse(selectors);
    });
    return true;

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

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === alertingTabId) clearAlert();
  const key = String(tabId);
  if (monitoredTabs[key]) {
    const updated = { ...monitoredTabs };
    delete updated[key];
    chrome.storage.local.set({ monitoredTabs: updated }).catch(console.error);
  }
  removeInjectedTab(tabId);
  delete lastAlertTime[tabId];
  delete lastKnownTitle[tabId];
});

// ---------------------------------------------------------------------------
// Alert logic
// ---------------------------------------------------------------------------

function triggerAlert(tabId) {
  const debounced = shouldDebounce(lastAlertTime, tabId, Date.now(), DEBOUNCE_MS);
  console.log('[tab-alerter/bg] triggerAlert called for tab', tabId, '| debounced:', debounced, '| already alerting:', alertingTabId === tabId);
  if (debounced) return;
  lastAlertTime[tabId] = Date.now();

  if (alertingTabId === tabId) return;

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
      justification: 'Play alert beep',
    });
  }

  try {
    await offscreenCreating;
    chrome.runtime.sendMessage({ type: 'PLAY_AUDIO' });
  } catch (e) {
    console.error('[tab-alerter/bg] Failed to create offscreen document:', e);
  } finally {
    offscreenCreating = null;
  }
}
