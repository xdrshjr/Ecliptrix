/**
 * TrackScheduler — spec 02 §2.2 / §6 #4.
 *
 * Pure unit tests: each track resolves the correct active clip at a
 * composition time, gaps resolve to null, boundaries respect TIME_EPSILON, and
 * source time is mapped through the spec 01 ClipTimeMapping contract.
 */

import { describe, it, expect } from 'vitest';
import { TrackScheduler, activeClipAt, prewarmNextAt } from '../TrackScheduler';
import { TIME_EPSILON } from '../../timeline/domain/services/ClipTimeMapping';

interface Clip {
  id: string;
  startTime: number;
  duration: number;
  clipStart?: number;
  clipEnd?: number;
}

function clip(id: string, startTime: number, duration: number, clipStart = 0): Clip {
  return { id, startTime, duration, clipStart, clipEnd: clipStart + duration };
}

describe('activeClipAt', () => {
  it('selects the clip covering t and maps source time via ClipTimeMapping', () => {
    // clip on track at [10,16), reading source [2,8].
    const items = [clip('a', 10, 6, 2)];
    const hit = activeClipAt(items, 13);
    expect(hit?.clip.id).toBe('a');
    expect(hit?.index).toBe(0);
    // local = 13 - 10 = 3; source = clipStart(2) + 3 = 5.
    expect(hit?.sourceTime).toBeCloseTo(5, 6);
  });

  it('returns null in a gap between clips', () => {
    const items = [clip('a', 0, 2), clip('b', 5, 2)];
    expect(activeClipAt(items, 3)).toBeNull();
  });

  it('returns null before the first clip starts', () => {
    const items = [clip('a', 4, 2)];
    expect(activeClipAt(items, 1)).toBeNull();
  });

  it('does not leak past a clip trailing edge into the next clip (half-open)', () => {
    const items = [clip('a', 0, 2), clip('b', 2, 2)];
    // exactly at the boundary 2.0 → the SECOND clip (b) owns [2,4).
    const hit = activeClipAt(items, 2);
    expect(hit?.clip.id).toBe('b');
  });

  it('selects the final frame of the last clip at its exact end', () => {
    const items = [clip('a', 0, 2), clip('b', 2, 3)];
    const hit = activeClipAt(items, 5);
    expect(hit?.clip.id).toBe('b');
    // local clamped to duration 3 → source clipStart(0)+3 = 3.
    expect(hit?.sourceTime).toBeCloseTo(3, 6);
  });

  it('honors TIME_EPSILON at the leading edge', () => {
    const items = [clip('a', 10, 5, 0)];
    expect(activeClipAt(items, 10 - TIME_EPSILON / 2)?.clip.id).toBe('a');
    expect(activeClipAt(items, 10 - TIME_EPSILON * 2)).toBeNull();
  });

  it('resolves independent clips on separate tracks at the same t', () => {
    const trackTop = [clip('top', 0, 10, 0)];
    const trackBottom = [clip('bot', 4, 4, 1)];
    const t = 6;
    expect(activeClipAt(trackTop, t)?.clip.id).toBe('top');
    const botHit = activeClipAt(trackBottom, t);
    expect(botHit?.clip.id).toBe('bot');
    // local = 6 - 4 = 2; source = 1 + 2 = 3.
    expect(botHit?.sourceTime).toBeCloseTo(3, 6);
  });
});

describe('prewarmNextAt', () => {
  it('returns the clip after the active one', () => {
    const items = [clip('a', 0, 2), clip('b', 2, 2), clip('c', 4, 2)];
    const next = prewarmNextAt(items, 1);
    expect(next?.clip.id).toBe('b');
    expect(next?.index).toBe(1);
  });

  it('returns null when the active clip is the last', () => {
    const items = [clip('a', 0, 2), clip('b', 2, 2)];
    expect(prewarmNextAt(items, 3)).toBeNull();
  });

  it('returns the upcoming clip when t is in a gap', () => {
    const items = [clip('a', 0, 2), clip('b', 5, 2)];
    const next = prewarmNextAt(items, 3);
    expect(next?.clip.id).toBe('b');
  });

  it('returns the first clip when t precedes all clips', () => {
    const items = [clip('a', 4, 2)];
    expect(prewarmNextAt(items, 0)?.clip.id).toBe('a');
  });
});

describe('TrackScheduler facade', () => {
  it('delegates to the pure functions', () => {
    const s = new TrackScheduler();
    const items = [clip('a', 0, 4, 0)];
    expect(s.activeClipAt(items, 2)?.clip.id).toBe('a');
    const items2 = [clip('a', 0, 2), clip('b', 2, 2)];
    expect(s.prewarmNext(items2, 1)?.clip.id).toBe('b');
  });
});
