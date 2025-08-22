'use client';

import React, { useEffect, useRef } from 'react';
import { UseVideoSearchReturn, VideoLibraryType } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

interface VideoSearchModalProps extends UseVideoSearchReturn {
}

const VideoSearchModal: React.FC<VideoSearchModalProps> = ({
  isModalOpen,
  searchQuery,
  searchOrientation,
  isSearching,
  searchResults,
  selectedResults,
  previewVideo,
  validationError,
  // 新增：视频库相关props
  activeLibrary,
  youtubeSearchResults,
  youtubeSelectedResults,
  youtubePreviewVideo,
  isYoutubeSearching,
  closeSearchModal,
  handleSearch,
  handleSearchResultSelect,
  handleVideoPreview,
  handleAddSelectedVideos,
  handleClearSelection,
  setSearchQuery,
  setSearchOrientation,
  setValidationError,
  // 新增：视频库切换和Youtube相关方法
  setActiveLibrary,
  handleYoutubeSearch,
  handleYoutubeVideoPreview,
  handleYoutubeResultSelect,
  handleAddSelectedYoutubeVideos,
  handleClearYoutubeSelection,
  // 新增：YouTube时间范围相关props
  youtubeDurationRange,
  youtubeDurationPreset,
  setYoutubeDurationRange,
  setYoutubeDurationPreset,
  taskId
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoSearchModal'
  });

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isModalOpen) {
      logger.info('模态框打开 - 多视频库支持', {
        searchQuery,
        searchOrientation,
        activeLibrary,
        officialResultsCount: searchResults.length,
        youtubeResultsCount: youtubeSearchResults.length,
        officialSelectionCount: selectedResults.size,
        youtubeSelectionCount: youtubeSelectedResults.size,
        layoutType: 'tabbed_search_panels'
      });
    }
  }, [isModalOpen]);

  useEffect(() => {
    if (activeLibrary === 'official') {
      logger.info('官方视频库选择状态变化', {
        selectionCount: selectedResults.size,
        selectedVideoIds: Array.from(selectedResults),
        totalResults: searchResults.length,
        selectionRatio: searchResults.length > 0 ? selectedResults.size / searchResults.length : 0
      });
    } else {
      logger.info('Youtube视频库选择状态变化', {
        selectionCount: youtubeSelectedResults.size,
        selectedVideoIds: Array.from(youtubeSelectedResults),
        totalResults: youtubeSearchResults.length,
        selectionRatio: youtubeSearchResults.length > 0 ? youtubeSelectedResults.size / youtubeSearchResults.length : 0
      });
    }
  }, [selectedResults, youtubeSelectedResults, activeLibrary]);

  const handleClose = () => {
    logger.info('模态框关闭', {
      searchQuery,
      activeLibrary,
      officialResultsCount: searchResults.length,
      youtubeResultsCount: youtubeSearchResults.length,
      officialSelectedCount: selectedResults.size,
      youtubeSelectedCount: youtubeSelectedResults.size,
      userAction: 'close_button'
    });
    
    closeSearchModal();
  };

  const handleSearchClick = () => {
    logger.info('执行搜索', {
      query: searchQuery,
      orientation: searchOrientation,
      activeLibrary,
      queryLength: searchQuery.length,
      userAction: 'search_button'
    });
    
    if (activeLibrary === 'official') {
      handleSearch();
    } else {
      handleYoutubeSearch();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      handleSearchClick();
    }
  };

  const handleVideoClick = (video: any) => {
    // 只处理预览，不处理选择
    if (activeLibrary === 'official') {
      handleVideoPreview(video);
    } else {
      handleYoutubeVideoPreview(video);
    }
    
    logger.info('用户点击视频进行预览', {
      videoId: video.id,
      videoTitle: video.title,
      activeLibrary,
      userAction: 'video_preview_click',
      videoDimensions: `${video.width}x${video.height}`,
      videoOrientation: video.width > video.height ? 'landscape' : 'portrait',
      videoAspectRatio: (video.width / video.height).toFixed(2),
      layoutConstraints: 'max-height-320px-object-contain'
    });
  };

  // 新增：处理单个视频添加到合成
  const handleAddToComposition = (video: any, event: React.MouseEvent) => {
    event.stopPropagation(); // 阻止事件冒泡到视频条目点击
    
    if (activeLibrary === 'official') {
      const isSelected = selectedResults.has(video.id);
      handleSearchResultSelect(video.id, !isSelected);
      
      logger.info('用户点击添加合成按钮 - 官方视频', {
        videoId: video.id,
        videoTitle: video.title,
        action: isSelected ? 'remove' : 'add',
        userAction: 'add_composition_button'
      });
    } else {
      const isSelected = youtubeSelectedResults.has(video.id);
      handleYoutubeResultSelect(video.id, !isSelected);
      
      logger.info('用户点击添加合成按钮 - Youtube视频', {
        videoId: video.id,
        videoTitle: video.title,
        action: isSelected ? 'remove' : 'add',
        userAction: 'add_composition_button'
      });
    }
  };

  const handleRemoveSelected = (videoId: number | string) => {
    if (activeLibrary === 'official' && typeof videoId === 'number') {
      handleSearchResultSelect(videoId, false);
    } else if (activeLibrary === 'youtube' && typeof videoId === 'string') {
      handleYoutubeResultSelect(videoId, false);
    }
  };

  const handleReselect = () => {
    if (activeLibrary === 'official') {
      handleClearSelection();
    } else {
      handleClearYoutubeSelection();
    }
  };

  const handleConfirmAdd = () => {
    if (activeLibrary === 'official') {
      handleAddSelectedVideos();
    } else {
      handleAddSelectedYoutubeVideos();
    }
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return '';
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getSelectedVideos = () => {
    if (activeLibrary === 'official') {
      return searchResults.filter(video => selectedResults.has(video.id));
    } else {
      return youtubeSearchResults.filter(video => youtubeSelectedResults.has(video.id));
    }
  };

  const getCurrentResults = () => {
    return activeLibrary === 'official' ? searchResults : youtubeSearchResults;
  };

  const getCurrentSelectedResults = () => {
    return activeLibrary === 'official' ? selectedResults : youtubeSelectedResults;
  };

  const getCurrentPreviewVideo = () => {
    return activeLibrary === 'official' ? previewVideo : youtubePreviewVideo;
  };

  const getCurrentSearching = () => {
    return activeLibrary === 'official' ? isSearching : isYoutubeSearching;
  };

  const handleLibrarySwitch = (library: VideoLibraryType) => {
    logger.info('用户切换视频库', {
      fromLibrary: activeLibrary,
      toLibrary: library,
      userAction: 'tab_click'
    });
    setActiveLibrary(library);
  };

  if (!isModalOpen) return null;

  const selectedVideos = getSelectedVideos();
  const currentResults = getCurrentResults();
  const currentSelectedResults = getCurrentSelectedResults();
  const currentPreviewVideo = getCurrentPreviewVideo();
  const currentSearching = getCurrentSearching();

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

        {/* 新增：视频库页签 */}
        <div className="px-6 py-3 border-b border-gray-100 bg-white">
          <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => handleLibrarySwitch('official')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                activeLibrary === 'official'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              官方视频库
            </button>
            <button
              onClick={() => handleLibrarySwitch('youtube')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                activeLibrary === 'youtube'
                  ? 'bg-white text-red-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Youtube视频库
            </button>
          </div>
        </div>

        {/* 搜索控制区 - Apple风格 */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder={activeLibrary === 'official' 
                  ? "输入搜索关键词，如：自然风景、商务办公、人物肖像..."
                  : "搜索Youtube视频，如：自然风景、城市夜景、延时摄影..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 placeholder-gray-400 text-gray-900"
                disabled={currentSearching}
              />
            </div>
            <div className="flex items-center space-x-3">
              <label className="text-sm font-medium text-gray-700">方向:</label>
              <select
                value={searchOrientation}
                onChange={(e) => setSearchOrientation(e.target.value as any)}
                className="px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 text-gray-900"
                disabled={currentSearching}
              >
                <option value="mixed">混合</option>
                <option value="landscape">横屏</option>
                <option value="portrait">竖屏</option>
              </select>
            </div>
            
            {/* YouTube时间范围选择器 */}
            {activeLibrary === 'youtube' && (
              <div className="flex items-center space-x-3">
                <label className="text-sm font-medium text-gray-700">时长:</label>
                <select
                  value={youtubeDurationPreset}
                  onChange={(e) => {
                    const preset = e.target.value as any;
                    setYoutubeDurationPreset(preset);
                    logger.userAction('YouTube时长预设选择', 'durationPresetSelect', {
                      preset,
                      activeLibrary
                    });
                  }}
                  className="px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all duration-200 text-gray-900"
                  disabled={currentSearching}
                >
                  <option value="under_1min">1分钟内</option>
                  <option value="under_3min">3分钟内</option>
                  <option value="under_5min">5分钟内</option>
                  <option value="under_10min">10分钟内</option>
                  <option value="custom">自定义</option>
                </select>
                
                {/* 自定义时间范围输入 */}
                {youtubeDurationPreset === 'custom' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      placeholder="最小秒数"
                      value={youtubeDurationRange.minDuration}
                      onChange={(e) => {
                        const minDuration = parseInt(e.target.value) || 0;
                        setYoutubeDurationRange({
                          ...youtubeDurationRange,
                          minDuration
                        });
                      }}
                      className="w-20 px-2 py-1 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none"
                      disabled={currentSearching}
                      min="0"
                    />
                    <span className="text-xs text-gray-500">-</span>
                    <input
                      type="number"
                      placeholder="最大秒数"
                      value={youtubeDurationRange.maxDuration}
                      onChange={(e) => {
                        const maxDuration = parseInt(e.target.value) || 300;
                        setYoutubeDurationRange({
                          ...youtubeDurationRange,
                          maxDuration
                        });
                      }}
                      className="w-20 px-2 py-1 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none"
                      disabled={currentSearching}
                      min="1"
                    />
                    <span className="text-xs text-gray-500">秒</span>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handleSearchClick}
              disabled={currentSearching || !searchQuery.trim()}
              className={`px-6 py-3 rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2 font-medium shadow-sm ${
                activeLibrary === 'official'
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-red-500 text-white hover:bg-red-600'
              }`}
            >
              {currentSearching ? (
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

        {/* 主内容区域 - 左中右三栏布局 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左栏 - 视频预览区域 */}
          <div className="w-1/3 border-r border-gray-100 flex flex-col bg-gray-50/30">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
              <h4 className="font-medium text-gray-900">视频预览</h4>
            </div>
            <div className="flex-1 flex flex-col bg-white">
              {currentPreviewVideo ? (
                <>
                  {/* 预览视频标题栏 */}
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                    <h5 className="font-medium text-gray-900 truncate text-sm">{currentPreviewVideo.title}</h5>
                    <div className="text-xs text-gray-500 mt-1">
                      {activeLibrary === 'official' ? (
                        <span>作者: {currentPreviewVideo.author}</span>
                      ) : (
                        <span>频道: {currentPreviewVideo.channelTitle}</span>
                      )}
                    </div>
                  </div>

                  {/* 预览视频内容 */}
                  <div className="flex-1 p-4 max-h-96 overflow-y-auto">
                    <div className="w-full h-full min-h-[200px] max-h-[320px] bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
                      {(currentPreviewVideo.video_url || currentPreviewVideo.videoUrl) ? (
                        activeLibrary === 'youtube' ? (
                          // YouTube视频使用嵌入式播放器
                          <iframe
                            src={`https://www.youtube.com/embed/${currentPreviewVideo.id}?autoplay=0&controls=1&modestbranding=1&rel=0`}
                            className="w-full h-full max-h-[320px] object-contain"
                            style={{ aspectRatio: 'auto' }}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            onLoad={() => {
                              logger.info('YouTube视频预览加载完成', {
                                videoId: currentPreviewVideo.id,
                                videoTitle: currentPreviewVideo.title,
                                activeLibrary,
                                videoDimensions: `${currentPreviewVideo.width}x${currentPreviewVideo.height}`,
                                videoOrientation: currentPreviewVideo.width > currentPreviewVideo.height ? 'landscape' : 'portrait',
                                previewContainerMaxHeight: '320px',
                                layoutType: 'constrained_height_preview'
                              });
                            }}
                            onError={(e) => {
                              logger.error('YouTube视频预览加载失败', new Error('YouTube iframe load error'), {
                                videoId: currentPreviewVideo.id,
                                activeLibrary
                              });
                            }}
                          />
                        ) : (
                          // 官方视频库使用video元素
                          <video
                            ref={videoRef}
                            src={currentPreviewVideo.video_url || currentPreviewVideo.videoUrl}
                            className="w-full h-full max-h-[320px] object-contain"
                            style={{ maxWidth: '100%', maxHeight: '320px' }}
                            controls
                            preload="metadata"
                            onLoadStart={() => {
                              logger.info('视频预览开始加载', {
                                videoId: currentPreviewVideo.id,
                                videoUrl: currentPreviewVideo.video_url || currentPreviewVideo.videoUrl,
                                activeLibrary
                              });
                            }}
                            onCanPlay={() => {
                              const videoElement = videoRef.current;
                              logger.info('视频预览可播放', {
                                videoId: currentPreviewVideo.id,
                                activeLibrary,
                                videoDimensions: `${currentPreviewVideo.width}x${currentPreviewVideo.height}`,
                                videoOrientation: currentPreviewVideo.width > currentPreviewVideo.height ? 'landscape' : 'portrait',
                                actualVideoSize: videoElement ? `${videoElement.videoWidth}x${videoElement.videoHeight}` : 'unknown',
                                previewContainerMaxHeight: '320px',
                                layoutType: 'constrained_height_preview'
                              });
                            }}
                            onError={(e) => {
                              logger.error('视频预览加载失败', new Error('Video load error'), {
                                videoId: currentPreviewVideo.id,
                                error: e.currentTarget.error?.message || 'MEDIA_ELEMENT_ERROR: Format error',
                                activeLibrary
                              });
                            }}
                          />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {(currentPreviewVideo.thumbnail || currentPreviewVideo.thumbnailUrl) ? (
                            <img 
                              src={currentPreviewVideo.thumbnail || currentPreviewVideo.thumbnailUrl} 
                              alt={currentPreviewVideo.title}
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
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-gray-400">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-lg font-medium mb-2">点击视频进行预览</p>
                    <p className="text-sm">在中间选择一个视频来查看详情</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 中栏 - 搜索结果展示区域 */}
          <div className="w-1/3 border-r border-gray-100 flex flex-col">
            {/* 标题栏 */}
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
              <h4 className="font-medium text-gray-900">搜索结果</h4>
            </div>
            
            {/* 结果统计栏 */}
            {currentResults.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/30 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  找到 <span className="font-semibold text-gray-900">{currentResults.length}</span> 个{activeLibrary === 'official' ? '官方' : 'Youtube'}视频，已选择 <span className={`font-semibold ${activeLibrary === 'official' ? 'text-blue-600' : 'text-red-600'}`}>{currentSelectedResults.size}</span> 个
                </div>
              </div>
            )}

            {/* 搜索结果内容 */}
            <div className="flex-1 overflow-y-auto">
              {currentSearching ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <svg className={`w-12 h-12 animate-spin mx-auto mb-4 ${activeLibrary === 'official' ? 'text-blue-500' : 'text-red-500'}`} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-gray-600 font-medium">正在搜索{activeLibrary === 'official' ? '官方' : 'Youtube'}视频...</p>
                  </div>
                </div>
              ) : currentResults.length > 0 ? (
                <div className="p-3 space-y-3">
                  {currentResults.map((video) => {
                    const isSelected = currentSelectedResults.has(video.id);
                    const isPreviewActive = currentPreviewVideo?.id === video.id;
                    
                    return (
                      <div
                        key={video.id}
                        className={`group relative bg-white border rounded-xl overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer ${
                          isPreviewActive 
                            ? `ring-2 ${activeLibrary === 'official' ? 'ring-blue-500 border-blue-500' : 'ring-red-500 border-red-500'}` 
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => handleVideoClick(video)}
                      >
                        {activeLibrary === 'official' ? (
                          // 官方视频库 - 紧凑横向布局（小缩略图）
                          <div className="flex items-center p-3 space-x-3">
                            {/* 视频缩略图 */}
                            <div className="relative w-16 h-12 bg-gray-100 rounded-md overflow-hidden flex-shrink-0">
                              {(video.thumbnail || video.thumbnailUrl) ? (
                                <img 
                                  src={video.thumbnail || video.thumbnailUrl} 
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
                              <h5 className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight mb-1">{video.title}</h5>
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2 text-xs text-gray-500">
                                  <span>{video.width} × {video.height}</span>
                                  {video.duration && (
                                    <span>• {formatDuration(video.duration)}</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500">
                                  <span>作者: {video.author}</span>
                                </div>
                              </div>
                            </div>

                            {/* 添加合成按钮 */}
                            <button
                              onClick={(e) => handleAddToComposition(video, e)}
                              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center space-x-1 ${
                                isSelected
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                              }`}
                            >
                              {isSelected ? (
                                <>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  <span>已添加</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  <span>添加合成</span>
                                </>
                              )}
                            </button>
                          </div>
                        ) : (
                          // YouTube视频库 - 紧凑的文字列表布局（无缩略图）
                          <div className="flex items-center p-3 space-x-3">
                            {/* 视频图标 */}
                            <div className="flex-shrink-0 w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
                              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </div>

                            {/* 视频信息 */}
                            <div className="flex-1 min-w-0">
                              <h5 className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight mb-1">{video.title}</h5>
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2 text-xs text-gray-500">
                                  <span>{video.width} × {video.height}</span>
                                  {video.duration && (
                                    <span>• {formatDuration(video.duration)}</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500">
                                  <span>频道: {video.channelTitle}</span>
                                  {video.viewCount && (
                                    <span> • {video.viewCount.toLocaleString()} 次观看</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* 添加合成按钮 */}
                            <button
                              onClick={(e) => handleAddToComposition(video, e)}
                              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center space-x-1 ${
                                isSelected
                                  ? 'bg-red-500 text-white'
                                  : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                              }`}
                            >
                              {isSelected ? (
                                <>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  <span>已添加</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  <span>添加合成</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center text-gray-400">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="text-lg font-medium mb-2">开始搜索{activeLibrary === 'official' ? '官方' : 'Youtube'}视频</p>
                    <p className="text-sm">输入关键词并点击搜索按钮</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右栏 - 已选择的视频列表区域 */}
          <div className="w-1/3 flex flex-col bg-gray-50/30">
            <div className="flex flex-col bg-white h-full">
              {/* 已选择标题栏 */}
              <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">已选择的视频</h4>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    activeLibrary === 'official' 
                      ? 'text-blue-600 bg-blue-100' 
                      : 'text-red-600 bg-red-100'
                  }`}>
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
                            {(video.thumbnail || video.thumbnailUrl) ? (
                              <img 
                                src={video.thumbnail || video.thumbnailUrl} 
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
                      <p className="text-xs">点击"添加合成"按钮选择视频</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          {/* 错误信息显示区域 */}
          {validationError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-red-800 mb-1">视频时长不足</h4>
                <p className="text-sm text-red-700">{validationError}</p>
                <p className="text-xs text-red-600 mt-1">请选择更多视频或时长更长的视频素材。</p>
              </div>
              <button
                onClick={() => setValidationError(null)}
                className="flex-shrink-0 text-red-400 hover:text-red-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          
          {/* 操作按钮 */}
          <div className="flex items-center justify-end space-x-3">
            <button
              onClick={handleReselect}
              className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors duration-200 font-medium"
            >
              重新选择
            </button>
            <button
              onClick={handleConfirmAdd}
              disabled={currentSelectedResults.size === 0}
              className={`px-6 py-2.5 text-white rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 font-medium shadow-sm flex items-center space-x-2 ${
                activeLibrary === 'official' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-red-500 hover:bg-red-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>确认添加 ({currentSelectedResults.size})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoSearchModal; 