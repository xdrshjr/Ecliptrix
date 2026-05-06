'use client';

import type { CoverAspectRatio } from '../types';

/**
 * Map a cover aspect ratio to the export pixel size (1080-px short side).
 *
 *   16:9  → 1920 × 1080
 *   9:16  → 1080 × 1920
 *   1:1   → 1080 × 1080
 *   4:3   → 1440 × 1080
 *   21:9  → 2520 × 1080
 *
 * Sizes match the table in spec §2.2.E and §G7. The 720p fallback is the
 * caller's responsibility (``useCoverRender`` retries at half-resolution
 * on render error).
 */
export function aspectRatioToSize(
  ratio: CoverAspectRatio,
): { width: number; height: number } {
  switch (ratio) {
    case '16:9':
      return { width: 1920, height: 1080 };
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:3':
      return { width: 1440, height: 1080 };
    case '21:9':
      return { width: 2520, height: 1080 };
    default: {
      // Exhaustiveness guard — TypeScript flags any new ratio not handled above.
      const _exhaustive: never = ratio;
      void _exhaustive;
      return { width: 1920, height: 1080 };
    }
  }
}
