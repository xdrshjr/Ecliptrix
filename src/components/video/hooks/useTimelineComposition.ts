import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { TimelineState, MaterialItem } from '@/types';
import { UseTimelineCompositionReturn, VideoSequenceItem, AudioSequenceItem, SubtitleSequenceItem, CompositionPlayback, VideoSeekCallback } from '../types';
import { VideoEditingLogger } from '../utils';
import { CompositionAdapter } from '../timeline/infrastructure';
import type { TrackData, MaterialData } from '../timeline/domain/types';
import { findSequenceAtCompositionTime } from '../utils/timelineMapping';
import { cameraMotionFingerprint } from '../playback/camera/fingerprint';
import {
  collectRenderSpans,
  computeRenderEnd,
  indexMaterialsById,
  type RenderSpan,
} from '../timeline/infrastructure/renderableTimeline';

/**
 * 折叠一个素材的「播放相关字段」为一段稳定字符串。
 *
 * RC-1：占位上传素材完成本地保存后，会把 url/cacheUrl/serverUrl/
 * metadata.localResolvedUrl 从空值翻转为 `/api/storage/files/...`，但素材 id
 * 与时间轴 item id 都不变。仅凭 id/数量/时长做变化检测会漏掉这次翻转，导致
 * 组合序列停留在空 URL 快照、`<video>.src` 永不赋值 → 加入轨道后无法预览。
 * 把这些字段纳入签名后，素材播放字段一变化即触发组合播放状态刷新。
 */
function materialPlaybackFields(material: MaterialItem | undefined): string {
  if (!material) return 'no-material';
  return [
    material.url,
    material.cacheUrl,
    material.serverUrl,
    material.metadata?.localResolvedUrl,
    material.previewProxyStatus,
    material.previewProxyLocalUrl,
    material.localProxyStatus,
    material.localProxyUrl,
  ]
    .map(value => value ?? '')
    .join('|');
}

/**
 * 折叠视频序列上「合成相关」的透传字段（spec 02 §5）。
 *
 * 加入轨道后由 timeline item 翻转的 audioDetached / opacity / 转场 / 轨道
 * z-order / 运镜，会改变合成器的叠加、转场与取景表现，但不属于 url/clip/timing。
 * 把它们纳入签名，确保 patch-after-insert 翻转这些字段时也触发组合状态刷新。
 * 音频序列没有这些字段，返回空串。
 *
 * ⚠️ camera-motion-2d-3d D12/P0-4：下面这条 early-return 守卫**必须**同时包含
 * `cameraMotion`。一个「只配了运镜、其余四个字段全是 undefined」的 clip 会在这里
 * 被短路掉，此时无论 return 数组里追加什么指纹都不会生效——那正是本仓历史上反复
 * 出现的「面板点了应用但预览不动」。
 */
function compositorPassthroughFields(
  seq: VideoSequenceItem | AudioSequenceItem,
): string {
  const v = seq as VideoSequenceItem;
  if (v.audioDetached === undefined && v.opacity === undefined &&
      v.trackZ === undefined && !v.transitionIn && !v.transitionOut &&
      v.cameraMotion === undefined) {
    return '';
  }
  return [
    v.audioDetached ? 'd' : '',
    v.opacity ?? '',
    v.trackZ ?? '',
    v.transitionIn ? `${v.transitionIn.type}:${v.transitionIn.duration}` : '',
    v.transitionOut ? `${v.transitionOut.type}:${v.transitionOut.duration}` : '',
    v.cameraMotion ? cameraMotionFingerprint(v.cameraMotion) : '',
  ].join(',');
}

/** 单个序列的播放签名：序列/item 字段取自 sequence，素材字段取自 live material。 */
function sequencePlaybackSignature(
  seq: VideoSequenceItem | AudioSequenceItem,
  materialsById: Map<string, MaterialItem>,
): string {
  const material = seq.materialId ? materialsById.get(seq.materialId) : undefined;
  return [
    seq.id,
    seq.materialId ?? '',
    seq.trackId ?? '',
    seq.url ?? '',
    (seq as VideoSequenceItem).cacheUrl ?? '',
    seq.clipStart ?? '',
    seq.clipEnd ?? '',
    seq.duration ?? '',
    seq.startTime ?? '',
    seq.volume ?? '',
    compositorPassthroughFields(seq),
    materialPlaybackFields(material),
  ].join('~');
}

/** 字幕序列签名：文本/时序/样式变化即触发刷新（无 live material 依赖）。 */
function subtitlePlaybackSignature(sub: SubtitleSequenceItem): string {
  const style = sub.style;
  return [
    sub.id,
    sub.trackId ?? '',
    sub.startTime ?? '',
    sub.duration ?? '',
    sub.text ?? '',
    style ? `${style.fontFamily}:${style.fontSize}:${style.fontColor}:${style.backgroundColor ?? ''}:${style.position}` : '',
  ].join('~');
}

/**
 * 组合播放签名：所有视频/音频/字幕序列签名的有界字符串拼接。
 * 以「字符串相等」而非深比较作为提交判据，更新成本低，且避免深比较带来的
 * 播放重置抖动（见 spec Risks 表）。
 */
export function computeCompositionSignature(
  videoSequences: VideoSequenceItem[],
  audioSequences: AudioSequenceItem[],
  subtitleSequences: SubtitleSequenceItem[],
  materials: MaterialItem[],
  renderSignature = '',
): string {
  const materialsById = new Map(materials.map(m => [m.id, m] as const));
  const videoPart = videoSequences
    .map(seq => sequencePlaybackSignature(seq, materialsById))
    .join('#');
  const audioPart = audioSequences
    .map(seq => sequencePlaybackSignature(seq, materialsById))
    .join('#');
  const subtitlePart = subtitleSequences
    .map(subtitlePlaybackSignature)
    .join('#');
  const signature = `V:${videoPart}||A:${audioPart}||S:${subtitlePart}`;
  return renderSignature ? `${signature}||R:${renderSignature}` : signature;
}

/**
 * ME-07：图片不在视频/音频/字幕序列里，但图片的增删改与时间轴终点变化同样要触发
 * 组合状态刷新（否则「图片 + 配音」时间轴改了图片时长，预览终点仍停在旧值）。
 */
export function computeRenderSignature(spans: readonly RenderSpan[], totalDuration: number): string {
  const imagePart = spans
    .filter(span => span.kind === 'image')
    .map(span => `${span.itemId}:${span.start}:${span.end}`)
    .join('|');
  return `${imagePart}#${totalDuration}`;
}

/**
 * useTimelineComposition Hook
 * 管理时间轴组合播放功能
 *
 * Simplified: sequence extraction logic has been moved to CompositionAdapter
 * in the infrastructure layer. This hook now delegates to that adapter and
 * manages only the React-specific composition playback state.
 *
 * @param taskId - 任务ID，用于日志记录
 * @param materials - 素材列表，用于获取视频URL
 * @param onVideoSeekRequired - 视频播放器跳转回调，用于实时同步timeline变化到视频播放器
 * @returns 时间轴组合播放相关的状态和控制方法
 */
export const useTimelineComposition = (
  taskId: string,
  materials: MaterialItem[],
  onVideoSeekRequired?: VideoSeekCallback
): UseTimelineCompositionReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useTimelineComposition'
  }), [taskId]);

  // Infrastructure adapter for sequence extraction
  const compositionAdapter = useMemo(() => new CompositionAdapter(), []);

  // 组合播放状态
  const [compositionPlayback, setCompositionPlayback] = useState<CompositionPlayback>({
    isCompositionMode: false,
    videoSequences: [],
    audioSequences: [],
    subtitleSequences: [],
    currentSequenceIndex: 0,
    totalCompositionDuration: 0,
    compositionCurrentTime: 0
  });

  // 记录初始化日志
  useEffect(() => {
    logger.info('Timeline Composition Hook初始化', {
      materialsCount: materials.length,
      videoMaterialsCount: materials.filter(m => m.type === 'video').length,
      audioMaterialsCount: materials.filter(m => m.type === 'audio').length
    });
  }, []);

  // 从时间轴状态提取视频序列 — delegates to CompositionAdapter
  const getVideoSequencesFromTimeline = useCallback((timelineState: TimelineState): VideoSequenceItem[] => {
    // Convert TimelineState tracks/materials to domain-compatible shapes
    const tracks = timelineState.tracks as unknown as TrackData[];
    const materialData = materials as unknown as MaterialData[];
    return compositionAdapter.extractVideoSequences(tracks, materialData);
  }, [materials, compositionAdapter]);

  // 从时间轴状态提取音频序列 — delegates to CompositionAdapter
  const getAudioSequencesFromTimeline = useCallback((timelineState: TimelineState): AudioSequenceItem[] => {
    const tracks = timelineState.tracks as unknown as TrackData[];
    const materialData = materials as unknown as MaterialData[];
    return compositionAdapter.extractAudioSequences(tracks, materialData);
  }, [materials, compositionAdapter]);

  // 从时间轴状态提取字幕序列 — delegates to CompositionAdapter（不依赖 materials，
  // 字幕文本/样式直接挂在 item 上）。
  const getSubtitleSequencesFromTimeline = useCallback((timelineState: TimelineState): SubtitleSequenceItem[] => {
    const tracks = timelineState.tracks as unknown as TrackData[];
    return compositionAdapter.extractSubtitleSequences(tracks) as unknown as SubtitleSequenceItem[];
  }, [compositionAdapter]);

  // RC-1：保存最近一次的 TimelineState，供 materials 变化时重新提取序列使用。
  const lastTimelineStateRef = useRef<TimelineState | null>(null);
  // RC-1：已提交的组合播放签名，作为「是否需要 setState」的唯一判据。
  const compositionSignatureRef = useRef<string>('');

  // 依据给定的 TimelineState 重建组合播放状态。
  // 提交判据从「id/数量/时长变化」升级为「播放签名变化」：占位素材完成本地
  // 保存后 url 等字段翻转、id 不变，旧判据会漏更新，导致序列停留在空 URL 快照。
  const rebuildCompositionPlayback = useCallback((timelineState: TimelineState) => {
    const videoSequences = getVideoSequencesFromTimeline(timelineState);
    const audioSequences = getAudioSequencesFromTimeline(timelineState);
    const subtitleSequences = getSubtitleSequencesFromTimeline(timelineState);
    // ME-07 / S5：预览终点 = 最晚的渲染条目结束时间（与导出 total_duration 同一口径），
    // 不是视频片段时长之和；只要有任何可渲染条目（含仅图片 + 配音）就进入合成预览。
    const spans = collectRenderSpans(timelineState.tracks, indexMaterialsById(materials));
    const totalDuration = computeRenderEnd(spans);
    const isCompositionMode = spans.length > 0;

    // R-5：先比对（廉价的）字符串签名，签名未变则连 setState 都不触发，
    // 避免 materials 频繁换引用时的播放重置抖动。签名纳入字幕序列，字幕新增/
    // 改文本/改样式同样触发刷新。
    const nextSignature = computeCompositionSignature(
      videoSequences, audioSequences, subtitleSequences, materials,
      computeRenderSignature(spans, totalDuration),
    );
    if (nextSignature === compositionSignatureRef.current) {
      return;
    }
    compositionSignatureRef.current = nextSignature;

    logger.info('时间轴状态变化 - 更新组合播放状态', {
      videoSequencesCount: videoSequences.length,
      audioSequencesCount: audioSequences.length,
      subtitleSequencesCount: subtitleSequences.length,
      renderSpanCount: spans.length,
      totalDuration,
      isCompositionMode,
    });

    setCompositionPlayback(prev => {
      // 保留 currentSequenceIndex：当前序列 id 仍存在时沿用它的新下标（避免在
      // 加片段或素材刷新时把播放头跳回第一段）；不存在时有序列回 0，无序列保持原值。
      const currentSequenceId = prev.videoSequences[prev.currentSequenceIndex]?.id;
      const preservedIndex = currentSequenceId
        ? videoSequences.findIndex(seq => seq.id === currentSequenceId)
        : -1;
      const nextSequenceIndex = preservedIndex >= 0
        ? preservedIndex
        : (videoSequences.length > 0 ? 0 : prev.currentSequenceIndex);

      return {
        ...prev,
        videoSequences,
        audioSequences,
        subtitleSequences,
        totalCompositionDuration: totalDuration,
        isCompositionMode,
        currentSequenceIndex: nextSequenceIndex
      };
    });
  }, [getVideoSequencesFromTimeline, getAudioSequencesFromTimeline, getSubtitleSequencesFromTimeline, materials, logger]);

  // 处理时间轴状态变化
  const handleTimelineStateChange = useCallback((timelineState: TimelineState) => {
    lastTimelineStateRef.current = timelineState;
    rebuildCompositionPlayback(timelineState);
  }, [rebuildCompositionPlayback]);

  // RC-1：materials 变化（占位→完成本地素材、远端→缓存写回）时，时间轴状态本身
  // 往往没变，父组件不会再次调用 handleTimelineStateChange。这里以最近一次
  // TimelineState 重新提取序列，让刷新后的素材播放字段重新发布到组合播放状态，
  // 否则序列会一直停留在加入轨道那一刻的空/旧 URL 快照。
  useEffect(() => {
    const timelineState = lastTimelineStateRef.current;
    if (!timelineState) return;
    rebuildCompositionPlayback(timelineState);
  }, [materials, rebuildCompositionPlayback]);

  // 组合播放控制
  const handleCompositionPlay = useCallback(() => {
    logger.userAction('组合播放开始', 'compositionPlayButton', {
      sequencesCount: compositionPlayback.videoSequences.length,
      totalDuration: compositionPlayback.totalCompositionDuration,
      currentSequenceIndex: compositionPlayback.currentSequenceIndex
    });

    setCompositionPlayback(prev => ({
      ...prev,
      isCompositionMode: true
    }));
  }, [compositionPlayback, logger]);

  // 组合暂停控制
  const handleCompositionPause = useCallback(() => {
    logger.userAction('组合播放暂停', 'compositionPauseButton', {
      currentTime: compositionPlayback.compositionCurrentTime,
      currentSequenceIndex: compositionPlayback.currentSequenceIndex
    });
  }, [compositionPlayback, logger]);

  // 组合时间跳转
  const handleCompositionSeek = useCallback(async (time: number) => {
    const clampedTime = Math.max(0, Math.min(time, compositionPlayback.totalCompositionDuration));
    const target = findSequenceAtCompositionTime(compositionPlayback.videoSequences, clampedTime);
    const currentSequenceIndex = target?.index ?? 0;
    const targetVideoTime = target?.offset ?? 0;
    const targetSequence = target?.sequence;

    if (onVideoSeekRequired && targetSequence) {
      // 关键：在 await 之前同步写入 currentSequenceIndex。
      // Why: video 元素 currentTime 赋值会在 await 期间触发 timeupdate；
      // 若 currentSequenceIndex 还是旧值，反向映射会用错的 sequence 把
      // timelineCurrentTime 钳到旧片段开头，造成光标"跳回片段开头"。
      setCompositionPlayback(prev => ({
        ...prev,
        compositionCurrentTime: clampedTime,
        currentSequenceIndex
      }));
      try {
        await onVideoSeekRequired(clampedTime, targetSequence, targetVideoTime);
      } catch (error) {
        logger.error('视频播放器实时跳转失败', error as Error, {
          compositionTime: clampedTime.toFixed(2)
        });
      }
    } else {
      setCompositionPlayback(prev => ({
        ...prev,
        compositionCurrentTime: clampedTime,
        currentSequenceIndex
      }));
    }
  }, [compositionPlayback, logger, onVideoSeekRequired]);

  // 切换到下一个视频序列
  const handleNextSequence = useCallback(() => {
    if (compositionPlayback.currentSequenceIndex < compositionPlayback.videoSequences.length - 1) {
      const nextIndex = compositionPlayback.currentSequenceIndex + 1;

      logger.info('切换到下一个视频序列', {
        currentIndex: compositionPlayback.currentSequenceIndex,
        nextIndex,
        nextSequence: compositionPlayback.videoSequences[nextIndex]?.name
      });

      setCompositionPlayback(prev => ({
        ...prev,
        currentSequenceIndex: nextIndex
      }));

      return true;
    }

    return false;
  }, [compositionPlayback, logger]);

  // 更新组合播放时间
  const handleCompositionTimeUpdate = useCallback((currentTime: number) => {
    setCompositionPlayback(prev => ({
      ...prev,
      compositionCurrentTime: currentTime
    }));
  }, []);

  // 更新当前序列索引
  const handleSequenceIndexUpdate = useCallback((sequenceIndex: number) => {
    setCompositionPlayback(prev => ({
      ...prev,
      currentSequenceIndex: sequenceIndex
    }));
  }, []);

  return {
    compositionPlayback,
    handleTimelineStateChange,
    handleCompositionPlay,
    handleCompositionPause,
    handleCompositionSeek,
    getVideoSequencesFromTimeline,
    getAudioSequencesFromTimeline,
    handleNextSequence,
    handleCompositionTimeUpdate,
    handleSequenceIndexUpdate
  };
};
