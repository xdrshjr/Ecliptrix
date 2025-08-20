'use client';

import React, { useState, useCallback } from 'react';
import { VideoEditingTaskContent, ScriptGenerationConfig, TimelineState, MaterialItem } from '@/types';
import ScriptPanel from './ScriptPanel';
import { TimelinePanel } from './timeline';
import '../../styles/video-editing.css';
import { 
  useDocumentState,
  useVideoPlayback,
  useAIAssistant,
  useScriptGeneration,
  useMaterialManagement,
  useVideoSearch,
  useAudioSearch,
  useTimelineComposition,
  useVideoAnalysis
} from './hooks';
import { mockScriptSegments, mockVideoPreview } from './data';
import {
  DocumentPanel,
  AIAssistantPanel,
  MaterialsPanel,
  VideoPlayerPanel,
  VideoSearchModal,
  AudioSearchModal,
  ContentPolishModal,
  ScriptGenerationModal,
  CreativeBrainstormingModal,
  VideoAnalysisModal
} from './components';

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
  // 新增：时间同步状态管理
  const [timelineCurrentTime, setTimelineCurrentTime] = useState<number>(0);
  // 新增：管理时间轴状态，用于导出功能
  const [currentTimelineState, setCurrentTimelineState] = useState<TimelineState | null>(null);
  
  // 智能润色弹窗状态
  const [isPolishModalOpen, setIsPolishModalOpen] = useState<boolean>(false);
  
  // 脚本生成弹窗状态
  const [isScriptGenerationModalOpen, setIsScriptGenerationModalOpen] = useState<boolean>(false);
  
  // 创意构思弹窗状态
  const [isCreativeBrainstormingModalOpen, setIsCreativeBrainstormingModalOpen] = useState<boolean>(false);
  
  // 新增：程序化添加素材到时间轴的状态
  const [materialsToAddToTimeline, setMaterialsToAddToTimeline] = useState<{ 
    materials: MaterialItem[], 
    targetTrackId?: string, 
    timestamp: number 
  } | undefined>(undefined);
  
  // 处理从视频播放器到timeline的时间同步
  const handleVideoTimeUpdate = useCallback((currentTime: number) => {
    console.log(`[VideoEditingInterface] 视频时间更新同步到timeline`, {
      currentTime: currentTime.toFixed(2),
      previousTimelineTime: timelineCurrentTime.toFixed(2),
      timestamp: new Date().toISOString()
    });
    setTimelineCurrentTime(currentTime);
  }, [timelineCurrentTime]);

  // 使用自定义钩子管理各个功能域的状态
  const documentState = useDocumentState(content, onUpdateContent, taskId);
  const videoPlayback = useVideoPlayback(taskId, handleVideoTimeUpdate, timelineCurrentTime);
  const aiAssistant = useAIAssistant(taskId, documentState.markdownValue, documentState.handleMarkdownChange);
  const scriptGeneration = useScriptGeneration(taskId, documentState.markdownValue, onUpdateContent);
  const materialManagement = useMaterialManagement(taskId);
  const videoSearch = useVideoSearch(taskId, materialManagement.addMaterials);
  const audioSearch = useAudioSearch(taskId, materialManagement.addMaterials);
  
  // 添加时间轴组合播放功能
  const timelineComposition = useTimelineComposition(taskId, materialManagement.materials);
  
  // 添加视频解析功能
  const videoAnalysis = useVideoAnalysis(taskId);

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
        availableMaterials: materialManagement.materials.map(m => ({
          id: m.id,
          name: m.name,
          type: m.type,
          hasSegmentId: !!m.metadata?.segment_id,
          hasSegmentNumber: typeof m.metadata?.segment_number === 'number'
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
          targetTrackId: 'video-track-1', // 指定添加到第一个视频轨道
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
      {/* 视频编辑工作区 - 左右布局 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧面板 - MD编辑器和AI助手 */}
        <div className="video-editing-left-panel flex flex-col">
          <DocumentPanel
            markdownValue={documentState.markdownValue}
            handleMarkdownChange={documentState.handleMarkdownChange}
            taskId={taskId}
            onCreativeBrainstormingClick={handleCreativeBrainstormingClick}
          />
          
          <AIAssistantPanel
            {...aiAssistant}
            taskId={taskId}
            onPolishClick={handlePolishClick}
            onGenerateScriptClick={handleScriptGenerationClick}
            onClearContent={documentState.clearContent}
            isGeneratingScript={scriptGeneration.isGeneratingScript}
          />
        </div>

        {/* 右侧面板 - Video Preview 区域，内部分为左右布局 */}
        <div className="video-editing-right-panel flex bg-white border-l border-gray-200">
          {/* 脚本面板 - 占右侧面板的20%宽度 */}
          <div className="video-editing-script-panel bg-gray-50 border-r border-gray-200">
            <ScriptPanel 
              segments={content?.scriptSegments || mockScriptSegments} 
              className="h-full"
              onGenerateScript={scriptGeneration.handleGenerateScript}
              isGenerating={scriptGeneration.isGeneratingScript}
              onUpdateSegments={scriptGeneration.handleUpdateSegments}
              onAddMaterial={(material) => materialManagement.addMaterials([material])}
              taskId={taskId}
              materials={materialManagement.materials}
            />
          </div>
          
          {/* 视频预览区域 - 占右侧面板的80%宽度，新的上下分割布局 */}
          <div className="video-editing-preview-panel flex flex-col">
            {/* 上方容器 - 70%高度，左右分割 */}
            <div className="video-editing-preview-upper flex">
              <MaterialsPanel
                {...materialManagement}
                onSearchVideos={videoSearch.openSearchModal}
                onSearchAudios={audioSearch.openSearchModal}
                onAutoMixAudio={handleAutoMixAudio}
                onVideoAnalysis={handleVideoAnalysis}
                getVideoAnalysisStatus={videoAnalysis.getAnalysisStatus}
                taskId={taskId}
              />

              <VideoPlayerPanel
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
              />
            </div>

            {/* 下方容器 - 30%高度 */}
            <div className="video-editing-preview-lower border-t border-gray-200">
              <TimelinePanel 
                className="h-full" 
                onTimelineStateChange={handleTimelineStateChange}
                externalCurrentTime={timelineCurrentTime}
                onCurrentTimeChange={handleTimelineTimeChange}
                materials={materialManagement.materials}
                onTimelineCompositionChange={timelineComposition.handleTimelineStateChange}
                materialsToAdd={materialsToAddToTimeline}
              />
            </div>
          </div>
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
    </div>
  );
};

export default VideoEditingInterface; 