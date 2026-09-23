'use client';

/**
 * Export wiring for the editor top bar (spec §3.2 「状态上移」, RV-14, RV-15).
 *
 * The export used to live in VideoPlayerPanel's header. It now belongs to the
 * top bar, so VideoEditingInterface calls this hook — and this hook is the ONE
 * `useVideoExport` instance on the page: two instances would both resume and
 * poll the same export session. The arguments are exactly the ones the panel
 * passed, with the aspect ratio now the controlled `aspectRatioId` shared with
 * the preview, so the exported size always matches what is previewed (R2).
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { MaterialItem, TimelineState } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { useVideoExport, type ExportPreflight } from '../hooks/useVideoExport';
import { collectExportAdvisories, type ExportAdvisory } from '../hooks/exportAdvisories';
import { BLACK_TAIL_NOTICE_SECONDS } from '../hooks/videoExportItems';
import type { SegmentLinksValue } from '../lib/segments/SegmentLinksContext';
import type { UseWorkbenchWiringReturn } from './useWorkbenchWiring';
import ExportPreflightSheet from './ExportPreflightSheet';
import { VideoEditingLogger } from '../utils/logger';
import VideoExportProgressModal from '../components/VideoPlayerPanel/VideoExportProgressModal';

export interface UseEditorExportWiringOptions {
  taskId: string;
  projectId?: string;
  timelineState: TimelineState | null | undefined;
  materials: MaterialItem[] | undefined;
  /** Controlled aspect ratio id shared with the preview (e.g. '16:9'). */
  aspectRatioId: string;
  logger?: VideoEditingLogger;
  /** Canvas fit and project-level dismissed advisories (R2 §3.9 / §3.11). */
  workbench?: Pick<UseWorkbenchWiringReturn, 'canvasFit' | 'dismissedAdvisories' | 'dismissAdvisory'>;
  /** Segment statuses for the pre-export notes; without it there is no sheet. */
  segmentLinks?: SegmentLinksValue;
}

export interface EditorExportState {
  canExport: boolean;
  isExporting: boolean;
  /** 0–100. */
  progress: number;
  /** Why the export button is disabled; set only for an empty timeline. */
  disabledReason?: string;
}

export interface UseEditorExportWiringReturn {
  exportState: EditorExportState;
  handleExport: () => Promise<void>;
  /** The export progress modal; render it once, anywhere in the editor. */
  progressModal: React.ReactNode;
}

// Same fallback the panel used while no timeline was loaded yet.
const EMPTY_TIMELINE: TimelineState = {
  currentTime: 0,
  totalDuration: 0,
  zoomLevel: 1,
  selectedItems: [],
  tracks: [],
  playbackRate: 1,
  isPlaying: false,
  snapToGrid: false,
  gridSize: 1,
  scrollLeft: 0,
};

/** Whether any track holds at least one item — the export gate. */
export function hasExportableItem(timelineState: TimelineState | null | undefined): boolean {
  return (timelineState?.tracks ?? []).some((track) => (track.items?.length ?? 0) > 0);
}

export function useEditorExportWiring(
  options: UseEditorExportWiringOptions,
): UseEditorExportWiringReturn {
  const { taskId, projectId, timelineState, materials, aspectRatioId } = options;
  const { t } = useLocale();
  const fallbackLogger = useMemo(
    () => new VideoEditingLogger({ taskId, component: 'EditorExportWiring' }),
    [taskId],
  );
  const logger = options.logger ?? fallbackLogger;
  const [advisories, setAdvisories] = useState<ExportAdvisory[] | null>(null);
  const latestRef = useRef(options);
  latestRef.current = options;
  const preflight = useMemo<ExportPreflight | undefined>(() => (options.segmentLinks ? {
    collect: (blackTailSeconds) => {
      const { segmentLinks, workbench, timelineState: tl, materials: list, aspectRatioId: ratio } = latestRef.current;
      // A placeholder script has no voice notes, but the black-tail note must
      // still show: with a preflight the export no longer toasts it itself.
      const hasScript = segmentLinks !== undefined && !segmentLinks.isPlaceholderScript;
      return collectExportAdvisories({
        segmentIds: hasScript ? Array.from(segmentLinks.segmentIndex.keys()) : [],
        statusById: segmentLinks?.statusById ?? new Map(),
        tracks: tl?.tracks ?? [],
        materialsById: new Map((list ?? []).map((material) => [material.id, material])),
        fit: workbench?.canvasFit ?? 'contain',
        aspectRatioId: ratio,
        blackTailSeconds,
        blackTailThreshold: BLACK_TAIL_NOTICE_SECONDS,
        dismissed: workbench?.dismissedAdvisories ?? [],
      });
    },
    onAdvisories: setAdvisories,
  } : undefined), [options.segmentLinks !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const videoExport = useVideoExport({
    timelineState: timelineState || EMPTY_TIMELINE,
    materials: materials || [],
    taskId,
    // The export session is per project: another project of this task is not blocked (RV3-07).
    projectId,
    aspectRatio: aspectRatioId,
    fitMode: options.workbench?.canvasFit,
    preflight,
  });
  const { handleExport: runExport } = videoExport;

  const handleExport = useCallback(async () => {
    logger.info('用户点击导出视频按钮', {
      selectedAspectRatio: aspectRatioId,
      tracksCount: timelineState?.tracks.length || 0,
      materialsCount: materials?.length || 0,
    });
    await runExport();
  }, [aspectRatioId, timelineState, materials, runExport, logger]);

  const canExport = useMemo(() => hasExportableItem(timelineState), [timelineState]);
  const exportState: EditorExportState = {
    canExport,
    isExporting: videoExport.isExporting,
    progress: videoExport.exportProgress,
    disabledReason: !canExport && !videoExport.isExporting
      ? t.workbench.topBar.exportEmpty
      : undefined,
  };

  const progressModal = React.createElement(React.Fragment, null,
    React.createElement(VideoExportProgressModal, {
      isOpen: videoExport.isExporting,
      progress: videoExport.exportProgress,
      startTime: videoExport.exportStartTime,
      stage: videoExport.exportStage,
      allowCancel: videoExport.canCancelExport,
      onCancel: videoExport.cancelExport,
    }),
    advisories && React.createElement(ExportPreflightSheet, {
      advisories,
      onClose: () => setAdvisories(null),
      onExportAnyway: () => {
        setAdvisories(null);
        void runExport({ skipAdvisories: true });
      },
      onReviewSegment: (segmentId: string) => {
        setAdvisories(null);
        useEditorFocusStore.getState().selectSegment(segmentId, 'script');
      },
      onOpenCanvas: () => {
        setAdvisories(null);
        document.querySelector<HTMLElement>('.ws-canvas-trigger')?.click();
      },
      onDismiss: (code) => options.workbench?.dismissAdvisory(code),
    }));

  return { exportState, handleExport, progressModal };
}
