let saveTimer = null;

const toggleActive = document.getElementById('alert-on-active');
const toggleAllTabs = document.getElementById('monitor-all-tabs');
const toggleTitleUpdates = document.getElementById('monitor-title-updates');
const toggleWebNotifications = document.getElementById('monitor-web-notifications');
const toggleDomTriggers = document.getElementById('monitor-dom-triggers');
const status = document.getElementById('save-status');

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get([
      'alertOnActive',
      'monitorAllTabs',
      'monitorTitleUpdates',
      'monitorWebNotifications',
      'monitorDomTriggers',
    ]);
    toggleActive.checked = data.alertOnActive === true;
    toggleAllTabs.checked = data.monitorAllTabs === true;
    // Each type defaults to true when not yet present in storage
    toggleTitleUpdates.checked = data.monitorTitleUpdates !== false;
    toggleWebNotifications.checked = data.monitorWebNotifications !== false;
    toggleDomTriggers.checked = data.monitorDomTriggers !== false;
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
      monitorTitleUpdates: toggleTitleUpdates.checked,
      monitorWebNotifications: toggleWebNotifications.checked,
      monitorDomTriggers: toggleDomTriggers.checked,
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
toggleTitleUpdates.addEventListener('change', saveSettings);
toggleWebNotifications.addEventListener('change', saveSettings);
toggleDomTriggers.addEventListener('change', saveSettings);
