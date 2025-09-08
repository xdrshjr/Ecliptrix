import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseImageSearchReturn, ImageSearchResult, ImageOrientation, ImageColor, ImageOrderBy } from '../types';
import { VideoEditingLogger } from '../utils';
import { createImageSearchService, ImageSearchService } from '../services/imageSearchService';

export const useImageSearch = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => boolean
): UseImageSearchReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useImageSearch'
  }), [taskId]);

  const imageSearchService = useMemo(() => createImageSearchService(taskId), [taskId]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ImageSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<ImageSearchResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<ImageOrientation>('all');
  const [color, setColor] = useState<ImageColor>('all');
  const [orderBy, setOrderBy] = useState<ImageOrderBy>('relevant');
  const [currentPage, setCurrentPage] = useState(1);
  const [isAddingImages, setIsAddingImages] = useState(false);

  // 计算总页数（每页20张图片）
  const totalPages = useMemo(() => {
    return Math.ceil(searchResults.length / 20);
  }, [searchResults.length]);

  // 获取当前页的图片
  const currentPageImages = useMemo(() => {
    const startIndex = (currentPage - 1) * 20;
    const endIndex = startIndex + 20;
    return searchResults.slice(startIndex, endIndex);
  }, [searchResults, currentPage]);

  const handleOrientationChange = useCallback((newOrientation: ImageOrientation) => {
    const previousOrientation = orientation;
    setOrientation(newOrientation);
    
    logger.info('切换图片方向筛选', {
      previousOrientation,
      newOrientation,
      isChangingToLandscape: newOrientation === 'landscape',
      isChangingToPortrait: newOrientation === 'portrait',
      isChangingToSquarish: newOrientation === 'squarish'
    });
  }, [orientation, logger]);

  const handleColorChange = useCallback((newColor: ImageColor) => {
    const previousColor = color;
    setColor(newColor);
    
    logger.info('切换图片颜色筛选', {
      previousColor,
      newColor,
      isChangingToBlackAndWhite: newColor === 'black_and_white',
      isChangingToColor: newColor !== 'black_and_white' && newColor !== 'all'
    });
  }, [color, logger]);

  const handleOrderByChange = useCallback((newOrderBy: ImageOrderBy) => {
    const previousOrderBy = orderBy;
    setOrderBy(newOrderBy);
    
    logger.info('切换图片搜索排序方式', {
      previousOrderBy,
      newOrderBy,
      isChangingToPopular: newOrderBy === 'popular',
      isChangingToLatest: newOrderBy === 'latest',
      isChangingToRelevant: newOrderBy === 'relevant'
    });
  }, [orderBy, logger]);

  const openSearchModal = useCallback(() => {
    logger.info('打开图片搜索模态框', {
      currentQuery: searchQuery,
      hasResults: searchResults.length > 0,
      selectedCount: selectedResults.size,
      orientation,
      color,
      orderBy
    });
    
    setIsModalOpen(true);
  }, [searchQuery, searchResults.length, selectedResults.size, orientation, color, orderBy, logger]);

  const closeSearchModal = useCallback(() => {
    setIsModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResults(new Set());
    setPreviewImage(null);
    setValidationError(null);
    setOrientation('all');
    setColor('all');
    setOrderBy('relevant');
    setCurrentPage(1);
    setIsAddingImages(false);
    logger.info('关闭图片搜索模态框');
  }, [logger]);

  const handleImagePreview = useCallback((image: ImageSearchResult) => {
    setPreviewImage(image);
    logger.info('预览图片', {
      imageId: image.id,
      imageDescription: image.description || image.alt_description,
      imageDimensions: `${image.width}x${image.height}`,
      imageUser: image.user_username,
      imageLikes: image.likes
    });
  }, [logger]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setValidationError('请输入搜索关键词');
      logger.warn('搜索关键词为空', { searchQuery });
      return;
    }

    if (searchQuery.trim().length > 200) {
      setValidationError('搜索关键词不能超过200个字符');
      logger.warn('搜索关键词过长', { 
        searchQuery, 
        length: searchQuery.length 
      });
      return;
    }

    setValidationError(null);
    setIsSearching(true);
    setCurrentPage(1);

    logger.info('开始图片搜索', {
      query: searchQuery.trim(),
      orientation,
      color,
      orderBy,
      timestamp: new Date().toISOString()
    });

    try {
      const result = await imageSearchService.searchImages(
        searchQuery.trim(),
        60, // 搜索60张图片
        orientation,
        color,
        orderBy
      );

      if (result.success) {
        setSearchResults(result.images);
        logger.info('图片搜索成功', {
          foundCount: result.images.length,
          totalFound: result.total_found,
          query: result.query,
          hasResults: result.images.length > 0
        });

        if (result.images.length === 0) {
          setValidationError('未找到相关图片，请尝试其他关键词');
        }
      } else {
        setSearchResults([]);
        setValidationError(result.message || '搜索失败，请稍后重试');
        logger.warn('图片搜索失败', {
          message: result.message,
          query: searchQuery.trim()
        });
      }
    } catch (error) {
      setSearchResults([]);
      setValidationError('搜索过程中发生错误，请稍后重试');
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('图片搜索异常', new Error(errorMessage), {
        query: searchQuery.trim(),
        orientation,
        color,
        orderBy
      });
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, orientation, color, orderBy, imageSearchService, logger]);

  const handleSearchResultSelect = useCallback((resultId: string) => {
    const newSelectedResults = new Set(selectedResults);
    
    if (newSelectedResults.has(resultId)) {
      newSelectedResults.delete(resultId);
      logger.info('取消选择图片', {
        imageId: resultId,
        remainingCount: newSelectedResults.size
      });
    } else {
      newSelectedResults.add(resultId);
      logger.info('选择图片', {
        imageId: resultId,
        totalSelected: newSelectedResults.size
      });
    }
    
    setSelectedResults(newSelectedResults);
  }, [selectedResults, logger]);

  const handleAddSelectedImages = useCallback(async () => {
    if (selectedResults.size === 0) {
      setValidationError('请先选择要添加的图片');
      logger.warn('未选择图片', { selectedCount: selectedResults.size });
      return;
    }

    setIsAddingImages(true);
    setValidationError(null);

    const selectedImages = searchResults.filter(image => selectedResults.has(image.id));
    
    logger.info('开始添加选中图片', {
      selectedCount: selectedImages.length,
      selectedImageIds: Array.from(selectedResults),
      timestamp: new Date().toISOString()
    });

    try {
      // 转换为MaterialItem格式
      const materials: MaterialItem[] = selectedImages.map(image => ({
        id: `image_${image.id}_${Date.now()}`,
        name: image.description || image.alt_description || `图片_${image.id}`,
        type: 'image' as MaterialType,
        format: 'jpg', // Unsplash图片通常为jpg格式
        url: image.regular_url, // 使用regular尺寸作为主要URL
        thumbnailUrl: image.thumb_url,
        size: 0, // Unsplash不提供文件大小信息
        duration: 0,
        width: image.width,
        height: image.height,
        createdAt: new Date(),
        tags: image.tags,
        description: image.description || image.alt_description,
        metadata: {
          color: image.color,
          user: image.user_name,
          username: image.user_username,
          likes: image.likes,
          downloads: image.downloads,
          unsplash_id: image.id,
          raw_url: image.raw_url,
          full_url: image.full_url,
          small_url: image.small_url,
          html_url: image.html_url,
          originalUrl: image.regular_url
        }
      }));

      // 调用添加材料回调
      const success = onAddMaterials(materials);

      if (success) {
        logger.info('图片添加成功', {
          addedCount: materials.length,
          materialIds: materials.map(m => m.id)
        });

        // 清空选择
        setSelectedResults(new Set());
        setValidationError(null);
        
        // 关闭模态框
        setIsModalOpen(false);
      } else {
        setValidationError('添加图片失败，请稍后重试');
        logger.warn('图片添加失败', {
          attemptedCount: materials.length
        });
      }
    } catch (error) {
      setValidationError('添加图片过程中发生错误');
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('添加图片异常', new Error(errorMessage), {
        selectedCount: selectedImages.length,
        selectedImageIds: Array.from(selectedResults)
      });
    } finally {
      setIsAddingImages(false);
    }
  }, [selectedResults, searchResults, onAddMaterials, logger]);

  const handleClearSelection = useCallback(() => {
    const previousCount = selectedResults.size;
    setSelectedResults(new Set());
    logger.info('清空图片选择', {
      previousCount,
      clearedCount: previousCount
    });
  }, [selectedResults.size, logger]);

  const handlePageChange = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      logger.info('切换页面', {
        previousPage: currentPage,
        newPage: page,
        totalPages,
        imagesOnPage: Math.min(20, searchResults.length - (page - 1) * 20)
      });
    }
  }, [currentPage, totalPages, searchResults.length, logger]);

  return {
    isModalOpen,
    searchQuery,
    isSearching,
    searchResults: currentPageImages, // 返回当前页的图片
    selectedResults,
    previewImage,
    validationError,
    orientation,
    color,
    orderBy,
    currentPage,
    totalPages,
    isAddingImages,
    openSearchModal,
    closeSearchModal,
    handleSearch,
    handleSearchResultSelect,
    handleImagePreview,
    handleAddSelectedImages,
    handleClearSelection,
    setSearchQuery,
    setOrientation: handleOrientationChange,
    setColor: handleColorChange,
    setOrderBy: handleOrderByChange,
    setCurrentPage: handlePageChange,
    setValidationError,
    taskId
  };
}; 