let saveTimer = null;

const toggleActive = document.getElementById('alert-on-active');
const toggleAllTabs = document.getElementById('monitor-all-tabs');
const status = document.getElementById('save-status');

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(['alertOnActive', 'monitorAllTabs']);
    toggleActive.checked = data.alertOnActive === true;
    toggleAllTabs.checked = data.monitorAllTabs === true;
  } catch (err) {
    console.error('[tab-monitor/options] Failed to load settings:', err);
    status.textContent = 'Failed to load settings.';
  }
}

void loadSettings();

async function saveSettings() {
  clearTimeout(saveTimer);
  try {
    await chrome.storage.local.set({
      alertOnActive: toggleActive.checked,
      monitorAllTabs: toggleAllTabs.checked,
    });
    status.textContent = 'Saved.';
  } catch (err) {
    console.error('[tab-monitor/options] Failed to save settings:', err);
    status.textContent = 'Failed to save settings.';
    return;
  }
  saveTimer = setTimeout(() => { status.textContent = ''; }, 1500);
}

toggleActive.addEventListener('change', saveSettings);
toggleAllTabs.addEventListener('change', saveSettings);
