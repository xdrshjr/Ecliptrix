/**
 * What to do with a finished image-overlay gesture (PV3-04 / N-18, S13).
 *
 * The drag writes live positions into the editor's timeline state (preview,
 * export and autosave read it). When the store then refuses the commit — the
 * agent took the edit lock mid-drag, or the track is locked — that state must go
 * back to the stored value, or the preview and the export keep a position the
 * timeline never recorded.
 */

import type { ImagePosition } from '@/types';
import type { ImageEditBlocker } from '../timeline/store/actions/updateItemFields';
import { DEFAULT_IMAGE_POSITION } from '../components/VideoPlayerPanel/imageOverlayGeometry';

export type ImagePositionCommit =
  | { kind: 'apply' }
  /** The item no longer exists; nothing to commit or restore. */
  | { kind: 'ignore' }
  | { kind: 'revert'; position: ImagePosition; reason: 'agent-lock' | 'track-locked' };

export function resolveImagePositionCommit(
  blocker: ImageEditBlocker | null,
  storePosition: ImagePosition | undefined,
): ImagePositionCommit {
  if (blocker === null) return { kind: 'apply' };
  if (blocker === 'missing') return { kind: 'ignore' };
  return { kind: 'revert', position: storePosition ?? DEFAULT_IMAGE_POSITION, reason: blocker };
}
