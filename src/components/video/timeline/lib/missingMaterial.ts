/**
 * missingMaterial — which clips have lost their material (N-01).
 *
 * A clip whose material was deleted (and brought back with Ctrl+Z) looked
 * normal on the timeline while the preview skipped it and the export refused
 * it. The predicate uses the export's own rule, so the badge and the export
 * never disagree.
 */

import type { MaterialItem } from '@/types';
import type { TimelineItemData } from '../domain/types';
import { isClipMaterialMissing } from '../../hooks/videoExportItems';

export type MissingMaterialPredicate = (item: TimelineItemData) => boolean;

/**
 * Undefined until the material list has loaded: before that every clip would
 * read as missing.
 */
export function createMissingMaterialPredicate(
  materials: readonly MaterialItem[],
  materialsLoaded: boolean,
): MissingMaterialPredicate | undefined {
  if (!materialsLoaded) return undefined;
  const materialsById = new Map(materials.map((material) => [material.id, material] as const));
  return (item) => isClipMaterialMissing(item, materialsById);
}
