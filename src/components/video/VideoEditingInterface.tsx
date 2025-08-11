'use client';

import React, { useState, useCallback } from 'react';
import { VideoEditingTaskContent, ScriptGenerationConfig, TimelineState } from '@/types';
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
  useTimelineComposition
} from './hooks';
import { mockScriptSegments, mockVideoPreview } from './data';
import {
  DocumentPanel,
  AIAssistantPanel,
  MaterialsPanel,
  VideoPlayerPanel,
  VideoSearchModal,
  ContentPolishModal,
  ScriptGenerationModal
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
  
  // 添加时间轴组合播放功能
  const timelineComposition = useTimelineComposition(taskId, materialManagement.materials);

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
            />
          </div>
          
          {/* 视频预览区域 - 占右侧面板的80%宽度，新的上下分割布局 */}
          <div className="video-editing-preview-panel flex flex-col">
            {/* 上方容器 - 70%高度，左右分割 */}
            <div className="video-editing-preview-upper flex">
              <MaterialsPanel
                {...materialManagement}
                onSearchVideos={videoSearch.openSearchModal}
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
              />
            </div>
          </div>
        </div>
      </div>

      <VideoSearchModal
        {...videoSearch}
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
    </div>
  );
};

export default VideoEditingInterface; 