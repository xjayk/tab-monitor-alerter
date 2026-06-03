import { shouldDebounce, titleMatchesPattern, migrateMonitoredTabs } from './src/utils.js';

const DEBOUNCE_MS = 1000;
const CLEANUP_DELAY_MS = 5000;
const lastAlertTime = {};

let badgeInterval = null;
let isRed = false;
let alertingTabId = null;
let offscreenCreating = null;
let monitoredTabs = {};

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

  setTimeout(() => {
    cleanupStaleMonitoredTabs().catch(console.error);
  }, CLEANUP_DELAY_MS);
}

void init();

function maybeInjectDomTriggers(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    try {
      const host = new URL(tab.url).hostname;
      const selectors = DEFAULT_DOM_TRIGGERS[host];
      if (!selectors) return;

      chrome.storage.local.get(['tabDomTriggers'], (result) => {
        if (chrome.runtime.lastError) return;
        const current = result.tabDomTriggers || {};
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

chrome.storage.onChanged.addListener((changes) => {
  if (changes.monitoredTabs) {
    const raw = changes.monitoredTabs.newValue;
    const newTabs = raw && typeof raw === 'object' ? raw : {};
    const oldKeys = Object.keys(monitoredTabs);
    const newKeys = Object.keys(newTabs);

    const oldSet = new Set(oldKeys);
    const newSet = new Set(newKeys);

    for (const key of newKeys) {
      if (!oldSet.has(key)) maybeInjectDomTriggers(Number(key));
    }
    for (const key of oldKeys) {
      if (!newSet.has(key)) removeDomTriggers(Number(key));
    }
    monitoredTabs = newTabs;
    console.log('[tab-alerter/bg] monitoredTabs updated:', JSON.stringify(monitoredTabs));
  }
});

// 1. Listen for title updates fired by Chrome for active/file:// tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.title) return;
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

// 2. Catch-up check on tab activation.
//
// Chrome suppresses tabs.onUpdated title events for background https:// tabs
// (rendering process isolation / tab suspension). Title changes on those tabs
// are only propagated once the tab becomes active. By reading the current
// title via chrome.tabs.get at activation time we catch any title change that
// happened while the tab was in the background and alert immediately.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  const config = monitoredTabs[String(tabId)];
  if (!config) return;

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.title) return;
    if (isNonInjectableUrl(tab.url)) return;
    console.log('[tab-alerter/bg] onActivated catch-up check | tabId:', tabId, '| title:', tab.title);
    if (!titleMatchesPattern(tab.title, config.pattern)) return;
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

  if (message.type === 'TRIGGER_ALERT' && sender.tab && monitoredTabs[String(sender.tab.id)]) {
    console.log('[tab-alerter/bg] TRIGGER_ALERT accepted for tab:', sender.tab.id);
    triggerAlert(sender.tab.id);
  } else if (message.type === 'TRIGGER_ALERT' && sender.tab) {
    console.warn('[tab-alerter/bg] TRIGGER_ALERT received but tab', sender.tab.id, 'is NOT in monitoredTabs. Current monitoredTabs:', JSON.stringify(monitoredTabs));
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
  delete lastAlertTime[tabId];
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
