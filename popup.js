document.addEventListener('DOMContentLoaded', () => {
  // 1. Check for Active Alert Navigation
  chrome.storage.local.get(['alertingTabId', 'monitoredTabs', 'audioBlocked'], (data) => {
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

    // 2. Show audio-blocked notice if needed
    if (data.audioBlocked) {
      const notice = document.getElementById('audio-notice');
      notice.innerHTML = '';
      notice.appendChild(document.createTextNode('Audio is blocked by your browser. '));
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = 'Open sound settings';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'chrome://settings/content/sound' });
      });
      notice.appendChild(link);
      notice.classList.remove('hidden');
    }

    // 3. Render standard UI if no alert is active
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

          // Write directly to storage — source of truth per AGENT.md.
          // The background SW syncs its in-memory set via storage.onChanged;
          // this avoids the MV3 race where a MONITOR_TAB message is silently
          // dropped if the SW is not yet alive.
          chrome.storage.local
            .set({ monitoredTabs: Array.from(monitoredTabs) })
            .catch((error) => {
              console.error('Failed to persist monitoredTabs:', error);
            });
        });

        item.appendChild(title);
        item.appendChild(checkbox);
        list.appendChild(item);
      });
    });
  });
});
