import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseMaterialManagementReturn } from '../types';
import { VideoEditingLogger } from '../utils';
import { LOCAL_OWNER_ID } from '@/lib/localOwner';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useVideoEditingStore } from '@/stores';
import {
  useRemoteMaterialPrefetch,
  type RemoteMaterialPatch,
} from './useRemoteMaterialPrefetch';
import { useLocalMaterialDownload } from './useLocalMaterialDownload';
import { deleteMaterialDerived } from '../lib/api/materialCacheClient';
import { filmstripCache } from '../lib/filmstrip/filmstripCache';
import { waveformCache } from '../lib/waveform/waveformCache';
import { dropVideoCacheMaterial } from './useVideoCache';
import {
  sourcePathForDelete,
  extraThumbnailKeysForDelete,
  materialDeleteMessage,
} from './materialManagement/materialDeleteHelpers';
import { useMaterialUpload } from './materialManagement/useMaterialUpload';
import { useMaterialGeneration } from './materialManagement/useMaterialGeneration';
import { useTimelineStore, removeItemsAction } from '../timeline/store';
import { isEditLocked } from '../timeline/store/editLock';
import { findTimelineUsages } from '../timeline/lib/materialUsage';

// 确认对话框状态接口
interface ConfirmationDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  type: 'danger' | 'warning' | 'info';
}

/** What deleting these materials would do to the timeline right now. */
type MaterialDeletePlan =
  | { kind: 'edit-locked' }
  | { kind: 'locked-clips'; count: number }
  | { kind: 'ready'; itemIds: string[] };

/**
 * Deleting a material in use used to leave its clips on the tracks while the
 * source file was deleted: preview went blank and export silently dropped
 * them. Clips using the material are removed with it (one undo step); a
 * locked clip or the agent's edit lock refuses the delete instead.
 */
function planMaterialDelete(materialIds: readonly string[]): MaterialDeletePlan {
  const timeline = useTimelineStore.getState();
  if (isEditLocked(timeline)) return { kind: 'edit-locked' };
  const usages = findTimelineUsages(timeline.tracks, materialIds);
  const lockedCount = usages.reduce((sum, usage) => sum + usage.lockedItemIds.length, 0);
  if (lockedCount > 0) return { kind: 'locked-clips', count: lockedCount };
  return { kind: 'ready', itemIds: usages.reduce<string[]>((ids, usage) => ids.concat(usage.itemIds), []) };
}

/**
 * useMaterialManagement Hook
 * 管理素材库操作，支持并发上传队列
 *
 * Orchestrates the material library: selection / delete-cascade state lives
 * here, while the upload queue (useMaterialUpload) and AI-generation flows
 * (useMaterialGeneration) are composed from sibling hooks under
 * ./materialManagement to keep this file lean.
 *
 * @param taskId - 任务ID，用于日志记录
 * @param initialMaterials - 从持久化content恢复的初始素材列表
 * @returns 素材管理相关的状态和方法
 */
export const useMaterialManagement = (taskId: string, initialMaterials: MaterialItem[] = []): UseMaterialManagementReturn => {
  // 获取当前用户信息
  const { t } = useLocale();
  const { showWarning, showError } = useNotification();
  const clearMaterials = useVideoEditingStore(state => state.clearMaterials);

  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useMaterialManagement'
  }), [taskId]);

  // 素材管理状态
  const [materials, setMaterials] = useState<MaterialItem[]>(initialMaterials);

  // Spec 06 §2.3 — holds the LocalMediaCache eviction fn from
  // useLocalMaterialDownload (called below, AFTER executeDelete is defined).
  // A ref lets the earlier-declared executeDelete reach it at call time.
  const evictLocalMaterialRef = useRef<((materialId: string) => void) | null>(null);
  // Latest materials snapshot for the delete cascade (so executeDelete can read
  // source path / poster stem without re-creating on every materials change).
  const materialsSnapshotRef = useRef<MaterialItem[]>(initialMaterials);
  // Tracks whether the hook's host component is still mounted
  const isMountedRef = useRef(true);

  // Sync: merge Zustand store materials into local state.
  // Agent tools add materials via SSE → AgentEventRouter → Zustand store.
  // This effect bridges the store → local useState so MaterialsPanel re-renders.
  // "Not in the panel" is not the same as "new": ids already merged once or
  // deleted in the panel are never merged again, so a deleted material cannot
  // come back the next time the agent adds any material (DS3-02).
  const storeMaterials = useVideoEditingStore(state => state.materials);
  const mergedStoreIdsRef = useRef(new Set<string>());
  useEffect(() => {
    setMaterials(prev => {
      const localIds = new Set(prev.map(m => m.id));
      const newFromStore = storeMaterials.filter(m => !localIds.has(m.id) && !mergedStoreIdsRef.current.has(m.id));
      const blocked = storeMaterials.filter(m => !localIds.has(m.id) && mergedStoreIdsRef.current.has(m.id));
      if (blocked.length > 0) {
        console.warn('[materials] store material already merged or deleted; not re-added', {
          ids: blocked.map(m => m.id),
        });
      }
      if (newFromStore.length === 0) return prev;
      newFromStore.forEach(m => mergedStoreIdsRef.current.add(m.id));
      return [...prev, ...newFromStore];
    });
  }, [storeMaterials]);

  // Keep the snapshot ref current so the delete cascade reads live metadata.
  useEffect(() => {
    materialsSnapshotRef.current = materials;
  }, [materials]);

  // Track mount state for fire-and-forget async writes back into materials.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [selectedMaterialType, setSelectedMaterialType] = useState<MaterialType | 'all'>('all');
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());

  // 确认对话框状态
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialogState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'danger'
  });

  // 处理素材类型筛选
  const handleMaterialTypeFilter = useCallback((type: MaterialType | 'all') => {
    logger.userAction('素材类型筛选', 'filterTabs', {
      previousType: selectedMaterialType,
      newType: type,
      materialCount: materials.filter(material => type === 'all' || material.type === type).length
    });

    setSelectedMaterialType(type);
    setSelectedMaterials(new Set());
  }, [selectedMaterialType, materials, logger]);

  // 处理素材选择/取消选择
  const handleMaterialSelect = useCallback((materialId: string, isSelected: boolean) => {
    logger.userAction('素材选择状态变更', 'materialSelect', {
      materialId,
      isSelected,
      previousSelectionCount: selectedMaterials.size
    });

    setSelectedMaterials(prev => {
      const newSet = new Set(prev);
      if (isSelected) {
        newSet.add(materialId);
      } else {
        newSet.delete(materialId);
      }

      logger.info('素材选择状态更新', {
        materialId,
        isSelected,
        newSelectionCount: newSet.size,
        selectedMaterials: Array.from(newSet)
      });

      return newSet;
    });
  }, [selectedMaterials, logger]);

  // 处理素材批量选择
  const handleMaterialBatchSelect = useCallback((materialIds: string[], isSelected: boolean) => {
    logger.userAction('素材批量选择', 'batchSelect', {
      materialIds,
      isSelected,
      materialCount: materialIds.length,
      previousSelectionCount: selectedMaterials.size
    });

    setSelectedMaterials(prev => {
      const newSet = new Set(prev);
      materialIds.forEach(id => {
        if (isSelected) {
          newSet.add(id);
        } else {
          newSet.delete(id);
        }
      });

      logger.info('批量素材选择状态更新', {
        materialIds,
        isSelected,
        newSelectionCount: newSet.size,
        selectedMaterials: Array.from(newSet)
      });

      return newSet;
    });
  }, [selectedMaterials, logger]);

  // Spec 06 §2.3 — evict a deleted material from all four frontend caches so
  // no stale blob / video element / filmstrip key / waveform peaks remain.
  const evictMaterialCaches = useCallback((materialId: string) => {
    try { filmstripCache.evict(materialId); } catch { /* best-effort */ }
    try { waveformCache.evict(materialId); } catch { /* best-effort */ }
    try { dropVideoCacheMaterial(materialId); } catch { /* best-effort */ }
    try { evictLocalMaterialRef.current?.(materialId); } catch { /* best-effort */ }
  }, []);

  // Spec 06 §2.3 — cascade-delete a material's source + derived files on the
  // backend (fire-and-forget; never blocks the local state removal). The
  // delete client never throws; resolves whether the cleanup succeeded.
  // `survivors` stay in the library: a source file one of them still owns is kept.
  const cascadeDeleteMaterial = useCallback((materialId: string, survivors: readonly MaterialItem[]): Promise<boolean> => {
    const material = materialsSnapshotRef.current.find(m => m.id === materialId);
    const sourcePath = sourcePathForDelete(material, survivors);
    const extraKeys = extraThumbnailKeysForDelete(material, survivors);
    return deleteMaterialDerived({ materialId, sourcePath, extraKeys }).then(result => {
      if (!result.success) {
        logger.warn('素材派生文件后端清理未成功（已本地移除）', {
          materialId, message: result.message,
        });
      } else {
        logger.info('素材派生文件后端联动清理完成', {
          materialId, deleted: result.deleted,
        });
      }
      return result.success;
    });
  }, [logger]);

  // 实际执行删除操作的函数
  // reportCleanupFailure: tell the user when files stayed on disk (N-08);
  // off for placeholders the app discards on its own.
  const executeDelete = useCallback((materialIds: string[], options: { reportCleanupFailure?: boolean } = {}) => {
    const { reportCleanupFailure = true } = options;
    logger.info('开始执行素材删除', {
      materialIds,
      materialCount: materialIds.length
    });

    // Spec 06 §2.3 delete-联动: evict frontend caches + cascade-delete derived
    // files on the backend BEFORE state removal so the asset leaves nothing
    // stale behind (caches keyed by materialId; backend keyed by id + stem).
    const survivors = materialsSnapshotRef.current.filter(material => !materialIds.includes(material.id));
    const cleanups = materialIds.map(id => {
      evictMaterialCaches(id);
      return cascadeDeleteMaterial(id, survivors);
    });
    void Promise.all(cleanups).then(results => {
      const failedCount = results.filter(succeeded => !succeeded).length;
      if (failedCount > 0 && reportCleanupFailure && isMountedRef.current) {
        showWarning(t.materialsPanel.deleteCleanupFailed.replace('{count}', String(failedCount)));
      }
    });

    // DS3-02: the shared store must forget the material too, and the id stays
    // blocked from the store → panel merge.
    const store = useVideoEditingStore.getState();
    materialIds.forEach(id => {
      store.removeMaterial(id);
      mergedStoreIdsRef.current.add(id);
    });

    setMaterials(prev => {
      const filteredMaterials = prev.filter(material => !materialIds.includes(material.id));

      logger.info('素材删除完成', {
        deletedIds: materialIds,
        remainingCount: filteredMaterials.length,
        deletedCount: materialIds.length
      });

      return filteredMaterials;
    });

    // 清除已删除素材的选中状态
    setSelectedMaterials(prev => {
      const newSet = new Set(prev);
      materialIds.forEach(id => newSet.delete(id));
      return newSet;
    });
  }, [logger, evictMaterialCaches, cascadeDeleteMaterial, showWarning, t]);

  /** Shows why a delete is refused; returns true when it was. */
  const warnIfDeleteBlocked = useCallback((plan: MaterialDeletePlan): boolean => {
    if (plan.kind === 'edit-locked') {
      showWarning(t.timeline.messages.editLockedByAgent);
      return true;
    }
    if (plan.kind === 'locked-clips') {
      showWarning(t.materialsPanel.deleteBlockedLocked.replace('{count}', String(plan.count)));
      return true;
    }
    return false;
  }, [showWarning, t]);

  const confirmMaterialDelete = useCallback((materialIds: string[]) => {
    setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
    // The timeline may have changed while the dialog was open: plan again.
    const plan = planMaterialDelete(materialIds);
    if (plan.kind !== 'ready' || warnIfDeleteBlocked(plan)) return;

    logger.info('素材删除已确认', { materialIds, removedClipCount: plan.itemIds.length });
    if (plan.itemIds.length > 0) {
      removeItemsAction(() => useTimelineStore.getState(), plan.itemIds);
    }
    try {
      executeDelete(materialIds);
    } catch (error) {
      if (plan.itemIds.length === 0) {
        logger.error('素材删除失败', error instanceof Error ? error : new Error(String(error)));
        return;
      }
      console.error('[materials] delete failed after removing clips', { materialIds, error });
      showError(t.materialsPanel.deleteFailedClipsRemoved);
    }
  }, [executeDelete, warnIfDeleteBlocked, showError, t, logger]);

  /**
   * Drops placeholders the app itself created (e.g. clip-cut placeholders after
   * a failed cut). They were never placed on the timeline and the user did not
   * ask to delete anything, so no confirmation or usage plan applies.
   */
  const discardPendingMaterials = useCallback((materialIds: string[]) => {
    if (materialIds.length === 0) return;
    logger.info('Discarding pending placeholder materials', { materialIds });
    executeDelete(materialIds, { reportCleanupFailure: false });
  }, [executeDelete, logger]);

  // 处理素材删除（单个或批量）
  const handleMaterialDelete = useCallback((materialIds: string[]) => {
    logger.userAction('素材删除操作', 'deleteButton', {
      materialIds,
      materialCount: materialIds.length
    });

    const plan = planMaterialDelete(materialIds);
    if (plan.kind !== 'ready') {
      warnIfDeleteBlocked(plan);
      return;
    }
    const materialNames = materialIds.map(id => materials.find(material => material.id === id)?.name ?? id);

    setConfirmationDialog({
      isOpen: true,
      title: t.materialsPanel.deleteConfirmTitle,
      message: materialDeleteMessage(t, materialNames, plan.itemIds.length),
      type: 'danger',
      onConfirm: () => confirmMaterialDelete(materialIds),
    });
  }, [materials, logger, t, warnIfDeleteBlocked, confirmMaterialDelete]);


  // 关闭确认对话框
  const handleCloseConfirmationDialog = useCallback(() => {
    logger.info('用户取消删除操作', {
      dialogType: confirmationDialog.title
    });
    setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
  }, [confirmationDialog.title, logger]);

  // 上传队列（独立 hook）— 自动解析也由它持有，供 addMaterials 复用
  const {
    isUploading,
    uploadProgress,
    handleMaterialUpload,
    handleDragUpload,
    triggerAutoAnalysis,
  } = useMaterialUpload({
    taskId,
    logger,
    ownerId: LOCAL_OWNER_ID,
    isMountedRef,
    setMaterials,
  });

  // 添加或更新素材到列表
  const addMaterials = useCallback((newMaterials: MaterialItem[]) => {
    logger.info('添加或更新素材到列表', {
      materialCount: newMaterials.length,
      materials: newMaterials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        downloadStatus: m.downloadStatus
      }))
    });

    setMaterials(prev => {
      const updatedMaterials = [...prev];
      let addedCount = 0;
      let updatedCount = 0;

      newMaterials.forEach(newMaterial => {
        const existingIndex = updatedMaterials.findIndex(material => material.id === newMaterial.id);

        if (existingIndex !== -1) {
          updatedMaterials[existingIndex] = newMaterial;
          updatedCount++;
        } else {
          updatedMaterials.push(newMaterial);
          addedCount++;
        }
      });

      logger.info('素材列表更新完成', {
        previousCount: prev.length,
        newCount: updatedMaterials.length,
        addedCount,
        updatedCount
      });

      return updatedMaterials;
    });

    // 对搜索添加的素材自动触发解析（与上传后自动解析逻辑一致）
    newMaterials.forEach(material => {
      const isVideoOrImage = material.type === 'video' || material.type === 'image';
      const hasUrl = material.url || material.serverUrl;
      const hasThumbnail = material.thumbnailUrl;
      const notDownloading = material.downloadStatus !== 'downloading';
      const notAnalyzed = !material.analysisResult;

      if (isVideoOrImage && hasUrl && hasThumbnail && notDownloading && notAnalyzed) {
        logger.info('搜索添加的素材自动触发解析', { materialId: material.id, materialName: material.name });
        triggerAutoAnalysis(material);
      }
    });

    return newMaterials.length > 0;
  }, [logger, triggerAutoAnalysis]);

  // 添加或替换单个素材
  const addOrReplaceMaterial = useCallback((newMaterial: MaterialItem) => {
    logger.info('添加或替换素材', {
      materialId: newMaterial.id,
      materialName: newMaterial.name,
      materialType: newMaterial.type
    });

    // Local download, filmstrip and waveform caches are keyed by material id:
    // a same-id replacement with a new file (watermark removal) would keep
    // showing the old file unless they are evicted.
    const previous = materialsSnapshotRef.current.find(material => material.id === newMaterial.id);
    if (previous && previous.url !== newMaterial.url) {
      evictMaterialCaches(newMaterial.id);
    }

    setMaterials(prev => {
      const existingIndex = prev.findIndex(material => material.id === newMaterial.id);

      if (existingIndex !== -1) {
        const updatedMaterials = [...prev];
        updatedMaterials[existingIndex] = newMaterial;

        logger.info('替换现有素材', {
          materialId: newMaterial.id,
          replacedIndex: existingIndex
        });

        return updatedMaterials;
      }

      const updatedMaterials = [...prev, newMaterial];

      logger.info('添加新素材到列表', {
        materialId: newMaterial.id,
        previousCount: prev.length,
        newCount: updatedMaterials.length
      });

      return updatedMaterials;
    });

    return true;
  }, [logger, evictMaterialCaches]);

  // AI 生成流程（视频 / 图像 / 分镜包）— 独立 hook
  const {
    handleAiVideoGenerate,
    handleAiImageGenerate,
    handleStoryboardGenerate,
  } = useMaterialGeneration({ logger, isMountedRef, setMaterials, addOrReplaceMaterial });

  /**
   * DS3-03: clearing the library goes through the same usage plan as a
   * delete — clips using the materials are removed as one undo step, a locked
   * clip or the agent lock refuses — instead of leaving every clip without its
   * material. Returns false when the clear was refused.
   */
  const clearLibraryMaterials = useCallback((): boolean => {
    const current = materialsSnapshotRef.current;
    if (current.length === 0) return true;
    // The timeline may have changed while the dialog was open: plan again.
    const plan = planMaterialDelete(current.map(m => m.id));
    if (plan.kind !== 'ready' || warnIfDeleteBlocked(plan)) return false;
    if (plan.itemIds.length > 0) {
      removeItemsAction(() => useTimelineStore.getState(), plan.itemIds);
    }
    current.forEach(m => evictMaterialCaches(m.id));
    setMaterials([]);
    setSelectedMaterials(new Set());
    clearMaterials();
    mergedStoreIdsRef.current.clear();
    return true;
  }, [clearMaterials, evictMaterialCaches, warnIfDeleteBlocked]);

  // 清除所有素材
  const handleClearAllMaterials = useCallback((
    onAfterClear?: () => void | Promise<void>,
    extraCount: number = 0,
  ) => {
    if (isUploading) {
      return;
    }
    const total = materials.length + extraCount;
    if (total === 0) return;

    let message = t.materialsPanel.clearAllConfirmMessage.replace('{count}', String(total));
    if (materials.length > 0) {
      const plan = planMaterialDelete(materials.map(m => m.id));
      if (plan.kind !== 'ready') {
        warnIfDeleteBlocked(plan);
        return;
      }
      if (plan.itemIds.length > 0) {
        message = t.materialsPanel.clearAllInUseMessage
          .replace('{count}', String(total))
          .replace('{clipCount}', String(plan.itemIds.length));
      }
    }

    setConfirmationDialog({
      isOpen: true,
      title: t.materialsPanel.clearAllConfirmTitle,
      message,
      type: 'danger',
      onConfirm: async () => {
        logger.info('用户确认清除所有素材', { materials: materialsSnapshotRef.current.length, extraCount });
        setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
        if (!clearLibraryMaterials()) return;
        try {
          await onAfterClear?.();
        } catch (e) {
          logger.error('onAfterClear 执行异常', e instanceof Error ? e : new Error(String(e)));
        }
      },
    });
  }, [materials, isUploading, t, logger, warnIfDeleteBlocked, clearLibraryMaterials]);

  // 过滤后的素材列表
  const filteredMaterials = useMemo(() => {
    if (selectedMaterialType === 'all') {
      return materials;
    }
    return materials.filter(material => material.type === selectedMaterialType);
  }, [materials, selectedMaterialType]);

  // 远程视频素材预缓存：识别远程 URL → 调用 /api/material/{ingest,lookup}
  // 把同源 cacheUrl 写回到 MaterialItem 上，让 selectPlaybackUrl 能在预览
  // 路径中替换为 /api/storage/files/cached_materials/...，移除 CDN 卡顿。
  // 同时镜像到 Zustand 全局 store（materialSlice），方便时间轴 TimelineItem
  // 等只读消费方读取 cacheStatus。
  const updateStoreMaterial = useVideoEditingStore(state => state.updateMaterial);
  // Phase-3 spec §4.1 N4: extended to also accept preview-proxy + media-proxy
  // mirror fields so useRemoteMaterialPrefetch can write them back via the
  // same React useState path (no zustand slice exists for materials).
  const patchMaterialCache = useCallback(
    (id: string, patch: RemoteMaterialPatch | Partial<MaterialItem>) => {
      if (!isMountedRef.current) return;
      setMaterials(prev =>
        prev.map(m => (m.id === id ? { ...m, ...patch } : m))
      );
      try {
        updateStoreMaterial(id, patch);
      } catch {
        // store entry may not exist for materials added only locally
      }
    },
    [updateStoreMaterial],
  );
  // Remote prefetch trigger接线 (spec §3.2.2(b)): derive the set of materialIds
  // currently referenced by a media timeline item from the global store, so
  // useRemoteMaterialPrefetch can localize remote video/audio assets. The
  // hook keeps preview-proxy transcoding video-only via its own eligibility
  // guard.
  const timelineState = useVideoEditingStore(state => state.timelineState);
  const timelineMediaMaterialIds = useMemo(() => {
    const ids = new Set<string>();
    timelineState?.tracks?.forEach(track =>
      track.items?.forEach(item => {
        if ((item.type === 'video' || item.type === 'audio') && item.materialId) {
          ids.add(item.materialId);
        }
      }),
    );
    return ids;
  }, [timelineState]);
  useRemoteMaterialPrefetch(materials, patchMaterialCache, {
    // Necessary input that arms timeline-aware remote cache and preview-proxy
    // follow-up work. Preview-proxy remains video-only inside the hook.
    timelineReferencedMaterialIds: timelineMediaMaterialIds,
    // Pass the same patch sink as the preview-proxy hydration target so all
    // mirror fields land in the React useState path consistently.
    onPatchPreviewProxy: patchMaterialCache,
  });

  // Round-2 client-side preview download (spec §3.3.3): derive the set of
  // timeline-referenced *video + audio* materialIds (C2: image excluded — it
  // has no CompositionPlayback channel and must not block the readiness gate).
  const { retryLocalDownload, evictLocalMaterial } = useLocalMaterialDownload(materials, {
    timelineReferencedMaterialIds: timelineMediaMaterialIds,
    // Reuse the same patch sink so localProxy* fields share the authoritative
    // React-state list the readiness gate + track masks read (C4 same-source).
    onPatch: patchMaterialCache,
    // C6 — surface a user-visible warning (not just console) when timeline
    // media exceeds the in-memory budget.
    onBudgetWarning: () => {
      try {
        showWarning(t.videoPlayerPanel.playback.localMediaOverBudget);
      } catch {
        // notification provider may be unavailable in tests — ignore.
      }
    },
  });

  // Bridge the LocalMediaCache eviction fn into the ref the earlier-declared
  // executeDelete reaches at call time (spec 06 §2.3).
  evictLocalMaterialRef.current = evictLocalMaterial;

  return {
    materials: filteredMaterials,
    allMaterials: materials,
    selectedMaterialType,
    selectedMaterials,
    isUploading,
    uploadProgress,
    handleMaterialTypeFilter,
    handleMaterialSelect,
    handleMaterialBatchSelect,
    handleMaterialDelete,
    discardPendingMaterials,
    handleMaterialUpload,
    handleDragUpload,
    addMaterials,
    addOrReplaceMaterial,
    confirmationDialog,
    handleCloseConfirmationDialog,
    handleAiVideoGenerate,
    handleAiImageGenerate,
    handleStoryboardGenerate,
    handleClearAllMaterials,
    // Exposed for the preview pipeline so VideoPlayerPanel can repair stale
    // cacheUrl entries when assignVideoSrcChecked falls back. See
    // docs/plans/video-reentry-play-no-source-fix/spec.md §3.2a.
    patchMaterialCache,
    // Round-2 client-preview: manual retry for a failed/degraded local download
    // (wired to the timeline track mask). See
    // docs/plans/video-editor-client-preview-download/spec.md §3.3.7 / #9.
    retryLocalDownload,
  };
};
