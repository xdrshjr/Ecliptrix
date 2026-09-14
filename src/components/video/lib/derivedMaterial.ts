/**
 * derivedMaterial — storage identity for materials produced from another one
 * (silence removal, watermark removal, video clips).
 *
 * A derived material used to be built as `{ ...original, url: processed }`,
 * which kept the original's `cacheUrl` / `storageKey` /
 * `metadata.localResolvedUrl`. Playback resolution prefers those local
 * references, so the "new" material previewed and exported the ORIGINAL file,
 * and deleting it deleted the original's source file. Derived materials
 * therefore inherit presentation and business metadata only; every storage
 * field is rebuilt from the processed file.
 */

import type { MaterialItem } from '@/types';
import { isLocalMediaReference, stripLocalOrigin } from './selectPlaybackUrl';

export interface DerivedFileRef {
  url: string;
  thumbnailUrl?: string;
  duration?: number;
}

export interface DerivedIdentity {
  id: string;
  name: string;
  metadata: NonNullable<MaterialItem['metadata']>;
}

type MaterialMetadata = NonNullable<MaterialItem['metadata']>;

/** Top-level storage / cache / proxy fields: never inherited by a derived material. */
const STORAGE_FIELDS = [
  'cacheStatus', 'cacheUrl', 'storageKey', 'cacheError',
  'previewProxyStatus', 'previewProxyProfile', 'previewProxyLocalUrl', 'previewProxyProgress', 'proxyStatus',
  'localProxyStatus', 'localProxyUrl', 'localProxyProgress', 'localProxyError', 'localProxyBytes',
] as const;

/** Storage-identity fields inside `metadata`: never inherited either. */
const STORAGE_METADATA_FIELDS = [
  'storageKind', 'storageKey', 'localResolvedUrl', 'originalUrl', 'storageMetadata', 'isLocalFile', 'thumbnailSource',
] as const;

const DERIVED_FLAGS = ['isSilenceRemoved', 'isClip', 'isWatermarkRemoved'] as const;

const STORAGE_FILES_PREFIX = '/api/storage/files/';
const CACHED_MATERIALS_KEY_PREFIX = 'cached_materials/';
const CACHED_MATERIALS_PATH = `${STORAGE_FILES_PREFIX}${CACHED_MATERIALS_KEY_PREFIX}`;

function decodeStorageKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey);
  } catch {
    // A malformed escape keeps the literal key: the backend then finds no such
    // file, which is safe, instead of resolving to a different file.
    return rawKey;
  }
}

/**
 * `/api/storage/files/<key>` (a same-origin / loopback absolute prefix is
 * allowed) → `<key>`. `cached_materials/` references are shared caches, not a
 * material's own upload, and non-local URLs have no key: both → undefined.
 */
export function storageKeyFromLocalUrl(url: string): string | undefined {
  const path = stripLocalOrigin(url);
  if (!path.startsWith(STORAGE_FILES_PREFIX)) return undefined;
  const rawKey = path.slice(STORAGE_FILES_PREFIX.length).split(/[?#]/)[0];
  const key = decodeStorageKey(rawKey);
  if (!key || key.startsWith(CACHED_MATERIALS_KEY_PREFIX)) return undefined;
  return key;
}

function omitKeys(source: object, keys: readonly string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}

function composeDerivedMaterial(
  base: MaterialItem,
  file: DerivedFileRef,
  identity: DerivedIdentity,
  createdAt: MaterialItem['createdAt'],
  derivedFrom: string | undefined,
): MaterialItem {
  const metadata = omitKeys(identity.metadata, STORAGE_METADATA_FIELDS) as MaterialMetadata;
  const material = {
    ...omitKeys(base, STORAGE_FIELDS),
    id: identity.id,
    name: identity.name,
    url: file.url,
    serverUrl: file.url,
    createdAt,
    metadata,
  } as MaterialItem;

  if (file.duration !== undefined) material.duration = file.duration;
  if (file.thumbnailUrl) material.thumbnailUrl = file.thumbnailUrl;
  if (isLocalMediaReference(file.url)) {
    material.cacheUrl = file.url;
    metadata.localResolvedUrl = file.url;
    metadata.storageKind = 'local';
  }
  const storageKey = storageKeyFromLocalUrl(file.url);
  if (storageKey) {
    material.storageKey = storageKey;
    metadata.storageKey = storageKey;
  }
  if (derivedFrom) metadata.derivedFrom = derivedFrom;
  return material;
}

export function buildDerivedMaterial(
  original: MaterialItem,
  file: DerivedFileRef,
  identity: DerivedIdentity,
): MaterialItem {
  return composeDerivedMaterial(original, file, identity, new Date(), original.id);
}

/** `metadata.isSilenceRemoved / isClip / isWatermarkRemoved` is true. */
export function isDerivedMaterial(material: MaterialItem): boolean {
  const metadata = material.metadata;
  return !!metadata && DERIVED_FLAGS.some((flag) => metadata[flag] === true);
}

function pointsAtAnotherLocalFile(material: MaterialItem): boolean {
  const localRef = material.metadata?.localResolvedUrl ?? material.cacheUrl;
  if (typeof localRef !== 'string' || localRef === '') return false;
  const localPath = stripLocalOrigin(localRef);
  if (localPath === stripLocalOrigin(material.url)) return false;
  // A remote processing result later cached under cached_materials/ is the
  // material's own legitimate cache, not the original's file (RV-11).
  return !localPath.startsWith(CACHED_MATERIALS_PATH);
}

function carriesAnotherStorageKey(material: MaterialItem): boolean {
  const savedKey = material.storageKey ?? material.metadata?.storageKey;
  if (typeof savedKey !== 'string' || savedKey === '') return false;
  if (savedKey.startsWith(CACHED_MATERIALS_KEY_PREFIX)) return false;
  // Clips spread the original's metadata and so kept its storageKey even when
  // their own url / localResolvedUrl were correct; delete then removed the original.
  return savedKey !== storageKeyFromLocalUrl(material.url);
}

function needsIdentityRepair(material: MaterialItem): boolean {
  if (!isDerivedMaterial(material) || !material.url) return false;
  return pointsAtAnotherLocalFile(material) || carriesAnotherStorageKey(material);
}

/**
 * Metadata a script match or TTS writes to tie a material to a script segment.
 * A clip or a silence-removed copy is a new material and must not inherit it:
 * the auto-mix planner would treat the copy as the segment's newest match
 * (N-13). Watermark removal replaces the material under the same id and keeps it.
 */
export const SCRIPT_SEGMENT_METADATA_FIELDS = [
  'segment_id', 'segment_number', 'segment_title', 'segment_assigned_at', 'video_index_in_segment', 'segment_text_hash',
] as const;

/** A copy of `metadata` without the script segment fields. */
export function withoutScriptSegment(metadata: MaterialMetadata | undefined): MaterialMetadata {
  return omitKeys(metadata ?? {}, SCRIPT_SEGMENT_METADATA_FIELDS) as MaterialMetadata;
}

function hasFiniteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a clip / silence-removed copy still carries the membership its
 * original had when it was made. A match written after the copy existed is
 * stamped later than the copy's createdAt and is kept. Without a usable stamp
 * or createdAt, the membership is inherited when the original has the same segment.
 */
function inheritedSegmentMembership(
  material: MaterialItem,
  byId: ReadonlyMap<string, MaterialItem>,
): boolean {
  const metadata = material.metadata;
  if (!metadata || (metadata.isClip !== true && metadata.isSilenceRemoved !== true)) return false;
  const segmentId: unknown = metadata.segment_id;
  if (typeof segmentId !== 'string' || segmentId === '') return false;
  const stamp: unknown = metadata.segment_assigned_at;
  // createdAt is typed Date but persisted materials come back as ISO strings.
  const createdAt = new Date(material.createdAt).getTime();
  if (hasFiniteTime(stamp) && Number.isFinite(createdAt)) return stamp < createdAt;
  const originalId: unknown = metadata.originalMaterialId;
  const original = typeof originalId === 'string' ? byId.get(originalId) : undefined;
  return original?.metadata?.segment_id === segmentId;
}

/**
 * Strip script segment membership that clips and silence-removed copies saved
 * before N-13 inherited from their original. Idempotent; untouched materials
 * keep their reference.
 */
export function repairInheritedSegmentMembership(
  materials: readonly MaterialItem[],
): { materials: MaterialItem[]; repairedIds: string[] } {
  const byId = new Map(materials.map((material) => [material.id, material] as const));
  const repairedIds: string[] = [];
  const repaired = materials.map((material) => {
    if (!inheritedSegmentMembership(material, byId)) return material;
    repairedIds.push(material.id);
    return { ...material, metadata: withoutScriptSegment(material.metadata) };
  });
  return { materials: repaired, repairedIds };
}

/**
 * Repair derived materials saved before identity rebuilding existed: any
 * derived material whose local reference or storage key points at a file
 * other than its own `url` gets its storage identity rebuilt from `url`.
 * Idempotent; non-derived materials are returned untouched (same reference).
 */
export function repairDerivedMaterialIdentity(
  materials: readonly MaterialItem[],
): { materials: MaterialItem[]; repairedIds: string[] } {
  const repairedIds: string[] = [];
  const repaired = materials.map((material) => {
    if (!needsIdentityRepair(material)) return material;
    repairedIds.push(material.id);
    const derivedFrom = material.metadata?.derivedFrom;
    return composeDerivedMaterial(
      material,
      { url: material.url },
      { id: material.id, name: material.name, metadata: material.metadata ?? {} },
      material.createdAt,
      typeof derivedFrom === 'string' ? derivedFrom : undefined,
    );
  });
  return { materials: repaired, repairedIds };
}
