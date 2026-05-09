import { describe, it, expect } from 'vitest';
import { toDate, formatDate, formatTime } from '../dateFormat';

describe('toDate', () => {
  it('returns Date instance unchanged when valid', () => {
    const d = new Date('2026-05-10T12:00:00Z');
    expect(toDate(d)).toBe(d);
  });

  it('parses ISO string to Date', () => {
    const r = toDate('2026-05-10T12:00:00Z');
    expect(r).toBeInstanceOf(Date);
    expect(r!.getUTCFullYear()).toBe(2026);
  });

  it('parses unix ms number to Date', () => {
    const ms = Date.UTC(2026, 4, 10, 12, 0, 0);
    const r = toDate(ms);
    expect(r).toBeInstanceOf(Date);
    expect(r!.getTime()).toBe(ms);
  });

  it('returns null for null input', () => {
    expect(toDate(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(toDate(undefined)).toBeNull();
  });

  it('returns null for invalid string', () => {
    expect(toDate('not-a-date')).toBeNull();
  });

  it('returns null for invalid Date instance', () => {
    expect(toDate(new Date('invalid'))).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats valid ISO string', () => {
    const out = formatDate('2026-05-10T12:00:00Z', 'en-US');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns fallback for null/undefined', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate(undefined, undefined, undefined, '—')).toBe('—');
  });

  it('returns fallback for invalid string', () => {
    expect(formatDate('garbage', undefined, undefined, 'N/A')).toBe('N/A');
  });
});

describe('formatTime', () => {
  it('formats valid Date', () => {
    const d = new Date('2026-05-10T12:00:00Z');
    const out = formatTime(d, 'en-US', { hour: '2-digit', minute: '2-digit' });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns fallback for null/undefined', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined, undefined, undefined, '--:--')).toBe('--:--');
  });

  it('returns fallback for invalid input', () => {
    expect(formatTime('not-a-time', undefined, undefined, '?')).toBe('?');
  });
});
