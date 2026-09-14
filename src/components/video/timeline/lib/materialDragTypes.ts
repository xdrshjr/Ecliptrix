/**
 * materialDragTypes — carries a dragged material's type in the DataTransfer
 * type list.
 *
 * During `dragenter` / `dragover` browsers expose `DataTransfer.types` but
 * return an empty string from `getData`, so a track cannot know what is being
 * dragged over it from the JSON payload. The materials panel therefore adds a
 * second entry whose MIME type encodes the material type.
 */

import type { MaterialItem } from '@/types';

export const MATERIAL_DRAG_MIME_PREFIX = 'application/x-ecliptrix-material-';

// Every type `isTrackCompatibleWithMaterial` can place; subtitle (SRT)
// materials land on subtitle lanes just like "add to timeline" puts them there.
const PLACEABLE_MATERIAL_TYPES: ReadonlySet<string> = new Set(['video', 'audio', 'image', 'subtitle']);

/** Material type announced by the drag, or null when the drag is not a placeable material. */
export function readDraggedMaterialType(types: readonly string[]): MaterialItem['type'] | null {
  for (const type of types) {
    // Browsers lower-case DataTransfer types; the prefix and material types are lower-case already.
    const normalized = type.toLowerCase();
    if (!normalized.startsWith(MATERIAL_DRAG_MIME_PREFIX)) continue;
    const materialType = normalized.slice(MATERIAL_DRAG_MIME_PREFIX.length);
    if (PLACEABLE_MATERIAL_TYPES.has(materialType)) return materialType as MaterialItem['type'];
  }
  return null;
}
