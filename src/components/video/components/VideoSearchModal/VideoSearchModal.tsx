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
      logger.info('模态框打开 - 分栏布局', {
        searchQuery,
        searchOrientation,
        previousResultsCount: searchResults.length,
        layoutType: 'split_panel'
      });
    }
  }, [isModalOpen]);

  useEffect(() => {
    if (previewVideo && videoRef.current) {
      logger.info('视频预览加载 - 优化布局', {
        videoId: previewVideo.id,
        videoTitle: previewVideo.title,
        hasVideoUrl: !!previewVideo.video_url,
        layoutOptimization: 'fixed_aspect_ratio_with_scrollable_info'
      });
    }
  }, [previewVideo]);

  const handleClose = () => {
    logger.info('模态框关闭', {
      searchQuery,
      resultsCount: searchResults.length,
      selectedCount: selectedResults.size,
      previewVideoId: previewVideo?.id
    });
    
    closeSearchModal();
  };

  const handleSearchClick = () => {
    logger.info('执行搜索', {
      query: searchQuery,
      orientation: searchOrientation,
      queryLength: searchQuery.length
    });
    
    handleSearch();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      logger.info('回车键搜索', {
        query: searchQuery,
        orientation: searchOrientation
      });
      
      handleSearch();
    }
  };

  const handleResultSelect = (videoId: number, isSelected: boolean) => {
    logger.info('搜索结果选择', {
      videoId,
      isSelected,
      totalSelected: selectedResults.size + (isSelected ? 1 : -1),
      totalResults: searchResults.length
    });
    
    handleSearchResultSelect(videoId, isSelected);
  };

  const handleVideoClick = (video: any) => {
    logger.info('视频点击预览', {
      videoId: video.id,
      videoTitle: video.title,
      clickAction: 'preview_and_select'
    });
    
    handleVideoPreview(video);
    // 同时选择该视频
    const isCurrentlySelected = selectedResults.has(video.id);
    handleSearchResultSelect(video.id, !isCurrentlySelected);
  };

  const handleAddVideos = () => {
    logger.info('添加选中视频', {
      selectedCount: selectedResults.size,
      totalResults: searchResults.length,
      selectedIds: Array.from(selectedResults),
      previewVideoId: previewVideo?.id
    });
    
    handleAddSelectedVideos();
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return '';
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!isModalOpen) return null;

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
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
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
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder-gray-400 text-gray-900"
                disabled={isSearching}
              />
            </div>
            <div className="flex items-center space-x-3">
              <label className="text-sm font-medium text-gray-700">方向:</label>
              <select
                value={searchOrientation}
                onChange={(e) => setSearchOrientation(e.target.value as any)}
                className="px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
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
              className="px-6 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center space-x-2 font-medium shadow-sm"
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
            {/* 结果统计和操作栏 */}
            {searchResults.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/30 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  找到 <span className="font-semibold text-gray-900">{searchResults.length}</span> 个视频，已选择 <span className="font-semibold text-blue-600">{selectedResults.size}</span> 个
                </div>
                <button
                  onClick={handleAddVideos}
                  disabled={selectedResults.size === 0}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium shadow-sm flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>添加选中 ({selectedResults.size})</span>
                </button>
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
                        className={`group relative bg-white border rounded-xl overflow-hidden hover:shadow-md transition-all cursor-pointer ${
                          isSelected ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200 hover:border-gray-300'
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
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
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

          {/* 右侧 - 视频预览区域 */}
          <div className="w-2/5 bg-gray-50/30 flex flex-col">
            {previewVideo ? (
              <>
                {/* 预览视频标题栏 */}
                <div className="px-6 py-4 border-b border-gray-100 bg-white">
                  <h3 className="font-semibold text-gray-900 truncate">{previewVideo.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">作者: {previewVideo.author}</p>
                </div>

                {/* 视频播放器区域 */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* 视频播放器 - 固定比例，避免过度拉伸 */}
                  <div className="flex-shrink-0 mx-6 mt-6 mb-4">
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
                              <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              <p>无预览视频</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 视频信息区域 - 可滚动，确保始终可见 */}
                  <div className="flex-shrink-0 px-6 pb-6 overflow-y-auto">
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                          <span className="text-gray-500">分辨率</span>
                          <p className="font-semibold text-gray-900">{previewVideo.width} × {previewVideo.height}</p>
                        </div>
                        {previewVideo.duration && (
                          <div className="bg-white p-3 rounded-lg border border-gray-200">
                            <span className="text-gray-500">时长</span>
                            <p className="font-semibold text-gray-900">{formatDuration(previewVideo.duration)}</p>
                          </div>
                        )}
                      </div>
                      
                      <button
                        onClick={() => handleResultSelect(previewVideo.id, !selectedResults.has(previewVideo.id))}
                        className={`w-full py-3 rounded-lg font-medium transition-all ${
                          selectedResults.has(previewVideo.id)
                            ? 'bg-green-500 text-white hover:bg-green-600'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                        }`}
                      >
                        {selectedResults.has(previewVideo.id) ? '已选择 ✓' : '选择此视频'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <svg className="w-20 h-20 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p className="text-lg font-medium mb-2">点击视频进行预览</p>
                  <p className="text-sm">在左侧选择一个视频来查看详情</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoSearchModal; 