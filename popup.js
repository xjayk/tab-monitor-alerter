document.addEventListener('DOMContentLoaded', () => {
  // 1. Check for Active Alert Navigation
  chrome.storage.local.get(['alertingTabId', 'monitoredTabs', 'audioBlocked'], (data) => {
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

    // monitoredTabs is stored as a dict: { "tabId": { pattern: "" } }
    const raw = data.monitoredTabs;
    const monitoredTabsObj = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...raw }
      : {};

    chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, (tabs) => {
      const list = document.getElementById('tab-list');
      if (tabs.length === 0) {
        list.innerHTML = '<p>No tabs found.</p>';
        return;
      }

      // --- Select All row ---
      const selectAllRow = document.createElement('div');
      selectAllRow.className = 'select-all-row';

      const selectAllCheckbox = document.createElement('input');
      selectAllCheckbox.type = 'checkbox';
      selectAllCheckbox.id = 'select-all';
      // Note: selectAllCheckbox intentionally does NOT carry .tab-toggle so
      // querySelectorAll('.tab-toggle') counts only per-tab checkboxes.

      const selectAllLabel = document.createElement('label');
      selectAllLabel.className = 'select-all-label';
      selectAllLabel.textContent = 'Select All';
      selectAllLabel.prepend(selectAllCheckbox);

      selectAllRow.appendChild(selectAllLabel);
      list.appendChild(selectAllRow);

      const monitoredCount = tabs.filter(t => monitoredTabsObj[String(t.id)]).length;
      selectAllCheckbox.checked = monitoredCount === tabs.length;
      selectAllCheckbox.indeterminate = monitoredCount > 0 && monitoredCount < tabs.length;

      selectAllCheckbox.addEventListener('change', () => {
        const checked = selectAllCheckbox.checked;
        // Snapshot state before mutation for rollback on failure.
        const prevState = { ...monitoredTabsObj };

        tabs.forEach(t => {
          const key = String(t.id);
          if (checked) {
            // Preserve any existing pattern — do not overwrite with empty string.
            monitoredTabsObj[key] = monitoredTabsObj[key] ?? { pattern: '' };
          } else {
            delete monitoredTabsObj[key];
          }
        });

        // Fast-path DOM update: directly sets checkbox state without going
        // through persist() — intentional, as there is no per-tab side-effect
        // needed here beyond the bulk storage write below.
        list.querySelectorAll('.tab-toggle').forEach(cb => { cb.checked = checked; });
        selectAllCheckbox.indeterminate = false;

        chrome.storage.local.set({ monitoredTabs: monitoredTabsObj }).catch((err) => {
          console.error('Select All storage write failed, rolling back:', err);
          // Restore in-memory state and DOM to match pre-mutation state.
          Object.keys(monitoredTabsObj).forEach(k => delete monitoredTabsObj[k]);
          Object.assign(monitoredTabsObj, prevState);
          list.querySelectorAll('.tab-toggle').forEach(cb => {
            cb.checked = !!monitoredTabsObj[cb.dataset.tabId];
          });
          const count = tabs.filter(t => monitoredTabsObj[String(t.id)]).length;
          selectAllCheckbox.checked = count === tabs.length;
          selectAllCheckbox.indeterminate = count > 0 && count < tabs.length;
        });
      });
      // --- end Select All ---

      tabs.forEach(tab => {
        const key = String(tab.id);
        const config = monitoredTabsObj[key];

        const item = document.createElement('div');
        item.className = 'tab-item';

        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title;
        title.title = tab.title;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tab-toggle';
        checkbox.dataset.tabId = key;
        checkbox.checked = !!config;

        function persist() {
          // Snapshot for rollback.
          const prev = monitoredTabsObj[key];
          const hadKey = key in monitoredTabsObj;

          if (checkbox.checked) {
            // Preserve any existing pattern if re-checking an already-monitored tab.
            monitoredTabsObj[key] = { pattern: config?.pattern || '' };
          } else {
            delete monitoredTabsObj[key];
          }

          chrome.storage.local.set({ monitoredTabs: monitoredTabsObj }).then(() => {
            // Sync Select All state after confirmed write.
            const toggles = list.querySelectorAll('.tab-toggle');
            const checkedCount = [...toggles].filter(cb => cb.checked).length;
            selectAllCheckbox.checked = checkedCount === toggles.length;
            selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < toggles.length;
          }).catch((err) => {
            console.error('persist() storage write failed, rolling back:', err);
            // Revert in-memory state and checkbox.
            if (hadKey) {
              monitoredTabsObj[key] = prev;
            } else {
              delete monitoredTabsObj[key];
            }
            checkbox.checked = hadKey;
          });
        }

        checkbox.addEventListener('change', persist);

        item.appendChild(title);
        item.appendChild(checkbox);
        list.appendChild(item);
      });
    });
  });
});
