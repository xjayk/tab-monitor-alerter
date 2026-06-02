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
  } else if (message.type === 'UPDATE_MONITORED_TABS' && !sender.tab) {
    monitoredTabs = new Set(message.tabIds);
    chrome.storage.local.set({ monitoredTabs: Array.from(monitoredTabs) });
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
