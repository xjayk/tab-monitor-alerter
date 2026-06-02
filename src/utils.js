/**
 * Pure utility functions for Tab Monitor & Alerter.
 * These are intentionally side-effect-free so they can be unit tested
 * without any Chrome Extension API dependencies.
 *
 * Import these into background.js and use them in place of inline logic.
 */

/**
 * Determines whether an alert for a given tab should be suppressed
 * because one was already fired within the debounce window.
 *
 * @param {Object} lastAlertTime - Map of tabId -> timestamp (ms) of last alert
 * @param {number} tabId - The tab ID to check
 * @param {number} now - Current timestamp in ms (Date.now())
 * @param {number} debounceMs - The debounce window in milliseconds
 * @returns {boolean} true if the alert should be suppressed (debounced)
 */
export function shouldDebounce(lastAlertTime, tabId, now, debounceMs) {
  if (!lastAlertTime) return false;
  const last = lastAlertTime[tabId];
  if (last === undefined) return false;
  return (now - last) < debounceMs;
}

/**
 * Tests whether a tab title matches a given regex pattern string.
 * If the pattern is empty, it matches everything (alert on any title change).
 * If the pattern is invalid regex, it logs a warning and falls back to true (match-any).
 *
 * @param {string} title - The new tab title to test
 * @param {string} pattern - A regex pattern string (may be empty)
 * @returns {boolean} true if the title matches (or pattern is empty/invalid)
 */
export function titleMatchesPattern(title, pattern) {
  if (typeof title !== 'string') return false;
  if (!pattern || pattern.trim() === '') return true;
  try {
    const regex = new RegExp(pattern);
    return regex.test(title);
  } catch (e) {
    console.warn('[tab-monitor] Invalid regex pattern, falling back to match-any:', pattern, e);
    return true;
  }
}

/**
 * Filters an array of stored tab IDs against the set of currently live tab IDs,
 * returning only IDs that still correspond to an open tab.
 * Used during startup cleanup to remove stale monitored tab entries.
 *
 * @param {number[]} storedIds - Array of tab IDs from chrome.storage.local
 * @param {Set<number>} liveIds - Set of currently open tab IDs
 * @returns {number[]} Filtered array containing only live IDs
 */
export function filterStaleTabs(storedIds, liveIds) {
  return storedIds.filter(id => liveIds.has(id));
}

/**
 * Migrates the monitoredTabs storage value from the old array format
 * (used in v1.0.0) to the new object format (used in v1.1.0+).
 *
 * Old format: [123, 456]
 * New format: { "123": { pattern: "" }, "456": { pattern: "" } }
 *
 * If the value is already in object format, it is returned unchanged.
 *
 * @param {number[]|Object} stored - The raw value from chrome.storage.local
 * @returns {Object} Normalized monitoredTabs in object format
 */
export function migrateMonitoredTabs(stored) {
  if (!stored) return {};
  if (Array.isArray(stored)) {
    const migrated = {};
    stored.forEach(id => {
      migrated[String(id)] = { pattern: '' };
    });
    return migrated;
  }
  return stored;
}
