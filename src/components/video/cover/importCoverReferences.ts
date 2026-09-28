import type { CoverRevision } from '@/types/videoCover';
import { CoverError } from '@/types/videoCover';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import type { TimelineData, MaterialData } from '../timeline/domain/types';
import { createCoverMaterial, isCoverClip } from './coverTimeline';

export interface ImportCoverOptions {
  projectId: string;
  timelineData: TimelineData;
  materials: MaterialData[];
  mode: 'replace' | 'append';
  api?: Pick<typeof videoCoverV2, 'getRevision' | 'importRevision'>;
}

/** Appending must never reuse a source ID or overwrite a current material. */
export function remapAppendedTimeline(timeline: TimelineData, materials: MaterialData[]) {
  const mapping = new Map(materials.map(material => [material.id, `import-material:${crypto.randomUUID()}`]));
  for (const material of materials) material.id = mapping.get(material.id)!;
  for (const track of timeline.tracks) {
    const kind = track.id.startsWith('image-track') ? 'image' : track.type;
    track.id = `${kind}-track-import:${crypto.randomUUID()}`;
    for (const item of track.items) {
      item.id = `import-clip:${crypto.randomUUID()}`;
      item.trackId = track.id;
      if (item.materialId) item.materialId = mapping.get(item.materialId) ?? item.materialId;
    }
  }
}

/** All remote work completes before returning a snapshot the caller may commit. */
export async function importCoverReferences(options: ImportCoverOptions) {
  const { projectId, mode, api = videoCoverV2 } = options;
  const timelineData: TimelineData = structuredClone(options.timelineData);
  const materials: MaterialData[] = structuredClone(options.materials);
  const covers = timelineData.tracks.flatMap(track =>
    track.items.filter(isCoverClip).map(item => ({ track, item })));
  if (covers.length > 1) throw new CoverError('COVER_TIMELINE_CONFLICT', 'Multiple cover clips');
  for (const { track, item } of covers) {
    const ref = item.metadata?.cover;
    if (!ref || ref.schemaVersion !== 2 || !ref.projectId || !ref.revisionId) {
      throw new CoverError('COVER_ASSET_MISSING', 'Invalid cover reference');
    }
    const revision: CoverRevision = ref.projectId === projectId
      ? await api.getRevision(projectId, ref.revisionId)
      : await api.importRevision(projectId, ref.projectId, ref.revisionId, crypto.randomUUID());
    if (revision.projectId !== projectId) throw new CoverError('COVER_PROJECT_CHANGED', 'Wrong asset owner');
    const material = createCoverMaterial(revision);
    const oldMaterialId = item.materialId;
    const oldTrackId = track.id;
    const suffix = crypto.randomUUID();
    track.id = mode === 'append' ? `image-track-import:${suffix}` : `image-track-cover:${projectId}`;
    item.id = mode === 'append' ? `image-clip-import:${suffix}` : `cover-clip:${projectId}`;
    if (mode === 'append') {
      material.id = `image-material-import:${suffix}`;
      material.metadata = { ...material.metadata };
      delete material.metadata.role;
      delete material.metadata.cover;
    }
    for (const sibling of track.items) if (sibling.trackId === oldTrackId) sibling.trackId = track.id;
    Object.assign(item, { trackId: track.id, materialId: material.id,
      url: revision.url, serverUrl: revision.url, thumbnailUrl: revision.url,
      originalMaterialType: 'image', metadata: material.metadata });
    // Other uses of a cover material must also stop referencing the source project.
    for (const otherTrack of timelineData.tracks) for (const other of otherTrack.items) {
      if (oldMaterialId && other.materialId === oldMaterialId) Object.assign(other, {
        materialId: material.id, url: revision.url, serverUrl: revision.url,
        thumbnailUrl: revision.url,
        metadata: { ...other.metadata, cover: material.metadata?.cover },
      });
    }
    const index = materials.findIndex(candidate => candidate.id === oldMaterialId);
    if (index >= 0) materials.splice(index, 1, material);
    else materials.push(material);
  }
  if (mode === 'append') remapAppendedTimeline(timelineData, materials);
  const trackIds = timelineData.tracks.map(track => track.id);
  const clipIds = timelineData.tracks.flatMap(track => track.items.map(item => item.id));
  if (new Set(trackIds).size !== trackIds.length || new Set(clipIds).size !== clipIds.length) {
    throw new CoverError('COVER_TIMELINE_CONFLICT', 'Import contains conflicting IDs');
  }
  return { timelineData, materials, coverSchemaVersion: covers.length ? 2 as const : undefined,
    coverAppended: mode === 'append' && covers.length > 0 };
}
