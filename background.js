import { shouldDebounce, titleMatchesPattern, migrateMonitoredTabs } from './src/utils.js';

const DEBOUNCE_MS = 1000;
const CLEANUP_DELAY_MS = 5000;
const lastAlertTime = {};

// Tracks the last title we saw per tab so onActivated can detect
// whether a title actually changed while the tab was backgrounded.
const lastKnownTitle = {};

let badgeInterval = null;
let isRed = false;
let alertingTabId = null;
let offscreenCreating = null;
let monitoredTabs = {};

// Tracks tab IDs into which content scripts have been injected.
// Used to avoid duplicate injection and to know when to re-inject on navigation.
const injectedTabs = new Set();

// ---------------------------------------------------------------------------
// Default DOM trigger selectors per hostname.
// ---------------------------------------------------------------------------
const DEFAULT_DOM_TRIGGERS = {
  'www.perplexity.ai': ['button[aria-label="Approve"]'],
};

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
  console.log('[tab-alerter/bg] init complete, monitoredTabs:', JSON.stringify(monitoredTabs));

  // Run cleanup first, then inject into remaining live tabs.
  // Injection is deferred into the same setTimeout so stale IDs are purged
  // before we attempt scripting.executeScript on them (avoids console errors).
  setTimeout(async () => {
    await cleanupStaleMonitoredTabs().catch(console.error);
    // Re-inject content-main.js into each surviving monitored tab.
    // content-isolated.js is always injected statically via manifest.json,
    // but content-main.js (MAIN world) may need to be restored after a
    // navigation that occurred while the SW was inactive.
    for (const key of Object.keys(monitoredTabs)) {
      injectMonitor(Number(key)).catch(console.error);
    }
  }, CLEANUP_DELAY_MS);
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

// ---------------------------------------------------------------------------
// Content script injection
// ---------------------------------------------------------------------------

/**
 * Dynamically inject content-main.js into a monitored tab.
 * content-isolated.js is already injected statically via manifest.json
 * so it is always available to relay messages.
 *
 * Only injects once per tab navigation — guards against duplicate calls
 * via the injectedTabs Set. On navigation the entry is cleared so the
 * script is re-injected into the new document.
 */
async function injectMonitor(tabId) {
  if (injectedTabs.has(tabId)) return;
  injectedTabs.add(tabId);

  try {
    // Verify the tab is fully loaded before injecting — injecting into a
    // still-loading tab targets the initial about:blank document and the
    // script is lost on navigation. The onUpdated 'complete' handler will
    // retry when the tab finishes loading.
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== 'complete') {
      return;
    }
  } catch {
    // Tab closed before we could check — clean up
    injectedTabs.delete(tabId);
    return;
  }

  // Set or clean up DOM triggers for the tab's current URL so the
  // content script receives correct selectors when it requests them.
  await maybeInjectDomTriggers(tabId);

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
// Event listeners — registered synchronously at module evaluation time
// ---------------------------------------------------------------------------

// Sync in-memory monitoredTabs when popup changes storage.
// Also injects content-main.js into newly monitored tabs.
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

// TODO: FIX! Broken by merge conflict resolution. <<<<<<< feat/dynamic-content-script-injection
// 1. Listen for tab updates (navigation completion, title changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && monitoredTabs[String(tabId)]) {
    removeInjectedTab(tabId);
  }

  if (changeInfo.status === 'complete' && monitoredTabs[String(tabId)]) {
    injectMonitor(tabId);
  }

// TODO: FIX! Broken by merge conflict resolution. =======
// 1. Listen for title updates fired by Chrome for active/file:// tabs.
//    Records every seen title in lastKnownTitle so the onActivated
//    catch-up can detect genuine changes.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
// TODO: FIX! Broken by merge conflict resolution. >>>>>>> trunk
  
  if (!changeInfo.title) return;
  // Always record the latest title regardless of monitoring state.
  lastKnownTitle[tabId] = changeInfo.title;

  const monitored = !!monitoredTabs[String(tabId)];
  const nonInjectable = isNonInjectableUrl(tab?.url);
  console.log(
    '[tab-alerter/bg] onUpdated title event:',
    '| tabId:', tabId,
    '| title:', changeInfo.title,
    '| tab.url:', tab?.url,
    '| isNonInjectableUrl:', nonInjectable,
    '| inMonitoredTabs:', monitored
  );
  if (nonInjectable) return;
  const config = monitoredTabs[String(tabId)];
  if (!config) return;
  if (!titleMatchesPattern(changeInfo.title, config.pattern)) return;
  triggerAlert(tabId);
});

// TODO: FIX! Broken by merge conflict resolution. <<<<<<< feat/dynamic-content-script-injection
// 2. Listen for web notification intercepts, popup actions, and content script requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
// TODO: FIX! Broken by merge conflict resolution. =======

// 2. Catch-up check on tab activation.
//
// Chrome suppresses tabs.onUpdated title events for background https:// tabs
// (rendering process isolation / tab suspension). Title changes on those tabs
// are only propagated once the tab becomes active. By reading the current
// title via chrome.tabs.get at activation time we catch any title change that
// happened while the tab was in the background.
//
// We only alert if the title CHANGED relative to the last-known value.
// This prevents spurious alerts when:
//   - A tab is simply focused (no title change occurred)
//   - The popup focuses the alerting tab to navigate to it (TC-INT-09)
// On first activation (no lastKnownTitle entry) we record the title without
// alerting, so monitoring a tab for the first time does not auto-alert.
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
      // First time we see this tab — record title but don't alert.
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

// 3. Listen for web notification intercepts, popup actions, and content script requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(
    '[tab-alerter/bg] message received:',
    message.type,
    '| sender.tab.id:', sender.tab?.id,
    '| sender.tab.url:', sender.tab?.url
  );
// TODO: FIX! Broken by merge conflict resolution. >>>>>>> trunk
  
  
  if (message.type === 'TRIGGER_ALERT' && sender.tab && monitoredTabs[String(sender.tab.id)]) {
    console.log('[tab-alerter/bg] TRIGGER_ALERT accepted for tab:', sender.tab.id);
    triggerAlert(sender.tab.id);
  } else if (message.type === 'TRIGGER_ALERT' && sender.tab) {
    console.warn('[tab-alerter/bg] TRIGGER_ALERT received but tab', sender.tab.id, 'is NOT in monitoredTabs. Current monitoredTabs:', JSON.stringify(monitoredTabs));
  } else if (message.type === 'CLEAR_ALERT') {
    clearAlert();
  } else if (message.type === 'GET_DOM_TRIGGERS' && sender.tab) {
    // Content script requests its DOM trigger selectors. The background
    // resolves the tab ID from sender.tab.id (content scripts cannot call
    // chrome.tabs.getCurrent) and reads tabDomTriggers from storage.
    const tabId = sender.tab.id;
    chrome.storage.local.get(['tabDomTriggers'], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse([]);
        return;
      }
      const allTriggers = result.tabDomTriggers || {};
// TODO: FIX! Broken by merge conflict resolution. <<<<<<< feat/dynamic-content-script-injection
      sendResponse(allTriggers[tabId] || []);
    });
    return true; // Keep message channel open for async sendResponse
// TODO: FIX! Broken by merge conflict resolution. =======
      const selectors = allTriggers[tabId] || [];
      console.log('[tab-alerter/bg] GET_DOM_TRIGGERS for tab', tabId, '-> selectors:', selectors);
      sendResponse(selectors);
    });
    return true;
// TODO: FIX! Broken by merge conflict resolution. >>>>>>> trunk
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
