import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem, ScriptSegment } from '@/types';
import { getTranslations } from '@/lib/i18n';
import { useTimelineStore } from '../../timeline/store';
import type { TimelineData } from '../../timeline/domain';
import type { SegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import {
  baseTracks, MATERIALS, SEGMENTS, voice,
} from '../../lib/segments/__tests__/segmentFixtures';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => ({ showSuccess: notify.success, showError: notify.error, showWarning: notify.warning }),
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ locale: 'zh-CN', t: getTranslations('zh-CN') }),
}));

import { useSegmentCommands } from '../useSegmentCommands';

const get = () => useTimelineStore.getState();

function timeline(): TimelineData {
  return {
    currentTime: 0, totalDuration: 19, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0, tracks: baseTracks(),
  };
}

const links = {
  segmentIndex: new Map(SEGMENTS.map((s, i) => [s.id, {
    segmentId: s.id, ordinal: i + 1, title: s.title, badge: `0${i + 1}`, label: s.title,
  }])),
  statusById: new Map(),
  latestVoiceById: new Map(),
  segmentRanges: new Map(),
} as unknown as SegmentLinksValue;

function setup(materials: MaterialItem[] = MATERIALS) {
  const script = { current: SEGMENTS.map((s) => ({ ...s })) as ScriptSegment[] };
  const hook = renderHook(() => useSegmentCommands({
    getSegments: () => script.current,
    commitSegments: (next) => { script.current = next; },
    getMaterials: () => materials,
    addMaterial: vi.fn(),
    getLinks: () => links,
    getDefaultVoiceId: () => 'voice-default',
  }));
  return { hook, script };
}

const ids = (segments: ScriptSegment[]) => segments.map((s) => s.id);
const clipIds = () => get().tracks.flatMap((t) => t.items.map((i) => i.id));

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline());
  get().clearHistory();
});

afterEach(() => get().setExternalEditLock(null));

describe('useSegmentCommands', () => {
  it('delete with clips, edit another segment, Ctrl+Z: segment and clips return, the edit stays', () => {
    const { hook, script } = setup();
    act(() => hook.result.current.remove('s2', { removeTimelineItems: true }));
    const afterDelete = { script: ids(script.current), hasA2: clipIds().includes('a2') };
    script.current = script.current.map((s) => (s.id === 's1' ? { ...s, narrationText: 'typed later' } : s));
    act(() => get().undo());
    expect({
      afterDelete,
      afterUndo: ids(script.current),
      edit: script.current[0].narrationText,
      clipsBack: ['a2', 'c2', 't2', 't3'].every((id) => clipIds().includes(id)),
    }).toEqual({
      afterDelete: { script: ['s1', 's3'], hasA2: false },
      afterUndo: ['s1', 's2', 's3'],
      edit: 'typed later',
      clipsBack: true,
    });
  });

  it('under the agent lock, deleting only the narration works without a history entry (RV2-07)', () => {
    const { hook, script } = setup();
    get().setExternalEditLock('agent');
    act(() => hook.result.current.remove('s2', { removeTimelineItems: false }));
    expect({ script: ids(script.current), canUndo: get().canUndo }).toEqual({ script: ['s1', 's3'], canUndo: false });
  });

  it('a tiny voice change applies directly as one undoable step', () => {
    const candidate = voice('v2b', SEGMENTS[1], 8.02, 5);
    const { hook, script } = setup([...MATERIALS, candidate]);
    act(() => hook.result.current.applyVoice('s2', 'v2b'));
    const applied = script.current[1].appliedVoiceMaterialId;
    act(() => get().undo());
    expect({ applied, dialog: hook.result.current.dialog.kind, undone: script.current[1].appliedVoiceMaterialId })
      .toEqual({ applied: 'v2b', dialog: 'none', undone: undefined });
  });

  it('a longer voice opens the duration dialog; "adjust" applies it', () => {
    const candidate = voice('v2b', SEGMENTS[1], 10, 5);
    const { hook } = setup([...MATERIALS, candidate]);
    act(() => hook.result.current.applyVoice('s2', 'v2b'));
    const kind = hook.result.current.dialog.kind;
    act(() => hook.result.current.chooseVoiceDuration('adjust'));
    const a3 = get().tracks.find((t) => t.id === 'audio-track-1')?.items.find((i) => i.id === 'a3');
    expect({ kind, a3Start: a3?.startTime }).toEqual({ kind: 'voice-duration', a3Start: 15 });
  });

  it('reordering segments that are not on the timeline needs no dialog and is undoable', () => {
    get().initTimeline({ ...timeline(), tracks: [] });
    get().clearHistory();
    const { hook, script } = setup();
    act(() => hook.result.current.move('s3', 0));
    const moved = ids(script.current);
    act(() => get().undo());
    expect({ moved, dialog: hook.result.current.dialog.kind, undone: ids(script.current) })
      .toEqual({ moved: ['s3', 's1', 's2'], dialog: 'none', undone: ['s1', 's2', 's3'] });
  });
});
