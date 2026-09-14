/**
 * materialCacheClient — frontend client for the spec-06 cache-governance
 * endpoints (delete-联动 + orphan reclaim).
 *
 * Thin wrappers over the BFF passthrough routes:
 *   DELETE /api/storage/material/{material_id}?source_path=&extra_keys=
 *   POST   /api/storage/reclaim-orphans
 *
 * Both degrade gracefully: a failed backend call must NOT block the editor's
 * local state removal (the user already asked to delete), so the delete helper
 * never throws — it returns a result envelope the caller can log.
 */

import { http } from '@/lib/api/http-client';

/** The per-target outcome of a material delete cascade (snake_case wire). */
export interface MaterialDeleteResult {
  success: boolean;
  deleted: {
    source: boolean;
    thumbnails: number;
    waveform: boolean;
  };
  message?: string;
}

/** Inputs identifying a material's source + derived keys to cascade. */
export interface DeleteMaterialParams {
  /** Frontend material identifier (filmstrip + waveform key). */
  materialId: string;
  /**
   * STORAGE_ROOT-relative source file path to delete. Omit for shared
   * cached_materials whose source must NOT be removed.
   */
  sourcePath?: string;
  /**
   * Extra thumbnail dir keys to cascade — e.g. the stored-file poster stem,
   * which is keyed differently from the frontend materialId.
   */
  extraKeys?: string[];
}

const FAILED_RESULT: MaterialDeleteResult = {
  success: false,
  deleted: { source: false, thumbnails: 0, waveform: false },
};

/**
 * Cascade-delete a material's source file + derived thumbnails/waveform.
 *
 * Never throws: on any network/backend error the returned envelope has
 * `success:false` so the caller can still proceed with local state removal.
 *
 * @param params Material id + optional source path + extra cascade keys.
 * @param signal Optional AbortSignal.
 * @returns The delete result envelope (always resolves).
 */
export async function deleteMaterialDerived(
  params: DeleteMaterialParams,
  signal?: AbortSignal,
): Promise<MaterialDeleteResult> {
  const query = new URLSearchParams();
  if (params.sourcePath) query.set('source_path', params.sourcePath);
  for (const key of params.extraKeys ?? []) {
    if (key) query.append('extra_keys', key);
  }
  const qs = query.toString();
  const path = `/api/storage/material/${encodeURIComponent(params.materialId)}${
    qs ? `?${qs}` : ''
  }`;
  try {
    const result = await http.del<MaterialDeleteResult>(path, { signal });
    return result ?? FAILED_RESULT;
  } catch (error) {
    // Never swallow silently (N-08): the caller only sees success:false.
    console.warn('[materials] delete request failed', { materialId: params.materialId, error });
    return FAILED_RESULT;
  }
}

/** The counts returned by an orphan-reclaim pass (snake_case wire). */
export interface ReclaimOrphansResult {
  success: boolean;
  reclaimed: {
    dirs: number;
    files: number;
    bytes: number;
    skipped: boolean;
    dry_run: boolean;
  };
}

/**
 * Reclaim orphaned derived files for the supplied referenced key set.
 *
 * SAFETY: an EMPTY referenced set makes the backend SKIP reclaim (deletes
 * nothing). Callers MUST pass the COMPLETE referenced set (material library ∪
 * every key referenced by a local project) — never a partial list.
 *
 * @param referencedMaterialIds Material keys still in use.
 * @param dryRun When true, the backend logs intended deletions without deleting.
 * @returns The reclaim report (always resolves; `success:false` on error).
 */
export async function reclaimOrphans(
  referencedMaterialIds: string[],
  dryRun = false,
): Promise<ReclaimOrphansResult> {
  try {
    const result = await http.post<ReclaimOrphansResult>(
      '/api/storage/reclaim-orphans',
      { referenced_material_ids: referencedMaterialIds, dry_run: dryRun },
    );
    return result;
  } catch {
    return {
      success: false,
      reclaimed: {
        dirs: 0, files: 0, bytes: 0, skipped: true, dry_run: dryRun,
      },
    };
  }
}
