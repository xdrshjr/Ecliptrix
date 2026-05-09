/**
 * Tests for formatRelativeTime helper (iter7 Bug #3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from '../relativeTime';
import { translations } from '../i18n';

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-05-09T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const isoMinusSec = (sec: number): string => new Date(NOW - sec * 1000).toISOString();

  it('returns fallback for null/undefined', () => {
    expect(formatRelativeTime(null, 'en', translations.en, '-')).toBe('-');
    expect(formatRelativeTime(undefined, 'en', translations.en, '-')).toBe('-');
  });

  it('returns fallback for unparsable input', () => {
    expect(formatRelativeTime('not a date', 'en', translations.en, '-')).toBe('-');
  });

  it('uses justNow for sub-minute diffs (en)', () => {
    expect(formatRelativeTime(isoMinusSec(30), 'en', translations.en)).toBe('Just now');
  });

  it('uses justNow for sub-minute diffs (zh-CN)', () => {
    expect(formatRelativeTime(isoMinusSec(30), 'zh-CN', translations['zh-CN'])).toBe('刚刚');
  });

  it('produces minutes for < 1 hour (en)', () => {
    const result = formatRelativeTime(isoMinusSec(5 * 60), 'en', translations.en);
    expect(result).toMatch(/5 minutes? ago/);
  });

  it('produces minutes for < 1 hour (zh-CN)', () => {
    const result = formatRelativeTime(isoMinusSec(5 * 60), 'zh-CN', translations['zh-CN']);
    expect(result).toMatch(/5\s*分钟前/);
  });

  it('produces hours for < 24 hours (en)', () => {
    const result = formatRelativeTime(isoMinusSec(3 * 60 * 60), 'en', translations.en);
    expect(result).toMatch(/3 hours? ago/);
  });

  it('produces days for < 30 days (en)', () => {
    const result = formatRelativeTime(isoMinusSec(7 * 86400), 'en', translations.en);
    expect(result).toMatch(/7 days? ago/);
  });

  it('falls back to absolute date for >= 30 days', () => {
    const result = formatRelativeTime(isoMinusSec(35 * 86400), 'en', translations.en);
    expect(result).toBeTruthy();
    expect(result).not.toMatch(/Just now/);
  });
});
