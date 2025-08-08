'use client';

import React from 'react';
import dynamic from 'next/dynamic';
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
  useVideoSearch
} from './hooks';
import { mockScriptSegments, mockVideoPreview } from './data';

// 动态导入MD编辑器以避免SSR问题
const MDEditor = dynamic(
  () => import('@uiw/react-md-editor').then((mod) => mod.default),
  { ssr: false }
);

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

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 视频编辑工作区 - 左右布局 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧面板 - MD编辑器 */}
        <div className="video-editing-left-panel flex flex-col">
          {/* MD编辑器区域 */}
          <div className="video-editing-markdown-section">
            {/* MD编辑器标题头部 */}
            <div className="markdown-panel-header">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-gray-900">项目文档编辑</h3>
              </div>
            </div>
            <div className="video-editing-markdown-container">
              <MDEditor
                value={documentState.markdownValue}
                onChange={documentState.handleMarkdownChange}
                className="video-editing-markdown-editor"
                data-color-mode="light"
                visibleDragbar={false}
                textareaProps={{
                  placeholder: 'Start writing your video project documentation...',
                  style: {
                    fontSize: 14,
                    lineHeight: 1.6,
                  }
                }}
                preview="edit"
                hideToolbar={false}
                height="100%"
              />
            </div>
          </div>
          
          {/* AI助手区域 - 对话输入界面 */}
          <div className="video-editing-ai-assistant-section flex flex-col bg-gray-50 border-t border-gray-200">
            {/* 输入区域 */}
            <div className="flex flex-col p-4">
              {/* AI Assistant标题 */}
              <div className="mb-3">
                <div className="flex items-center space-x-2 mb-2">
                  <div className="w-5 h-5 bg-blue-100 rounded-md flex items-center justify-center">
                    <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-medium text-gray-900">AI Assistant</h3>
                  {aiAssistant.isLoading && (
                    <div className="flex items-center space-x-1 text-xs text-gray-500">
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Processing...</span>
                    </div>
                  )}
                </div>
              </div>

              <form onSubmit={aiAssistant.handleSubmit} className="flex items-end space-x-3">
                <div className="flex-1 relative">
                  <textarea
                    value={aiAssistant.inputMessage}
                    onChange={(e) => aiAssistant.setInputMessage(e.target.value)}
                    onKeyDown={aiAssistant.handleKeyDown}
                    placeholder="Ask me anything about video editing, content creation, or project planning..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                    rows={2}
                    disabled={aiAssistant.isLoading}
                    style={{ minHeight: '60px', maxHeight: '80px' }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!aiAssistant.inputMessage.trim() || aiAssistant.isLoading}
                  className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg px-4 py-2 transition-colors flex items-center justify-center min-w-[60px] h-[60px]"
                >
                  {aiAssistant.isLoading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </form>
            </div>
          </div>
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
              {/* 素材管理面板 - 左侧50% */}
              <div className="video-editing-materials-panel border-r border-gray-200">
                <div className="materials-panel-header">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900">素材管理</h3>
                    </div>
                    <button
                      onClick={materialManagement.handleMaterialUpload}
                      disabled={materialManagement.isUploading}
                      className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="上传素材"
                    >
                      {materialManagement.isUploading ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>{materialManagement.uploadProgress.toFixed(0)}%</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <span>上传</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="materials-panel-content">
                  {/* 素材类型筛选标签 */}
                  <div className="flex space-x-1 mb-4 p-1 bg-gray-100 rounded-lg">
                    {(['all', 'video', 'audio', 'image'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => materialManagement.handleMaterialTypeFilter(type)}
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          materialManagement.selectedMaterialType === type
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {type === 'all' ? '全部' : 
                         type === 'video' ? '视频' :
                         type === 'audio' ? '音频' : '图片'}
                      </button>
                    ))}
                  </div>

                  {/* 素材网格 */}
                  <div className="mb-4">
                    {materialManagement.materials.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 px-4">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无素材</h3>
                        <p className="text-sm text-gray-500 text-center mb-6 max-w-sm">
                          素材库为空，点击下方「搜索视频」按钮来添加高质量的视频素材
                        </p>
                        <button
                          onClick={videoSearch.openSearchModal}
                          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span>搜索视频</span>
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {/* Material cards would go here */}
                      </div>
                    )}
                  </div>

                  {/* 底部操作栏 */}
                  <div className="border-t pt-3 mt-auto">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={videoSearch.openSearchModal}
                          className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition-colors"
                          title="搜索在线视频"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span>搜索视频</span>
                        </button>
                      </div>
                      <div className="text-gray-500">
                        {materialManagement.materials.length}个素材
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 视频合成播放面板 - 右侧50% */}
              <div 
                className="video-editing-composition-panel"
                tabIndex={0}
                aria-label="视频合成播放面板"
              >
                <div className="composition-panel-header">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-1a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">视频合成播放</h3>
                  </div>
                </div>
                <div className="composition-panel-content">
                  {/* 视频播放器容器 */}
                  <div className="video-player-container">
                    {/* 视频预览窗口 - 16:9比例 */}
                    <div className="video-preview-window">
                      <img 
                        src={mockVideoPreview.thumbnailUrl}
                        alt="视频预览帧"
                        className="w-full h-full object-cover rounded-lg"
                      />
                      {/* 播放状态覆盖层 */}
                      <div className="video-overlay">
                        <button
                          onClick={videoPlayback.handlePlayPause}
                          className="play-pause-btn"
                          title={videoPlayback.isPlaying ? '暂停' : '播放'}
                        >
                          {videoPlayback.isPlaying ? (
                            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                            </svg>
                          ) : (
                            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* 播放控制栏 */}
                    <div className="video-controls">
                      {/* 进度条 */}
                      <div className="progress-container">
                        <div className="progress-bar">
                          <div 
                            className="progress-filled"
                            style={{ width: `${(videoPlayback.currentTime / mockVideoPreview.duration) * 100}%` }}
                          ></div>
                          <input
                            type="range"
                            min="0"
                            max={mockVideoPreview.duration}
                            value={videoPlayback.currentTime}
                            onChange={(e) => videoPlayback.handleTimeSeek(Number(e.target.value))}
                            className="progress-slider"
                          />
                        </div>
                      </div>

                      {/* 控制按钮组 */}
                      <div className="controls-row">
                        {/* 左侧：播放按钮和时间 */}
                        <div className="controls-left">
                          <button
                            onClick={videoPlayback.handlePlayPause}
                            className="control-btn play-btn"
                            title={videoPlayback.isPlaying ? '暂停' : '播放'}
                          >
                            {videoPlayback.isPlaying ? (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            )}
                          </button>
                          <span className="time-display">
                            {videoPlayback.formatTime(videoPlayback.currentTime)} / {videoPlayback.formatTime(mockVideoPreview.duration)}
                          </span>
                        </div>

                        {/* 右侧：音量、速度、全屏 */}
                        <div className="controls-right">
                          {/* 播放速度 */}
                          <div className="speed-control">
                            <select
                              value={videoPlayback.playbackRate}
                              onChange={(e) => videoPlayback.handlePlaybackRateChange(Number(e.target.value))}
                              className="speed-select"
                            >
                              <option value={0.5}>0.5x</option>
                              <option value={1.0}>1.0x</option>
                              <option value={1.25}>1.25x</option>
                              <option value={1.5}>1.5x</option>
                              <option value={2.0}>2.0x</option>
                            </select>
                          </div>

                          {/* 音量控制 */}
                          <div className="volume-control">
                            <button 
                              className="control-btn volume-btn" 
                              title="音量"
                              onClick={() => videoPlayback.handleVolumeChange(videoPlayback.volume === 0 ? 0.8 : 0)}
                            >
                              {videoPlayback.volume === 0 ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                </svg>
                              )}
                            </button>
                          </div>

                          {/* 全屏按钮 */}
                          <button
                            onClick={videoPlayback.handleFullscreenToggle}
                            className="control-btn fullscreen-btn"
                            title="全屏"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 视频信息面板 */}
                    <div className="video-info-panel">
                      <div className="info-row">
                        <div className="info-item">
                          <span className="info-label">分辨率:</span>
                          <span className="info-value">{mockVideoPreview.resolution.width}×{mockVideoPreview.resolution.height}</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">帧率:</span>
                          <span className="info-value">{mockVideoPreview.frameRate}fps</span>
                        </div>
                        <div className="info-item">
                          <span className="info-label">格式:</span>
                          <span className="info-value">{mockVideoPreview.format}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 下方容器 - 30%高度 */}
            <div className="video-editing-preview-lower border-t border-gray-200">
              <TimelinePanel className="h-full" />
            </div>
          </div>
        </div>
      </div>

      {/* 视频搜索模态框 */}
      {videoSearch.isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-5/6 flex flex-col">
            {/* 模态框头部 */}
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900">搜索在线视频</h2>
              </div>
              <button
                onClick={videoSearch.closeSearchModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 搜索控制区 */}
            <div className="p-6 border-b bg-gray-50">
              <div className="flex items-center space-x-4">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="输入搜索关键词，如：自然风景、商务办公、人物肖像..."
                    value={videoSearch.searchQuery}
                    onChange={(e) => videoSearch.setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && videoSearch.handleSearch()}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    disabled={videoSearch.isSearching}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <label className="text-sm text-gray-700">方向:</label>
                  <select
                    value={videoSearch.searchOrientation}
                    onChange={(e) => videoSearch.setSearchOrientation(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    disabled={videoSearch.isSearching}
                  >
                    <option value="mixed">混合</option>
                    <option value="landscape">横屏</option>
                    <option value="portrait">竖屏</option>
                  </select>
                </div>
                <button
                  onClick={videoSearch.handleSearch}
                  disabled={videoSearch.isSearching || !videoSearch.searchQuery.trim()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                >
                  {videoSearch.isSearching ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>搜索中...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <span>搜索</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 搜索结果区域 */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {videoSearch.searchResults.length > 0 && (
                <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    找到 {videoSearch.searchResults.length} 个视频，已选择 {videoSearch.selectedResults.size} 个
                  </div>
                  <button
                    onClick={videoSearch.handleAddSelectedVideos}
                    disabled={videoSearch.selectedResults.size === 0}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm flex items-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>添加选中视频 ({videoSearch.selectedResults.size})</span>
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-6">
                {videoSearch.isSearching ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <svg className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <p className="text-gray-600">正在搜索视频...</p>
                    </div>
                  </div>
                ) : videoSearch.searchResults.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {videoSearch.searchResults.map((video) => {
                      const isSelected = videoSearch.selectedResults.has(video.id);
                      return (
                        <div
                          key={video.id}
                          className={`relative bg-white border rounded-lg overflow-hidden hover:shadow-lg transition-all cursor-pointer ${
                            isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                          }`}
                          onClick={() => videoSearch.handleSearchResultSelect(video.id, !isSelected)}
                        >
                          {/* 选择指示器 */}
                          <div className="absolute top-2 left-2 z-10">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                              isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'
                            }`}>
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>

                          {/* 视频缩略图 */}
                          <div className="aspect-video bg-gray-100 relative overflow-hidden">
                            {video.thumbnail ? (
                              <img 
                                src={video.thumbnail} 
                                alt={video.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>

                          {/* 视频信息 */}
                          <div className="p-3">
                            <h4 className="text-sm font-medium text-gray-900 truncate mb-1">{video.title}</h4>
                            <p className="text-xs text-gray-500 mb-2">作者: {video.author}</p>
                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span>{video.width} × {video.height}</span>
                              {video.duration && (
                                <span>{Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, '0')}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <p className="text-gray-500 text-lg mb-2">输入关键词开始搜索</p>
                      <p className="text-gray-400 text-sm">搜索高质量的免费视频素材</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoEditingInterface; 