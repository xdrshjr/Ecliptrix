'use client';

import React, { useEffect, useRef, useState } from 'react';
import { UseAudioSearchReturn } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

interface AudioSearchModalProps extends UseAudioSearchReturn {
}

const AudioSearchModal: React.FC<AudioSearchModalProps> = ({
  isModalOpen,
  searchQuery,
  isSearching,
  searchResults,
  selectedResults,
  previewAudio,
  validationError,
  durationMin,
  durationMax,
  audioType,
  closeSearchModal,
  handleSearch,
  handleSearchResultSelect,
  handleAudioPreview,
  handleAddSelectedAudios,
  handleClearSelection,
  setSearchQuery,
  setDurationMin,
  setDurationMax,
  setAudioType,
  setValidationError,
  taskId
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'AudioSearchModal'
  });

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);

  useEffect(() => {
    if (isModalOpen) {
      logger.info('音频搜索模态框打开', {
        searchQuery,
        previousResultsCount: searchResults.length,
        previousSelectionCount: selectedResults.size,
        durationFilter: {
          min: durationMin,
          max: durationMax
        },
        audioType: audioType
      });
    }
  }, [isModalOpen]);

  useEffect(() => {
    logger.info('音频选择状态变化', {
      selectionCount: selectedResults.size,
      selectedAudioIds: Array.from(selectedResults),
      totalResults: searchResults.length,
      selectionRatio: searchResults.length > 0 ? selectedResults.size / searchResults.length : 0
    });
  }, [selectedResults]);

  const handleClose = () => {
    // 停止音频播放
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingAudioId(null);
    }
    
    logger.info('音频搜索模态框关闭', {
      searchQuery,
      resultsCount: searchResults.length,
      selectedCount: selectedResults.size,
      userAction: 'close_button'
    });
    
    closeSearchModal();
  };

  const handleSearchClick = () => {
    logger.info('执行音频搜索', {
      query: searchQuery,
      queryLength: searchQuery.length,
      durationMin,
      durationMax,
      audioType,
      userAction: 'search_button'
    });
    
    handleSearch();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchClick();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    }
  };

  const handleAudioPlay = async (audio: any, index: number) => {
    try {
      // 停止当前播放的音频
      if (audioRef.current) {
        audioRef.current.pause();
      }

      if (playingAudioId === audio.id) {
        // 如果点击的是当前播放的音频，则停止播放
        setPlayingAudioId(null);
        logger.userAction('停止音频播放', 'audioStop', {
          audioId: audio.id,
          audioName: audio.name
        });
        return;
      }

      // 播放新音频
      const audioElement = new Audio(audio.preview_url);
      audioRef.current = audioElement;
      setPlayingAudioId(audio.id);

      audioElement.onended = () => {
        setPlayingAudioId(null);
      };

      audioElement.onerror = () => {
        setPlayingAudioId(null);
        logger.error('音频播放失败', new Error('Audio playback failed'), {
          audioId: audio.id,
          previewUrl: audio.preview_url
        });
      };

      await audioElement.play();
      
      logger.userAction('开始音频播放', 'audioPlay', {
        audioId: audio.id,
        audioName: audio.name,
        duration: audio.duration,
        previewUrl: audio.preview_url
      });

    } catch (error) {
      setPlayingAudioId(null);
      logger.error('音频播放异常', error as Error, {
        audioId: audio.id,
        audioName: audio.name
      });
    }
  };

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`;
  };

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-6xl h-5/6 flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">搜索音频</h2>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="关闭"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 搜索区域 */}
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex flex-col space-y-4">
            {/* 搜索输入 */}
            <div className="flex space-x-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入音频搜索关键词，如：ambient music, nature sounds..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isSearching}
              />
              <button
                onClick={handleSearchClick}
                disabled={isSearching || !searchQuery.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSearching ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>搜索中...</span>
                  </div>
                ) : (
                  '搜索'
                )}
              </button>
            </div>

            {/* 过滤器区域 */}
            <div className="flex items-center space-x-6">
              {/* 音频类型选择器 */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">音频类型：</span>
                <select
                  value={audioType}
                  onChange={(e) => setAudioType(e.target.value as any)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={isSearching}
                >
                  <option value="all">全部</option>
                  <option value="music">音乐</option>
                  <option value="sound-effect">音效</option>
                  <option value="speech">语音</option>
                  <option value="ambient">环境音</option>
                  <option value="nature">自然音</option>
                </select>
              </div>

              {/* 时长过滤器 */}
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">时长过滤：</span>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    value={durationMin || ''}
                    onChange={(e) => setDurationMin(e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="最小(秒)"
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    min="0"
                  />
                  <span className="text-sm text-gray-500">至</span>
                  <input
                    type="number"
                    value={durationMax || ''}
                    onChange={(e) => setDurationMax(e.target.value ? parseFloat(e.target.value) : null)}
                    placeholder="最大(秒)"
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    min="0"
                  />
                </div>
              </div>
            </div>

            {/* 错误信息 */}
            {validationError && (
              <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                {validationError}
              </div>
            )}
          </div>
        </div>

        {/* 主要内容区域 */}
        <div className="flex-1 flex">
          {/* 搜索结果列表 */}
          <div className="flex-1 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-800">
                搜索结果 {searchResults.length > 0 && `(${searchResults.length} 个音频)`}
              </h3>
              {searchResults.length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">已选择: {selectedResults.size}</span>
                  {selectedResults.size > 0 && (
                    <button
                      onClick={handleClearSelection}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      清空选择
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {searchResults.map((audio, index) => (
                <div
                  key={audio.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedResults.has(index)
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => handleSearchResultSelect(index)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-medium text-gray-900 truncate">{audio.name}</h4>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                          {audio.license}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{audio.username}</p>
                      <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                        <span>{formatDuration(audio.duration)}</span>
                        {audio.filesize && <span>{formatFileSize(audio.filesize)}</span>}
                        {audio.type && <span>{audio.type.toUpperCase()}</span>}
                        {audio.channels && <span>{audio.channels} 声道</span>}
                      </div>
                      {audio.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {audio.tags.slice(0, 5).map((tag, tagIndex) => (
                            <span
                              key={tagIndex}
                              className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                          {audio.tags.length > 5 && (
                            <span className="text-xs text-gray-500">+{audio.tags.length - 5}</span>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* 播放按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAudioPlay(audio, index);
                      }}
                      className="ml-2 p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                      title="播放预览"
                    >
                      {playingAudioId === audio.id ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              ))}

              {!isSearching && searchResults.length === 0 && searchQuery && (
                <div className="text-center py-8 text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p>未找到相关音频</p>
                  <p className="text-sm mt-1">尝试使用不同的关键词或调整时长过滤器</p>
                </div>
              )}

              {!searchQuery && (
                <div className="text-center py-8 text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  <p>输入关键词开始搜索音频</p>
                  <p className="text-sm mt-1">支持搜索环境音、音效、音乐等各类音频</p>
                </div>
              )}
            </div>
          </div>

          {/* 预览面板 */}
          {previewAudio && (
            <div className="w-80 border-l border-gray-200 p-4">
              <h3 className="text-lg font-medium text-gray-800 mb-4">音频预览</h3>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-gray-900">{previewAudio.name}</h4>
                  <p className="text-sm text-gray-600 mt-1">by {previewAudio.username}</p>
                </div>
                
                {previewAudio.description && (
                  <div>
                    <h5 className="text-sm font-medium text-gray-700">描述</h5>
                    <p className="text-sm text-gray-600 mt-1">{previewAudio.description}</p>
                  </div>
                )}

                <div>
                  <h5 className="text-sm font-medium text-gray-700">音频信息</h5>
                  <div className="text-sm text-gray-600 mt-1 space-y-1">
                    <div>时长: {formatDuration(previewAudio.duration)}</div>
                    <div>许可证: {previewAudio.license}</div>
                    {previewAudio.filesize && <div>大小: {formatFileSize(previewAudio.filesize)}</div>}
                    {previewAudio.type && <div>格式: {previewAudio.type.toUpperCase()}</div>}
                    {previewAudio.channels && <div>声道: {previewAudio.channels}</div>}
                    {previewAudio.samplerate && <div>采样率: {previewAudio.samplerate}Hz</div>}
                  </div>
                </div>

                {previewAudio.tags.length > 0 && (
                  <div>
                    <h5 className="text-sm font-medium text-gray-700">标签</h5>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {previewAudio.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {selectedResults.size > 0 && `已选择 ${selectedResults.size} 个音频`}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddSelectedAudios}
                disabled={selectedResults.size === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                添加选中音频 ({selectedResults.size})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioSearchModal; 