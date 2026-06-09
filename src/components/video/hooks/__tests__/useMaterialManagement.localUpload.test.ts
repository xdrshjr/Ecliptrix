/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MaterialItem } from '@/types';
import { createLocalMaterialFromUpload } from '../../lib/localMaterial';

const FILE = resolve(__dirname, '..', 'useMaterialManagement.ts');
const src = readFileSync(FILE, 'utf-8');

describe('useMaterialManagement local upload normalization', () => {
  it('uses createLocalMaterialFromUpload instead of replacing upload ids', () => {
    expect(src).toMatch(/createLocalMaterialFromUpload/);
    expect(src).not.toMatch(/id:\s*`video_\$\{Date\.now\(\)\}_/);
    expect(src).not.toMatch(/id:\s*`\$\{materialType\}_\$\{Date\.now\(\)\}_/);
  });

  it('completed local uploads are direct-local material cards', () => {
    const existing = {
      id: 'upload-1',
      name: 'pending.mp4',
      type: 'video',
      format: 'mp4',
      size: 1,
      url: '',
      createdAt: new Date(),
    } as MaterialItem;
    const file = new File(['x'], 'pending.mp4', { type: 'video/mp4' });
    const result = {
      success: true,
      video_url: '/api/storage/files/video/pending.mp4',
      file_size: 123,
      duration: 4,
      metadata: { storage_key: 'video/pending.mp4' },
    };

    const uploaded = createLocalMaterialFromUpload(existing, file, result);

    expect(uploaded).toEqual(expect.objectContaining({
      id: 'upload-1',
      uploadStatus: 'completed',
      uploadProgress: 100,
      url: '/api/storage/files/video/pending.mp4',
      serverUrl: '/api/storage/files/video/pending.mp4',
      cacheUrl: '/api/storage/files/video/pending.mp4',
      storageKey: 'video/pending.mp4',
    }));
  });
});
