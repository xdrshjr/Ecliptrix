'use client';

import React, { useEffect, useRef } from 'react';
import { UseVideoSearchReturn } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

interface VideoSearchModalProps extends UseVideoSearchReturn {
  taskId: string;
}

const VideoSearchModal: React.FC<VideoSearchModalProps> = ({
  isModalOpen,
  searchQuery,
  searchOrientation,
  isSearching,
  searchResults,
  selectedResults,
  previewVideo,
  closeSearchModal,
  handleSearch,
  handleSearchResultSelect,
  handleVideoPreview,
  handleAddSelectedVideos,
  handleClearSelection,
  setSearchQuery,
  setSearchOrientation,
  taskId
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoSearchModal'
  });

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isModalOpen) {
      logger.info('模态框打开 - 新版双面板布局', {
        searchQuery,
        searchOrientation,
        previousResultsCount: searchResults.length,
        previousSelectionCount: selectedResults.size,
        layoutType: 'search_and_selection_panels'
      });
    }
  }, [isModalOpen]);

  useEffect(() => {
    logger.info('选择状态变化', {
      selectionCount: selectedResults.size,
      selectedVideoIds: Array.from(selectedResults),
      totalResults: searchResults.length,
      selectionRatio: searchResults.length > 0 ? selectedResults.size / searchResults.length : 0
    });
  }, [selectedResults]);

  const handleClose = () => {
    logger.info('模态框关闭', {
      searchQuery,
      resultsCount: searchResults.length,
      selectedCount: selectedResults.size,
      userAction: 'close_button'
    });
    
    closeSearchModal();
  };

  const handleSearchClick = () => {
    logger.info('执行搜索', {
      query: searchQuery,
      orientation: searchOrientation,
      queryLength: searchQuery.length,
      userAction: 'search_button'
    });
    
    handleSearch();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      logger.info('回车键搜索', {
        query: searchQuery,
        orientation: searchOrientation,
        userAction: 'keyboard_enter'
      });
      
      handleSearch();
    }
  };

  const handleResultSelect = (videoId: number, isSelected: boolean) => {
    logger.info('搜索结果选择变更', {
      videoId,
      isSelected,
      totalSelected: selectedResults.size + (isSelected ? 1 : -1),
      totalResults: searchResults.length,
      userAction: 'video_card_click'
    });
    
    handleSearchResultSelect(videoId, isSelected);
  };

  const handleVideoClick = (video: any) => {
    const isCurrentlySelected = selectedResults.has(video.id);
    
    logger.info('视频卡片点击', {
      videoId: video.id,
      videoTitle: video.title,
      currentlySelected: isCurrentlySelected,
      willBeSelected: !isCurrentlySelected,
      userAction: 'video_card_toggle_and_preview'
    });
    
    // 设置预览视频
    handleVideoPreview(video);
    // 同时切换选择状态
    handleSearchResultSelect(video.id, !isCurrentlySelected);
  };

  const handleConfirmAdd = () => {
    logger.info('确认添加按钮点击', {
      selectedCount: selectedResults.size,
      totalResults: searchResults.length,
      selectedIds: Array.from(selectedResults),
      userAction: 'confirm_add_button'
    });
    
    handleAddSelectedVideos();
  };

  const handleReselect = () => {
    logger.info('重新选择按钮点击', {
      previousSelectionCount: selectedResults.size,
      userAction: 'reselect_button'
    });
    
    handleClearSelection();
  };

  const handleRemoveSelected = (videoId: number) => {
    logger.info('移除单个选中视频', {
      videoId,
      previousSelectionCount: selectedResults.size,
      userAction: 'remove_from_selection'
    });
    
    handleSearchResultSelect(videoId, false);
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return '';
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getSelectedVideos = () => {
    return searchResults.filter(video => selectedResults.has(video.id));
  };

  if (!isModalOpen) return null;

  const selectedVideos = getSelectedVideos();

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-5/6 flex flex-col overflow-hidden border border-gray-100">
        {/* 模态框头部 - Apple风格 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">搜索在线视频</h2>
              <p className="text-sm text-gray-500">发现高质量的免费视频素材</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors duration-200"
          >
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 搜索控制区 - Apple风格 */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="输入搜索关键词，如：自然风景、商务办公、人物肖像..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 placeholder-gray-400 text-gray-900"
                disabled={isSearching}
              />
            </div>
            <div className="flex items-center space-x-3">
              <label className="text-sm font-medium text-gray-700">方向:</label>
              <select
                value={searchOrientation}
                onChange={(e) => setSearchOrientation(e.target.value as any)}
                className="px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 text-gray-900"
                disabled={isSearching}
              >
                <option value="mixed">混合</option>
                <option value="landscape">横屏</option>
                <option value="portrait">竖屏</option>
              </select>
            </div>
            <button
              onClick={handleSearchClick}
              disabled={isSearching || !searchQuery.trim()}
              className="px-6 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2 font-medium shadow-sm"
            >
              {isSearching ? (
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

        {/* 主内容区域 - 左右分栏 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧 - 搜索结果列表 */}
          <div className="w-3/5 border-r border-gray-100 flex flex-col">
            {/* 结果统计栏 */}
            {searchResults.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/30 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  找到 <span className="font-semibold text-gray-900">{searchResults.length}</span> 个视频，已选择 <span className="font-semibold text-blue-600">{selectedResults.size}</span> 个
                </div>
              </div>
            )}

            {/* 搜索结果内容 */}
            <div className="flex-1 overflow-y-auto">
              {isSearching ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <svg className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-gray-600 font-medium">正在搜索视频...</p>
                  </div>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="p-4 space-y-3">
                  {searchResults.map((video) => {
                    const isSelected = selectedResults.has(video.id);
                    const isPreviewActive = previewVideo?.id === video.id;
                    
                    return (
                      <div
                        key={video.id}
                        className={`group relative bg-white border rounded-xl overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer ${
                          isSelected ? 'border-blue-300 bg-blue-50/30 shadow-sm' : 'border-gray-200 hover:border-gray-300'
                        } ${isPreviewActive ? 'ring-2 ring-blue-500 border-blue-500' : ''}`}
                        onClick={() => handleVideoClick(video)}
                      >
                        <div className="flex p-4 space-x-4">
                          {/* 视频缩略图 */}
                          <div className="relative w-32 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                            {video.thumbnail ? (
                              <img 
                                src={video.thumbnail} 
                                alt={video.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                            
                            {/* 播放按钮覆盖 */}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all">
                              <div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <svg className="w-4 h-4 text-gray-800 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              </div>
                            </div>
                          </div>

                          {/* 视频信息 */}
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-gray-900 truncate mb-1">{video.title}</h4>
                            <p className="text-xs text-gray-500 mb-2">作者: {video.author}</p>
                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span className="bg-gray-100 px-2 py-1 rounded">{video.width} × {video.height}</span>
                              {video.duration && (
                                <span className="bg-gray-100 px-2 py-1 rounded">{formatDuration(video.duration)}</span>
                              )}
                            </div>
                          </div>

                          {/* 选择指示器 */}
                          <div className="flex-shrink-0">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                              isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white border-gray-300 group-hover:border-blue-400'
                            }`}>
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="text-gray-500 text-lg mb-2 font-medium">输入关键词开始搜索</p>
                    <p className="text-gray-400 text-sm">搜索高质量的免费视频素材</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右侧 - 视频预览和已选择视频区域 */}
          <div className="w-2/5 bg-gray-50/30 flex flex-col">
            {/* 上方区域 - 视频预览 (50%高度) */}
            <div className="h-1/2 flex flex-col">
              {previewVideo ? (
                <>
                  {/* 预览视频标题栏 */}
                  <div className="px-6 py-3 border-b border-gray-100 bg-white">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 pr-4">
                        <h3 className="font-semibold text-gray-900 truncate">{previewVideo.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">作者: {previewVideo.author}</p>
                      </div>
                      <div className="flex-shrink-0 flex items-center space-x-3 text-xs">
                        <div className="flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded-md">
                          <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                          </svg>
                          <span className="text-gray-700 font-medium">{previewVideo.width} × {previewVideo.height}</span>
                        </div>
                        {previewVideo.duration && (
                          <div className="flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded-md">
                            <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-gray-700 font-medium">{formatDuration(previewVideo.duration)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 视频播放器区域 */}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* 视频播放器 - 固定比例，避免过度拉伸 */}
                    <div className="flex-shrink-0 mx-4 mt-4 mb-3">
                      <div className="aspect-video bg-black rounded-xl overflow-hidden">
                        {previewVideo.video_url ? (
                          <video
                            ref={videoRef}
                            src={previewVideo.video_url}
                            poster={previewVideo.thumbnail}
                            controls
                            className="w-full h-full object-contain"
                            onLoadStart={() => {
                              logger.info('视频预览开始加载', {
                                videoId: previewVideo.id,
                                videoUrl: previewVideo.video_url
                              });
                            }}
                            onCanPlay={() => {
                              logger.info('视频预览可播放', {
                                videoId: previewVideo.id
                              });
                            }}
                            onError={(e) => {
                              logger.error('视频预览加载失败', new Error('Video load error'), {
                                videoId: previewVideo.id,
                                error: e.currentTarget.error?.message
                              });
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {previewVideo.thumbnail ? (
                              <img 
                                src={previewVideo.thumbnail} 
                                alt={previewVideo.title}
                                className="max-w-full max-h-full object-contain"
                              />
                            ) : (
                              <div className="text-center text-gray-400">
                                <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                <p className="text-sm">无预览视频</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-gray-400">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-lg font-medium mb-2">点击视频进行预览</p>
                    <p className="text-sm">在左侧选择一个视频来查看详情</p>
                  </div>
                </div>
              )}
            </div>

            {/* 下方区域 - 已选择视频列表 (50%高度) */}
            <div className="h-1/2 border-t border-gray-100 flex flex-col bg-white">
              {/* 已选择标题栏 */}
              <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">已选择的视频</h4>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    {selectedVideos.length} 个
                  </span>
                </div>
              </div>

              {/* 已选择视频内容 */}
              <div className="flex-1 overflow-y-auto">
                {selectedVideos.length > 0 ? (
                  <div className="p-3 space-y-2">
                    {selectedVideos.map((video) => (
                      <div
                        key={video.id}
                        className="group bg-gray-50 border border-gray-200 rounded-lg overflow-hidden hover:shadow-sm transition-all duration-200"
                      >
                        <div className="flex p-2 space-x-3">
                          {/* 视频缩略图 */}
                          <div className="relative w-16 h-10 bg-gray-100 rounded-md overflow-hidden flex-shrink-0">
                            {video.thumbnail ? (
                              <img 
                                src={video.thumbnail} 
                                alt={video.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>

                          {/* 视频信息 */}
                          <div className="flex-1 min-w-0">
                            <h6 className="text-xs font-medium text-gray-900 truncate mb-1">{video.title}</h6>
                            <div className="flex items-center space-x-2 text-xs text-gray-500">
                              <span>{video.width} × {video.height}</span>
                              {video.duration && (
                                <span>• {formatDuration(video.duration)}</span>
                              )}
                            </div>
                          </div>

                          {/* 移除按钮 */}
                          <button
                            onClick={() => handleRemoveSelected(video.id)}
                            className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-200 hover:bg-red-100 flex items-center justify-center transition-colors duration-200 group"
                          >
                            <svg className="w-3 h-3 text-gray-500 group-hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center text-gray-400">
                      <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <p className="text-sm font-medium mb-1">暂无选择</p>
                      <p className="text-xs">点击视频进行选择</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end space-x-3">
          <button
            onClick={handleReselect}
            className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors duration-200 font-medium"
          >
            重新选择
          </button>
          <button
            onClick={handleConfirmAdd}
            disabled={selectedResults.size === 0}
            className="px-6 py-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 font-medium shadow-sm flex items-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>确认添加 ({selectedResults.size})</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoSearchModal; 