import { describe, it, expect, vi } from 'vitest';
import {
  shouldDebounce,
  titleMatchesPattern,
  filterStaleTabs,
  migrateMonitoredTabs,
} from '../src/utils.js';

// ---------------------------------------------------------------------------
// shouldDebounce
// ---------------------------------------------------------------------------
describe('shouldDebounce', () => {
  it('returns false when tab has no prior alert entry', () => {
    expect(shouldDebounce({}, 1, Date.now(), 1000)).toBe(false);
  });

  it('returns true when last alert was within the debounce window', () => {
    const now = Date.now();
    const lastAlertTime = { 1: now - 500 }; // 500ms ago, window is 1000ms
    expect(shouldDebounce(lastAlertTime, 1, now, 1000)).toBe(true);
  });

  it('returns false when last alert was outside the debounce window', () => {
    const now = Date.now();
    const lastAlertTime = { 1: now - 1500 }; // 1500ms ago, window is 1000ms
    expect(shouldDebounce(lastAlertTime, 1, now, 1000)).toBe(false);
  });

  it('returns false when debounce window is exactly matched (boundary)', () => {
    const now = Date.now();
    const lastAlertTime = { 1: now - 1000 }; // exactly at boundary
    expect(shouldDebounce(lastAlertTime, 1, now, 1000)).toBe(false);
  });

  it('does not affect a different tab ID', () => {
    const now = Date.now();
    const lastAlertTime = { 1: now - 100 }; // tab 1 is debounced
    expect(shouldDebounce(lastAlertTime, 2, now, 1000)).toBe(false); // tab 2 is not
  });
});

// ---------------------------------------------------------------------------
// titleMatchesPattern
// ---------------------------------------------------------------------------
describe('titleMatchesPattern', () => {
  it('returns true when pattern matches title', () => {
    expect(titleMatchesPattern('Inbox (3) - Gmail', '\\(\\d+\\)')).toBe(true);
  });

  it('returns false when pattern does not match title', () => {
    expect(titleMatchesPattern('Inbox - Gmail', '\\(\\d+\\)')).toBe(false);
  });

  it('returns true when pattern is an empty string (match-any)', () => {
    expect(titleMatchesPattern('Anything At All', '')).toBe(true);
  });

  it('returns true when pattern is null (match-any)', () => {
    expect(titleMatchesPattern('Anything', null)).toBe(true);
  });

  it('returns true when pattern is undefined (match-any)', () => {
    expect(titleMatchesPattern('Anything', undefined)).toBe(true);
  });

  it('returns false when title is null (not a string)', () => {
    expect(titleMatchesPattern(null, 'inbox')).toBe(false);
  });

  it('returns false when title is undefined (not a string)', () => {
    expect(titleMatchesPattern(undefined, 'inbox')).toBe(false);
  });

  it('falls back to true (match-any) on invalid regex and logs a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = titleMatchesPattern('Some Title', '[[invalid');
    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[tab-monitor]'),
      expect.any(String),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it('is case-sensitive by default (JS regex has no implicit case-insensitivity)', () => {
    expect(titleMatchesPattern('inbox', 'Inbox')).toBe(false);
  });

  it('is case-sensitive: uppercase pattern does not match lowercase title', () => {
    expect(titleMatchesPattern('inbox', 'INBOX')).toBe(false);
  });

  it('matches partial title (not anchored by default)', () => {
    expect(titleMatchesPattern('GitHub - Pull Request #5', 'Pull Request')).toBe(true);
  });

  it('matches title using anchored start pattern', () => {
    expect(titleMatchesPattern('Inbox (3)', '^Inbox')).toBe(true);
    expect(titleMatchesPattern('My Inbox (3)', '^Inbox')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterStaleTabs
// ---------------------------------------------------------------------------
describe('filterStaleTabs', () => {
  it('returns only IDs present in the live set', () => {
    expect(filterStaleTabs([1, 2, 3], new Set([1, 3]))).toEqual([1, 3]);
  });

  it('returns empty array when all stored IDs are stale', () => {
    expect(filterStaleTabs([5, 6, 7], new Set([]))).toEqual([]);
  });

  it('returns all IDs when all are live', () => {
    expect(filterStaleTabs([1, 2], new Set([1, 2, 3]))).toEqual([1, 2]);
  });

  it('returns empty array when storedIds is empty', () => {
    expect(filterStaleTabs([], new Set([1, 2]))).toEqual([]);
  });

  it('handles a single stale ID correctly', () => {
    expect(filterStaleTabs([99], new Set([1, 2]))).toEqual([]);
  });

  it('returns empty array when storedIds is undefined (uninitialized storage)', () => {
    expect(filterStaleTabs(undefined, new Set([1, 2]))).toEqual([]);
  });

  it('returns empty array when storedIds is null', () => {
    expect(filterStaleTabs(null, new Set([1, 2]))).toEqual([]);
  });

  it('returns empty array when liveIds is undefined', () => {
    expect(filterStaleTabs([1, 2], undefined)).toEqual([]);
  });

  it('returns empty array when liveIds is a plain object (not a Set)', () => {
    // Plain objects don't have a .has() method — guard should catch this
    expect(filterStaleTabs([1, 2], { 1: true, 2: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// migrateMonitoredTabs
// ---------------------------------------------------------------------------
describe('migrateMonitoredTabs', () => {
  it('converts old array format to new object format', () => {
    expect(migrateMonitoredTabs([1, 2])).toEqual({
      '1': { pattern: '' },
      '2': { pattern: '' },
    });
  });

  it('passes through already-migrated object format unchanged', () => {
    const input = { '1': { pattern: 'foo' }, '2': { pattern: '' } };
    expect(migrateMonitoredTabs(input)).toEqual(input);
  });

  it('converts an empty array to an empty object', () => {
    expect(migrateMonitoredTabs([])).toEqual({});
  });

  it('passes through an empty object unchanged', () => {
    expect(migrateMonitoredTabs({})).toEqual({});
  });

  it('converts numeric IDs to string keys', () => {
    const result = migrateMonitoredTabs([42]);
    expect(Object.keys(result)).toEqual(['42']);
    expect(result['42']).toEqual({ pattern: '' });
  });
});
