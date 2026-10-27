import type { MaterialItem, TimelineItem, TimelineState } from '@/types';
import type { WebMaterialProvenance } from '@/types/webResearch';
import { findMaterial } from './index';

/**
 * 时间线上「来自网络」的素材及其来源登记：规则 16（`web_material_license_unknown`）
 * 与 `build_credits` 共用同一份判定，避免两处对「什么算网络素材」各说各话。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.5。纯函数，无网络。
 */

export interface WebMaterialUsage {
  trackId: string;
  start: number;
  end: number;
}

export interface WebMaterialEntry {
  materialId: string;
  name: string;
  /** 缺省表示素材标了 `source: 'web'` 却没有来源登记。 */
  provenance: WebMaterialProvenance | null;
  usages: WebMaterialUsage[];
}

function provenanceOf(
  item: TimelineItem, material: MaterialItem | undefined,
): { isWeb: boolean; provenance: WebMaterialProvenance | null } {
  const metadata = material?.metadata ?? item.metadata;
  const provenance = metadata?.provenance ?? item.metadata?.provenance ?? null;
  return { isWeb: metadata?.source === 'web' || provenance !== null, provenance };
}

/** `declared` 才算授权已声明；其余（含缺失登记）都属「未声明」。 */
export function isLicenseDeclared(provenance: WebMaterialProvenance | null): boolean {
  return provenance?.license_status === 'declared';
}

/**
 * 时间线引用的网络素材（按素材去重，保留每次使用的位置）。
 * 只看时间线条目引用的素材，因此「入库但没上轨」的不会被算进去。
 */
export function collectTimelineWebMaterials(
  state: TimelineState, materials: readonly MaterialItem[],
): WebMaterialEntry[] {
  const entries = new Map<string, WebMaterialEntry>();
  for (const track of state.tracks) {
    for (const item of track.items) {
      if (!item.materialId) continue;
      const material = findMaterial(materials as MaterialItem[], item.materialId);
      const { isWeb, provenance } = provenanceOf(item, material);
      if (!isWeb) continue;
      const entry = entries.get(item.materialId) ?? {
        materialId: item.materialId, name: material?.name ?? item.name,
        provenance, usages: [],
      };
      entry.usages.push({ trackId: track.id, start: item.startTime,
        end: item.startTime + item.duration });
      entries.set(item.materialId, entry);
    }
  }
  return Array.from(entries.values());
}

/** `scope='all'`：素材库里所有网络素材，不论是否上轨。 */
export function collectLibraryWebMaterials(
  state: TimelineState, materials: readonly MaterialItem[],
): WebMaterialEntry[] {
  const used = new Map(collectTimelineWebMaterials(state, materials)
    .map(entry => [entry.materialId, entry]));
  const result = Array.from(used.values());
  for (const material of materials) {
    const provenance = material.metadata?.provenance ?? null;
    if (used.has(material.id)) continue;
    if (material.metadata?.source !== 'web' && provenance === null) continue;
    result.push({ materialId: material.id, name: material.name, provenance, usages: [] });
  }
  return result;
}
