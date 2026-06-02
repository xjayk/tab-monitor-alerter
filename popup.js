document.addEventListener('DOMContentLoaded', () => {
  // 1. Check for Active Alert Navigation
  chrome.storage.local.get(['alertingTabId', 'monitoredTabs'], (data) => {
    if (data.alertingTabId) {
      chrome.tabs.get(data.alertingTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          // Tab is gone; clear stale state so popup isn't hijacked forever
          chrome.runtime.sendMessage({ type: 'CLEAR_ALERT' });
          window.close();
          return;
        }
        // Tab is confirmed live — activate it and focus its window
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
        chrome.runtime.sendMessage({ type: 'CLEAR_ALERT' });
        window.close();
      });
      return;
    }

    // 2. Render standard UI if no alert is active
    document.getElementById('ui-container').classList.remove('hidden');
    const monitoredTabs = new Set(data.monitoredTabs || []);

    chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, (tabs) => {
      const list = document.getElementById('tab-list');
      if (tabs.length === 0) list.innerHTML = '<p>No tabs found.</p>';

      tabs.forEach(tab => {
        const item = document.createElement('div');
        item.className = 'tab-item';

        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title;
        title.title = tab.title;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'toggle';
        checkbox.checked = monitoredTabs.has(tab.id);

        checkbox.addEventListener('change', (e) => {
          if (e.target.checked) {
            monitoredTabs.add(tab.id);
          } else {
            monitoredTabs.delete(tab.id);
          }
          chrome.runtime.sendMessage({ type: 'UPDATE_MONITORED_TABS', tabIds: Array.from(monitoredTabs) });
        });

        item.appendChild(title);
        item.appendChild(checkbox);
        list.appendChild(item);
      });
    });
  });
});
