import { useState, useCallback, useMemo, useEffect } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseVideoSearchReturn, SearchOrientation, VideoLibraryType, YoutubeVideoSearchResult, YoutubeDurationRange, YoutubeDurationPreset } from '../types';
import { VideoEditingLogger } from '../utils';
import { createVideoSearchService, VideoSearchService, VideoSearchResult } from '../services';
import { createYoutubeVideoSearchService, YoutubeVideoSearchService } from '../services';
import { getMaxConcurrentDownloads } from '@/lib/api/config';

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

  // 加载YouTube配置
  useEffect(() => {
    const loadYoutubeConfig = async () => {
      try {
        logger.info('开始加载YouTube配置', { taskId });
        const concurrentDownloads = await getMaxConcurrentDownloads();
        setMaxConcurrentDownloads(concurrentDownloads);
        logger.info('YouTube配置加载成功', { 
          taskId,
          maxConcurrentDownloads: concurrentDownloads 
        });
      } catch (error) {
        logger.error('YouTube配置加载失败，使用默认值', error as Error, { 
          taskId,
          defaultValue: 3 
        });
        // 保持默认值3
      }
    };

    loadYoutubeConfig();
  }, [taskId, logger]);

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
  
  // YouTube配置状态
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(3); // 默认值
  
  // YouTube时间范围状态
  const [youtubeDurationRange, setYoutubeDurationRange] = useState<YoutubeDurationRange>({
    minDuration: 0,
    maxDuration: 300 // 默认5分钟
  });
  const [youtubeDurationPreset, setYoutubeDurationPresetState] = useState<YoutubeDurationPreset>('under_5min');

  // 处理YouTube时间预设变化
  const handleYoutubeDurationPresetChange = useCallback((preset: YoutubeDurationPreset) => {
    setYoutubeDurationPresetState(preset);
    
    // 根据预设更新时间范围
    let newRange: YoutubeDurationRange | undefined;
    switch (preset) {
      case 'under_1min':
        newRange = { minDuration: 0, maxDuration: 60 };
        break;
      case 'under_3min':
        newRange = { minDuration: 0, maxDuration: 180 };
        break;
      case 'under_5min':
        newRange = { minDuration: 0, maxDuration: 300 };
        break;
      case 'under_10min':
        newRange = { minDuration: 0, maxDuration: 600 };
        break;
      case 'custom':
        // 自定义模式不自动更新范围
        newRange = undefined;
        break;
      default:
        newRange = { minDuration: 0, maxDuration: 300 };
    }
    
    if (newRange) {
      setYoutubeDurationRange(newRange);
    }
    
    logger.userAction('YouTube时间预设变化', 'durationPresetChange', {
      preset,
      newRange: preset !== 'custom' ? newRange : undefined,
      activeLibrary
    });
  }, [logger, activeLibrary]);

  // 处理自定义时间范围变化
  const handleYoutubeDurationRangeChange = useCallback((range: YoutubeDurationRange) => {
    setYoutubeDurationRange(range);
    
    // 如果不是预设范围，切换到自定义模式
    const isPresetRange = 
      (range.minDuration === 0 && range.maxDuration === 60) ||   // 1分钟
      (range.minDuration === 0 && range.maxDuration === 180) ||  // 3分钟
      (range.minDuration === 0 && range.maxDuration === 300) ||  // 5分钟
      (range.minDuration === 0 && range.maxDuration === 600);    // 10分钟
    
    if (!isPresetRange && youtubeDurationPreset !== 'custom') {
      setYoutubeDurationPresetState('custom');
    }
    
    logger.userAction('YouTube自定义时间范围变化', 'durationRangeChange', {
      range,
      wasPresetRange: isPresetRange,
      currentPreset: youtubeDurationPreset,
      activeLibrary
    });
  }, [youtubeDurationPreset, logger, activeLibrary]);

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
        orientation: searchOrientation,
        minDuration: youtubeDurationRange.minDuration,
        maxDuration: youtubeDurationRange.maxDuration
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
  }, [searchQuery, searchOrientation, youtubeDurationRange, logger, youtubeVideoSearchService]);

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

  const handleAddSelectedYoutubeVideos = useCallback(async () => {
    const selectedVideos = youtubeSearchResults.filter(video => youtubeSelectedResults.has(video.id));
    
    if (selectedVideos.length === 0) {
      alert('请先选择要添加的Youtube视频');
      return;
    }

    logger.info('开始添加选中的Youtube视频', {
      selectedCount: selectedVideos.length,
      videoIds: selectedVideos.map(v => v.id)
    });

    // 转换为素材并设置初始下载状态
    const materials = youtubeVideoSearchService.convertToMaterials(selectedVideos).map(material => ({
      ...material,
      downloadStatus: 'downloading' as const,
      downloadProgress: 0,
      youtubeUrl: selectedVideos.find(v => v.id === material.id)?.videoUrl || material.url
    }));

    const success = onAddMaterials(materials);

    if (success) {
      logger.info('Youtube视频添加成功，开始下载', {
        addedCount: materials.length,
        materialIds: materials.map(m => m.id)
      });
      
      // 关闭搜索模态框
      closeSearchModal();
      
      // 并发下载视频，使用配置的线程数
      logger.info('开始并发下载YouTube视频', {
        materialCount: materials.length,
        maxConcurrentDownloads,
        configSource: 'youtube.yaml'
      });
      downloadVideosInParallel(materials, maxConcurrentDownloads);
    } else {
      logger.warn('Youtube视频添加失败', {
        attemptedCount: materials.length
      });
    }
  }, [youtubeSearchResults, youtubeSelectedResults, logger, youtubeVideoSearchService, onAddMaterials, closeSearchModal, taskId, maxConcurrentDownloads]);

  // 下载单个视频的函数
  const downloadSingleVideo = useCallback(async (material: MaterialItem): Promise<void> => {
    try {
      logger.info('开始下载单个YouTube视频', {
        materialId: material.id,
        youtubeUrl: material.youtubeUrl,
        materialName: material.name
      });

      const response = await fetch('/api/youtube/download-and-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: material.youtubeUrl,
          task_id: taskId,
          video_quality: '720p',
          format_type: 'mp4'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        logger.info('YouTube视频下载并上传成功', {
          materialId: material.id,
          videoUrl: result.video_url,
          fileSize: result.file_size
        });

        // 更新素材状态为完成
        onAddMaterials([{
          ...material,
          downloadStatus: 'completed' as const,
          downloadProgress: 100,
          url: result.video_url,
          serverUrl: result.video_url,
          size: result.file_size || material.size,
          thumbnailUrl: result.thumbnail_url || material.thumbnailUrl
        }]);
      } else {
        throw new Error(result.error || '下载失败');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('YouTube视频下载失败', error instanceof Error ? error : new Error(errorMessage), {
        materialId: material.id,
        youtubeUrl: material.youtubeUrl
      });

      // 更新素材状态为错误
      onAddMaterials([{
        ...material,
        downloadStatus: 'error' as const,
        downloadError: errorMessage
      }]);

      // 重新抛出错误以便上层处理
      throw error;
    }
  }, [logger, taskId, onAddMaterials]);

  // 并发下载视频的函数
  const downloadVideosInParallel = useCallback(async (materials: MaterialItem[], maxConcurrency: number = 3) => {
    logger.info('开始并发下载YouTube视频', {
      totalCount: materials.length,
      maxConcurrency,
      materialIds: materials.map(m => m.id)
    });

    // 创建一个简单的并发控制器
    const concurrencyController = async () => {
      const results: Array<{ material: MaterialItem; success: boolean; error?: string }> = [];
      
      // 将材料分成批次
      for (let i = 0; i < materials.length; i += maxConcurrency) {
        const batch = materials.slice(i, i + maxConcurrency);
        
        logger.info('开始处理批次', {
          batchIndex: Math.floor(i / maxConcurrency) + 1,
          totalBatches: Math.ceil(materials.length / maxConcurrency),
          batchSize: batch.length,
          materialIds: batch.map(m => m.id)
        });

        // 并行处理当前批次
        const batchPromises = batch.map(async (material, index) => {
          const globalIndex = i + index + 1;
          try {
            logger.info('启动下载任务', {
              taskIndex: globalIndex,
              totalTasks: materials.length,
              materialId: material.id,
              materialName: material.name
            });

            await downloadSingleVideo(material);
            
            logger.info('下载任务完成', {
              taskIndex: globalIndex,
              materialId: material.id,
              success: true
            });
            
            return { material, success: true };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            logger.error('下载任务失败', error instanceof Error ? error : new Error(String(error)), {
              taskIndex: globalIndex,
              materialId: material.id
            });
            
            return { material, success: false, error: errorMessage };
          }
        });

        // 等待当前批次完成
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        logger.info('批次处理完成', {
          batchIndex: Math.floor(i / maxConcurrency) + 1,
          batchSize: batch.length,
          successCount: batchResults.filter(r => r.success).length,
          failureCount: batchResults.filter(r => !r.success).length
        });
      }

      return results;
    };

    // 执行并发下载
    const results = await concurrencyController();

    // 记录最终结果
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    logger.info('并发下载完成', {
      totalCount: materials.length,
      successCount,
      failureCount,
      maxConcurrency,
      successRate: `${((successCount / materials.length) * 100).toFixed(1)}%`
    });
  }, [logger, downloadSingleVideo]);

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
    
    // YouTube时间范围状态
    youtubeDurationRange,
    youtubeDurationPreset,
    
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
    
    // YouTube时间范围方法
    setYoutubeDurationRange: handleYoutubeDurationRangeChange,
    setYoutubeDurationPreset: handleYoutubeDurationPresetChange,
    
    taskId
  };
};