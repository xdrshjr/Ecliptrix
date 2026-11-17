import type { MaterialItem, TimelineItem, Track } from '@/types';
import type { EffectApplyIntent, EffectAsset } from '@/types/effects';
import { EffectError } from '@/types/effects';
import { assertEffectSourceMatches,
  fingerprintEffectTarget } from '@/lib/effects/provenance';
import type { TimelineData } from '../timeline/domain/types';

export interface EffectsTimelineOptions {
  timeline: TimelineData;
  intent: EffectApplyIntent;
  asset: EffectAsset;
  label?: string;
}

export interface EffectsTimelinePlan {
  status: 'applied' | 'noop';
  timeline: TimelineData;
  material: MaterialItem;
  clipId: string;
  changedTrackIds: string[];
}

/** Every playback identity is newly constructed from a published receipt. */
export function createEffectMaterial(asset: EffectAsset): MaterialItem {
  if (asset.kind !== 'output-video' || !asset.effects
    || !asset.url.startsWith('/api/storage/files/effects/')) {
    throw new EffectError('EFFECT_OUTPUT_MISSING');
  }
  return { id: `effect-material:${asset.id}`, name: 'Remotion', type: 'video',
    format: 'mp4', size: asset.bytes, duration: asset.durationSeconds,
    width: asset.width, height: asset.height,
    createdAt: new Date(asset.createdAt), thumbnailUrl: asset.thumbnailUrl,
    url: asset.url, serverUrl: asset.url, cacheUrl: asset.url,
    storageKey: asset.storageKey, metadata: { source: 'remotion',
      storageKind: 'local', storageKey: asset.storageKey,
      localResolvedUrl: asset.url, effects: asset.effects } };
}

function replaceItem(options: {
  item: TimelineItem; track: Track; intent: EffectApplyIntent;
  asset: EffectAsset; material: MaterialItem;
}): TimelineItem {
  const { item, track, intent, asset, material } = options;
  if (!intent.target || item.type !== 'video'
    || item.originalMaterialType === 'image' || item.metadata?.role
    || track.isLocked) throw new EffectError('EFFECT_TARGET_CHANGED');
  if (fingerprintEffectTarget(track, item) !== intent.target.targetFingerprint) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  assertEffectSourceMatches(asset, intent.target);
  const metadata = { ...item.metadata, ...material.metadata };
  for (const key of ['localProxy', 'previewProxy', 'analysisResult']) {
    delete metadata[key];
  }
  const result = { ...item, materialId: material.id, name: material.name,
    url: asset.url, serverUrl: asset.url, cacheUrl: asset.url,
    storageKey: asset.storageKey, thumbnailUrl: asset.thumbnailUrl,
    clipStart: 0, clipEnd: item.duration,
    originalDuration: asset.durationSeconds, metadata };
  const mutable = result as unknown as Record<string, unknown>;
  for (const key of ['localProxy', 'localProxyUrl', 'previewProxy',
    'previewProxyUrl', 'analysisResult']) delete mutable[key];
  return result;
}

function isSameOutput(item: TimelineItem, asset: EffectAsset): boolean {
  return item.metadata?.effects?.assetId === asset.id
    && item.materialId === `effect-material:${asset.id}`
    && item.url === asset.url && item.cacheUrl === asset.url
    && item.serverUrl === asset.url && item.storageKey === asset.storageKey
    && item.clipStart === 0 && item.clipEnd === item.duration;
}

/** Plan against the latest aggregate, retaining every unrelated edit. */
export function planEffectsTimelineChange(
  options: EffectsTimelineOptions,
): EffectsTimelinePlan {
  const { timeline, intent, asset } = options;
  if (asset.projectId !== intent.projectId) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  const material = createEffectMaterial(asset);
  material.name = options.label ?? 'Remotion';
  const clipId = intent.mode === 'replace' ? intent.target?.clipId
    : `effect-clip:${intent.operationId}`;
  if (!clipId) throw new EffectError('EFFECT_TARGET_CHANGED');
  const owner = timeline.tracks.find(track =>
    track.items.some(item => item.id === clipId));
  const existing = owner?.items.find(item => item.id === clipId);
  if (existing && isSameOutput(existing, asset)) {
    return { status: 'noop', timeline, material, clipId, changedTrackIds: [] };
  }
  const changed = intent.mode === 'replace'
    ? planReplacement({ ...options, material, clipId })
    : planInsertion({ ...options, material, clipId });
  return { status: 'applied', material, clipId,
    timeline: { ...timeline, tracks: changed.tracks,
      totalDuration: Math.max(0.001, ...changed.tracks.flatMap(track =>
        track.items.map(item => item.startTime + item.duration))) },
    changedTrackIds: [changed.trackId] };
}

interface PlanOptions extends EffectsTimelineOptions {
  material: MaterialItem;
  clipId: string;
}

function planReplacement(options: PlanOptions) {
  const { timeline, intent, asset, material, clipId } = options;
  const track = timeline.tracks.find(item => item.id === intent.target?.trackId);
  const item = track?.items.find(clip => clip.id === clipId);
  if (!track || !item) throw new EffectError('EFFECT_TARGET_CHANGED');
  const replacement = replaceItem({ item, track, intent, asset, material });
  return { trackId: track.id, tracks: timeline.tracks.map(current =>
    current.id === track.id ? { ...current, items: current.items.map(clip =>
      clip.id === clipId ? replacement : clip) } : current) };
}

function planInsertion(options: PlanOptions) {
  const { intent, asset, material, clipId, timeline } = options;
  const time = intent.startTime;
  if (time === undefined || !Number.isFinite(time) || time < 0 || time > 86400) {
    throw new EffectError('EFFECT_INVALID_ARGUMENT');
  }
  const trackId = `effect-track:${intent.operationId}`;
  if (timeline.tracks.some(track => track.id === trackId)) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  const duration = asset.durationSeconds!;
  if (!Number.isFinite(duration) || duration < 0.5 || duration > 60.1) {
    throw new EffectError('EFFECT_SOURCE_RANGE_INVALID');
  }
  const item: TimelineItem = { id: clipId, trackId, name: material.name,
    type: 'video', color: '#C87758', materialId: material.id,
    startTime: time, duration, clipStart: 0, clipEnd: duration,
    originalDuration: duration, originalMaterialType: 'video',
    url: asset.url, serverUrl: asset.url, cacheUrl: asset.url,
    storageKey: asset.storageKey, thumbnailUrl: asset.thumbnailUrl,
    metadata: material.metadata };
  const track: Track = { id: trackId, name: options.label ?? 'Remotion',
    type: 'video', height: 56, isLocked: false, isMuted: false,
    isVisible: true, volume: 100,
    order: Math.max(-1, ...timeline.tracks.filter(t => t.type === 'video')
      .map(t => t.order)) + 1, items: [item] };
  return { trackId, tracks: [...timeline.tracks, track] };
}
