let saveTimer = null;

const toggle = document.getElementById('alert-on-active');
const status = document.getElementById('save-status');

async function loadSetting() {
  try {
    const data = await chrome.storage.local.get(['alertOnActive']);
    toggle.checked = data.alertOnActive === true;
  } catch (err) {
    console.error('[tab-monitor/options] Failed to load alertOnActive:', err);
    status.textContent = 'Failed to load setting.';
  }
}

void loadSetting();

async function saveSetting() {
  clearTimeout(saveTimer);
  try {
    await chrome.storage.local.set({ alertOnActive: toggle.checked });
    status.textContent = 'Saved.';
  } catch (err) {
    console.error('[tab-monitor/options] Failed to save alertOnActive:', err);
    status.textContent = 'Failed to save setting.';
    return;
  }
  saveTimer = setTimeout(() => { status.textContent = ''; }, 1500);
}

toggle.addEventListener('change', saveSetting);
