# Test Plan — Tab Monitor & Alerter

## Phase 1: Manual Smoke Tests

Load the unpacked extension in `chrome://extensions` (enable Developer Mode → Load unpacked → select repo root).
Open the Service Worker console via the **Inspect views: service worker** link on the extension card.

Run these after every significant code change before pushing.

---

### Smoke Test Checklist

| ID | Scenario | Steps | Expected Result |
|---|---|---|---|
| SM-01 | Install loads cleanly | Load unpacked extension | No errors or warnings in SW console |
| SM-02 | Popup opens | Click extension icon | Tab list renders showing current window's tabs |
| SM-03 | Monitor a tab | Check a tab's toggle checkbox, close popup, reopen | Checkbox is still checked |
| SM-04 | Title change alert | Monitor a tab; trigger a title change (e.g. open Gmail and receive an email) | Badge flashes red/black alternating; audio plays |
| SM-05 | Alert navigation | While badge is flashing, click extension icon | Extension immediately navigates to alerting tab and popup closes without rendering UI |
| SM-06 | Alert clears after navigation | After SM-05, click extension icon again | Normal popup UI renders; badge is gone |
| SM-07 | Unmonitor tab | Uncheck a previously monitored tab | No alert fires on subsequent title change for that tab |
| SM-08 | Close monitored tab | Close a tab that is being monitored | Open `chrome://extensions` → extension storage (or DevTools → Application → Extension Storage) and confirm the tab ID is gone from `monitoredTabs` |
| SM-09 | Close alerting tab | Trigger an alert (SM-04), then close the alerting tab without clicking the extension | Badge clears automatically within ~1s |
| SM-10 | SW restart resilience | Enable a monitored tab, then disable and re-enable the extension from `chrome://extensions`, reopen popup | Previously monitored tab is still checked |

---

### Pass Criteria
All 10 cases must pass before merging any PR that touches `background.js`, `popup.js`, `content-main.js`, or `content-isolated.js`.

---

## Phase 2: Unit Tests (Automated)

See `tests/utils.test.js`. Run with:

```bash
npm install
npm test
```

All tests must pass. Coverage targets:
- `titleMatchesPattern` — 4 cases
- `shouldDebounce` — 3 cases
- `filterStaleTabs` — 2 cases
- `migrateMonitoredTabs` — 2 cases

---

## Phase 3: Integration Tests (Playwright — Future)

See test plan in the repository issues for the full integration and regression suite.
Integration tests target Chrome extension API boundaries (storage, messaging, tab lifecycle).

---

## Notes for Reviewers

- Use Chrome stable for smoke tests. Also spot-check on Chrome Beta if available.
- When testing SM-04, use a real site that changes its title dynamically (Gmail, GitHub notifications, YouTube) rather than manually patching `document.title` in DevTools — both should work, but real-world signals are preferred.
- For SM-08/SM-10, the easiest way to inspect extension storage is: DevTools → Application tab → Storage → Extension Storage (Chrome 114+), or run `chrome.storage.local.get(null, console.log)` in the SW console.
