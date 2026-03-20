/**
 * Test Utility — createTestMaterial
 *
 * Factory for creating test MaterialData instances.
 *
 * Usage:
 *   const videoMaterial = createTestMaterial('video');
 *   const audioMaterial = createTestMaterial('audio', { name: 'My Audio' });
 *   const materials = createTestMaterialSet();
 */

import type { MaterialData, MaterialType } from '../../domain/types';

// ---------------------------------------------------------------------------
// Defaults per material type
// ---------------------------------------------------------------------------

const materialDefaults: Record<string, Partial<MaterialData>> = {
  video: {
    name: 'Test Video Material',
    duration: 10,
    thumbnailUrl: 'https://example.com/video-thumb.jpg',
    url: 'https://example.com/video.mp4',
  },
  audio: {
    name: 'Test Audio Material',
    duration: 15,
    url: 'https://example.com/audio.mp3',
  },
  image: {
    name: 'Test Image Material',
    url: 'https://example.com/image.jpg',
    thumbnailUrl: 'https://example.com/image-thumb.jpg',
  },
  tts: {
    name: 'Test TTS Material',
    duration: 5,
    url: 'https://example.com/tts.mp3',
  },
};

// ---------------------------------------------------------------------------
// Counter for unique IDs
// ---------------------------------------------------------------------------

let idCounter = 0;

/**
 * Reset the ID counter. Call between tests for deterministic IDs.
 */
export function resetMaterialIdCounter(): void {
  idCounter = 0;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a single test MaterialData.
 *
 * @param type - Material type ('video', 'audio', 'image', 'tts')
 * @param overrides - Partial overrides for specific fields
 * @returns A MaterialData instance
 */
export function createTestMaterial(
  type: MaterialType,
  overrides?: Partial<MaterialData>
): MaterialData {
  idCounter++;
  const defaults = materialDefaults[type] || {};

  return {
    id: `test-material-${type}-${idCounter}`,
    name: defaults.name || `Test ${type} Material`,
    type,
    duration: defaults.duration,
    thumbnailUrl: defaults.thumbnailUrl,
    url: defaults.url,
    ...overrides,
  };
}

/**
 * Create a complete set of test materials matching the default test timeline.
 * Returns materials that correspond to the IDs used in createTestTimeline().
 */
export function createTestMaterialSet(): MaterialData[] {
  return [
    {
      id: 'test-material-video-1',
      name: 'Test Video 1',
      type: 'video',
      duration: 10,
      thumbnailUrl: 'https://example.com/thumb1.jpg',
      url: 'https://example.com/video1.mp4',
    },
    {
      id: 'test-material-video-2',
      name: 'Test Video 2',
      type: 'video',
      duration: 8,
      thumbnailUrl: 'https://example.com/thumb2.jpg',
      url: 'https://example.com/video2.mp4',
    },
    {
      id: 'test-material-audio-1',
      name: 'Test Audio 1',
      type: 'audio',
      duration: 15,
      url: 'https://example.com/audio1.mp3',
    },
  ];
}
