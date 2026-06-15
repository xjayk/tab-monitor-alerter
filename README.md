# Tab Monitor & Alerter

[![CI](https://github.com/xjayk/tab-monitor-alerter/actions/workflows/test.yml/badge.svg)](https://github.com/xjayk/tab-monitor-alerter/actions/workflows/test.yml)

## Overview
A Manifest V3 Chrome Extension that provides persistent visual and audio alerts for user-selected browser tabs. Monitors title changes, web Notification API calls, and DOM element mutations. Configurable per alert type with optional global "monitor all" mode.

## Features
- **Per-Type Monitoring Toggles**: Independently enable/disable title updates, web notifications, and DOM triggers via the Settings page.
- **Global Monitoring Mode**: Toggle "monitor all tabs" to watch every tab without per-tab selection.
- **Tab Selection**: Toggle monitoring for individual tabs via the extension popup, including a Select All shortcut.
- **Title Monitoring**: Detects `<title>` updates with optional regex pattern matching.
- **Notification Interception**: Proxies standard HTML5 Web Notifications in the MAIN world.
- **DOM Mutation Triggers**: Observes real-time DOM changes (e.g., a button with `aria-label="Approve"` appearing on Perplexity).
- **Dual Alerts**: Flashing extension badge (red/black) + audio beep via offscreen document.
- **Quick Navigation**: Click the flashing extension icon to focus the alerting tab and dismiss the alert.
- **Active-Tab Suppression**: Optionally suppress alerts when the monitored tab is already in focus.

## Project Structure

| File | Purpose |
|---|---|
| `background.js` | Service worker: event listeners, alert logic, content script injection |
| `content-main.js` | Injected into MAIN world: Notification proxy + DOM MutationObserver |
| `content-isolated.js` | Injected into ISOLATED world: relays messages to background |
| `popup.html` / `popup.js` | Extension popup: tab list, monitoring toggles, select-all |
| `options.html` / `options.js` | Settings page: per-type toggles, monitor-all, active-tab suppression |
| `offscreen.html` / `offscreen.js` | Offscreen document for audio playback (MV3 requirement) |
| `src/utils.js` | Pure utility functions: debounce, pattern matching, migration, normalization |
| `manifest.json` | Extension manifest (MV3, permissions, content scripts) |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Background Service Worker (background.js)                   │
│  • Owns alert state, debounce, badge flashing                │
│  • Injects content-main.js into tab MAIN world               │
│  • Listens: chrome.tabs.onUpdated, onActivated, onRemoved    │
│  • Answers GET_DOM_TRIGGERS from content scripts             │
└────────┬────────────┬──────────────┬─────────────────────────┘
         │            │              │
         ▼            ▼              ▼
┌──────────────┐ ┌────────────────┐ ┌──────────────────────────┐
│ popup.js     │ │ options.js     │ │ content-isolated.js       │
│ (popup UI)   │ │ (Settings)     │ │ (ISOLATED world relay)    │
│ MonitoredTab │ │ Per-type       │ │ postMessage → chrome.runt │
│ toggles      │ │ toggles,       │ │ CS_PING/CS_PONG handshake│
│ Select All   │ │ monitorAllTabs │ │ Origin validation         │
└──────────────┘ └────────────────┘ └──────────┬───────────────┘
                                                │ postMessage
                                                ▼
                                      ┌──────────────────┐
                                      │ content-main.js   │
                                      │ (MAIN world)      │
                                      │ Notification proxy│
                                      │ MutationObserver  │
                                      │ for DOM triggers  │
                                      └──────────────────┘
```

## Build & Operation Instructions
### Installation (Development Mode)
1. Clone or download the repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked**.
5. Select the directory containing the extension files (`manifest.json`, etc.).

### Usage
1. Click the extension icon in the Chrome toolbar.
2. The popup will list all currently open tabs in the active window.
3. Check the box next to any tab you wish to monitor.
4. When the monitored tab updates its title or triggers a notification, the extension badge will flash `!` and a beep will play.
5. Click the flashing extension icon to instantly jump to the alerting tab and clear the alert.

## Permissions
- `tabs`: Required to read tab titles and manage focus navigation.
- `storage`: Used to persist the list of monitored tabs across browser sessions.
- `scripting`: Required to inject content scripts.
- `offscreen`: Required to create the hidden DOM for audio playback.
- `host_permissions` (`<all_urls>`): Allows the extension to monitor tabs across any domain.

## Manual Testing

A self-contained test page is provided at `tests/manual/test-notify.html`. It exercises all alert trigger paths without needing a real third-party site.

### Setup
1. Install the extension in dev mode (see above).
2. Open `tests/manual/test-notify.html` in Chrome. You can do this two ways:
   - **Direct file:** `File → Open File` in Chrome and navigate to the file. Note that `file://` URLs require `Allow access to file URLs` to be enabled on the extension's detail page at `chrome://extensions/`.
   - **Local server (recommended):** Run `npx serve .` from the repo root and open `http://localhost:3000/tests/manual/test-notify.html`.
3. Click the extension icon and **enable monitoring for this tab**.

### Test paths

| # | Button | Trigger path | Expected result |
|---|---|---|---|
| 1 | Fire window.Notification() | `window.Notification()` proxy in `content-main.js` | Badge flashes, beep plays |
| 2 | Inject matching node | `addedNodes` MutationObserver, `aria-label="Approve"` | Badge flashes, beep plays |
| 3 | 1. Create base node; 2. Set aria-label on existing node | Attribute MutationObserver on an existing button | Badge flashes, beep plays after step 2 |
| 4 | Change tab title | `chrome.tabs.onUpdated` in `background.js` | Badge flashes, beep plays |

### Troubleshooting
- **Path 1 doesn't alert:** Check that Notification permission was granted (browser will prompt). Also open DevTools on the tab and verify `content-main.js` is injected (`Sources → Content scripts`).
- **Path 2 or 3 doesn't alert:** The `SET_DOM_TRIGGERS` handshake may have been missed. Reload the tab *after* the extension is loaded, then re-enable monitoring. Paths 2 and 3 also require a localhost URL so the default DOM trigger map can match the page hostname.
- **Nothing alerts at all:** Confirm the tab is checked in the popup. Check the per-type monitoring toggles in Settings (`chrome.runtime.openOptionsPage()`). Open `chrome://extensions/` → inspect the extension's service worker → check the console for errors.
