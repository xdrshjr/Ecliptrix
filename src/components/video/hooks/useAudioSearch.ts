import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseAudioSearchReturn, AudioSearchResult, AudioType, SortBy } from '../types';
import { VideoEditingLogger } from '../utils';
import { createAudioSearchService, AudioSearchService } from '../services/audioSearchService';

export const useAudioSearch = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => boolean
): UseAudioSearchReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useAudioSearch'
  }), [taskId]);

  const audioSearchService = useMemo(() => createAudioSearchService(taskId), [taskId]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AudioSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set());
  const [previewAudio, setPreviewAudio] = useState<AudioSearchResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [durationMax, setDurationMax] = useState<number | null>(null);
  const [audioType, setAudioType] = useState<AudioType>('music');
  const [sortBy, setSortBy] = useState<SortBy>('score');
  const [isAddingAudios, setIsAddingAudios] = useState(false);

  const handleSortByChange = useCallback((newSortBy: SortBy) => {
    const previousSortBy = sortBy;
    setSortBy(newSortBy);
    
    logger.userAction('切换音频搜索排序方式', 'sortByChange', {
      previousSortBy,
      newSortBy,
      isChangingToPopularity: newSortBy === 'downloads',
      isChangingFromPopularity: previousSortBy === 'downloads'
    });
  }, [sortBy, logger]);

  const openSearchModal = useCallback(() => {
    logger.userAction('打开音频搜索模态框', 'searchButton', {
      currentQuery: searchQuery,
      hasResults: searchResults.length > 0,
      selectedCount: selectedResults.size,
      audioType,
      sortBy
    });
    
    setIsModalOpen(true);
  }, [logger, searchQuery, searchResults.length, selectedResults.size, audioType, sortBy]);

  const closeSearchModal = useCallback(() => {
    setIsModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResults(new Set());
    setPreviewAudio(null);
    setValidationError(null);
    setDurationMin(null);
    setDurationMax(null);
    setAudioType('music');
    setSortBy('score');
    setIsAddingAudios(false);
    logger.userAction('关闭音频搜索模态框', 'closeButton');
  }, [logger]);

  const handleAudioPreview = useCallback((audio: AudioSearchResult) => {
    setPreviewAudio(audio);
    logger.userAction('预览音频', 'audioPreview', {
      audioId: audio.id,
      audioName: audio.name,
      audioUsername: audio.username,
      audioDuration: audio.duration,
      audioLicense: audio.license,
      hasPreviewUrl: !!audio.preview_url
    });
  }, [logger]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setValidationError('请输入搜索关键词');
      return;
    }

    // 验证时长范围
    if (durationMin !== null && durationMax !== null && durationMin >= durationMax) {
      setValidationError('最小时长必须小于最大时长');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);
    setPreviewAudio(null);
    setValidationError(null);

    try {
      // 使用音频搜索服务进行搜索
      const result = await audioSearchService.searchAudios({
        query: searchQuery,
        maxAudios: 20,
        durationMin: durationMin || undefined,
        durationMax: durationMax || undefined,
        audioType: audioType,
        sortBy: sortBy,
      });

      if (result.success && result.audios) {
        setSearchResults(result.audios);
        
        // Calculate popularity statistics if sorting by downloads
        const popularityStats = sortBy === 'downloads' && result.audios.length > 0 ? {
          hasPopularityData: result.audios.some(audio => audio.downloads !== undefined),
          downloadsRange: result.audios
            .filter(audio => audio.downloads !== undefined)
            .map(audio => audio.downloads!)
            .sort((a, b) => b - a), // Sort by downloads descending
          maxDownloads: Math.max(...result.audios
            .filter(audio => audio.downloads !== undefined)
            .map(audio => audio.downloads!)),
          minDownloads: Math.min(...result.audios
            .filter(audio => audio.downloads !== undefined)
            .map(audio => audio.downloads!))
        } : null;
        
        logger.info('音频搜索成功', {
          totalFound: result.total_found,
          audiosCount: result.audios.length,
          query: searchQuery,
          durationFilter: {
            min: durationMin,
            max: durationMax
          },
          audioType: audioType,
          sortBy: sortBy,
          isPopularitySearch: sortBy === 'downloads',
          popularityStats: popularityStats
        });
      } else {
        setValidationError(result.message || '搜索失败，请稍后重试');
        logger.warn('音频搜索无结果', {
          error: result.message,
          query: searchQuery,
          sortBy: sortBy,
          isPopularitySearch: sortBy === 'downloads'
        });
      }
    } catch (error) {
      logger.error('音频搜索异常', error as Error);
      setValidationError('搜索失败，请检查网络连接');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, durationMin, durationMax, audioType, sortBy, logger, audioSearchService]);

  const handleSearchResultSelect = useCallback((resultIndex: number) => {
    const newSelected = new Set(selectedResults);
    
    if (newSelected.has(resultIndex)) {
      newSelected.delete(resultIndex);
      logger.userAction('取消选择音频', 'audioDeselect', {
        audioIndex: resultIndex,
        audioId: searchResults[resultIndex]?.id,
        audioName: searchResults[resultIndex]?.name,
        remainingSelected: newSelected.size
      });
    } else {
      newSelected.add(resultIndex);
      logger.userAction('选择音频', 'audioSelect', {
        audioIndex: resultIndex,
        audioId: searchResults[resultIndex]?.id,
        audioName: searchResults[resultIndex]?.name,
        totalSelected: newSelected.size
      });
    }
    
    setSelectedResults(newSelected);
  }, [selectedResults, searchResults, logger]);

  const handleAddSelectedAudios = useCallback(async () => {
    if (selectedResults.size === 0) {
      setValidationError('请先选择要添加的音频');
      return;
    }

    if (isAddingAudios) {
      logger.warn('音频添加已在进行中，忽略重复请求');
      return;
    }

    const selectedAudios = Array.from(selectedResults).map(index => searchResults[index]);
    
    logger.userAction('开始添加选中音频', 'addSelectedAudios', {
      selectedCount: selectedAudios.length,
      audioIds: selectedAudios.map(audio => audio.id),
      audioNames: selectedAudios.map(audio => audio.name)
    });

    setIsAddingAudios(true);
    setValidationError(null);

    try {
      const materials: MaterialItem[] = [];

      for (const audio of selectedAudios) {
        try {
          // 下载音频文件
          const response = await fetch(audio.download_url);
          if (!response.ok) {
            throw new Error(`下载音频失败: ${response.status}`);
          }

          const audioBlob = await response.blob();
          const localUrl = URL.createObjectURL(audioBlob);

          // 创建素材项
          const material: MaterialItem = {
            id: `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: audio.name,
            type: 'audio' as MaterialType,
            format: audio.type || 'mp3',
            size: audio.filesize || audioBlob.size,
            duration: audio.duration,
            url: localUrl,
            serverUrl: audio.download_url,
            createdAt: new Date(),
            tags: audio.tags,
            description: audio.description,
            metadata: {
              originalUrl: audio.download_url,
              previewUrl: audio.preview_url,
              waveformUrl: audio.waveform_url,
              license: audio.license,
              username: audio.username,
              freesoundId: audio.id,
              channels: audio.channels,
              bitrate: audio.bitrate,
              samplerate: audio.samplerate,
              isOnlineAudio: true
            }
          };

          materials.push(material);

          logger.info('音频下载成功', {
            audioId: audio.id,
            audioName: audio.name,
            fileSize: audioBlob.size,
            duration: audio.duration,
            materialId: material.id
          });

        } catch (error) {
          logger.error('音频下载失败', error as Error, {
            audioId: audio.id,
            audioName: audio.name,
            downloadUrl: audio.download_url
          });
          
          // 继续处理其他音频，但记录错误
          continue;
        }
      }

      if (materials.length === 0) {
        setValidationError('所有音频下载失败，请检查网络连接');
        return;
      }

      // 添加素材到素材管理
      const success = onAddMaterials(materials);
      
      if (success) {
        logger.info('音频素材添加成功', {
          addedCount: materials.length,
          totalSelected: selectedAudios.length,
          successRate: (materials.length / selectedAudios.length * 100).toFixed(1) + '%'
        });

        // 关闭模态框
        closeSearchModal();
      } else {
        setValidationError('添加音频到素材库失败');
        logger.error('音频素材添加失败', new Error('onAddMaterials returned false'));
      }

    } catch (error) {
      logger.error('添加音频素材异常', error as Error);
      setValidationError('添加音频时发生错误，请稍后重试');
    } finally {
      setIsAddingAudios(false);
    }
  }, [selectedResults, searchResults, onAddMaterials, logger, closeSearchModal, isAddingAudios]);

  const handleClearSelection = useCallback(() => {
    logger.userAction('清空音频选择', 'clearSelection', {
      previousSelectedCount: selectedResults.size
    });
    setSelectedResults(new Set());
  }, [selectedResults.size, logger]);

  return {
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
    sortBy,
    isAddingAudios,
    openSearchModal,
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
    setSortBy: handleSortByChange,
    setValidationError,
    taskId
  };
}; 