'use client';

import React from 'react';
import { VideoEditingTaskContent } from '@/types';
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
  VideoSearchModal
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
  // 使用自定义钩子管理各个功能域的状态
  const documentState = useDocumentState(content, onUpdateContent, taskId);
  const videoPlayback = useVideoPlayback(taskId);
  const aiAssistant = useAIAssistant(taskId, documentState.markdownValue, documentState.handleMarkdownChange);
  const scriptGeneration = useScriptGeneration(taskId, documentState.markdownValue, onUpdateContent);
  const materialManagement = useMaterialManagement(taskId);
  const videoSearch = useVideoSearch(taskId, materialManagement.addMaterials);
  
  // 添加时间轴组合播放功能
  const timelineComposition = useTimelineComposition(taskId, materialManagement.materials);

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
              />
            </div>

            {/* 下方容器 - 30%高度 */}
            <div className="video-editing-preview-lower border-t border-gray-200">
              <TimelinePanel 
                className="h-full" 
                onTimelineStateChange={timelineComposition.handleTimelineStateChange}
              />
            </div>
          </div>
        </div>
      </div>

      <VideoSearchModal
        {...videoSearch}
        taskId={taskId}
      />
    </div>
  );
};

export default VideoEditingInterface; 