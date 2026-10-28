import type { MaterialItem } from '@/types';

/** `/api/storage/files/` 之后的相对键才是后端认的 `storage_key`。 */
export const MATERIAL_STORAGE_PREFIX = '/api/storage/files/';

/**
 * 只接受「相对键」：非空、≤256 字符、不带盘符/前导 `/`/`..`/scheme。
 *
 * 服务端还会做一次白名单根校验（view_image §4.4、image_to_video §6.2），
 * 这里只是把显然不会通过的输入挡在出口，免得模型为了一个错键反复试错。
 */
export function normalizeStorageKey(raw?: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value || value.length > 256) return undefined;
  if (value.startsWith('/') || value.includes('..')) return undefined;
  if (/^[a-zA-Z]:/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return undefined;
  }
  return value;
}

export function relativeStorageKey(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith(MATERIAL_STORAGE_PREFIX)
    ? raw.slice(MATERIAL_STORAGE_PREFIX.length) : raw;
}

/**
 * 从素材本身反推 `storage_key`：显式字段优先，其次缓存 URL，最后同源 URL。
 * 用户自己上传的素材在后端没有索引表，不做这一步就只剩网图可用。
 */
export function storageKeyForMaterial(
  material: Pick<MaterialItem, 'storageKey' | 'cacheUrl' | 'url'> | undefined,
): string | undefined {
  return normalizeStorageKey(material?.storageKey)
    ?? normalizeStorageKey(relativeStorageKey(material?.cacheUrl))
    ?? normalizeStorageKey(relativeStorageKey(material?.url));
}
