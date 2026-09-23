import { describe, expect, it } from 'vitest';
import type { MaterialItem, MaterialType } from '@/types';
import {
  filterMaterials,
  isListRowMaterial,
  matchesMaterialQuery,
  toMaterialTypeFilter,
  toPrimaryMaterialFilter,
  type MaterialFilterState,
} from '../materialFilter';

function material(id: string, type: MaterialType, name: string, extra: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id, type, name, format: 'mp4', size: 0, url: `/api/storage/files/${id}`,
    createdAt: new Date(0), ...extra,
  };
}

const LIBRARY: MaterialItem[] = [
  material('v1', 'video', 'Beach Sunset.mp4'),
  material('v2', 'video', 'clip_002.mp4', { metadata: { original_filename: 'Mountain SUNRISE.mov' } }),
  material('a1', 'audio', 'sunset narration.mp3'),
  material('i1', 'image', 'cover.png'),
  material('s1', 'subtitle', 'captions.srt'),
  material('c1', 'character_pack', 'hero pack'),
  material('sb1', 'storyboard_pack', 'storyboard sunset'),
];

const state = (partial: Partial<MaterialFilterState>): MaterialFilterState => ({
  primary: 'all', pack: 'storyboard_pack', query: '', ...partial,
});

const ids = (list: MaterialItem[]) => list.map((m) => m.id);

describe('filterMaterials', () => {
  it('packs_primary_filters_by_pack_subtype', () => {
    expect(ids(filterMaterials(LIBRARY, state({ primary: 'packs', pack: 'character_pack' }))))
      .toEqual(['c1']);
    // storyboard_pack items are always drawn by StoryboardPackCard, never as cards.
    expect(filterMaterials(LIBRARY, state({ primary: 'packs', pack: 'storyboard_pack' })))
      .toEqual([]);
  });

  it('query_matches_name_case_insensitively', () => {
    expect(ids(filterMaterials(LIBRARY, state({ query: 'SUNSET' })))).toEqual(['v1', 'a1']);
    expect(ids(filterMaterials(LIBRARY, state({ query: '  sunrise ' })))).toEqual(['v2']);
  });

  it('query_is_scoped_to_current_category', () => {
    expect(ids(filterMaterials(LIBRARY, state({ primary: 'video', query: 'sunset' }))))
      .toEqual(['v1']);
    expect(filterMaterials(LIBRARY, state({ primary: 'image', query: 'sunset' }))).toEqual([]);
  });

  it('all_keeps_subtitles_and_drops_storyboard_pack_items', () => {
    const all = ids(filterMaterials(LIBRARY, state({ primary: 'all' })));
    expect(all).toContain('s1');
    expect(all).not.toContain('sb1');
  });
});

describe('category mapping', () => {
  it('round_trips_primary_and_pack_through_original_filter_values', () => {
    expect(toMaterialTypeFilter('packs', 'frame_pack')).toBe('frame_pack');
    expect(toMaterialTypeFilter('audio', 'frame_pack')).toBe('audio');
    expect(toPrimaryMaterialFilter('scene_pack')).toBe('packs');
    expect(toPrimaryMaterialFilter('image')).toBe('image');
    expect(toPrimaryMaterialFilter('subtitle')).toBe('all');
  });

  it('empty_query_matches_everything', () => {
    expect(matchesMaterialQuery([undefined], '   ')).toBe(true);
    expect(matchesMaterialQuery([null, undefined], 'x')).toBe(false);
  });

  it('audio_and_subtitle_render_as_rows', () => {
    expect(LIBRARY.filter(isListRowMaterial).map((m) => m.id)).toEqual(['a1', 's1']);
  });
});
