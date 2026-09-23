'use client';

import React, { useCallback, useEffect, useImperativeHandle, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TimelineState, Track, TimelineItem, MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { SubtitleEditModal, CameraMotionModal } from '../components';
import { useVideoCache } from '../hooks/useVideoCache';
import { selectPlaybackUrl } from '../lib/selectPlaybackUrl';
import { useTimelineExport } from '../hooks/useTimelineExport';
import {
  useTimelineStore,
  removeItemsAction,
  addTrackAction,
  setCameraMotionAction,
} from './store';
import { useShallow } from 'zustand/react/shallow';
import TimelineToolbar from './TimelineToolbar';
import TimelineRuler from './TimelineRuler';
import TrackContainer from './TrackContainer';
import DragTimeBadge from './DragTimeBadge';
import type { LocalProxyMaskState } from './TimelineItem';
import { isLocalPreviewEnabled } from '@/lib/playbackFlags';
import { canPreviewDirectLocalMaterial } from '../lib/localMaterial';
import { clampVolume, VOLUME_DEFAULT, getDefaultTrackHeight, type TrackKind } from './constants';
import { http, ApiError } from '@/lib/api/http-client';
import { TimelineRepository } from './infrastructure';
import {
  shouldTimelineHandleCopyShortcut,
  shouldTimelineHandleKeyEvent,
  resolveTimelineShortcut,
  shouldShortcutRunDuringInteraction,
  MUTATING_TIMELINE_SHORTCUTS,
  type TimelineShortcut,
} from './shortcutOwnership';
import type { TimelineData } from './domain';
import { tracksEqual } from './domain/services/snapshotEquality';
import { duplicateSelectedClips } from './lib/duplicateClips';
import { dropMaterialWithDuration } from './lib/dropMaterialWithDuration';
import { createMissingMaterialPredicate } from './lib/missingMaterial';
import { replaceTimelineAction } from './store/actions/replaceTimeline';
import { updateSubtitleTextAction } from './store/actions/updateItemFields';
import { isEditLocked } from './store/editLock';
import type { TimelineStore } from './store/useTimelineStore';
import { reasonFromExternalUpdateId } from './lib/externalUpdateId';
import {
  collectTranscriptionItems,
  getSubtitleCommitBlocker,
  getSubtitleReplacementBlocker,
  type SubtitleCommitBlocker,
} from './lib/subtitleReplacement';
import { findTrackForMaterial } from './lib/trackForMaterial';
import { isClipVisibleInLane } from './lib/clipVisibility';
import { useAnchoredZoom, useTimelineWheel } from './hooks/useTimelineWheel';
import { useFollowPlayhead } from './hooks/useFollowPlayhead';
import { useRevealSelectedSegment } from './hooks/useRevealSelectedSegment';
import { TRACK_HEADER_WIDTH } from './theme/timelineTheme';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { canApplyCameraMotion } from '../playback/camera/eligibility';
import type { CameraMotion } from '../playback/camera';

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

/** Store → the legacy `TimelineState` shape the owner's callbacks consume. */
function toTimelineState(state: TimelineStore): TimelineState {
  return {
    currentTime: state.currentTime,
    totalDuration: state.totalDuration,
    zoomLevel: state.zoomLevel,
    selectedItems: state.selectedItems ?? [],
    tracks: state.tracks as Track[],
    playbackRate: state.playbackRate,
    isPlaying: state.isPlaying,
    snapToGrid: state.snapToGrid,
    gridSize: state.gridSize,
    scrollLeft: state.scrollLeft,
  };
}

/** External writes the agent may make while it holds the edit lock. */
function isAgentReason(reason: ReturnType<typeof reasonFromExternalUpdateId>): boolean {
  return reason === 'agent' || reason === 'agent-undo';
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
  /** The material library has loaded, so a clip without its material is really missing (N-01). */
  materialsLoaded?: boolean;
}

/**
 * Imperative entry points for the Properties inspector (spec §3.7.2). Each
 * reuses the handler the timeline's own buttons call, so the inspector can
 * never open a dialog the timeline would have refused.
 */
export interface TimelinePanelHandle {
  /** Camera-motion panel for a clip; ignored when the clip is ineligible. */
  openCameraMotion(itemId: string): void;
  /** Subtitle edit / style dialog for a subtitle track. */
  openSubtitleStyle(trackId: string): void;
}

/**
 * Script-selection → timeline scroll, in its own leaf so segment-context
 * updates re-render nothing but this null component.
 */
const SelectedSegmentReveal: React.FC<{
  trackScrollRef: React.RefObject<HTMLDivElement | null>;
}> = ({ trackScrollRef }) => {
  useRevealSelectedSegment(trackScrollRef);
  return null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const TimelinePanel = React.forwardRef<TimelinePanelHandle, TimelinePanelProps>(({
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
  materialsLoaded = false,
}, ref) => {
  const { t, locale } = useLocale();
  const { showSuccess, showError, showInfo, showWarning } = useNotification();

  // Round-2 client-preview: lock the flag at mount and derive a compact
  // localProxy status map (keyed by materialId) from the SAME authoritative
  // `materials` list the readiness gate reads — no dual data source (C4).
  // Only video/audio carry a mask (C2: image/subtitle excluded). The map
  // identity changes whenever any localProxy* field changes, re-rendering items.
  const localPreviewEnabled = useMemo(() => isLocalPreviewEnabled(), []);
  // A material drop may await a duration probe; its result must not land after unmount.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const isMaterialMissing = useMemo(
    () => createMissingMaterialPredicate(materials, materialsLoaded),
    [materials, materialsLoaded],
  );

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

  // Positioned root: the drag time badge is placed relative to it.
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Scroll sync refs
  const rulerScrollRef = useRef<HTMLDivElement | null>(null);
  const trackScrollRef = useRef<HTMLDivElement | null>(null);
  const isScrollingSyncRef = useRef(false);

  // Subtitle edit modal state (UI-only, not in store)
  const [isSubtitleEditModalOpen, setIsSubtitleEditModalOpen] = React.useState(false);
  const [editingTrackId, setEditingTrackId] = React.useState<string | null>(null);

  // Camera-motion panel state (UI-only — the panel never writes to the store
  // until 「应用」, so Cancel is a true cancel; camera-motion-2d-3d §4.5.2).
  const [cameraMotionTargetId, setCameraMotionTargetId] = React.useState<string | null>(null);

  // Subtitle replacement confirmation (UI-only). The pending resolver lives in
  // a ref: it doubles as the "confirmation pending" guard and can be settled
  // from the dialog or on unmount without side effects in a state updater.
  const [subtitleReplaceConfirm, setSubtitleReplaceConfirm] = React.useState({ isOpen: false, count: 0 });
  const subtitleConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  // Dialogs render into <body>: the agent run marks the timeline section
  // `inert`, which froze dialogs inside it and let clicks through (N-12).
  const [portalHost, setPortalHost] = React.useState<HTMLElement | null>(null);
  useEffect(() => { setPortalHost(document.body); }, []);

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
        // isPlaying is left out: play / pause is mirrored into the store for
        // the ruler and must not re-emit (autosave, composition rebuild).
      });
    } catch {
      // Cyclic / non-serialisable structure — let the emit through; better
      // to risk a duplicate than to silently drop a real change.
      return '';
    }
  }, []);

  // Push the store's real timeline to the owner even when it equals the last
  // emit: after a refused external write the owner still holds the refused
  // data (and would autosave, preview and export it), so dedup is bypassed.
  const resyncOwnerFromStore = useCallback(() => {
    const ts = toTimelineState(useTimelineStore.getState());
    lastEmittedShapeJsonRef.current = computeShapeJson(ts);
    onTimelineStateChangeRef.current?.(ts);
    onTimelineCompositionChangeRef.current?.(ts);
  }, [computeShapeJson]);

  // ---------------------------------------------------------------------------
  // Store selectors
  // ---------------------------------------------------------------------------
  const { isDragging, isResizing, isInteracting } = useTimelineStore(
    useShallow((state) => ({ isDragging: state.isDragging, isResizing: state.isResizing, isInteracting: state.isInteracting })),
  );
  const externalEditLock = useTimelineStore((state) => state.externalEditLock);

  // Fix C: item flagged by a cross-track drag commit to be scrolled into view.
  const pendingScrollItemId = useTimelineStore((state) => state.pendingScrollItemId);

  // Camera-motion panel inputs. Resolved from the LIVE store so re-opening the
  // panel after an undo shows the restored motion, not a stale copy. `null`
  // whenever the panel is closed, which is also what unmounts the modal.
  const cameraMotionTarget = useTimelineStore((state) => {
    if (!cameraMotionTargetId) return null;
    for (const track of state.tracks) {
      const item = track.items.find((candidate) => candidate.id === cameraMotionTargetId);
      if (item) return item;
    }
    return null;
  });
  const cameraMotionTargetIds = useTimelineStore(
    useShallow((state) => {
      if (!cameraMotionTargetId) return [] as string[];
      const eligible = state.selectedItems.filter((itemId) => {
        const track = state.tracks.find((tr) => tr.items.some((it) => it.id === itemId));
        const item = track?.items.find((it) => it.id === itemId);
        return canApplyCameraMotion(item, track);
      });
      // The clip that opened the panel leads the list, so "apply to the first
      // target only" (checkbox off) means "the one you opened" — while it can
      // still take a motion: its track may have been locked since (TL3-06).
      const openerTrack = state.tracks.find((tr) => tr.items.some((it) => it.id === cameraMotionTargetId));
      const opener = openerTrack?.items.find((it) => it.id === cameraMotionTargetId);
      const others = eligible.filter((id) => id !== cameraMotionTargetId);
      return canApplyCameraMotion(opener, openerTrack) ? [cameraMotionTargetId, ...others] : others;
    }),
  );

  // Stage backdrop for the panel (camera-motion-stills D23). Thumbnails are a
  // video-only artefact, so a still would otherwise pick its motion against a
  // grey placeholder — the one thing that decides whether the preset LOOKS
  // right. Prefer the live material's URL (the very image the compositor
  // paints) and fall back to the item's own copy (review P2-3).
  const cameraMotionStagePoster = useMemo(() => {
    if (!cameraMotionTarget) return undefined;
    if (cameraMotionTarget.thumbnailUrl) return cameraMotionTarget.thumbnailUrl;
    if (cameraMotionTarget.originalMaterialType !== 'image') return undefined;
    const material = cameraMotionTarget.materialId
      ? materials.find((candidate) => candidate.id === cameraMotionTarget.materialId)
      : undefined;
    return material?.url ?? cameraMotionTarget.url ?? undefined;
  }, [cameraMotionTarget, materials]);

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
      const ts = toTimelineState(useTimelineStore.getState());
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
      const ts = toTimelineState(state);
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
  // External timeline state sync (agent operations, agent undo, imports)
  // Each external write is ONE undoable step; the user's own undo history is
  // kept instead of being cleared on every agent operation.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!externalTimelineState || !externalTimelineUpdateId ||
        externalTimelineUpdateId === lastExternalUpdateIdRef.current) {
      return;
    }
    lastExternalUpdateIdRef.current = externalTimelineUpdateId;
    const reason = reasonFromExternalUpdateId(externalTimelineUpdateId);

    // While the agent holds the timeline only its own writes land. An import
    // or pending timeline arriving now is refused, and the owner — which has
    // already stored the refused data — is handed the real timeline back.
    if (isEditLocked(useTimelineStore.getState()) && !isAgentReason(reason)) {
      showWarning(t.timeline.messages.editLockedByAgent);
      resyncOwnerFromStore();
      return;
    }

    try {
      replaceTimelineAction(
        () => useTimelineStore.getState(),
        externalTimelineState as unknown as TimelineData,
        reason,
      );
    } catch (error) {
      // A malformed timeline (e.g. a negative start) throws while being built,
      // before any history is written; an uncaught throw here would take the
      // whole editor down from inside a React effect.
      console.error('[TimelinePanel] external timeline update rejected', { reason, error });
      showError(t.timeline.messages.externalUpdateRejected);
      resyncOwnerFromStore();
    }
  }, [externalTimelineState, externalTimelineUpdateId, resyncOwnerFromStore, showError, showWarning, t]);

  // ---------------------------------------------------------------------------
  // Global pointer event listeners for drag (throttled at 16ms)
  // ---------------------------------------------------------------------------
  // Initial pointer-down position (and lane scroll) for the delta calculation
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const dragStartScrollLeftRef = useRef(0);

  useEffect(() => {
    if (!isInteracting) return;

    // Capture the start position from the drag actor context if available
    const actor = useTimelineStore.getState()._dragActor;
    if (actor) {
      const snapshot = actor.getSnapshot();
      dragStartXRef.current = snapshot.context?.pointerDownPosition?.x ?? 0;
      dragStartYRef.current = snapshot.context?.pointerDownPosition?.y ?? 0;
    }
    dragStartScrollLeftRef.current = trackScrollRef.current?.scrollLeft ?? 0;
    // Scrolling the lanes mid-drag moves the content under a still pointer, so
    // the delta counts the scroll gained since the press (TL2-24).
    const scrollOffsetSincePress = () =>
      (trackScrollRef.current?.scrollLeft ?? 0) - dragStartScrollLeftRef.current;
    // The lane (data-track-id, Track.tsx) under the pointer lets the drag layer
    // transfer a clip across tracks. Null when outside any lane.
    const trackIdAt = (clientX: number, clientY: number): string | null =>
      document.elementFromPoint(clientX, clientY)
        ?.closest('[data-track-id]')?.getAttribute('data-track-id') ?? null;
    let lastPointer: { clientX: number; clientY: number } | null = null;

    const sendMove = (clientX: number, clientY: number) => {
      lastPointer = { clientX, clientY };
      useTimelineStore.getState().updateDrag({
        type: 'POINTER_MOVE',
        clientX,
        clientY,
        deltaX: clientX - dragStartXRef.current + scrollOffsetSincePress(),
        // A purely vertical move to another lane must also start a move drag.
        deltaY: clientY - dragStartYRef.current,
        targetTrackId: trackIdAt(clientX, clientY),
      });
    };
    const handlePointerMove = throttle((e: PointerEvent) => sendMove(e.clientX, e.clientY), 16);
    // A scroll under a still pointer re-sends the move so the clip follows the cursor.
    const handleLaneScroll = () => {
      if (lastPointer) sendMove(lastPointer.clientX, lastPointer.clientY);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (scrollOffsetSincePress() !== 0) sendMove(e.clientX, e.clientY);
      // Fix D: re-hit-test the track under the release point so the commit
      // targets where the user actually let go, not the last (throttled and
      // possibly stale) POINTER_MOVE target (analysis §3.3). Null when released
      // outside any lane — the machine then keeps the last move target.
      useTimelineStore.getState().endDrag({
        type: 'POINTER_UP',
        clientX: e.clientX,
        clientY: e.clientY,
        targetTrackId: trackIdAt(e.clientX, e.clientY),
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useTimelineStore.getState().cancelDrag();
      }
    };

    // A drag the OS takes away (touch/pen cancel, Alt+Tab, window blur) never
    // delivers pointerup; without this the clip stays parked at its preview.
    const handleCancel = () => {
      useTimelineStore.getState().cancelDrag();
    };

    const laneEl = trackScrollRef.current;
    laneEl?.addEventListener('scroll', handleLaneScroll);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('blur', handleCancel);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      laneEl?.removeEventListener('scroll', handleLaneScroll);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('blur', handleCancel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isInteracting]);

  // ---------------------------------------------------------------------------
  // Fix C: scroll a cross-track-moved clip into view.
  // After a cross-track commit, autoOrganize repacks the target track flush
  // from 0, so the moved clip can land past the right edge of the viewport and
  // look "lost". The store flags it via pendingScrollItemId; here we scroll the
  // real track-scroll container to it (store.setScrollLeft alone does NOT move
  // the DOM — scroll sync is one-way DOM→store). Geometry is read from the
  // rendered element (data-clip-id) so header/offset are handled for free,
  // mirroring the addTrack vertical auto-scroll. Writing scrollLeft fires the
  // container's onScroll → handleTrackScroll, which syncs ruler + store mirror.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pendingScrollItemId) return;
    if (typeof window === 'undefined') return;
    const scrollEl = trackScrollRef.current;
    if (!scrollEl) {
      useTimelineStore.getState().clearPendingScrollItem();
      return;
    }
    const rafId = requestAnimationFrame(() => {
      const el = scrollEl.querySelector<HTMLElement>(
        `[data-clip-id="${pendingScrollItemId}"]`,
      );
      if (el) {
        const parentRect = scrollEl.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const elLeftInParent = elRect.left - parentRect.left + scrollEl.scrollLeft;
        const MARGIN = 48;
        const visible = isClipVisibleInLane({
          elLeft: elLeftInParent,
          elRight: elLeftInParent + elRect.width,
          scrollLeft: scrollEl.scrollLeft,
          clientWidth: scrollEl.clientWidth,
          headerWidth: TRACK_HEADER_WIDTH,
        });
        if (!visible) {
          // Reveal the clip's start, with a little context, right of the sticky header.
          scrollEl.scrollLeft = Math.max(0, elLeftInParent - TRACK_HEADER_WIDTH - MARGIN);
        }
      }
      useTimelineStore.getState().clearPendingScrollItem();
    });
    return () => cancelAnimationFrame(rafId);
  }, [pendingScrollItemId]);

  // ---------------------------------------------------------------------------
  // Global keyboard shortcuts
  // Refs are assigned further down after the handlers are declared, so the
  // document-level listener always reaches the latest closures without
  // re-subscribing. Placeholder values keep types honest before assignment.
  // ---------------------------------------------------------------------------
  const handleCopyRef = useRef<() => void>(() => {});
  const handleExportJSONRef = useRef<() => void>(() => {});
  const handleAddEffectRef = useRef<() => void>(() => {});
  const handleOpenCameraMotionRef = useRef<(itemId?: string) => void>(() => {});
  const handleAddTransitionRef = useRef<() => void>(() => {});
  const handleAddSubtitleRef = useRef<() => void | Promise<void>>(() => {});

  useEffect(() => {
    // Only these input types are text-editing; range/checkbox/button etc. share
    // tagName='INPUT' but must NOT swallow global shortcuts (Ctrl+Z, Ctrl+E, …).
    const EDITABLE_INPUT_TYPES = new Set([
      'text', 'search', 'email', 'password', 'url', 'tel', 'number', 'date',
      'datetime-local', 'month', 'time', 'week',
    ]);
    // Bare-letter shortcuts (m/e/t/s) must NOT fire while a non-text interactive
    // widget (button, select, link, role=button/slider/...) has focus — users
    // expect the space/enter of those widgets to be separate from editor hotkeys.
    // Ctrl-chords (undo/redo/copy/export) stay global, and so do Delete/Escape.
    const isInteractiveElement = (active: HTMLElement | null): boolean => !!active && (
      active.tagName === 'BUTTON' ||
      active.tagName === 'SELECT' ||
      active.tagName === 'A' ||
      (typeof active.matches === 'function' && active.matches(
        '[role="button"],[role="slider"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="tab"],[role="option"],[role="switch"],[role="checkbox"],[role="radio"]'
      ))
    );

    const runShortcut = (shortcut: TimelineShortcut, e: KeyboardEvent) => {
      const store = useTimelineStore.getState();
      switch (shortcut) {
        case 'undo':
          e.preventDefault();
          store.undo();
          return;
        case 'redo':
          e.preventDefault();
          store.redo();
          return;
        case 'copy':
          e.preventDefault();
          handleCopyRef.current();
          return;
        case 'export':
          e.preventDefault();
          // Defensive short-circuit — export hook also guards synchronously via ref.
          if (store.isExporting) return;
          handleExportJSONRef.current();
          return;
        case 'toggle-cut':
          e.preventDefault();
          store.setActiveTool(store.activeTool === 'cut' ? 'select' : 'cut');
          return;
        case 'camera-motion':
          e.preventDefault();
          handleOpenCameraMotionRef.current();
          return;
        case 'effect':
          e.preventDefault();
          handleAddEffectRef.current();
          return;
        case 'transition':
          e.preventDefault();
          handleAddTransitionRef.current();
          return;
        case 'subtitles':
          e.preventDefault();
          void handleAddSubtitleRef.current();
          return;
        case 'delete':
          if (store.selectedItems.length > 0) {
            e.preventDefault();
            removeItemsAction(() => useTimelineStore.getState(), store.selectedItems);
          }
          return;
        case 'deselect':
          store.deselectAll();
          return;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as (HTMLElement & Partial<HTMLInputElement>) | null;
      // Keys pressed inside a modal dialog, or already consumed by a lower
      // layer, belong to that layer (Delete in the camera-motion dialog must
      // not delete the clip being edited).
      if (!shouldTimelineHandleKeyEvent(e, active)) return;

      // Ignore when focus is on text-editing elements.
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

      const shortcut = resolveTimelineShortcut(e, isInteractiveElement(active));
      if (shortcut === null) return;

      const store = useTimelineStore.getState();
      // Ctrl+C with DOM text selected is a native copy, not a clip duplicate.
      if (shortcut === 'copy' && !shouldTimelineHandleCopyShortcut({
        selection: window.getSelection(),
        selectedItems: store.selectedItems,
      })) {
        return;
      }
      // While the agent drives the timeline, keyboard edits would fork the
      // client state from the one the agent keeps editing.
      if (store.externalEditLock !== null && MUTATING_TIMELINE_SHORTCUTS.has(shortcut)) {
        e.preventDefault();
        return;
      }
      // Mid-drag, an undo / delete would rewrite history under the gesture and
      // the release would then commit onto a timeline that no longer matches.
      if (store.isInteracting && MUTATING_TIMELINE_SHORTCUTS.has(shortcut)) {
        e.preventDefault();
        return;
      }
      // Escape mid-drag belongs to the drag (it cancels the gesture) and must
      // not clear the selection as well (UI3-13).
      if (store.isInteracting && !shouldShortcutRunDuringInteraction(shortcut)) return;

      runShortcut(shortcut, e);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, []);

  // The cut tool is an edit mode; when the agent takes the timeline, drop
  // back to select so the next click cannot try to split a clip.
  useEffect(() => useTimelineStore.subscribe(
    (state) => state.externalEditLock,
    (lock) => {
      if (lock === null) return;
      const store = useTimelineStore.getState();
      if (store.activeTool === 'cut') store.setActiveTool('select');
    },
  ), []);

  // ---------------------------------------------------------------------------
  // Material drop handler (external materials -> store)
  // ---------------------------------------------------------------------------
  const handleMaterialDrop = useCallback((material: MaterialItem, trackId: string) => {
    // Find the right track for this material
    const state = useTimelineStore.getState();
    if (isEditLocked(state)) {
      showWarning(t.timeline.messages.editLockedByAgent);
      return;
    }
    let targetTrackId = trackId;

    // If specified track doesn't exist, auto-select a compatible unlocked track
    const trackExists = state.tracks.some(track => track.id === targetTrackId);
    if (!trackExists) {
      const lookup = findTrackForMaterial(state.tracks, material.type);
      if (lookup.trackId === null) {
        if (lookup.reason === 'all-locked') {
          showWarning(t.timeline.track.trackLocked);
        } else {
          console.error(`[TimelinePanel] No compatible track found for material type: ${material.type}`);
        }
        return;
      }
      targetTrackId = lookup.trackId;
    }

    // A material without a known length is probed first (ME-11); the flow
    // re-checks the lock and the target track after the probe.
    void dropMaterialWithDuration(() => useTimelineStore.getState(), material, targetTrackId, {
      isMounted: () => isMountedRef.current,
      onSlowProbe: () => showInfo(t.timeline.messages.probingDuration, 3000),
    }).then((outcome) => {
      if (outcome.kind === 'refused') {
        // A drop onto a locked track is refused, not silently rerouted elsewhere.
        if (outcome.reason === 'track-locked') showWarning(t.timeline.track.trackLocked);
        if (outcome.reason === 'edit-locked') showWarning(t.timeline.messages.editLockedByAgent);
        if (outcome.reason === 'track-missing') showWarning(t.agentApply.reasons.trackNotFound);
        return;
      }
      if (outcome.durationFallback) showWarning(t.timeline.messages.durationUnknownFallback);

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
    }).catch((error) => {
      console.error('[TimelinePanel] material drop failed', { materialId: material.id, error });
    });
  }, [videoCache, showInfo, showWarning, t]);

  // A drop carries only the material id: resolving it against the library
  // builds the clip exactly like "add to timeline" (playback urls, storage
  // key, sentence segments), instead of from the thin drag payload.
  const handleMaterialDropById = useCallback((materialId: string, trackId: string) => {
    const material = materials.find(candidate => candidate.id === materialId);
    if (!material) {
      showError(t.timeline.messages.materialNotFound);
      return;
    }
    handleMaterialDrop(material, trackId);
  }, [materials, handleMaterialDrop, showError, t]);

  // ---------------------------------------------------------------------------
  // Programmatic material add (from external)
  // ---------------------------------------------------------------------------
  const handleAddMaterialsToTimeline = useCallback((mats: MaterialItem[], targetTrackId?: string) => {
    // One lock warning for the whole batch rather than one per material.
    if (isEditLocked(useTimelineStore.getState())) {
      showWarning(t.timeline.messages.editLockedByAgent);
      return;
    }
    // One warning per batch (not per material) when every target is locked.
    let hasWarnedLocked = false;
    mats.forEach((material, index) => {
      setTimeout(() => {
        // Auto-find compatible track
        let tid = targetTrackId;
        if (!tid) {
          const lookup = findTrackForMaterial(useTimelineStore.getState().tracks, material.type);
          if (lookup.reason === 'all-locked' && !hasWarnedLocked) {
            hasWarnedLocked = true;
            showWarning(t.timeline.track.trackLocked);
          }
          tid = lookup.trackId ?? undefined;
        }
        if (tid) {
          handleMaterialDrop(material, tid);
        }
      }, index * 10);
    });
  }, [handleMaterialDrop, showWarning, t]);

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
    if (isEditLocked(useTimelineStore.getState())) {
      showWarning(t.timeline.messages.editLockedByAgent);
      return;
    }
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
  }, [showWarning, t]);

  // ---------------------------------------------------------------------------
  // Toolbar action handlers (complex operations not in store)
  // ---------------------------------------------------------------------------
  // Copy and organize mutate slices directly (no action layer), so each checks
  // the edit lock itself before recording any history.
  const handleCopy = useCallback(() => {
    if (isEditLocked(useTimelineStore.getState())) {
      showWarning(t.timeline.messages.editLockedByAgent);
      return;
    }
    const state = useTimelineStore.getState();
    if (state.selectedItems.length === 0) return;

    // Clips on locked tracks are never duplicated (see duplicateClips).
    const { data, newIds } = duplicateSelectedClips(
      state.exportToData(),
      state.selectedItems,
      (name) => t.timeline.track.copyOf.replace('{name}', name),
    );
    if (newIds.length === 0) return;

    state.recordAction('ADD_ITEM', {
      operation: 'copy',
      selectedItemIds: state.selectedItems,
    });
    state.importFromData(data);

    // Copy appends at the end of each track; auto-organize so the new items
    // participate in the same flush-from-0 invariant as any other mutation.
    useTimelineStore.getState().autoOrganize();

    // Capture synchronously: a next-frame capture lands on whichever history
    // entry is last by then and breaks redo for same-tick edits.
    useTimelineStore.getState().captureNextState();

    // The copies are what the user just made, so they become the selection (TL2-22).
    useTimelineStore.getState().selectItems(newIds);
    useTimelineStore.getState().requestScrollItemIntoView(newIds[0]);
  }, [showWarning, t]);

  const handleOrganizeMaterials = useCallback(() => {
    if (isEditLocked(useTimelineStore.getState())) {
      showWarning(t.timeline.messages.editLockedByAgent);
      return;
    }
    const state = useTimelineStore.getState();
    const hasItems = state.tracks.some(t =>
      (t.type === 'video' || t.type === 'audio') && t.items.length > 0
    );

    if (!hasItems) {
      showInfo(t.timeline.messages.organizeMaterialsNoItems, 3000);
      return;
    }

    const tracksBefore = state.exportToData().tracks;
    // Reuse the UPDATE_ITEM action type so existing history filters keep
    // working; autoOrganize does the actual packing.
    state.recordAction('UPDATE_ITEM', {
      operation: 'organize_materials',
      description: t.timeline.messages.organizeMaterialsDescription,
    });

    state.autoOrganize();

    useTimelineStore.getState().captureNextState();

    // An already tidy timeline records nothing (S12) and says so (TL3-02).
    if (tracksEqual(tracksBefore, useTimelineStore.getState().exportToData().tracks)) {
      showInfo(t.timeline.messages.organizeMaterialsAlreadyTidy, 3000);
      return;
    }
    showSuccess(t.timeline.messages.organizeMaterialsSuccess);
  }, [showSuccess, showInfo, showWarning, t]);

  // ---------------------------------------------------------------------------
  // Camera motion (camera-motion-2d-3d §4.5.1)
  // ---------------------------------------------------------------------------

  /**
   * Open the panel for `itemId`, or for the first eligible selected clip when
   * called without one (the `M` shortcut and the toolbar button). Eligibility
   * goes through the single `canApplyCameraMotion` predicate so the toolbar,
   * the shortcut, the double-click and the badge can never disagree.
   */
  const handleOpenCameraMotion = useCallback((itemId?: string) => {
    const state = useTimelineStore.getState();
    const findEligible = (candidateId: string): boolean => {
      const track = state.tracks.find(tr => tr.items.some(it => it.id === candidateId));
      const item = track?.items.find(it => it.id === candidateId);
      return canApplyCameraMotion(item, track);
    };

    if (itemId) {
      if (!findEligible(itemId)) return;
      if (!state.selectedItems.includes(itemId)) {
        state.selectItem(itemId);
      }
      setCameraMotionTargetId(itemId);
      return;
    }

    const target = state.selectedItems.find(findEligible);
    if (!target) {
      showInfo(t.timeline.cameraMotion.disabledNoSelection, 3000);
      return;
    }
    setCameraMotionTargetId(target);
  }, [showInfo, t]);

  const handleCloseCameraMotion = useCallback(() => {
    setCameraMotionTargetId(null);
  }, []);

  const handleApplyCameraMotion = useCallback(
    (itemIds: string[], motion: CameraMotion | null) => {
      if (setCameraMotionAction(() => useTimelineStore.getState(), itemIds, motion)) return;
      showWarning(isEditLocked(useTimelineStore.getState())
        ? t.timeline.messages.editLockedByAgent : t.timeline.cameraMotion.disabledTrackLocked);
    },
    [showWarning, t],
  );

  const handleAddEffect = useCallback(() => {
    showInfo(t.timeline.messages.featureComingSoon, 3000);
  }, [showInfo, t]);

  const handleAddTransition = useCallback(() => {
    showInfo(t.timeline.messages.featureComingSoon, 3000);
  }, [showInfo, t]);

  // ---------------------------------------------------------------------------
  // Subtitle extraction (kept as local handler - complex API call)
  // ---------------------------------------------------------------------------
  const confirmReplaceSubtitles = useCallback((count: number): Promise<boolean> => (
    new Promise<boolean>((resolve) => {
      subtitleConfirmResolverRef.current = resolve;
      setSubtitleReplaceConfirm({ isOpen: true, count });
    })
  ), []);

  const settleSubtitleReplaceConfirm = useCallback((confirmed: boolean) => {
    const resolve = subtitleConfirmResolverRef.current;
    subtitleConfirmResolverRef.current = null;
    setSubtitleReplaceConfirm(current => ({ ...current, isOpen: false }));
    resolve?.(confirmed);
  }, []);

  // A confirmation still open when the panel unmounts resolves as "cancel".
  useEffect(() => () => {
    subtitleConfirmResolverRef.current?.(false);
    subtitleConfirmResolverRef.current = null;
  }, []);

  const showSubtitleCommitBlocker = useCallback((blocker: SubtitleCommitBlocker) => {
    if (blocker === 'edit-locked') showError(t.timeline.messages.editLockedByAgent);
    if (blocker === 'track-missing') showError(t.timeline.messages.noSubtitleTrack);
    if (blocker === 'track-locked') showError(t.timeline.messages.subtitleTrackLocked);
  }, [showError, t]);

  const handleAddSubtitle = useCallback(async () => {
    const state = useTimelineStore.getState();
    const subtitleTrackBefore = state.tracks.find(track => track.type === 'subtitle');
    const blocker = getSubtitleReplacementBlocker({
      isExtracting: state.isExtractingSubtitles,
      isConfirmPending: subtitleConfirmResolverRef.current !== null,
      subtitleTrack: subtitleTrackBefore,
    });
    if (blocker === 'track-locked') {
      showError(t.timeline.messages.subtitleTrackLocked);
      return;
    }
    if (blocker !== null) return;

    // Local preconditions are checked before asking to replace anything, so
    // a confirmation is never followed by "nothing to transcribe". Only heard
    // audio counts: muted and hidden lanes are never transcribed.
    if (collectTranscriptionItems(state.tracks, materials).length === 0) {
      showError(t.timeline.messages.noAudioItems);
      return;
    }
    if (!subtitleTrackBefore) {
      showError(t.timeline.messages.noSubtitleTrack);
      return;
    }
    // Ask BEFORE the (possibly minutes-long) transcription, not after it.
    if (subtitleTrackBefore.items.length > 0) {
      const confirmed = await confirmReplaceSubtitles(subtitleTrackBefore.items.length);
      if (!confirmed) return;
    }

    // Re-read before the long request and again before writing its result:
    // both can outlast the moment the agent takes the timeline (S4) or the
    // track is locked / removed.
    const subtitleTrackId = subtitleTrackBefore.id;
    const resolveCommitTrack = () => {
      const fresh = useTimelineStore.getState();
      const subtitleTrack =
        fresh.tracks.find(track => track.id === subtitleTrackId) ??
        fresh.tracks.find(track => track.type === 'subtitle');
      const commitBlocker = getSubtitleCommitBlocker({
        externalEditLock: fresh.externalEditLock,
        subtitleTrack,
      });
      if (commitBlocker !== null) showSubtitleCommitBlocker(commitBlocker);
      return commitBlocker === null ? subtitleTrack : undefined;
    };
    if (!resolveCommitTrack()) return;

    // Re-collected after the confirmation: clips may have changed while it was open.
    const audioItemsForTranscription = collectTranscriptionItems(useTimelineStore.getState().tracks, materials);
    if (audioItemsForTranscription.length === 0) {
      showError(t.timeline.messages.noAudioItems);
      return;
    }

    useTimelineStore.getState().setExtractingSubtitles(true);

    try {
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

      // Re-read the store: the timeline may have changed during the request.
      const subtitleTrack = resolveCommitTrack();
      if (!subtitleTrack) return;

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

      // One undoable step: Ctrl+Z brings the previous subtitles back.
      const currentData = useTimelineStore.getState().exportToData();
      const updatedTracks = currentData.tracks.map((track: any) => {
        if (track.id === subtitleTrack.id) {
          return { ...track, items: newSubtitleItems };
        }
        return track;
      });
      replaceTimelineAction(
        () => useTimelineStore.getState(),
        { ...currentData, tracks: updatedTracks },
        'subtitles',
      );

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
  }, [materials, showSuccess, showError, t, confirmReplaceSubtitles, showSubtitleCommitBlocker]);

  // ---------------------------------------------------------------------------
  // JSON import handler
  // ---------------------------------------------------------------------------
  const handleImportJSON = useCallback(async (file: File) => {
    if (isEditLocked(useTimelineStore.getState())) {
      showWarning(t.timeline.messages.editLockedByAgent);
      return;
    }
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
      // The import request can take minutes; the agent may have started meanwhile.
      if (isEditLocked(useTimelineStore.getState())) {
        showWarning(t.timeline.messages.editLockedByAgent);
        return;
      }
      if (importedData?.timelineState && importedData?.materials) {
        // One undoable step instead of wiping the user's undo history.
        replaceTimelineAction(
          () => useTimelineStore.getState(),
          importedData.timelineState as TimelineData,
          'import',
        );

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
  }, [taskId, onImportComplete, onTimelineStateChange, showSuccess, showError, showWarning, t]);

  // ---------------------------------------------------------------------------
  // Subtitle editing (modal state)
  // ---------------------------------------------------------------------------
  const handleSubtitleEdit = useCallback((itemId: string, newText: string) => {
    updateSubtitleTextAction(() => useTimelineStore.getState(), itemId, newText);
  }, []);

  const handleEditSubtitles = useCallback((trackId: string) => {
    setEditingTrackId(trackId);
    setIsSubtitleEditModalOpen(true);
  }, []);

  const handleCloseSubtitleEditModal = useCallback(() => {
    setIsSubtitleEditModalOpen(false);
    setEditingTrackId(null);
  }, []);

  /** @returns false when the save was blocked, so the dialog keeps the edits open. */
  const handleSaveSubtitleChanges = useCallback((updatedSubtitles: TimelineItem[]): boolean => {
    if (!editingTrackId) return false;
    const state = useTimelineStore.getState();
    const blocker = getSubtitleCommitBlocker({
      externalEditLock: state.externalEditLock,
      subtitleTrack: state.tracks.find(track => track.id === editingTrackId),
    });
    if (blocker !== null) {
      showSubtitleCommitBlocker(blocker);
      return false;
    }
    const currentData = state.exportToData();
    const updatedTracks = currentData.tracks.map((track: any) =>
      track.id === editingTrackId ? { ...track, items: updatedSubtitles } : track
    );
    replaceTimelineAction(
      () => useTimelineStore.getState(),
      { ...currentData, tracks: updatedTracks },
      'subtitles',
    );
    handleCloseSubtitleEditModal();
    return true;
  }, [editingTrackId, handleCloseSubtitleEditModal, showSubtitleCommitBlocker]);

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

  // Ctrl+wheel and button zoom keep the time under the cursor / playhead
  // (TL2-07); the view pages along with playback (TL2-24).
  const requestAnchoredZoom = useAnchoredZoom(trackScrollRef);
  useTimelineWheel({
    trackScrollRef,
    rulerScrollRef,
    getZoomLevel: () => useTimelineStore.getState().zoomLevel,
    onZoom: requestAnchoredZoom,
  });
  useFollowPlayhead({ trackScrollRef, rulerScrollRef });

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
    const ts = toTimelineState(useTimelineStore.getState());
    timelineExport.exportTimelineToJSON(ts, materials);
  }, [timelineExport, materials]);

  // Assign-in-render: keeps the document keydown listener reaching the
  // latest handler closures without re-subscribing every render.
  handleCopyRef.current = handleCopy;
  handleExportJSONRef.current = handleExportJSON;
  handleAddEffectRef.current = handleAddEffect;
  handleOpenCameraMotionRef.current = handleOpenCameraMotion;
  handleAddTransitionRef.current = handleAddTransition;
  handleAddSubtitleRef.current = handleAddSubtitle;

  useImperativeHandle(ref, () => ({
    openCameraMotion: (itemId: string) => handleOpenCameraMotion(itemId),
    openSubtitleStyle: (trackId: string) => handleEditSubtitles(trackId),
  }), [handleOpenCameraMotion, handleEditSubtitles]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      className={`timeline-panel relative flex flex-col h-full bg-card ${className}`}
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label={t.timeline.panelAriaLabel}
    >
      {/* 工具栏 */}
      <TimelineToolbar
        onExportJSON={handleExportJSON}
        onImportJSON={handleImportJSON}
        onOrganizeMaterials={handleOrganizeMaterials}
        onCopy={handleCopy}
        onOpenCameraMotion={handleOpenCameraMotion}
        onAddEffect={handleAddEffect}
        onAddTransition={handleAddTransition}
        onAddSubtitle={handleAddSubtitle}
      />

      {/* 时间刻度尺 */}
      <TimelineRuler
        scrollRef={rulerScrollRef}
        onScroll={handleRulerScroll}
        onZoomRequest={requestAnchoredZoom}
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
        onOpenCameraMotion={handleOpenCameraMotion}
        onMaterialDrop={handleMaterialDropById}
        isMaterialMissing={isMaterialMissing} projectId={taskId}
      />

      <DragTimeBadge containerRef={panelRef} />
      <SelectedSegmentReveal trackScrollRef={trackScrollRef} />

      {portalHost && createPortal(
        <>
          {/* 运镜面板 */}
          {cameraMotionTarget && (
            <CameraMotionModal
              isOpen={cameraMotionTargetId !== null}
              onClose={handleCloseCameraMotion}
              onApply={handleApplyCameraMotion}
              clipName={cameraMotionTarget.name}
              clipDuration={cameraMotionTarget.duration}
              clipThumbnailUrl={cameraMotionStagePoster}
              initialMotion={cameraMotionTarget.cameraMotion}
              targetItemIds={cameraMotionTargetIds}
              isEditLocked={externalEditLock !== null}
            />
          )}

          {/* 字幕编辑模态框 */}
          {editingTrackId && (
            <SubtitleEditModal
              isOpen={isSubtitleEditModalOpen}
              onClose={handleCloseSubtitleEditModal}
              onSave={handleSaveSubtitleChanges}
              subtitles={memoizedSubtitles}
              taskId="timeline_subtitle_edit"
              locale={locale}
              isEditLocked={externalEditLock !== null}
            />
          )}

          {/* 字幕替换确认：识别前询问，确认后整体替换为一步可撤销操作 */}
          <ConfirmationDialog
            isOpen={subtitleReplaceConfirm.isOpen}
            type="warning"
            title={t.timeline.messages.replaceSubtitlesTitle}
            message={t.timeline.messages.replaceSubtitlesBody.replace('{count}', String(subtitleReplaceConfirm.count))}
            confirmText={t.timeline.messages.replaceSubtitlesConfirm}
            cancelText={t.common.cancel}
            onConfirm={() => settleSubtitleReplaceConfirm(true)}
            onCancel={() => settleSubtitleReplaceConfirm(false)}
          />
        </>,
        portalHost,
      )}
    </div>
  );
});

TimelinePanel.displayName = 'TimelinePanel';

export default TimelinePanel;
