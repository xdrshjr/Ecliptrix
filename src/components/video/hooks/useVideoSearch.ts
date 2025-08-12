import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseVideoSearchReturn, SearchOrientation } from '../types';
import { VideoEditingLogger } from '../utils';
import { createVideoSearchService, VideoSearchService, VideoSearchResult } from '../services';

export const useVideoSearch = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => boolean
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
  const [previewVideo, setPreviewVideo] = useState<VideoSearchResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const openSearchModal = useCallback(() => {
    logger.userAction('打开视频搜索模态框', 'searchButton');
    setIsModalOpen(true);
  }, [logger]);

  const closeSearchModal = useCallback(() => {
    setIsModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResults(new Set());
    setPreviewVideo(null);
    setValidationError(null);
    logger.userAction('关闭视频搜索模态框', 'closeButton');
  }, [logger]);

  const handleVideoPreview = useCallback((video: VideoSearchResult) => {
    setPreviewVideo(video);
    logger.userAction('预览视频', 'videoPreview', {
      videoId: video.id,
      videoTitle: video.title,
      videoAuthor: video.author,
      videoDimensions: `${video.width}x${video.height}`,
      videoDuration: video.duration,
      hasVideoUrl: !!video.video_url
    });
  }, [logger]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      alert('请输入搜索关键词');
      return;
    }

          setIsSearching(true);
    setSearchResults([]);
    setPreviewVideo(null);

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
    
    logger.info('开始添加选中视频到素材库', {
      selectedCount: selectedVideos.length,
      videoIds: selectedVideos.map(v => v.id),
      selectedVideosDetail: selectedVideos.map(v => ({
        id: v.id,
        title: v.title,
        hasVideoUrl: !!v.video_url
      }))
    });

    if (selectedVideos.length === 0) {
      alert('请先选择要添加的视频');
      logger.warn('添加视频失败 - 未选择任何视频');
      return;
    }

    // 使用视频搜索服务将视频转换为素材项
    const newMaterials = videoSearchService.convertToMaterials(selectedVideos);
    
    logger.info('视频转换为素材项完成', {
      convertedCount: newMaterials.length,
      materialsDetail: newMaterials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        hasUrl: !!m.url
      }))
    });

    // 调用回调函数添加素材
    const success = onAddMaterials(newMaterials);
    
    logger.info('素材添加回调完成', {
      attemptedCount: newMaterials.length,
      success: success
    });

    // 只有成功时才清除选择状态并关闭模态框
    if (success) {
      setSelectedResults(new Set());
      setIsModalOpen(false);
      setSearchQuery('');
      setSearchResults([]);
      setPreviewVideo(null);
      
      logger.info('视频添加成功，模态框已关闭', {
        addedVideosCount: newMaterials.length,
        modalClosed: true
      });
    } else {
      logger.info('视频添加失败，模态框保持开启等待用户调整', {
        attemptedCount: newMaterials.length,
        modalStaysOpen: true
      });
    }
  }, [searchResults, selectedResults, onAddMaterials, videoSearchService, logger]);

  const handleClearSelection = useCallback(() => {
    logger.info('用户清除所有选择', {
      previousSelectionCount: selectedResults.size,
      selectedVideoIds: Array.from(selectedResults)
    });
    
    setSelectedResults(new Set());
    
    logger.info('选择状态已清除', {
      currentSelectionCount: 0
    });
  }, [selectedResults, logger]);

  return {
    isModalOpen,
    searchQuery,
    searchOrientation,
    isSearching,
    searchResults,
    selectedResults,
    previewVideo,
    validationError,
    openSearchModal,
    closeSearchModal,
    handleSearch,
    handleSearchResultSelect,
    handleVideoPreview,
    handleAddSelectedVideos,
    handleClearSelection,
    setSearchQuery,
    setSearchOrientation,
    setValidationError,
    taskId
  };
};