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
