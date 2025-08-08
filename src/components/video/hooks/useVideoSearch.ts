import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseVideoSearchReturn, SearchOrientation } from '../types';
import { VideoEditingLogger } from '../utils';
import { createVideoSearchService, VideoSearchService, VideoSearchResult } from '../services';

export const useVideoSearch = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => void
): UseVideoSearchReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useVideoSearch'
  }), [taskId]);

  const videoSearchService = useMemo(() => createVideoSearchService(taskId), [taskId]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOrientation, setSearchOrientation] = useState<SearchOrientation>('mixed');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<VideoSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set());

  const openSearchModal = useCallback(() => {
    logger.userAction('打开视频搜索模态框', 'searchButton');
    setIsModalOpen(true);
  }, [logger]);

  const closeSearchModal = useCallback(() => {
    setIsModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResults(new Set());
    logger.userAction('关闭视频搜索模态框', 'closeButton');
  }, [logger]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      alert('请输入搜索关键词');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    try {
      // 使用视频搜索服务进行搜索
      const result = await videoSearchService.searchVideos({
        query: searchQuery,
        maxVideos: 20,
        orientation: searchOrientation
      });

      if (result.success && result.videos) {
        setSearchResults(result.videos);
        logger.info('视频搜索成功', {
          totalFound: result.total_found,
          videosCount: result.videos.length
        });
      } else {
        alert(result.error || result.message || '搜索失败，请稍后重试');
        logger.warn('视频搜索无结果', {
          error: result.error,
          message: result.message
        });
      }
    } catch (error) {
      logger.error('视频搜索异常', error as Error);
      alert('搜索失败，请检查网络连接');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchOrientation, logger, videoSearchService]);

  const handleSearchResultSelect = useCallback((videoId: number, isSelected: boolean) => {
    const newSelection = new Set(selectedResults);
    if (isSelected) {
      newSelection.add(videoId);
    } else {
      newSelection.delete(videoId);
    }
    setSelectedResults(newSelection);

    logger.userAction('搜索结果选择', 'videoCard', {
      videoId,
      isSelected,
      totalSelected: newSelection.size
    });
  }, [selectedResults, logger]);

  const handleAddSelectedVideos = useCallback(() => {
    const selectedVideos = searchResults.filter(video => selectedResults.has(video.id));
    
    logger.info('添加选中视频到素材库', {
      selectedCount: selectedVideos.length,
      videoIds: selectedVideos.map(v => v.id)
    });

    if (selectedVideos.length === 0) {
      alert('请先选择要添加的视频');
      return;
    }

    // 使用视频搜索服务将视频转换为素材项
    const newMaterials = videoSearchService.convertToMaterials(selectedVideos);

    onAddMaterials(newMaterials);

    setSelectedResults(new Set());
    setIsModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  }, [searchResults, selectedResults, onAddMaterials, videoSearchService]);

  return {
    isModalOpen,
    searchQuery,
    searchOrientation,
    isSearching,
    searchResults,
    selectedResults,
    openSearchModal,
    closeSearchModal,
    handleSearch,
    handleSearchResultSelect,
    handleAddSelectedVideos,
    setSearchQuery,
    setSearchOrientation
  };
};