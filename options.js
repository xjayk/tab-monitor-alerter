const toggle = document.getElementById('alert-on-active');
const status = document.getElementById('save-status');

// Load current value.
chrome.storage.local.get(['alertOnActive'], (data) => {
  toggle.checked = data.alertOnActive === true;
});

// Save on change and show brief confirmation.
toggle.addEventListener('change', () => {
  chrome.storage.local.set({ alertOnActive: toggle.checked }, () => {
    status.textContent = 'Saved.';
    setTimeout(() => { status.textContent = ''; }, 1500);
  });
});
