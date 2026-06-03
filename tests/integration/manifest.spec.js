/**
 * TC-INT-MANIFEST: Validate critical manifest.json fields.
 *
 * These tests guard against regressions that are invisible to other
 * integration tests because they navigate directly to popup.html via URL
 * rather than clicking the extension toolbar icon.
 *
 * Specifically catches:
 *   - Missing action.default_popup (popup unreachable via icon click)
 *   - Missing or wrong permissions
 *   - Missing content_scripts match patterns (e.g. file:// URLs)
 */
import { test, expect } from './fixtures.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, '../../manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

test.describe('Manifest validation (TC-INT-MANIFEST)', () => {

  test('action.default_popup is defined and points to popup.html', () => {
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_popup).toBe('popup.html');
  });

  test('required permissions are declared', () => {
    const perms = manifest.permissions ?? [];
    expect(perms).toContain('tabs');
    expect(perms).toContain('storage');
    expect(perms).toContain('offscreen');
  });

  test('content_scripts include both <all_urls> and file://*/* matches', () => {
    const scripts = manifest.content_scripts ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const entry of scripts) {
      expect(entry.matches).toContain('<all_urls>');
      expect(entry.matches).toContain('file://*/*');
    }
  });

  test('background service_worker is declared', () => {
    expect(manifest.background?.service_worker).toBe('background.js');
  });

});
