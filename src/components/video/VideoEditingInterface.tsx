'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { VideoEditingLogger } from './utils/logger';
import { VideoEditingTaskContent, ScriptGenerationConfig, TimelineState, MaterialItem, ImagePosition, AIVideoScriptSegment, StoryboardScriptSegment, ScriptSegment } from '@/types';
import { useVideoEditingStore } from '@/stores';
import ScriptPanel from './ScriptPanel';
import { TimelinePanel, useTimelineStore } from './timeline';
import { shouldGlobalSpaceTogglePlayback } from './timeline/shortcutOwnership';
import { updateImagePositionAction } from './timeline/store/actions/updateItemFields';
import { nextExternalUpdateId } from './timeline/lib/externalUpdateId';
import {
  applyScriptAutoMixAction,
  checkAutoMixTargets,
  type AutoMixRefusal,
} from './timeline/store/actions/applyScriptAutoMix';
import { planScriptAutoMix, type ScriptAutoMixPlan } from './lib/aiMix/planScriptAutoMix';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import '../../styles/video-editing.css';
import { shouldRestrictVideoEditing, getDeviceType, getDeviceInfo } from '@/lib/utils/deviceDetection';
import { MobileWarningDialog } from '@/components/ui';
import { 
  useDocumentState,
  usePreviewTransport,
  useAIAssistant,
  useScriptGeneration,
  useMaterialManagement,
  useVideoSearch,
  useAudioSearch,
  useImageSearch,
  useTimelineComposition,
  useVideoAnalysis,
  useNarrationDirectScript
} from './hooks';
import { useAgentExecution } from './hooks/useAgentExecution';
import { useAIMixedEditing } from './hooks/useAIMixedEditing';
import { generateKeywordsForSegments, deriveLocalKeywordsFromNarration } from './hooks/useScriptGeneration';
import { generateNarrationVideoScript } from '@/lib/api/narrationVideoScript';
import {
  enrichNarrationSegments as enrichNarrationSegmentsCore,
  regenerateNarrationVideoScript,
} from './utils/enrichNarrationSegments';
import { enrichSegmentsWithKeywords } from './utils/enrichSegmentsWithKeywords';
import { resolveNarrationSegmentsWrite } from './utils/narrationSegmentsWrite';
import type { NarrationCompleteMode } from './types/videoEditingTypes';
import { useConvertToScript } from './hooks/useConvertToScript';
import { useVideoUnderstandingScript } from './hooks/useVideoUnderstandingScript';
import VideoUnderstandingScriptModal from './components/VideoUnderstandingScriptModal';
import { getMockScriptSegments, mockVideoPreview } from './data';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { http, ApiError } from '@/lib/api/http-client';
import type { ArkVideoGenerateParams } from '@/lib/api/arkVideo';
import {
  DocumentPanel,
  AIAssistantPanel,
  MaterialsPanel,
  VideoPlayerPanel,
  VideoSearchModal,
  AudioSearchModal,
  ImageSearchModal,
  ContentPolishModal,
  ScriptGenerationModal,
  ScriptGenerationProgressModal,
  CreativeBrainstormingModal,
  VideoAnalysisModal,
  AIMixingProgressModal,
  AIMixingModeSelectionModal,
  BatchAnalysisModeSelectionModal,
  NarrationDirectScriptModal,
  VideoUnderstandingModePlaceholderModal,
  AgentChatDock
} from './components';
import ConvertToScriptModal from './components/ConvertToScriptModal';
import { createAIVideoSegment } from './components/AIVideoScriptTab';
import VideoUnderstandingScriptProgressModal from './components/VideoUnderstandingScriptProgressModal';
import { AsyncTaskPoller } from './components/AsyncTaskPoller';
import { Conversation, ChatMessage } from '@/types';
import VideoCutModal, { VideoClip } from './components/VideoCutModal/VideoCutModal';
import { VideoPlayerPanelRef } from './components/VideoPlayerPanel/VideoPlayerPanel';

/**
 * Parse agent-generated markdown script into ScriptSegment[] format.
 * Agent formats scripts as: ## 1. Title\n\nContent\n\n## 2. Title\n\nContent
 */
/** Split text into sentences with fallback to newline splitting */
function splitIntoSentences(text: string): string[] {
  let sentences = text.split(/(?<=[。！？.!?])\s*/).filter(s => s.trim().length > 0);
  // If punctuation splitting failed (only one long result), try newline splitting
  if (sentences.length <= 1 && text.length > 100) {
    sentences = text.split(/\n+/).filter(s => s.trim().length > 0);
  }
  return sentences;
}

function parseAgentScriptToSegments(text: string): ScriptSegment[] {
  const parts = text.split(/^## \d+\.\s*/m).filter(Boolean);
  if (parts.length === 0) {
    // No numbered headings — treat entire text as one segment
    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) return [];
    return [{
      id: 'agent-segment-0',
      title: 'Script',
      sentences: sentences.map((s, j) => ({ id: `agent-s-0-${j}`, text: s.trim() })),
    }];
  }
  return parts.map((part, i) => {
    const lines = part.trim().split('\n');
    const title = lines[0]?.trim() || `Segment ${i + 1}`;
    const body = lines.slice(1).join('\n').trim();
    const sentences = splitIntoSentences(body)
      .map((s, j) => ({ id: `agent-s-${i}-${j}`, text: s.trim() }));
    return { id: `agent-segment-${i}`, title, sentences };
  });
}

/**
 * timeline-preview-playback-stutter fix (B-b). Debounce (ms) after the last
 * playhead change before the settled position is persisted into `content`.
 * Must exceed the playhead push cadence (~one REACT_PLAYHEAD_THROTTLE_MS window)
 * so it never fires mid-playback, yet stay short enough that a pause/scrub is
 * saved almost immediately.
 */
const PLAYHEAD_PERSIST_SETTLE_MS = 500;

interface VideoEditingInterfaceProps {
  taskId: string;
  /** Owning project id when the editor is mounted from VideoEditorContainer.
   *  Optional so legacy mount paths (Task-only, no project) keep compiling
   *  — storyboard pack APIs throw on the server when missing, and the
   *  Materials panel disables pack creation in that case. */
  projectId?: string;
  content: VideoEditingTaskContent | null;
  onUpdateContent: (content: VideoEditingTaskContent) => void;
}

const VideoEditingInterface: React.FC<VideoEditingInterfaceProps> = ({
  taskId,
  projectId,
  content,
  onUpdateContent,
}) => {
  // 获取国际化上下文
  const { locale, t } = useLocale();
  
  // 获取通知上下文
  const { showSuccess, showError, showWarning, showInfo } = useNotification();
  
  // 获取用户认证信息
  
  // Mobile device detection and warning state (not persisted - runtime state)
  const [showMobileWarning, setShowMobileWarning] = useState(false);
  const [currentDeviceType, setCurrentDeviceType] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');
  
  // Restore UI state from content or use defaults
  const [timelineCurrentTime, setTimelineCurrentTime] = useState<number>(
    content?.uiState?.timelineCurrentTime ?? 0
  );
  const [currentTimelineState, setCurrentTimelineState] = useState<TimelineState | null>(
    content?.uiState?.currentTimelineState ?? null
  );
  // 新增：外部时间轴状态更新标识，用于避免循环更新 (not persisted - transient state)
  const [externalTimelineUpdateId, setExternalTimelineUpdateId] = useState<string | null>(null);
  
  // 智能润色弹窗状态
  const [isPolishModalOpen, setIsPolishModalOpen] = useState<boolean>(
    content?.uiState?.isPolishModalOpen ?? false
  );
  const [polishChatContent, setPolishChatContent] = useState<string>('');
  
  // 脚本生成弹窗状态
  const [isScriptGenerationModalOpen, setIsScriptGenerationModalOpen] = useState<boolean>(
    content?.uiState?.isScriptGenerationModalOpen ?? false
  );

  // 脚本生成开始时间状态
  const [scriptGenerationStartTime, setScriptGenerationStartTime] = useState<number | null>(
    content?.uiState?.scriptGenerationStartTime ?? null
  );

  // 存储要转换为脚本的消息内容 (not persisted - transient state)
  const [messageContentForScript, setMessageContentForScript] = useState<string | null>(null);

  // AI视频脚本生成弹窗状态
  const [isAIVideoScriptModalOpen, setIsAIVideoScriptModalOpen] = useState(false);

  // 创意构思弹窗状态
  const [isCreativeBrainstormingModalOpen, setIsCreativeBrainstormingModalOpen] = useState<boolean>(
    content?.uiState?.isCreativeBrainstormingModalOpen ?? false
  );
  
  // 批量解析模式选择弹窗状态
  const [isBatchAnalysisModalOpen, setIsBatchAnalysisModalOpen] = useState<boolean>(
    content?.uiState?.isBatchAnalysisModalOpen ?? false
  );
  
  // 新增：程序化添加素材到时间轴的状态 (not persisted - transient operation state)
  const [materialsToAddToTimeline, setMaterialsToAddToTimeline] = useState<{ 
    materials: MaterialItem[], 
    targetTrackId?: string, 
    timestamp: number 
  } | undefined>(undefined);

  // AI自动混剪替换确认（内存态，不持久化）。关闭后保留 plan/数量，
  // 让退场动画期间的文案保持不变。
  const [autoMixConfirm, setAutoMixConfirm] = useState<{
    isOpen: boolean;
    plan: ScriptAutoMixPlan | null;
    replacedItemCount: number;
  }>({ isOpen: false, plan: null, replacedItemCount: 0 });

  // 视频剪切弹窗状态
  const [videoCutModal, setVideoCutModal] = useState<{
    isOpen: boolean;
    material: MaterialItem | null;
  }>(content?.uiState?.videoCutModal ?? {
    isOpen: false,
    material: null
  });

  // 聊天状态管理
  // isChatLoading 始终初始化为 false —— 这是瞬态运行时状态，不应从持久化状态恢复
  // 因为组件挂载时不可能有活跃的 HTTP 请求
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [agentMode, setAgentMode] = useState<boolean>(content?.uiState?.agentMode ?? true);
  const hasAutoChatInitialized = useRef(content?.uiState?.hasAutoChatInitialized ?? false);

  // 浮动 Agent 对话 Dock 的开合（内存态，默认关闭，不入 content 持久化）
  const [isAgentDockOpen, setIsAgentDockOpen] = useState<boolean>(false);

  // Keep a ref to the latest content so callbacks always read the current value
  const contentRef = useRef(content);
  contentRef.current = content;

  const logger = useMemo(
    () => new VideoEditingLogger({ taskId: taskId || 'unknown', component: 'VideoEditingInterface' }),
    [taskId],
  );

  // Mirror timelineCurrentTime into a ref so effects (e.g. the document-level
  // keydown listener) can read the latest value without being torn down each
  // time the timeline ticker fires (~1 Hz at idle).
  const timelineCurrentTimeRef = useRef(timelineCurrentTime);
  useEffect(() => {
    timelineCurrentTimeRef.current = timelineCurrentTime;
  }, [timelineCurrentTime]);

  // v3 (timeline-playhead-resume-v3): stamp every playback-driven time write
  // so handleTimelineTimeChange can recognise its own echo and skip the seek
  // round-trip. Reset to -Infinity on Space-key dispatch (see §3 / §4.1).
  const playbackDrivenTimeUpdateRef = useRef<number>(Number.NEGATIVE_INFINITY);

  logger.debug('Restoring UI state', {
    taskId,
    hasContent: !!content,
    timelineCurrentTime,
    hasTimelineState: !!currentTimelineState,
    isPolishModalOpen,
    isScriptGenerationModalOpen,
    isCreativeBrainstormingModalOpen,
    isBatchAnalysisModalOpen,
    videoCutModalIsOpen: videoCutModal.isOpen,
  });

  // 新增：VideoPlayerPanel的ref，用于调用其内部的组合跳转方法
  const videoPlayerRef = useRef<VideoPlayerPanelRef>(null);

  // Persist UI state to content whenever it changes
  useEffect(() => {
    if (!content) return;

    const updatedContent: VideoEditingTaskContent = {
      ...content,
      uiState: {
        // timeline-preview-playback-stutter fix (B): read the playhead time from
        // a ref (latest committed value) instead of the state var, so it is NOT
        // a dependency / change-trigger of THIS effect. The 60Hz→React playhead
        // must not churn `content` (→ setContent → per-frame whole-project
        // JSON.stringify in autosave); it rides along here only when the effect
        // already runs for some OTHER reason, and is otherwise persisted by the
        // settle-debounce effect below when playback/scrub stops.
        timelineCurrentTime: timelineCurrentTimeRef.current,
        currentTimelineState,
        isPolishModalOpen,
        isScriptGenerationModalOpen,
        scriptGenerationStartTime,
        isCreativeBrainstormingModalOpen,
        isBatchAnalysisModalOpen,
        videoCutModal,
        isChatLoading: false, // 始终持久化为 false —— 这是瞬态状态，不应被恢复
        agentMode,
        hasAutoChatInitialized: hasAutoChatInitialized.current,
      },
    };

    // Only update if state actually changed to avoid infinite loops.
    // NB (fix B): `timelineCurrentTime` is intentionally NOT compared here — the
    // high-frequency playhead must not trigger per-frame persistence. It is
    // persisted by the settle-debounce effect once motion stops.
    const hasStateChanged =
      content.uiState?.isPolishModalOpen !== isPolishModalOpen ||
      content.uiState?.isScriptGenerationModalOpen !== isScriptGenerationModalOpen ||
      content.uiState?.scriptGenerationStartTime !== scriptGenerationStartTime ||
      content.uiState?.isCreativeBrainstormingModalOpen !== isCreativeBrainstormingModalOpen ||
      content.uiState?.isBatchAnalysisModalOpen !== isBatchAnalysisModalOpen ||
      content.uiState?.agentMode !== agentMode ||
      content.uiState?.hasAutoChatInitialized !== hasAutoChatInitialized.current ||
      JSON.stringify(content.uiState?.currentTimelineState) !== JSON.stringify(currentTimelineState) ||
      JSON.stringify(content.uiState?.videoCutModal) !== JSON.stringify(videoCutModal);

    if (hasStateChanged) {
      logger.debug('Persisting UI state', {
        taskId,
        timelineCurrentTime: timelineCurrentTimeRef.current,
        hasTimelineState: !!currentTimelineState,
        isPolishModalOpen,
        isScriptGenerationModalOpen,
        isCreativeBrainstormingModalOpen,
        videoCutModalIsOpen: videoCutModal.isOpen,
        hasAutoChatInitialized: hasAutoChatInitialized.current,
      });
      onUpdateContent(updatedContent);
    }
    // fix B: `timelineCurrentTime` is deliberately absent from these deps — the
    // playhead time is read via `timelineCurrentTimeRef` above so a 60Hz/10Hz
    // playhead tick does not re-run this serialising effect every frame.
  }, [
    currentTimelineState,
    isPolishModalOpen,
    isScriptGenerationModalOpen,
    scriptGenerationStartTime,
    isCreativeBrainstormingModalOpen,
    agentMode,
    videoCutModal,
    taskId,
    content,
    logger
  ]);

  // timeline-preview-playback-stutter fix (B-b): persist the live playhead
  // position only when it SETTLES — i.e. playback paused / a scrub ended — never
  // per-frame. Each playhead change re-arms a short debounce; during continuous
  // playback (ticks arrive every ~one throttle window) the timer is reset before
  // it can fire, so `content`/autosave stay quiet. When motion stops, the timer
  // fires once and writes the settled position into `content`, so reopening the
  // project restores where the user left off (the boundary B-b requires) without
  // the 60Hz whole-project serialization storm.
  useEffect(() => {
    if (!content) return undefined;
    if (content.uiState?.timelineCurrentTime === timelineCurrentTime) return undefined;
    const settleTimer = setTimeout(() => {
      onUpdateContent({
        ...content,
        uiState: {
          ...(content.uiState ?? {}),
          timelineCurrentTime,
        },
      });
    }, PLAYHEAD_PERSIST_SETTLE_MS);
    return () => clearTimeout(settleTimer);
  }, [timelineCurrentTime, content, onUpdateContent]);

  // 组件挂载时清理残留的 isStreaming 状态
  // 持久化的消息可能带有 isStreaming: true（如果上次会话在流式传输中中断），
  // 但挂载时不可能有活跃的流，所以需要重置
  useEffect(() => {
    if (!content?.conversations) return;

    const hasStaleStreaming = content.conversations.some(conv =>
      conv.messages.some(msg => msg.isStreaming)
    );

    if (hasStaleStreaming) {
      logger.info('清理残留的 isStreaming 状态', { taskId });

      const cleanedConversations = content.conversations.map(conv => ({
        ...conv,
        messages: conv.messages.map(msg =>
          msg.isStreaming ? { ...msg, isStreaming: false } : msg
        ),
      }));

      onUpdateContent({
        ...content,
        conversations: cleanedConversations,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅在挂载时运行一次

  // Mobile device detection effect - backup safety check
  useEffect(() => {
    if (shouldRestrictVideoEditing()) {
      const deviceType = getDeviceType();
      const deviceInfo = getDeviceInfo();
      
      setCurrentDeviceType(deviceType);
      setShowMobileWarning(true);
      
      logger.warn('Mobile device detected - showing restriction warning', {
        taskId,
        deviceType,
        deviceInfo,
        note: 'This is a backup check - primary restriction should happen in Taskbar'
      });
    }
  }, [taskId]);

  // 全局键盘事件处理 - 空格键播放/暂停功能
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Space yields only to text inputs and modal dialogs. A focused clip or
      // toolbar button does NOT own it: Space after clicking one still plays.
      if (event.code !== 'Space' || !shouldGlobalSpaceTogglePlayback(event)) return;
      const target = event.target as HTMLElement;
      const ref = videoPlayerRef.current;
      if (!ref) return;

      event.preventDefault();
      // 修复 R1：让 panel 自己回答"是否在播放"，避免父级镜像状态时序滞后。
      const isPlayingNow = typeof ref.isPlaying === 'function' ? ref.isPlaying() : false;
      logger.debug('全局空格键触发播放/暂停', {
        taskId,
        timelineCurrentTime: timelineCurrentTimeRef.current.toFixed(2),
        focusedElement: target.tagName,
        isPlayingNow,
      });
      // v3 R2: reset the playback-driven stamp BEFORE invoking play/pause so a
      // subsequent user scrub to a value numerically equal to the last
      // playback-driven tick is not misread as a playback echo.
      playbackDrivenTimeUpdateRef.current = Number.NEGATIVE_INFINITY;
      if (isPlayingNow) {
        void ref.pauseFromTimeline();
      } else {
        void ref.seekAndPlayFromTimeline(timelineCurrentTimeRef.current);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    logger.debug('全局键盘事件监听器已注册', { taskId });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      logger.debug('全局键盘事件监听器已移除', { taskId });
    };
  }, [taskId, logger]);

  // Mobile warning dialog close handler
  const handleCloseMobileWarning = useCallback(() => {
    setShowMobileWarning(false);
    logger.info('Mobile warning dialog closed', {
      taskId,
      deviceType: currentDeviceType,
    });
  }, [taskId, currentDeviceType, logger]);

  // 新增：处理timeline到视频播放器的实时跳转回调
  const handleVideoSeekRequired = useCallback(async (
    compositionTime: number, 
    targetSequence: import('./types').VideoSequenceItem, 
    videoTime: number
  ) => {
    logger.debug('Timeline触发视频播放器跳转', {
      compositionTime: compositionTime.toFixed(2),
      targetSequenceName: targetSequence.name,
      videoTime: videoTime.toFixed(2),
      hasVideoPlayerRef: !!videoPlayerRef.current,
    });

    // 通过ref调用VideoPlayerPanel的组合跳转方法
    if (videoPlayerRef.current) {
      try {
        await videoPlayerRef.current.handleCompositionSeek(
          compositionTime,
          targetSequence,
          videoTime,
          'timeline'
        );
        logger.debug('Timeline触发视频播放器跳转完成', {
          compositionTime: compositionTime.toFixed(2),
          sequenceName: targetSequence.name,
        });
      } catch (error) {
        logger.error('Timeline触发视频播放器跳转失败', error instanceof Error ? error : new Error(String(error)));
      }
    } else {
      logger.warn('VideoPlayerPanel ref不可用，跳过视频跳转', {
        compositionTime: compositionTime.toFixed(2),
        targetSequenceName: targetSequence.name,
      });
    }
  }, [logger]);
  
  // 处理从视频播放器到timeline的时间同步
  const handleVideoTimeUpdate = useCallback((currentTime: number) => {
    // v3: stamp BEFORE setState so handleTimelineTimeChange's playback-echo
    // gate (Math.abs(time - playbackDrivenTimeUpdateRef.current) < 0.05) sees
    // the latest playback-driven value by the time the store subscription
    // re-enters with the same time.
    playbackDrivenTimeUpdateRef.current = currentTime;
    setTimelineCurrentTime(currentTime);
  }, []);

  // 新增：计算当前时间点的有效音量
  const calculateEffectiveVolume = useCallback((timelineState: TimelineState | null, currentTime: number): number => {
    if (!timelineState) return 0.8; // 默认音量

    // 找到当前时间点所有活跃的视频轨道（锁定只防编辑，锁定轨照常出声，EX-02）
    const activeVideoTracks = timelineState.tracks.filter(track => 
      track.type === 'video' && 
      track.isVisible && 
      !track.isMuted &&
      track.items.some(item => 
        item.type === 'video' && 
        currentTime >= item.startTime && 
        currentTime < item.startTime + item.duration
      )
    );

    if (activeVideoTracks.length === 0) return 0.8; // 没有活跃视频轨道时使用默认音量

    // 计算所有活跃视频轨道的平均音量
    const totalVolume = activeVideoTracks.reduce((sum, track) => {
      // 找到当前时间点的活跃项目
      const activeItems = track.items.filter(item => 
        item.type === 'video' && 
        currentTime >= item.startTime && 
        currentTime < item.startTime + item.duration
      );
      
      if (activeItems.length === 0) return sum;
      
      // 计算轨道音量和项目音量的组合
      const trackVolume = track.volume / 100; // 轨道音量转换为0-1范围
      const itemVolume = activeItems.reduce((itemSum, item) => itemSum + (item.volume ?? 1), 0) / activeItems.length;
      
      return sum + (trackVolume * itemVolume);
    }, 0);

    const effectiveVolume = Math.max(0, Math.min(totalVolume / activeVideoTracks.length, 1));
    
    logger.debug('计算有效音量', {
      currentTime: currentTime.toFixed(2),
      activeVideoTracks: activeVideoTracks.length,
      effectiveVolume: effectiveVolume.toFixed(3),
    });

    return effectiveVolume;
  }, [logger]);

  // 计算当前的有效音量
  const currentEffectiveVolume = calculateEffectiveVolume(currentTimelineState, timelineCurrentTime);

  // 使用自定义钩子管理各个功能域的状态
  const documentState = useDocumentState(content, onUpdateContent, taskId);
  const videoPlayback = usePreviewTransport(taskId, handleVideoTimeUpdate, timelineCurrentTime, currentEffectiveVolume);
  const aiAssistant = useAIAssistant(taskId, documentState.markdownValue, documentState.handleMarkdownChange);
  // 脚本片段落面板后触发后台英文关键词富化（诊断 narration-keywords-lazy-on-video-search-click 方案 A）。
  // 真正实现（enrichScriptSegmentsKeywords，依赖 scriptSegmentsRef + commitNarrationSegments 的 ref-safe
  // 写回）装配顺序晚于此处，故用 ref 转发：注入 useScriptGeneration 的是稳定身份的 stable 包装，
  // 调用时读 ref.current 取到最新实现（初始为 no-op，在下方 effect 中赋真值）。
  const enrichScriptKeywordsRef = useRef<(segments: ScriptSegment[]) => void>(() => {});
  const enrichScriptKeywordsStable = useCallback((segments: ScriptSegment[]) => {
    enrichScriptKeywordsRef.current(segments);
  }, []);
  const scriptGeneration = useScriptGeneration(taskId, documentState.markdownValue, onUpdateContent, content, enrichScriptKeywordsStable);
  const materialManagement = useMaterialManagement(taskId, content?.materials || []);

  // Persist materials back to content whenever they change.
  // materialManagement.allMaterials gets a new array reference only when
  // setMaterials is called inside the hook, so this effect fires only on
  // actual material mutations (add/remove/update upload status/URL/thumbnail).
  useEffect(() => {
    if (!content) return;
    // Skip if the reference is the same array we already persisted
    if (content.materials === materialManagement.allMaterials) return;
    onUpdateContent({
      ...content,
      materials: materialManagement.allMaterials,
    });
  }, [materialManagement.allMaterials]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror the live timeline into the shared store so the material-management
  // hooks (480p preview-proxy prefetch + local download) can see what the user
  // actually has on the tracks. currentTimelineState is the single real source
  // of timeline edits — manual drag/drop, project import, and Agent write-back
  // all funnel through it (the Agent's setTimelineState is wired to the local
  // setCurrentTimelineState, never to the store). Without this mirror,
  // useVideoEditingStore.timelineState stays null forever, so the download
  // triggers derive empty id sets and the readiness gate reports "0/N ready".
  // Loop-safe: setTimelineState only set()s timelineState (no triggerUpdate),
  // and its store readers never write back into currentTimelineState, so this
  // single-direction mirror cannot form a render cycle. It also leaves the
  // local externalTimelineUpdateId untouched, so it never re-imports the panel.
  const setStoreTimelineState = useVideoEditingStore(state => state.setTimelineState);
  useEffect(() => {
    setStoreTimelineState(currentTimelineState);
  }, [currentTimelineState, setStoreTimelineState]);

  // Sync: Zustand scriptSegmentsData → content.scriptSegments (structured data with narration)
  // When Agent generates a script with narration via set_script_with_narration operation,
  // it writes structured segments data to the store. Build ScriptSegment[] with narrationText.
  const storeScriptSegmentsData = useVideoEditingStore(state => state.scriptSegmentsData);
  const storeScriptType = useVideoEditingStore(state => state.scriptType);
  useEffect(() => {
    if (!storeScriptSegmentsData || storeScriptSegmentsData.length === 0) return;
    logger.debug('Structured script segments sync triggered', {
      segmentCount: storeScriptSegmentsData.length,
      scriptType: storeScriptType,
    });

    // Build ScriptSegment[] from structured data, preserving narrationText
    const segments: ScriptSegment[] = storeScriptSegmentsData.map((seg, i) => {
      // Split scriptText into sentences for the sentences array
      const sentenceTexts = seg.scriptText
        .split(/(?<=[。！？.!?])\s*/)
        .filter(s => s.trim().length > 0);
      return {
        id: `agent-segment-${i}`,
        title: seg.title,
        sentences: sentenceTexts.map((s, j) => ({ id: `agent-s-${i}-${j}`, text: s.trim() })),
        narrationText: seg.narrationText,
      };
    });

    const update: Partial<VideoEditingTaskContent> = {
      scriptSegments: segments,
    };

    // Sync to AI Video Script tab with narrationText preserved
    if (storeScriptType === 'ai_generated') {
      update.aiVideoScriptSegments = segments.map((seg, i) => ({
        id: `ai-script-${Date.now()}-${i}`,
        title: seg.title,
        scriptText: seg.sentences.map(s => s.text).join(' '),
        narrationText: seg.narrationText,
      }));
    }

    const baseContent = contentRef.current ?? {
      markdownContent: '',
      lastModified: new Date(),
      scriptSegments: [],
      aiVideoScriptSegments: [],
      storyboardScriptSegments: [],
    } as VideoEditingTaskContent;

    logger.debug('Updating content with structured script segments (with narration)', {
      count: segments.length,
    });
    onUpdateContent({
      ...baseContent,
      ...update,
    });

    // Reset the store after syncing
    useVideoEditingStore.getState().resetScript();
  }, [storeScriptSegmentsData, storeScriptType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync: Zustand scriptStore → content.scriptSegments (legacy text-based path)
  // When Agent generates a script via SSE operation using set_script, it writes to the Zustand store.
  // Convert the raw text into ScriptSegment[] and update content so ScriptPanel re-renders.
  const storeScriptContent = useVideoEditingStore(state => state.scriptContent);
  useEffect(() => {
    if (!storeScriptContent) return;
    logger.debug('Script store sync triggered', {
      contentLength: storeScriptContent.length,
      scriptType: storeScriptType,
      hasContent: !!contentRef.current,
    });
    const segments = parseAgentScriptToSegments(storeScriptContent);
    if (segments.length === 0) {
      logger.warn('parseAgentScriptToSegments returned 0 segments');
      return;
    }

    const update: Partial<VideoEditingTaskContent> = {
      scriptSegments: segments,
    };

    // Agent-generated scripts should also sync to AI Video Script tab
    if (storeScriptType === 'ai_generated') {
      update.aiVideoScriptSegments = segments.map((seg, i) => ({
        id: `ai-script-${Date.now()}-${i}`,
        title: seg.title,
        scriptText: seg.sentences.map(s => s.text).join(' '),
      }));
    }

    // Build the content to update: merge with current content, or create minimal default
    const baseContent = contentRef.current ?? {
      markdownContent: '',
      lastModified: new Date(),
      scriptSegments: [],
      aiVideoScriptSegments: [],
      storyboardScriptSegments: [],
    } as VideoEditingTaskContent;

    logger.debug('Updating content with script segments', { count: segments.length });
    onUpdateContent({
      ...baseContent,
      ...update,
    });

    // Reset the store content after syncing to prevent re-triggering
    // (the content is now persisted in the task content, not the ephemeral store)
    useVideoEditingStore.getState().resetScript();
  }, [storeScriptContent, storeScriptType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync: Zustand storyboardStore → content.storyboardScriptSegments
  // When Agent generates storyboards via SSE operation, it writes StoryboardItem[] to the store.
  // Convert to StoryboardScriptSegment[] and update content so StoryboardScriptTab re-renders.
  const storeStoryboards = useVideoEditingStore(state => state.storyboards);
  useEffect(() => {
    if (!storeStoryboards || storeStoryboards.length === 0) return;
    logger.debug('Storyboard store sync triggered', { count: storeStoryboards.length });

    const storyboardSegments: StoryboardScriptSegment[] = storeStoryboards.map((sb, i) => ({
      id: sb.id || `storyboard-${Date.now()}-${i}`,
      frameIndex: sb.order ?? i,
      frameUrl: sb.imageUrl || '',
      description: sb.description || '',
      duration: 5,
      generationStatus: sb.videoUrl ? 'succeeded' as const : 'idle' as const,
      generatedVideoUrl: sb.videoUrl,
    }));

    const baseContent = contentRef.current ?? {
      markdownContent: '',
      lastModified: new Date(),
      scriptSegments: [],
      aiVideoScriptSegments: [],
      storyboardScriptSegments: [],
    } as VideoEditingTaskContent;

    logger.debug('Updating content with storyboard segments', { count: storyboardSegments.length });
    onUpdateContent({
      ...baseContent,
      storyboardScriptSegments: storyboardSegments,
    });
  }, [storeStoryboards]); // eslint-disable-line react-hooks/exhaustive-deps

  // 添加视频解析功能 - 需要在 convertToScript 之前初始化
  const videoAnalysis = useVideoAnalysis(taskId);
  
  const convertToScript = useConvertToScript(taskId, scriptGeneration.handleScriptGenerated, videoAnalysis.getAnalysisResult);

  // Video understanding script modal (enhanced generation with conversations support)
  const videoUnderstandingScript = useVideoUnderstandingScript(
    taskId,
    scriptGeneration.handleScriptGenerated,
    videoAnalysis.getAnalysisResult
  );

  // 监听脚本生成状态变化，自动记录开始时间和清除时间
  useEffect(() => {
    if (scriptGeneration.isGeneratingScript && !scriptGenerationStartTime) {
      // 脚本生成开始，记录开始时间
      setScriptGenerationStartTime(Date.now());
    } else if (!scriptGeneration.isGeneratingScript && scriptGenerationStartTime) {
      // 脚本生成完成，延迟一段时间后清除开始时间，让弹窗有时间显示完成状态
      const timer = setTimeout(() => {
        setScriptGenerationStartTime(null);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [scriptGeneration.isGeneratingScript, scriptGenerationStartTime]);
  const videoSearch = useVideoSearch(taskId, materialManagement.addMaterials);
  const audioSearch = useAudioSearch(taskId, materialManagement.addMaterials);
  const imageSearch = useImageSearch(taskId, materialManagement.addMaterials);
  
  // 添加时间轴组合播放功能（新增视频跳转回调）
  // 使用 allMaterials：组合播放需要解析所有素材的 URL，不能受 MaterialsPanel 的类型筛选影响
  const timelineComposition = useTimelineComposition(taskId, materialManagement.allMaterials, handleVideoSeekRequired);
  
  // 处理智能润色
  const handlePolishClick = useCallback(() => {
    // 获取当前活动对话内容
    const activeConversation = content?.conversations?.find(
      conv => conv.id === content?.activeConversationId
    );
    const chatContent = activeConversation?.messages
      .map(msg => `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content}`)
      .join('\n\n') || '';

    console.log(`[VideoEditingInterface] 用户点击智能润色按钮`, {
      taskId,
      currentContentLength: documentState.markdownValue.length,
      chatContentLength: chatContent.length,
      messageCount: activeConversation?.messages.length || 0,
      timestamp: new Date().toISOString()
    });

    setPolishChatContent(chatContent);
    setIsPolishModalOpen(true);
  }, [taskId, documentState.markdownValue.length, content]);

  const handlePolishClose = useCallback(() => {
    console.log(`[VideoEditingInterface] 关闭智能润色弹窗`, {
      taskId,
      timestamp: new Date().toISOString()
    });
    setIsPolishModalOpen(false);
  }, [taskId]);

  const handlePolishContentSelect = useCallback((polishedContent: string) => {
    console.log(`[VideoEditingInterface] 应用润色结果`, {
      taskId,
      originalLength: documentState.markdownValue.length,
      polishedLength: polishedContent.length,
      contentDelta: polishedContent.length - documentState.markdownValue.length,
      timestamp: new Date().toISOString()
    });

    // 更新本地文档状态
    documentState.setMarkdownValue(polishedContent);

    // 构建完整的更新内容（包含markdown和对话更新），避免多次调用onUpdateContent导致状态覆盖
    const now = new Date();
    let updatedContent: VideoEditingTaskContent = {
      ...(content || { markdownContent: '', lastModified: now }),
      markdownContent: polishedContent,
      lastModified: now,
      scriptSegments: content?.scriptSegments,
    };

    // 将润色结果回写到聊天区域
    const activeConversationId = content?.activeConversationId;
    if (activeConversationId) {
      const activeConversation = content?.conversations?.find(
        conv => conv.id === activeConversationId
      );
      if (activeConversation) {
        const newMessage: ChatMessage = {
          id: `polish-${Date.now()}`,
          role: 'assistant',
          content: `[智能润色结果]\n\n${polishedContent}`,
          timestamp: now,
        };
        updatedContent = {
          ...updatedContent,
          conversations: (content?.conversations || []).map(conv => {
            if (conv.id === activeConversationId) {
              return {
                ...conv,
                messages: [...conv.messages, newMessage],
                updatedAt: now,
              };
            }
            return conv;
          }),
        };
        console.log(`[VideoEditingInterface] 润色结果已回写到聊天区域`, {
          conversationId: activeConversationId,
          messageId: newMessage.id,
          timestamp: now.toISOString()
        });
      }
    }

    onUpdateContent(updatedContent);
    setIsPolishModalOpen(false);
  }, [taskId, documentState.markdownValue.length, documentState.setMarkdownValue, content, onUpdateContent]);

  // 处理将消息内容转换为视频脚本
  const handleConvertMessageToScript = useCallback((content: string) => {
    console.log(`[VideoEditingInterface] 用户点击转换消息为视频脚本`, {
      taskId,
      contentLength: content.length,
      timestamp: new Date().toISOString()
    });

    convertToScript.openModal(content);
  }, [taskId, convertToScript]);

  // AI视频脚本片段更新
  const handleUpdateAIVideoScriptSegments = useCallback((segments: AIVideoScriptSegment[]) => {
    if (!content) return;
    onUpdateContent({
      ...content,
      aiVideoScriptSegments: segments,
    });
  }, [content, onUpdateContent]);

  // 分镜脚本片段更新
  const handleUpdateStoryboardScriptSegments = useCallback((segments: StoryboardScriptSegment[]) => {
    if (!content) return;
    onUpdateContent({
      ...content,
      storyboardScriptSegments: segments,
    });
  }, [content, onUpdateContent]);

  // AI视频脚本生成状态
  const [isGeneratingAIVideoScript, setIsGeneratingAIVideoScript] = useState(false);

  // AI视频脚本 - 打开配置弹窗
  const handleAIVideoScriptGenerationClick = useCallback(() => {
    setIsAIVideoScriptModalOpen(true);
  }, []);

  // AI视频脚本 - 关闭配置弹窗
  const handleAIVideoScriptModalClose = useCallback(() => {
    setIsAIVideoScriptModalOpen(false);
  }, []);

  // AI视频脚本 - 确认生成
  const handleAIVideoScriptGenerate = useCallback(async (config: ScriptGenerationConfig) => {
    const activeConversation = content?.conversations?.find(
      conv => conv.id === content?.activeConversationId
    );
    const chatMessages = activeConversation?.messages || [];

    if (!chatMessages.length) {
      showError('无法生成AI视频脚本：请先在聊天面板中进行对话');
      return;
    }

    setIsAIVideoScriptModalOpen(false);
    setIsGeneratingAIVideoScript(true);

    try {
      let result: any;
      try {
        result = await http.post<any>('/api/ai-video-script-generation', {
          taskId,
          scriptConfig: config,
          chatMessages,
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(httpError.message || `API error: ${httpError.status}`);
        }
        throw httpError;
      }

      if (result.success && result.segments) {
        const newSegments: AIVideoScriptSegment[] = result.segments.map(
          (seg: { title: string; scriptText: string; narrationText?: string }) =>
            createAIVideoSegment(seg.title, seg.scriptText, seg.narrationText)
        );
        const existing = content?.aiVideoScriptSegments || [];
        handleUpdateAIVideoScriptSegments([...existing, ...newSegments]);
      } else {
        throw new Error('Failed to generate AI video script');
      }
    } catch (error) {
      console.error('[VideoEditingInterface] AI video script generation failed:', error);
      showError(`AI视频脚本生成失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGeneratingAIVideoScript(false);
    }
  }, [taskId, content, handleUpdateAIVideoScriptSegments, showError]);

  const handleScriptGenerationClose = useCallback(() => {
    console.log(`[VideoEditingInterface] 关闭脚本生成配置弹窗`, {
      taskId,
      hadMessageContent: !!messageContentForScript,
      timestamp: new Date().toISOString()
    });
    setIsScriptGenerationModalOpen(false);
    // 清除存储的消息内容
    setMessageContentForScript(null);
  }, [taskId, messageContentForScript]);

  const handleScriptGenerate = useCallback((config: ScriptGenerationConfig) => {
    // 如果有特定的消息内容要转换，使用该内容；否则使用完整的聊天历史
    let chatMessages: ChatMessage[] = [];
    
    if (messageContentForScript) {
      // 使用特定消息内容创建一个临时聊天消息
      chatMessages = [{
        id: `temp_${Date.now()}`,
        role: 'assistant',
        content: messageContentForScript,
        timestamp: new Date(),
      }];
      
      console.log(`[VideoEditingInterface] 使用特定消息内容生成脚本`, {
        taskId,
        config,
        messageContentLength: messageContentForScript.length,
        timestamp: new Date().toISOString()
      });
      
      // 清除存储的消息内容
      setMessageContentForScript(null);
    } else {
      // 获取当前活动对话的消息
      const activeConversation = content?.conversations?.find(
        conv => conv.id === content?.activeConversationId
      );
      
      chatMessages = activeConversation?.messages || [];
      
      console.log(`[VideoEditingInterface] 使用完整聊天历史生成脚本`, {
        taskId,
        config,
        contentLength: documentState.markdownValue.length,
        chatMessageCount: chatMessages.length,
        hasChatMessages: chatMessages.length > 0,
        timestamp: new Date().toISOString()
      });
    }
    
    // 关闭弹窗
    setIsScriptGenerationModalOpen(false);
    
    // 调用脚本生成服务，传入配置和聊天消息
    scriptGeneration.handleGenerateScriptWithConfig(config, chatMessages);
  }, [taskId, documentState.markdownValue.length, scriptGeneration, content, messageContentForScript]);

  // Mirror the latest scriptSegments so async callbacks always see current state,
  // even after the sentence has been deleted or replaced.
  const scriptSegmentsRef = useRef<ScriptSegment[]>(content?.scriptSegments || []);
  useEffect(() => {
    scriptSegmentsRef.current = content?.scriptSegments || [];
  }, [content?.scriptSegments]);

  // 解说「AI 生成」下拉双模式（spec ai-generate-script-modes v2）。
  // 视频理解生成本期仅占位弹窗。
  const [isVideoUnderstandingPlaceholderOpen, setIsVideoUnderstandingPlaceholderOpen] = useState(false);

  // 「解说直接生成」富化（spec narration-direct-video-script-rewrite v2 §3.2，推翻重写）。
  // 推翻前序「复用 prompt-polish 优化器 + 就地覆写 sentence.text + 静默回退」的脆弱设计，
  // 改为「专用转换端点（generateNarrationVideoScript，禁复述旁白）→ 写专用 videoScript 字段
  // （失败置 'failed'，绝不静默回退旁白）→ 用画面脚本组装英文关键词 → ref 合并单次写回」，
  // 并以 try/finally 收敛任何残留 generating 句为 failed（RV-2 无悬挂态）。
  // 主体抽到 utils/enrichNarrationSegments（见 spec「实施过程发现的方案缺陷 IF-1」），此处仅做
  // 依赖注入：commitSegments「先前移 scriptSegmentsRef 再 handleUpdateSegments」满足 RV-3
  // 「写回前同步前移 ref」；narrationText / sentence.narration 全程只读不写（G3，TTS 不受影响）。
  // 富化置于父级、异步执行（弹窗 close() 会中止其内部请求，故不能放在弹窗 hook —— 评审 R-5）。
  const commitNarrationSegments = useCallback((segments: ScriptSegment[]) => {
    scriptSegmentsRef.current = segments;
    scriptGeneration.handleUpdateSegments(segments);
  }, [scriptGeneration]);

  // 统一「英文关键词生成 + 本地兜底」：解说直接生成与其它脚本生成链路共用同一实现，杜绝逻辑漂移
  // （诊断 narration-keywords-lazy-on-video-search-click §8.3）。经 /api/script-keywords-generation
  // 的 language:'english' 输出 2–3 个英文关键词；桌面端 LLM 不可用时逐段从旁白原文本地派生兜底，
  // 使关键词在富化早期即就位（搜索框永不为空，用户点搜索前关键词已写回）。
  const generateEnglishKeywords = useCallback(async (segments: ScriptSegment[]): Promise<ScriptSegment[]> => {
    const withKeywords = await generateKeywordsForSegments(
      segments,
      taskId || 'unknown',
      logger,
      { language: 'english' },
    );
    return Promise.all(withKeywords.map(async (seg) => {
      const existing = seg.keywords?.filter(keyword => keyword.trim().length > 0);
      if (existing && existing.length > 0) return seg;
      const narrationText = seg.sentences
        .map(sentence => (sentence.narration ?? sentence.text ?? '').trim())
        .filter(value => value.length > 0)
        .join(' ');
      const local = await deriveLocalKeywordsFromNarration(narrationText, taskId || 'unknown', logger);
      return local.length > 0 ? { ...seg, keywords: local } : seg;
    }));
  }, [taskId, logger]);

  const enrichNarrationSegments = useCallback(async (newSegments: ScriptSegment[]) => {
    await enrichNarrationSegmentsCore({
      newSegments,
      getLatestSegments: () => scriptSegmentsRef.current ?? [],
      commitSegments: commitNarrationSegments,
      generateVideoScript: (narration, fullScript, loc) =>
        generateNarrationVideoScript(narration, fullScript, loc),
      generateKeywords: generateEnglishKeywords,
      locale: locale === 'en' ? 'en' : 'zh',
      onWarn: (message, meta) => logger.warn(message, meta),
    });
  }, [commitNarrationSegments, generateEnglishKeywords, logger, locale]);

  // 通用脚本片段的后台英文关键词富化（复用 narration-direct 同源逻辑）：视频理解 / 转换消息为脚本 /
  // 标准配置等链路产出片段落面板后由此调用，让 2–3 个英文关键词在后台就位，而非等用户点段落卡片
  // 「搜索在线视频」时才现场生成（诊断 narration-keywords-lazy-on-video-search-click 方案 A）。
  const enrichScriptSegmentsKeywords = useCallback(async (newSegments: ScriptSegment[]) => {
    await enrichSegmentsWithKeywords({
      newSegments,
      getLatestSegments: () => scriptSegmentsRef.current ?? [],
      commitSegments: commitNarrationSegments,
      generateKeywords: generateEnglishKeywords,
      onWarn: (message, meta) => logger.warn(message, meta),
    });
  }, [commitNarrationSegments, generateEnglishKeywords, logger]);

  // 把上方注入 useScriptGeneration 的 ref 转发赋为真实实现：先同步前移 scriptSegmentsRef（镜像
  // handleWriteNarrationSegments 的做法，使随后按 id 合并回写读到最新数组），再后台异步富化关键词。
  useEffect(() => {
    enrichScriptKeywordsRef.current = (segments: ScriptSegment[]) => {
      scriptSegmentsRef.current = segments;
      void enrichScriptSegmentsKeywords(segments);
    };
  }, [enrichScriptSegmentsKeywords]);

  // 卡片「重新生成」：单句重试 AI 视频脚本（ref-safe 增量 patch，RV-3）。
  const handleRegenerateVideoScript = useCallback(async (segmentId: string, sentenceId: string) => {
    await regenerateNarrationVideoScript({
      segmentId,
      sentenceId,
      getLatestSegments: () => scriptSegmentsRef.current ?? [],
      commitSegments: commitNarrationSegments,
      generateVideoScript: (narration, fullScript, loc) =>
        generateNarrationVideoScript(narration, fullScript, loc),
      locale: locale === 'en' ? 'en' : 'zh',
    });
  }, [commitNarrationSegments, locale]);

  // 「解说直接生成」完成时把逐句新解说 segments 按用户选择的 mode 写入 content.scriptSegments：
  // 「追加」→ 接在已有真实解说之后（面板为空/占位时仅写本次，保留占位守卫）；
  // 「替换」→ 无条件用本次生成整段覆盖现有解说文案。
  // 判定收敛在 resolveNarrationSegmentsWrite 唯一锚点；复用面板既有的 handleUpdateSegments
  // 单一写入路径，单次批量写入（评审决议 R3 / 红线 §9.1）。
  const handleWriteNarrationSegments = useCallback((segments: ScriptSegment[], mode: NarrationCompleteMode) => {
    const existing = scriptSegmentsRef.current ?? [];
    const nextSegments = resolveNarrationSegmentsWrite(existing, segments, mode);
    // 同步前移 ref（在 handleUpdateSegments 之前），与 commitNarrationSegments 一致，
    // 保证随后异步富化按 id 合并回写时读到的是最新数组（替换后 ref 已是新 segments，R3）。
    scriptSegmentsRef.current = nextSegments;
    // 立即按解说原文写入（卡片即时可见，并作为富化失败时的兜底——面板永不空白），
    // 随后异步富化生成独立画面脚本与搜索关键词，完成后按 id 合并写回。
    scriptGeneration.handleUpdateSegments(nextSegments);
    void enrichNarrationSegments(segments);
  }, [scriptGeneration, enrichNarrationSegments]);

  const narrationDirectScript = useNarrationDirectScript({
    locale: locale === 'en' ? 'en' : 'zh',
    onComplete: handleWriteNarrationSegments,
    defaultSegmentTitle: t.narrationDirectScript.defaultSegmentTitle,
  });

  // 句子级 AI 视频生成桥接：接收 ScriptPanel 的 onConfirm，连通 useMaterialManagement + sentence 状态回写
  const handleGenerateAiVideoForSentence = useCallback((
    params: ArkVideoGenerateParams,
    link: { segmentId: string; sentenceId: string },
  ) => {
    const { segmentId, sentenceId } = link;

    // 1) 乐观更新：立即把 sentence.aiVideoStatus 切到 generating
    const currentSegments = scriptSegmentsRef.current;
    const optimisticSegments: ScriptSegment[] = currentSegments.map(seg => {
      if (seg.id !== segmentId) return seg;
      return {
        ...seg,
        sentences: seg.sentences.map(s => s.id === sentenceId
          ? { ...s, aiVideoStatus: 'generating' as const }
          : s,
        ),
      };
    });
    scriptGeneration.handleUpdateSegments(optimisticSegments);

    // 2) 查找最新 segments 的辅助函数（避免闭包过时 / 卸载守护）
    const findAndPatch = (patch: (s: import('@/types').ScriptSentence) => import('@/types').ScriptSentence) => {
      const latest = scriptSegmentsRef.current;
      const target = latest.find(seg => seg.id === segmentId);
      const hasSentence = !!target?.sentences.some(s => s.id === sentenceId);
      if (!hasSentence) return false;
      const next: ScriptSegment[] = latest.map(seg => {
        if (seg.id !== segmentId) return seg;
        return {
          ...seg,
          sentences: seg.sentences.map(s => s.id === sentenceId ? patch(s) : s),
        };
      });
      scriptGeneration.handleUpdateSegments(next);
      return true;
    };

    void materialManagement.handleAiVideoGenerate(params, {
      metadataExtras: {
        source: 'narration-ai-video',
        linkedSegmentId: segmentId,
        linkedSentenceId: sentenceId,
      },
      onSucceeded: (material) => {
        const patched = findAndPatch(s => ({
          ...s,
          aiVideoStatus: 'succeeded',
          linkedMaterialId: material.id,
          generatedVideoUrl: material.url,
          generatedVideoThumbnailUrl: material.thumbnailUrl,
        }));
        if (patched) {
          showSuccess(locale === 'zh' ? 'AI 视频生成成功并已关联脚本' : 'AI video generated and linked to the sentence');
        } else {
          showSuccess(locale === 'zh' ? '素材已生成但关联脚本已删除，请在素材面板查看' : 'Material generated but the linked sentence was deleted; see Materials panel');
        }
      },
      onFailed: (reason) => {
        const patched = findAndPatch(s => ({ ...s, aiVideoStatus: 'failed' }));
        if (patched) {
          showError(
            (locale === 'zh' ? 'AI 视频生成失败：' : 'AI video generation failed: ') + reason,
          );
        }
      },
    });
  }, [content?.scriptSegments, scriptGeneration, materialManagement, showSuccess, showError, locale]);

  // 处理添加素材到时间轴
  const handleAddMaterialToTimeline = useCallback((material: MaterialItem) => {
    console.log(`[VideoEditingInterface] 添加素材到时间轴`, {
      taskId,
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      timestamp: new Date().toISOString()
    });

    // 根据素材类型确定目标轨道
    let targetTrackId: string;
    switch (material.type) {
      case 'video':
        targetTrackId = 'video-track-1';
        break;
      case 'image':
        targetTrackId = 'image-track-1';
        break;
      case 'audio':
        // 搜索/库内音频默认落到「音频轨道二」，把轨道一留给解说/视频内嵌音频，
        // 从而默认产生可叠加的两条音频轨（缺轨时 handleMaterialDrop 会回退到首条兼容音频轨）。
        targetTrackId = 'audio-track-2';
        break;
      case 'subtitle':
        targetTrackId = 'subtitle-track-1';
        break;
      default:
        console.warn(`[VideoEditingInterface] 未知的素材类型: ${material.type}`);
        return;
    }

    // 设置要添加到时间轴的素材
    setMaterialsToAddToTimeline({
      materials: [material],
      targetTrackId,
      timestamp: Date.now()
    });

    // 清除状态，避免重复添加
    setTimeout(() => {
      setMaterialsToAddToTimeline(undefined);
    }, 100);
  }, [taskId]);

  // 处理创意构思弹窗
  const handleCreativeBrainstormingClick = useCallback(() => {
    console.log(`[VideoEditingInterface] 用户点击创意构思按钮`, {
      taskId,
      currentContentLength: documentState.markdownValue.length,
      timestamp: new Date().toISOString()
    });
    setIsCreativeBrainstormingModalOpen(true);
  }, [taskId, documentState.markdownValue.length]);

  const handleCreativeBrainstormingClose = useCallback(() => {
    console.log(`[VideoEditingInterface] 关闭创意构思弹窗`, {
      taskId,
      timestamp: new Date().toISOString()
    });
    setIsCreativeBrainstormingModalOpen(false);
  }, [taskId]);

  const handleCreativeBrainstormingExport = useCallback((content: string) => {
    console.log(`[VideoEditingInterface] 导出创意构思文案`, {
      taskId,
      originalLength: documentState.markdownValue.length,
      exportedLength: content.length,
      timestamp: new Date().toISOString()
    });
    
    // 将生成的内容添加到当前文档中
    const updatedContent = documentState.markdownValue + '\n\n## 创意构思成果\n\n' + content;
    documentState.handleMarkdownChange(updatedContent);
    setIsCreativeBrainstormingModalOpen(false);
  }, [taskId, documentState.markdownValue, documentState.handleMarkdownChange]);

  // 处理视频剪切
  const handleCutMaterial = useCallback((material: MaterialItem) => {
    console.log(`[VideoEditingInterface] 打开视频剪切弹窗`, {
      taskId,
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      timestamp: new Date().toISOString()
    });

    setVideoCutModal({
      isOpen: true,
      material
    });
  }, [taskId]);

  // 处理水印去除
  const handleWatermarkRemoval = useCallback((material: MaterialItem) => {
    console.log(`[VideoEditingInterface] 水印去除操作`, {
      taskId,
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      timestamp: new Date().toISOString()
    });
  }, [taskId]);

  // 关闭视频剪切弹窗
  const handleCloseCutModal = useCallback(() => {
    console.log(`[VideoEditingInterface] 关闭视频剪切弹窗`, {
      taskId,
      timestamp: new Date().toISOString()
    });

    setVideoCutModal({
      isOpen: false,
      material: null
    });
  }, [taskId]);

  // 处理导出切片到素材管理面板
  const handleExportClips = useCallback(async (clips: VideoClip[], originalMaterial: MaterialItem) => {
    console.log(`[VideoEditingInterface] 导出视频切片到素材管理面板`, {
      taskId,
      clipsCount: clips.length,
      originalMaterialId: originalMaterial.id,
      originalMaterialName: originalMaterial.name,
      timestamp: new Date().toISOString()
    });

    try {
      // 首先创建带有加载状态的临时素材项
      const tempClipMaterials: MaterialItem[] = [];
      clips.forEach((clip, index) => {
        const tempClipMaterial: MaterialItem = {
          id: `${originalMaterial.id}_clip_${clip.id}`,
          name: `${originalMaterial.name} - ${clip.name}`,
          type: 'video' as const,
          format: originalMaterial.format || 'mp4',
          size: 0, // 临时设置为0，后续更新
          duration: clip.duration,
          width: originalMaterial.width,
          height: originalMaterial.height,
          thumbnailUrl: originalMaterial.thumbnailUrl,
          url: '', // 临时为空，后续更新
          serverUrl: '',
          createdAt: new Date(),
          description: `从"${originalMaterial.name}"剪切的片段，时间范围：${formatTime(clip.startTime)} - ${formatTime(clip.endTime)}`,
          uploadStatus: 'uploading', // 复用素材进度状态，表示本地切分保存中
          uploadProgress: 0,
          metadata: {
            ...originalMaterial.metadata,
            isClip: true,
            originalMaterialId: originalMaterial.id,
            originalMaterialDuration: originalMaterial.duration, // 保存原始素材的时长
            clipStartTime: clip.startTime,
            clipEndTime: clip.endTime,
            clipDuration: clip.duration,
            clipIndex: index + 1,
            totalClips: clips.length
          }
        };
        tempClipMaterials.push(tempClipMaterial);
      });

      // 立即添加临时素材到素材管理（显示加载状态）
      tempClipMaterials.forEach(tempMaterial => {
        if (materialManagement.addOrReplaceMaterial) {
          materialManagement.addOrReplaceMaterial(tempMaterial);
        }
      });

      showSuccess(`正在处理 ${clips.length} 个视频切片，请稍候...`);

      // 动态导入视频切分API
      const { videoCutAPI } = await import('@/lib/api/videoCut');

      // 准备视频切分请求
      const sourceRef =
        originalMaterial.metadata?.localResolvedUrl ||
        originalMaterial.cacheUrl ||
        originalMaterial.url ||
        originalMaterial.serverUrl ||
        '';
      const cutRequest = {
        task_id: taskId,
        source_ref: sourceRef,
        video_url: sourceRef,
        material_id: originalMaterial.id,
        clips: clips.map(clip => ({
          id: clip.id,
          name: clip.name,
          start_time: clip.startTime,
          end_time: clip.endTime,
          duration: clip.duration
        })),
        generate_thumbnails: true
      };

      console.log(`[VideoEditingInterface] 开始视频切分处理`, {
        taskId,
        sourceRef: cutRequest.source_ref?.slice(0, 100) + '...',
        clipsCount: cutRequest.clips.length
      });

      // 调用视频切分API
      const cutResponse = await videoCutAPI.cutVideoClips(cutRequest);

      if (cutResponse.success && cutResponse.clips.length > 0) {
        // 成功切分，更新素材项
        cutResponse.clips.forEach((cutClip, index) => {
          const updatedMaterial: MaterialItem = {
            ...tempClipMaterials[index],
            url: cutClip.video_url,
            serverUrl: cutClip.video_url,
            cacheUrl: cutClip.video_url,
            thumbnailUrl: cutClip.thumbnail_url || tempClipMaterials[index].thumbnailUrl,
            size: cutClip.file_size,
            width: cutClip.width,
            height: cutClip.height,
            format: cutClip.format,
            uploadStatus: 'completed',
            uploadProgress: 100,
            metadata: {
              ...tempClipMaterials[index].metadata,
              storageKind: 'local',
              localResolvedUrl: cutClip.video_url,
              cutClipResult: cutClip
            }
          };

          // 替换临时素材
          if (materialManagement.addOrReplaceMaterial) {
            materialManagement.addOrReplaceMaterial(updatedMaterial);
          }
        });

        console.log(`[VideoEditingInterface] 视频切分完成`, {
          taskId,
          successfulClips: cutResponse.clips.length,
          processingTime: cutResponse.processing_time
        });

        showSuccess(`已成功处理 ${cutResponse.clips.length} 个视频切片并保存到本地素材库`);
      } else {
                 // 切分失败，移除临时素材并显示错误
         const tempMaterialIds = tempClipMaterials.map(m => m.id);
         materialManagement.handleMaterialDelete(tempMaterialIds);

        console.error(`[VideoEditingInterface] 视频切分失败`, {
          taskId,
          error: cutResponse.message
        });

        showError(`视频切分失败: ${cutResponse.message}`);
      }

    } catch (error) {
      console.error(`[VideoEditingInterface] 视频切分处理错误`, {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });

             // 移除临时素材
       const tempIds = clips.map(clip => `${originalMaterial.id}_clip_${clip.id}`);
       materialManagement.handleMaterialDelete(tempIds);

      showError(`视频切分处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [taskId, materialManagement.addOrReplaceMaterial, materialManagement.handleMaterialDelete, showSuccess, showError]);

  // 格式化时间显示（用于切片描述）
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // 处理视频AI解析
  const handleVideoAnalysis = useCallback(async (material: MaterialItem, frameInterval?: number, useThumbnail?: boolean) => {
    console.log(`[VideoEditingInterface] 开始视频AI解析`, {
      taskId,
      materialId: material.id,
      materialName: material.name,
      videoUrl: material.url,
      thumbnailUrl: material.thumbnailUrl,
      frameInterval,
      useThumbnail,
      timestamp: new Date().toISOString()
    });

    if (!material.url) {
      console.error(`[VideoEditingInterface] 视频素材缺少URL`, {
        materialId: material.id,
        materialName: material.name
      });
      return;
    }

    try {
      // 检查当前状态，如果已完成则打开结果弹窗，否则开始解析
      const currentStatus = videoAnalysis.getAnalysisStatus(material.url);

      if (currentStatus === 'completed') {
        // hook中已完成解析，打开结果弹窗
        console.log(`[VideoEditingInterface] 视频已完成解析，打开结果弹窗`, {
          taskId,
          materialId: material.id,
          videoUrl: material.url
        });
        videoAnalysis.openAnalysisModal(material.url);
      } else if (material.analysisResult?.status === 'completed' && material.analysisResult.analysis) {
        // 素材上已有持久化的解析结果（自动解析），同步到hook状态后打开弹窗
        console.log(`[VideoEditingInterface] 素材已有持久化解析结果，同步并打开弹窗`, {
          taskId,
          materialId: material.id,
          videoUrl: material.url
        });
        const syntheticResult = {
          success: true,
          video_url: material.url,
          total_frames_extracted: 1,
          video_duration: material.duration || 0,
          frame_analyses: [{
            frame_number: 0,
            timestamp: 0,
            analysis: material.analysisResult.analysis,
          }],
          processing_time: 0,
          timestamp: material.analysisResult.timestamp || new Date().toISOString(),
        };
        videoAnalysis.setAnalysisStatus(material.url, 'completed', syntheticResult);
        // setAnalysisStatus是同步更新state，但openAnalysisModal在同一render读不到新state
        // 所以用setTimeout让React完成state更新后再打开弹窗
        setTimeout(() => {
          videoAnalysis.openAnalysisModal(material.url);
        }, 0);
      } else if (currentStatus === 'idle') {
        // 开始新的解析（带队列管理）
        const effectiveFrameInterval = frameInterval || 5;
        const shouldUseThumbnail = useThumbnail === true;
        
        console.log(`[VideoEditingInterface] 开始队列管理的视频解析`, {
          taskId,
          materialId: material.id,
          videoUrl: material.url,
          thumbnailUrl: material.thumbnailUrl,
          frameInterval: effectiveFrameInterval,
          useThumbnail: shouldUseThumbnail
        });
        
        // 使用队列管理的解析方法
        await videoAnalysis.analyzeVideoWithQueue(
          material.url, 
          effectiveFrameInterval,
          undefined, // customPrompt
          material.thumbnailUrl, // thumbnailUrl
          shouldUseThumbnail // useThumbnail
        );
        
        console.log(`[VideoEditingInterface] 视频解析完成`, {
          taskId,
          materialId: material.id,
          videoUrl: material.url
        });
      } else if (currentStatus === 'waiting' || currentStatus === 'analyzing') {
        // 正在等待或解析中，不做任何操作
        console.log(`[VideoEditingInterface] 视频正在${currentStatus === 'waiting' ? '等待' : '解析'}中`, {
          taskId,
          materialId: material.id,
          videoUrl: material.url,
          currentStatus
        });
      }
    } catch (error) {
      console.error(`[VideoEditingInterface] 视频解析失败`, {
        taskId,
        materialId: material.id,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      
      // 显示错误提示
      showError(error instanceof Error ? error.message : '视频解析失败');
    }
  }, [taskId, videoAnalysis, showError]);

  // 处理批量视频AI解析
  // 打开模式选择弹窗，让用户选择快速解析或专业解析
  const handleBatchVideoAnalysis = useCallback(async () => {
    console.log(`[VideoEditingInterface] 点击批量解析按钮`, {
      taskId,
      totalMaterialsCount: materialManagement.allMaterials.length,
      timestamp: new Date().toISOString()
    });

    // 筛选所有视频素材（使用 allMaterials：批量解析应覆盖全部素材，不受类型筛选影响）
    const videoMaterials = materialManagement.allMaterials.filter(material => {
      return material.type === 'video' && material.url;
    });

    // 检查是否有视频素材
    if (videoMaterials.length === 0) {
      console.warn(`[VideoEditingInterface] 没有找到可解析的视频素材`, {
        taskId,
        totalMaterials: materialManagement.allMaterials.length
      });
      showError('当前没有视频素材可供解析，请先上传视频素材', 5000);
      return;
    }

    console.log(`[VideoEditingInterface] 打开批量解析模式选择弹窗`, {
      taskId,
      videoCount: videoMaterials.length,
      timestamp: new Date().toISOString()
    });

    // 打开模式选择弹窗
    setIsBatchAnalysisModalOpen(true);
  }, [taskId, materialManagement.allMaterials, showError]);

  // 处理批量解析模式确认
  const handleBatchAnalysisConfirm = useCallback(async (mode: { type: 'quick' | 'professional'; frameInterval?: number }) => {
    console.log(`[VideoEditingInterface] 用户选择批量解析模式`, {
      taskId,
      mode: mode.type,
      frameInterval: mode.frameInterval,
      timestamp: new Date().toISOString()
    });

    // 关闭模式选择弹窗
    setIsBatchAnalysisModalOpen(false);

    // 筛选所有视频素材（使用 allMaterials：批量解析应覆盖全部素材，不受类型筛选影响）
    const videoMaterials = materialManagement.allMaterials.filter(material => {
      return material.type === 'video' && material.url;
    });

    console.log(`[VideoEditingInterface] 开始批量触发视频解析`, {
      taskId,
      videoCount: videoMaterials.length,
      mode: mode.type,
      frameInterval: mode.frameInterval,
      videoMaterials: videoMaterials.map(m => ({
        id: m.id,
        name: m.name,
        url: m.url,
        thumbnailUrl: m.thumbnailUrl,
        currentStatus: videoAnalysis.getAnalysisStatus(m.url!)
      })),
      timestamp: new Date().toISOString()
    });

    // 根据模式触发不同的解析逻辑
    if (mode.type === 'quick') {
      // 快速解析：使用缩略图
      videoMaterials.forEach(material => {
        handleVideoAnalysis(material, undefined, true); // 第三个参数表示使用缩略图
      });
    } else {
      // 专业解析：使用拆帧
      const frameInterval = mode.frameInterval || 5;
      videoMaterials.forEach(material => {
        handleVideoAnalysis(material, frameInterval, false);
      });
    }

    console.log(`[VideoEditingInterface] 已触发 ${videoMaterials.length} 个视频的解析请求`, {
      taskId,
      videoCount: videoMaterials.length,
      mode: mode.type
    });
  }, [taskId, materialManagement.allMaterials, videoAnalysis, handleVideoAnalysis]);

  // 处理从timeline到视频播放器的时间同步
  const handleTimelineTimeChange = useCallback((time: number) => {
    // v3 (timeline-playhead-resume-v3): break the playback-driven feedback loop.
    // When <video> drives the timeline (timeupdate → setTimelineCurrentTime →
    // store.setCurrentTime → store.subscribe → here), the incoming `time` is
    // numerically within 0.05 s of the last playback-driven stamp. In that case
    // we mirror the value into our state but MUST NOT forward to the player —
    // re-asking the player to seek to its own time produces the wrong-index
    // reverse-map storm described in §2.2.1.
    const lastPlaybackDrivenTime = playbackDrivenTimeUpdateRef.current;
    const isPlaybackEcho = Math.abs(time - lastPlaybackDrivenTime) < 0.05;
    logger.debug('Timeline时间变化同步到视频播放器', {
      newTime: time.toFixed(2),
      previousTime: timelineCurrentTime.toFixed(2),
      lastPlaybackDrivenTime: Number.isFinite(lastPlaybackDrivenTime) ? lastPlaybackDrivenTime.toFixed(2) : 'none',
      source: isPlaybackEcho ? 'playback' : 'user',
    });
    setTimelineCurrentTime(time);

    if (isPlaybackEcho) {
      // Playback-driven echo — skip the round-trip composition seek.
      return;
    }

    // 如果是组合播放模式，同步到组合播放器
    if (timelineComposition.compositionPlayback?.isCompositionMode) {
      timelineComposition.handleCompositionSeek(time);
    } else {
      // 预览模式，同步到普通播放器
      videoPlayback.handleTimeSeek(time);
    }
  }, [timelineComposition, videoPlayback, logger]); // eslint-disable-line react-hooks/exhaustive-deps

  // 处理时间轴状态变化，用于导出功能
  const handleTimelineStateChange = useCallback((timelineState: TimelineState) => {
    // 只更新本地状态，不要再次调用timelineComposition.handleTimelineStateChange
    // 因为这会造成循环调用
    setCurrentTimelineState(timelineState);
  }, []);

  // 处理项目文件导入完成（JSON 导入 / 待处理时间轴数据）：完全替换时间轴状态。
  // AI 混剪不再经过这里：它在 useAIMixedEditing 中按轨道精确合并后直接写入 store。
  const handleImportComplete = useCallback((importedMaterials: MaterialItem[], importedTimelineState: TimelineState) => {
    console.log(`[VideoEditingInterface] 项目文件导入完成`, {
      taskId,
      importedMaterialCount: importedMaterials.length,
      importedTrackCount: importedTimelineState.tracks.length,
      totalDuration: importedTimelineState.totalDuration,
    });

    // TimelinePanel 的外部同步把它作为一步可撤销操作写入 store
    setCurrentTimelineState(importedTimelineState);
    setExternalTimelineUpdateId(nextExternalUpdateId('timeline-update'));

    if (importedMaterials.length > 0) {
      materialManagement.addMaterials(importedMaterials);
    }

    timelineComposition.handleTimelineStateChange(importedTimelineState);
    setTimelineCurrentTime(0);
  }, [taskId, materialManagement, timelineComposition]);

  // 检测并导入待处理的时间轴数据
  useEffect(() => {
    if (content?.pendingTimelineData) {
      console.log('[VideoEditingInterface] Detected pending timeline data, importing...', {
        taskId,
        hasTimelineData: !!content.pendingTimelineData,
        tracksCount: content.pendingTimelineData?.tracks?.length || 0,
        timestamp: new Date().toISOString()
      });

      // 规范化时间轴数据，确保所有必需字段都存在
      const normalizedTimelineData: TimelineState = {
        currentTime: content.pendingTimelineData.currentTime || 0,
        totalDuration: content.pendingTimelineData.totalDuration || 0,
        zoomLevel: content.pendingTimelineData.zoomLevel || 1.0,
        selectedItems: content.pendingTimelineData.selectedItems || [],
        tracks: content.pendingTimelineData.tracks || [],
        playbackRate: content.pendingTimelineData.playbackRate || 1.0,
        isPlaying: content.pendingTimelineData.isPlaying || false,
        snapToGrid: content.pendingTimelineData.snapToGrid !== undefined ? content.pendingTimelineData.snapToGrid : true,
        gridSize: content.pendingTimelineData.gridSize || 1.0,
        scrollLeft: content.pendingTimelineData.scrollLeft || 0
      };

      console.log('[VideoEditingInterface] Normalized timeline data:', {
        currentTime: normalizedTimelineData.currentTime,
        totalDuration: normalizedTimelineData.totalDuration,
        tracksCount: normalizedTimelineData.tracks.length,
        selectedItemsCount: normalizedTimelineData.selectedItems.length
      });

      // 使用handleImportComplete来导入时间轴数据
      // 传入空的materials数组，因为时间轴数据本身包含了素材引用
      handleImportComplete([], normalizedTimelineData);

      // 清除pending标记，避免重复导入
      const updatedContent: VideoEditingTaskContent = {
        ...content,
        pendingTimelineData: undefined
      };
      onUpdateContent(updatedContent);

      console.log('[VideoEditingInterface] Pending timeline data imported and cleared', {
        taskId,
        timestamp: new Date().toISOString()
      });
    }
  }, [content?.pendingTimelineData, taskId, onUpdateContent, handleImportComplete]);

  // 检测并导入待处理的素材数据
  useEffect(() => {
    if (content?.pendingMaterials && content.pendingMaterials.length > 0) {
      console.log('[VideoEditingInterface] Detected pending materials, importing...', {
        taskId,
        materialsCount: content.pendingMaterials.length,
        timestamp: new Date().toISOString()
      });

      // 获取现有素材（使用 allMaterials：URL 去重应覆盖被类型筛选隐藏的素材，避免重复导入）
      const existingMaterials = materialManagement.allMaterials;
      const existingUrls = new Set(existingMaterials.map(m => m.url));

      // 过滤掉已存在的素材（根据URL去重）
      const newMaterials = content.pendingMaterials.filter(m => !existingUrls.has(m.url));

      console.log('[VideoEditingInterface] Filtering pending materials:', {
        totalPending: content.pendingMaterials.length,
        existingCount: existingMaterials.length,
        newCount: newMaterials.length,
        timestamp: new Date().toISOString()
      });

      // 如果有新素材，添加到素材管理
      if (newMaterials.length > 0) {
        newMaterials.forEach(material => {
          materialManagement.addOrReplaceMaterial(material);
        });

        console.log('[VideoEditingInterface] Imported new materials from Video Export:', {
          importedCount: newMaterials.length,
          totalMaterialsNow: existingMaterials.length + newMaterials.length,
          timestamp: new Date().toISOString()
        });

        // 显示成功提示
        showSuccess(`成功导入 ${newMaterials.length} 个视频素材到素材管理面板`);
      } else {
        console.log('[VideoEditingInterface] No new materials to import (all already exist)');
        showSuccess('素材已存在，无需重复导入');
      }

      // 清除pending标记，避免重复导入
      const updatedContent: VideoEditingTaskContent = {
        ...content,
        pendingMaterials: undefined
      };
      onUpdateContent(updatedContent);

      console.log('[VideoEditingInterface] Pending materials imported and cleared', {
        taskId,
        timestamp: new Date().toISOString()
      });
    }
  }, [content?.pendingMaterials, taskId, onUpdateContent, materialManagement, showSuccess]);

  // 新增：处理图片叠加位置变化
  const handleImagePositionChange = useCallback((itemId: string, position: ImagePosition) => {
    console.log(`[VideoEditingInterface] 更新图片叠加位置`, {
      itemId,
      position,
      timestamp: new Date().toISOString()
    });

    setCurrentTimelineState(prev => {
      if (!prev) return prev;

      const updatedTracks = prev.tracks.map(track => ({
        ...track,
        items: track.items.map(item => 
          item.id === itemId 
            ? { ...item, imagePosition: position }
            : item
        )
      }));

      const updatedState = {
        ...prev,
        tracks: updatedTracks
      };

      // 同步到timeline组合管理
      timelineComposition.handleTimelineStateChange(updatedState);

      return updatedState;
    });
  }, [timelineComposition]);

  const handleImagePositionConfirm = useCallback((itemId: string, position: ImagePosition) => {
    // One undoable step; the live drag preview above stays out of history.
    updateImagePositionAction(() => useTimelineStore.getState(), itemId, position);
  }, []);

  // AI自动混剪：按脚本段落把最新配音与匹配视频一次性排到视频轨 1 / 音频轨 1，
  // 其余轨道保持不变；整次排布是一步可撤销操作。
  const reportAutoMixRefusal = useCallback((reason: AutoMixRefusal) => {
    if (reason === 'track-locked') {
      showWarning(t.videoEditing.autoMix.trackLocked);
    } else if (reason === 'no-target-track') {
      showError(t.videoEditing.autoMix.noTargetTrack);
    } else {
      showError(t.videoEditing.autoMix.noScriptMaterials, 6000);
    }
  }, [showError, showWarning, t]);

  const applyAutoMixPlan = useCallback((plan: ScriptAutoMixPlan) => {
    // The agent owns the timeline while it runs (same lock as keyboard edits);
    // re-checked here because the lock may engage while the prompt is open.
    if (useTimelineStore.getState().externalEditLock !== null) {
      showWarning(t.timeline.messages.editLockedByAgent);
      return;
    }
    // Targets are re-checked inside the action as well: the timeline may have
    // changed while the confirmation was open.
    const result = applyScriptAutoMixAction(() => useTimelineStore.getState(), plan);
    if (!result.ok) {
      reportAutoMixRefusal(result.reason);
      return;
    }
    const skippedSegments = plan.segments
      .filter(segment => segment.status === 'skipped-no-audio')
      .map(segment => segment.segmentNumber);
    showSuccess(t.videoEditing.autoMix.applied
      .replace('{segments}', String(plan.segments.length - skippedSegments.length)));
    if (skippedSegments.length > 0) {
      showWarning(t.videoEditing.autoMix.skippedNoAudio
        .replace('{list}', skippedSegments.join(locale === 'zh-CN' ? '、' : ', ')));
    }
    if (plan.ignoredDuplicateMaterialIds.length > 0) {
      showInfo(t.videoEditing.autoMix.duplicatesIgnored
        .replace('{count}', String(plan.ignoredDuplicateMaterialIds.length)));
    }
    logger.info('Script auto-mix applied', {
      taskId,
      placements: plan.placements.length,
      segments: plan.segments.length,
      skippedSegments,
      replacedItemCount: result.replacedItemCount,
    });
  }, [locale, logger, reportAutoMixRefusal, showInfo, showSuccess, showWarning, t, taskId]);

  const handleAutoMixAudio = useCallback(() => {
    if (materialManagement.allMaterials.length === 0) {
      showError(t.videoEditing.autoMix.noMaterials, 5000);
      return;
    }
    if (useTimelineStore.getState().externalEditLock !== null) {
      showWarning(t.timeline.messages.editLockedByAgent);
      return;
    }
    // 使用 allMaterials：排布需要全部音频与视频，不受素材面板类型筛选影响
    const plan = planScriptAutoMix(materialManagement.allMaterials);
    // Missing or locked target tracks are reported BEFORE asking to replace,
    // so the user is never asked to confirm an edit that will be refused.
    const check = checkAutoMixTargets(useTimelineStore.getState().tracks, plan);
    if (!check.ok) {
      reportAutoMixRefusal(check.reason);
      return;
    }
    if (check.replacedItemCount > 0) {
      setAutoMixConfirm({ isOpen: true, plan, replacedItemCount: check.replacedItemCount });
      return;
    }
    applyAutoMixPlan(plan);
  }, [materialManagement.allMaterials, applyAutoMixPlan, reportAutoMixRefusal, showError, showWarning, t]);

  const handleAutoMixConfirm = useCallback(() => {
    const plan = autoMixConfirm.plan;
    setAutoMixConfirm(current => ({ ...current, isOpen: false }));
    if (plan) applyAutoMixPlan(plan);
  }, [autoMixConfirm.plan, applyAutoMixPlan]);

  const handleAutoMixCancel = useCallback(() => {
    setAutoMixConfirm(current => ({ ...current, isOpen: false }));
  }, []);


  // 清除添加素材请求状态，避免重复处理
  React.useEffect(() => {
    if (materialsToAddToTimeline) {
      // 设置一个短暂的延迟后清除状态，确保TimelinePanel有时间处理
      const timeoutId = setTimeout(() => {
        console.log(`[VideoEditingInterface] 清除素材添加请求状态`, {
          timestamp: Date.now()
        });
        setMaterialsToAddToTimeline(undefined);
      }, 1000); // 1秒后清除状态

      return () => clearTimeout(timeoutId);
    }
  }, [materialsToAddToTimeline]);

  // 聊天对话自动初始化
  useEffect(() => {
    if (!hasAutoChatInitialized.current && (!content?.conversations || content.conversations.length === 0)) {
      hasAutoChatInitialized.current = true;
      
      logger.debug('自动初始化视频编辑聊天对话', {
        taskId,
        timestamp: new Date().toISOString()
      });

      const now = new Date();
      const conversationId = `video-chat-${Date.now()}`;
      
      const defaultConversation: Conversation = {
        id: conversationId,
        title: '视频编辑 AI 助手',
        messages: [],
        createdAt: now,
        updatedAt: now,
        chatType: 'chatbot',
      };

      const updatedContent: VideoEditingTaskContent = {
        ...content!,
        conversations: [defaultConversation],
        activeConversationId: conversationId,
      };

      onUpdateContent(updatedContent);
      
      logger.debug('视频编辑聊天对话初始化完成', {
        conversationId,
        timestamp: now.toISOString()
      });
    }
  }, []); // 只在组件挂载时运行一次

  // 聊天消息处理
  const updateConversationMessages = useCallback((conversationId: string, messages: ChatMessage[]) => {
    const currentContent = contentRef.current;
    console.log(`[VideoEditingInterface] 更新聊天消息`, {
      conversationId,
      messageCount: messages.length,
      timestamp: new Date().toISOString()
    });

    const conversations = currentContent?.conversations || [];
    const updatedConversations = conversations.map(conv => {
      if (conv.id === conversationId) {
        return {
          ...conv,
          messages,
          updatedAt: new Date(),
        };
      }
      return conv;
    });

    const updatedContent: VideoEditingTaskContent = {
      ...currentContent!,
      conversations: updatedConversations,
    };

    onUpdateContent(updatedContent);
  }, [onUpdateContent]);

  const handleClearChatMessages = useCallback(() => {
    const activeConversationId = content?.activeConversationId;
    if (!activeConversationId) {
      console.warn('[VideoEditingInterface] 没有活动的聊天对话');
      return;
    }

    console.log(`[VideoEditingInterface] 清空聊天记录`, {
      conversationId: activeConversationId,
      timestamp: new Date().toISOString()
    });
    
    const conversations = content?.conversations || [];
    const updatedConversations = conversations.map(conv => {
      if (conv.id === activeConversationId) {
        console.log(`[VideoEditingInterface] 清空 ${conv.messages.length} 条消息`, {
          conversationId: conv.id
        });
        return {
          ...conv,
          messages: [],
          updatedAt: new Date(),
        };
      }
      return conv;
    });

    const updatedContent: VideoEditingTaskContent = {
      ...content!,
      conversations: updatedConversations,
    };

    onUpdateContent(updatedContent);
    console.log('[VideoEditingInterface] 聊天记录已清空');
  }, [content, onUpdateContent]);

  // --- Agent Execution Hook (replaces inline agent logic) ---
  const agent = useAgentExecution({
    conversations: content?.conversations || [],
    updateConversationMessages,
    activeConversationId: content?.activeConversationId,
    timelineState: currentTimelineState,
    setTimelineState: setCurrentTimelineState,
    // 使用 allMaterials：Agent 执行需要看到全部素材，不能因 MaterialsPanel 的类型筛选丢素材
    materials: materialManagement.allMaterials,
    onTimelineUpdate: (id) => setExternalTimelineUpdateId(id),
    onNotification: (type, message) => {
      if (type === 'error') showError(message);
      else showSuccess(message);
    },
    agentMode,
    setAgentMode,
    projectId,
  });

  // External edit lock: agent operations are undoable, so a keyboard/toolbar
  // undo or delete issued mid-run would fork the client timeline from the
  // state the agent keeps editing. The overlay only blocks the pointer.
  useEffect(() => {
    useTimelineStore.getState().setExternalEditLock(agent.agentIsExecuting ? 'agent' : null);
  }, [agent.agentIsExecuting]);
  useEffect(() => () => {
    useTimelineStore.getState().setExternalEditLock(null);
  }, []);

  // AI 混剪编排：分阶段进度、可取消、过期结果丢弃、按轨道合并为一步可撤销操作。
  // 素材经 ref 读取最新值，避免长任务结束时用到旧闭包里的素材列表。
  const allMaterialsRef = useRef(materialManagement.allMaterials);
  allMaterialsRef.current = materialManagement.allMaterials;
  const getAllMaterials = useCallback(() => allMaterialsRef.current, []);
  const aiMix = useAIMixedEditing({
    taskId,
    getMaterials: getAllMaterials,
    isAgentExecuting: agent.agentIsExecuting,
  });

  // --- Unified send handler: routes to agent or regular based on agentMode ---
  const handleSendChatMessage = useCallback(async (message: string) => {
    if (agent.agentMode) {
      return agent.sendAgentMessage(message);
    }

    // Original non-agent chat logic below
    const activeConversationId = content?.activeConversationId;
    if (!activeConversationId || isChatLoading) return;

    const conversations = content?.conversations || [];
    const activeConversation = conversations.find(
      conv => conv.id === activeConversationId
    );
    
    if (!activeConversation) return;

    setIsChatLoading(true);
    
    try {
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };

      // 添加用户消息
      const messagesWithUser = [...activeConversation.messages, userMessage];
      updateConversationMessages(activeConversationId, messagesWithUser);
      
      // 创建助手消息占位符
      const assistantMessageId = `msg-${Date.now()}-assistant`;
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };

      console.log('[VideoEditingInterface] 发送聊天消息到 API', {
        messageLength: message.length,
        timestamp: new Date().toISOString()
      });

      let response: Response;
      try {
        response = await http.stream('/api/video-editing-chat', {
          taskId: taskId,
          messages: messagesWithUser,
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(`HTTP error! status: ${httpError.status}`);
        }
        throw httpError;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              accumulatedContent += parsed.content;
              const updatedMessages = [
                ...messagesWithUser,
                { ...assistantMessage, content: accumulatedContent, isStreaming: true }
              ];
              updateConversationMessages(activeConversationId, updatedMessages);
            }
          } catch (e) {
            console.error('[VideoEditingInterface] 解析SSE数据错误:', e);
          }
        }
      }

      // 标记流式传输完成
      const finalMessages = [
        ...messagesWithUser,
        { ...assistantMessage, content: accumulatedContent, isStreaming: false }
      ];
      console.log(`[VideoEditingInterface] 聊天消息接收完成`, {
        finalContentLength: accumulatedContent.length
      });
      updateConversationMessages(activeConversationId, finalMessages);

    } catch (error) {
      console.error('[VideoEditingInterface] 聊天消息发送失败:', error);
      showError(`聊天失败: ${error instanceof Error ? error.message : '未知错误'}`);
      
      // 移除助手消息占位符
      const messagesWithoutAssistant = activeConversation.messages.concat([{
        id: `msg-${Date.now()}-user`,
        role: 'user' as const,
        content: message,
        timestamp: new Date(),
      }]);
      
      updateConversationMessages(activeConversationId, messagesWithoutAssistant);
      
    } finally {
      setIsChatLoading(false);
    }
  }, [content, onUpdateContent, isChatLoading, updateConversationMessages, taskId, showError, agent.agentMode, agent.sendAgentMessage]);

  // 获取当前活动的聊天对话
  const activeConversation = content?.conversations?.find(
    conv => conv.id === content?.activeConversationId
  );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden relative">
      {/* 主工作区 - 全宽，达芬奇式布局（脚本25% | 预览50% | 素材25% + 贯穿全宽时间轴）。
          AI Chat 不再常驻，改为右下角浮动 Dock，见本组件末尾的 <AgentChatDock /> */}
      <div className="video-editing-right-area flex flex-col min-h-0 overflow-hidden">
        {/* 上方面板区域 */}
        <div className="video-editing-upper-panels flex min-h-0 overflow-hidden">
          {/* Text Script 面板 */}
          <div className="video-editing-script-panel bg-muted border-r border-border">
            <ScriptPanel
              segments={content?.scriptSegments || getMockScriptSegments(locale)}
              className="h-full"
              onSelectNarrationDirect={() => narrationDirectScript.open()}
              onSelectVideoUnderstanding={() => setIsVideoUnderstandingPlaceholderOpen(true)}
              isGenerating={scriptGeneration.isGeneratingScript}
              onUpdateSegments={scriptGeneration.handleUpdateSegments}
              onAddMaterial={(material) => materialManagement.addOrReplaceMaterial(material)}
              taskId={taskId}
              projectId={projectId}
              // 使用 allMaterials：ScriptPanel 内部按 type 过滤素材用于音频/视频匹配，
              // 类型筛选会让跨类型匹配丢素材
              materials={materialManagement.allMaterials}
              getVideoAnalysisResult={videoAnalysis.getAnalysisResult}
              aiVideoScriptSegments={content?.aiVideoScriptSegments || []}
              onUpdateAIVideoScriptSegments={handleUpdateAIVideoScriptSegments}
              onGenerateAIVideoScript={handleAIVideoScriptGenerationClick}
              isGeneratingAIVideoScript={isGeneratingAIVideoScript}
              storyboardScriptSegments={content?.storyboardScriptSegments || []}
              onUpdateStoryboardScriptSegments={handleUpdateStoryboardScriptSegments}
              onGenerateAiVideoForSentence={handleGenerateAiVideoForSentence}
              onRegenerateVideoScript={handleRegenerateVideoScript}
            />
          </div>

          {/* Play Preview 面板 - 中央主舞台，占50%宽度 */}
          <div className="video-editing-player-panel bg-card border-r border-border">
            <VideoPlayerPanel
              ref={videoPlayerRef}
              {...videoPlayback}
              videoPreview={mockVideoPreview}
              taskId={taskId}
              compositionPlayback={timelineComposition.compositionPlayback}
              onCompositionPlayPause={timelineComposition.handleCompositionPlay}
              onCompositionSeek={timelineComposition.handleCompositionSeek}
              onNextSequence={timelineComposition.handleNextSequence}
              onCompositionTimeUpdate={timelineComposition.handleCompositionTimeUpdate}
              onTimelineTimeUpdate={handleVideoTimeUpdate}
              currentTimelineTime={timelineCurrentTime}
              onSequenceIndexUpdate={timelineComposition.handleSequenceIndexUpdate}
              timelineState={currentTimelineState || undefined}
              // 使用 allMaterials：导出依赖此 prop 解析音频/视频素材的 URL，类型筛选会导致跨类型素材 miss
              materials={materialManagement.allMaterials}
              onPatchMaterialCache={materialManagement.patchMaterialCache}
              onImagePositionChange={handleImagePositionChange}
              onImagePositionConfirm={handleImagePositionConfirm}
              projectId={projectId}
              projectName=""
            />
          </div>

          {/* Materials Management 面板 - 右翼，占25%宽度 */}
          <MaterialsPanel
            {...materialManagement}
            onSearchVideos={videoSearch.openSearchModal}
            onSearchAudios={audioSearch.openSearchModal}
            onSearchImages={imageSearch.openSearchModal}
            onAIMixedEditing={aiMix.openModeModal}
            onAutoMixAudio={handleAutoMixAudio}
            onVideoAnalysis={handleVideoAnalysis}
            onBatchVideoAnalysis={handleBatchVideoAnalysis}
            getVideoAnalysisStatus={videoAnalysis.getAnalysisStatus}
            onRetryDownload={videoSearch.retryVideoDownload}
            onAddToTimeline={handleAddMaterialToTimeline}
            onCutMaterial={handleCutMaterial}
            onWatermarkRemoval={handleWatermarkRemoval}
            taskId={taskId}
            projectId={projectId}
            className="video-editing-materials-panel bg-card"
          />
        </div>

        {/* 下方时间轴面板 - 在右侧区域的下方，全宽度 */}
        <div className="video-editing-timeline-section border-t border-border bg-muted relative">
          {agent.agentIsExecuting && (
            <div className="agent-timeline-lock-overlay" />
          )}
          <TimelinePanel
            className="h-full"
            onTimelineStateChange={handleTimelineStateChange}
            externalCurrentTime={timelineCurrentTime}
            onCurrentTimeChange={handleTimelineTimeChange}
            // 使用 allMaterials：时间轴需要按 materialId 解析任意类型素材，类型筛选会丢素材
            materials={materialManagement.allMaterials}
            onTimelineCompositionChange={timelineComposition.handleTimelineStateChange}
            materialsToAdd={materialsToAddToTimeline}
            taskId={taskId}
            onImportComplete={handleImportComplete}
            externalTimelineState={currentTimelineState || undefined}
            externalTimelineUpdateId={externalTimelineUpdateId || undefined}
            onRetryLocalDownload={materialManagement.retryLocalDownload}
          />
        </div>
      </div>

      {/* 浮动 Agent 对话 Dock：关闭态为右下角圆形 FAB，打开态为 30%×80% 浮窗，
          内部原样挂载 VideoChatWindow（对话/Agent模式/执行/撤销/取消逻辑零改动） */}
      <AgentChatDock
        isOpen={isAgentDockOpen}
        onOpen={() => setIsAgentDockOpen(true)}
        onClose={() => setIsAgentDockOpen(false)}
        agentIsExecuting={agent.agentIsExecuting}
        chatProps={{
          conversation: activeConversation,
          onSendMessage: handleSendChatMessage,
          onClearMessages: handleClearChatMessages,
          isLoading: isChatLoading,
          onCreativeBrainstormingClick: handleCreativeBrainstormingClick,
          onPolishClick: handlePolishClick,
          onConvertMessageToScript: handleConvertMessageToScript,
          agentMode: agent.agentMode,
          onAgentModeChange: agent.setAgentMode,
          agentIsExecuting: agent.agentIsExecuting,
          executionState: agent.executionState,
          onAgentUndo: undefined,
          onUndoAll: agent.undoAllOperations,
          onUndoSingle: agent.undoSingleOperation,
          onCancel: agent.cancelExecution,
        }}
      />

      <VideoSearchModal
        {...videoSearch}
        taskId={taskId}
      />

      <AudioSearchModal
        {...audioSearch}
        taskId={taskId}
      />

      <ImageSearchModal
        {...imageSearch}
        taskId={taskId}
      />
      
      <ContentPolishModal
        isOpen={isPolishModalOpen}
        onClose={handlePolishClose}
        onContentSelect={handlePolishContentSelect}
        originalContent={documentState.markdownValue}
        chatContent={polishChatContent}
        taskId={taskId}
      />

      <ScriptGenerationModal
        isOpen={isScriptGenerationModalOpen}
        onClose={handleScriptGenerationClose}
        onGenerate={handleScriptGenerate}
        taskId={taskId}
      />

      {/* AI视频脚本生成配置弹窗（复用ScriptGenerationModal） */}
      <ScriptGenerationModal
        isOpen={isAIVideoScriptModalOpen}
        onClose={handleAIVideoScriptModalClose}
        onGenerate={handleAIVideoScriptGenerate}
        taskId={taskId}
      />

      <ScriptGenerationProgressModal
        isOpen={scriptGeneration.isGeneratingScript}
        progress={scriptGeneration.generationProgress}
        startTime={scriptGenerationStartTime}
      />

      {/* 解说直接生成两步式弹窗（spec ai-generate-script-modes） */}
      <NarrationDirectScriptModal controller={narrationDirectScript} />

      {/* 视频理解生成占位弹窗（本期仅外壳） */}
      <VideoUnderstandingModePlaceholderModal
        isOpen={isVideoUnderstandingPlaceholderOpen}
        onClose={() => setIsVideoUnderstandingPlaceholderOpen(false)}
      />

      {/* 转换视频脚本弹窗 */}
      <ConvertToScriptModal
        isOpen={convertToScript.isModalOpen}
        onClose={convertToScript.closeModal}
        materials={materialManagement.allMaterials}
        taskId={taskId}
        chatContent={convertToScript.chatContent}
        onGenerateScript={convertToScript.generateScript}
        isGenerating={convertToScript.isGenerating}
        getAnalysisResult={videoAnalysis.getAnalysisResult}
      />

      {/* 转换视频脚本进度弹窗 */}
      <VideoUnderstandingScriptProgressModal
        isOpen={convertToScript.isGenerating}
        progress={convertToScript.progress}
        onCancel={convertToScript.closeModal}
      />

      {/* 视频理解生成脚本弹窗 (enhanced with conversations support) */}
      <VideoUnderstandingScriptModal
        isOpen={videoUnderstandingScript.isModalOpen}
        onClose={videoUnderstandingScript.closeModal}
        materials={materialManagement.allMaterials}
        taskId={taskId}
        onGenerateScript={videoUnderstandingScript.generateScript}
        isGenerating={videoUnderstandingScript.isGenerating}
        conversations={content?.conversations || []}
        activeConversationId={content?.activeConversationId ?? null}
        onScriptGenerated={scriptGeneration.handleScriptGenerated}
        onAIVideoScriptGenerated={handleUpdateAIVideoScriptSegments}
      />

      <CreativeBrainstormingModal
        isOpen={isCreativeBrainstormingModalOpen}
        onClose={handleCreativeBrainstormingClose}
        onExportContent={handleCreativeBrainstormingExport}
        taskId={taskId}
        currentContent={documentState.markdownValue}
      />

      <VideoAnalysisModal
        isOpen={videoAnalysis.isModalOpen}
        onClose={videoAnalysis.closeAnalysisModal}
        analysisResult={videoAnalysis.currentAnalysisResult}
        videoUrl={videoAnalysis.currentVideoUrl || undefined}
      />

      {/* AI混剪模式选择弹窗（含「将替换 / 保留的轨道」提示） */}
      <AIMixingModeSelectionModal
        isOpen={aiMix.isModeModalOpen}
        impact={aiMix.timelineImpact}
        onClose={aiMix.closeModeModal}
        onConfirm={aiMix.start}
      />

      {/* 批量解析模式选择弹窗 */}
      <BatchAnalysisModeSelectionModal
        isOpen={isBatchAnalysisModalOpen}
        onClose={() => setIsBatchAnalysisModalOpen(false)}
        onConfirm={handleBatchAnalysisConfirm}
      />

      {/* AI混剪进度弹窗：分阶段步骤条，可取消，无伪进度 */}
      <AIMixingProgressModal runState={aiMix.runState} onCancel={aiMix.cancel} />

      {/* AI自动混剪替换确认：锁定/缺轨已在打开前检查 */}
      <ConfirmationDialog
        isOpen={autoMixConfirm.isOpen}
        type="warning"
        title={t.videoEditing.autoMix.replaceConfirmTitle}
        message={t.videoEditing.autoMix.replaceConfirmBody.replace('{count}', String(autoMixConfirm.replacedItemCount))}
        confirmText={t.videoEditing.autoMix.confirm}
        cancelText={t.videoEditing.autoMix.cancel}
        onConfirm={handleAutoMixConfirm}
        onCancel={handleAutoMixCancel}
      />

      {/* 视频剪切弹窗 */}
      <VideoCutModal
        isOpen={videoCutModal.isOpen}
        material={videoCutModal.material}
        onClose={handleCloseCutModal}
        onExportClips={handleExportClips}
        taskId={taskId}
      />

      {/* Mobile Warning Dialog - Backup Safety Check (Legacy) */}
      {/* Note: Global mobile detection is now handled at app level, this is kept as fallback */}

      {/* Background async task polling for AI generation tasks */}
      <AsyncTaskPoller />
    </div>
  );
};

export default VideoEditingInterface;
