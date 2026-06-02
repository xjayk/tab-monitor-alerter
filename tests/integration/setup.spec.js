/**
 * Smoke test: verifies the extension loads correctly and the MV3
 * service worker is registered and accessible.
 *
 * This is the baseline gate for all subsequent integration tests
 * (TC-INT-01 through TC-INT-10). If this fails, nothing else will work.
 */
import { test, expect } from './fixtures.js';

test('extension loads and service worker is active', async ({ serviceWorker }) => {
  expect(serviceWorker).toBeTruthy();
});
