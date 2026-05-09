import type { MaterialItem } from '@/types';
import localAudioManager from './localAudioManager';

const isBlobUrl = (u?: string | null): u is string =>
  typeof u === 'string' && u.startsWith('blob:');

/**
 * Resolve a stable playback URL for an audio MaterialItem.
 *
 * Order:
 *   1. Same-session local blob (LocalAudioManager) — zero-latency.
 *   2. Server-stable URL (`serverUrl` or `metadata.originalUrl`).
 *   3. `material.url`, only if it is not a blob: URL (which dies on reload).
 *
 * Reads BOTH `metadata.fileName` and `metadata.server_file_name` so that
 * historical workflow_data (which only persisted `server_file_name`) keeps
 * working after the iter5 fix.
 */
export function selectAudioPlaybackUrl(material: MaterialItem): string | null {
  if (typeof window !== 'undefined') {
    const fileName =
      (material.metadata?.fileName as string | undefined) ??
      (material.metadata?.server_file_name as string | undefined) ??
      null;
    if (fileName) {
      const local = localAudioManager.getAudioFileUrl(fileName);
      if (local) return local;
    }
  }

  if (material.serverUrl) return material.serverUrl;

  const originalUrl = material.metadata?.originalUrl as string | undefined;
  if (originalUrl) return originalUrl;

  if (!isBlobUrl(material.url)) return material.url ?? null;
  return null;
}

export default selectAudioPlaybackUrl;
