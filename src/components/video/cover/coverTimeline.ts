import type { MaterialItem, TimelineItem, Track } from '@/types';
import type { CoverRevision } from '@/types/videoCover';
import { CoverError } from '@/types/videoCover';
import type { TimelineData } from '../timeline/domain/types';

export class CoverTimelineError extends CoverError {
  constructor(message: string) { super('COVER_TIMELINE_CONFLICT', message); }
}

export const isCoverClip = (item: Pick<TimelineItem, 'metadata'>) =>
  item.metadata?.role === 'video-cover';

/** Agent baseline includes render/edit flags; selection and lane height are UI. */
export const coverTimelineDigest = (projectId: string, tracks: readonly Track[]) =>
  JSON.stringify([projectId, tracks.map(track => ({
    id: track.id, name: track.name, type: track.type, order: track.order,
    volume: track.volume, isLocked: track.isLocked,
    isVisible: track.isVisible, isMuted: track.isMuted,
    items: track.items.map(item => {
      const content = { ...item }; delete content.isSelected; return content;
    }),
  }))]);

export function normalizeCoverFrames(seconds: number): number {
  if (!Number.isFinite(seconds)) throw new CoverTimelineError('Invalid duration');
  return Math.max(3, Math.min(150, Math.round(seconds * 30)));
}

export function isCanonicalCover(item: TimelineItem): boolean {
  const p = item.imagePosition;
  const frames = item.duration * 30;
  return item.startTime === 0 && item.type === 'video'
    && item.originalMaterialType === 'image' && (item.opacity ?? 1) === 1
    && !!p && p.x === 0 && p.y === 0 && p.width === 1 && p.height === 1
    && p.zIndex === 100 && !item.cameraMotion
    && !item.transitionIn && !item.transitionOut
    && Number.isFinite(frames) && frames >= 3 && frames <= 150
    && Math.abs(frames - Math.round(frames)) < 1e-6
    && item.clipStart === 0 && item.clipEnd === item.duration
    && item.originalDuration === item.duration;
}

export function createCoverMaterial(revision: CoverRevision): MaterialItem {
  return {
    id: `cover-material:${revision.id}`, name: revision.document.fields.title || 'Cover',
    type: 'image', format: 'png', size: 0, url: revision.url,
    serverUrl: revision.url, thumbnailUrl: revision.url,
    width: revision.width, height: revision.height,
    createdAt: new Date(revision.createdAt),
    metadata: { role: 'video-cover', coverMode: revision.document.mode,
      storageKind: 'local', cover: {
      schemaVersion: 2, projectId: revision.projectId,
      revisionId: revision.id, assetId: revision.assetId, sha256: revision.sha256,
    } },
  };
}

export interface CoverTimelineOptions {
  projectId: string;
  timeline: TimelineData;
  revision?: CoverRevision;
  durationFrames?: number;
  coverLabel?: string;
  mode?: 'apply' | 'remove-collapse' | 'remove-only' | 'rebuild';
}

export interface CoverTimelinePlan {
  status: 'applied' | 'noop';
  timeline: TimelineData;
  material?: MaterialItem;
  clipId?: string;
  delta: number;
}

/** Validate the entire transaction before registering media or moving a clip. */
export function planCoverTimelineChange(options: CoverTimelineOptions): CoverTimelinePlan {
  const { projectId, timeline, revision, mode = 'apply', coverLabel = 'Cover' } = options;
  const trackId = `image-track-cover:${projectId}`;
  const clipId = `cover-clip:${projectId}`;
  const covers = timeline.tracks.flatMap(track => track.items.filter(isCoverClip)
    .map(item => ({ track, item })));
  if (covers.length > 1) throw new CoverTimelineError('Multiple cover clips');
  const previous = covers[0];
  const target = timeline.tracks.find(track => track.id === trackId);
  const removing = mode === 'remove-collapse' || mode === 'remove-only';
  if (target && (target.type !== 'video' || target.items.some(item => !isCoverClip(item)))) {
    throw new CoverTimelineError('Reserved cover track is occupied');
  }
  if (timeline.tracks.some(track => track.items.some(item => item.id === clipId && !isCoverClip(item)))) {
    throw new CoverTimelineError('Reserved cover clip ID is occupied');
  }
  if (previous && previous.item.metadata?.cover?.projectId !== projectId) {
    throw new CoverTimelineError('Cover belongs to a different project');
  }
  if (target?.isLocked || previous?.track.isLocked) throw new CoverTimelineError('Cover track is locked');
  if (!removing && (target?.isVisible === false || previous?.track.isVisible === false)) {
    throw new CoverTimelineError('Show the cover track before applying');
  }
  if (previous && !isCanonicalCover(previous.item) && mode !== 'rebuild' && mode !== 'remove-only') {
    throw new CoverTimelineError('Cover was adjusted; rebuild the intro explicitly');
  }
  if (!removing && (!revision || revision.projectId !== projectId
    || typeof revision.url !== 'string' || !revision.url.startsWith('/api/storage/files/'))) {
    throw new CoverTimelineError('Cover revision is not a local project asset');
  }
  const frames = options.durationFrames ?? revision?.document.durationFrames ?? 30;
  if (!Number.isInteger(frames) || frames < 3 || frames > 150) throw new CoverTimelineError('Invalid cover frame count');
  const duration = removing ? 0 : frames / 30;
  const oldDuration = mode === 'rebuild' ? 0 : previous?.item.duration ?? 0;
  const delta = mode === 'remove-only' ? 0 : duration - oldDuration;
  for (const track of timeline.tracks) {
    const body = track.items.filter(item => !isCoverClip(item));
    if (delta !== 0 && track.isLocked && body.length) throw new CoverTimelineError('A body track is locked');
    if (delta !== 0 && body.some(item => item.startTime < oldDuration - 1e-6)) {
      throw new CoverTimelineError('Body content overlaps the intro');
    }
  }
  if ((removing && !previous) || (!removing && mode !== 'rebuild'
    && previous?.item.metadata?.cover?.revisionId === revision?.id && delta === 0)) {
    return { status: 'noop', timeline, delta: 0 };
  }
  const tracks = timeline.tracks.map(track => ({ ...track,
    items: track.items.filter(item => !isCoverClip(item))
      .map(item => ({ ...item, startTime: item.startTime + delta })),
  }));
  let material: MaterialItem | undefined;
  if (!removing && revision) {
    material = createCoverMaterial(revision);
    if (!revision.document.fields.title) material.name = coverLabel;
    const item: TimelineItem = {
      id: clipId, name: material.name, type: 'video', trackId,
      startTime: 0, duration, clipStart: 0, clipEnd: duration, originalDuration: duration,
      color: '#B66B50', materialId: material.id, originalMaterialType: 'image',
      url: revision.url, serverUrl: revision.url, thumbnailUrl: revision.url,
      metadata: material.metadata, opacity: 1,
      imagePosition: { x: 0, y: 0, width: 1, height: 1, zIndex: 100 },
    };
    const existing = tracks.find(track => track.id === trackId);
    if (existing) existing.items = [item];
    else tracks.unshift({ id: trackId, name: coverLabel, type: 'video', height: 56,
      isLocked: false, isMuted: false, isVisible: true, volume: 100,
      order: Math.min(0, ...tracks.map(track => track.order)) - 1, items: [item] });
  }
  const totalDuration = Math.max(0.001, ...tracks.flatMap(track =>
    track.items.map(item => item.startTime + item.duration)));
  return { status: 'applied', material, clipId: removing ? undefined : clipId,
    delta, timeline: { ...timeline, tracks, totalDuration } };
}
