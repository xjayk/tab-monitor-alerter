let badgeInterval = null;
let isRed = false;
let alertingTabId = null;

// Track monitored tabs in memory (sync with storage)
let monitoredTabs = new Set();
chrome.storage.local.get(['monitoredTabs'], (res) => {
  if (res.monitoredTabs) {
    monitoredTabs = new Set(res.monitoredTabs);
  }
});

// Update memory when popup changes storage
chrome.storage.onChanged.addListener((changes) => {
  if (changes.monitoredTabs) {
    monitoredTabs = new Set(changes.monitoredTabs.newValue);
  }
});

// 1. Listen for Title Updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.title && monitoredTabs.has(tabId)) {
    triggerAlert(tabId);
  }
});

// 2. Listen for Web Notification intercepts and Popup Actions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
