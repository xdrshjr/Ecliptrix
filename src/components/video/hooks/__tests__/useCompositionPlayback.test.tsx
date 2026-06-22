/**
 * useCompositionPlayback — orchestration hook (spec 02 §2.1 / §2.6 / §3, S3).
 *
 * The MultiTrackPlaybackEngine is mocked so we can assert the hook:
 *   - builds correct VideoTrackGroup[] / AudioSyncGroup[] from compositionPlayback
 *     (z / opacity / transition passthrough; detached embedded-audio tagging);
 *   - injects ONE resolver used for both compare + assign (RC-B compare==assign);
 *   - drives attach / play / pause / seek / dispose over the lifecycle;
 *   - applies the readiness gate (direct-local ready immediately; never blocked
 *     on a missing proxy/download state);
 *   - feeds real subtitle + image overlay data (NOT the [] stub).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MaterialItem, TimelineState } from '@/types';
import type {
  CompositionPlayback,
  VideoSequenceItem,
  AudioSequenceItem,
} from '../../types';
import type { MultiTrackAttachDeps } from '../../playback';

// ---------------------------------------------------------------------------
// Mock the engine: capture attach deps + spy lifecycle methods.
// ---------------------------------------------------------------------------

const attachSpy = vi.fn();
const playSpy = vi.fn();
const pauseSpy = vi.fn();
const seekSpy = vi.fn();
const disposeSpy = vi.fn();
let lastDeps: MultiTrackAttachDeps | null = null;
let phase = 'idle';

vi.mock('../../playback', async () => {
  const actual = await vi.importActual<typeof import('../../playback')>(
    '../../playback',
  );
  class MockEngine {
    attach(deps: MultiTrackAttachDeps) {
      lastDeps = deps;
      attachSpy(deps);
    }
    play() {
      playSpy();
      phase = 'playing';
    }
    pause() {
      pauseSpy();
      phase = 'paused';
    }
    seek(t: number) {
      seekSpy(t);
    }
    getPhase() {
      return phase;
    }
    dispose() {
      disposeSpy();
      phase = 'disposed';
    }
  }
  return { ...actual, MultiTrackPlaybackEngine: MockEngine };
});

import {
  useCompositionPlayback,
  buildVideoTrackGroups,
  buildAudioSyncGroups,
  buildImageOverlayInputs,
  isCompositionReady,
} from '../useCompositionPlayback';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOCAL_URL = '/api/storage/files/video/local.mp4';

function directLocalMaterial(id: string, url = LOCAL_URL): MaterialItem {
  return {
    id,
    name: 'local.mp4',
    type: 'video',
    format: 'mp4',
    size: 1,
    url,
    serverUrl: url,
    cacheUrl: url,
    createdAt: new Date(),
    metadata: { storageKind: 'local', isLocalFile: true, localResolvedUrl: url },
  } as MaterialItem;
}

function vseq(over: Partial<VideoSequenceItem> & { id: string }): VideoSequenceItem {
  return {
    name: over.id,
    url: '',
    startTime: 0,
    duration: 10,
    trackId: 'vt-1',
    clipStart: 0,
    clipEnd: 10,
    ...over,
  } as VideoSequenceItem;
}

function aseq(over: Partial<AudioSequenceItem> & { id: string }): AudioSequenceItem {
  return {
    name: over.id,
    url: LOCAL_URL,
    startTime: 0,
    duration: 10,
    trackId: 'at-1',
    clipStart: 0,
    clipEnd: 10,
    volume: 1,
    ...over,
  } as AudioSequenceItem;
}

function composition(
  over: Partial<CompositionPlayback> = {},
): CompositionPlayback {
  return {
    isCompositionMode: true,
    videoSequences: [],
    audioSequences: [],
    subtitleSequences: [],
    currentSequenceIndex: 0,
    totalCompositionDuration: 10,
    compositionCurrentTime: 0,
    ...over,
  };
}

function fakeHost() {
  const canvas = document.createElement('canvas');
  return {
    getCanvas: () => canvas,
    resolveTrackElements: vi.fn(() => ({ active: {} as never, prewarm: null })),
    resolveAudioElement: vi.fn(() => ({} as never)),
    measureSubtitle: vi.fn(() => 10),
  };
}

beforeEach(() => {
  attachSpy.mockClear();
  playSpy.mockClear();
  pauseSpy.mockClear();
  seekSpy.mockClear();
  disposeSpy.mockClear();
  lastDeps = null;
  phase = 'idle';
});

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

describe('buildVideoTrackGroups', () => {
  it('groups by trackId and orders bottom→top by trackZ', () => {
    const groups = buildVideoTrackGroups([
      vseq({ id: 'a', trackId: 'top', trackZ: 1 }),
      vseq({ id: 'b', trackId: 'bottom', trackZ: 0 }),
      vseq({ id: 'c', trackId: 'top', trackZ: 1 }),
    ]);
    expect(groups.map((g) => g.trackId)).toEqual(['bottom', 'top']);
    expect(groups[0].z).toBe(0);
    expect(groups[1].items.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('falls back to first-seen order when trackZ is absent', () => {
    const groups = buildVideoTrackGroups([
      vseq({ id: 'a', trackId: 'x' }),
      vseq({ id: 'b', trackId: 'y' }),
    ]);
    expect(groups.map((g) => g.z)).toEqual([0, 1]);
  });

  it('carries opacity + transition passthrough onto the items', () => {
    const groups = buildVideoTrackGroups([
      vseq({ id: 'a', opacity: 0.5, transitionIn: { type: 'fade', duration: 1 } }),
    ]);
    expect(groups[0].items[0].opacity).toBe(0.5);
    expect(groups[0].items[0].transitionIn).toEqual({ type: 'fade', duration: 1 });
  });
});

describe('buildAudioSyncGroups (RISK 2 routing)', () => {
  it('produces ONE audio group per INDEPENDENT audio track (no embedded video groups)', () => {
    const groups = buildAudioSyncGroups([aseq({ id: 'm1', trackId: 'at-1' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('audio');
    expect(groups[0].trackId).toBe('at-1');
    // Embedded video-track audio is NOT routed through the AudioSyncPool; it
    // plays from the decode <video> element (VideoSourcePool muted routing).
    // S4 removed the 'embeddedVideoAudio' kind entirely, so every emitted group
    // is now structurally 'audio'.
    expect(groups.every((g) => g.kind === 'audio')).toBe(true);
  });

  it('groups multiple audio items by their audio track', () => {
    const groups = buildAudioSyncGroups([
      aseq({ id: 'm1', trackId: 'at-1' }),
      aseq({ id: 'm2', trackId: 'at-1', startTime: 10 }),
      aseq({ id: 'm3', trackId: 'at-2' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.id)).toEqual(['m1', 'm2']);
    expect(groups[1].trackId).toBe('at-2');
  });

  // timeline-preview-audio-track-silent fix: the source url MUST be carried onto
  // each sync clip so the AudioSyncPool can assign it to the element's `src`
  // before play. Dropping it here is what left the audio track silent.
  it('carries each sequence url onto its sync clip', () => {
    const groups = buildAudioSyncGroups([
      aseq({ id: 'm1', trackId: 'at-1', url: '/api/storage/files/audio/a.mp3' }),
      aseq({ id: 'm2', trackId: 'at-1', url: '/api/storage/files/audio/b.mp3' }),
    ]);
    expect(groups[0].items.map((i) => i.url)).toEqual([
      '/api/storage/files/audio/a.mp3',
      '/api/storage/files/audio/b.mp3',
    ]);
  });
});

describe('buildImageOverlayInputs', () => {
  it('selects image items on visible tracks and resolves their live URL', () => {
    const timeline = {
      tracks: [
        {
          isVisible: true,
          items: [
            {
              id: 'img-1',
              originalMaterialType: 'image',
              materialId: 'mat-img',
              startTime: 1,
              duration: 4,
              imagePosition: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
              opacity: 0.8,
            },
          ],
        },
      ],
    } as unknown as TimelineState;
    const materials = [
      { id: 'mat-img', url: '/api/storage/files/images/x.png' } as MaterialItem,
    ];
    const out = buildImageOverlayInputs(timeline, materials);
    expect(out).toHaveLength(1);
    expect(out[0].src).toBe('/api/storage/files/images/x.png');
    expect(out[0].opacity).toBe(0.8);
  });

  it('drops image items whose material has no URL', () => {
    const timeline = {
      tracks: [
        {
          isVisible: true,
          items: [
            { id: 'img-1', originalMaterialType: 'image', materialId: 'missing', startTime: 0, duration: 1 },
          ],
        },
      ],
    } as unknown as TimelineState;
    expect(buildImageOverlayInputs(timeline, [])).toEqual([]);
  });
});

describe('isCompositionReady (readiness gate)', () => {
  const opts = { preferPreviewProxy: true, preferLocalProxy: true };

  it('an empty timeline is ready', () => {
    expect(isCompositionReady([], [], opts)).toBe(true);
  });

  it('a direct-local material is ready immediately — NOT blocked on proxy/download', () => {
    const seq = vseq({ id: 'a', materialId: 'mat-1' });
    // No previewProxyStatus / localProxyStatus on the material at all.
    expect(isCompositionReady([seq], [directLocalMaterial('mat-1')], opts)).toBe(true);
  });

  it('holds when a video material is missing / has no resolvable URL yet', () => {
    const seq = vseq({ id: 'a', materialId: 'pending', url: '' });
    const pending = {
      id: 'pending',
      name: 'p',
      type: 'video',
      format: 'mp4',
      size: 0,
      url: '',
      createdAt: new Date(),
    } as MaterialItem;
    expect(isCompositionReady([seq], [pending], opts)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hook lifecycle + resolver injection
// ---------------------------------------------------------------------------

function renderUseCompositionPlayback(
  comp: CompositionPlayback,
  materials: MaterialItem[],
  extra: Partial<Parameters<typeof useCompositionPlayback>[0]> = {},
) {
  const host = fakeHost();
  const result = renderHook(() =>
    useCompositionPlayback({
      compositionPlayback: comp,
      materials,
      timelineState: undefined,
      preferPreviewProxy: true,
      preferLocalProxy: true,
      currentTime: 0,
      isPlaying: false,
      aspectRatio: 16 / 9,
      enabled: true,
      ...extra,
    }),
  );
  // Bind the host the way <PreviewCanvas ref={hook.hostRef}> would. The callback
  // ref bumps a version so the attach effect re-runs with the host available.
  act(() => {
    result.result.current.hostRef(host as never);
  });
  return { ...result, host };
}

describe('useCompositionPlayback — engine lifecycle', () => {
  it('attaches the engine once the host + canvas are available', () => {
    renderUseCompositionPlayback(
      composition({ videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })] }),
      [directLocalMaterial('mat-1')],
    );
    expect(attachSpy).toHaveBeenCalled();
    expect(lastDeps).not.toBeNull();
  });

  it('is fully inert when enabled=false (never attaches)', () => {
    renderUseCompositionPlayback(
      composition({ videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })] }),
      [directLocalMaterial('mat-1')],
      { enabled: false },
    );
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it('drives play / pause / seek through the engine', () => {
    const { result } = renderUseCompositionPlayback(
      composition({ videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })] }),
      [directLocalMaterial('mat-1')],
    );
    act(() => result.current.play());
    act(() => result.current.pause());
    act(() => result.current.seek(4));
    expect(playSpy).toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
    expect(seekSpy).toHaveBeenCalledWith(4);
  });

  it('disposes the engine on unmount', () => {
    const { unmount } = renderUseCompositionPlayback(
      composition({ videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })] }),
      [directLocalMaterial('mat-1')],
    );
    unmount();
    expect(disposeSpy).toHaveBeenCalled();
  });
});

describe('useCompositionPlayback — RC-B resolver (compare == assign)', () => {
  it('injects a single resolver that resolves a sequence to its live local URL', () => {
    renderUseCompositionPlayback(
      composition({ videoSequences: [vseq({ id: 'a', materialId: 'mat-1', url: '' })] }),
      [directLocalMaterial('mat-1')],
    );
    const resolveSource = lastDeps!.resolveSource;
    const seq = vseq({ id: 'a', materialId: 'mat-1', url: '' });
    const first = resolveSource(seq);
    const second = resolveSource(seq);
    // Resolves to the live local material URL (may be absolutized by the
    // resolver) — the key invariant is DETERMINISM: the same locked options
    // every call → the VideoSourcePool compare key equals the assigned value.
    expect(first).not.toBeNull();
    expect(first).toContain('/api/storage/files/video/local.mp4');
    expect(second).toBe(first);
  });

  it('exposes real track groups + subtitle + image data via the timeline facade (not the [] stub)', () => {
    renderUseCompositionPlayback(
      composition({
        videoSequences: [vseq({ id: 'a', materialId: 'mat-1', trackZ: 0 })],
        subtitleSequences: [
          { id: 's1', text: 'hi', startTime: 0, duration: 5, trackId: 'sub-1' },
        ],
      }),
      [directLocalMaterial('mat-1')],
    );
    const tl = lastDeps!.timeline;
    expect(tl.getVideoTrackGroups()).toHaveLength(1);
    expect(tl.getSubtitleItems()).toHaveLength(1);
    expect(tl.getSubtitleItems()[0].text).toBe('hi');
  });

  it('reports the readiness gate as ready for a direct-local material', () => {
    const { result } = renderUseCompositionPlayback(
      composition({ videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })] }),
      [directLocalMaterial('mat-1')],
    );
    expect(result.current.isReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// image-overlay-drag-ghost-duplicate — paused-state repaint on overlay change
// ---------------------------------------------------------------------------

describe('useCompositionPlayback — image-overlay ghost-duplicate repaint (方案 A)', () => {
  const imgMaterial = {
    id: 'mat-img',
    name: 'x.png',
    type: 'image',
    format: 'png',
    size: 1,
    url: '/api/storage/files/images/x.png',
    createdAt: new Date(),
  } as MaterialItem;

  function timelineWithImage(pos: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): TimelineState {
    return {
      tracks: [
        {
          isVisible: true,
          items: [
            {
              id: 'img-1',
              originalMaterialType: 'image',
              materialId: 'mat-img',
              startTime: 0,
              duration: 10,
              imagePosition: pos,
            },
          ],
        },
      ],
    } as unknown as TimelineState;
  }

  type Props = Parameters<typeof useCompositionPlayback>[0];

  function makeProps(timelineState: TimelineState, isPlaying: boolean): Props {
    return {
      compositionPlayback: composition({
        videoSequences: [vseq({ id: 'a', materialId: 'mat-1' })],
      }),
      materials: [directLocalMaterial('mat-1'), imgMaterial],
      timelineState,
      preferPreviewProxy: true,
      preferLocalProxy: true,
      currentTime: 0,
      isPlaying,
      aspectRatio: 16 / 9,
      enabled: true,
    };
  }

  function renderWith(timelineState: TimelineState, isPlaying = false) {
    const host = fakeHost();
    const r = renderHook((p: Props) => useCompositionPlayback(p), {
      initialProps: makeProps(timelineState, isPlaying),
    });
    act(() => {
      r.result.current.hostRef(host as never);
    });
    return r;
  }

  it('re-seeks one frame when a paused image overlay is moved (clears the ghost copy)', () => {
    const r = renderWith(
      timelineWithImage({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }),
    );
    seekSpy.mockClear();
    act(() => {
      r.rerender(
        makeProps(
          timelineWithImage({ x: 0.4, y: 0.4, width: 0.8, height: 0.8 }),
          false,
        ),
      );
    });
    // The canvas-rasterised copy is repainted at the new position via a same-
    // time seek, so no duplicate is left behind at the old spot.
    expect(seekSpy).toHaveBeenCalledWith(0);
  });

  it('does NOT re-seek from the overlay path while playing (the rAF loop owns repaint)', () => {
    const r = renderWith(
      timelineWithImage({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }),
      true,
    );
    seekSpy.mockClear();
    act(() => {
      r.rerender(
        makeProps(
          timelineWithImage({ x: 0.4, y: 0.4, width: 0.8, height: 0.8 }),
          true,
        ),
      );
    });
    expect(seekSpy).not.toHaveBeenCalled();
  });

  it('does NOT re-seek when a new timelineState carries identical overlay data (signature stable)', () => {
    const r = renderWith(
      timelineWithImage({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }),
    );
    seekSpy.mockClear();
    act(() => {
      // A brand-new object reference with the SAME overlay content — the derived
      // signature is unchanged, so the repaint effect must not fire.
      r.rerender(
        makeProps(
          timelineWithImage({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }),
          false,
        ),
      );
    });
    expect(seekSpy).not.toHaveBeenCalled();
  });
});
