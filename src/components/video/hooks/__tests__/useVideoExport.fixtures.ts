/**
 * Shared fixtures for the useVideoExport session / download / failure / cancel
 * suites. Each suite still declares its own `vi.mock` calls (they are hoisted
 * per file); this module only holds plain data and helpers.
 */

import type { MaterialItem, TimelineState } from '@/types';
import type { Translations } from '@/lib/i18n';

export const exportTranslations = {
  videoExport: {
    nothingVisibleToExport: 'nothing visible',
    missingMaterials: 'missing {count}: {names}',
    blackTailNotice: 'black {seconds}',
    moreItems: 'and {count} more',
    degradedTitle: 'Some content is missing:',
    degradedImageOverlay: 'Images not rendered: {names}',
    degradedSubtitles: 'Subtitles not burned in',
    degradedAudioItem: 'Audio not mixed in: {names}',
    degradedEmbeddedAudio: 'Original sound not mixed in: {names}',
    exportFailed: 'failed',
    exportTimeout: 'timeout',
    exportCancelled: 'cancelled',
    exportCompletedButDownloadFailed: 'download failed',
    compositionWarningsTitle: 'warnings',
    failedStageMediaResolution: '{count} not local: {names}',
    failedStageNormalization: '{count} unprocessable: {names}',
    failedStageCompose: 'render failed',
  },
} as unknown as Translations;

export function videoMaterial(id: string): MaterialItem {
  return {
    id,
    name: id,
    type: 'video',
    format: 'mp4',
    size: 1,
    url: `/api/storage/files/video/${id}`,
    createdAt: new Date(0),
  } as MaterialItem;
}

export function singleClipTimeline(materialId: string): TimelineState {
  return {
    currentTime: 0, totalDuration: 5, zoomLevel: 1, selectedItems: [], playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'v', name: 'v', type: 'video', height: 80, isLocked: false, isMuted: false,
      isVisible: true, volume: 100, order: 0,
      items: [{
        id: 'clip', name: 'clip', type: 'video', materialId, trackId: 'v', startTime: 0,
        duration: 5, color: '#000', clipStart: 0, clipEnd: 5,
      }],
    }],
  };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A poll that never settles on its own; it rejects like the real poller once aborted. */
export function pollUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new DOMException('Composition polling aborted', 'AbortError'));
    }, { once: true });
  });
}
