import type { MaterialItem, MaterialType } from '@/types';
import { isLocalMediaReference } from './selectPlaybackUrl';

const CACHED_MATERIALS_PATH = '/api/storage/files/cached_materials/';
const DIRECT_UPLOAD_PREFIXES = [
  '/api/storage/files/video/',
  '/api/storage/files/audio/',
  '/api/storage/files/images/',
  '/api/storage/files/image/',
];

interface StorageUploadResult {
  success?: boolean;
  video_url?: string;
  file_url?: string;
  thumbnail_url?: string;
  file_size?: number;
  duration?: number;
  width?: number;
  height?: number;
  file_path?: string;
  metadata?: {
    storage_key?: string;
    path?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function normalizePath(value: string | null | undefined): string {
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function isCachedRemoteStoragePath(value: string | null | undefined): boolean {
  return normalizePath(value).startsWith(CACHED_MATERIALS_PATH);
}

function isDirectUploadStoragePath(value: string | null | undefined): boolean {
  const path = normalizePath(value);
  if (!path || isCachedRemoteStoragePath(path)) return false;
  return DIRECT_UPLOAD_PREFIXES.some(prefix => path.startsWith(prefix));
}

function hasDirectLocalPlaybackUrl(material: MaterialItem): boolean {
  const metadata = material.metadata;
  return [
    metadata?.localResolvedUrl,
    material.url,
    material.serverUrl,
    material.cacheUrl,
  ].some(
    candidate => isDirectUploadStoragePath(candidate),
  );
}

export function isDirectLocalMaterial(
  material: MaterialItem | null | undefined,
): boolean {
  if (!material) return false;
  const metadata = material.metadata;

  if (metadata?.storageKind === 'cached_remote') return false;
  if (metadata?.storageKind === 'legacy_remote') return false;

  if (metadata?.storageKind === 'local') return true;
  if (metadata?.isLocalFile === true) return true;
  if (isDirectUploadStoragePath(metadata?.localResolvedUrl)) return true;
  if (material.storageKey && hasDirectLocalPlaybackUrl(material)) return true;
  return false;
}

export function canPreviewDirectLocalMaterial(
  material: MaterialItem | null | undefined,
): boolean {
  if (!material || !isDirectLocalMaterial(material)) return false;
  return hasDirectLocalPlaybackUrl(material);
}

function materialTypeForFile(file: File): MaterialType {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'image';
}

function localUrlFromUpload(result: StorageUploadResult): string {
  return result.video_url || result.file_url || '';
}

function storageKeyFromUpload(result: StorageUploadResult): string | undefined {
  return result.metadata?.storage_key || result.metadata?.path || result.file_path;
}

export function createLocalMaterialFromUpload(
  existingMaterial: MaterialItem,
  file: File,
  result: StorageUploadResult,
): MaterialItem {
  const materialType = materialTypeForFile(file);
  const localUrl = localUrlFromUpload(result);
  if (!localUrl) {
    throw new Error('Upload response missing local storage URL');
  }
  if (!isDirectUploadStoragePath(localUrl)) {
    throw new Error(`Upload response is not a direct local storage URL: ${localUrl}`);
  }
  const storageKey = storageKeyFromUpload(result);
  const format = file.name.split('.').pop() || existingMaterial.format || '';
  const thumbnailUrl =
    materialType === 'image'
      ? localUrl
      : result.thumbnail_url || existingMaterial.thumbnailUrl;

  return {
    ...existingMaterial,
    id: existingMaterial.id,
    name: file.name,
    type: materialType,
    format,
    size: result.file_size ?? file.size,
    duration: result.duration,
    width: result.width,
    height: result.height,
    thumbnailUrl: thumbnailUrl || undefined,
    url: localUrl,
    serverUrl: localUrl,
    cacheUrl: localUrl,
    storageKey,
    uploadStatus: 'completed',
    uploadProgress: 100,
    metadata: {
      ...existingMaterial.metadata,
      storageKind: 'local',
      storageKey,
      localResolvedUrl: localUrl,
      originalUrl: localUrl,
      fileName: file.name,
      isLocalFile: true,
      storageMetadata: result.metadata,
    },
  };
}

export function isLocalStorageReference(value: string | null | undefined): boolean {
  return isLocalMediaReference(value) && !isCachedRemoteStoragePath(value);
}
