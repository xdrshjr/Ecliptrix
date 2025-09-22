'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { VideoEditingTaskContent, ScriptGenerationConfig, TimelineState, MaterialItem, ImagePosition } from '@/types';
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
  useVideoAnalysis,
  useAIImageGeneration,
  useAIVideoGeneration,
  useDigitalHumanGeneration,
  useComfyUIHealth,
  useAICreation
} from './hooks';
import { getMockScriptSegments, mockVideoPreview } from './data';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { analyzeVideosInParallel, VIDEO_ANALYSIS_CONFIG } from './utils/parallelVideoAnalysis';
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
  AIImageGenerationModal,
  AIVideoGenerationModal,
  DigitalHumanGenerationModal,
  AICreationModal,
  AIMixingProgressModal,
  AIMixingModeSelectionModal
} from './components';
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
  
  // Mobile device detection and warning state
  const [showMobileWarning, setShowMobileWarning] = useState(false);
  const [currentDeviceType, setCurrentDeviceType] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');
  
  // 新增：时间同步状态管理
  const [timelineCurrentTime, setTimelineCurrentTime] = useState<number>(0);
  // 新增：管理时间轴状态，用于导出功能
  const [currentTimelineState, setCurrentTimelineState] = useState<TimelineState | null>(null);
  // 新增：外部时间轴状态更新标识，用于避免循环更新
  const [externalTimelineUpdateId, setExternalTimelineUpdateId] = useState<string | null>(null);
  // 新增：批量视频解析状态
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState<boolean>(false);
  
  // 智能润色弹窗状态
  const [isPolishModalOpen, setIsPolishModalOpen] = useState<boolean>(false);
  
    // 脚本生成弹窗状态
  const [isScriptGenerationModalOpen, setIsScriptGenerationModalOpen] = useState<boolean>(false);

  // 脚本生成开始时间状态
  const [scriptGenerationStartTime, setScriptGenerationStartTime] = useState<number | null>(null);

  // 创意构思弹窗状态
  const [isCreativeBrainstormingModalOpen, setIsCreativeBrainstormingModalOpen] = useState<boolean>(false);
  
  // AI混剪进度状态
  const [isAIMixing, setIsAIMixing] = useState<boolean>(false);
  const [aiMixingProgress, setAIMixingProgress] = useState<number>(0);
  
  // AI混剪模式选择弹窗状态
  const [isAIMixingModeModalOpen, setIsAIMixingModeModalOpen] = useState<boolean>(false);
  
  // 新增：程序化添加素材到时间轴的状态
  const [materialsToAddToTimeline, setMaterialsToAddToTimeline] = useState<{ 
    materials: MaterialItem[], 
    targetTrackId?: string, 
    timestamp: number 
  } | undefined>(undefined);

  // 视频剪切弹窗状态
  const [videoCutModal, setVideoCutModal] = useState<{
    isOpen: boolean;
    material: MaterialItem | null;
  }>({
    isOpen: false,
    material: null
  });

  // 新增：VideoPlayerPanel的ref，用于调用其内部的组合跳转方法
  const videoPlayerRef = useRef<VideoPlayerPanelRef>(null);

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
  const scriptGeneration = useScriptGeneration(taskId, documentState.markdownValue, onUpdateContent);
  const materialManagement = useMaterialManagement(taskId);

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
  
  // 添加视频解析功能
  const videoAnalysis = useVideoAnalysis(taskId);
  
  // 添加AI生图功能
  const aiImageGeneration = useAIImageGeneration(taskId, materialManagement.addMaterials);
  const aiVideoGeneration = useAIVideoGeneration(taskId, materialManagement.addMaterials);
  const digitalHumanGeneration = useDigitalHumanGeneration(taskId, materialManagement.addMaterials);
  
  // 添加ComfyUI健康检查功能
  const comfyuiHealth = useComfyUIHealth(taskId, true);
  
  // 添加AI创作功能
  const aiCreation = useAICreation(taskId);

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
    console.log(`[VideoEditingInterface] 用户点击生成脚本按钮`, {
      taskId,
      currentContentLength: documentState.markdownValue.length,
      timestamp: new Date().toISOString()
    });
    setIsScriptGenerationModalOpen(true);
  }, [taskId, documentState.markdownValue.length]);

  const handleScriptGenerationClose = useCallback(() => {
    console.log(`[VideoEditingInterface] 关闭脚本生成配置弹窗`, {
      taskId,
      timestamp: new Date().toISOString()
    });
    setIsScriptGenerationModalOpen(false);
  }, [taskId]);

  const handleScriptGenerate = useCallback((config: ScriptGenerationConfig) => {
    console.log(`[VideoEditingInterface] 开始生成脚本`, {
      taskId,
      config,
      contentLength: documentState.markdownValue.length,
      timestamp: new Date().toISOString()
    });
    
    // 关闭弹窗
    setIsScriptGenerationModalOpen(false);
    
    // 调用脚本生成服务，传入配置
    scriptGeneration.handleGenerateScriptWithConfig(config);
  }, [taskId, documentState.markdownValue.length, scriptGeneration]);

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
  const handleVideoAnalysis = useCallback(async (material: MaterialItem) => {
    console.log(`[VideoEditingInterface] 开始视频AI解析`, {
      taskId,
      materialId: material.id,
      materialName: material.name,
      videoUrl: material.url,
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
        videoAnalysis.openAnalysisModal(material.url);
      } else if (currentStatus === 'idle') {
        // 开始新的解析
        await videoAnalysis.analyzeVideo(material.url, 5); // 默认5秒间隔
      }
    } catch (error) {
      console.error(`[VideoEditingInterface] 视频解析失败`, {
        taskId,
        materialId: material.id,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  }, [taskId, videoAnalysis]);

  // 处理批量视频AI解析
  const handleBatchVideoAnalysis = useCallback(async () => {
    if (isBatchAnalyzing) {
      console.warn(`[VideoEditingInterface] 批量解析已在进行中，忽略重复请求`, { taskId });
      return;
    }

    setIsBatchAnalyzing(true);
    
    try {
      console.log(`[VideoEditingInterface] 开始批量视频AI解析`, {
        taskId,
        totalMaterialsCount: materialManagement.materials.length,
        concurrentLimit: 3,
        timestamp: new Date().toISOString()
      });

      // 筛选所有视频素材
      const videoMaterials = materialManagement.materials.filter(material => {
        return material.type === 'video' && material.url;
      });

      console.log(`[VideoEditingInterface] 筛选出视频素材`, {
        totalMaterials: materialManagement.materials.length,
        videoMaterialsCount: videoMaterials.length,
        videoMaterials: videoMaterials.map(m => ({
          id: m.id,
          name: m.name,
          url: m.url,
          currentStatus: videoAnalysis.getAnalysisStatus(m.url!)
        }))
      });

      if (videoMaterials.length === 0) {
        console.warn(`[VideoEditingInterface] 没有找到可解析的视频素材`, {
          taskId,
          totalMaterials: materialManagement.materials.length
        });
        return;
      }

      // 筛选需要解析的视频（跳过已完成或正在解析的）
      const videosToAnalyze = videoMaterials.filter(material => {
        const currentStatus = videoAnalysis.getAnalysisStatus(material.url!);
        return currentStatus === 'idle' || currentStatus === 'error';
      });

      console.log(`[VideoEditingInterface] 需要解析的视频`, {
        totalVideos: videoMaterials.length,
        videosToAnalyze: videosToAnalyze.length,
        skippedVideos: videoMaterials.length - videosToAnalyze.length
      });

      if (videosToAnalyze.length === 0) {
        console.log(`[VideoEditingInterface] 所有视频都已完成解析或正在解析中`, { taskId });
        return;
      }

      // 3个视频并发处理
      const concurrentLimit = 3;
      let successCount = 0;
      let errorCount = 0;
      const errors: Array<{materialId: string, materialName: string, error: string}> = [];

      // 分批处理，每批最多3个视频
      for (let i = 0; i < videosToAnalyze.length; i += concurrentLimit) {
        const batch = videosToAnalyze.slice(i, i + concurrentLimit);
        const batchNumber = Math.floor(i / concurrentLimit) + 1;
        const totalBatches = Math.ceil(videosToAnalyze.length / concurrentLimit);

        console.log(`[VideoEditingInterface] 开始处理第${batchNumber}批视频 (${batch.length}个视频)`, {
          taskId,
          batchNumber,
          totalBatches,
          batchVideos: batch.map(m => ({
            id: m.id,
            name: m.name,
            url: m.url
          }))
        });

        // 并发处理当前批次的视频
        const batchPromises = batch.map(async (material) => {
          try {
            console.log(`[VideoEditingInterface] 开始解析视频`, {
              taskId,
              materialId: material.id,
              materialName: material.name,
              videoUrl: material.url,
              batchNumber
            });

            await videoAnalysis.analyzeVideo(material.url!, 5); // 默认5秒间隔
            
            console.log(`[VideoEditingInterface] 视频解析完成`, {
              taskId,
              materialId: material.id,
              materialName: material.name,
              batchNumber
            });

            return { success: true, material };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            console.error(`[VideoEditingInterface] 视频解析失败`, {
              taskId,
              materialId: material.id,
              materialName: material.name,
              error: errorMessage,
              batchNumber
            });

            return { 
              success: false, 
              material, 
              error: errorMessage 
            };
          }
        });

        // 等待当前批次完成
        const batchResults = await Promise.all(batchPromises);
        
        // 统计结果
        batchResults.forEach(result => {
          if (result.success) {
            successCount++;
          } else {
            errorCount++;
            errors.push({
              materialId: result.material.id,
              materialName: result.material.name,
              error: result.error || '未知错误'
            });
          }
        });

        console.log(`[VideoEditingInterface] 第${batchNumber}批处理完成`, {
          taskId,
          batchNumber,
          totalBatches,
          batchSuccessCount: batchResults.filter(r => r.success).length,
          batchErrorCount: batchResults.filter(r => !r.success).length,
          totalSuccessCount: successCount,
          totalErrorCount: errorCount
        });

        // 如果还有下一批，添加短暂延迟
        if (i + concurrentLimit < videosToAnalyze.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // 输出最终结果
      console.log(`[VideoEditingInterface] 批量视频解析完成`, {
        taskId,
        totalVideos: videosToAnalyze.length,
        successCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined,
        concurrentLimit,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error(`[VideoEditingInterface] 批量视频解析异常`, {
        taskId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    } finally {
      setIsBatchAnalyzing(false);
    }

  }, [taskId, materialManagement.materials, videoAnalysis, isBatchAnalyzing]);

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
        console.log(`[VideoEditingInterface] 开始并行视频分析阶段`, {
          taskId,
          videoCount: videoMaterials.length,
          mode: mode.type,
          frameInterval: mode.frameInterval,
          threadCount: VIDEO_ANALYSIS_CONFIG.DEFAULT_THREAD_COUNT,
          maxRetries: VIDEO_ANALYSIS_CONFIG.MAX_RETRY_ATTEMPTS,
          timestamp: new Date().toISOString()
        });

        try {
          // 使用并行分析工具进行视频分析
          const analysisResults = await analyzeVideosInParallel(
            videoMaterials,
            {
              threadCount: VIDEO_ANALYSIS_CONFIG.DEFAULT_THREAD_COUNT,
              maxRetries: VIDEO_ANALYSIS_CONFIG.MAX_RETRY_ATTEMPTS,
              retryDelayMs: VIDEO_ANALYSIS_CONFIG.RETRY_DELAY_MS,
              mode
            },
            taskId
          );

          const successfulAnalyses = analysisResults.filter(r => r.success);
          const failedAnalyses = analysisResults.filter(r => !r.success);

          console.log(`[VideoEditingInterface] 并行视频分析阶段完成`, {
            taskId,
            totalVideos: videoMaterials.length,
            successCount: successfulAnalyses.length,
            failedCount: failedAnalyses.length,
            successRate: `${Math.round((successfulAnalyses.length / videoMaterials.length) * 100)}%`,
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
          console.error(`[VideoEditingInterface] 并行视频分析阶段异常`, {
            taskId,
            error: error instanceof Error ? error.message : String(error),
            videoCount: videoMaterials.length,
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

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 视频编辑工作区 - 上下布局 */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* 上方面板区域 - 左右分割布局 */}
        <div className="video-editing-upper-section flex min-h-0 overflow-hidden">
          {/* 左侧区域 - 包含 Project Documentation 和 Text Script */}
          <div className="video-editing-left-section flex border-r border-gray-200">
            {/* Project Documentation 面板 */}
            <div className="video-editing-documentation-panel flex flex-col bg-white border-r border-gray-200">
              <DocumentPanel
                markdownValue={documentState.markdownValue}
                handleMarkdownChange={documentState.handleMarkdownChange}
                taskId={taskId}
                onCreativeBrainstormingClick={handleCreativeBrainstormingClick}
                onPolishClick={handlePolishClick}
                onGenerateScriptClick={handleScriptGenerationClick}
                isGeneratingScript={scriptGeneration.isGeneratingScript}
              />
              
              <AIAssistantPanel
                {...aiAssistant}
                taskId={taskId}
                onClearContent={documentState.clearContent}
              />
            </div>

            {/* Text Script 面板 */}
            <div className="video-editing-script-panel bg-gray-50">
              <ScriptPanel 
                segments={content?.scriptSegments || getMockScriptSegments(locale)} 
                className="h-full"
                onGenerateScript={scriptGeneration.handleGenerateScript}
                isGenerating={scriptGeneration.isGeneratingScript}
                onUpdateSegments={scriptGeneration.handleUpdateSegments}
                onAddMaterial={(material) => materialManagement.addOrReplaceMaterial(material)}
                taskId={taskId}
                materials={materialManagement.materials}
                getVideoAnalysisResult={videoAnalysis.getAnalysisResult}
              />
            </div>
          </div>

          {/* 右侧区域 - 包含 Materials Management 和 Play Preview */}
          <div className="video-editing-right-section flex">
            {/* Materials Management 面板 - 占满右侧区域的左侧 */}
            <MaterialsPanel
              {...materialManagement}
              onSearchVideos={videoSearch.openSearchModal}
              onSearchAudios={audioSearch.openSearchModal}
              onSearchImages={imageSearch.openSearchModal}
              onAICreation={aiCreation.openModal}
              onAIMixedEditing={handleAIMixedEditing}
              onAIImageGeneration={aiImageGeneration.openModal}
              onAIVideoGeneration={aiVideoGeneration.openModal}
              onDigitalHumanGeneration={digitalHumanGeneration.openModal}
              onAutoMixAudio={handleAutoMixAudio}
              onVideoAnalysis={handleVideoAnalysis}
              onBatchVideoAnalysis={handleBatchVideoAnalysis}
              isBatchAnalyzing={isBatchAnalyzing}
              getVideoAnalysisStatus={videoAnalysis.getAnalysisStatus}
              onRetryDownload={videoSearch.retryVideoDownload}
              onAddToTimeline={handleAddMaterialToTimeline}
              onCutMaterial={handleCutMaterial}
              taskId={taskId}
              comfyuiHealthStatus={comfyuiHealth}
              className="video-editing-materials-panel bg-white border-r border-gray-200"
            />

            {/* Play Preview 面板 - 占满右侧区域的右侧 */}
            <div className="video-editing-player-panel bg-white">
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
        </div>

        {/* 下方时间轴面板 - 全宽度 */}
        <div className="video-editing-timeline-section border-t border-gray-200 bg-gray-50">
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

      <ScriptGenerationProgressModal
        isOpen={scriptGeneration.isGeneratingScript}
        progress={scriptGeneration.generationProgress}
        startTime={scriptGenerationStartTime}
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

      <AIImageGenerationModal
        {...aiImageGeneration}
      />

      <AIVideoGenerationModal
        {...aiVideoGeneration}
      />

      <DigitalHumanGenerationModal
        {...digitalHumanGeneration}
      />


      <AICreationModal
        {...aiCreation}
        addMaterial={materialManagement.addOrReplaceMaterial}
      />

      {/* AI混剪模式选择弹窗 */}
      <AIMixingModeSelectionModal
        isOpen={isAIMixingModeModalOpen}
        onClose={handleAIMixingModeClose}
        onConfirm={handleAIMixingModeConfirm}
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

      {/* Mobile Warning Dialog - Backup Safety Check (Legacy) */}
      {/* Note: Global mobile detection is now handled at app level, this is kept as fallback */}
    </div>
  );
};

export default VideoEditingInterface; 