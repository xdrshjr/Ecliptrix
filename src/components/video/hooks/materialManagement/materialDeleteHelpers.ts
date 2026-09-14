import type { MaterialItem } from '@/types';
import type { Translations } from '@/lib/i18n';

function storageKeyOf(material: MaterialItem): string | undefined {
  const key = material.storageKey || material.metadata?.storageKey;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

/**
 * Derive the STORAGE_ROOT-relative source path of a directly-uploaded local
 * material for the spec-06 delete cascade. Only direct uploads carry a
 * removable `storageKey`; cached_materials / remote assets return undefined so
 * the cascade does NOT delete a shared source file.
 *
 * `siblings` are the materials that stay in the library. When one of them
 * owns the same storage key (e.g. a derived material saved before its storage
 * identity was rebuilt), deleting this material must not take the other's file.
 */
export function sourcePathForDelete(
  material: MaterialItem | undefined,
  siblings?: readonly MaterialItem[],
): string | undefined {
  if (!material) return undefined;
  const kind = material.metadata?.storageKind;
  if (kind === 'cached_remote' || kind === 'legacy_remote') return undefined;
  const key = storageKeyOf(material);
  if (!key) return undefined;
  const isShared = siblings?.some((other) => other.id !== material.id && storageKeyOf(other) === key);
  return isShared ? undefined : key;
}

/**
 * Derive extra thumbnail-dir keys to cascade. The backend poster is keyed by
 * the stored-file STEM (basename without extension), which differs from the
 * frontend `materialId` used for filmstrip frames; pass the stem so both
 * thumbnail dirs are cleaned (see spec 06 / TODO 03 key-space note).
 */
export function extraThumbnailKeysForDelete(
  material: MaterialItem | undefined,
  siblings?: readonly MaterialItem[],
): string[] {
  const src = sourcePathForDelete(material, siblings);
  if (!src) return [];
  const base = src.split(/[\\/]/).pop() || '';
  const stem = base.replace(/\.[^.]+$/, '');
  return stem && stem !== material?.id ? [stem] : [];
}

/**
 * Confirmation body for deleting materials. Names the clips that will be
 * removed with them so the consequence is explicit before the user confirms.
 */
export function materialDeleteMessage(
  t: Translations,
  materialNames: readonly string[],
  clipCount: number,
): string {
  const panel = t.materialsPanel;
  const materialCount = String(materialNames.length);
  const firstName = materialNames[0] ?? '';
  const clips = String(clipCount);
  if (clipCount === 0) {
    return materialNames.length === 1
      ? panel.deleteConfirmBody.replace('{name}', () => firstName)
      : panel.deleteConfirmBodyMany.replace('{count}', materialCount);
  }
  return materialNames.length === 1
    ? panel.deleteInUseBody.replace('{name}', () => firstName).replace('{count}', clips)
    : panel.deleteInUseBodyMany.replace('{materialCount}', materialCount).replace('{count}', clips);
}

/** Generate a UUID v4 string, with fallback for non-secure contexts (HTTP). */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback using crypto.getRandomValues
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
