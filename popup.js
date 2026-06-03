document.addEventListener('DOMContentLoaded', () => {
  // 1. Check for Active Alert Navigation
  chrome.storage.local.get(['alertingTabId', 'monitoredTabs'], (data) => {
    if (data.alertingTabId) {
      chrome.tabs.get(data.alertingTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          chrome.runtime.sendMessage({ type: 'CLEAR_ALERT' });
          window.close();
          return;
        }
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
        chrome.runtime.sendMessage({ type: 'CLEAR_ALERT' });
        window.close();
      });
      return;
    }

    // 2. Render standard UI if no alert is active
    document.getElementById('ui-container').classList.remove('hidden');

    // monitoredTabs is stored as a dict: { "tabId": { pattern: "" } }
    const raw = data.monitoredTabs;
    const monitoredTabsObj = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...raw }
      : {};

    chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, (tabs) => {
      const list = document.getElementById('tab-list');
      if (tabs.length === 0) list.innerHTML = '<p>No tabs found.</p>';

      tabs.forEach(tab => {
        const key = String(tab.id);
        const config = monitoredTabsObj[key];

        const item = document.createElement('div');
        item.className = 'tab-item';

        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title;
        title.title = tab.title;

        const patternInput = document.createElement('input');
        patternInput.type = 'text';
        patternInput.className = 'pattern-input';
        patternInput.placeholder = 'Regex';
        patternInput.title = 'Alert only when title matches this regex (leave empty for any change)';
        if (config) patternInput.value = config.pattern || '';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'toggle';
        checkbox.checked = !!config;
        patternInput.disabled = !checkbox.checked;

        function persist() {
          patternInput.disabled = !checkbox.checked;
          if (checkbox.checked) {
            monitoredTabsObj[key] = { pattern: patternInput.value };
          } else {
            delete monitoredTabsObj[key];
          }
          chrome.storage.local.set({ monitoredTabs: monitoredTabsObj }).catch(console.error);
        }

        checkbox.addEventListener('change', persist);
        patternInput.addEventListener('change', persist);

        item.appendChild(title);
        item.appendChild(patternInput);
        item.appendChild(checkbox);
        list.appendChild(item);
      });
    });
  });
});
