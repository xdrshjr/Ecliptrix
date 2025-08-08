import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseVideoSearchReturn, SearchOrientation } from '../types';
import { VideoEditingLogger } from '../utils';

export const useVideoSearch = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => void
): UseVideoSearchReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useVideoSearch'
  }), [taskId]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOrientation, setSearchOrientation] = useState<SearchOrientation>('mixed');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
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

    const startTime = performance.now();
    logger.apiCall('开始视频搜索', '/api/video-search', {
      query: searchQuery,
      orientation: searchOrientation
    });

    setIsSearching(true);
    setSearchResults([]);

    try {
      const response = await fetch('/api/video-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: searchQuery,
          max_videos: 20,
          orientation: searchOrientation,
        }),
      });

      const data = await response.json();
      const endTime = performance.now();

      logger.apiComplete('视频搜索', '/api/video-search', data.success, endTime - startTime, {
        totalFound: data.total_found,
        videosCount: data.videos?.length || 0
      });

      if (data.success && data.videos) {
        setSearchResults(data.videos);
      } else {
        alert(data.message || '搜索失败，请稍后重试');
      }
    } catch (error) {
      const endTime = performance.now();
      logger.apiError('视频搜索', '/api/video-search', error as Error, {
        responseTime: endTime - startTime
      });
      alert('搜索失败，请检查网络连接');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchOrientation, logger]);

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

    const newMaterials: MaterialItem[] = selectedVideos.map(video => ({
      id: `pexels-${video.id}`,
      name: video.title,
      type: 'video' as MaterialType,
      format: 'mp4',
      size: 0,
      duration: video.duration || 0,
      width: video.width,
      height: video.height,
      thumbnailUrl: video.thumbnail,
      url: video.video_url,
      createdAt: new Date(),
      tags: ['PEXELS', '在线素材', video.author],
      description: `来自PEXELS的视频素材，作者：${video.author}`
    }));

    onAddMaterials(newMaterials);

    setSelectedResults(new Set());
    setIsModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  }, [searchResults, selectedResults, onAddMaterials]);

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