'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { VideoEditingTaskContent, ScriptGenerationConfig, TimelineState, MaterialItem, ImagePosition, AIVideoScriptSegment } from '@/types';
import ScriptPanel from './ScriptPanel';
import { TimelinePanel } from './timeline';
import '../../styles/video-editing.css';
import { shouldRestrictVideoEditing, getDeviceType, getDeviceInfo } from '@/lib/utils/deviceDetection';
import { MobileWarningDialog } from '@/components/ui';
import { 
  useDocumentState,
  useVideoPlayback,
  useAIAssistant,
  useScriptGeneration,
  useMaterialManagement,
  useVideoSearch,
  useAudioSearch,
  useImageSearch,
  useTimelineComposition,
  useVideoAnalysis
} from './hooks';
import { useConvertToScript } from './hooks/useConvertToScript';
import { getMockScriptSegments, mockVideoPreview } from './data';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useAuth } from '@/contexts/AuthContext';
import { analyzeVideosInBatch, VIDEO_ANALYSIS_CONFIG } from './utils/parallelVideoAnalysis';
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
  BatchAnalysisModeSelectionModal
} from './components';
import ConvertToScriptModal from './components/ConvertToScriptModal';
import { createAIVideoSegment } from './components/AIVideoScriptTab';
import VideoUnderstandingScriptProgressModal from './components/VideoUnderstandingScriptProgressModal';
import { WorkflowConfigModal } from './components/WorkflowConfigModal';
import { VideoChatWindow } from './components/VideoChatWindow';
import { Conversation, ChatMessage, WorkflowExecutionState, WorkflowNode, WorkflowConnection, AgentToolCallRecord, AgentTimelineOperation } from '@/types';
import { WorkflowExecutor } from '@/components/workflow/WorkflowExecutor';
import VideoCutModal, { VideoClip } from './components/VideoCutModal/VideoCutModal';
import { VideoPlayerPanelRef } from './components/VideoPlayerPanel/VideoPlayerPanel';

interface VideoEditingInterfaceProps {
  taskId: string;
  content: VideoEditingTaskContent | null;
  onUpdateContent: (content: VideoEditingTaskContent) => void;
}

const VideoEditingInterface: React.FC<VideoEditingInterfaceProps> = ({
  taskId,
  content,
  onUpdateContent,
}) => {
  // 获取国际化上下文
  const { locale } = useLocale();
  
  // 获取通知上下文
  const { showSuccess, showError } = useNotification();
  
  // 获取用户认证信息
  const { user } = useAuth();
  
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
  
  // AI混剪进度状态
  const [isAIMixing, setIsAIMixing] = useState<boolean>(
    content?.uiState?.isAIMixing ?? false
  );
  const [aiMixingProgress, setAIMixingProgress] = useState<number>(
    content?.uiState?.aiMixingProgress ?? 0
  );
  
  // AI混剪模式选择弹窗状态
  const [isAIMixingModeModalOpen, setIsAIMixingModeModalOpen] = useState<boolean>(
    content?.uiState?.isAIMixingModeModalOpen ?? false
  );
  
  // 批量解析模式选择弹窗状态
  const [isBatchAnalysisModalOpen, setIsBatchAnalysisModalOpen] = useState<boolean>(
    content?.uiState?.isBatchAnalysisModalOpen ?? false
  );
  
  // 工作流配置弹窗状态
  const [isWorkflowConfigModalOpen, setIsWorkflowConfigModalOpen] = useState<boolean>(
    content?.uiState?.isWorkflowConfigModalOpen ?? false
  );
  
  // 工作流配置状态 - 从 WorkflowConfigModal 保存的配置
  const [workflowConfigs, setWorkflowConfigs] = useState<Map<string, {
    workflowId: string;
    workflowName: string;
    enabled: boolean;
    toolDescription: string;
    nodes?: WorkflowNode[];
    connections?: WorkflowConnection[];
  }>>(content?.uiState?.workflowConfigs ? new Map(Object.entries(content.uiState.workflowConfigs)) : new Map());
  
  // 新增：程序化添加素材到时间轴的状态 (not persisted - transient operation state)
  const [materialsToAddToTimeline, setMaterialsToAddToTimeline] = useState<{ 
    materials: MaterialItem[], 
    targetTrackId?: string, 
    timestamp: number 
  } | undefined>(undefined);

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
  const [agentIsExecuting, setAgentIsExecuting] = useState<boolean>(false);
  const hasAutoChatInitialized = useRef(content?.uiState?.hasAutoChatInitialized ?? false);

  console.log('[VideoEditingInterface] Restoring UI state:', {
    taskId,
    hasContent: !!content,
    timelineCurrentTime,
    hasTimelineState: !!currentTimelineState,
    isPolishModalOpen,
    isScriptGenerationModalOpen,
    isCreativeBrainstormingModalOpen,
    isAIMixing,
    aiMixingProgress,
    isAIMixingModeModalOpen,
    isBatchAnalysisModalOpen,
    isWorkflowConfigModalOpen,
    videoCutModalIsOpen: videoCutModal.isOpen,
    workflowConfigsCount: workflowConfigs.size,
    timestamp: new Date().toISOString()
  });

  // 新增：VideoPlayerPanel的ref，用于调用其内部的组合跳转方法
  const videoPlayerRef = useRef<VideoPlayerPanelRef>(null);

  // Persist UI state to content whenever it changes
  useEffect(() => {
    if (!content) return;

    const updatedContent: VideoEditingTaskContent = {
      ...content,
      uiState: {
        timelineCurrentTime,
        currentTimelineState,
        isPolishModalOpen,
        isScriptGenerationModalOpen,
        scriptGenerationStartTime,
        isCreativeBrainstormingModalOpen,
        isAIMixing,
        aiMixingProgress,
        isAIMixingModeModalOpen,
        isBatchAnalysisModalOpen,
        isWorkflowConfigModalOpen,
        videoCutModal,
        isChatLoading: false, // 始终持久化为 false —— 这是瞬态状态，不应被恢复
        agentMode,
        hasAutoChatInitialized: hasAutoChatInitialized.current,
        workflowConfigs: Object.fromEntries(workflowConfigs),
      },
    };

    // Only update if state actually changed to avoid infinite loops
    const hasStateChanged =
      content.uiState?.timelineCurrentTime !== timelineCurrentTime ||
      content.uiState?.isPolishModalOpen !== isPolishModalOpen ||
      content.uiState?.isScriptGenerationModalOpen !== isScriptGenerationModalOpen ||
      content.uiState?.scriptGenerationStartTime !== scriptGenerationStartTime ||
      content.uiState?.isCreativeBrainstormingModalOpen !== isCreativeBrainstormingModalOpen ||
      content.uiState?.isAIMixing !== isAIMixing ||
      content.uiState?.aiMixingProgress !== aiMixingProgress ||
      content.uiState?.isAIMixingModeModalOpen !== isAIMixingModeModalOpen ||
      content.uiState?.isBatchAnalysisModalOpen !== isBatchAnalysisModalOpen ||
      content.uiState?.isWorkflowConfigModalOpen !== isWorkflowConfigModalOpen ||
      content.uiState?.agentMode !== agentMode ||
      content.uiState?.hasAutoChatInitialized !== hasAutoChatInitialized.current ||
      JSON.stringify(content.uiState?.currentTimelineState) !== JSON.stringify(currentTimelineState) ||
      JSON.stringify(content.uiState?.videoCutModal) !== JSON.stringify(videoCutModal) ||
      JSON.stringify(Object.fromEntries(workflowConfigs)) !== JSON.stringify(content.uiState?.workflowConfigs);

    if (hasStateChanged) {
      console.log('[VideoEditingInterface] Persisting UI state:', {
        taskId,
        timelineCurrentTime,
        hasTimelineState: !!currentTimelineState,
        isPolishModalOpen,
        isScriptGenerationModalOpen,
        isCreativeBrainstormingModalOpen,
        isAIMixing,
        aiMixingProgress,
        isAIMixingModeModalOpen,
        isWorkflowConfigModalOpen,
        videoCutModalIsOpen: videoCutModal.isOpen,
        hasAutoChatInitialized: hasAutoChatInitialized.current,
        timestamp: new Date().toISOString()
      });
      onUpdateContent(updatedContent);
    }
  }, [
    timelineCurrentTime,
    currentTimelineState,
    isPolishModalOpen,
    isScriptGenerationModalOpen,
    scriptGenerationStartTime,
    isCreativeBrainstormingModalOpen,
    isAIMixing,
    aiMixingProgress,
    isAIMixingModeModalOpen,
    isWorkflowConfigModalOpen,
    agentMode,
    videoCutModal,
    taskId,
    content
  ]);

  // 组件挂载时清理残留的 isStreaming 状态
  // 持久化的消息可能带有 isStreaming: true（如果上次会话在流式传输中中断），
  // 但挂载时不可能有活跃的流，所以需要重置
  useEffect(() => {
    if (!content?.conversations) return;

    const hasStaleStreaming = content.conversations.some(conv =>
      conv.messages.some(msg => msg.isStreaming)
    );

    if (hasStaleStreaming) {
      console.log('[VideoEditingInterface] 清理残留的 isStreaming 状态', {
        taskId,
        timestamp: new Date().toISOString()
      });

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
      
      console.warn('[VideoEditingInterface] Mobile device detected - showing restriction warning:', {
        taskId,
        deviceType,
        deviceInfo,
        timestamp: new Date().toISOString(),
        note: 'This is a backup check - primary restriction should happen in Taskbar'
      });
    }
  }, [taskId]);

  // 新增：全局键盘事件处理 - 空格键播放/暂停功能
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 空格键播放/暂停：无论焦点在哪个面板，都从timeline游标位置播放/暂停
      if (event.code === 'Space') {
        // 检查是否在输入框中，如果是则不处理空格键
        const target = event.target as HTMLElement;
        const isInInputField = target.tagName === 'INPUT' || 
                              target.tagName === 'TEXTAREA' || 
                              target.contentEditable === 'true' ||
                              target.closest('input') ||
                              target.closest('textarea') ||
                              target.closest('[contenteditable="true"]');
        
        if (!isInInputField && videoPlayerRef.current) {
          event.preventDefault();
          
          console.log(`[VideoEditingInterface] 全局空格键触发播放/暂停`, {
            taskId,
            timelineCurrentTime: timelineCurrentTime.toFixed(2),
            focusedElement: target.tagName,
            focusedElementClass: target.className,
            action: 'spacebar_global_playpause',
            timestamp: new Date().toISOString()
          });

          // 调用VideoPlayerPanel的从timeline游标位置播放/暂停方法
          videoPlayerRef.current.handlePlayPauseFromTimeline(timelineCurrentTime);
        }
      }
    };

    // 添加全局键盘事件监听器
    document.addEventListener('keydown', handleKeyDown);
    
    console.log(`[VideoEditingInterface] 全局键盘事件监听器已注册`, {
      taskId,
      supportedKeys: ['Space'],
      description: '空格键从timeline游标位置播放/暂停，不受面板焦点影响',
      timestamp: new Date().toISOString()
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      console.log(`[VideoEditingInterface] 全局键盘事件监听器已移除`, {
        taskId,
        timestamp: new Date().toISOString()
      });
    };
  }, [taskId, timelineCurrentTime]);

  // Mobile warning dialog close handler
  const handleCloseMobileWarning = useCallback(() => {
    setShowMobileWarning(false);
    console.log('[VideoEditingInterface] Mobile warning dialog closed:', {
      taskId,
      deviceType: currentDeviceType,
      timestamp: new Date().toISOString()
    });
  }, [taskId, currentDeviceType]);

  // 新增：处理timeline到视频播放器的实时跳转回调
  const handleVideoSeekRequired = useCallback(async (
    compositionTime: number, 
    targetSequence: import('./types').VideoSequenceItem, 
    videoTime: number
  ) => {
    console.log(`[VideoEditingInterface] Timeline触发视频播放器跳转`, {
      compositionTime: compositionTime.toFixed(2),
      targetSequenceName: targetSequence.name,
      videoTime: videoTime.toFixed(2),
      hasVideoPlayerRef: !!videoPlayerRef.current,
      timestamp: new Date().toISOString()
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
        console.log(`[VideoEditingInterface] Timeline触发视频播放器跳转完成`, {
          compositionTime: compositionTime.toFixed(2),
          sequenceName: targetSequence.name
        });
      } catch (error) {
        console.error(`[VideoEditingInterface] Timeline触发视频播放器跳转失败`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          compositionTime: compositionTime.toFixed(2),
          targetSequenceName: targetSequence.name,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      console.warn(`[VideoEditingInterface] VideoPlayerPanel ref不可用，跳过视频跳转`, {
        compositionTime: compositionTime.toFixed(2),
        targetSequenceName: targetSequence.name,
        timestamp: new Date().toISOString()
      });
    }
  }, []);
  
  // 处理从视频播放器到timeline的时间同步
  const handleVideoTimeUpdate = useCallback((currentTime: number) => {
    console.log(`[VideoEditingInterface] 视频时间更新同步到timeline`, {
      currentTime: currentTime.toFixed(2),
      previousTimelineTime: timelineCurrentTime.toFixed(2),
      timestamp: new Date().toISOString()
    });
    setTimelineCurrentTime(currentTime);
  }, [timelineCurrentTime]);

  // 新增：计算当前时间点的有效音量
  const calculateEffectiveVolume = useCallback((timelineState: TimelineState | null, currentTime: number): number => {
    if (!timelineState) return 0.8; // 默认音量

    // 找到当前时间点所有活跃的视频轨道
    const activeVideoTracks = timelineState.tracks.filter(track => 
      track.type === 'video' && 
      track.isVisible && 
      !track.isLocked && 
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
    
    console.log(`[VideoEditingInterface] 计算有效音量`, {
      currentTime: currentTime.toFixed(2),
      activeVideoTracks: activeVideoTracks.length,
      trackVolumes: activeVideoTracks.map(t => ({ id: t.id, name: t.name, volume: t.volume })),
      effectiveVolume: effectiveVolume.toFixed(3),
      timestamp: new Date().toISOString()
    });

    return effectiveVolume;
  }, []);

  // 计算当前的有效音量
  const currentEffectiveVolume = calculateEffectiveVolume(currentTimelineState, timelineCurrentTime);

  // 使用自定义钩子管理各个功能域的状态
  const documentState = useDocumentState(content, onUpdateContent, taskId);
  const videoPlayback = useVideoPlayback(taskId, handleVideoTimeUpdate, timelineCurrentTime, currentEffectiveVolume);
  const aiAssistant = useAIAssistant(taskId, documentState.markdownValue, documentState.handleMarkdownChange);
  const scriptGeneration = useScriptGeneration(taskId, documentState.markdownValue, onUpdateContent, content);
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

  // 添加视频解析功能 - 需要在 convertToScript 之前初始化
  const videoAnalysis = useVideoAnalysis(taskId);
  
  const convertToScript = useConvertToScript(taskId, scriptGeneration.handleScriptGenerated, videoAnalysis.getAnalysisResult);

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
  const timelineComposition = useTimelineComposition(taskId, materialManagement.materials, handleVideoSeekRequired);
  
  // 处理智能润色
  const handlePolishClick = useCallback(() => {
    console.log(`[VideoEditingInterface] 用户点击智能润色按钮`, {
      taskId,
      currentContentLength: documentState.markdownValue.length,
      timestamp: new Date().toISOString()
    });
    setIsPolishModalOpen(true);
  }, [taskId, documentState.markdownValue.length]);

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
    
    documentState.handleMarkdownChange(polishedContent);
    setIsPolishModalOpen(false);
  }, [taskId, documentState.markdownValue.length, documentState.handleMarkdownChange]);

  // 处理脚本生成弹窗
  const handleScriptGenerationClick = useCallback(() => {
    // 获取当前活动对话
    const activeConversation = content?.conversations?.find(
      conv => conv.id === content?.activeConversationId
    );

    // 将所有聊天消息内容合并为一个字符串
    const chatContent = activeConversation?.messages
      .map(msg => `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content}`)
      .join('\n\n') || '';

    console.log(`[VideoEditingInterface] 用户点击生成脚本按钮`, {
      taskId,
      messageCount: activeConversation?.messages.length || 0,
      chatContentLength: chatContent.length,
      timestamp: new Date().toISOString()
    });

    convertToScript.openModal(chatContent);
  }, [taskId, content, convertToScript]);

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
      const response = await fetch('/api/ai-video-script-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          scriptConfig: config,
          chatMessages,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const result = await response.json();

      if (result.success && result.segments) {
        const newSegments: AIVideoScriptSegment[] = result.segments.map(
          (seg: { title: string; scriptText: string }) =>
            createAIVideoSegment(seg.title, seg.scriptText)
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
        targetTrackId = 'audio-track-1';
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
          uploadStatus: 'uploading', // 设置为上传中状态
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
      const cutRequest = {
        task_id: taskId,
        video_url: originalMaterial.serverUrl || originalMaterial.url,
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
        videoUrl: cutRequest.video_url?.slice(0, 100) + '...',
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
            thumbnailUrl: cutClip.thumbnail_url || tempClipMaterials[index].thumbnailUrl,
            size: cutClip.file_size,
            width: cutClip.width,
            height: cutClip.height,
            format: cutClip.format,
            uploadStatus: 'completed',
            uploadProgress: 100,
            metadata: {
              ...tempClipMaterials[index].metadata,
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

        showSuccess(`已成功处理 ${cutResponse.clips.length} 个视频切片并上传到素材库`);
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
        // 已完成解析，打开结果弹窗
        console.log(`[VideoEditingInterface] 视频已完成解析，打开结果弹窗`, {
          taskId,
          materialId: material.id,
          videoUrl: material.url
        });
        videoAnalysis.openAnalysisModal(material.url);
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
      totalMaterialsCount: materialManagement.materials.length,
      timestamp: new Date().toISOString()
    });

    // 筛选所有视频素材
    const videoMaterials = materialManagement.materials.filter(material => {
      return material.type === 'video' && material.url;
    });

    // 检查是否有视频素材
    if (videoMaterials.length === 0) {
      console.warn(`[VideoEditingInterface] 没有找到可解析的视频素材`, {
        taskId,
        totalMaterials: materialManagement.materials.length
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
  }, [taskId, materialManagement.materials, showError]);

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

    // 筛选所有视频素材
    const videoMaterials = materialManagement.materials.filter(material => {
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
  }, [taskId, materialManagement.materials, videoAnalysis, handleVideoAnalysis]);

  // 处理从timeline到视频播放器的时间同步
  const handleTimelineTimeChange = useCallback((time: number) => {
    console.log(`[VideoEditingInterface] Timeline时间变化同步到视频播放器`, {
      newTime: time.toFixed(2),
      previousTime: timelineCurrentTime.toFixed(2),
      timestamp: new Date().toISOString()
    });
    setTimelineCurrentTime(time);
    
    // 如果是组合播放模式，同步到组合播放器
    if (timelineComposition.compositionPlayback?.isCompositionMode) {
      timelineComposition.handleCompositionSeek(time);
    } else {
      // 预览模式，同步到普通播放器
      videoPlayback.handleTimeSeek(time);
    }
  }, [timelineCurrentTime, timelineComposition, videoPlayback]);

  // 处理时间轴状态变化，用于导出功能
  const handleTimelineStateChange = useCallback((timelineState: TimelineState) => {
    // 只更新本地状态，不要再次调用timelineComposition.handleTimelineStateChange
    // 因为这会造成循环调用
    setCurrentTimelineState(timelineState);
  }, []);

  // 处理项目文件导入完成
  const handleImportComplete = useCallback((importedMaterials: MaterialItem[], importedTimelineState: TimelineState, isAIMixedEditing: boolean = false) => {
    console.log(`[VideoEditingInterface] 项目文件导入完成 - 开始处理`, {
      taskId,
      isAIMixedEditing,
      importedMaterialCount: importedMaterials.length,
      importedTrackCount: importedTimelineState.tracks.length,
      totalDuration: importedTimelineState.totalDuration,
      timelineStateKeys: Object.keys(importedTimelineState),
      tracksWithItems: importedTimelineState.tracks.map(track => ({
        id: track.id,
        name: track.name,
        type: track.type,
        itemCount: track.items?.length || 0,
        items: track.items?.map(item => ({ id: item.id, name: item.name, startTime: item.startTime, duration: item.duration })) || []
      })),
      timestamp: new Date().toISOString()
    });

    // 处理时间轴状态更新
    let finalTimelineState: TimelineState;
    
    if (isAIMixedEditing && currentTimelineState) {
      // AI混剪模式：将导入的素材合并到现有轨道中，保持现有轨道结构
      console.log(`[VideoEditingInterface] AI混剪模式：合并素材到现有轨道`, {
        taskId,
        currentTracksCount: currentTimelineState.tracks.length,
        importedTracksCount: importedTimelineState.tracks.length,
        timestamp: new Date().toISOString()
      });

      // 创建合并后的轨道
      const mergedTracks = currentTimelineState.tracks.map(existingTrack => {
        // 查找导入数据中对应类型的轨道
        let importedTrack;
        
        // 根据现有轨道ID匹配对应的导入轨道
        if (existingTrack.id === 'video-track-1') {
          importedTrack = importedTimelineState.tracks.find(track => 
            track.type === 'video' && track.id.includes('video')
          );
        } else if (existingTrack.id === 'image-track-1') {
          importedTrack = importedTimelineState.tracks.find(track => 
            track.type === 'video' && track.id.includes('image')
          );
        } else if (existingTrack.id === 'audio-track-1') {
          // 音频只导入到音频轨道1，收集所有音频轨道的素材
          const allAudioTracks = importedTimelineState.tracks.filter(track => 
            track.type === 'audio'
          );
          
          if (allAudioTracks.length > 0) {
            // 合并所有音频轨道的素材到音频轨道1
            const allAudioItems = allAudioTracks.flatMap(track => track.items);
            
            // 按开始时间排序音频素材
            const sortedAudioItems = allAudioItems.sort((a, b) => a.startTime - b.startTime);
            
            console.log(`[VideoEditingInterface] 合并所有音频素材到 ${existingTrack.id}`, {
              audioTracksCount: allAudioTracks.length,
              totalAudioItems: sortedAudioItems.length,
              audioItemsTimeRange: sortedAudioItems.length > 0 ? {
                firstStart: sortedAudioItems[0].startTime,
                lastEnd: sortedAudioItems[sortedAudioItems.length - 1].startTime + sortedAudioItems[sortedAudioItems.length - 1].duration
              } : null,
              timestamp: new Date().toISOString()
            });
            
            // 创建虚拟导入轨道，包含所有音频素材
            importedTrack = {
              ...allAudioTracks[0],
              items: sortedAudioItems
            };
          }
        } else if (existingTrack.id.startsWith('audio-track-') && existingTrack.id !== 'audio-track-1') {
          // 其他音频轨道不导入任何内容，保持清空
          importedTrack = null;
          console.log(`[VideoEditingInterface] 跳过 ${existingTrack.id}，音频只导入到音频轨道1`, {
            timestamp: new Date().toISOString()
          });
        } else if (existingTrack.id.startsWith('subtitle-track-')) {
          // 字幕轨道不参与AI混剪，保持清空
          importedTrack = null;
          console.log(`[VideoEditingInterface] 跳过 ${existingTrack.id}，字幕轨道不参与AI混剪`, {
            timestamp: new Date().toISOString()
          });
        } else {
          // 通用匹配：按类型匹配
          importedTrack = importedTimelineState.tracks.find(track => 
            track.type === existingTrack.type
          );
        }

        if (importedTrack && importedTrack.items.length > 0) {
          console.log(`[VideoEditingInterface] 合并轨道 ${existingTrack.id}`, {
            existingItems: existingTrack.items.length,
            importedItems: importedTrack.items.length,
            timestamp: new Date().toISOString()
          });
          
          // 清空现有轨道的素材，添加AI混剪的素材
          return {
            ...existingTrack,
            items: importedTrack.items.map(item => ({
              ...item,
              trackId: existingTrack.id // 确保使用现有轨道的ID
            }))
          };
        } else {
          // 没有对应的导入素材，清空轨道
          return {
            ...existingTrack,
            items: []
          };
        }
      });

      finalTimelineState = {
        ...currentTimelineState,
        tracks: mergedTracks,
        totalDuration: importedTimelineState.totalDuration,
        currentTime: 0
      };

      console.log(`[VideoEditingInterface] AI混剪轨道合并完成`, {
        taskId,
        finalTracksCount: finalTimelineState.tracks.length,
        tracksWithItems: finalTimelineState.tracks.map(track => ({
          id: track.id,
          itemCount: track.items.length
        })),
        timestamp: new Date().toISOString()
      });
    } else {
      // 普通导入模式：完全替换timeline状态
      finalTimelineState = importedTimelineState;
      console.log(`[VideoEditingInterface] 普通导入模式：完全替换timeline状态`, { taskId });
    }

    // 更新本地时间轴状态
    console.log(`[VideoEditingInterface] 开始更新本地时间轴状态`, { taskId });
    const updateId = `timeline-update-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setCurrentTimelineState(finalTimelineState);
    setExternalTimelineUpdateId(updateId);
    console.log(`[VideoEditingInterface] 本地时间轴状态更新完成`, { taskId, updateId });
    
    // 将导入的素材添加到素材管理中（AI混剪时跳过，因为应该使用现有素材）
    if (importedMaterials.length > 0 && !isAIMixedEditing) {
      console.log(`[VideoEditingInterface] 开始添加素材到素材库`, { 
        taskId,
        materialsToAdd: importedMaterials.map(m => ({ id: m.id, name: m.name, type: m.type }))
      });
      materialManagement.addMaterials(importedMaterials);
      console.log(`[VideoEditingInterface] 已将 ${importedMaterials.length} 个素材添加到素材库`, {
        materialIds: importedMaterials.map(m => m.id),
        timestamp: new Date().toISOString()
      });
    } else if (isAIMixedEditing) {
      console.log(`[VideoEditingInterface] AI混剪模式：跳过添加新素材到素材库，使用现有素材`, {
        taskId,
        existingMaterialsCount: materialManagement.materials.length,
        importedMaterialsCount: importedMaterials.length,
        timestamp: new Date().toISOString()
      });
    }

    // 同步到timeline组合管理
    console.log(`[VideoEditingInterface] 开始同步到timeline组合管理`, { taskId });
    timelineComposition.handleTimelineStateChange(finalTimelineState);
    console.log(`[VideoEditingInterface] timeline组合管理同步完成`, { taskId });
    
    // 重置当前播放时间
    setTimelineCurrentTime(0);
    
    console.log(`[VideoEditingInterface] 项目导入处理完成`, {
      taskId,
      isAIMixedEditing,
      newTotalDuration: finalTimelineState.totalDuration,
      finalTrackCount: finalTimelineState.tracks.length,
      timestamp: new Date().toISOString()
    });
  }, [taskId, materialManagement, timelineComposition, currentTimelineState]);

  // 检测并导入来自Workflow的待处理时间轴数据
  useEffect(() => {
    if (content?.pendingTimelineData) {
      console.log('[VideoEditingInterface] Detected pending timeline data from Workflow, importing...', {
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
      // isAIMixedEditing设为false，让系统正常处理素材
      handleImportComplete([], normalizedTimelineData, false);

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

  // 检测并导入来自Workflow Video Export的待处理素材数据
  useEffect(() => {
    if (content?.pendingMaterials && content.pendingMaterials.length > 0) {
      console.log('[VideoEditingInterface] Detected pending materials from Video Export, importing...', {
        taskId,
        materialsCount: content.pendingMaterials.length,
        timestamp: new Date().toISOString()
      });

      // 获取现有素材
      const existingMaterials = materialManagement.materials;
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

  // 新增：AI自动混剪功能
  const handleAutoMixAudio = useCallback(() => {
    console.log(`[VideoEditingInterface] 开始AI自动混剪`, {
      taskId,
      totalMaterialsCount: materialManagement.materials.length,
      timestamp: new Date().toISOString()
    });

    // 筛选从文本脚本转换的音频素材
    const scriptAudioMaterials = materialManagement.materials.filter(material => {
      const isAudio = material.type === 'audio';
      const hasSegmentId = material.metadata?.segment_id;
      const hasSegmentNumber = typeof material.metadata?.segment_number === 'number';
      
      return isAudio && hasSegmentId && hasSegmentNumber;
    });

    // 筛选从文本脚本关联的视频素材
    const scriptVideoMaterials = materialManagement.materials.filter(material => {
      const isVideo = material.type === 'video';
      const hasSegmentId = material.metadata?.segment_id;
      const hasSegmentNumber = typeof material.metadata?.segment_number === 'number';
      
      return isVideo && hasSegmentId && hasSegmentNumber;
    });

    console.log(`[VideoEditingInterface] 筛选出脚本素材`, {
      totalMaterials: materialManagement.materials.length,
      scriptAudioCount: scriptAudioMaterials.length,
      scriptVideoCount: scriptVideoMaterials.length,
      audioMaterials: scriptAudioMaterials.map(m => ({
        id: m.id,
        name: m.name,
        segmentId: m.metadata?.segment_id,
        segmentNumber: m.metadata?.segment_number,
        duration: m.duration
      })),
      videoMaterials: scriptVideoMaterials.map(m => ({
        id: m.id,
        name: m.name,
        segmentId: m.metadata?.segment_id,
        segmentNumber: m.metadata?.segment_number,
        duration: m.duration
      }))
    });

    if (scriptAudioMaterials.length === 0 && scriptVideoMaterials.length === 0) {
      console.warn(`[VideoEditingInterface] 未找到从文本脚本转换的音频或视频素材`, {
        taskId,
        troubleshooting: {
          message: '请确保：1) 已完成文本转语音 2) 已完成AI匹配视频 3) 素材包含正确的segment_id和segment_number元数据',
          audioMaterialsWithSegmentData: materialManagement.materials.filter(m => m.type === 'audio' && m.metadata?.segment_id).length,
          videoMaterialsWithSegmentData: materialManagement.materials.filter(m => m.type === 'video' && m.metadata?.segment_id).length
        },
        availableMaterials: materialManagement.materials.map(m => ({
          id: m.id,
          name: m.name,
          type: m.type,
          hasSegmentId: !!m.metadata?.segment_id,
          hasSegmentNumber: typeof m.metadata?.segment_number === 'number',
          segmentId: m.metadata?.segment_id,
          segmentNumber: m.metadata?.segment_number
        }))
      });
      return;
    }

    // 按segment_number排序音频素材，确保转换顺序
    const sortedAudioMaterials = [...scriptAudioMaterials].sort((a, b) => {
      const aSegmentNumber = a.metadata?.segment_number || 0;
      const bSegmentNumber = b.metadata?.segment_number || 0;
      return aSegmentNumber - bSegmentNumber;
    });

    // 按segment_number排序视频素材，确保与音频相同的转换顺序
    const sortedVideoMaterials = [...scriptVideoMaterials].sort((a, b) => {
      const aSegmentNumber = a.metadata?.segment_number || 0;
      const bSegmentNumber = b.metadata?.segment_number || 0;
      return aSegmentNumber - bSegmentNumber;
    });

    console.log(`[VideoEditingInterface] 素材排序完成`, {
      audioMaterials: sortedAudioMaterials.map((m, index) => ({
        index: index + 1,
        id: m.id,
        name: m.name,
        segmentNumber: m.metadata?.segment_number,
        duration: m.duration?.toFixed(2)
      })),
      videoMaterials: sortedVideoMaterials.map((m, index) => ({
        index: index + 1,
        id: m.id,
        name: m.name,
        segmentNumber: m.metadata?.segment_number,
        duration: m.duration?.toFixed(2)
      })),
      totalAudioDuration: sortedAudioMaterials.reduce((total, m) => total + (m.duration || 0), 0).toFixed(2),
      totalVideoDuration: sortedVideoMaterials.reduce((total, m) => total + (m.duration || 0), 0).toFixed(2)
    });

    // 首先添加音频素材到音频轨道
    if (sortedAudioMaterials.length > 0) {
      setMaterialsToAddToTimeline({
        materials: sortedAudioMaterials,
        targetTrackId: 'audio-track-1', // 指定添加到第一个音频轨道
        timestamp: Date.now()
      });

      console.log(`[VideoEditingInterface] 音频素材添加请求已发送`, {
        materialsCount: sortedAudioMaterials.length,
        targetTrackId: 'audio-track-1',
        timestamp: Date.now()
      });
    }

    // 延迟添加视频素材到视频轨道，确保音频添加完成后再添加视频
    if (sortedVideoMaterials.length > 0) {
      setTimeout(() => {
        setMaterialsToAddToTimeline({
          materials: sortedVideoMaterials,
          targetTrackId: 'video-track-1', // 指定添加到视频轨道（不是图片轨道）
          timestamp: Date.now()
        });

        console.log(`[VideoEditingInterface] 视频素材添加请求已发送`, {
          materialsCount: sortedVideoMaterials.length,
          targetTrackId: 'video-track-1',
          timestamp: Date.now()
        });
      }, 200); // 200ms延迟，确保音频处理完成
    }

    console.log(`[VideoEditingInterface] AI自动混剪请求完成`, {
      audioMaterialsCount: sortedAudioMaterials.length,
      videoMaterialsCount: sortedVideoMaterials.length,
      totalMaterialsProcessed: sortedAudioMaterials.length + sortedVideoMaterials.length,
      timestamp: Date.now()
    });
  }, [taskId, materialManagement.materials]);

  // 新增：AI混剪功能 - 显示模式选择弹窗
  const handleAIMixedEditing = useCallback(() => {
    console.log(`[VideoEditingInterface] 点击AI混剪按钮`, {
      taskId,
      totalMaterialsCount: materialManagement.materials.length,
      timestamp: new Date().toISOString()
    });

    // 检查是否有素材
    if (materialManagement.materials.length === 0) {
      console.warn(`[VideoEditingInterface] 无素材可用于AI混剪`, { taskId });
      showError('无素材可用于AI混剪，请先添加视频、音频或图片素材', 5000);
      return;
    }

    // 显示模式选择弹窗
    setIsAIMixingModeModalOpen(true);
  }, [taskId, materialManagement.materials.length, showError]);

  // 新增：执行AI混剪的实际逻辑
  const executeAIMixedEditing = useCallback(async (mode: { type: 'quick' | 'professional'; frameInterval?: number }) => {
    console.log(`[VideoEditingInterface] 开始执行AI混剪`, {
      taskId,
      mode,
      totalMaterialsCount: materialManagement.materials.length,
      timestamp: new Date().toISOString()
    });

    // 开始AI混剪并显示进度弹窗
    setIsAIMixing(true);
    setAIMixingProgress(0);
    
    // 模拟进度条增长
    const progressInterval = setInterval(() => {
      setAIMixingProgress(prev => {
        if (prev >= 90) {
          return prev; // 在90%停止自动增长，等待实际完成
        }
        return Math.min(prev + Math.random() * 8 + 2, 90); // 随机增长2-10%，最多到90%
      });
    }, 800 + Math.random() * 400); // 800-1200ms间隔

    console.log(`[VideoEditingInterface] 显示AI混剪进度弹窗`, { taskId });

    try {
            // 第一步：如果有视频素材，先进行并行视频分析
      const videoMaterials = materialManagement.materials.filter(m => m.type === 'video');
      
      if (videoMaterials.length > 0) {
        console.log(`[VideoEditingInterface] 开始批量视频分析阶段（AI混剪模式）`, {
          taskId,
          videoCount: videoMaterials.length,
          mode: mode.type,
          frameInterval: mode.frameInterval,
          useBatchAPI: true,
          timestamp: new Date().toISOString()
        });

        try {
          // AI混剪使用批量分析API，优化的两阶段处理：
          // 1. 顺序提取帧（一个接一个处理视频）
          // 2. 并发VLM分析（对所有提取的帧并发调用）
          const analysisResults = await analyzeVideosInBatch(
            videoMaterials,
            {
              maxRetries: VIDEO_ANALYSIS_CONFIG.MAX_RETRY_ATTEMPTS,
              retryDelayMs: VIDEO_ANALYSIS_CONFIG.RETRY_DELAY_MS,
              mode
            },
            taskId
          );

          const successfulAnalyses = analysisResults.filter(r => r.success);
          const failedAnalyses = analysisResults.filter(r => !r.success);

          console.log(`[VideoEditingInterface] 批量视频分析阶段完成`, {
            taskId,
            totalVideos: videoMaterials.length,
            successCount: successfulAnalyses.length,
            failedCount: failedAnalyses.length,
            successRate: `${Math.round((successfulAnalyses.length / videoMaterials.length) * 100)}%`,
            useBatchAPI: true,
            timestamp: new Date().toISOString()
          });

          if (failedAnalyses.length > 0) {
            console.warn(`[VideoEditingInterface] 部分视频分析失败，但将继续进行AI混剪`, {
              taskId,
              failedCount: failedAnalyses.length,
              failedVideos: failedAnalyses.map(r => r.material.name),
              timestamp: new Date().toISOString()
            });
          }

        } catch (error) {
          console.error(`[VideoEditingInterface] 批量视频分析阶段异常`, {
            taskId,
            error: error instanceof Error ? error.message : String(error),
            videoCount: videoMaterials.length,
            useBatchAPI: true,
            timestamp: new Date().toISOString()
          });
          // 继续执行AI混剪，即使视频分析失败
        }
      }

      // 第二步：执行AI混剪
      console.log(`[VideoEditingInterface] 开始AI混剪阶段`, {
        materials: materialManagement.materials.map(m => ({
          id: m.id,
          name: m.name,
          type: m.type,
          duration: m.duration
        }))
      });

      // 调用AI混剪API
      const response = await fetch('/api/ai-mixed-editing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: taskId,
          materials: materialManagement.materials
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[VideoEditingInterface] AI混剪API调用成功`, {
        taskId,
        hasTimelineData: !!result.timelineData,
        timelineDataKeys: result.timelineData ? Object.keys(result.timelineData) : [],
        timestamp: new Date().toISOString()
      });

      // 完成进度条到100%
      clearInterval(progressInterval);
      setAIMixingProgress(100);

      // 使用时间轴导入功能填充时间轴
      if (result.timelineData) {
        console.log(`[VideoEditingInterface] 开始导入AI生成的时间轴数据`, { 
          taskId,
          timelineDataSize: JSON.stringify(result.timelineData).length,
          timestamp: new Date().toISOString()
        });
        
        const importResponse = await fetch('/api/timeline-import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskId: taskId,
            fileContent: JSON.stringify(result.timelineData),
            fileName: `ai-mixed-editing-${Date.now()}.json`,
            mergeMode: 'replace',
            preserveIds: true  // AI混剪时保持素材ID，以便与现有素材对应
          }),
        });

        if (!importResponse.ok) {
          const importErrorData = await importResponse.json();
          console.error(`[VideoEditingInterface] Timeline import API调用失败`, {
            taskId,
            status: importResponse.status,
            error: importErrorData,
            timestamp: new Date().toISOString()
          });
          throw new Error(importErrorData.error || `Timeline import failed: ${importResponse.status}`);
        }

        const importResult = await importResponse.json();
        console.log(`[VideoEditingInterface] Timeline import API调用成功`, {
          taskId,
          success: importResult.success,
          hasImportedData: !!importResult.importedData,
          importedDataKeys: importResult.importedData ? Object.keys(importResult.importedData) : [],
          statistics: importResult.statistics,
          timestamp: new Date().toISOString()
        });

        // 详细日志导入数据结构
        if (importResult.importedData) {
          console.log(`[VideoEditingInterface] 导入数据详细结构`, {
            taskId,
            hasTimelineState: !!importResult.importedData.timelineState,
            hasMaterials: !!importResult.importedData.materials,
            timelineStateKeys: importResult.importedData.timelineState ? Object.keys(importResult.importedData.timelineState) : [],
            materialsCount: importResult.importedData.materials ? importResult.importedData.materials.length : 0,
            tracksCount: importResult.importedData.timelineState?.tracks ? importResult.importedData.timelineState.tracks.length : 0,
            timestamp: new Date().toISOString()
          });
        }

        if (!importResult.success) {
          throw new Error(importResult.error || 'Timeline import failed');
        }

        // 处理导入的数据，类似TimelinePanel中的handleImportJSON
        const importedData = importResult.importedData;
        if (importedData && importedData.timelineState && importedData.materials) {
          console.log(`[VideoEditingInterface] 开始处理AI混剪导入数据`, {
            taskId,
            materialsCount: importedData.materials.length,
            tracksCount: importedData.timelineState.tracks.length,
            totalDuration: importedData.timelineState.totalDuration,
            timestamp: new Date().toISOString()
          });

          // 调用导入完成处理函数，这会更新timeline状态（AI混剪模式不添加新素材）
          handleImportComplete(importedData.materials, importedData.timelineState, true);

          // 显示成功提示
          console.log(`[VideoEditingInterface] AI混剪完成`, { 
            taskId,
            importedMaterialCount: importedData.materials.length,
            importedTrackCount: importedData.timelineState.tracks.length,
            timestamp: new Date().toISOString()
          });
          
          // 延迟关闭进度弹窗，让用户看到100%完成状态
          setTimeout(() => {
            setIsAIMixing(false);
            setAIMixingProgress(0);
          }, 1500);
          
          showSuccess(
            `AI混剪已完成！导入了 ${importResult.statistics?.imported_track_count || 0} 个轨道和 ${importResult.statistics?.imported_material_count || 0} 个素材，时间轴已自动填充，请查看生成的剪辑方案`, 
            8000
          );
        } else {
          console.error(`[VideoEditingInterface] AI混剪导入数据格式不正确`, {
            taskId,
            hasImportedData: !!importedData,
            hasTimelineState: !!(importedData?.timelineState),
            hasMaterials: !!(importedData?.materials),
            timestamp: new Date().toISOString()
          });
          throw new Error('AI混剪导入数据格式不正确');
        }
      } else {
        console.error(`[VideoEditingInterface] AI混剪返回的数据中缺少时间轴信息`, {
          taskId,
          resultKeys: Object.keys(result),
          timestamp: new Date().toISOString()
        });
        throw new Error('AI混剪返回的数据中缺少时间轴信息');
      }

    } catch (error) {
      // 清理进度条
      clearInterval(progressInterval);
      setIsAIMixing(false);
      setAIMixingProgress(0);
      
      console.error(`[VideoEditingInterface] AI混剪失败`, {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      showError(`AI混剪失败: ${error instanceof Error ? error.message : String(error)}`, 8000);
    }
  }, [taskId, materialManagement.materials, showSuccess, showError]);

  // 处理AI混剪模式选择弹窗的确认
  const handleAIMixingModeConfirm = useCallback((mode: { type: 'quick' | 'professional'; frameInterval?: number }) => {
    console.log(`[VideoEditingInterface] 用户选择AI混剪模式`, {
      taskId,
      selectedMode: mode,
      timestamp: new Date().toISOString()
    });
    
    // 关闭弹窗
    setIsAIMixingModeModalOpen(false);
    
    // 执行AI混剪
    executeAIMixedEditing(mode);
  }, [taskId, executeAIMixedEditing]);

  // 处理AI混剪模式选择弹窗的关闭
  const handleAIMixingModeClose = useCallback(() => {
    console.log(`[VideoEditingInterface] 用户取消AI混剪模式选择`, { taskId });
    setIsAIMixingModeModalOpen(false);
  }, [taskId]);

  // 处理工作流配置弹窗的打开
  const handleViewWorkflowsClick = useCallback(() => {
    console.log(`[VideoEditingInterface] 用户点击查看工作流按钮`, {
      taskId,
      timestamp: new Date().toISOString()
    });
    setIsWorkflowConfigModalOpen(true);
  }, [taskId]);

  // 处理工作流配置弹窗的关闭
  const handleWorkflowConfigClose = useCallback(() => {
    console.log(`[VideoEditingInterface] 关闭工作流配置弹窗`, {
      taskId,
      timestamp: new Date().toISOString()
    });
    setIsWorkflowConfigModalOpen(false);
  }, [taskId]);
  
  // 处理工作流配置保存
  const handleWorkflowConfigSave = useCallback((configs: Map<string, {
    workflowId: string;
    workflowName: string;
    enabled: boolean;
    toolDescription: string;
    nodes?: WorkflowNode[];
    connections?: WorkflowConnection[];
  }>) => {
    console.log(`[VideoEditingInterface] 保存工作流配置`, {
      taskId,
      configsCount: configs.size,
      enabledCount: Array.from(configs.values()).filter(c => c.enabled).length,
      configsWithNodes: Array.from(configs.values()).filter(c => c.nodes && c.nodes.length > 0).length,
      timestamp: new Date().toISOString()
    });
    setWorkflowConfigs(configs);
  }, [taskId]);

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
      
      console.log('[VideoEditingInterface] 自动初始化视频编辑聊天对话', {
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
      
      console.log('[VideoEditingInterface] 视频编辑聊天对话初始化完成', {
        conversationId,
        timestamp: now.toISOString()
      });
    }
  }, []); // 只在组件挂载时运行一次

  // 工作流配置自动加载 - 从后端加载已保存的工作流配置
  useEffect(() => {
    const loadWorkflowPreferences = async () => {
      if (!user?.id) {
        console.log('[VideoEditingInterface] 等待用户认证信息，跳过工作流配置加载', {
          taskId,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // 如果已经有配置了（例如从其他地方设置的），不需要重新加载
      if (workflowConfigs.size > 0) {
        console.log('[VideoEditingInterface] 工作流配置已存在，跳过自动加载', {
          taskId,
          configsCount: workflowConfigs.size,
          timestamp: new Date().toISOString()
        });
        return;
      }

      try {
        console.log('[VideoEditingInterface] 开始从后端加载工作流配置', {
          taskId,
          userId: user.id,
          timestamp: new Date().toISOString()
        });

        // 首先加载所有工作流，以获取节点和连接信息
        const { loadAgentWorkflows } = await import('@/lib/api/workflow');
        const workflowsResponse = await loadAgentWorkflows(user.id);
        
        if (!workflowsResponse.success || !workflowsResponse.data) {
          console.warn('[VideoEditingInterface] 加载工作流列表失败，使用空配置', {
            taskId,
            timestamp: new Date().toISOString()
          });
          return;
        }

        const workflows = workflowsResponse.data;
        console.log('[VideoEditingInterface] 成功加载工作流列表', {
          taskId,
          workflowsCount: workflows.length,
          timestamp: new Date().toISOString()
        });

        // 加载工作流配置偏好设置
        const preferencesResponse = await fetch('/api/workflow-preferences/load', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: user.id
          }),
        });

        if (!preferencesResponse.ok) {
          console.warn('[VideoEditingInterface] 加载工作流配置偏好失败，使用空配置', {
            taskId,
            status: preferencesResponse.status,
            timestamp: new Date().toISOString()
          });
          return;
        }

        const preferencesResult = await preferencesResponse.json();
        
        if (preferencesResult.success && preferencesResult.preferences) {
          // 转换偏好设置对象为 Map
          const preferencesMap = new Map<string, {
            workflowId: string;
            workflowName: string;
            enabled: boolean;
            toolDescription: string;
            nodes?: WorkflowNode[];
            connections?: WorkflowConnection[];
          }>();

          Object.entries(preferencesResult.preferences).forEach(([key, value]: [string, any]) => {
            // 查找对应的工作流以获取节点和连接信息
            const workflow = workflows.find(w => w.workflow_id === value.workflow_id);
            preferencesMap.set(key, {
              workflowId: value.workflow_id,
              workflowName: value.workflow_name,
              enabled: value.is_expanded, // 将 is_expanded 映射为 enabled
              toolDescription: value.tool_description || '',
              nodes: workflow?.nodes,
              connections: workflow?.connections
            });
          });
          
          setWorkflowConfigs(preferencesMap);
          
          console.log('[VideoEditingInterface] 工作流配置加载成功', {
            taskId,
            configsCount: preferencesMap.size,
            enabledCount: Array.from(preferencesMap.values()).filter(c => c.enabled).length,
            configsWithNodes: Array.from(preferencesMap.values()).filter(c => c.nodes && c.nodes.length > 0).length,
            configs: Array.from(preferencesMap.entries()).map(([id, config]) => ({
              id,
              name: config.workflowName,
              enabled: config.enabled,
              hasDescription: !!config.toolDescription,
              hasNodes: !!(config.nodes && config.nodes.length > 0)
            })),
            timestamp: new Date().toISOString()
          });
        } else {
          console.log('[VideoEditingInterface] 未找到已保存的工作流配置，使用空配置', {
            taskId,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('[VideoEditingInterface] 加载工作流配置失败', {
          taskId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString()
        });
        // 不显示错误给用户 - 工作流配置加载失败不是致命错误
        // 用户仍然可以手动配置工作流
      }
    };

    loadWorkflowPreferences();
  }, [user?.id, taskId]); // 当用户ID或任务ID变化时重新加载

  // 聊天消息处理
  const updateConversationMessages = useCallback((conversationId: string, messages: ChatMessage[]) => {
    console.log(`[VideoEditingInterface] 更新聊天消息`, {
      conversationId,
      messageCount: messages.length,
      timestamp: new Date().toISOString()
    });
    
    const conversations = content?.conversations || [];
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
      ...content!,
      conversations: updatedConversations,
    };

    onUpdateContent(updatedContent);
  }, [content, onUpdateContent]);

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

  // --- Agent Mode: Apply timeline operation ---
  const applyAgentOperationToTimeline = useCallback((operation: AgentTimelineOperation) => {
    setCurrentTimelineState(prev => {
      if (!prev) return prev;
      const state = JSON.parse(JSON.stringify(prev)) as TimelineState;

      switch (operation.type) {
        case 'add_clip': {
          const track = state.tracks.find(t => t.id === operation.clip.trackId);
          if (track) {
            const { clip, material } = operation;
            const matType = material.type || track.type;
            const colorMap: Record<string, string> = { video: '#3b82f6', audio: '#10b981', image: '#8b5cf6' };
            track.items.push({
              id: clip.id,
              name: material.name || '',
              type: track.type,
              startTime: clip.startTime || 0,
              duration: clip.duration || 0,
              trackId: clip.trackId,
              color: colorMap[matType] || '#6b7280',
              materialId: clip.materialId || '',
              clipStart: clip.clipStart || 0,
              clipEnd: clip.clipEnd || 0,
              originalDuration: clip.originalDuration || 0,
              volume: isNaN(clip.volume) ? 1.0 : clip.volume,
              thumbnailUrl: material.thumbnailUrl || '',
            });
          }
          break;
        }
        case 'trim_clip': {
          for (const track of state.tracks) {
            const clip = track.items.find(i => i.id === operation.clipId);
            if (clip) {
              clip.clipStart = operation.clipStart;
              clip.clipEnd = operation.clipEnd;
              clip.duration = operation.duration;
              break;
            }
          }
          break;
        }
        case 'delete_clip': {
          const track = state.tracks.find(t => t.id === operation.trackId);
          if (track) {
            track.items = track.items.filter(i => i.id !== operation.clipId);
          }
          break;
        }
        case 'move_clip': {
          const fromTrack = state.tracks.find(t => t.id === operation.fromTrackId);
          if (fromTrack) {
            const idx = fromTrack.items.findIndex(i => i.id === operation.clipId);
            if (idx !== -1) {
              const [clip] = fromTrack.items.splice(idx, 1);
              clip.startTime = operation.newStartTime;
              clip.trackId = operation.toTrackId;
              const toTrack = state.tracks.find(t => t.id === operation.toTrackId);
              if (toTrack) toTrack.items.push(clip);
            }
          }
          break;
        }
        case 'resize_clip': {
          for (const track of state.tracks) {
            const clip = track.items.find(i => i.id === operation.clipId);
            if (clip) {
              clip.duration = operation.newDuration;
              break;
            }
          }
          break;
        }
      }

      // Recalculate total duration
      let maxEnd = 0;
      for (const track of state.tracks) {
        for (const item of track.items) {
          const end = item.startTime + item.duration;
          if (end > maxEnd) maxEnd = end;
        }
      }
      state.totalDuration = Math.max(maxEnd, state.totalDuration);

      return state;
    });

    // Trigger external timeline update so TimelinePanel picks it up
    setExternalTimelineUpdateId(`agent-op-${Date.now()}`);
  }, []);

  // --- Agent Mode: Trigger clip animation ---
  const triggerClipAnimation = useCallback((operation: AgentTimelineOperation) => {
    let clipId = '';
    let animClass = '';

    switch (operation.type) {
      case 'add_clip':
        clipId = operation.clip.id;
        animClass = 'agent-clip-added';
        break;
      case 'trim_clip':
        clipId = operation.clipId;
        animClass = 'agent-clip-trimmed';
        break;
      case 'delete_clip':
        clipId = operation.clipId;
        animClass = 'agent-clip-deleting';
        break;
      case 'move_clip':
        clipId = operation.clipId;
        animClass = 'agent-clip-moving';
        break;
      case 'resize_clip':
        clipId = operation.clipId;
        animClass = 'agent-clip-resized';
        break;
    }

    if (clipId && animClass) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-clip-id="${clipId}"]`);
        if (el) {
          el.classList.add(animClass);
          setTimeout(() => el.classList.remove(animClass), 700);
        }
      });
    }
  }, []);

  // --- Agent Mode: Undo handler ---
  const handleAgentUndo = useCallback((agentMessage: ChatMessage) => {
    if (!agentMessage.timelineSnapshot) return;

    console.log('[VideoEditingInterface] Agent undo: restoring timeline snapshot');

    // Restore timeline to snapshot
    setCurrentTimelineState(agentMessage.timelineSnapshot);
    setExternalTimelineUpdateId(`agent-undo-${Date.now()}`);

    // Mark message as undone
    const activeConversationId = content?.activeConversationId;
    if (!activeConversationId) return;

    const conversations = content?.conversations || [];
    const activeConversation = conversations.find(c => c.id === activeConversationId);
    if (!activeConversation) return;

    const updatedMessages = activeConversation.messages.map(msg =>
      msg.id === agentMessage.id
        ? { ...msg, isUndone: true, pendingOperations: [] }
        : msg
    );
    updateConversationMessages(activeConversationId, updatedMessages);
  }, [content, updateConversationMessages]);

  // --- Agent Mode: Send agent message ---
  const handleSendAgentMessage = useCallback(async (message: string) => {
    const activeConversationId = content?.activeConversationId;
    if (!activeConversationId || agentIsExecuting) return;

    const conversations = content?.conversations || [];
    const activeConversation = conversations.find(c => c.id === activeConversationId);
    if (!activeConversation) return;

    // 1. Save timeline snapshot for undo
    const timelineSnapshot: TimelineState | undefined = currentTimelineState
      ? JSON.parse(JSON.stringify(currentTimelineState))
      : undefined;

    setAgentIsExecuting(true);

    try {
      // 2. Add user message
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };
      const messagesWithUser = [...activeConversation.messages, userMessage];

      // 3. Create agent reply placeholder
      const agentMessageId = `msg-${Date.now()}-agent`;
      const agentMessage: ChatMessage = {
        id: agentMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        isAgentMessage: true,
        agentToolCalls: [],
        timelineSnapshot,
        pendingOperations: [],
      };

      const messagesWithAgent = [...messagesWithUser, agentMessage];
      updateConversationMessages(activeConversationId, messagesWithAgent);

      console.log('[VideoEditingInterface] Sending agent message', {
        messageLength: message.length,
        hasTimelineState: !!currentTimelineState,
        materialsCount: materialManagement.materials.length,
      });

      // 4. Send SSE request
      const response = await fetch('/api/video-editing-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesWithUser,
          timelineState: currentTimelineState,
          materials: materialManagement.materials,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      // 5. Process SSE stream
      let accumulatedContent = '';
      const toolCalls: AgentToolCallRecord[] = [];
      const pendingOperations: AgentTimelineOperation[] = [];
      let streamDone = false;
      let sseBuffer = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Flush remaining buffer before exiting
          if (sseBuffer.trim() && sseBuffer.startsWith('data: ')) {
            const remaining = sseBuffer.slice(6);
            if (remaining === '[DONE]') {
              streamDone = true;
            } else {
              try {
                const event = JSON.parse(remaining);
                if (event.type === 'agent_end') {
                  streamDone = true;
                }
              } catch { /* incomplete data, ignore */ }
            }
          }
          break;
        }

        sseBuffer += decoder.decode(value, { stream: true });
        const parts = sseBuffer.split('\n');
        sseBuffer = parts.pop() || ''; // keep incomplete line in buffer

        for (const line of parts) {
          if (!line.trim()) continue;
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);

          if (data === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const event = JSON.parse(data);

            switch (event.type) {
              case 'text_delta': {
                accumulatedContent += event.content;
                const updated = [...messagesWithUser, {
                  ...agentMessage,
                  content: accumulatedContent,
                  agentToolCalls: [...toolCalls],
                  pendingOperations: [...pendingOperations],
                }];
                updateConversationMessages(activeConversationId, updated);
                break;
              }

              case 'tool_call': {
                const tc: AgentToolCallRecord = {
                  id: event.toolCallId,
                  name: event.toolName,
                  params: event.params || {},
                  status: 'executing',
                };
                toolCalls.push(tc);
                const updated = [...messagesWithUser, {
                  ...agentMessage,
                  content: accumulatedContent,
                  agentToolCalls: [...toolCalls],
                  pendingOperations: [...pendingOperations],
                }];
                updateConversationMessages(activeConversationId, updated);
                break;
              }

              case 'tool_result': {
                // Update tool call status
                const tcIdx = toolCalls.findIndex(tc => tc.id === event.toolCallId);
                if (tcIdx !== -1) {
                  const isError = event.result && typeof event.result === 'object' && (event.result as Record<string, unknown>).success === false;
                  toolCalls[tcIdx] = {
                    ...toolCalls[tcIdx],
                    status: isError ? 'error' : 'completed',
                    result: event.result,
                  };
                }

                // Apply operation to timeline if present
                if (event.operation) {
                  const op = event.operation as AgentTimelineOperation;
                  pendingOperations.push(op);

                  // For delete operations, trigger animation then brief delay for visual feedback
                  if (op.type === 'delete_clip') {
                    triggerClipAnimation(op);
                    // Brief non-blocking delay to let animation start, then proceed
                    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
                  }

                  applyAgentOperationToTimeline(op);

                  // For non-delete operations, animate after application
                  if (op.type !== 'delete_clip') {
                    triggerClipAnimation(op);
                  }
                }

                const updated = [...messagesWithUser, {
                  ...agentMessage,
                  content: accumulatedContent,
                  agentToolCalls: [...toolCalls],
                  pendingOperations: [...pendingOperations],
                }];
                updateConversationMessages(activeConversationId, updated);
                break;
              }

              case 'error': {
                accumulatedContent += `\n\nError: ${event.message}`;
                const updated = [...messagesWithUser, {
                  ...agentMessage,
                  content: accumulatedContent,
                  agentToolCalls: [...toolCalls],
                  pendingOperations: [...pendingOperations],
                  isStreaming: false,
                }];
                updateConversationMessages(activeConversationId, updated);
                break;
              }

              case 'agent_end': {
                // Will be handled after stream ends
                break;
              }
            }
          } catch (e) {
            console.error('[VideoEditingInterface] Error parsing agent SSE:', e, data);
          }
        }

        if (streamDone) break;
      }

      // 6. Finalize message (safety: always set isStreaming=false even on network drops)
      const finalMessages = [...messagesWithUser, {
        ...agentMessage,
        content: accumulatedContent,
        agentToolCalls: [...toolCalls],
        pendingOperations: [...pendingOperations],
        isStreaming: false,
      }];
      updateConversationMessages(activeConversationId, finalMessages);

      console.log('[VideoEditingInterface] Agent message completed', {
        contentLength: accumulatedContent.length,
        toolCallsCount: toolCalls.length,
        operationsCount: pendingOperations.length,
      });

    } catch (error) {
      console.error('[VideoEditingInterface] Agent message failed:', error);
      showError(`Agent error: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Safety: ensure any streaming agent message is finalized on error
      const convs = content?.conversations || [];
      const conv = convs.find(c => c.id === content?.activeConversationId);
      if (conv) {
        const hasStale = conv.messages.some(m => m.isAgentMessage && m.isStreaming);
        if (hasStale) {
          const cleaned = conv.messages.map(m =>
            m.isAgentMessage && m.isStreaming ? { ...m, isStreaming: false } : m
          );
          updateConversationMessages(content!.activeConversationId!, cleaned);
        }
      }
    } finally {
      setAgentIsExecuting(false);
    }
  }, [content, agentIsExecuting, currentTimelineState, materialManagement.materials, updateConversationMessages, showError, applyAgentOperationToTimeline, triggerClipAnimation]);

  // --- Unified send handler: routes to agent or regular based on agentMode ---
  const handleSendChatMessage = useCallback(async (message: string) => {
    if (agentMode) {
      return handleSendAgentMessage(message);
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
      
      // 准备工作流配置（仅启用的工作流）
      const enabledWorkflowConfigs = Array.from(workflowConfigs.values())
        .filter(config => config.enabled)
        .map(config => ({
          workflowId: config.workflowId,
          workflowName: config.workflowName,
          enabled: config.enabled,
          toolDescription: config.toolDescription
        }));
      
      // 如果有启用的工作流，创建意图检测状态消息
      let intentDetectionMessageId: string | null = null;
      if (enabledWorkflowConfigs.length > 0) {
        intentDetectionMessageId = `msg-${Date.now()}-intent-detection`;
        const intentDetectionMessage: ChatMessage = {
          id: intentDetectionMessageId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
          metadata: {
            type: 'intent_detection',
            status: 'analyzing'
          }
        };
        
        const messagesWithIntent = [...messagesWithUser, intentDetectionMessage];
        updateConversationMessages(activeConversationId, messagesWithIntent);
        
        console.log('[VideoEditingInterface] 显示意图检测状态', {
          enabledWorkflowsCount: enabledWorkflowConfigs.length,
          timestamp: new Date().toISOString()
        });
      }

      // 创建助手消息占位符（只在可能有普通回复时创建）
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
        enabledWorkflowsCount: enabledWorkflowConfigs.length,
        timestamp: new Date().toISOString()
      });
      
      const response = await fetch('/api/video-editing-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: taskId,
          messages: messagesWithUser,
          workflowConfigs: enabledWorkflowConfigs,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';
      let workflowIntention: any = null;
      let shouldCallWorkflow = false;
      let streamComplete = false; // 标记流是否完成
      
      console.log('[VideoEditingInterface] 开始处理流式响应', {
        taskId,
        timestamp: new Date().toISOString()
      });
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[VideoEditingInterface] 流读取完成（reader.done）', {
            taskId,
            streamComplete,
            timestamp: new Date().toISOString()
          });
          break;
        }

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        console.log('[VideoEditingInterface] 收到数据块', {
          taskId,
          linesCount: lines.length,
          timestamp: new Date().toISOString()
        });
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log('[VideoEditingInterface] 收到[DONE]信号，准备结束流处理', {
                taskId,
                workflowIntention: workflowIntention ? {
                  shouldCallWorkflow: workflowIntention.should_call_workflow,
                  workflowName: workflowIntention.workflow_name
                } : null,
                timestamp: new Date().toISOString()
              });
              streamComplete = true;
              break; // 跳出for循环
            }
            
            try {
              const parsed = JSON.parse(data);
              
              // 处理工作流意图信息
              if (parsed.type === 'workflow_intention' && parsed.intention) {
                workflowIntention = parsed.intention;
                shouldCallWorkflow = workflowIntention.should_call_workflow;
                console.log('[VideoEditingInterface] 收到工作流意图', {
                  taskId,
                  intention: workflowIntention,
                  shouldCallWorkflow,
                  timestamp: new Date().toISOString()
                });
                
                // 移除意图检测消息，添加意图结果消息
                if (intentDetectionMessageId) {
                  const intentResultMessage: ChatMessage = {
                    id: `msg-${Date.now()}-intent-result`,
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isStreaming: false,
                    metadata: {
                      type: 'intent_result',
                      intention: workflowIntention
                    }
                  };
                  
                  // 如果需要调用工作流，不添加助手消息占位符
                  const updatedMessages = shouldCallWorkflow
                    ? [...messagesWithUser, intentResultMessage]
                    : [...messagesWithUser, intentResultMessage, { ...assistantMessage, content: '', isStreaming: true }];
                  
                  updateConversationMessages(activeConversationId, updatedMessages);
                  
                  console.log('[VideoEditingInterface] 已更新消息列表（添加意图结果）', {
                    taskId,
                    messagesCount: updatedMessages.length,
                    shouldCallWorkflow,
                    timestamp: new Date().toISOString()
                  });
                }
              }
              // 处理普通聊天内容（只在不调用工作流时处理）
              else if (parsed.content && !shouldCallWorkflow) {
                accumulatedContent += parsed.content;
                
                // 更新助手消息
                const currentMessages = intentDetectionMessageId && workflowIntention
                  ? [
                      ...messagesWithUser,
                      {
                        id: `msg-${Date.now()}-intent-result`,
                        role: 'assistant' as const,
                        content: '',
                        timestamp: new Date(),
                        isStreaming: false,
                        metadata: { type: 'intent_result' as const, intention: workflowIntention }
                      }
                    ]
                  : messagesWithUser;
                
                const updatedMessages = [
                  ...currentMessages,
                  {
                    ...assistantMessage,
                    content: accumulatedContent,
                    isStreaming: true
                  }
                ];
                
                updateConversationMessages(activeConversationId, updatedMessages);
              }
            } catch (e) {
              console.error('[VideoEditingInterface] 解析SSE数据错误:', {
                taskId,
                error: e,
                data,
                timestamp: new Date().toISOString()
              });
            }
          }
        }
        
        // 如果收到[DONE]信号，跳出while循环
        if (streamComplete) {
          console.log('[VideoEditingInterface] 流处理完成，退出while循环', {
            taskId,
            timestamp: new Date().toISOString()
          });
          break;
        }
      }
      
      console.log('[VideoEditingInterface] 流处理结束，准备后续操作', {
        taskId,
        hasWorkflowIntention: !!workflowIntention,
        shouldCallWorkflow,
        accumulatedContentLength: accumulatedContent.length,
        timestamp: new Date().toISOString()
      });

      // 检查是否需要执行工作流
      if (workflowIntention && workflowIntention.should_call_workflow) {
        console.log('[VideoEditingInterface] 需要执行工作流:', {
          workflowName: workflowIntention.workflow_name,
          confidence: workflowIntention.confidence,
          reasoning: workflowIntention.reasoning
        });
        
        // 查找对应的工作流配置
        const targetWorkflow = Array.from(workflowConfigs.values()).find(
          config => config.workflowName === workflowIntention.workflow_name && config.enabled
        );
        
        if (targetWorkflow && targetWorkflow.nodes && targetWorkflow.connections) {
          console.log('[VideoEditingInterface] 找到工作流配置，开始执行', {
            workflowId: targetWorkflow.workflowId,
            nodesCount: targetWorkflow.nodes.length,
            connectionsCount: targetWorkflow.connections.length
          });
          
          // 创建工作流执行状态
          let workflowExecutionState: WorkflowExecutionState = {
            isRunning: true,
            currentNodeId: null,
            nodeStates: {},
            logs: [],
            startTime: new Date()
          };
          
          // 移除普通助手消息，创建工作流执行消息
          const workflowExecutionMessageId = `msg-${Date.now()}-workflow-execution`;
          const workflowExecutionMessage: ChatMessage = {
            id: workflowExecutionMessageId,
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            isStreaming: true,
            workflowExecution: {
              workflowId: targetWorkflow.workflowId,
              workflowName: targetWorkflow.workflowName,
              executionState: workflowExecutionState
            }
          };
          
          // 更新消息列表，显示工作流执行状态
          const messagesWithWorkflowExecution = [
            ...messagesWithUser,
            {
              id: `msg-${Date.now()}-intent-result`,
              role: 'assistant' as const,
              content: '',
              timestamp: new Date(),
              isStreaming: false,
              metadata: { type: 'intent_result' as const, intention: workflowIntention }
            },
            workflowExecutionMessage
          ];
          updateConversationMessages(activeConversationId, messagesWithWorkflowExecution);
          
          // 创建工作流执行器并执行
          let finalResult = '';
          const executor = new WorkflowExecutor(
            targetWorkflow.nodes,
            targetWorkflow.connections,
            (newState: WorkflowExecutionState) => {
              console.log('[VideoEditingInterface] 工作流执行状态更新:', {
                isRunning: newState.isRunning,
                currentNodeId: newState.currentNodeId,
                logsCount: newState.logs.length
              });
              
              // 更新工作流执行状态
              workflowExecutionState = { ...newState };
              
              // 提取最终结果
              if (!newState.isRunning && newState.endTime) {
                const finalResultLog = newState.logs.find(
                  log => log.level === 'success' && log.message.includes('Workflow execution completed')
                );
                
                const finalOutput = finalResultLog?.details?.output;
                
                if (finalOutput) {
                  if (typeof finalOutput === 'string') {
                    finalResult = finalOutput;
                  } else if (finalOutput.finalResult) {
                    const result = finalOutput.finalResult;
                    if (typeof result === 'string') {
                      finalResult = result;
                    } else if (result?.text) {
                      finalResult = result.text;
                    } else if (result?.llmResponse) {
                      finalResult = result.llmResponse;
                    } else {
                      finalResult = JSON.stringify(result, null, 2);
                    }
                  } else if (finalOutput.text) {
                    finalResult = finalOutput.text;
                  } else if (finalOutput.llmResponse) {
                    finalResult = finalOutput.llmResponse;
                  } else {
                    finalResult = JSON.stringify(finalOutput, null, 2);
                  }
                }
              }
              
              // 更新消息以显示最新的执行状态
              const updatedWorkflowMessage: ChatMessage = {
                ...workflowExecutionMessage,
                content: finalResult,
                isStreaming: newState.isRunning,
                workflowExecution: {
                  workflowId: targetWorkflow.workflowId,
                  workflowName: targetWorkflow.workflowName,
                  executionState: { ...newState }
                }
              };
              
              const updatedMessages = [
                ...messagesWithUser,
                {
                  id: `msg-${Date.now()}-intent-result`,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: new Date(),
                  isStreaming: false,
                  metadata: { type: 'intent_result' as const, intention: workflowIntention }
                },
                updatedWorkflowMessage
              ];
              
              updateConversationMessages(activeConversationId, updatedMessages);
            },
            message // 传递用户输入
          );
          
          // 执行工作流
          try {
            console.log('[VideoEditingInterface] 开始执行工作流');
            await executor.execute();
            console.log('[VideoEditingInterface] 工作流执行完成', {
              finalResultLength: finalResult.length
            });
          } catch (error) {
            console.error('[VideoEditingInterface] 工作流执行失败:', error);
            finalResult = `Error: ${error instanceof Error ? error.message : '未知错误'}`;
            
            // 更新消息以显示错误
            const errorMessage: ChatMessage = {
              ...workflowExecutionMessage,
              content: finalResult,
              isStreaming: false,
              workflowExecution: {
                workflowId: targetWorkflow.workflowId,
                workflowName: targetWorkflow.workflowName,
                executionState: {
                  ...workflowExecutionState,
                  isRunning: false,
                  endTime: new Date()
                }
              }
            };
            
            const errorMessages = [
              ...messagesWithUser,
              {
                id: `msg-${Date.now()}-intent-result`,
                role: 'assistant' as const,
                content: '',
                timestamp: new Date(),
                isStreaming: false,
                metadata: { type: 'intent_result' as const, intention: workflowIntention }
              },
              errorMessage
            ];
            
            updateConversationMessages(activeConversationId, errorMessages);
          }
        } else {
          console.warn('[VideoEditingInterface] 未找到工作流配置或缺少节点/连接信息:', {
            workflowName: workflowIntention.workflow_name,
            hasWorkflow: !!targetWorkflow,
            hasNodes: targetWorkflow?.nodes ? true : false,
            hasConnections: targetWorkflow?.connections ? true : false
          });
          
          // 如果找不到工作流，仍然使用普通LLM响应
          const finalMessages = [
            ...messagesWithUser,
            {
              id: `msg-${Date.now()}-intent-result`,
              role: 'assistant' as const,
              content: '',
              timestamp: new Date(),
              isStreaming: false,
              metadata: { type: 'intent_result' as const, intention: workflowIntention }
            },
            {
              ...assistantMessage,
              content: accumulatedContent,
              isStreaming: false
            }
          ];
          updateConversationMessages(activeConversationId, finalMessages);
        }
      } else {
        // 不需要执行工作流，使用普通LLM响应
        const finalCurrentMessages = workflowIntention
          ? [
              ...messagesWithUser,
              {
                id: `msg-${Date.now()}-intent-result`,
                role: 'assistant' as const,
                content: '',
                timestamp: new Date(),
                isStreaming: false,
                metadata: { type: 'intent_result' as const, intention: workflowIntention }
              }
            ]
          : messagesWithUser;
        
        const finalMessages = [
          ...finalCurrentMessages,
          {
            ...assistantMessage,
            content: accumulatedContent,
            isStreaming: false
          }
        ];
        
        console.log(`[VideoEditingInterface] 聊天消息接收完成（无需工作流）`, {
          finalContentLength: accumulatedContent.length,
          hasWorkflowIntention: !!workflowIntention
        });
        updateConversationMessages(activeConversationId, finalMessages);
      }
      
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
  }, [content, onUpdateContent, isChatLoading, updateConversationMessages, taskId, showError, workflowConfigs, agentMode, handleSendAgentMessage]);

  // 获取当前活动的聊天对话
  const activeConversation = content?.conversations?.find(
    conv => conv.id === content?.activeConversationId
  );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* 左侧区域 - AI Chat 面板贯穿上下，占20%宽度 */}
      <div className="video-editing-left-sidebar flex flex-col border-r border-border bg-card">
        <VideoChatWindow
          conversation={activeConversation}
          onSendMessage={handleSendChatMessage}
          onClearMessages={handleClearChatMessages}
          isLoading={isChatLoading}
          onCreativeBrainstormingClick={handleCreativeBrainstormingClick}
          onPolishClick={handlePolishClick}
          onViewWorkflowsClick={handleViewWorkflowsClick}
          onConvertMessageToScript={handleConvertMessageToScript}
          agentMode={agentMode}
          onAgentModeChange={setAgentMode}
          agentIsExecuting={agentIsExecuting}
          onAgentUndo={handleAgentUndo}
        />
      </div>

      {/* 右侧区域 - 占80%宽度，包含上方面板和下方Timeline */}
      <div className="video-editing-right-area flex flex-col min-h-0 overflow-hidden">
        {/* 上方面板区域 */}
        <div className="video-editing-upper-panels flex min-h-0 overflow-hidden">
          {/* Text Script 面板 */}
          <div className="video-editing-script-panel bg-muted border-r border-border">
            <ScriptPanel
              segments={content?.scriptSegments || getMockScriptSegments(locale)}
              className="h-full"
              onGenerateScript={handleScriptGenerationClick}
              isGenerating={scriptGeneration.isGeneratingScript}
              onUpdateSegments={scriptGeneration.handleUpdateSegments}
              onAddMaterial={(material) => materialManagement.addOrReplaceMaterial(material)}
              taskId={taskId}
              materials={materialManagement.materials}
              getVideoAnalysisResult={videoAnalysis.getAnalysisResult}
              aiVideoScriptSegments={content?.aiVideoScriptSegments || []}
              onUpdateAIVideoScriptSegments={handleUpdateAIVideoScriptSegments}
              onGenerateAIVideoScript={handleAIVideoScriptGenerationClick}
              isGeneratingAIVideoScript={isGeneratingAIVideoScript}
            />
          </div>

          {/* Materials Management 面板 */}
          <MaterialsPanel
            {...materialManagement}
            onSearchVideos={videoSearch.openSearchModal}
            onSearchAudios={audioSearch.openSearchModal}
            onSearchImages={imageSearch.openSearchModal}
            onAIMixedEditing={handleAIMixedEditing}
            onAutoMixAudio={handleAutoMixAudio}
            onVideoAnalysis={handleVideoAnalysis}
            onBatchVideoAnalysis={handleBatchVideoAnalysis}
            getVideoAnalysisStatus={videoAnalysis.getAnalysisStatus}
            onRetryDownload={videoSearch.retryVideoDownload}
            onAddToTimeline={handleAddMaterialToTimeline}
            onCutMaterial={handleCutMaterial}
            onWatermarkRemoval={handleWatermarkRemoval}
            taskId={taskId}
            className="video-editing-materials-panel bg-card border-r border-border"
          />

          {/* Play Preview 面板 */}
          <div className="video-editing-player-panel bg-card">
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
              materials={materialManagement.materials}
              onImagePositionChange={handleImagePositionChange}
            />
          </div>
        </div>

        {/* 下方时间轴面板 - 在右侧区域的下方，全宽度 */}
        <div className="video-editing-timeline-section border-t border-border bg-muted relative">
          {agentIsExecuting && (
            <div className="agent-timeline-lock-overlay" />
          )}
          <TimelinePanel
            className="h-full"
            onTimelineStateChange={handleTimelineStateChange}
            externalCurrentTime={timelineCurrentTime}
            onCurrentTimeChange={handleTimelineTimeChange}
            materials={materialManagement.materials}
            onTimelineCompositionChange={timelineComposition.handleTimelineStateChange}
            materialsToAdd={materialsToAddToTimeline}
            taskId={taskId}
            onImportComplete={handleImportComplete}
            externalTimelineState={currentTimelineState || undefined}
            externalTimelineUpdateId={externalTimelineUpdateId || undefined}
          />
        </div>
      </div>

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

      {/* 转换视频脚本弹窗 */}
      <ConvertToScriptModal
        isOpen={convertToScript.isModalOpen}
        onClose={convertToScript.closeModal}
        materials={materialManagement.materials}
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

      {/* AI混剪模式选择弹窗 */}
      <AIMixingModeSelectionModal
        isOpen={isAIMixingModeModalOpen}
        onClose={handleAIMixingModeClose}
        onConfirm={handleAIMixingModeConfirm}
      />

      {/* 批量解析模式选择弹窗 */}
      <BatchAnalysisModeSelectionModal
        isOpen={isBatchAnalysisModalOpen}
        onClose={() => setIsBatchAnalysisModalOpen(false)}
        onConfirm={handleBatchAnalysisConfirm}
      />

      {/* AI混剪进度弹窗 */}
      <AIMixingProgressModal
        isOpen={isAIMixing}
        progress={aiMixingProgress}
        allowCancel={false}
      />

      {/* 视频剪切弹窗 */}
      <VideoCutModal
        isOpen={videoCutModal.isOpen}
        material={videoCutModal.material}
        onClose={handleCloseCutModal}
        onExportClips={handleExportClips}
        taskId={taskId}
      />

      {/* 工作流配置弹窗 */}
      <WorkflowConfigModal
        isOpen={isWorkflowConfigModalOpen}
        onClose={handleWorkflowConfigClose}
        taskId={taskId}
        onSave={handleWorkflowConfigSave}
      />

      {/* Mobile Warning Dialog - Backup Safety Check (Legacy) */}
      {/* Note: Global mobile detection is now handled at app level, this is kept as fallback */}
    </div>
  );
};

export default VideoEditingInterface; 