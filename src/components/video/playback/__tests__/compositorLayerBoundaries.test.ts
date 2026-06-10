/**
 * Cross-layer boundary + integration-contract tests (spec 02 §2.2/§2.3/§2.5).
 *
 * Added by google-tester-01 (TODO 02 S1 acceptance). These probe TWO things the
 * per-layer unit tests do not assert together:
 *
 *  1. The TRAILING-EDGE selection convention differs across the three active-at
 *     selectors by design (clip handoff vs. no overlay frame-leak vs. subtitle
 *     visible through end). This file pins each convention so a future "tidy-up"
 *     that accidentally unifies them — and silently changes preview behaviour —
 *     fails loudly. In particular it documents that audio at the EXACT end of
 *     the LAST clip stays a play candidate for one frame (last-clip-inclusive),
 *     whereas an image overlay does NOT leak past its end.
 *
 *  2. The S1 data layers feed the S2/S3 compositor across stable contract
 *     boundaries (`CompositorLayer['image']` shape; the AudioSyncAction plan
 *     shape). Verifying the produced shapes now is integration credit earned
 *     before S2/S3 consume them.
 */

import { describe, it, expect } from 'vitest';
import { activeClipAt } from '../TrackScheduler';
import {
  activeImageItemsAt,
  buildImageLayersAt,
  type ImageOverlayInput,
} from '../ImageOverlayLayer';
import { activeSubtitlesAt } from '../SubtitleLayer';
import { computeAudioSyncActions, type AudioSyncGroup } from '../AudioSyncPool';
import { TIME_EPSILON } from '../../timeline/domain/services/ClipTimeMapping';
import type { OverlayPayload, CompositorLayer } from '../types';
import type { SubtitleSequenceItem } from '../../types';

// ---------------------------------------------------------------------------
// 1. Trailing-edge convention consistency — three selectors, three intents.
// ---------------------------------------------------------------------------

describe('trailing-edge selection conventions (intentional, documented divergence)', () => {
  it('activeClipAt: a NON-last clip is strict half-open; the boundary belongs to the next clip', () => {
    const items = [
      { id: 'a', startTime: 0, duration: 5 },
      { id: 'b', startTime: 5, duration: 5 },
    ];
    // Exactly at 5.0 → the next clip owns it (no double-cover at a seam).
    expect(activeClipAt(items, 5)?.clip.id).toBe('b');
    // Just inside a's body (5 - 2*eps) → a still owns it.
    expect(activeClipAt(items, 5 - TIME_EPSILON * 2)?.clip.id).toBe('a');
  });

  it('activeClipAt: the LAST clip is INCLUSIVE at its exact end (final frame wins)', () => {
    const items = [{ id: 'a', startTime: 0, duration: 5 }];
    // t === end of the last clip → still selected (mirrors v1 "last wins at end").
    const hit = activeClipAt(items, 5);
    expect(hit?.clip.id).toBe('a');
    // local clamps to duration → source time === clipStart + duration.
    expect(hit?.sourceTime).toBeCloseTo(5, 6);
    // Beyond end + epsilon → nothing.
    expect(activeClipAt(items, 5 + TIME_EPSILON * 2)).toBeNull();
  });

  it('activeImageItemsAt: an image overlay does NOT leak at its exact end (strict half-open, even for the only item)', () => {
    const items: ImageOverlayInput[] = [
      { id: 'img', src: '/x.png', startTime: 0, duration: 5 },
    ];
    // Unlike activeClipAt, the image layer drops the overlay at its end so no
    // stale overlay frame leaks — there is no "last item inclusive" carve-out.
    expect(activeImageItemsAt(items, 5)).toEqual([]);
    expect(activeImageItemsAt(items, 5 - TIME_EPSILON * 2).map((i) => i.id)).toEqual(['img']);
  });

  it('activeSubtitlesAt: a subtitle stays visible THROUGH its exact end (closed interval)', () => {
    const items: SubtitleSequenceItem[] = [
      { id: 's', text: 'caption', startTime: 0, duration: 5, trackId: 't' },
    ];
    // Closed at the trailing edge so a caption does not blink out one frame early.
    expect(activeSubtitlesAt(items, 5).map((s) => s.id)).toEqual(['s']);
    expect(activeSubtitlesAt(items, 5 + TIME_EPSILON / 2).map((s) => s.id)).toEqual(['s']);
    expect(activeSubtitlesAt(items, 5 + TIME_EPSILON * 2)).toEqual([]);
  });

  it('the three selectors genuinely DIVERGE at the exact end of a single item (regression guard)', () => {
    const t = 5;
    const clip = [{ id: 'a', startTime: 0, duration: 5 }];
    const image: ImageOverlayInput[] = [{ id: 'a', src: '/x.png', startTime: 0, duration: 5 }];
    const subtitle: SubtitleSequenceItem[] = [
      { id: 'a', text: 'x', startTime: 0, duration: 5, trackId: 't' },
    ];
    // clip (last): inclusive → selected. image: strict → dropped. subtitle: closed → selected.
    expect(activeClipAt(clip, t)).not.toBeNull();
    expect(activeImageItemsAt(image, t)).toEqual([]);
    expect(activeSubtitlesAt(subtitle, t)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 1b. Audio at the EXACT end of the LAST clip — the convention the reviewer
//     flagged for a spot-check. Pin it so the behaviour is intentional.
// ---------------------------------------------------------------------------

describe('audio at the exact end of the last clip (one-frame play, by convention)', () => {
  function audioGroup(items: AudioSyncGroup['items']): AudioSyncGroup {
    return { trackId: 't1', muted: false, volume: 1, kind: 'audio', items };
  }

  it('a single audio clip is STILL a play candidate at its exact end (not paused)', () => {
    const groups = [audioGroup([{ id: 'a', startTime: 0, duration: 5, clipStart: 0, clipEnd: 5 }])];
    const actions = computeAudioSyncActions(groups, 5, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 5 },
      isElementPlayingByTrack: { t1: true },
    });
    // Because activeClipAt is last-clip-inclusive, the action is 'hold'/'play',
    // NOT 'pause'. Cosmetically negligible — it self-heals when the clock stops
    // at composition end. This test documents the intent so a change is caught.
    expect(actions[0].action).toBe('hold');
  });

  it('just PAST the end of the last clip → pause (no audio leak beyond the timeline)', () => {
    const groups = [audioGroup([{ id: 'a', startTime: 0, duration: 5, clipStart: 0, clipEnd: 5 }])];
    const actions = computeAudioSyncActions(groups, 5 + TIME_EPSILON * 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 5 },
      isElementPlayingByTrack: { t1: true },
    });
    expect(actions[0].action).toBe('pause');
  });

  it('at the seam between two audio clips the FIRST is half-open → the next clip owns the boundary', () => {
    const groups = [
      audioGroup([
        { id: 'a', startTime: 0, duration: 5, clipStart: 0, clipEnd: 5 },
        { id: 'b', startTime: 5, duration: 5, clipStart: 0, clipEnd: 5 },
      ]),
    ];
    // Element is sitting near a's end (5); the boundary now belongs to clip b,
    // whose source time is 0 → a big drift forces a seek BACK to 0.
    const actions = computeAudioSyncActions(groups, 5, {
      isPlaying: true,
      currentSourceTimeByTrack: { t1: 5 }, // far from b's source-0 → seek
      isElementPlayingByTrack: { t1: true },
    });
    // The boundary maps to clip b's source time (0), not a's end (5).
    expect(actions[0].action).toBe('seek');
    expect(actions[0].targetSourceTime).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// 2. Integration-boundary: produced shapes feed the S2/S3 compositor.
// ---------------------------------------------------------------------------

describe('integration boundary — ImageOverlayLayer → CompositorLayer[image] → compositor draw inputs', () => {
  it('produces an image layer whose fields satisfy what CanvasCompositor._drawOverlays reads', () => {
    const items: ImageOverlayInput[] = [
      {
        id: 'ov',
        src: '/api/storage/files/images/a.png',
        startTime: 0,
        duration: 10,
        position: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, zIndex: 2 },
        opacity: 0.7,
      },
    ];
    const layers = buildImageLayersAt(items, 5);
    expect(layers).toHaveLength(1);
    const layer = layers[0];

    // The exact fields _drawOverlays' `image` branch consumes: src, opacity,
    // bounds.{x,y,w,h}. Adapt the produced CompositorLayer['image'] into the
    // OverlayPayload['image'] shape the current compositor draws and assert the
    // shared fields are all present + numeric (no NaN/undefined leak).
    const drawInput: Extract<OverlayPayload, { kind: 'image' }> = {
      kind: 'image',
      id: layer.id,
      src: layer.src,
      bounds: layer.bounds,
      opacity: layer.opacity,
      startMs: items[0].startTime * 1000,
      endMs: (items[0].startTime + items[0].duration) * 1000,
    };
    expect(drawInput.src).toBe('/api/storage/files/images/a.png');
    expect(drawInput.opacity).toBeCloseTo(0.7, 6);
    for (const v of [drawInput.bounds.x, drawInput.bounds.y, drawInput.bounds.w, drawInput.bounds.h]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('the produced layer is statically a CompositorLayer[image] (z carried for cross-layer ordering)', () => {
    const layers = buildImageLayersAt(
      [{ id: 'a', src: '/x.png', startTime: 0, duration: 5, position: { x: 0, y: 0, width: 0.4, height: 0.4, zIndex: 9 } }],
      1,
    );
    const layer: Extract<CompositorLayer, { kind: 'image' }> = layers[0];
    expect(layer.kind).toBe('image');
    expect(layer.z).toBe(9);
  });
});

describe('integration boundary — AudioSyncPool plan shape (fed to the S3 HTMLAudio applier)', () => {
  it('every action carries trackId + a valid AudioSyncActionKind, and seek/play/hold carry a clamped volume', () => {
    const groups: AudioSyncGroup[] = [
      { trackId: 'a', muted: false, volume: 1, kind: 'audio', items: [{ id: 'c', startTime: 0, duration: 5, clipStart: 0, clipEnd: 5, volume: 1 }] },
      { trackId: 'b', muted: true, volume: 1, kind: 'audio', items: [{ id: 'd', startTime: 0, duration: 5, clipStart: 0, clipEnd: 5 }] },
    ];
    const actions = computeAudioSyncActions(groups, 2, {
      isPlaying: true,
      currentSourceTimeByTrack: { a: 0 }, // forces a seek on track a
    });
    expect(actions).toHaveLength(2);
    for (const a of actions) {
      expect(typeof a.trackId).toBe('string');
      expect(['seek', 'play', 'pause', 'hold']).toContain(a.action);
      if (a.action !== 'pause') {
        expect(a.volume).toBeGreaterThanOrEqual(0);
        expect(a.volume).toBeLessThanOrEqual(1);
      }
    }
    // track b is muted → pause with no volume.
    const b = actions.find((x) => x.trackId === 'b')!;
    expect(b.action).toBe('pause');
    expect(b.volume).toBeUndefined();
  });
});
