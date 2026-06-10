/**
 * @vitest-environment node
 *
 * VideoEditingInterface — live timeline → shared store mirror (Option A)
 * (docs/plans/video-editor-track-download-trigger-fix/spec.md §3.2 / §7.1).
 *
 * The bug (round 4): manual timeline edits only land in the local
 * `currentTimelineState` (and the Agent's `setTimelineState` is wired to that
 * same local setter — VideoEditingInterface.tsx:2388), so
 * `useVideoEditingStore.timelineState` was never written a non-null value. The
 * auto-download triggers in `useMaterialManagement` read ONLY that store slice,
 * so their id sets stayed empty → no auto-download, no track progress masks,
 * and the readiness gate (which reads the live `currentTimelineState` prop)
 * reported "0/N ready". The fix mirrors `currentTimelineState` into the store.
 *
 * This file locks the review's mandatory invariant (Verdict cond. #2): the
 * gate's media set == the download hook's input set, both derived from the same
 * timeline — plus the no-loop guarantee (the mirror, via setTimelineState,
 * leaves `externalUpdateId` untouched). Following the established
 * VideoEditingInterface test convention (jsx:"preserve" disables JSX mounts),
 * the production wiring is pinned with source-level assertions; the no-loop
 * property is exercised against the real zustand store action.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resetVideoEditingStore,
  useVideoEditingStore,
} from '@/stores/videoEditingStore';
import type {
  MaterialItem,
  TimelineItem,
  TimelineState,
  Track,
} from '@/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(patch: Partial<TimelineItem>): TimelineItem {
  return {
    id: 'it',
    name: 'it',
    type: 'video',
    startTime: 0,
    duration: 5,
    trackId: 't',
    color: '#000',
    ...patch,
  };
}

function makeTrack(patch: Partial<Track>): Track {
  return {
    id: 'tr',
    name: 'tr',
    type: 'video',
    height: 80,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 0,
    items: [],
    ...patch,
  };
}

function makeTimeline(tracks: Track[]): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 10,
    zoomLevel: 1,
    selectedItems: [],
    tracks,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

function makeMaterial(patch: Partial<MaterialItem>): MaterialItem {
  return {
    id: 'm',
    name: 'm',
    type: 'video',
    format: 'mp4',
    size: 1000,
    url: 'https://x/m',
    createdAt: new Date(),
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// Derivation helpers — faithful copies of the production口径, pinned to the
// real source by the "production wiring" assertions below so they cannot drift.
// ---------------------------------------------------------------------------

/** Mirrors useMaterialManagement timelineMediaMaterialIds — keys by item.type. */
function deriveDownloadIds(ts: TimelineState | null): Set<string> {
  const ids = new Set<string>();
  ts?.tracks?.forEach((track) =>
    track.items?.forEach((item) => {
      if ((item.type === 'video' || item.type === 'audio') && item.materialId) {
        ids.add(item.materialId);
      }
    }),
  );
  return ids;
}

/** Mirrors VideoPlayerPanel mediaReadiness — gates by MATERIAL type (C2). */
function deriveGateMediaIds(
  ts: TimelineState | null,
  materials: MaterialItem[],
): Set<string> {
  const byId = new Map(materials.map((m) => [m.id, m] as const));
  const ids = new Set<string>();
  ts?.tracks?.forEach((track) =>
    track.items?.forEach((item) => {
      if (!item.materialId) return;
      const m = byId.get(item.materialId);
      if (!m) return;
      if (m.type !== 'video' && m.type !== 'audio') return;
      ids.add(item.materialId);
    }),
  );
  return ids;
}

function sorted(set: Set<string>): string[] {
  return Array.from(set).sort();
}

beforeEach(() => {
  resetVideoEditingStore();
  // externalUpdateId has no reset helper; start each test from the baseline so
  // the no-loop assertion compares against a known value.
  useVideoEditingStore.setState({ externalUpdateId: null });
});

// ---------------------------------------------------------------------------
// 1. Runtime — the mirror feeds the download trigger without looping
// ---------------------------------------------------------------------------

describe('timeline store mirror — runtime store action', () => {
  it('writes the live timeline into the shared store (arms the download trigger)', () => {
    const ts = makeTimeline([
      makeTrack({ id: 'v', type: 'video', items: [makeItem({ id: 'vi', materialId: 'mv' })] }),
    ]);

    // This is exactly what the mirror effect does:
    //   useEffect(() => setStoreTimelineState(currentTimelineState), [...]);
    useVideoEditingStore.getState().setTimelineState(ts);

    // The store now carries the same timeline the readiness gate sees, so
    // useMaterialManagement derives a non-empty id set (no more 0/N).
    expect(useVideoEditingStore.getState().timelineState).toBe(ts);
    expect(deriveDownloadIds(useVideoEditingStore.getState().timelineState).size).toBe(1);
  });

  it('does not bump externalUpdateId — the mirror cannot form a render loop', () => {
    const before = useVideoEditingStore.getState().externalUpdateId;
    const tsA = makeTimeline([makeTrack({ items: [makeItem({ id: 'a', materialId: 'mv' })] })]);
    const tsB = makeTimeline([makeTrack({ items: [makeItem({ id: 'b', materialId: 'mv2' })] })]);

    useVideoEditingStore.getState().setTimelineState(tsA);
    expect(useVideoEditingStore.getState().timelineState).toBe(tsA);
    expect(useVideoEditingStore.getState().externalUpdateId).toBe(before);

    useVideoEditingStore.getState().setTimelineState(tsB);
    expect(useVideoEditingStore.getState().timelineState).toBe(tsB);
    // setTimelineState only set()s timelineState — it never calls triggerUpdate,
    // so the change-token the panel re-imports on stays put.
    expect(useVideoEditingStore.getState().externalUpdateId).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 2. Invariant — gate media set == download input set (kills "0/N ready")
// ---------------------------------------------------------------------------

describe('timeline store mirror — gate/download invariant', () => {
  it('download id set equals the gate media set for a video+audio timeline', () => {
    const materials = [
      makeMaterial({ id: 'mv1', type: 'video' }),
      makeMaterial({ id: 'mv2', type: 'video' }),
      makeMaterial({ id: 'ma1', type: 'audio' }),
    ];
    const ts = makeTimeline([
      makeTrack({
        id: 'v',
        type: 'video',
        items: [
          makeItem({ id: 'vi1', type: 'video', materialId: 'mv1' }),
          makeItem({ id: 'vi2', type: 'video', materialId: 'mv2' }),
        ],
      }),
      makeTrack({
        id: 'a',
        type: 'audio',
        items: [makeItem({ id: 'ai1', type: 'audio', materialId: 'ma1' })],
      }),
      makeTrack({
        id: 's',
        type: 'subtitle',
        items: [makeItem({ id: 'si1', type: 'subtitle' })], // no materialId
      }),
    ]);

    const download = deriveDownloadIds(ts);
    const gate = deriveGateMediaIds(ts, materials);

    expect(download.size).toBe(3); // not 0 — the download trigger is armed
    expect(sorted(download)).toEqual(sorted(gate)); // the bug-defining invariant
    expect(sorted(gate)).toEqual(['ma1', 'mv1', 'mv2']);
  });

  it('an image dropped on a video track is excluded by the consumer material.type filter (C2)', () => {
    const materials = [
      makeMaterial({ id: 'mv1', type: 'video' }),
      makeMaterial({ id: 'mi1', type: 'image' }),
    ];
    const ts = makeTimeline([
      makeTrack({
        id: 'v',
        type: 'video',
        items: [
          makeItem({ id: 'vi1', type: 'video', materialId: 'mv1' }),
          // image dropped on a video track → item.type === 'video'
          makeItem({ id: 'ii1', type: 'video', materialId: 'mi1' }),
        ],
      }),
    ]);

    const download = deriveDownloadIds(ts);
    const gate = deriveGateMediaIds(ts, materials);
    const effectiveDownloaded = new Set(
      Array.from(download).filter((id) => {
        const m = materials.find((x) => x.id === id);
        return m && (m.type === 'video' || m.type === 'audio');
      }),
    );

    // The image's id DOES enter the raw set (derived by item.type)...
    expect(download.has('mi1')).toBe(true);
    // ...but is excluded once the consumer + gate filter by material.type.
    expect(gate.has('mi1')).toBe(false);
    expect(effectiveDownloaded.has('mi1')).toBe(false);
    expect(sorted(effectiveDownloaded)).toEqual(sorted(gate));
    expect(sorted(gate)).toEqual(['mv1']);
  });
});

// ---------------------------------------------------------------------------
// 3. Production wiring — pin the source so the runtime helpers cannot drift
// ---------------------------------------------------------------------------

const readSrc = (...parts: string[]): string =>
  readFileSync(resolve(__dirname, ...parts), 'utf-8');

describe('timeline store mirror — production wiring (source level)', () => {
  const interfaceSrc = readSrc('..', 'VideoEditingInterface.tsx');
  const materialMgmtSrc = readSrc('..', 'hooks', 'useMaterialManagement.ts');
  // S4 / D10: the readiness gate (computeMediaReadiness) was extracted out of
  // VideoPlayerPanel into the transport hook.
  const transportSrc = readSrc(
    '..',
    'components',
    'VideoPlayerPanel',
    'useCompositionTransport.ts',
  );

  it('VideoEditingInterface selects the store setTimelineState action', () => {
    expect(interfaceSrc).toMatch(
      /const\s+setStoreTimelineState\s*=\s*useVideoEditingStore\(\s*state\s*=>\s*state\.setTimelineState\s*\)/,
    );
  });

  it('VideoEditingInterface mirrors currentTimelineState into the store via an effect', () => {
    // The effect body writes currentTimelineState, depending on both the value
    // and the (stable) action.
    expect(interfaceSrc).toMatch(
      /useEffect\(\s*\(\)\s*=>\s*\{\s*setStoreTimelineState\(currentTimelineState\);\s*\}\s*,\s*\[currentTimelineState,\s*setStoreTimelineState\]\s*\)/,
    );
  });

  it('the mirror effect does not bump any update token (no-loop, R1)', () => {
    const start = interfaceSrc.indexOf('const setStoreTimelineState =');
    expect(start).toBeGreaterThan(-1);
    const end = interfaceSrc.indexOf(
      '[currentTimelineState, setStoreTimelineState]',
      start,
    );
    expect(end).toBeGreaterThan(start);
    const block = interfaceSrc.slice(start, end);
    expect(block).not.toMatch(/triggerUpdate/);
    expect(block).not.toMatch(/setExternalTimelineUpdateId/);
  });

  it('useMaterialManagement derives the download set from store.timelineState by item.type (Option A: hook unchanged)', () => {
    expect(materialMgmtSrc).toMatch(
      /const\s+timelineState\s*=\s*useVideoEditingStore\(\s*state\s*=>\s*state\.timelineState\s*\)/,
    );
    expect(materialMgmtSrc).toMatch(
      /item\.type\s*===\s*'video'\s*\|\|\s*item\.type\s*===\s*'audio'/,
    );
  });

  it('the readiness gate filters by material.type — matching deriveGateMediaIds', () => {
    // S4 / D10: computeMediaReadiness lives in useCompositionTransport now.
    expect(transportSrc).toMatch(
      /m\.type\s*!==\s*'video'\s*&&\s*m\.type\s*!==\s*'audio'/,
    );
  });
});
