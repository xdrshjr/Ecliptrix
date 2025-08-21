import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseVideoSearchReturn, SearchOrientation, VideoLibraryType, YoutubeVideoSearchResult } from '../types';
import { VideoEditingLogger } from '../utils';
import { createVideoSearchService, VideoSearchService, VideoSearchResult } from '../services';
import { createYoutubeVideoSearchService, YoutubeVideoSearchService } from '../services';

export const useVideoSearch = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => boolean
): UseVideoSearchReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useVideoSearch'
  }), [taskId]);

  const videoSearchService = useMemo(() => createVideoSearchService(taskId), [taskId]);
  const youtubeVideoSearchService = useMemo(() => createYoutubeVideoSearchService(taskId), [taskId]);

  // 通用状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOrientation, setSearchOrientation] = useState<SearchOrientation>('mixed');
  const [validationError, setValidationError] = useState<string | null>(null);
  
  // 视频库切换状态
  const [activeLibrary, setActiveLibrary] = useState<VideoLibraryType>('official');
  
  // 官方视频库状态
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<VideoSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set());
  const [previewVideo, setPreviewVideo] = useState<VideoSearchResult | null>(null);
  
  // Youtube视频库状态
  const [isYoutubeSearching, setIsYoutubeSearching] = useState(false);
  const [youtubeSearchResults, setYoutubeSearchResults] = useState<YoutubeVideoSearchResult[]>([]);
  const [youtubeSelectedResults, setYoutubeSelectedResults] = useState<Set<string>>(new Set());
  const [youtubePreviewVideo, setYoutubePreviewVideo] = useState<YoutubeVideoSearchResult | null>(null);

  const openSearchModal = useCallback((initialKeywords?: string[]) => {
    logger.userAction('打开视频搜索模态框', 'searchButton', {
      hasInitialKeywords: !!initialKeywords,
      keywordCount: initialKeywords?.length || 0,
      keywords: initialKeywords,
      activeLibrary
    });
    
    // 如果有初始关键词，自动填充搜索框
    if (initialKeywords && initialKeywords.length > 0) {
      const keywordsString = initialKeywords.join(' ');
      setSearchQuery(keywordsString);
      logger.info('自动填充搜索关键词', {
        keywords: initialKeywords,
        searchQuery: keywordsString,
        activeLibrary
      });
    }
    
    setIsModalOpen(true);
  }, [logger, activeLibrary]);

  const closeSearchModal = useCallback(() => {
    setIsModalOpen(false);
    setSearchQuery('');
    
    // 清理官方视频库状态
    setSearchResults([]);
    setSelectedResults(new Set());
    setPreviewVideo(null);
    
    // 清理Youtube视频库状态
    setYoutubeSearchResults([]);
    setYoutubeSelectedResults(new Set());
    setYoutubePreviewVideo(null);
    
    setValidationError(null);
    logger.userAction('关闭视频搜索模态框', 'closeButton', { activeLibrary });
  }, [logger, activeLibrary]);

  const handleVideoPreview = useCallback((video: VideoSearchResult) => {
    setPreviewVideo(video);
    logger.userAction('预览官方视频', 'videoPreview', {
      videoId: video.id,
      videoTitle: video.title,
      videoAuthor: video.author,
      videoDimensions: `${video.width}x${video.height}`,
      videoDuration: video.duration,
      hasVideoUrl: !!video.video_url
    });
  }, [logger]);

  const handleYoutubeVideoPreview = useCallback((video: YoutubeVideoSearchResult) => {
    setYoutubePreviewVideo(video);
    logger.userAction('预览Youtube视频', 'youtubeVideoPreview', {
      videoId: video.id,
      videoTitle: video.title,
      channelTitle: video.channelTitle,
      videoDimensions: `${video.width}x${video.height}`,
      videoDuration: video.duration,
      viewCount: video.viewCount,
      hasVideoUrl: !!video.videoUrl
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
        logger.info('官方视频搜索成功', {
          totalFound: result.total_found,
          videosCount: result.videos.length
        });
      } else {
        alert(result.error || result.message || '搜索失败，请稍后重试');
        logger.warn('官方视频搜索无结果', {
          error: result.error,
          message: result.message
        });
      }
    } catch (error) {
      logger.error('官方视频搜索异常', error as Error);
      alert('搜索失败，请检查网络连接');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchOrientation, logger, videoSearchService]);

  const handleYoutubeSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      alert('请输入搜索关键词');
      return;
    }

    setIsYoutubeSearching(true);
    setYoutubeSearchResults([]);
    setYoutubePreviewVideo(null);

    try {
      // 使用Youtube视频搜索服务进行搜索
      const result = await youtubeVideoSearchService.searchVideos({
        query: searchQuery,
        maxVideos: 20,
        orientation: searchOrientation
      });

      if (result.success && result.videos) {
        setYoutubeSearchResults(result.videos);
        logger.info('Youtube视频搜索成功', {
          totalFound: result.total_found,
          videosCount: result.videos.length,
          isMockData: true
        });
      } else {
        alert(result.error || result.message || '搜索失败，请稍后重试');
        logger.warn('Youtube视频搜索无结果', {
          error: result.error,
          message: result.message
        });
      }
    } catch (error) {
      logger.error('Youtube视频搜索异常', error as Error);
      alert('搜索失败，请检查网络连接');
    } finally {
      setIsYoutubeSearching(false);
    }
  }, [searchQuery, searchOrientation, logger, youtubeVideoSearchService]);

  const handleSearchResultSelect = useCallback((videoId: number | string, isSelected: boolean) => {
    if (typeof videoId === 'number') {
      // 官方视频库
      setSelectedResults(prev => {
        const newSet = new Set(prev);
        if (isSelected) {
          newSet.add(videoId);
        } else {
          newSet.delete(videoId);
        }
        return newSet;
      });
      
      logger.userAction('选择官方视频', isSelected ? 'select' : 'deselect', {
        videoId,
        totalSelected: isSelected ? selectedResults.size + 1 : selectedResults.size - 1
      });
    } else {
      // Youtube视频库
      handleYoutubeResultSelect(videoId, isSelected);
    }
  }, [selectedResults.size, logger]);

  const handleYoutubeResultSelect = useCallback((videoId: string, isSelected: boolean) => {
    setYoutubeSelectedResults(prev => {
      const newSet = new Set(prev);
      if (isSelected) {
        newSet.add(videoId);
      } else {
        newSet.delete(videoId);
      }
      return newSet;
    });
    
    logger.userAction('选择Youtube视频', isSelected ? 'select' : 'deselect', {
      videoId,
      totalSelected: isSelected ? youtubeSelectedResults.size + 1 : youtubeSelectedResults.size - 1
    });
  }, [youtubeSelectedResults.size, logger]);

  const handleAddSelectedVideos = useCallback(() => {
    if (activeLibrary === 'official') {
      const selectedVideos = searchResults.filter(video => selectedResults.has(video.id));
      
      if (selectedVideos.length === 0) {
        alert('请先选择要添加的视频');
        return;
      }

      logger.info('开始添加选中的官方视频', {
        selectedCount: selectedVideos.length,
        videoIds: selectedVideos.map(v => v.id)
      });

      const materials = videoSearchService.convertToMaterials(selectedVideos);
      const success = onAddMaterials(materials);

      if (success) {
        logger.info('官方视频添加成功', {
          addedCount: materials.length,
          materialIds: materials.map(m => m.id)
        });
        closeSearchModal();
      } else {
        logger.warn('官方视频添加失败', {
          attemptedCount: materials.length
        });
      }
    } else {
      handleAddSelectedYoutubeVideos();
    }
  }, [activeLibrary, searchResults, selectedResults, logger, videoSearchService, onAddMaterials, closeSearchModal]);

  const handleAddSelectedYoutubeVideos = useCallback(() => {
    const selectedVideos = youtubeSearchResults.filter(video => youtubeSelectedResults.has(video.id));
    
    if (selectedVideos.length === 0) {
      alert('请先选择要添加的Youtube视频');
      return;
    }

    logger.info('开始添加选中的Youtube视频', {
      selectedCount: selectedVideos.length,
      videoIds: selectedVideos.map(v => v.id)
    });

    const materials = youtubeVideoSearchService.convertToMaterials(selectedVideos);
    const success = onAddMaterials(materials);

    if (success) {
      logger.info('Youtube视频添加成功', {
        addedCount: materials.length,
        materialIds: materials.map(m => m.id)
      });
      closeSearchModal();
    } else {
      logger.warn('Youtube视频添加失败', {
        attemptedCount: materials.length
      });
    }
  }, [youtubeSearchResults, youtubeSelectedResults, logger, youtubeVideoSearchService, onAddMaterials, closeSearchModal]);

  const handleClearSelection = useCallback(() => {
    if (activeLibrary === 'official') {
      setSelectedResults(new Set());
      logger.userAction('清空官方视频选择', 'clearSelection');
    } else {
      handleClearYoutubeSelection();
    }
  }, [activeLibrary, logger]);

  const handleClearYoutubeSelection = useCallback(() => {
    setYoutubeSelectedResults(new Set());
    logger.userAction('清空Youtube视频选择', 'clearYoutubeSelection');
  }, [logger]);

  const handleLibrarySwitch = useCallback((library: VideoLibraryType) => {
    logger.userAction('切换视频库', 'librarySwitch', {
      fromLibrary: activeLibrary,
      toLibrary: library
    });
    
    setActiveLibrary(library);
    
    // 清理当前预览状态
    setPreviewVideo(null);
    setYoutubePreviewVideo(null);
    setValidationError(null);
  }, [activeLibrary, logger]);

  return {
    // 通用状态
    isModalOpen,
    searchQuery,
    searchOrientation,
    validationError,
    
    // 视频库相关状态
    activeLibrary,
    
    // 官方视频库状态
    isSearching,
    searchResults,
    selectedResults,
    previewVideo,
    
    // Youtube视频库状态
    isYoutubeSearching,
    youtubeSearchResults,
    youtubeSelectedResults,
    youtubePreviewVideo,
    
    // 通用方法
    openSearchModal,
    closeSearchModal,
    setSearchQuery,
    setSearchOrientation,
    setValidationError,
    
    // 视频库切换方法
    setActiveLibrary: handleLibrarySwitch,
    
    // 官方视频库方法
    handleSearch,
    handleVideoPreview,
    handleSearchResultSelect,
    handleAddSelectedVideos,
    handleClearSelection,
    
    // Youtube视频库方法
    handleYoutubeSearch,
    handleYoutubeVideoPreview,
    handleYoutubeResultSelect,
    handleAddSelectedYoutubeVideos,
    handleClearYoutubeSelection,
    
    taskId
  };
};