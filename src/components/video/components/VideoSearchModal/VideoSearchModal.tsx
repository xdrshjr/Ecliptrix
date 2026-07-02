'use client';

import React, { useEffect, useRef, useState } from 'react';
import { UseVideoSearchReturn, VideoLibraryType } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';
import { useLocale } from '@/contexts/LocaleContext';

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
  // 新增：分页相关props
  currentPage,
  totalPages,
  pageSize,
  goToPage,
  goToPreviousPage,
  goToNextPage,
  taskId
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoSearchModal'
  });

  const { t } = useLocale();

  const videoRef = useRef<HTMLVideoElement>(null);

  // YouTube 左侧预览：<video> 指向同源流端点，解析/上游失败时降级为缩略图 + 在浏览器打开。
  const [youtubePreviewError, setYoutubePreviewError] = useState(false);

  // 切换预览视频时重置错误态，避免上一条失败态残留到下一条。
  useEffect(() => {
    setYoutubePreviewError(false);
  }, [youtubePreviewVideo?.id]);

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
    const allResults = activeLibrary === 'official' ? searchResults : youtubeSearchResults;
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return allResults.slice(startIndex, endIndex);
  };

  const getAllCurrentResults = () => {
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
  const allCurrentResults = getAllCurrentResults();
  const currentSelectedResults = getCurrentSelectedResults();
  const currentPreviewVideo = getCurrentPreviewVideo();
  const currentSearching = getCurrentSearching();

  return (
      <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-modal">
      <div className="bg-card rounded-md w-full max-w-7xl h-5/6 flex flex-col overflow-hidden border border-border">
        {/* 模态框头部 - Apple风格 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary/10 rounded-md flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t.videoSearchModal.title}</h2>
              <p className="text-sm text-muted-foreground">{t.videoSearchModal.subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors duration-200"
          >
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 新增：视频库页签 */}
        <div className="px-6 py-3 border-b border-border bg-card">
          <div className="flex space-x-1 bg-muted rounded-md p-1">
            <button
              onClick={() => handleLibrarySwitch('official')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                activeLibrary === 'official'
                  ? 'bg-card text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.videoSearchModal.officialLibrary}
            </button>
            <button
              onClick={() => handleLibrarySwitch('youtube')}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                activeLibrary === 'youtube'
                  ? 'bg-card text-destructive'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.videoSearchModal.youtubeLibrary}
            </button>
          </div>
        </div>

        {/* 搜索控制区 - Apple风格 */}
        <div className="px-6 py-4 border-b border-border bg-card">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder={activeLibrary === 'official'
                  ? t.videoSearchModal.searchPlaceholder
                  : t.videoSearchModal.youtubeSearchPlaceholder
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-4 py-3 bg-muted border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all duration-200 placeholder-muted-foreground text-foreground"
                disabled={currentSearching}
              />
            </div>
            <div className="flex items-center space-x-3">
              <label className="text-sm font-medium text-foreground">{t.videoSearchModal.orientationLabel}</label>
              <select
                value={searchOrientation}
                onChange={(e) => setSearchOrientation(e.target.value as any)}
                className="px-3 py-3 bg-muted border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all duration-200 text-foreground"
                disabled={currentSearching}
              >
                <option value="mixed">{t.videoSearchModal.orientationMixed}</option>
                <option value="landscape">{t.videoSearchModal.orientationLandscape}</option>
                <option value="portrait">{t.videoSearchModal.orientationPortrait}</option>
              </select>
            </div>
            
            {/* YouTube时间范围选择器 */}
            {activeLibrary === 'youtube' && (
              <div className="flex items-center space-x-3">
                <label className="text-sm font-medium text-foreground">{t.videoSearchModal.durationLabel}</label>
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
                  className="px-3 py-3 bg-muted border border-border rounded-md focus:ring-2 focus:ring-destructive focus:border-destructive outline-none transition-all duration-200 text-foreground"
                  disabled={currentSearching}
                >
                  <option value="under_1min">{t.videoSearchModal.durationUnder1}</option>
                  <option value="under_3min">{t.videoSearchModal.durationUnder3}</option>
                  <option value="under_5min">{t.videoSearchModal.durationUnder5}</option>
                  <option value="under_10min">{t.videoSearchModal.durationUnder10}</option>
                  <option value="custom">{t.videoSearchModal.durationCustom}</option>
                </select>
                
                {/* 自定义时间范围输入 */}
                {youtubeDurationPreset === 'custom' && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      placeholder={t.videoSearchModal.durationMinPlaceholder}
                      value={youtubeDurationRange.minDuration}
                      onChange={(e) => {
                        const minDuration = parseInt(e.target.value) || 0;
                        setYoutubeDurationRange({
                          ...youtubeDurationRange,
                          minDuration
                        });
                      }}
                      className="w-20 px-2 py-1 text-xs bg-muted border border-border rounded-md focus:ring-1 focus:ring-destructive focus:border-destructive outline-none"
                      disabled={currentSearching}
                      min="0"
                    />
                    <span className="text-xs text-muted-foreground">-</span>
                    <input
                      type="number"
                      placeholder={t.videoSearchModal.durationMaxPlaceholder}
                      value={youtubeDurationRange.maxDuration}
                      onChange={(e) => {
                        const maxDuration = parseInt(e.target.value) || 300;
                        setYoutubeDurationRange({
                          ...youtubeDurationRange,
                          maxDuration
                        });
                      }}
                      className="w-20 px-2 py-1 text-xs bg-muted border border-border rounded-md focus:ring-1 focus:ring-destructive focus:border-destructive outline-none"
                      disabled={currentSearching}
                      min="1"
                    />
                    <span className="text-xs text-muted-foreground">{t.videoSearchModal.seconds}</span>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handleSearchClick}
              disabled={currentSearching || !searchQuery.trim()}
              className={`px-6 py-3 rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2 font-medium ${
                activeLibrary === 'official'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              }`}
            >
              {currentSearching ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>{t.videoSearchModal.searching}</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <span>{t.videoSearchModal.searchButton}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 主内容区域 - 左中右三栏布局 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左栏 - 视频预览区域 */}
          <div className="w-1/3 border-r border-border flex flex-col bg-muted">
            <div className="px-4 py-3 border-b border-border bg-muted">
              <h4 className="font-medium text-foreground">{t.videoSearchModal.videoPreview}</h4>
            </div>
            <div className="flex-1 flex flex-col bg-card">
              {currentPreviewVideo ? (
                <>
                  {/* 预览视频标题栏 */}
                  <div className="px-4 py-3 border-b border-border bg-muted">
                    <h5 className="font-medium text-foreground truncate text-sm">{currentPreviewVideo.title}</h5>
                    <div className="text-xs text-muted-foreground mt-1">
                      {activeLibrary === 'official' ? (
                        <span>{t.videoSearchModal.author} {currentPreviewVideo.author}</span>
                      ) : (
                        <span>{t.videoSearchModal.channel} {currentPreviewVideo.channelTitle}</span>
                      )}
                    </div>
                  </div>

                  {/* 预览视频内容 */}
                  <div className="flex-1 p-4 max-h-96 overflow-y-auto">
                    <div className="w-full h-full min-h-[200px] max-h-[320px] bg-muted rounded-md overflow-hidden flex items-center justify-center">
                      {(currentPreviewVideo.video_url || currentPreviewVideo.videoUrl) ? (
                        activeLibrary === 'youtube' ? (
                          // YouTube视频：改走后端渐进式流端点（同源 <video>），规避 iframe 内嵌
                          // 播放器触发的反机器人「请登录…」挑战；解析/上游失败时降级。
                          youtubePreviewError ? (
                            <div className="w-full h-full flex flex-col items-center justify-center text-center p-4">
                              {(currentPreviewVideo.thumbnail || currentPreviewVideo.thumbnailUrl) ? (
                                <img
                                  src={currentPreviewVideo.thumbnail || currentPreviewVideo.thumbnailUrl}
                                  alt={currentPreviewVideo.title}
                                  className="max-w-full max-h-[220px] object-contain rounded-md mb-3"
                                />
                              ) : (
                                <svg className="w-12 h-12 mb-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              )}
                              <p className="text-sm font-medium text-foreground">{t.videoSearchModal.previewUnavailable}</p>
                              <p className="text-xs text-muted-foreground mt-1">{t.videoSearchModal.previewUnavailableHint}</p>
                              <a
                                href={currentPreviewVideo.videoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex items-center space-x-1 text-xs font-medium text-destructive hover:underline"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                                <span>{t.videoSearchModal.openInBrowser}</span>
                              </a>
                            </div>
                          ) : (
                            <video
                              key={currentPreviewVideo.id}
                              src={`/api/youtube/preview-stream?video_id=${encodeURIComponent(currentPreviewVideo.id)}`}
                              className="w-full h-full max-h-[320px] object-contain"
                              style={{ maxWidth: '100%', maxHeight: '320px' }}
                              controls
                              preload="metadata"
                              onLoadedData={() => {
                                setYoutubePreviewError(false);
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
                              onError={() => {
                                setYoutubePreviewError(true);
                                logger.error('YouTube视频预览加载失败', new Error('YouTube preview stream load error'), {
                                  videoId: currentPreviewVideo.id,
                                  activeLibrary
                                });
                              }}
                            />
                          )
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
                            <div className="text-center text-muted-foreground">
                              <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              <p className="text-sm">{t.videoSearchModal.noPreview}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-lg font-medium mb-2">{t.videoSearchModal.clickToPreview}</p>
                    <p className="text-sm">{t.videoSearchModal.clickToPreviewDesc}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 中栏 - 搜索结果展示区域 */}
          <div className="w-1/3 border-r border-border flex flex-col">
            {/* 标题栏 */}
            <div className="px-4 py-3 border-b border-border bg-muted">
              <h4 className="font-medium text-foreground">{t.videoSearchModal.searchResults}</h4>
            </div>
            
            {/* 结果统计栏 */}
            {allCurrentResults.length > 0 && (
              <div className="px-4 py-3 border-b border-border bg-muted flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {t.videoSearchModal.foundVideos} <span className="font-semibold text-foreground">{allCurrentResults.length}</span> {activeLibrary === 'official' ? '' : 'Youtube'}{t.videoSearchModal.items} <span className={`font-semibold ${activeLibrary === 'official' ? 'text-primary' : 'text-destructive'}`}>{currentSelectedResults.size}</span> {t.videoSearchModal.selected}
                </div>
                {totalPages > 1 && (
                  <div className="text-sm text-muted-foreground">
                    {currentPage} / {totalPages}
                  </div>
                )}
              </div>
            )}

            {/* 搜索结果内容 */}
            <div className="flex-1 overflow-y-auto">
              {currentSearching ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <svg className={`w-12 h-12 animate-spin mx-auto mb-4 ${activeLibrary === 'official' ? 'text-primary' : 'text-destructive'}`} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-muted-foreground font-medium">{t.videoSearchModal.searchingLibrary.replace('{libraryType}', activeLibrary === 'official' ? '' : 'Youtube')}</p>
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
                        className={`group relative bg-card border rounded-md overflow-hidden hover:transition-all duration-200 cursor-pointer ${
                          isPreviewActive 
                            ? `ring-2 ${activeLibrary === 'official' ? 'ring-primary border-primary' : 'ring-destructive border-destructive'}` 
                            : 'border-border hover:border-border'
                        }`}
                        onClick={() => handleVideoClick(video)}
                      >
                        {activeLibrary === 'official' ? (
                          // 官方视频库 - 紧凑横向布局（小缩略图）
                          <div className="flex items-center p-3 space-x-3">
                            {/* 视频缩略图 */}
                            <div className="relative w-16 h-12 bg-muted rounded-md overflow-hidden flex-shrink-0">
                              {(video.thumbnail || video.thumbnailUrl) ? (
                                <img 
                                  src={video.thumbnail || video.thumbnailUrl} 
                                  alt={video.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                            </div>

                            {/* 视频信息 */}
                            <div className="flex-1 min-w-0">
                              <h5 className="text-sm font-medium text-foreground line-clamp-2 leading-tight mb-1">{video.title}</h5>
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                                  <span>{video.width} × {video.height}</span>
                                  {video.duration && (
                                    <span>• {formatDuration(video.duration)}</span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  <span>{t.videoSearchModal.author} {video.author}</span>
                                </div>
                              </div>
                            </div>

                            {/* 添加合成按钮 */}
                            <button
                              onClick={(e) => handleAddToComposition(video, e)}
                              className={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 flex items-center space-x-1 ${
                                isSelected
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-primary/10 text-primary hover:bg-primary/10 border border-primary/20'
                              }`}
                            >
                              {isSelected ? (
                                <>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  <span>{t.videoSearchModal.added}</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  <span>{t.videoSearchModal.addToComposition}</span>
                                </>
                              )}
                            </button>
                          </div>
                        ) : (
                          // YouTube视频库 - 紧凑的文字列表布局（无缩略图）
                          <div className="flex items-center p-3 space-x-3">
                            {/* 视频图标 */}
                            <div className="flex-shrink-0 w-10 h-10 bg-destructive/10 rounded-md flex items-center justify-center">
                              <svg className="w-5 h-5 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </div>

                            {/* 视频信息 */}
                            <div className="flex-1 min-w-0">
                              <h5 className="text-sm font-medium text-foreground line-clamp-2 leading-tight mb-1">{video.title}</h5>
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                                  <span>{video.width} × {video.height}</span>
                                  {video.duration && (
                                    <span>• {formatDuration(video.duration)}</span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  <span>{t.videoSearchModal.channel} {video.channelTitle}</span>
                                  {video.viewCount && (
                                    <span> · {video.viewCount.toLocaleString()} {t.videoSearchModal.views}</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* 添加合成按钮 */}
                            <button
                              onClick={(e) => handleAddToComposition(video, e)}
                              className={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 flex items-center space-x-1 ${
                                isSelected
                                  ? 'bg-destructive text-destructive-foreground'
                                  : 'bg-destructive/10 text-destructive hover:bg-destructive/10 border border-destructive/20'
                              }`}
                            >
                              {isSelected ? (
                                <>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  <span>{t.videoSearchModal.added}</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  <span>{t.videoSearchModal.addToComposition}</span>
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
                  <div className="text-center text-muted-foreground">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="text-lg font-medium mb-2">{t.videoSearchModal.startSearchLibrary.replace('{libraryType}', activeLibrary === 'official' ? '' : 'Youtube')}</p>
                    <p className="text-sm">{t.videoSearchModal.searchHint}</p>
                  </div>
                </div>
              )}
              
              {/* 分页控件 */}
              {totalPages > 1 && allCurrentResults.length > 0 && (
                <div className="px-4 py-3 border-t border-border bg-muted">
                  <div className="flex items-center justify-center space-x-2">
                    <button
                      onClick={goToPreviousPage}
                      disabled={currentPage === 1}
                      className={`px-3 py-1.5 text-sm rounded-md border transition-colors duration-200 ${
                        currentPage === 1
                          ? 'border-border text-muted-foreground cursor-not-allowed'
                          : `border-border text-foreground hover:bg-muted ${
                              activeLibrary === 'official' ? 'hover:border-primary/30' : 'hover:border-destructive/30'
                            }`
                      }`}
                    >
                      {t.videoSearchModal.prevPage}
                    </button>
                    
                    <div className="flex items-center space-x-1">
                      {[...Array(totalPages)].map((_, index) => {
                        const page = index + 1;
                        return (
                          <button
                            key={page}
                            onClick={() => goToPage(page)}
                            className={`w-8 h-8 text-sm rounded-md transition-colors duration-200 ${
                              currentPage === page
                                ? `${activeLibrary === 'official' ? 'bg-primary text-primary-foreground' : 'bg-destructive text-destructive-foreground'}`
                                : `text-foreground hover:bg-muted ${
                                    activeLibrary === 'official' ? 'hover:text-primary' : 'hover:text-destructive'
                                  }`
                            }`}
                          >
                            {page}
                          </button>
                        );
                      })}
                    </div>
                    
                    <button
                      onClick={goToNextPage}
                      disabled={currentPage === totalPages}
                      className={`px-3 py-1.5 text-sm rounded-md border transition-colors duration-200 ${
                        currentPage === totalPages
                          ? 'border-border text-muted-foreground cursor-not-allowed'
                          : `border-border text-foreground hover:bg-muted ${
                              activeLibrary === 'official' ? 'hover:border-primary/30' : 'hover:border-destructive/30'
                            }`
                      }`}
                    >
                      {t.videoSearchModal.nextPage}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右栏 - 已选择的视频列表区域 */}
          <div className="w-1/3 flex flex-col bg-muted">
            <div className="flex flex-col bg-card h-full">
              {/* 已选择标题栏 */}
              <div className="px-6 py-3 border-b border-border bg-muted">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-foreground">{t.videoSearchModal.selectedVideos}</h4>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    activeLibrary === 'official' 
                      ? 'text-primary bg-primary/10' 
                      : 'text-destructive bg-destructive/10'
                  }`}>
                    {selectedVideos.length} {t.videoSearchModal.itemsUnit}
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
                        className="group bg-muted border border-border rounded-md overflow-hidden hover:transition-all duration-200"
                      >
                        <div className="flex p-2 space-x-3">
                          {/* 视频缩略图 */}
                          <div className="relative w-16 h-10 bg-muted rounded-md overflow-hidden flex-shrink-0">
                            {(video.thumbnail || video.thumbnailUrl) ? (
                              <img 
                                src={video.thumbnail || video.thumbnailUrl} 
                                alt={video.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>

                          {/* 视频信息 */}
                          <div className="flex-1 min-w-0">
                            <h6 className="text-xs font-medium text-foreground truncate mb-1">{video.title}</h6>
                            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                              <span>{video.width} × {video.height}</span>
                              {video.duration && (
                                <span>• {formatDuration(video.duration)}</span>
                              )}
                            </div>
                          </div>

                          {/* 移除按钮 */}
                          <button
                            onClick={() => handleRemoveSelected(video.id)}
                            className="flex-shrink-0 w-5 h-5 rounded-full bg-accent hover:bg-destructive/10 flex items-center justify-center transition-colors duration-200 group"
                          >
                            <svg className="w-3 h-3 text-muted-foreground group-hover:text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center text-muted-foreground">
                      <svg className="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <p className="text-sm font-medium mb-1">{t.videoSearchModal.noSelection}</p>
                      <p className="text-xs">{t.videoSearchModal.noSelectionHint}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-4 border-t border-border bg-muted">
          {/* 错误信息显示区域 */}
          {validationError && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-destructive mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-destructive mb-1">{t.videoSearchModal.validationErrorTitle}</h4>
                <p className="text-sm text-destructive">{validationError}</p>
                <p className="text-xs text-destructive mt-1">{t.videoSearchModal.validationErrorHint}</p>
              </div>
              <button
                onClick={() => setValidationError(null)}
                className="flex-shrink-0 text-destructive hover:text-destructive transition-colors"
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
              className="px-6 py-2.5 text-sm font-medium text-secondary-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors duration-200"
            >
              {t.videoSearchModal.reselectButton}
            </button>
            <button
              onClick={handleConfirmAdd}
              disabled={currentSelectedResults.size === 0}
              className={`px-6 py-2.5 rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 font-medium flex items-center space-x-2 ${
                activeLibrary === 'official' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>{t.videoSearchModal.confirmAddButton} ({currentSelectedResults.size})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoSearchModal; 