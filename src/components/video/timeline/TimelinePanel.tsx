'use client';

import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import { TimelineState, Track, TimelineItem, MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { SubtitleEditModal } from '../components';
import { useVideoCache } from '../hooks/useVideoCache';
import { useTimelineExport } from '../hooks/useTimelineExport';
import {
  useTimelineStore,
  removeItemsAction,
  addItemAction,
  addTrackAction,
} from './store';
import { useShallow } from 'zustand/react/shallow';
import TimelineToolbar from './TimelineToolbar';
import TimelineRuler from './TimelineRuler';
import TrackContainer from './TrackContainer';
import { clampVolume, VOLUME_DEFAULT } from './constants';
import { http, ApiError } from '@/lib/api/http-client';

// ---------------------------------------------------------------------------
// Inline throttle (avoids lodash dependency)
// ---------------------------------------------------------------------------
function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    const now = Date.now();
    const remaining = ms - (now - lastCall);
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      lastCall = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  }) as T;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface TimelinePanelProps {
  className?: string;
  onTimelineStateChange?: (timelineState: TimelineState) => void;
  externalCurrentTime?: number;
  onCurrentTimeChange?: (time: number) => void;
  materials?: MaterialItem[];
  onTimelineCompositionChange?: (timelineState: TimelineState) => void;
  materialsToAdd?: { materials: MaterialItem[], targetTrackId?: string, timestamp: number };
  taskId?: string;
  onImportComplete?: (importedMaterials: MaterialItem[], importedTimelineState: TimelineState) => void;
  externalTimelineState?: TimelineState;
  externalTimelineUpdateId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const TimelinePanel: React.FC<TimelinePanelProps> = ({
  className = '',
  onTimelineStateChange,
  externalCurrentTime,
  onCurrentTimeChange,
  materials = [],
  onTimelineCompositionChange,
  materialsToAdd,
  taskId = 'timeline',
  onImportComplete,
  externalTimelineState,
  externalTimelineUpdateId,
}) => {
  const { t, locale } = useLocale();
  const { showSuccess, showError, showInfo } = useNotification();

  // Hooks for side-effect features
  const videoCache = useVideoCache(taskId);
  const timelineExport = useTimelineExport(taskId);

  // Scroll sync refs
  const rulerScrollRef = useRef<HTMLDivElement | null>(null);
  const trackScrollRef = useRef<HTMLDivElement | null>(null);
  const isScrollingSyncRef = useRef(false);

  // Subtitle edit modal state (UI-only, not in store)
  const [isSubtitleEditModalOpen, setIsSubtitleEditModalOpen] = React.useState(false);
  const [editingTrackId, setEditingTrackId] = React.useState<string | null>(null);

  // Track last external update to avoid infinite loops
  const lastExternalUpdateIdRef = useRef<string | null>(null);
  const lastProcessedMaterialsTimestampRef = useRef<number | undefined>(undefined);

  // Track id awaiting auto-scroll after addTrack (consumed by TrackContainer).
  // State, not ref, so TrackContainer re-renders and its effect fires.
  const [pendingScrollTrackId, setPendingScrollTrackId] = React.useState<string | null>(null);
  const handleScrollConsumed = useCallback(() => {
    setPendingScrollTrackId(null);
  }, []);

  // Refs for stable callback access in mount-only effects (avoids stale closure)
  const onTimelineStateChangeRef = useRef(onTimelineStateChange);
  onTimelineStateChangeRef.current = onTimelineStateChange;
  const onTimelineCompositionChangeRef = useRef(onTimelineCompositionChange);
  onTimelineCompositionChangeRef.current = onTimelineCompositionChange;

  // ---------------------------------------------------------------------------
  // Store selectors
  // ---------------------------------------------------------------------------
  const { isDragging, isResizing, isInteracting } = useTimelineStore(
    useShallow((state) => ({ isDragging: state.isDragging, isResizing: state.isResizing, isInteracting: state.isInteracting })),
  );

  // ---------------------------------------------------------------------------
  // Initialize store on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const state = useTimelineStore.getState();
    // Only init if tracks are empty (first mount)
    if (state.tracks.length === 0) {
      const defaultTrack = (
        id: string,
        name: string,
        type: 'video' | 'audio' | 'subtitle',
        order: number,
        volume: number = VOLUME_DEFAULT,
        height = 80,
      ) => ({
        id, name, type, height,
        isLocked: false, isMuted: false, isVisible: true,
        volume: clampVolume(volume), order, items: [] as any[],
      });
      state.initTimeline({
        currentTime: 0,
        totalDuration: 0,
        zoomLevel: 1.0,
        playbackRate: 1.0,
        isPlaying: false,
        snapToGrid: true,
        gridSize: 0.5,
        scrollLeft: 0,
        tracks: [
          defaultTrack('video-track-1', `${t.timeline.track.videoTrack} 1`, 'video', 0),
          defaultTrack('image-track-1', `${t.timeline.track.imageTrack} 1`, 'video', 1),
          defaultTrack('audio-track-1', `${t.timeline.track.audioTrack} 1`, 'audio', 2, 100, 60),
          defaultTrack('audio-track-2', `${t.timeline.track.audioTrack} 2`, 'audio', 3, 100, 60),
          defaultTrack('subtitle-track-1', `${t.timeline.track.subtitleTrack} 1`, 'subtitle', 4, 100, 50),
        ],
      } as any);

      // Immediately sync initial state to parent so React state is seeded.
      // The subscription useEffect below runs AFTER this one, so it would
      // miss the initTimeline change — we must notify explicitly here.
      const freshState = useTimelineStore.getState();
      const ts: TimelineState = {
        currentTime: freshState.currentTime,
        totalDuration: freshState.totalDuration,
        zoomLevel: freshState.zoomLevel,
        selectedItems: freshState.selectedItems ?? [],
        tracks: freshState.tracks as Track[],
        playbackRate: freshState.playbackRate,
        isPlaying: freshState.isPlaying,
        snapToGrid: freshState.snapToGrid,
        gridSize: freshState.gridSize,
        scrollLeft: freshState.scrollLeft,
      };
      onTimelineStateChangeRef.current?.(ts);
      onTimelineCompositionChangeRef.current?.(ts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Sync store state changes to parent callbacks
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsub = useTimelineStore.subscribe((state) => {
      // Build a TimelineState-shaped object for legacy callbacks
      const ts: TimelineState = {
        currentTime: state.currentTime,
        totalDuration: state.totalDuration,
        zoomLevel: state.zoomLevel,
        selectedItems: state.selectedItems,
        tracks: state.tracks as Track[],
        playbackRate: state.playbackRate,
        isPlaying: state.isPlaying,
        snapToGrid: state.snapToGrid,
        gridSize: state.gridSize,
        scrollLeft: state.scrollLeft,
      };
      onTimelineStateChange?.(ts);
      onTimelineCompositionChange?.(ts);
    });
    return unsub;
  }, [onTimelineStateChange, onTimelineCompositionChange]);

  // ---------------------------------------------------------------------------
  // External time sync
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (externalCurrentTime !== undefined) {
      const current = useTimelineStore.getState().currentTime;
      if (Math.abs(externalCurrentTime - current) > 0.01) {
        useTimelineStore.getState().setCurrentTime(externalCurrentTime);
      }
    }
  }, [externalCurrentTime]);

  // ---------------------------------------------------------------------------
  // External timeline state sync (AI mixing etc.)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (externalTimelineState && externalTimelineUpdateId &&
        externalTimelineUpdateId !== lastExternalUpdateIdRef.current) {
      lastExternalUpdateIdRef.current = externalTimelineUpdateId;
      useTimelineStore.getState().importFromData(externalTimelineState as any);
      useTimelineStore.getState().clearHistory();
    }
  }, [externalTimelineState, externalTimelineUpdateId]);

  // ---------------------------------------------------------------------------
  // Global pointer event listeners for drag (throttled at 16ms)
  // ---------------------------------------------------------------------------
  // Track the initial pointer-down clientX for deltaX calculation
  const dragStartXRef = useRef(0);

  useEffect(() => {
    if (!isInteracting) return;

    // Capture the start position from the drag actor context if available
    const actor = useTimelineStore.getState()._dragActor;
    if (actor) {
      const snapshot = actor.getSnapshot();
      dragStartXRef.current = snapshot.context?.pointerDownPosition?.x ?? 0;
    }

    const handlePointerMove = throttle((e: PointerEvent) => {
      useTimelineStore.getState().updateDrag({
        type: 'POINTER_MOVE',
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.clientX - dragStartXRef.current,
      });
    }, 16);

    const handlePointerUp = (e: PointerEvent) => {
      useTimelineStore.getState().endDrag({
        type: 'POINTER_UP',
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useTimelineStore.getState().cancelDrag();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isInteracting]);

  // ---------------------------------------------------------------------------
  // Global keyboard shortcuts (Ctrl+Z, Ctrl+Y, Delete, Escape)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when focus is on input elements
      const active = document.activeElement;
      const isInput = active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        (active as HTMLElement).contentEditable === 'true'
      );
      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useTimelineStore.getState().undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useTimelineStore.getState().redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useTimelineStore.getState();
        if (state.selectedItems.length > 0) {
          e.preventDefault();
          removeItemsAction(() => useTimelineStore.getState(), state.selectedItems);
        }
      } else if (e.key === 'Escape') {
        useTimelineStore.getState().deselectAll();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, []);

  // ---------------------------------------------------------------------------
  // Material drop handler (external materials -> store)
  // ---------------------------------------------------------------------------
  const handleMaterialDrop = useCallback((material: MaterialItem, trackId: string) => {
    // Find the right track for this material
    const state = useTimelineStore.getState();
    let targetTrackId = trackId;

    // If specified track doesn't exist, auto-select compatible track
    const trackExists = state.tracks.some(t => t.id === targetTrackId);
    if (!trackExists) {
      const compatible = state.tracks.find(t => {
        if (material.type === 'image') return t.id === 'image-track-1' || t.type === 'video';
        if (material.type === 'video') return t.type === 'video' && !t.id.startsWith('image-track');
        if (material.type === 'audio') return t.type === 'audio';
        if (material.type === 'subtitle') return t.type === 'subtitle';
        return false;
      });
      if (compatible) {
        targetTrackId = compatible.id;
      } else {
        console.error(`[TimelinePanel] No compatible track found for material type: ${material.type}`);
        return;
      }
    }

    // Convert MaterialItem to MaterialData for the store
    const materialData = {
      id: material.id,
      name: material.name,
      type: material.type,
      url: material.url,
      serverUrl: material.serverUrl,
      duration: material.duration || 5,
      thumbnailUrl: material.thumbnailUrl,
      metadata: material.metadata,
      sentenceSegments: material.sentenceSegments,
    };

    addItemAction(() => useTimelineStore.getState(), targetTrackId, materialData as any);

    // Trigger video preload
    if (material.type === 'video') {
      const videoUrl = material.serverUrl || material.url;
      if (videoUrl && material.id) {
        videoCache.preloadVideo(videoUrl, material.id).catch(() => {});
      }
    }
  }, [videoCache]);

  // ---------------------------------------------------------------------------
  // Programmatic material add (from external)
  // ---------------------------------------------------------------------------
  const handleAddMaterialsToTimeline = useCallback((mats: MaterialItem[], targetTrackId?: string) => {
    mats.forEach((material, index) => {
      setTimeout(() => {
        const state = useTimelineStore.getState();
        // Auto-find compatible track
        let tid = targetTrackId;
        if (!tid) {
          const compatible = state.tracks.find(t => {
            if (material.type === 'image') return t.id === 'image-track-1' || t.type === 'video';
            if (material.type === 'video') return t.type === 'video' && !t.id.startsWith('image-track');
            if (material.type === 'audio') return t.type === 'audio';
            if (material.type === 'subtitle') return t.type === 'subtitle';
            return false;
          });
          tid = compatible?.id;
        }
        if (tid) {
          handleMaterialDrop(material, tid);
        }
      }, index * 10);
    });
  }, [handleMaterialDrop]);

  useEffect(() => {
    if (!materialsToAdd || materialsToAdd.materials.length === 0) return;
    if (materialsToAdd.timestamp === lastProcessedMaterialsTimestampRef.current) return;
    lastProcessedMaterialsTimestampRef.current = materialsToAdd.timestamp;
    handleAddMaterialsToTimeline(materialsToAdd.materials, materialsToAdd.targetTrackId);
  }, [materialsToAdd, handleAddMaterialsToTimeline]);

  // ---------------------------------------------------------------------------
  // Track operations — delegates to addTrackAction; wrapper supplies i18n name
  // and captures the new trackId for auto-scroll.
  // ---------------------------------------------------------------------------
  const handleAddTrack = useCallback((type: 'video' | 'image' | 'audio' | 'subtitle') => {
    const baseTrackName =
      type === 'video' ? t.timeline.track.videoTrack :
      type === 'image' ? t.timeline.track.imageTrack :
      type === 'audio' ? t.timeline.track.audioTrack :
      t.timeline.track.subtitleTrack;

    const { trackId } = addTrackAction(
      () => useTimelineStore.getState(),
      { type, baseTrackName },
    );
    setPendingScrollTrackId(trackId);
  }, [t]);

  // ---------------------------------------------------------------------------
  // Toolbar action handlers (complex operations not in store)
  // ---------------------------------------------------------------------------
  const handleCut = useCallback(() => {
    // placeholder
  }, []);

  const handleCopy = useCallback(() => {
    const state = useTimelineStore.getState();
    if (state.selectedItems.length === 0) return;

    // Collect selected items
    const selectedItemsList: any[] = [];
    state.tracks.forEach(track => {
      track.items.forEach((item: any) => {
        if (state.selectedItems.includes(item.id)) {
          selectedItemsList.push({ ...item, trackId: track.id });
        }
      });
    });

    if (selectedItemsList.length === 0) return;

    // Group by track
    const itemsByTrack: Record<string, any[]> = {};
    selectedItemsList.forEach(item => {
      if (!itemsByTrack[item.trackId]) itemsByTrack[item.trackId] = [];
      itemsByTrack[item.trackId].push(item);
    });

    // Record history
    state.recordAction('ADD_ITEM', {
      operation: 'copy',
      selectedItemIds: state.selectedItems,
    });

    // Create copies - use exportToData/importFromData to safely mutate
    const currentData = state.exportToData();
    const newSelectedIds: string[] = [];

    const updatedTracks = currentData.tracks.map((track: any) => {
      const trackItems = itemsByTrack[track.id];
      if (!trackItems || trackItems.length === 0) return track;

      const trackEndTime = track.items.length > 0
        ? Math.max(...track.items.map((i: any) => (i.startTime || 0) + (i.duration || 0)))
        : 0;

      let placementTime = trackEndTime;
      const copies: any[] = [];

      trackItems.forEach((original: any) => {
        const newId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        copies.push({
          ...original,
          id: newId,
          name: t.timeline.track.copyOf.replace('{name}', original.name),
          startTime: placementTime,
        });
        newSelectedIds.push(newId);
        placementTime += original.duration || 0;
      });

      return { ...track, items: [...track.items, ...copies] };
    });

    state.importFromData({ ...currentData, tracks: updatedTracks });

    // Schedule after-snapshot
    requestAnimationFrame(() => {
      useTimelineStore.getState().captureNextState();
    });
  }, []);

  const handleOrganizeMaterials = useCallback(() => {
    const state = useTimelineStore.getState();
    const hasItems = state.tracks.some(t =>
      (t.type === 'video' || t.type === 'audio') && t.items.length > 0
    );

    if (!hasItems) {
      showError(t.timeline.messages.organizeMaterialsNoItems);
      return;
    }

    state.recordAction('UPDATE_ITEM', {
      operation: 'organize_materials',
      description: t.timeline.messages.organizeMaterialsDescription,
    });

    const currentData = state.exportToData();
    const updatedTracks = currentData.tracks.map((track: any) => {
      if (track.type !== 'video' && track.type !== 'audio') return track;
      if (!track.items || track.items.length === 0) return track;

      const sorted = [...track.items].sort((a: any, b: any) => (a.startTime || 0) - (b.startTime || 0));
      let ct = 0;
      const organized = sorted.map((item: any) => {
        const result = { ...item, startTime: ct };
        ct += item.duration || 0;
        return result;
      });
      return { ...track, items: organized };
    });

    state.importFromData({ ...currentData, tracks: updatedTracks });

    requestAnimationFrame(() => {
      useTimelineStore.getState().captureNextState();
    });

    showSuccess(t.timeline.messages.organizeMaterialsSuccess);
  }, [showSuccess, showError, t]);

  const handleAddEffect = useCallback(() => {
    showInfo(t.timeline.messages.effectsRequireSelection, 4000);
  }, [showInfo, t]);

  const handleAddTransition = useCallback(() => {
    showInfo(t.timeline.messages.transitionsRequireSelection, 4000);
  }, [showInfo, t]);

  // ---------------------------------------------------------------------------
  // Subtitle extraction (kept as local handler - complex API call)
  // ---------------------------------------------------------------------------
  const handleAddSubtitle = useCallback(async () => {
    const state = useTimelineStore.getState();
    useTimelineStore.getState().setExtractingSubtitles(true);

    try {
      const audioTracks = state.tracks.filter(t => t.type === 'audio');
      const allAudioItems: any[] = [];
      audioTracks.forEach(track => {
        track.items.forEach((item: any) => {
          if (item.type === 'audio' && item.materialId) {
            allAudioItems.push(item);
          }
        });
      });

      if (allAudioItems.length === 0) {
        showError(t.timeline.messages.noAudioItems);
        return;
      }

      const audioItemsForTranscription = allAudioItems.map(item => {
        const material = materials?.find(m => m.id === item.materialId);
        const audioUrl = material?.serverUrl || material?.url || '';
        return {
          id: item.id,
          name: item.name,
          url: audioUrl,
          start_time: item.startTime,
          duration: item.duration,
          track_id: item.trackId,
          clip_start: item.clipStart || 0.0,
          clip_end: item.clipEnd || (item.originalDuration || item.duration),
        };
      });

      let result: any;
      try {
        result = await http.post<any>('/api/audio/batch-transcribe', {
          audio_items: audioItemsForTranscription,
          language: 'zh-CN',
          use_itn: true,
          use_punc: false,
          max_lines: 2,
          words_per_line: 15,
          generate_srt_file: true,
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(`批量转录请求失败: ${httpError.status}`);
        }
        throw httpError;
      }
      if (!result.success) throw new Error(`批量转录失败: ${result.error || '未知错误'}`);

      const subtitleTrack = state.tracks.find(t => t.type === 'subtitle');
      if (!subtitleTrack) {
        showError(t.timeline.messages.noSubtitleTrack);
        return;
      }

      const hasExisting = subtitleTrack.items.length > 0;
      const newSubtitleItems: any[] = [];

      result.transcriptions.forEach((transcription: any) => {
        if (transcription.success && transcription.subtitles?.length > 0) {
          transcription.subtitles.forEach((subtitle: any, index: number) => {
            const startTime = subtitle.start_time / 1000;
            const endTime = subtitle.end_time / 1000;
            newSubtitleItems.push({
              id: `subtitle_${transcription.audio_item_id}_${index}_${Date.now()}`,
              name: `${t.timeline.messages.subtitlePrefix}: ${subtitle.text.substring(0, 20)}${subtitle.text.length > 20 ? '...' : ''}`,
              type: 'subtitle',
              startTime,
              duration: endTime - startTime,
              trackId: subtitleTrack.id,
              color: '#f59e0b',
              text: subtitle.text,
              materialId: `subtitle_material_${transcription.audio_item_id}_${index}`,
              volume: 1.0,
              opacity: 1.0,
            });
          });
        }
      });

      if (newSubtitleItems.length === 0) {
        showError(t.timeline.messages.subtitleExtractionFailed);
        return;
      }

      // Update via export/import
      const currentData = useTimelineStore.getState().exportToData();
      const updatedTracks = currentData.tracks.map((track: any) => {
        if (track.id === subtitleTrack.id) {
          return { ...track, items: newSubtitleItems };
        }
        return track;
      });
      useTimelineStore.getState().importFromData({ ...currentData, tracks: updatedTracks });

      const operationText = hasExisting ? t.timeline.messages.operationReplaced : t.timeline.messages.operationGenerated;
      showSuccess(
        t.timeline.messages.subtitleExtractionSuccess
          .replace('{operation}', operationText)
          .replace('{count}', newSubtitleItems.length.toString())
      );
    } catch (error) {
      showError(t.timeline.messages.subtitleExtractionError.replace('{error}', error instanceof Error ? error.message : '未知错误'));
    } finally {
      useTimelineStore.getState().setExtractingSubtitles(false);
    }
  }, [materials, showSuccess, showError, t]);

  // ---------------------------------------------------------------------------
  // JSON import handler
  // ---------------------------------------------------------------------------
  const handleImportJSON = useCallback(async (file: File) => {
    useTimelineStore.getState().setImporting(true);

    try {
      const fileContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          content ? resolve(content) : reject(new Error('Failed to read file'));
        };
        reader.onerror = () => reject(new Error('File reading error'));
        reader.readAsText(file);
      });

      let result: any;
      try {
        result = await http.post<any>('/api/timeline-import', {
          taskId,
          fileContent,
          fileName: file.name,
          mergeMode: 'replace',
          preserveIds: false,
        }, { timeoutMs: 300_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || `导入失败: ${httpError.status}`);
        }
        throw httpError;
      }

      if (!result.success) throw new Error(result.error || '导入失败');

      const importedData = result.importedData;
      if (importedData?.timelineState && importedData?.materials) {
        useTimelineStore.getState().importFromData(importedData.timelineState as any);
        useTimelineStore.getState().clearHistory();

        onImportComplete?.(importedData.materials, importedData.timelineState);
        onTimelineStateChange?.(importedData.timelineState);

        showSuccess(
          t.timeline.messages.importProjectSuccess
            .replace('{trackCount}', String(result.statistics?.imported_track_count || 0))
            .replace('{materialCount}', String(result.statistics?.imported_material_count || 0)),
        );
      } else {
        throw new Error(t.timeline.messages.importProjectInvalidData);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : t.timeline.messages.exportUnknownError;
      showError(t.timeline.messages.importProjectError.replace('{error}', errMsg));
    } finally {
      useTimelineStore.getState().setImporting(false);
    }
  }, [taskId, onImportComplete, onTimelineStateChange, showSuccess, showError, t]);

  // ---------------------------------------------------------------------------
  // Subtitle editing (modal state)
  // ---------------------------------------------------------------------------
  const handleSubtitleEdit = useCallback((itemId: string, newText: string) => {
    useTimelineStore.getState().updateItemSubtitle(itemId, newText);
  }, []);

  const handleEditSubtitles = useCallback((trackId: string) => {
    setEditingTrackId(trackId);
    setIsSubtitleEditModalOpen(true);
  }, []);

  const handleCloseSubtitleEditModal = useCallback(() => {
    setIsSubtitleEditModalOpen(false);
    setEditingTrackId(null);
  }, []);

  const handleSaveSubtitleChanges = useCallback((updatedSubtitles: TimelineItem[]) => {
    if (!editingTrackId) return;
    const state = useTimelineStore.getState();
    const currentData = state.exportToData();
    const updatedTracks = currentData.tracks.map((track: any) =>
      track.id === editingTrackId ? { ...track, items: updatedSubtitles } : track
    );
    state.importFromData({ ...currentData, tracks: updatedTracks });
    handleCloseSubtitleEditModal();
  }, [editingTrackId, handleCloseSubtitleEditModal]);

  const memoizedSubtitles = useMemo(() => {
    if (!editingTrackId) return [];
    const tracks = useTimelineStore.getState().tracks;
    const track = tracks.find((t: any) => t.id === editingTrackId);
    return (track?.items.filter((item: any) => item.type === 'subtitle') || []) as TimelineItem[];
  }, [editingTrackId]);

  // ---------------------------------------------------------------------------
  // Scroll sync between ruler and track container
  // ---------------------------------------------------------------------------
  const handleRulerScroll = useCallback((scrollLeftVal: number) => {
    if (isScrollingSyncRef.current) return;
    isScrollingSyncRef.current = true;
    if (trackScrollRef.current) {
      trackScrollRef.current.scrollLeft = scrollLeftVal;
    }
    useTimelineStore.getState().setScrollLeft(scrollLeftVal);
    requestAnimationFrame(() => { isScrollingSyncRef.current = false; });
  }, []);

  const handleTrackScroll = useCallback((scrollLeftVal: number) => {
    if (isScrollingSyncRef.current) return;
    isScrollingSyncRef.current = true;
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = scrollLeftVal;
    }
    useTimelineStore.getState().setScrollLeft(scrollLeftVal);
    requestAnimationFrame(() => { isScrollingSyncRef.current = false; });
  }, []);

  // ---------------------------------------------------------------------------
  // Notify parent of current time changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!onCurrentTimeChange) return;
    const unsub = useTimelineStore.subscribe(
      (state) => state.currentTime,
      (currentTime) => { onCurrentTimeChange(currentTime); },
    );
    return unsub;
  }, [onCurrentTimeChange]);

  // ---------------------------------------------------------------------------
  // Export JSON helper
  // ---------------------------------------------------------------------------
  const handleExportJSON = useCallback(() => {
    const state = useTimelineStore.getState();
    const ts: TimelineState = {
      currentTime: state.currentTime,
      totalDuration: state.totalDuration,
      zoomLevel: state.zoomLevel,
      selectedItems: state.selectedItems,
      tracks: state.tracks as Track[],
      playbackRate: state.playbackRate,
      isPlaying: state.isPlaying,
      snapToGrid: state.snapToGrid,
      gridSize: state.gridSize,
      scrollLeft: state.scrollLeft,
    };
    timelineExport.exportTimelineToJSON(ts, materials);
  }, [timelineExport, materials]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      className={`timeline-panel flex flex-col h-full bg-card ${className}`}
      tabIndex={0}
    >
      {/* 工具栏 */}
      <TimelineToolbar
        onExportJSON={handleExportJSON}
        onImportJSON={handleImportJSON}
        onOrganizeMaterials={handleOrganizeMaterials}
        onCut={handleCut}
        onCopy={handleCopy}
        onAddEffect={handleAddEffect}
        onAddTransition={handleAddTransition}
        onAddSubtitle={handleAddSubtitle}
      />

      {/* 时间刻度尺 */}
      <TimelineRuler
        scrollRef={rulerScrollRef}
        onScroll={handleRulerScroll}
      />

      {/* 轨道容器 */}
      <TrackContainer
        scrollRef={trackScrollRef}
        onScroll={handleTrackScroll}
        onEditSubtitles={handleEditSubtitles}
        onAddTrack={handleAddTrack}
        pendingScrollTrackId={pendingScrollTrackId}
        onScrollConsumed={handleScrollConsumed}
      />

      {/* 字幕编辑模态框 */}
      {editingTrackId && (
        <SubtitleEditModal
          isOpen={isSubtitleEditModalOpen}
          onClose={handleCloseSubtitleEditModal}
          onSave={handleSaveSubtitleChanges}
          subtitles={memoizedSubtitles}
          taskId="timeline_subtitle_edit"
          locale={locale}
        />
      )}
    </div>
  );
};

export default TimelinePanel;
