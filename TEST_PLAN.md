# Test Plan — Tab Monitor & Alerter

## Phase 1: (complete)

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
