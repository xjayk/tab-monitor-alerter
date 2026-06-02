/**
 * Pure utility functions for the DOM MutationObserver trigger system.
 * Extracted for unit testability — no browser or extension API dependencies.
 */

/**
 * Given a list of CSS selector strings, returns only the ones that are
 * syntactically valid (i.e. do not throw when passed to document.querySelector).
 *
 * This prevents a single bad selector from silently breaking all observers.
 *
 * @param {string[]} selectors - Raw selector strings from storage
 * @returns {string[]} Filtered array containing only valid selectors
 */
export function filterValidSelectors(selectors) {
  if (!Array.isArray(selectors)) return [];
  return selectors.filter((selector) => {
    if (typeof selector !== 'string' || selector.trim() === '') return false;
    try {
      document.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Determines whether a DOM Element matches any of the provided CSS selectors,
 * either directly (element.matches) or as a descendant container
 * (element.querySelector).
 *
 * Returns false for non-Element nodes (text nodes, comments, etc.).
 *
 * @param {Node} node - The DOM node to test
 * @param {string[]} selectors - Valid CSS selector strings
 * @returns {boolean} true if node matches any selector
 */
export function nodeMatchesAnySelector(node, selectors) {
  if (!(node instanceof Element)) return false;
  if (!Array.isArray(selectors) || selectors.length === 0) return false;

  for (const selector of selectors) {
    try {
      if (node.matches(selector) || node.querySelector(selector) !== null) {
        return true;
      }
    } catch {
      // Skip invalid selectors — caller should pre-filter with filterValidSelectors
    }
  }
  return false;
}
