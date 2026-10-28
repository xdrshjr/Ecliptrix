import { describe, expect, it } from 'vitest';
import {
  MATERIAL_STORAGE_PREFIX, normalizeStorageKey, relativeStorageKey, storageKeyForMaterial,
} from '../storageKey';

describe('normalizeStorageKey', () => {
  it('keeps a plain relative key', () => {
    expect(normalizeStorageKey('uploads/images/a.jpg')).toBe('uploads/images/a.jpg');
    expect(normalizeStorageKey('  uploads/a.jpg  ')).toBe('uploads/a.jpg');
  });

  it.each([
    undefined, '', '   ', '/etc/passwd', '../x', 'a/../b', 'C:/x', 'c:\\x',
    'https://example.com/a.jpg', 'file:///a', 'blob:abc', 'data:image/png;base64,AA',
    `a/${'x'.repeat(260)}`,
  ])('rejects %j', raw => {
    expect(normalizeStorageKey(raw as string | undefined)).toBeUndefined();
  });
});

describe('relativeStorageKey', () => {
  it('strips the same-origin storage prefix', () => {
    expect(relativeStorageKey(`${MATERIAL_STORAGE_PREFIX}uploads/a.jpg`)).toBe('uploads/a.jpg');
  });

  it('leaves other values alone', () => {
    expect(relativeStorageKey('uploads/a.jpg')).toBe('uploads/a.jpg');
    expect(relativeStorageKey(undefined)).toBeUndefined();
  });
});

describe('storageKeyForMaterial', () => {
  it('prefers the explicit storageKey, then cacheUrl, then url', () => {
    expect(storageKeyForMaterial({ storageKey: 'k/a.jpg', cacheUrl: '/api/storage/files/c/b.jpg', url: '/api/storage/files/u/c.jpg' }))
      .toBe('k/a.jpg');
    expect(storageKeyForMaterial({ cacheUrl: '/api/storage/files/c/b.jpg', url: '/api/storage/files/u/c.jpg' }))
      .toBe('c/b.jpg');
    expect(storageKeyForMaterial({ url: '/api/storage/files/u/c.jpg' })).toBe('u/c.jpg');
  });

  it('has no key for a remote or inline url', () => {
    expect(storageKeyForMaterial({ url: 'https://example.com/a.jpg' })).toBeUndefined();
    expect(storageKeyForMaterial({ url: 'blob:http://localhost/x' })).toBeUndefined();
    expect(storageKeyForMaterial(undefined)).toBeUndefined();
  });
});
