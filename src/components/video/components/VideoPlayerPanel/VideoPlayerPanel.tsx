'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { UseVideoPlaybackReturn, VideoPreview, CompositionPlayback, VideoSequenceItem } from '../../types';
import { TimelineState, MaterialItem, ImagePosition } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import type { RemoteMaterialPatch } from '../../hooks/useRemoteMaterialPrefetch';
import ImageOverlay from './ImageOverlay';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { CoverButton, VideoCoverModal } from '../VideoCoverModal';
import type { CoverAspectRatio } from '../VideoCoverModal/types';
import { isPreviewProxyEnabled, isLocalPreviewEnabled } from '@/lib/playbackFlags';
import PreviewCanvas from './PreviewCanvas';
import CameraDegradeBadge from './CameraDegradeBadge';
import { useCompositionPlayback } from '../../hooks/useCompositionPlayback';
import { buildAspectRatios, aspectRatioToNumber, computeContainBox, type AspectRatio } from './aspectRatios';
import { getImageOverlayPlaybackTime, selectActiveImageOverlays } from './imageOverlays';
import { useCompositionTransport, computeProgressPercent, type MediaReadiness } from './useCompositionTransport';
import { usePlayStateMirror } from './usePlayStateMirror';
import { resolveConsoleTime } from './consoleTime';
import CanvasMenu from './CanvasMenu';
import { outputSizeForAspect } from '../../lib/subtitleLayout';
import { useTimelineStore } from '../../timeline/store';
import { fitImagePositionAction } from '../../timeline/store/actions/updateItemFields';

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
  // 时间轴与素材：驱动合成预览、图片叠加与空状态（导出已上移到顶栏）
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
  /**
   * Controlled aspect ratio id (spec §3.2 「状态上移」): the parent owns it so
   * the top-bar export and this preview read the same value (R2).
   */
  aspectRatioId: string;
  onAspectRatioChange: (id: string) => void;
  /** Empty-state 「打开素材」: switch the right panel to the materials tab. */
  onOpenMaterials?: () => void;
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
  aspectRatioId,
  onAspectRatioChange,
  onOpenMaterials,
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
  // UI3-12：播放态镜像到时间轴 store（标尺「播放中」），卸载时复位。
  usePlayStateMirror(isCompositionPlaying);

  const updateCompositionCurrentTime = useCallback((time: number) => {
    compositionCurrentTimeRef.current = time;
    setCompositionCurrentTime(time);
  }, []);

  // Cover modal open state — opened from the CoverButton in the canvas menu.
  const [isCoverModalOpen, setIsCoverModalOpen] = useState<boolean>(false);
  const selectedAspectRatio = ASPECT_RATIOS.find(ar => ar.id === aspectRatioId) || ASPECT_RATIOS[0];

  // 新增：图片叠加相关状态
  const [selectedImageOverlay, setSelectedImageOverlay] = useState<string | null>(null);
  const [imageOverlayEntrySnapshots, setImageOverlayEntrySnapshots] = useState<Record<string, ImagePosition>>({});
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  const videoContainerRef = useRef<HTMLDivElement>(null);
  // S9：Agent 执行期间时间轴处于编辑锁，图片叠加的拖动 / 缩放手柄不可用。
  const isImageEditLocked = useTimelineStore((state) => state.externalEditLock !== null);

  useEffect(() => {
    if (isImageEditLocked) setSelectedImageOverlay(null);
  }, [isImageEditLocked]);

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
    outputSize: outputSizeForAspect(selectedAspectRatio.id),
    masterVolume: volume,
    enabled: true,
  });

  // 当前播放模式：preview 或 composition。ME-07：只要时间轴有任何可渲染条目
  // （含仅图片 + 配音）就进入合成预览，不再要求存在视频序列。
  const playbackMode = compositionPlayback?.isCompositionMode ? 'composition' : 'preview';
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

  // ME-05：手势结束即是一次编辑——立即作为一步可撤销操作写入时间轴，导出、自动保存与
  // 下一次时间轴编辑读到的都是它，而不是只存在于组件状态、等用户记得点确认的位置。
  const handleImageGestureEnd = useCallback((itemId: string, position: ImagePosition) => {
    logger.info('图片叠加手势结束，写入时间轴', { itemId, position });
    onImagePositionConfirm?.(itemId, position);
  }, [logger, onImagePositionConfirm]);

  // 首帧自动适配不是用户编辑：写入时间轴但不进撤销历史。action 拒绝（编辑锁 / 锁定轨）时
  // 本地预览也不改：只存在于组件状态的框会进导出却不进 store，下一次时间轴同步又被冲回（ME-05）。
  const handleImageAutoFit = useCallback((itemId: string, position: ImagePosition) => {
    if (fitImagePositionAction(() => useTimelineStore.getState(), itemId, position)) {
      handleImagePositionChange(itemId, position);
    }
  }, [handleImagePositionChange]);

  // 「完成」：手势已逐次入库，这里只结束选中。
  const handleImageOverlayDone = useCallback((itemId: string) => {
    clearImageOverlaySnapshot(itemId);
    setSelectedImageOverlay(null);
  }, [clearImageOverlaySnapshot]);

  // 「还原位置」：回到本次选中前的位置，同样是一步可撤销操作（值未变时不记录）。
  const handleImageOverlayRevert = useCallback((itemId: string) => {
    const entryPosition = imageOverlayEntrySnapshots[itemId];
    if (entryPosition) {
      logger.info('图片叠加还原到选中前位置', { itemId, entryPosition });
      handleImagePositionChange(itemId, entryPosition);
      onImagePositionConfirm?.(itemId, entryPosition);
    }
    clearImageOverlaySnapshot(itemId);
    setSelectedImageOverlay(null);
  }, [clearImageOverlaySnapshot, handleImagePositionChange, imageOverlayEntrySnapshots, logger, onImagePositionConfirm]);

  // 可拖拽句柄叠在画布上（图片本身由合成器绘制）；编辑锁期间不渲染句柄（S9）。
  const renderImageOverlayHandles = (frameWidth: number, frameHeight: number) =>
    isImageEditLocked ? null : getCurrentImageOverlays().map((overlay) => (
      <ImageOverlay
        key={overlay.id}
        imageId={overlay.id}
        imageUrl={overlay.url}
        position={overlay.position}
        containerWidth={frameWidth}
        containerHeight={frameHeight}
        onPositionChange={(newPosition) => handleImagePositionChange(overlay.id, newPosition)}
        onGestureEnd={handleImageGestureEnd}
        onAutoFit={handleImageAutoFit}
        onConfirm={() => handleImageOverlayDone(overlay.id)}
        onCancel={() => handleImageOverlayRevert(overlay.id)}
        isSelected={selectedImageOverlay === overlay.id}
        onSelect={() => handleImageOverlaySelect(overlay.id, overlay.position)}
        readOnly={overlay.isLocked}
      />
    ));

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

  // 时间轴是否有任何条目：决定画布区显示空状态引导还是预览。
  const hasTimelineContent = useMemo(
    () => (timelineState?.tracks ?? []).some(track => (track.items?.length ?? 0) > 0),
    [timelineState],
  );

  // 处理视频比例切换（受控：状态归父组件，导出与预览读同一值）
  const handleAspectRatioChange = useCallback((aspectRatio: AspectRatio) => {
    if (aspectRatioId === aspectRatio.id) return;
    onAspectRatioChange(aspectRatio.id);
    logger.info('视频比例切换完成', {
      newRatio: aspectRatio.id,
      newRatioValue: aspectRatio.ratio,
    });
  }, [aspectRatioId, onAspectRatioChange, logger]);

  // 全屏只作用于预览容器；状态跟随 fullscreenchange（Esc 退出也能同步）。
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreen(
      document.fullscreenElement !== null && document.fullscreenElement === videoContainerRef.current,
    );
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await videoContainerRef.current?.requestFullscreen();
    } catch (error) {
      logger.warn('切换全屏失败', { error: error instanceof Error ? error.message : String(error) });
    }
  }, [logger]);
  const fullscreenLabel = isFullscreen ? t.workbench.preview.exitFullscreen : t.workbench.preview.fullscreen;

  // Player Console 渲染派生值：进度条已播放填充、音量填充、可拖动门。
  // 空/未知时长时 isSeekable=false → 进度条 disabled、播放键 disabled、--progress 兜底 0%。
  // 时间文字与进度条只读 resolveConsoleTime（与喂给合成器的时间同源，RV-06）；
  // useCompositionTransport.getCurrentTime / 命令式句柄语义不变。
  const totalForBar = getTotalDuration();
  const isSeekable = totalForBar > 0;
  const consoleTime = resolveConsoleTime({
    playbackMode,
    currentTimelineTime,
    compositionCurrentTime,
    currentTime,
    totalDuration: totalForBar,
  });
  const progressPercent = computeProgressPercent(consoleTime, totalForBar);
  const volumePercent = Math.round(volume * 100);

  // 空状态（时间轴无内容）：引导生成初稿或拖入素材，「打开素材」切到右栏素材页。
  const renderEmptyState = () => (
    <div className="ws-empty ws-preview-empty">
      <p>{t.workbench.preview.emptyHint}</p>
      {onOpenMaterials && (
        <button type="button" className="ws-btn ws-btn--outline-primary" onClick={onOpenMaterials}>
          {t.workbench.preview.openMaterials}
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`ws-preview ${className}`}
      tabIndex={0}
      aria-label={t.videoPlayerPanel.accessibility.videoCompositionPanel}
    >
      <div className="ws-panel-header ws-preview-header">
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className="ws-preview-title-icon"
        >
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M10 8.5v5l4-2.5z" />
          <path d="M8 21h8M12 17v4" />
        </svg>
        <h3 className="ws-panel-title">{t.workbench.preview.title}</h3>
        <CanvasMenu
          aspectRatios={ASPECT_RATIOS}
          selectedId={selectedAspectRatio.id}
          onSelect={handleAspectRatioChange}
          videoCount={compositionPlayback?.videoSequences.length || 0}
          audioCount={compositionPlayback?.audioSequences?.length || 0}
          coverSlot={projectId ? <CoverButton onClick={() => setIsCoverModalOpen(true)} /> : undefined}
        />
        <button
          type="button"
          className="ws-icon-btn ws-preview-fullscreen"
          onClick={handleToggleFullscreen}
          aria-label={fullscreenLabel}
          title={fullscreenLabel}
          aria-pressed={isFullscreen}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          >
            {isFullscreen
              ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
          </svg>
        </button>
      </div>

      <div className="composition-panel-content">
        <div className="video-player-container">
          {/* 画布区：吃满剩余高度，比例帧按 contain-box 居中（几何不变） */}
          <div className="video-player-wrapper">
            <div
              ref={videoContainerRef}
              className="video-preview-container">
              {!hasTimelineContent ? renderEmptyState() : playbackMode === 'composition' && compositionPlayback ? (
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
                    onVolumeBoostUnavailable={() => showWarning(t.videoPlayerPanel.playback.volumeBoostUnavailable)}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      zIndex: 2,
                    }}
                  />

                  {/* 3D 运镜运行期降级角标（camera-motion-stills §4.3.5）。绝对定位
                      在比例帧内，不参与 letterbox 计算；运镜面板打开时由它自己的
                      静态角标负责，这里同屏去重（D29）。 */}
                  <CameraDegradeBadge degraded={compositionPreview.camera3DDegraded} />

                  {/* 新增：图片叠加层 —— 句柄是②比例帧(position:relative)的绝对定位子节点，
                      故归一化基准必须用②的计算尺寸(previewFrameBox)，而非①的 containerDimensions，
                      使可拖拽句柄与合成器在 canvas 上栅格化的真实图片对齐。 */}
                  {renderImageOverlayHandles(
                    previewFrameBox ? previewFrameBox.width : containerDimensions.width,
                    previewFrameBox ? previewFrameBox.height : containerDimensions.height,
                  )}
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
                  {renderImageOverlayHandles(containerDimensions.width, containerDimensions.height)}
                </div>
              )}
            </div>
          </div>

          {/* 播放条 Player Console —— 单行：播放键 / 时间 / 进度条 / 音量（spec §3.6） */}
          <div className="player-console">
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
              aria-label={getCurrentlyPlaying() ? t.videoPlayerPanel.playback.pause : t.videoPlayerPanel.playback.play}
            >
              {getCurrentlyPlaying() ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            <div className="console-time">
              <span className="current-time">{formatTime(consoleTime)}</span>
              <span className="time-separator">/</span>
              <span className="total-time">{formatTime(getTotalDuration())}</span>
            </div>

            <input
              type="range"
              min={0}
              max={isSeekable ? totalForBar : 1}
              step="any"
              value={consoleTime}
              disabled={!isSeekable}
              onChange={(e) => handleTimeSeekClick(parseFloat(e.target.value))}
              aria-label={t.videoPlayerPanel.controls.seekAriaLabel}
              aria-valuetext={formatTime(consoleTime)}
              className="console-scrubber"
              style={{ ['--progress']: `${progressPercent}%` } as React.CSSProperties}
            />

            <div className="console-volume">
              <button
                type="button"
                className="console-icon-btn"
                onClick={handleVolumeToggleMute}
                title={volume === 0 ? t.videoPlayerPanel.controls.unmute : t.videoPlayerPanel.controls.mute}
                aria-label={volume === 0 ? t.videoPlayerPanel.controls.unmute : t.videoPlayerPanel.controls.mute}
                aria-pressed={volume === 0}
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                >
                  <path d="M11 5L6 9H3v6h3l5 4z" />
                  {volume === 0 ? (
                    <path d="M16 9l5 6M21 9l-5 6" />
                  ) : (
                    <>
                      <path d="M15.5 8.5a5 5 0 010 7" />
                      {volume >= 0.5 && <path d="M18.5 5.5a9 9 0 010 13" />}
                    </>
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
      </div>

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
