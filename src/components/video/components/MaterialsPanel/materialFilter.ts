/**
 * materialFilter — pure category / search logic of the materials page
 * (spec §3.7.1, §5.4).
 *
 * The page shows five primary categories (全部 / 视频 / 音频 / 图片 / 素材包)
 * plus a pack sub-filter, but the source of truth is still the ORIGINAL
 * `selectedMaterialType` owned by `useMaterialManagement`. The helpers here
 * translate between the two so the old filter values keep flowing unchanged.
 */

import type { MaterialItem, MaterialType } from '@/types';

export type PrimaryMaterialFilter = 'all' | 'video' | 'audio' | 'image' | 'packs';
export type PackMaterialFilter =
  | 'storyboard_pack'
  | 'character_pack'
  | 'scene_pack'
  | 'frame_pack';

export interface MaterialFilterState {
  primary: PrimaryMaterialFilter;
  pack: PackMaterialFilter;
  query: string;
}

export const PRIMARY_MATERIAL_FILTERS: readonly PrimaryMaterialFilter[] = [
  'all', 'video', 'audio', 'image', 'packs',
];

export const PACK_MATERIAL_FILTERS: readonly PackMaterialFilter[] = [
  'storyboard_pack', 'character_pack', 'scene_pack', 'frame_pack',
];

export const DEFAULT_PACK_FILTER: PackMaterialFilter = 'storyboard_pack';

export function isPackMaterialFilter(value: string): value is PackMaterialFilter {
  return (PACK_MATERIAL_FILTERS as readonly string[]).includes(value);
}

/** Primary/pack pair → the original filter value `handleMaterialTypeFilter` takes. */
export function toMaterialTypeFilter(
  primary: PrimaryMaterialFilter,
  pack: PackMaterialFilter,
): MaterialType | 'all' {
  return primary === 'packs' ? pack : primary;
}

/** Original filter value → the primary category that shows it. */
export function toPrimaryMaterialFilter(type: MaterialType | 'all'): PrimaryMaterialFilter {
  if (isPackMaterialFilter(type)) return 'packs';
  if (type === 'video' || type === 'audio' || type === 'image') return type;
  // 'all' and 'subtitle' (no dedicated tab) both live under 全部.
  return 'all';
}

export function normalizeMaterialQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Case-insensitive substring match over any of `texts`; empty query matches. */
export function matchesMaterialQuery(
  texts: ReadonlyArray<string | null | undefined>,
  query: string,
): boolean {
  const needle = normalizeMaterialQuery(query);
  if (!needle) return true;
  return texts.some((text) => typeof text === 'string'
    && text.toLowerCase().includes(needle));
}

function originalFileName(material: MaterialItem): string | undefined {
  const value: unknown = material.metadata?.original_filename;
  return typeof value === 'string' ? value : undefined;
}

function matchesCategory(material: MaterialItem, f: MaterialFilterState): boolean {
  // storyboard_pack-typed materials are always drawn by StoryboardPackCard,
  // never as a plain material card (unchanged from the pre-workbench grid).
  if (material.type === 'storyboard_pack') return false;
  if (f.primary === 'all') return true;
  if (f.primary === 'packs') return material.type === f.pack;
  return material.type === f.primary;
}

/**
 * Materials visible in the current category, narrowed by the search query
 * (name + `metadata.original_filename`). Pack entities are filtered by the
 * panel itself; this only covers `MaterialItem`s.
 */
export function filterMaterials(
  list: MaterialItem[],
  f: MaterialFilterState,
): MaterialItem[] {
  return list.filter((material) => matchesCategory(material, f)
    && matchesMaterialQuery([material.name, originalFileName(material)], f.query));
}

/** Audio and subtitle materials render as compact rows, the rest as cards. */
export function isListRowMaterial(material: MaterialItem): boolean {
  return material.type === 'audio' || material.type === 'subtitle';
}
