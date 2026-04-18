import { describe, it, expect } from 'vitest';
import { formatTimelineTime } from '../timeFormat';

describe('formatTimelineTime', () => {
  it('formats seconds without hours', () => {
    expect(formatTimelineTime(5)).toBe('0:05');
  });
  it('formats minutes without hours', () => {
    expect(formatTimelineTime(90)).toBe('1:30');
  });
  it('stays sub-hour at 3599', () => {
    expect(formatTimelineTime(3599)).toBe('59:59');
  });
  it('rolls over to hours at 3600', () => {
    expect(formatTimelineTime(3600)).toBe('1:00:00');
  });
  it('formats 1h30m exactly', () => {
    expect(formatTimelineTime(5400)).toBe('1:30:00');
  });
  it('pads minutes only past 1h', () => {
    expect(formatTimelineTime(3661)).toBe('1:01:01');
  });
  it('formats with ms under 1h', () => {
    expect(formatTimelineTime(90.42, { showMs: true })).toBe('1:30.42');
  });
  it('formats with ms past 1h', () => {
    expect(formatTimelineTime(3661.5, { showMs: true })).toBe('1:01:01.50');
  });
  it('handles NaN', () => {
    expect(formatTimelineTime(NaN)).toBe('0:00');
  });
  it('handles negative', () => {
    expect(formatTimelineTime(-1)).toBe('0:00');
  });
  it('floors ms rather than rounding', () => {
    expect(formatTimelineTime(0.999, { showMs: true })).toBe('0:00.99');
  });
});
