# Tab Monitor & Alerter

## Overview
A Manifest V3 Chrome Extension that provides persistent visual and audio alerts for user-selected browser tabs. It monitors specific tabs for title changes and native Web Notifications.

## Features
- **Tab Selection**: Toggle monitoring for any open tab via the extension popup.
- **Title Monitoring**: Detects `<title>` updates (e.g., unread message indicators).
- **Notification Interception**: Proxies standard HTML5 Web Notifications in the main world.
- **Dual Alerts**: 
  - Flashing extension badge (red/black toggling).
  - Audio beep via an offscreen document.
- **Quick Navigation**: Clicking the extension icon when an alert is active immediately focuses the alerting tab.

## Project Files
- `manifest.json`
- `background.js`
- `content-main.js`
- `content-isolated.js`
- `popup.html`
- `popup.js`
- `offscreen.html`
- `offscreen.js`

## Architecture & Technical Notes
- **Manifest V3**: Adheres to modern extension standards.
- **Background Service Worker (`background.js`)**: Manages state, listens to tab updates, and coordinates alerts.
- **Content Scripts**: 
  - `content-main.js`: Injected into the page's `MAIN` world to proxy `window.Notification`.
  - `content-isolated.js`: Relays messages from the main world to the extension's background worker.
- **Offscreen Document (`offscreen.html`/`js`)**: Used to play audio since Manifest V3 service workers lack DOM access. This starter uses an inline base64 beep in `offscreen.js`.
- **Popup Logic**: The popup acts as both the tab monitor UI and the alert click handler.

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
| 3 | Mutate aria-label on existing node | Attribute mutation — **known gap** | No alert (documents missing `attributes: true` in observer) |
| 4 | Change tab title | `chrome.tabs.onUpdated` in `background.js` | Badge flashes, beep plays |

### Troubleshooting
- **Path 1 doesn't alert:** Check that Notification permission was granted (browser will prompt). Also open DevTools on the tab and verify `content-main.js` is injected (`Sources → Content scripts`).
- **Path 2 doesn't alert:** The `SET_DOM_TRIGGERS` handshake may have been missed. Reload the tab *after* the extension is loaded, then re-enable monitoring.
- **Nothing alerts at all:** Confirm the tab is checked in the popup. Open `chrome://extensions/` → inspect the extension's service worker → check the console for errors.
