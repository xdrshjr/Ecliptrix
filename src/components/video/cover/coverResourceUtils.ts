import { CoverError, type CoverAsset, type CoverJob,
  type CoverRevision } from '@/types/videoCover';

/** Naive service timestamps are UTC, independent of the desktop timezone. */
export function parseCoverCreatedAt(value?: string): number | null {
  if (!value?.trim()) return null;
  const normalized = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const timestamp = Date.parse(zoned ? normalized : `${normalized}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function mergeCoverAssets(existing: CoverAsset[],
  incoming: CoverAsset[]): CoverAsset[] {
  const byId = new Map(existing.map(asset => [asset.assetId, asset]));
  for (const asset of incoming) {
    const previous = byId.get(asset.assetId);
    if (previous && (previous.sha256 !== asset.sha256 ||
      previous.width !== asset.width || previous.height !== asset.height ||
      previous.url !== asset.url)) {
      throw new CoverError('COVER_INVALID_ASSET', 'COVER_INVALID_ASSET');
    }
    if (!previous) byId.set(asset.assetId, asset);
  }
  return Array.from(byId.values());
}

export function mergeCoverRevisions(existing: CoverRevision[],
  incoming: CoverRevision[]): CoverRevision[] {
  const byId = new Map(existing.map(revision => [revision.id, revision]));
  for (const revision of incoming) {
    const previous = byId.get(revision.id);
    if (previous && (previous.projectId !== revision.projectId ||
      previous.documentHash !== revision.documentHash ||
      previous.sha256 !== revision.sha256 || previous.url !== revision.url)) {
      throw new CoverError('COVER_INVALID_ASSET', 'COVER_INVALID_ASSET');
    }
    if (!previous) byId.set(revision.id, revision);
  }
  return Array.from(byId.values());
}

export function selectCoverAssets(assets: CoverAsset[], jobs: CoverJob[],
  selectedAssetId?: string | null): CoverAsset[] {
  const merged = mergeCoverAssets(assets, jobs.flatMap(job => job.assets))
    .filter(asset => asset.url.startsWith('/api/storage/files/'));
  const selected = merged.find(asset => asset.assetId === selectedAssetId);
  return selected ? [selected, ...merged.filter(asset => asset !== selected)]
    : merged;
}

export function selectCoverRevisions(revisions: CoverRevision[],
  appliedId?: string, limit = 20): CoverRevision[] {
  const unique = mergeCoverRevisions([], revisions);
  unique.sort((a, b) => {
    const first = parseCoverCreatedAt(a.createdAt);
    const second = parseCoverCreatedAt(b.createdAt);
    if (first !== second) {
      if (first === null) return 1;
      if (second === null) return -1;
      return second - first;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const recent = unique.slice(0, limit);
  const applied = unique.find(revision => revision.id === appliedId);
  return applied ? [applied, ...recent.filter(item => item.id !== applied.id)]
    : recent;
}
