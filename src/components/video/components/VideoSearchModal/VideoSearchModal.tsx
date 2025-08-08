'use client';

import React, { useEffect } from 'react';
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
  closeSearchModal,
  handleSearch,
  handleSearchResultSelect,
  handleAddSelectedVideos,
  setSearchQuery,
  setSearchOrientation,
  taskId
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoSearchModal'
  });

  useEffect(() => {
    if (isModalOpen) {
      logger.info('模态框打开', {
        searchQuery,
        searchOrientation,
        previousResultsCount: searchResults.length
      });
    }
  }, [isModalOpen]);

  const handleClose = () => {
    logger.info('模态框关闭', {
      searchQuery,
      resultsCount: searchResults.length,
      selectedCount: selectedResults.size
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

  const handleAddVideos = () => {
    logger.info('添加选中视频', {
      selectedCount: selectedResults.size,
      totalResults: searchResults.length,
      selectedIds: Array.from(selectedResults)
    });
    
    handleAddSelectedVideos();
  };

  if (!isModalOpen) return null;

  return (
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
            onClick={handleClose}
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                disabled={isSearching}
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="text-sm text-gray-700">方向:</label>
              <select
                value={searchOrientation}
                onChange={(e) => setSearchOrientation(e.target.value as any)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
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

        {/* 搜索结果区域 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {searchResults.length > 0 && (
            <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                找到 {searchResults.length} 个视频，已选择 {selectedResults.size} 个
              </div>
              <button
                onClick={handleAddVideos}
                disabled={selectedResults.size === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>添加选中视频 ({selectedResults.size})</span>
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6">
            {isSearching ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <svg className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p className="text-gray-600">正在搜索视频...</p>
                </div>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {searchResults.map((video) => {
                  const isSelected = selectedResults.has(video.id);
                  return (
                    <div
                      key={video.id}
                      className={`relative bg-white border rounded-lg overflow-hidden hover:shadow-lg transition-all cursor-pointer ${
                        isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      }`}
                      onClick={() => handleResultSelect(video.id, !isSelected)}
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
  );
};

export default VideoSearchModal; 