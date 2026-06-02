# TODO

## Immediate Next Steps
- [ ] **Swap Audio Payload**: Replace the placeholder Base64 string in `offscreen.js` with the final, preferred audio beep file.
- [ ] **Refine UI/UX**: Add CSS styling to `popup.html` to match the brand or provide a dark mode toggle.

## Technical Improvements
- [ ] **Custom Alert Rules**: Allow users to define regex patterns for title changes (e.g., only alert if title matches `(1)`).
- [ ] **Audio Fallback/Permissions**: Test audio playback on strictly configured browsers. If the browser requires user interaction before audio plays, handle the `DOMException` gracefully and notify the user to grant audio permissions to the extension.
- [ ] **Cross-Window Tab Management**: Update `popup.js` to optionally group tabs by window or query across all windows (`windowId: chrome.windows.WINDOW_ID_CURRENT` vs all windows).
- [ ] **Debouncing Alerts**: Implement a debounce in `background.js` to prevent overlapping or rapid-fire alerts if a tab updates its title multiple times in a single second.

## Edge Cases to Handle
- [ ] **Suspended/Discarded Tabs**: Chrome's memory saver may discard background tabs. Ensure monitoring resumes correctly when a tab is restored.
- [ ] **Stale Storage**: Add a cleanup routine on extension startup to remove stored `monitoredTabs` IDs that no longer exist in the browser.
