/** Which object the properties page shows (spec §3.7.2 last bullets). */
import { describe, expect, it } from 'vitest';
import { resolveInspectorSelection } from '../inspector/inspectorSelection';

const all = { itemIds: ['i1'], materialId: 'm1', segmentId: 's1' };

describe('resolveInspectorSelection', () => {
  it('static_priority_clips_then_material_then_segment_without_history', () => {
    expect([
      resolveInspectorSelection({ ...all, latest: null }).kind,
      resolveInspectorSelection({ ...all, itemIds: [], latest: null }).kind,
      resolveInspectorSelection({ itemIds: [], materialId: null, segmentId: 's1', latest: null }).kind,
    ]).toEqual(['items', 'material', 'segment']);
  });

  it('most_recent_selection_wins_over_static_priority', () => {
    expect([
      resolveInspectorSelection({ ...all, latest: 'material' }).kind,
      resolveInspectorSelection({ ...all, latest: 'segment' }).kind,
    ]).toEqual(['material', 'segment']);
  });

  it('falls_back_to_priority_when_latest_is_gone', () => {
    const selection = resolveInspectorSelection({ ...all, materialId: null, latest: 'material' });
    expect(selection).toEqual({ kind: 'items', itemIds: ['i1'] });
  });

  it('none_when_nothing_selected', () => {
    const selection = resolveInspectorSelection({
      itemIds: [], materialId: null, segmentId: null, latest: 'items',
    });
    expect(selection).toEqual({ kind: 'none' });
  });
});
