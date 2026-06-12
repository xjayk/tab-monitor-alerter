# AI Coding Agent Context (AGENT.md)

## Purpose
This file provides context for any AI assistant (Cursor, GitHub Copilot, etc.) working on this repository.

## Project Context
- **Name**: Tab Monitor & Alerter
- **Type**: Google Chrome Extension
- **Framework**: Vanilla JavaScript, HTML, CSS (No build step, no bundlers like Webpack/Vite).
- **Standard**: Manifest V3 (MV3) STRICT.

## Core Constraints & Rules
1. **No Persistent Background Pages**: You must use a Service Worker (`background.js`). State is volatile. Rely on `chrome.storage.local` for persistence.
2. **No DOM in Service Worker**: You cannot use `window`, `document`, or `Audio` in `background.js`. All DOM manipulation must happen in content scripts, the popup, or an Offscreen Document.
3. **Audio Playback via Offscreen**: Audio is triggered via `chrome.offscreen.createDocument`. Do not attempt to play audio directly in the background worker.
4. **Main World vs. Isolated World**: 
   - Overriding native browser APIs (like `window.Notification`) requires execution in the `MAIN` world (`content-main.js`).
   - Using Chrome Extension APIs requires execution in the `ISOLATED` world (`content-isolated.js`).
   - Use `window.postMessage` to communicate between the two.

## State Management
- `chrome.storage.local` is the single source of truth.
- Key `monitoredTabs` (Array of Numbers): Stores tab IDs currently being monitored.
- Key `alertingTabId` (Number | null): Stores the ID of the tab currently triggering an active alert.

## Extension Action Behavior
- Standard click opens `popup.html`.
- However, if `alertingTabId` is present, `popup.js` will immediately navigate to the alerting tab and execute `window.close()` without rendering the UI. Maintain this architectural pattern if modifying the popup logic.

## Testing

### Commands
- **Unit tests**: `npm test`
- **Integration tests**: `xvfb-run -a -s "-screen 0 1280x720x24" npm run test:integration`

### Rules
- This project uses **Vitest**, not Jest. Never use Jest flags (e.g. `--runInBand`, `--testPathPattern`).
- Integration tests require a real Chromium instance with a virtual display — always use the `xvfb-run` prefix above. Do not invoke `npx playwright test` directly.
- Never add `--headless` to Playwright/Chromium args — MV3 extensions do not load in headless mode.
