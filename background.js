import { shouldDebounce, titleMatchesPattern, migrateMonitoredTabs, normalizeMonitorTypes, MONITOR_TYPE_KEYS } from './src/utils.js';

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

// Cached settings — kept in sync via storage.onChanged.
// IMPORTANT: always re-read from storage inside alert guards (see
// getSettings()) to avoid stale values on SW cold-start.
let alertOnActive = false;
let monitorAllTabs = false;
let monitorTypes = {};

// Selectors are resolved from this map at GET_DOM_TRIGGERS time using the
// sender's URL — no storage indirection, no async race.
//
// 'localhost' and '127.0.0.1' are included so test-notify.html works when
// served via a local HTTP server (e.g. `npx serve .`).
const DEFAULT_DOM_TRIGGERS = {
  'www.perplexity.ai': ['button[aria-label="Approve"]'],
  'localhost': ['button[aria-label="Approve"]'],
  '127.0.0.1': ['button[aria-label="Approve"]'],
};

// Tracks tab IDs into which content-main.js has been injected.
const injectedTabs = new Set();

function isNonInjectableUrl(url) {
  if (!url) return false;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:')
  );
}

// ---------------------------------------------------------------------------
// Read live settings from storage — used inside alert guards so that a
// cold-started SW never acts on a stale in-memory default.
// ---------------------------------------------------------------------------
async function getSettings() {
  try {
    const keys = ['alertOnActive', 'monitorAllTabs', ...Object.values(MONITOR_TYPE_KEYS)];
    const data = await chrome.storage.local.get(keys);
    return {
      alertOnActive: data.alertOnActive === true,
      monitorAllTabs: data.monitorAllTabs === true,
      monitorTypes: normalizeMonitorTypes(data),
    };
  } catch {
    return { alertOnActive, monitorAllTabs, monitorTypes: {} };
  }
}

async function init() {
  const { name, version, version_name } = chrome.runtime.getManifest();
  console.log(`[tab-alerter/bg] 🔖 ${name} v${version_name ?? version} (ext: ${chrome.runtime.id})`);

  let res = {};
  try {
    const storageKeys = ['monitoredTabs', 'alertOnActive', 'monitorAllTabs', ...Object.values(MONITOR_TYPE_KEYS)];
    res = await chrome.storage.local.get(storageKeys);
  } catch (err) {
    console.error('[tab-alerter/bg] Failed to read storage:', err);
  }
  monitoredTabs = migrateMonitoredTabs(res.monitoredTabs);
  alertOnActive = res.alertOnActive === true;
  monitorAllTabs = res.monitorAllTabs === true;
  monitorTypes = normalizeMonitorTypes(res);
  console.log('[tab-alerter/bg] alertOnActive:', alertOnActive, '| monitorAllTabs:', monitorAllTabs, '| monitorTypes:', JSON.stringify(monitorTypes));

  console.log('[tab-alerter/bg] init complete, monitoredTabs:', JSON.stringify(monitoredTabs));

  // Re-inject content-main.js into each surviving monitored tab on SW restart.
  // When monitorAllTabs is on also inject into every current tab.
  if (monitorAllTabs) {
    const allTabs = await chrome.tabs.query({ status: 'complete' });
    for (const tab of allTabs) {
      if (tab.id && !isNonInjectableUrl(tab.url)) {
        injectMonitor(tab.id).catch(console.error);
      }
    }
  } else {
    for (const key of Object.keys(monitoredTabs)) {
      injectMonitor(Number(key)).catch(console.error);
    }
  }
}

void init();

async function cleanupStaleMonitoredTabs() {
  const allTabs = await chrome.tabs.query({});
  const liveIds = new Set();

  for (const tab of allTabs) {
    if (tab.id === null) continue;
    liveIds.add(tab.id);
    if (tab.title) {
      lastKnownTitle[tab.id] = tab.title;
    }
  }

  // Read the freshest data from storage to avoid racing with concurrent
  // updates that may have occurred during the init delay.
  let res;
  try {
    res = await chrome.storage.local.get('monitoredTabs');
  } catch (err) {
    console.error('[tab-alerter/bg] Failed to read storage for cleanup:', err);
    return;
  }
  const currentMonitored = migrateMonitoredTabs(res.monitoredTabs);
  const keys = Object.keys(currentMonitored);
  if (keys.length === 0) return;

  let changed = false;
  const updatedMonitored = { ...currentMonitored };
  for (const key of keys) {
    if (!liveIds.has(Number(key))) {
      delete updatedMonitored[key];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ monitoredTabs: updatedMonitored });
    console.log('[tab-alerter/bg] cleaned up stale monitoredTabs, remaining:', JSON.stringify(updatedMonitored));
  }
}

// ---------------------------------------------------------------------------
// Content script injection
// ---------------------------------------------------------------------------

async function injectMonitor(tabId) {
  if (injectedTabs.has(tabId)) return;
  injectedTabs.add(tabId);

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    injectedTabs.delete(tabId);
    return;
  }

  if (tab.status !== 'complete') {
    injectedTabs.delete(tabId);
    return;
  }
  if (isNonInjectableUrl(tab.url)) {
    injectedTabs.delete(tabId);
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-main.js'],
      world: 'MAIN',
    });
  } catch (err) {
    console.error(`[tab-alerter/bg] Failed to inject content-main.js into tab ${tabId}:`, err.message);
    injectedTabs.delete(tabId);
  }
}

function removeInjectedTab(tabId) {
  injectedTabs.delete(tabId);
}

// ---------------------------------------------------------------------------
// Resolve DOM trigger selectors for a URL without touching storage.
// ---------------------------------------------------------------------------

function getSelectorsForUrl(url) {
  if (!url) return [];
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return (DEFAULT_DOM_TRIGGERS[host] ?? DEFAULT_DOM_TRIGGERS['www.' + host]) ?? [];
  } catch {
    return [];
  }
}

// Schedule stale-tab cleanup on browser startup and extension install/update.
// These are the only times stale IDs can appear; running on every SW wake-up
// would be redundant.
chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => {
    cleanupStaleMonitoredTabs().catch(console.error);
  }, CLEANUP_DELAY_MS);
});
chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => {
    cleanupStaleMonitoredTabs().catch(console.error);
  }, CLEANUP_DELAY_MS);
});

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
        injectMonitor(Number(key)).catch(console.error);
      }
    }
    for (const key of oldKeys) {
      if (!newSet.has(key)) {
        removeInjectedTab(Number(key));
      }
    }
    monitoredTabs = newTabs;
    console.log('[tab-alerter/bg] monitoredTabs updated:', JSON.stringify(monitoredTabs));
  }

  if (changes.alertOnActive) {
    alertOnActive = changes.alertOnActive.newValue === true;
    console.log('[tab-alerter/bg] alertOnActive changed:', alertOnActive);
  }

  if (changes.monitorAllTabs) {
    monitorAllTabs = changes.monitorAllTabs.newValue === true;
    console.log('[tab-alerter/bg] monitorAllTabs changed:', monitorAllTabs);
    // When enabling, inject into all current complete tabs immediately.
    if (monitorAllTabs) {
      (async () => {
        try {
          const tabs = await chrome.tabs.query({ status: 'complete' });
          for (const tab of tabs) {
            if (tab.id && !isNonInjectableUrl(tab?.url)) {
              await injectMonitor(tab.id).catch(console.error);
            }
          }
        } catch (err) {
          console.error('[tab-alerter/bg] Failed to query tabs on monitorAllTabs enable:', err);
        }
      })();
    }
  }

  // Monitor per-type toggles — any of the three keys changed.
  const typeKeys = Object.values(MONITOR_TYPE_KEYS);
  const anyTypeChanged = typeKeys.some(k => changes[k]);
  if (anyTypeChanged) {
    const snapshot = {};
    for (const key of typeKeys) {
      if (changes[key]) {
        snapshot[key] = changes[key].newValue;
      } else {
        snapshot[key] = monitorTypes[key];
      }
    }
    monitorTypes = normalizeMonitorTypes(snapshot);
    console.log('[tab-alerter/bg] monitorTypes changed:', JSON.stringify(monitorTypes));
  }
});

// 1. Listen for tab updates — handles navigation/re-injection and title changes.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const isMonitored = !!monitoredTabs[String(tabId)];

  if (changeInfo.status === 'loading' && (isMonitored || monitorAllTabs)) {
    removeInjectedTab(tabId);
  }

  if (changeInfo.status === 'complete') {
    if (isMonitored || monitorAllTabs) {
      if (!isNonInjectableUrl(tab?.url)) {
        // Re-register on navigation so fresh content script gets injected.
        removeInjectedTab(tabId);
        injectMonitor(tabId).catch(console.error);
      }
    }
  }

  if (!changeInfo.title) return;
  lastKnownTitle[tabId] = changeInfo.title;

  if (isNonInjectableUrl(tab?.url)) return;
  const config = monitoredTabs[String(tabId)];
  if (!config && !monitorAllTabs) return;

  // Re-read settings from storage to avoid stale SW cold-start values.
  const { alertOnActive: aoa, monitorTypes: mt } = await getSettings();
  if (!mt[MONITOR_TYPE_KEYS.TITLE]) {
    console.log('[tab-alerter/bg] onUpdated skipped (monitorTitleUpdates=false) | tabId:', tabId);
    return;
  }
  if (tab?.active && !aoa) {
    console.log('[tab-alerter/bg] onUpdated skipped (tab is active, alertOnActive=false) | tabId:', tabId, '| title:', changeInfo.title);
    return;
  }
  if (config && !titleMatchesPattern(changeInfo.title, config.pattern)) return;
  console.log('[tab-alerter/bg] onUpdated triggering alert | tabId:', tabId, '| title:', changeInfo.title);
  triggerAlert(tabId);
});

// 2. Catch-up check on tab activation.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  const config = monitoredTabs[String(tabId)];
  if (!config && !monitorAllTabs) return;

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
    // Re-read from storage to avoid stale cached value on SW cold-start.
    getSettings().then(({ monitorTypes: mt }) => {
      if (!mt[MONITOR_TYPE_KEYS.TITLE]) {
        console.log('[tab-alerter/bg] onActivated skipped (monitorTitleUpdates=false) | tabId:', tabId);
        return;
      }
      console.log('[tab-alerter/bg] onActivated title changed! | tabId:', tabId, '| prev:', prev, '| current:', current);
      if (config && !titleMatchesPattern(current, config.pattern)) return;
      triggerAlert(tabId);
    });
  });
});

// 3. Listen for web notification intercepts, popup actions, and content script requests.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRIGGER_ALERT' && sender.tab) {
    const tabId = sender.tab.id;
    const isMonitored = !!monitoredTabs[String(tabId)];
    if (!isMonitored && !monitorAllTabs) {
      console.warn('[tab-alerter/bg] TRIGGER_ALERT received but tab', tabId, 'is NOT monitored.');
      return false;
    }
    (async () => {
      try {
        const [tab, { alertOnActive: aoa, monitorTypes: mt }] = await Promise.all([
          chrome.tabs.get(tabId),
          getSettings(),
        ]);
        // Check the per-type gate based on the message source.
        const source = message.source || 'notification';
        if (source === 'notification' && !mt[MONITOR_TYPE_KEYS.NOTIFICATION]) {
          console.log('[tab-alerter/bg] TRIGGER_ALERT suppressed (monitorWebNotifications=false) | tabId:', tabId);
          return;
        }
        if (source === 'dom_trigger' && !mt[MONITOR_TYPE_KEYS.DOM_TRIGGER]) {
          console.log('[tab-alerter/bg] TRIGGER_ALERT suppressed (monitorDomTriggers=false) | tabId:', tabId);
          return;
        }
        if (tab?.active && !aoa) {
          console.log('[tab-alerter/bg] TRIGGER_ALERT suppressed (tab is active, alertOnActive=false) | tabId:', tabId);
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
    const selectors = getSelectorsForUrl(sender.tab.url);
    console.log('[tab-alerter/bg] GET_DOM_TRIGGERS for tab', sender.tab.id,
      '| url:', sender.tab.url, '-> selectors:', selectors);
    sendResponse(selectors);
    return false;

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
