# Tab Monitor & Alerter — Test Plan

## Constraints & Context
- Vanilla JS, no bundler, no existing test framework
- MV3 Service Worker — volatile state, no DOM access in background
- Two content script worlds (MAIN + ISOLATED) communicating via `postMessage`
- CI configured via `.github/workflows/test.yml` (ESLint + Vitest, runs on push to trunk and all PRs)

---

## Phase 1 — Low-Hanging Fruit ✅ COMPLETE

All Phase 1 deliverables are merged into `trunk`.

### What Was Delivered

| Deliverable | File | Status |
|---|---|---|
| Manual smoke test checklist (SM-01–10) | `TEST_PLAN.md` | ✅ |
| Pure logic utility functions | `src/utils.js` | ✅ |
| Vitest unit test suite (28 cases) | `tests/utils.test.js` | ✅ |
| Node/npm project with test + lint scripts | `package.json` | ✅ |
| GitHub Actions CI (ESLint + Vitest, parallel) | `.github/workflows/test.yml` | ✅ |
| ESLint v9 flat config with browser/extension globals | `eslint.config.js` | ✅ |

### Running Phase 1 Locally

```bash
npm install
npm run lint    # ESLint — must be 0 errors
npm test        # Vitest — all 28 tests must pass
```

### Manual Smoke Test Checklist

Load the unpacked extension in `chrome://extensions` (Developer Mode → Load unpacked → select repo root).
Open the Service Worker console via the **Inspect views: service worker** link on the extension card.

Run after every significant change before pushing.

| ID | Scenario | Steps | Expected Result |
|---|---|---|---|
| SM-01 | Install loads cleanly | Load unpacked extension | No errors or warnings in SW console |
| SM-02 | Popup opens | Click extension icon | Tab list renders showing current window’s tabs |
| SM-03 | Monitor a tab | Check a tab’s toggle checkbox, close popup, reopen | Checkbox is still checked |
| SM-04 | Title change alert | Monitor a tab; trigger a title change (e.g. open Gmail and receive an email) | Badge flashes red/black alternating; audio plays |
| SM-05 | Alert navigation | While badge is flashing, click extension icon | Extension immediately navigates to alerting tab and popup closes without rendering UI |
| SM-06 | Alert clears after navigation | After SM-05, click extension icon again | Normal popup UI renders; badge is gone |
| SM-07 | Unmonitor tab | Uncheck a previously monitored tab | No alert fires on subsequent title change for that tab |
| SM-08 | Close monitored tab | Close a tab that is being monitored | Open extension storage and confirm the tab ID is gone from `monitoredTabs` |
| SM-09 | Close alerting tab | Trigger an alert (SM-04), then close the alerting tab | Badge clears automatically within ~1s |
| SM-10 | SW restart resilience | Enable a monitored tab, disable and re-enable the extension, reopen popup | Previously monitored tab is still checked |

> **Tip:** To inspect extension storage: DevTools → Application → Extension Storage (Chrome 114+), or run `chrome.storage.local.get(null, console.log)` in the SW console.

### Pass Criteria
All 10 smoke cases must pass before merging any PR that touches `background.js`, `popup.js`, `content-main.js`, or `content-isolated.js`.

---

## Phase 2 — Integration Tests 🚧 NEXT SPRINT

These test Chrome Extension APIs directly using **[Playwright](https://playwright.dev/)** with its Chromium Extension testing support. This is the industry standard for MV3 extension integration testing.

### Setup

```bash
npm install -D playwright @playwright/test
npx playwright install chromium
```

### Test Scenarios

**Background ↔ Content Script messaging:**
```
TC-INT-01: postMessage from MAIN world → ISOLATED world → background triggers alert
TC-INT-02: Spoofed postMessage (wrong type) does NOT trigger alert
TC-INT-03: Rapid postMessage flood (10 in 500ms) triggers only 1 alert (debounce)
```

**Storage integrity:**
```
TC-INT-04: Adding a monitored tab via popup persists to chrome.storage.local
TC-INT-05: SW restart (service worker terminate + wake) retains monitoredTabs
TC-INT-06: Tab close removes ID from storage
TC-INT-07: Startup cleanup removes 3 stale IDs, keeps 2 live ones
```

**Alert lifecycle:**
```
TC-INT-08: alertingTabId written to storage when alert fires
TC-INT-09: alertingTabId cleared from storage after popup navigation
TC-INT-10: Opening popup with stale alertingTabId (tab closed) falls through to normal UI
```

### Playwright Extension Test Skeleton

```js
// tests/integration/alert.spec.js
import { test, expect, chromium } from '@playwright/test';
import path from 'path';

let context;

test.beforeAll(async () => {
  const extensionPath = path.resolve(__dirname, '../../');
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
});

test.afterAll(() => context.close());

test('TC-INT-08: alertingTabId written to storage on title change', async () => {
  const page = await context.newPage();
  await page.goto('https://example.com');
  // ... get extension SW, query storage, assert alertingTabId
});
```

### Effort
~2–3 days setup + test authoring.

### Dependencies
- Phase 1 complete ✅
- Issues #13 (debounce) and #17 (stale tab cleanup) should be merged first so TC-INT-03 and TC-INT-07 have real implementations to test against

---

## Phase 3 — Regression & Edge Case Suite 🔄 ONGOING / RELEASE

Lower-frequency, higher-effort tests. Run on release branches only.

| ID | Category | Scenario |
|---|---|---|
| REG-01 | Memory Saver | Discard a monitored tab via `chrome://discards`, restore it, trigger alert |
| REG-02 | Multi-window | Monitor tabs in 3 separate windows; verify correct window focuses on alert |
| REG-03 | Autoplay blocked | Block audio via `chrome://settings/content/sound`, verify `⚠️` badge + popup warning (issue #14) |
| REG-04 | Invalid regex | Enter `[[invalid` as pattern, trigger title change, verify no crash |
| REG-05 | 50 monitored tabs | Monitor 50 tabs simultaneously; verify no performance degradation |
| REG-06 | Extension update | Upgrade from v1.0.0 storage format to v1.1.0; verify migration |
| REG-07 | Incognito | Verify extension behaviour when `allow in incognito` is on/off |
| REG-08 | Chrome version matrix | Run SM-01–SM-10 on Chrome stable, beta, and canary |

---

## Rollout Summary

| Phase | Status | Deliverable |
|---|---|---|
| Phase 1 | ✅ Complete | Smoke checklist, Vitest unit tests (28 cases), ESLint, CI workflow |
| Phase 2 | 🚧 Next sprint | Playwright integration tests — API boundaries, storage, alert lifecycle |
| Phase 3 | 🔄 Ongoing | Full regression suite on release branches |
