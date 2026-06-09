'use client';

import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import { TimelineState, Track, TimelineItem, MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { SubtitleEditModal } from '../components';
import { useVideoCache } from '../hooks/useVideoCache';
import { selectPlaybackUrl } from '../lib/selectPlaybackUrl';
import { selectAudioPlaybackUrl } from '@/lib/utils/audioUrl';
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
import type { LocalProxyMaskState } from './TimelineItem';
import { isLocalPreviewEnabled } from '@/lib/playbackFlags';
import { canPreviewDirectLocalMaterial } from '../lib/localMaterial';
import { clampVolume, VOLUME_DEFAULT, getDefaultTrackHeight, type TrackKind } from './constants';
import { http, ApiError } from '@/lib/api/http-client';
import { TimelineRepository } from './infrastructure';
import type { MaterialData } from './domain';

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
  /** Round-2 client-preview: manual retry for a failed/degraded local download. */
  onRetryLocalDownload?: (materialId: string) => void;
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
  onRetryLocalDownload,
}) => {
  const { t, locale } = useLocale();
  const { showSuccess, showError, showInfo } = useNotification();

  // Round-2 client-preview: lock the flag at mount and derive a compact
  // localProxy status map (keyed by materialId) from the SAME authoritative
  // `materials` list the readiness gate reads — no dual data source (C4).
  // Only video/audio carry a mask (C2: image/subtitle excluded). The map
  // identity changes whenever any localProxy* field changes, re-rendering items.
  const localPreviewEnabled = useMemo(() => isLocalPreviewEnabled(), []);
  const localProxyStatusMap = useMemo(() => {
    const map = new Map<string, LocalProxyMaskState>();
    if (!localPreviewEnabled) return map;
    materials.forEach((m) => {
      if (m.type !== 'video' && m.type !== 'audio') return;
      if (canPreviewDirectLocalMaterial(m)) return;
      if (m.localProxyStatus === undefined && m.localProxyProgress === undefined) return;
      map.set(m.id, { status: m.localProxyStatus, progress: m.localProxyProgress });
    });
    return map;
  }, [materials, localPreviewEnabled]);

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

  // Snapshot of the last emitted timeline-shape JSON. Used to suppress
  // duplicate emits with byte-identical content from either the explicit
  // mount-time emit or the subscribe path. Only timeline-shape fields are
  // compared (not transient ones like isInteracting/isDragging) so legitimate
  // user edits still propagate.
  const lastEmittedShapeJsonRef = useRef<string>('');
  const computeShapeJson = useCallback((ts: TimelineState): string => {
    try {
      return JSON.stringify({
        tracks: ts.tracks,
        currentTime: ts.currentTime,
        totalDuration: ts.totalDuration,
        zoomLevel: ts.zoomLevel,
        playbackRate: ts.playbackRate,
        scrollLeft: ts.scrollLeft,
        snapToGrid: ts.snapToGrid,
        gridSize: ts.gridSize,
        isPlaying: ts.isPlaying,
      });
    } catch {
      // Cyclic / non-serialisable structure — let the emit through; better
      // to risk a duplicate than to silently drop a real change.
      return '';
    }
  }, []);

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
    // Hydration is owned by VideoEditorContainer (project list flow): it calls
    // useTimelineStore.importFromData(persisted) BEFORE setContent, so when we
    // mount with non-empty tracks, the persisted timeline is already loaded
    // and we skip the default-init branch. The branch below only runs for
    // fresh projects (no persisted timeline) and for entry points that don't
    // hydrate (legacy task-pane mounts).
    if (state.tracks.length === 0) {
      // Default-generated tracks carry an empty name; Track.tsx:trackDisplayName
      // derives a locale-aware label from the id prefix at render time, so
      // language switches immediately reflect in the track header. User
      // renames write a non-empty string which takes precedence.
      const defaultTrack = (
        id: string,
        name: string,
        type: 'video' | 'audio' | 'subtitle',
        order: number,
        volume: number = VOLUME_DEFAULT,
        height?: number,
      ) => ({
        id, name, type,
        height: height ?? getDefaultTrackHeight(
          id.startsWith('image-track') ? 'image' : (type as TrackKind)
        ),
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
          defaultTrack('video-track-1',    '', 'video',    0),
          defaultTrack('image-track-1',    '', 'video',    1),
          defaultTrack('audio-track-1',    '', 'audio',    2),
          defaultTrack('audio-track-2',    '', 'audio',    3),
          defaultTrack('subtitle-track-1', '', 'subtitle', 4),
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
      const shapeJson = computeShapeJson(ts);
      if (shapeJson === '' || shapeJson !== lastEmittedShapeJsonRef.current) {
        lastEmittedShapeJsonRef.current = shapeJson;
        onTimelineStateChangeRef.current?.(ts);
        onTimelineCompositionChangeRef.current?.(ts);
      }
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
      // Suppress emits whose timeline-shape is byte-identical to the last
      // one we sent. Pure-transient-only state changes (selection, drag
      // flags) are excluded from the shape JSON, so they don't propagate
      // here — that's intentional: parent autosave doesn't care about them.
      const shapeJson = computeShapeJson(ts);
      if (shapeJson !== '' && shapeJson === lastEmittedShapeJsonRef.current) {
        return;
      }
      lastEmittedShapeJsonRef.current = shapeJson;
      onTimelineStateChange?.(ts);
      onTimelineCompositionChange?.(ts);
    });
    return unsub;
  }, [onTimelineStateChange, onTimelineCompositionChange, computeShapeJson]);

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
  // Global keyboard shortcuts
  // Refs are assigned further down after the handlers are declared, so the
  // document-level listener always reaches the latest closures without
  // re-subscribing. Placeholder values keep types honest before assignment.
  // ---------------------------------------------------------------------------
  const handleCopyRef = useRef<() => void>(() => {});
  const handleExportJSONRef = useRef<() => void>(() => {});
  const handleAddEffectRef = useRef<() => void>(() => {});
  const handleAddTransitionRef = useRef<() => void>(() => {});
  const handleAddSubtitleRef = useRef<() => void | Promise<void>>(() => {});

  useEffect(() => {
    // Only these input types are text-editing; range/checkbox/button etc. share
    // tagName='INPUT' but must NOT swallow global shortcuts (Ctrl+Z, Ctrl+E, …).
    const EDITABLE_INPUT_TYPES = new Set([
      'text', 'search', 'email', 'password', 'url', 'tel', 'number', 'date',
      'datetime-local', 'month', 'time', 'week',
    ]);
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when focus is on text-editing elements.
      const active = document.activeElement as (HTMLElement & Partial<HTMLInputElement>) | null;
      const isEditableInput =
        !!active &&
        active.tagName === 'INPUT' &&
        EDITABLE_INPUT_TYPES.has(((active as HTMLInputElement).type || 'text').toLowerCase()) &&
        !(active as HTMLInputElement).readOnly &&
        !(active as HTMLInputElement).disabled;
      const isTextInput = !!active && (
        isEditableInput ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable === true
      );
      if (isTextInput) return;

      // Bare-letter shortcuts (e/t/s) must NOT fire while a non-text interactive
      // widget (button, select, link, role=button/slider/...) has focus — users
      // expect the space/enter of those widgets to be separate from editor hotkeys.
      // Ctrl-chords (undo/redo/copy/export) stay global, and so do Delete/Escape.
      const isInteractive = !!active && (
        active.tagName === 'BUTTON' ||
        active.tagName === 'SELECT' ||
        active.tagName === 'A' ||
        (typeof active.matches === 'function' && active.matches(
          '[role="button"],[role="slider"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="tab"],[role="option"],[role="switch"],[role="checkbox"],[role="radio"]'
        ))
      );

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useTimelineStore.getState().undo();
      } else if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useTimelineStore.getState().redo();
      } else if (ctrl && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        handleCopyRef.current();
      } else if (ctrl && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        // Defensive short-circuit — export hook also guards synchronously via ref.
        if (useTimelineStore.getState().isExporting) return;
        handleExportJSONRef.current();
      } else if (!ctrl && !e.shiftKey && !e.altKey && !isInteractive && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        handleAddEffectRef.current();
      } else if (!ctrl && !e.shiftKey && !e.altKey && !isInteractive && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        handleAddTransitionRef.current();
      } else if (!ctrl && !e.shiftKey && !e.altKey && !isInteractive && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void handleAddSubtitleRef.current();
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
    const materialData: MaterialData = {
      id: material.id,
      name: material.name,
      type: material.type,
      url: material.url,
      serverUrl: material.serverUrl,
      cacheUrl: material.cacheUrl,
      storageKey: material.storageKey,
      duration: material.duration || 5,
      thumbnailUrl: material.thumbnailUrl,
      metadata: material.metadata,
      sentenceSegments: material.sentenceSegments,
    };

    addItemAction(() => useTimelineStore.getState(), targetTrackId, materialData);

    // Trigger video preload
    if (material.type === 'video') {
      // 优先预热同源 cacheUrl（远程素材已被 useRemoteMaterialPrefetch 预下载
      // 到 cached_materials；命中后 <video> Range 走本地 200ms 内首字节）。
      // 未命中时回落到 serverUrl||url，与历史行为一致。
      const previewUrl =
        selectPlaybackUrl(material, { purpose: 'preview' }) ||
        material.serverUrl ||
        material.url;
      if (previewUrl && material.id) {
        videoCache.preloadVideo(previewUrl, material.id).catch(() => {});
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

    // Copy appends at the end of each track; auto-organize so the new items
    // participate in the same flush-from-0 invariant as any other mutation.
    useTimelineStore.getState().autoOrganize();

    // Schedule after-snapshot
    requestAnimationFrame(() => {
      useTimelineStore.getState().captureNextState();
    });
  }, [t]);

  const handleOrganizeMaterials = useCallback(() => {
    const state = useTimelineStore.getState();
    const hasItems = state.tracks.some(t =>
      (t.type === 'video' || t.type === 'audio') && t.items.length > 0
    );

    if (!hasItems) {
      showInfo(t.timeline.messages.organizeMaterialsNoItems, 3000);
      return;
    }

    // Reuse the UPDATE_ITEM action type so existing history filters keep
    // working; autoOrganize does the actual packing.
    state.recordAction('UPDATE_ITEM', {
      operation: 'organize_materials',
      description: t.timeline.messages.organizeMaterialsDescription,
    });

    state.autoOrganize();

    requestAnimationFrame(() => {
      useTimelineStore.getState().captureNextState();
    });

    showSuccess(t.timeline.messages.organizeMaterialsSuccess);
  }, [showSuccess, showInfo, t]);

  const handleAddEffect = useCallback(() => {
    showInfo(t.timeline.messages.featureComingSoon, 3000);
  }, [showInfo, t]);

  const handleAddTransition = useCallback(() => {
    showInfo(t.timeline.messages.featureComingSoon, 3000);
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
        // iter5: never send blob: URLs to backend transcription.
        const resolved = material ? selectAudioPlaybackUrl(material) : null;
        const audioUrl = resolved && !resolved.startsWith('blob:')
          ? resolved
          : (material?.serverUrl || '');
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
          throw new Error(
            t.timeline.messages.batchTranscriptionRequestFailed.replace('{status}', String(httpError.status))
          );
        }
        throw httpError;
      }
      if (!result.success) {
        const reason = result.error || t.timeline.messages.subtitleExtractionUnknownError;
        throw new Error(
          t.timeline.messages.batchTranscriptionFailed.replace('{error}', reason)
        );
      }

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
      const msg = error instanceof Error ? error.message : t.timeline.messages.subtitleExtractionUnknownError;
      showError(t.timeline.messages.subtitleExtractionError.replace('{error}', msg));
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
      const fileContent = await file.text();

      // Pre-validate locally so obviously-invalid files do not round-trip
      // through /api/timeline-import (which would 400 with a noisy stack).
      let parsed: unknown;
      try {
        parsed = JSON.parse(fileContent);
      } catch {
        throw new Error(t.timeline.messages.importProjectInvalidData);
      }
      const validator = new TimelineRepository();
      if (!validator.validateExportData(parsed)) {
        throw new Error(t.timeline.messages.importProjectInvalidData);
      }

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
          throw new Error(
            httpError.message ||
              `${t.timeline.messages.importProjectInvalidData} (${httpError.status})`,
          );
        }
        throw httpError;
      }

      if (!result.success)
        throw new Error(result.error || t.timeline.messages.importProjectInvalidData);

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
      const raw = error instanceof Error ? error.message : '';
      // Backend may leak Python dict/Pydantic ValidationError str repr into
      // error.message; collapse those into a friendly localised fallback.
      const looksLikePythonDump =
        /^\s*\{['"]/.test(raw) ||
        raw.includes("{'") ||
        raw.includes('errors.pydantic.dev');
      const friendly = looksLikePythonDump
        ? t.timeline.messages.importProjectInvalidData
        : (raw || t.timeline.messages.exportUnknownError);
      showError(t.timeline.messages.importProjectError.replace('{error}', friendly));
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[TimelinePanel] Import failed (raw)', { raw });
      }
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
  // 写入对方容器后，回读浏览器实际生效的 scrollLeft 作为兜底，
  // 防止上游误传超出可滚动范围的值导致 Ruler / Track / store 三者错位。
  const handleRulerScroll = useCallback((scrollLeftVal: number) => {
    if (isScrollingSyncRef.current) return;
    isScrollingSyncRef.current = true;
    let effective = scrollLeftVal;
    if (trackScrollRef.current) {
      trackScrollRef.current.scrollLeft = scrollLeftVal;
      effective = trackScrollRef.current.scrollLeft;
      if (rulerScrollRef.current && rulerScrollRef.current.scrollLeft !== effective) {
        rulerScrollRef.current.scrollLeft = effective;
      }
    }
    useTimelineStore.getState().setScrollLeft(effective);
    requestAnimationFrame(() => { isScrollingSyncRef.current = false; });
  }, []);

  const handleTrackScroll = useCallback((scrollLeftVal: number) => {
    if (isScrollingSyncRef.current) return;
    isScrollingSyncRef.current = true;
    let effective = scrollLeftVal;
    if (trackScrollRef.current) {
      effective = trackScrollRef.current.scrollLeft;
    }
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = effective;
    }
    useTimelineStore.getState().setScrollLeft(effective);
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

  // Assign-in-render: keeps the document keydown listener reaching the
  // latest handler closures without re-subscribing every render.
  handleCopyRef.current = handleCopy;
  handleExportJSONRef.current = handleExportJSON;
  handleAddEffectRef.current = handleAddEffect;
  handleAddTransitionRef.current = handleAddTransition;
  handleAddSubtitleRef.current = handleAddSubtitle;

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
        localProxyStatusMap={localProxyStatusMap}
        localPreviewEnabled={localPreviewEnabled}
        onRetryLocalDownload={onRetryLocalDownload}
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
