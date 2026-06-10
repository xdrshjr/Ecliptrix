/**
 * Integration-boundary contract test for the dual `SubtitleSequenceItem`
 * declaration (added by google-tester-01, TODO 02 S1 acceptance).
 *
 * `SubtitleSequenceItem` is declared TWICE — once in the domain ports
 * (`timeline/domain/ports.ts`, consumed by `CompositionAdapter`) and once in
 * the view-layer types (`types/videoEditingTypes.ts`, consumed by
 * `useTimelineComposition` + `SubtitleLayer`). The hook bridges them with an
 * `as unknown as` cast, which would SILENTLY hide structural drift between the
 * two. The reviewer flagged this as a "keep them in lockstep" risk.
 *
 * This test fails to COMPILE (type-check) if either declaration drifts — a
 * struct-to-struct round-trip assignment is the cheapest tripwire — and asserts
 * at runtime that a value produced by the adapter flows through unchanged.
 */

import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import type { SubtitleSequenceItem as PortsSubtitle } from '../../domain/ports';
import type { SubtitleSequenceItem as ViewSubtitle } from '../../../types/videoEditingTypes';
import type { TrackData, TimelineItemData } from '../../domain/types';
import type { SubtitleStyle } from '@/types';

const STYLE: SubtitleStyle = {
  fontFamily: 'sans-serif',
  fontSize: 28,
  fontColor: '#ffffff',
  backgroundColor: '#000000',
  position: 'bottom',
};

function subtitleTrack(items: TimelineItemData[]): TrackData {
  return {
    id: 'st1', name: 'S1', type: 'subtitle', isVisible: true, isLocked: false,
    isMuted: false, volume: 100, height: 40, order: 1, items,
  };
}

describe('SubtitleSequenceItem ports↔view structural contract', () => {
  it('a ports value is assignable to the view shape and back (compile-time lockstep guard)', () => {
    const fromPorts: PortsSubtitle = {
      id: 's1', text: 'hello', startTime: 0, duration: 2, trackId: 't', style: STYLE,
    };
    // These two assignments only compile while the two declarations remain
    // structurally identical. If a field is added/renamed on one but not the
    // other, `tsc --noEmit` goes red here — the silent `as unknown as` in the
    // hook can no longer mask the drift.
    const asView: ViewSubtitle = fromPorts;
    const backToPorts: PortsSubtitle = asView;
    expect(backToPorts).toEqual(fromPorts);
  });

  it('the adapter output (ports shape) is consumable as the view shape with no field loss', () => {
    const adapter = new CompositionAdapter();
    const track = subtitleTrack([
      { id: 'sub-1', name: 'cap', type: 'subtitle', startTime: 1, duration: 3,
        trackId: 'st1', color: '#000', text: 'caption', subtitleStyle: STYLE },
    ]);
    const portsResult: PortsSubtitle[] = adapter.extractSubtitleSequences([track]);
    // The exact bridge the hook performs, but TYPED (no `as unknown as`): if the
    // shapes diverge this stops compiling.
    const viewResult: ViewSubtitle[] = portsResult;

    expect(viewResult).toHaveLength(1);
    expect(viewResult[0]).toEqual({
      id: 'sub-1', text: 'caption', startTime: 1, duration: 3, trackId: 'st1', style: STYLE,
    });
  });
});
