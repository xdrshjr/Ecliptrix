'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { UseVideoPlaybackReturn, VideoPreview, CompositionPlayback, VideoSequenceItem } from '../../types';
import { TimelineState, MaterialItem, ImagePosition } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useVideoExport } from '../../hooks/useVideoExport';
import type { RemoteMaterialPatch } from '../../hooks/useRemoteMaterialPrefetch';
import VideoExportProgressModal from './VideoExportProgressModal';
import ImageOverlay from './ImageOverlay';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { CoverButton, VideoCoverModal } from '../VideoCoverModal';
import type { CoverAspectRatio } from '../VideoCoverModal/types';
import { isPreviewProxyEnabled, isLocalPreviewEnabled } from '@/lib/playbackFlags';
import PreviewCanvas from './PreviewCanvas';
import { useCompositionPlayback } from '../../hooks/useCompositionPlayback';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import { buildAspectRatios, aspectRatioToNumber, computeContainBox, type AspectRatio } from './aspectRatios';
import { resolveExportResolution } from '../../playback/exportResolutions';
import { getImageOverlayPlaybackTime, selectActiveImageOverlays } from './imageOverlays';
import { useCompositionTransport, type MediaReadiness } from './useCompositionTransport';

interface VideoPlayerPanelProps extends UseVideoPlaybackReturn {
  videoPreview: VideoPreview;
  taskId: string;
  className?: string;
  // Add composition support
  compositionPlayback?: CompositionPlayback;
  onCompositionPlayPause?: () => void;
  onCompositionSeek?: (time: number) => void;
  // 新增：处理下一个序列
  onNextSequence?: () => boolean;
  onCompositionTimeUpdate?: (currentTime: number) => void;
  // 新增：同步时间到timeline
  onTimelineTimeUpdate?: (currentTime: number) => void;
  // 新增：当前timeline时间，用于从游标位置开始播放
  currentTimelineTime?: number;
  // 新增：更新序列索引
  onSequenceIndexUpdate?: (sequenceIndex: number) => void;
  // 新增：导出功能相关props
  timelineState?: TimelineState;
  materials?: MaterialItem[];
  /**
   * Patch a material's cache fields. Wired to
   * useMaterialManagement.patchMaterialCache. Retained for interface
   * compatibility (the remote-material prefetch hook is the live writer).
   */
  onPatchMaterialCache?: (id: string, patch: RemoteMaterialPatch) => void;
  // 新增：图片叠加位置更新回调
  onImagePositionChange?: (itemId: string, position: ImagePosition) => void;
  onImagePositionConfirm?: (itemId: string, position: ImagePosition) => void;
  // 新增：项目元信息，供 Cover 模态使用（无 projectId 时按钮隐藏）
  projectId?: string;
  projectName?: string;
}

// 新增：VideoPlayerPanel ref接口，用于外部调用内部方法
export interface VideoPlayerPanelRef {
  handleCompositionSeek: (compositionTime: number, targetSequence: VideoSequenceItem, videoTime: number, source: 'timeline' | 'player') => Promise<void>;
  /** Seek to timeline time and start playback. Idempotent: safe to call when already playing. */
  seekAndPlayFromTimeline: (timelineTime: number) => Promise<void>;
  /** Pause without seeking. */
  pauseFromTimeline: () => Promise<void>;
  /**
   * Synchronous read of the current play state.
   * Returns `true` if composition or preview playback is active.
   * The parent uses this to pick branch in the Space-key handler.
   */
  isPlaying: () => boolean;
  /**
   * @deprecated use seekAndPlayFromTimeline / pauseFromTimeline + isPlaying.
   * Kept for one release. Internally dispatches to the new methods.
   */
  handlePlayPauseFromTimeline: (timelineTime: number) => Promise<void>;
}

const VideoPlayerPanel = React.forwardRef<VideoPlayerPanelRef, VideoPlayerPanelProps>(({
  isPlaying,
  currentTime,
  volume,
  handlePlayPause,
  handleTimeSeek,
  handleVolumeChange,
  formatTime,
  taskId,
  className = '',
  compositionPlayback,
  onCompositionPlayPause,
  onCompositionSeek,
  onCompositionTimeUpdate,
  onTimelineTimeUpdate,
  currentTimelineTime,
  onSequenceIndexUpdate,
  timelineState,
  materials,
  onImagePositionChange,
  onImagePositionConfirm,
  projectId,
  projectName,
}, ref) => {
  const { t } = useLocale();
  const { showWarning } = useNotification();
  const logger = useMemo(
    () => new VideoEditingLogger({ taskId, component: 'VideoPlayerPanel' }),
    [taskId],
  );

  // Preview-proxy flag — locked at mount, decoupled + default-on. Drives the
  // compositor's source resolver toward the 480p ladder when a material's proxy
  // is `cached`. Spec §3.2.3.
  const previewProxyEnabled = useMemo(() => isPreviewProxyEnabled(), []);
  // Local-preview flag — locked at mount, decoupled + default-on. When on, the
  // readiness gate blocks play until every timeline video/audio material is
  // locally `ready` (or terminally `degraded`). Spec §3.3.1 / §3.3.5.
  const localPreviewEnabled = useMemo(() => isLocalPreviewEnabled(), []);

  // 基于翻译的视频比例配置
  const ASPECT_RATIOS = useMemo<AspectRatio[]>(
    () => buildAspectRatios(t.videoPlayerPanel.aspectRatios),
    [t],
  );

  const compositionCurrentTimeRef = useRef(0);
  const [isCompositionPlaying, setIsCompositionPlaying] = useState(false);
  const [compositionCurrentTime, setCompositionCurrentTime] = useState(0);

  const updateCompositionCurrentTime = useCallback((time: number) => {
    compositionCurrentTimeRef.current = time;
    setCompositionCurrentTime(time);
  }, []);

  // 新增：视频比例状态
  const [selectedAspectRatioId, setSelectedAspectRatioId] = useState<string>(ASPECT_RATIOS[0].id);

  // Cover modal open state — opened from the CoverButton in the aspect-ratio row.
  const [isCoverModalOpen, setIsCoverModalOpen] = useState<boolean>(false);
  const selectedAspectRatio = ASPECT_RATIOS.find(ar => ar.id === selectedAspectRatioId) || ASPECT_RATIOS[0];

  // 新增：图片叠加相关状态
  const [selectedImageOverlay, setSelectedImageOverlay] = useState<string | null>(null);
  const [imageOverlayEntrySnapshots, setImageOverlayEntrySnapshots] = useState<Record<string, ImagePosition>>({});
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // ----------------------------------------------------------------------
  // local-video-editing-refactor S4 — the multi-track compositor preview path
  // is now the SOLE preview. PreviewCanvas + useCompositionPlayback own the
  // engine lifecycle, the multi-source canvas compositing, the subtitle/image
  // overlay data, and the per-track audio sync; there is no v1 fallback.
  // ----------------------------------------------------------------------
  const previewAspectRatio = useMemo(
    () => aspectRatioToNumber(selectedAspectRatio.ratio),
    [selectedAspectRatio.ratio],
  );

  // Publish the project canvas ratio for the camera-motion panel, which lives in
  // the timeline three levels away and otherwise has to guess (it used to assume
  // 16:9, so a 9:16 project gated Apply on a framing the renderer never drew —
  // G3). A scalar in the UI slice beats drilling one prop through the editor.
  useEffect(() => {
    // `undefined` means the ratio string was malformed; the store keeps its last
    // good value rather than adopting a guess.
    if (previewAspectRatio === undefined) return;
    useTimelineStore.getState().setProjectCanvasAspect(previewAspectRatio);
  }, [previewAspectRatio]);

  // 比例帧②的 contain 像素尺寸：用容器实测尺寸(①, videoContainerRef 的 ResizeObserver)
  // + 所选比例算出"长边占满、短边留边"的盒子，替代只靠 min-height:200px 的塌缩写法。
  // 容器尺寸未知(首帧 containerDimensions=0)时为 null，回退到 CSS 的 min-height 兜底。
  const previewFrameBox = useMemo(
    () => computeContainBox(containerDimensions.width, containerDimensions.height, previewAspectRatio),
    [containerDimensions.width, containerDimensions.height, previewAspectRatio],
  );
  const compositionPreview = useCompositionPlayback({
    compositionPlayback,
    materials: materials || [],
    timelineState,
    preferPreviewProxy: previewProxyEnabled,
    preferLocalProxy: localPreviewEnabled,
    currentTime: currentTimelineTime ?? compositionCurrentTime,
    isPlaying: isCompositionPlaying,
    onTimeUpdate: (time: number) => {
      compositionCurrentTimeRef.current = time;
      if (onTimelineTimeUpdate) onTimelineTimeUpdate(time);
      if (onCompositionTimeUpdate) onCompositionTimeUpdate(time);
    },
    aspectRatio: previewAspectRatio,
    // The SAME id already drives the export hook (see `videoExport` below), so
    // preview and export now quantise still-overlay boxes onto one grid instead
    // of two that merely looked alike. One call — the table itself lives in
    // `exportResolutions.ts`, not here (this file is 36 lines from the cap).
    exportFrame: resolveExportResolution(selectedAspectRatio.id),
    enabled: true,
  });

  // 当前播放模式：preview 或 composition
  const playbackMode = compositionPlayback?.isCompositionMode && compositionPlayback.videoSequences.length > 0
    ? 'composition' : 'preview';
  const imageOverlayPlaybackTime = getImageOverlayPlaybackTime(
    playbackMode,
    currentTimelineTime,
    compositionCurrentTime,
    currentTime,
  );

  // 显示一次"素材下载中"提示（播放门未就绪时）。
  const surfaceMaterialsDownloading = useCallback((readiness: MediaReadiness) => {
    try {
      showWarning(
        t.videoPlayerPanel.playback.materialsDownloading
          .replace('{ready}', String(readiness.readyCount))
          .replace('{total}', String(readiness.totalCount)),
      );
    } catch {
      // notification provider may be unavailable in tests — ignore.
    }
  }, [showWarning, t.videoPlayerPanel.playback.materialsDownloading]);

  // Transport + imperative handle + readiness gate (extracted, S4 / D10).
  const transport = useCompositionTransport({
    ref,
    playbackMode,
    compositionPlayback,
    compositionPreview,
    isPlaying,
    currentTime,
    isCompositionPlaying,
    setIsCompositionPlaying,
    compositionCurrentTime,
    updateCompositionCurrentTime,
    timelineState,
    materials,
    localPreviewEnabled,
    surfaceMaterialsDownloading,
    onCompositionPlayPause,
    onCompositionSeek,
    onSequenceIndexUpdate,
    handlePlayPause,
    handleTimeSeek,
  });
  const {
    handlePlayPauseClick,
    handleTimeSeekClick,
    getCurrentTime,
    getTotalDuration,
    getCurrentlyPlaying,
    allTimelineMediaReady,
  } = transport;

  // 获取当前时间的图片叠加层（合成器在 canvas 上栅格化；此列表驱动可拖拽 React 句柄）。
  const getCurrentImageOverlays = useCallback(
    () =>
      selectActiveImageOverlays(
        timelineState,
        materials,
        imageOverlayPlaybackTime,
        (info) => logger.warn('image material missing or no URL', info),
      ),
    [timelineState, materials, imageOverlayPlaybackTime, logger],
  );

  // 新增：处理图片位置变化
  const handleImagePositionChange = useCallback((itemId: string, newPosition: ImagePosition) => {
    logger.info('图片叠加位置更新', { itemId, newPosition });
    onImagePositionChange?.(itemId, newPosition);
  }, [onImagePositionChange, logger]);

  // 新增：处理图片选择
  const handleImageOverlaySelect = useCallback((itemId: string, position: ImagePosition) => {
    setSelectedImageOverlay(itemId);
    setImageOverlayEntrySnapshots((prev) => {
      if (selectedImageOverlay === itemId && prev[itemId]) return prev;
      return { ...prev, [itemId]: position };
    });
    logger.info('选择图片叠加', { itemId });
  }, [logger, selectedImageOverlay]);

  const clearImageOverlaySnapshot = useCallback((itemId: string) => {
    setImageOverlayEntrySnapshots((prev) => {
      if (!(itemId in prev)) return prev;
      const { [itemId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleImagePositionConfirm = useCallback((itemId: string, position: ImagePosition) => {
    logger.info('图片叠加位置确认', { itemId, position });
    onImagePositionConfirm?.(itemId, position);
    clearImageOverlaySnapshot(itemId);
    setSelectedImageOverlay(null);
  }, [clearImageOverlaySnapshot, logger, onImagePositionConfirm]);

  const handleImagePositionCancel = useCallback((itemId: string) => {
    const snapshot = imageOverlayEntrySnapshots[itemId];
    if (snapshot) {
      logger.info('图片叠加位置取消', { itemId, snapshot });
      handleImagePositionChange(itemId, snapshot);
    }
    clearImageOverlaySnapshot(itemId);
    setSelectedImageOverlay(null);
  }, [clearImageOverlaySnapshot, handleImagePositionChange, imageOverlayEntrySnapshots, logger]);

  // 新增：监听容器尺寸变化（ResizeObserver）
  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerDimensions({ width, height });
        }
      }
    });
    observer.observe(container);

    // 初始测量
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setContainerDimensions({ width: rect.width, height: rect.height });
    }

    return () => observer.disconnect();
  }, []);

  // 记录点击静音按钮前的音量值，便于取消静音时恢复
  const previousVolumeRef = useRef<number>(volume > 0 ? volume : 1);

  // 切换预览区静音状态：保存上一次非零音量，再次点击恢复
  const handleVolumeToggleMute = useCallback(() => {
    if (volume > 0) {
      previousVolumeRef.current = volume;
      handleVolumeChange(0);
    } else {
      handleVolumeChange(previousVolumeRef.current > 0 ? previousVolumeRef.current : 1);
    }
  }, [volume, handleVolumeChange]);

  // 使用导出hook（仅在有timelineState时启用）
  const videoExport = useVideoExport({
    timelineState: timelineState || {
      currentTime: 0,
      totalDuration: 0,
      zoomLevel: 1,
      selectedItems: [],
      tracks: [],
      playbackRate: 1,
      isPlaying: false,
      snapToGrid: false,
      gridSize: 1,
      scrollLeft: 0
    },
    materials: materials || [],
    taskId,
    aspectRatio: selectedAspectRatio.id // Pass selected aspect ratio to export hook
  });

  // Whether any track in the timeline has at least one item — gates the export button.
  const hasAnyExportableItem = useMemo(
    () => (timelineState?.tracks ?? []).some(track => (track.items?.length ?? 0) > 0),
    [timelineState],
  );

  // 处理视频比例切换
  const handleAspectRatioChange = useCallback((aspectRatio: AspectRatio) => {
    if (selectedAspectRatio.id === aspectRatio.id) return;
    setSelectedAspectRatioId(aspectRatio.id);
    logger.info('视频比例切换完成', {
      newRatio: aspectRatio.id,
      newRatioValue: aspectRatio.ratio,
    });
  }, [selectedAspectRatioId, logger]); // eslint-disable-line react-hooks/exhaustive-deps

  // 处理视频导出（带比例信息记录）
  const handleVideoExport = useCallback(async () => {
    logger.info('用户点击导出视频按钮', {
      selectedAspectRatio: selectedAspectRatio.id,
      playbackMode,
      tracksCount: timelineState?.tracks.length || 0,
      materialsCount: materials?.length || 0,
    });
    await videoExport.handleExport();
  }, [selectedAspectRatioId, playbackMode, timelineState, materials, videoExport.handleExport, logger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Player Console 渲染派生值：进度条已播放填充、音量填充、可拖动门。
  // 空/未知时长时 isSeekable=false → 进度条 disabled、播放键 disabled、--progress 兜底 0%。
  const totalForBar = getTotalDuration();
  const isSeekable = totalForBar > 0;
  const progressPercent = isSeekable ? (getCurrentTime() / totalForBar) * 100 : 0;
  const volumePercent = Math.round(volume * 100);

  return (
    <div
      className={`video-editing-composition-panel ${className}`}
      tabIndex={0}
      aria-label={t.videoPlayerPanel.accessibility.videoCompositionPanel}
    >
      <div className="composition-panel-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-primary/10 rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-1a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              {playbackMode === 'composition' ? t.videoPlayerPanel.playback.videoCompositionPlayback : t.videoPlayerPanel.playback.videoPreviewPlayback}
            </h3>
            {playbackMode === 'composition' && (
              <div className="flex items-center space-x-2">
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                  {compositionPlayback?.videoSequences.length || 0} {t.videoPlayerPanel.playback.videosCount}
                </span>
                {compositionPlayback?.audioSequences && compositionPlayback.audioSequences.length > 0 && (
                  <span className="text-xs bg-accent text-accent-foreground px-2 py-1 rounded">
                    {compositionPlayback.audioSequences.length} {t.videoPlayerPanel.playback.audioCount}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 导出视频按钮 */}
          {timelineState && timelineState.tracks.length > 0 && (
            <button
              onClick={handleVideoExport}
              disabled={videoExport.isExporting || !hasAnyExportableItem}
              title={
                !hasAnyExportableItem && !videoExport.isExporting
                  ? t.videoPlayerPanel.export.emptyTimeline
                  : undefined
              }
              className={`
                flex items-center space-x-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                ${videoExport.isExporting
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80'
                }
              `}
              aria-label={
                videoExport.isExporting
                  ? `${t.videoPlayerPanel.export.exporting} (${selectedAspectRatio.id})...`
                  : !hasAnyExportableItem
                    ? t.videoPlayerPanel.export.emptyTimeline
                    : `${t.videoPlayerPanel.export.exportVideo} (${selectedAspectRatio.id})`
              }
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !videoExport.isExporting && hasAnyExportableItem) {
                  e.preventDefault();
                  handleVideoExport();
                }
              }}
            >
              {videoExport.isExporting ? (
                <>
                  <div className="relative w-3 h-3">
                    <svg className="w-3 h-3 animate-spin" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    {videoExport.exportProgress > 0 && (
                      <div className="absolute -top-0.5 -right-0.5 text-[8px] bg-primary text-primary-foreground rounded-full w-2 h-2 flex items-center justify-center">
                        {Math.round(videoExport.exportProgress)}
                      </div>
                    )}
                  </div>
                  <span>
                    {videoExport.exportProgress > 0
                      ? t.videoPlayerPanel.export.exportingProgress.replace('{progress}', Math.round(videoExport.exportProgress).toString())
                      : t.videoPlayerPanel.export.exporting
                    }
                  </span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
                  </svg>
                  <span>{t.videoPlayerPanel.export.exportVideo}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="composition-panel-content">
        <div className="video-player-container">
          {/* 视频播放器区域 - 固定占用70%高度 */}
          <div className="video-player-wrapper">
            {/* 视频预览容器 - 固定高度70% */}
            <div
              ref={videoContainerRef}
              className="video-preview-container">
              {playbackMode === 'composition' && compositionPlayback && compositionPlayback.videoSequences.length > 0 ? (
                // 组合播放模式 - 稳定的宽高比容器
                <div
                  className={`${selectedAspectRatio.cssClass} bg-black rounded-md overflow-hidden relative`}
                  style={
                    previewFrameBox
                      ? {
                          // 已知容器尺寸：以 JS 算出的 contain 像素宽高撑满①(长边占满、短边留边)。
                          // minHeight:0 覆盖 CSS 的 min-height:200px，避免容器高<200px 时反噬。
                          width: `${previewFrameBox.width}px`,
                          height: `${previewFrameBox.height}px`,
                          minHeight: 0,
                          maxHeight: '100%',
                          maxWidth: '100%',
                          position: 'relative',
                        }
                      : {
                          // 首帧容器尺寸未知时的回退：维持原有 min-height 兜底，避免 0 尺寸。
                          maxHeight: '100%',
                          maxWidth: '100%',
                          minHeight: '200px',
                          position: 'relative',
                        }
                  }
                  onMouseDown={() => setSelectedImageOverlay(null)} // D1′：按下空白处取消选择（mousedown 触发，规避手势尾随 click 清选）
                >
                  {/* local-video-editing-refactor S4 — the multi-track compositor
                      host is now the SOLE preview surface. useCompositionPlayback
                      owns its engine lifecycle + feeds real subtitle/image overlay
                      data; there is no legacy fallback path. */}
                  <PreviewCanvas
                    ref={compositionPreview.hostRef}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      zIndex: 2,
                    }}
                  />

                  {/* 新增：图片叠加层 —— 句柄是②比例帧(position:relative)的绝对定位子节点，
                      故归一化基准必须用②的计算尺寸(previewFrameBox)，而非①的 containerDimensions，
                      使可拖拽句柄与合成器在 canvas 上栅格化的真实图片对齐。 */}
                  {getCurrentImageOverlays().map((overlay) => (
                    <ImageOverlay
                      key={overlay.id}
                      imageId={overlay.id}
                      imageUrl={overlay.url}
                      position={overlay.position}
                      containerWidth={previewFrameBox ? previewFrameBox.width : containerDimensions.width}
                      containerHeight={previewFrameBox ? previewFrameBox.height : containerDimensions.height}
                      onPositionChange={(newPosition) => handleImagePositionChange(overlay.id, newPosition)}
                      onConfirm={() => handleImagePositionConfirm(overlay.id, overlay.position)}
                      onCancel={() => handleImagePositionCancel(overlay.id)}
                      isSelected={selectedImageOverlay === overlay.id}
                      onSelect={() => handleImageOverlaySelect(overlay.id, overlay.position)}
                    />
                  ))}
                </div>
              ) : (
                // 预览模式占位符 - 充满整个容器，保持宽高比稳定
                // overflow-hidden：D3 防御兜底，占位模式叠加层若越界不溢出面板。
                <div
                  className="video-placeholder-container relative overflow-hidden"
                  onMouseDown={() => setSelectedImageOverlay(null)} // D1′：按下空白处取消选择（占位模式）
                  style={{
                    minHeight: '200px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {/* 比例预览框 - 保持与视频容器相同的宽高比稳定性 */}
                  <div
                    className={`${selectedAspectRatio.cssClass} video-placeholder-frame`}
                    style={{
                      minHeight: '200px',
                      maxHeight: '100%',
                      maxWidth: '100%'
                    }}
                  >
                    <div className="placeholder-content">
                      <p className="placeholder-text">
                        {playbackMode === 'composition'
                          ? t.videoPlayerPanel.placeholders.noMaterialsInTimeline
                          : t.videoPlayerPanel.placeholders.clickPlayToPreview}
                      </p>
                      <div className="placeholder-aspect-info">
                        {t.videoPlayerPanel.placeholders.currentAspectRatioLabel}: {selectedAspectRatio.description}
                      </div>
                    </div>
                  </div>

                  {/* 在预览模式下也显示图片叠加 */}
                  {getCurrentImageOverlays().map((overlay) => (
                    <ImageOverlay
                      key={overlay.id}
                      imageId={overlay.id}
                      imageUrl={overlay.url}
                      position={overlay.position}
                      containerWidth={containerDimensions.width}
                      containerHeight={containerDimensions.height}
                      onPositionChange={(newPosition) => handleImagePositionChange(overlay.id, newPosition)}
                      onConfirm={() => handleImagePositionConfirm(overlay.id, overlay.position)}
                      onCancel={() => handleImagePositionCancel(overlay.id)}
                      isSelected={selectedImageOverlay === overlay.id}
                      onSelect={() => handleImageOverlaySelect(overlay.id, overlay.position)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 播放控制台 Player Console —— 进度条 / 走带行 / 分隔线 / 设置行
              四段式单卡片，取代原先割裂的播放控制栏 + 宽高比信息栏两条横栏。 */}
          <div className="player-console">
            {/* 进度条：全宽，已播放段填充（--progress 见 §2.2） */}
            <div className="console-scrubber-row">
              <input
                type="range"
                min={0}
                max={isSeekable ? totalForBar : 1}
                step="any"
                value={getCurrentTime()}
                disabled={!isSeekable}
                onChange={(e) => handleTimeSeekClick(parseFloat(e.target.value))}
                aria-label={t.videoPlayerPanel.controls.seekAriaLabel}
                aria-valuetext={formatTime(getCurrentTime())}
                className="console-scrubber"
                style={{ ['--progress']: `${progressPercent}%` } as React.CSSProperties}
              />
            </div>

            {/* 走带行：播放键 + 时间 ｜ 音量 */}
            <div className="console-transport-row">
              <div className="console-transport-left">
                <button
                  type="button"
                  onClick={handlePlayPauseClick}
                  className="console-play-btn"
                  // G3 (round-3): keep the button clickable while materials are
                  // still downloading — only disable when there is nothing to play
                  // (getTotalDuration()===0). Clicking before ready must reach
                  // handlePlayPauseClick so its readiness guard can surface the toast.
                  disabled={getTotalDuration() === 0}
                  aria-disabled={!allTimelineMediaReady || undefined}
                  title={getCurrentlyPlaying() ? t.videoPlayerPanel.playback.pause : t.videoPlayerPanel.playback.play}
                >
                  {getCurrentlyPlaying() ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                <div className="console-time">
                  <span className="current-time">{formatTime(getCurrentTime())}</span>
                  <span className="time-separator">/</span>
                  <span className="total-time">{formatTime(getTotalDuration())}</span>
                </div>
              </div>

              <div className="console-transport-right">
                <div className="console-volume">
                  <button
                    type="button"
                    className="console-icon-btn"
                    onClick={handleVolumeToggleMute}
                    title={volume === 0 ? t.videoPlayerPanel.controls.unmute : t.videoPlayerPanel.controls.mute}
                    aria-label={volume === 0 ? t.videoPlayerPanel.controls.unmute : t.videoPlayerPanel.controls.mute}
                    aria-pressed={volume === 0}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      {volume === 0 ? (
                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                      ) : volume < 0.5 ? (
                        <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                      ) : volume < 1 ? (
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                      ) : (
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                      )}
                    </svg>
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    aria-label={t.videoPlayerPanel.controls.previewVolumeAriaLabel}
                    aria-valuetext={`${volumePercent}%`}
                    className="console-volume-slider"
                    style={{ ['--vol']: `${volumePercent}%` } as React.CSSProperties}
                  />
                </div>
              </div>
            </div>

            <div className="console-divider" />

            {/* 设置行：宽高比分段控件 + 封面入口 */}
            <div className="console-settings-row">
              <div className="console-ratio">
                <span className="console-ratio-label">{t.videoPlayerPanel.info.aspectRatio}</span>
                <div
                  className="console-ratio-segmented"
                  role="group"
                  aria-label={t.videoPlayerPanel.info.aspectRatio}
                >
                  {ASPECT_RATIOS.map((aspectRatio) => {
                    const isSelected = selectedAspectRatio.id === aspectRatio.id;
                    return (
                      <button
                        key={aspectRatio.id}
                        type="button"
                        onClick={() => handleAspectRatioChange(aspectRatio)}
                        className="console-ratio-seg"
                        title={aspectRatio.description}
                        aria-pressed={isSelected}
                        aria-label={
                          isSelected
                            ? `${t.videoPlayerPanel.accessibility.selectAspectRatio} ${aspectRatio.description} — ${t.videoPlayerPanel.accessibility.selected}`
                            : `${t.videoPlayerPanel.accessibility.selectAspectRatio} ${aspectRatio.description}`
                        }
                      >
                        {aspectRatio.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {projectId && (
                <CoverButton onClick={() => setIsCoverModalOpen(true)} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 视频导出进度弹窗 */}
      <VideoExportProgressModal
        isOpen={videoExport.isExporting}
        progress={videoExport.exportProgress}
        startTime={videoExport.exportStartTime}
        allowCancel={false}
      />

      {/* Video Cover authoring modal — only mounted when a projectId is bound. */}
      {projectId && (
        <VideoCoverModal
          isOpen={isCoverModalOpen}
          onClose={() => setIsCoverModalOpen(false)}
          projectId={projectId}
          projectName={projectName ?? ''}
          aspectRatio={selectedAspectRatio.id as CoverAspectRatio}
          materials={materials ?? []}
          timelineItems={timelineState?.tracks?.flatMap((tr) => tr.items) ?? []}
        />
      )}
    </div>
  );
});

// 设置组件显示名称，便于调试
VideoPlayerPanel.displayName = 'VideoPlayerPanel';

export default VideoPlayerPanel;
