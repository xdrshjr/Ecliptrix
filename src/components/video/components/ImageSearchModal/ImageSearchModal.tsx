'use client';

import React, { useEffect, useState } from 'react';
import { UseImageSearchReturn, ImageSearchResult } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';
import { useLocale } from '@/contexts/LocaleContext';

interface ImageSearchModalProps extends UseImageSearchReturn {
}

const ImageSearchModal: React.FC<ImageSearchModalProps> = ({
  isModalOpen,
  searchQuery,
  isSearching,
  searchResults,
  selectedResults,
  previewImage,
  validationError,
  orientation,
  color,
  orderBy,
  currentPage,
  totalPages,
  isAddingImages,
  closeSearchModal,
  handleSearch,
  handleSearchResultSelect,
  handleImagePreview,
  handleAddSelectedImages,
  handleClearSelection,
  setSearchQuery,
  setOrientation,
  setColor,
  setOrderBy,
  setCurrentPage,
  setValidationError,
  taskId
}) => {
  const { t } = useLocale();
  const logger = new VideoEditingLogger({
    taskId,
    component: 'ImageSearchModal'
  });

  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  useEffect(() => {
    if (isModalOpen) {
      logger.info('图片搜索模态框打开', {
        searchQuery,
        previousResultsCount: searchResults.length,
        previousSelectionCount: selectedResults.size,
        orientation,
        color,
        orderBy
      });
    }
  }, [isModalOpen]);

  useEffect(() => {
    logger.info('图片选择状态变化', {
      selectionCount: selectedResults.size,
      selectedImageIds: Array.from(selectedResults),
      totalResults: searchResults.length,
      selectionRatio: searchResults.length > 0 ? selectedResults.size / searchResults.length : 0
    });
  }, [selectedResults]);

  useEffect(() => {
    if (isAddingImages) {
      logger.info('开始添加图片流程', {
        selectedCount: selectedResults.size,
        selectedImageIds: Array.from(selectedResults),
        timestamp: new Date().toISOString()
      });
    } else {
      logger.info('图片添加流程结束', {
        timestamp: new Date().toISOString()
      });
    }
  }, [isAddingImages]);

  const handleClose = () => {
    // 如果正在添加图片，则阻止关闭
    if (isAddingImages) {
      logger.warn('尝试在添加图片过程中关闭模态框', {
        isAddingImages,
        selectedCount: selectedResults.size
      });
      return;
    }

    logger.info('关闭图片搜索模态框', {
      hadResults: searchResults.length > 0,
      hadSelection: selectedResults.size > 0,
      currentQuery: searchQuery
    });
    
    closeSearchModal();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isSearching) {
      handleSearch();
    }
  };

  const handleImageClick = (image: ImageSearchResult) => {
    handleImagePreview(image);
    setPreviewModalOpen(true);
  };

  const handleAddToMaterials = (image: ImageSearchResult) => {
    handleSearchResultSelect(image.id);
    // 立即添加单个图片
    setTimeout(() => {
      handleAddSelectedImages();
    }, 100);
  };

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    const pages = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    // 上一页按钮
    pages.push(
      <button
        key="prev"
        onClick={() => setCurrentPage(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-1 mx-1 text-sm rounded-md border border-border bg-card text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {t.imageSearchModal.prevPage}
      </button>
    );

    // 页码按钮
    for (let i = startPage; i <= endPage; i++) {
      pages.push(
        <button
          key={i}
          onClick={() => setCurrentPage(i)}
          className={`px-3 py-1 mx-1 text-sm rounded-md border transition-colors ${
            i === currentPage
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border bg-card text-foreground hover:bg-accent'
          }`}
        >
          {i}
        </button>
      );
    }

    // 下一页按钮
    pages.push(
      <button
        key="next"
        onClick={() => setCurrentPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-1 mx-1 text-sm rounded-md border border-border bg-card text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {t.imageSearchModal.nextPage}
      </button>
    );

    return (
      <div className="flex justify-center items-center mt-4">
        {pages}
        <span className="ml-4 text-sm text-muted-foreground">
          {t.imageSearchModal.pageInfo.replace('{current}', String(currentPage)).replace('{total}', String(totalPages))}
        </span>
      </div>
    );
  };

  if (!isModalOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
        <div className="bg-card rounded-md border border-border w-full max-w-7xl h-5/6 flex flex-col">
          {/* 标题栏 */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-2xl font-semibold text-foreground">{t.imageSearchModal.title}</h2>
            <button
              onClick={handleClose}
              disabled={isAddingImages}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={t.common.close}
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 搜索区域 */}
          <div className="p-6 border-b border-border bg-muted flex-shrink-0">
            <div className="flex flex-col space-y-4">
              {/* 搜索输入框 */}
              <div className="flex space-x-4">
                <div className="flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (validationError) setValidationError(null);
                    }}
                    onKeyPress={handleKeyPress}
                    placeholder={t.imageSearchModal.searchPlaceholder}
                    className="w-full px-4 py-3 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all text-base"
                    disabled={isSearching || isAddingImages}
                  />
                </div>
                <button
                  onClick={handleSearch}
                  disabled={isSearching || isAddingImages || !searchQuery.trim()}
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {isSearching ? (
                    <div className="flex items-center space-x-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>{t.imageSearchModal.searching}</span>
                    </div>
                  ) : (
                    t.imageSearchModal.searchButton
                  )}
                </button>
              </div>

              {/* 筛选选项 */}
              <div className="flex flex-wrap gap-4 text-sm">
                {/* 方向筛选 */}
                <div className="flex items-center space-x-2">
                  <label className="text-muted-foreground font-medium">{t.imageSearchModal.orientationLabel}</label>
                  <select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as any)}
                    className="px-3 py-1 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    disabled={isSearching || isAddingImages}
                  >
                    <option value="all">{t.imageSearchModal.orientationAll}</option>
                    <option value="landscape">{t.imageSearchModal.orientationLandscape}</option>
                    <option value="portrait">{t.imageSearchModal.orientationPortrait}</option>
                    <option value="squarish">{t.imageSearchModal.orientationSquarish}</option>
                  </select>
                </div>

                {/* 颜色筛选 */}
                <div className="flex items-center space-x-2">
                  <label className="text-muted-foreground font-medium">{t.imageSearchModal.colorLabel}</label>
                  <select
                    value={color}
                    onChange={(e) => setColor(e.target.value as any)}
                    className="px-3 py-1 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    disabled={isSearching || isAddingImages}
                  >
                    <option value="all">{t.imageSearchModal.colorAll}</option>
                    <option value="black_and_white">{t.imageSearchModal.colorBlackAndWhite}</option>
                    <option value="black">{t.imageSearchModal.colorBlack}</option>
                    <option value="white">{t.imageSearchModal.colorWhite}</option>
                    <option value="yellow">{t.imageSearchModal.colorYellow}</option>
                    <option value="orange">{t.imageSearchModal.colorOrange}</option>
                    <option value="red">{t.imageSearchModal.colorRed}</option>
                    <option value="purple">{t.imageSearchModal.colorPurple}</option>
                    <option value="magenta">{t.imageSearchModal.colorMagenta}</option>
                    <option value="green">{t.imageSearchModal.colorGreen}</option>
                    <option value="teal">{t.imageSearchModal.colorTeal}</option>
                    <option value="blue">{t.imageSearchModal.colorBlue}</option>
                  </select>
                </div>

                {/* 排序方式 */}
                <div className="flex items-center space-x-2">
                  <label className="text-muted-foreground font-medium">{t.imageSearchModal.orderByLabel}</label>
                  <select
                    value={orderBy}
                    onChange={(e) => setOrderBy(e.target.value as any)}
                    className="px-3 py-1 border border-border rounded-md focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                    disabled={isSearching || isAddingImages}
                  >
                    <option value="relevant">{t.imageSearchModal.orderByRelevant}</option>
                    <option value="latest">{t.imageSearchModal.orderByLatest}</option>
                    <option value="popular">{t.imageSearchModal.orderByPopular}</option>
                  </select>
                </div>
              </div>

              {/* 错误信息 */}
              {validationError && (
                <div className="text-destructive text-sm bg-destructive/10 border border-border rounded-md p-3">
                  {validationError}
                </div>
              )}
            </div>
          </div>

          {/* 结果区域 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 操作栏 */}
            {searchResults.length > 0 && (
              <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                <div className="text-sm text-muted-foreground">
                  {t.imageSearchModal.selectedCount.replace('{count}', String(selectedResults.size))}
                </div>
                <div className="flex space-x-3">
                  {selectedResults.size > 0 && (
                    <button
                      onClick={handleClearSelection}
                      disabled={isAddingImages}
                      className="px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors text-sm disabled:opacity-50"
                    >
                      {t.imageSearchModal.clearSelection}
                    </button>
                  )}
                  <button
                    onClick={handleAddSelectedImages}
                    disabled={selectedResults.size === 0 || isAddingImages}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {isAddingImages ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>{t.imageSearchModal.addingImages}</span>
                      </div>
                    ) : (
                      t.imageSearchModal.addSelectedButton.replace('{count}', String(selectedResults.size))
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* 图片网格 */}
            <div className="flex-1 overflow-y-auto p-6">
              {searchResults.length > 0 ? (
                <>
                  <div className="grid grid-cols-4 gap-4">
                    {searchResults.map((image) => (
                      <div
                        key={image.id}
                        className={`relative group bg-card rounded-md overflow-hidden transition-all cursor-pointer border-2 ${
                          selectedResults.has(image.id) ? 'border-primary' : 'border-transparent'
                        }`}
                      >
                        {/* 图片 */}
                        <div className="aspect-square relative overflow-hidden">
                          <img
                            src={image.small_url}
                            alt={image.alt_description || image.description || t.imageSearchModal.title}
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                            onClick={() => handleImageClick(image)}
                            loading="lazy"
                          />
                          
                          {/* 悬浮操作按钮 */}
                          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center">
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSearchResultSelect(image.id);
                                }}
                                className={`p-2 rounded-full transition-colors ${
                                  selectedResults.has(image.id)
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-card text-foreground hover:bg-accent'
                                }`}
                                title={selectedResults.has(image.id) ? t.imageSearchModal.deselect : t.imageSearchModal.select}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddToMaterials(image);
                                }}
                                className="p-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors"
                                title={t.imageSearchModal.addToMaterials}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* 图片信息 */}
                        <div className="p-3">
                          <div className="text-xs text-muted-foreground mb-1">
                            {image.width} × {image.height}
                          </div>
                          <div className="text-sm text-foreground font-medium truncate">
                            {image.description || image.alt_description || t.imageSearchModal.noDescription}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex items-center justify-between">
                            <span>@{image.user_username}</span>
                            <div className="flex items-center space-x-2">
                              <span className="flex items-center">
                                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                                </svg>
                                {image.likes}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* 分页 */}
                  {renderPagination()}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-lg mb-2">{t.imageSearchModal.noResultsTitle}</p>
                  <p className="text-sm">{t.imageSearchModal.noResultsHint}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 图片预览模态框 */}
      {previewModalOpen && previewImage && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[250]">
          <div className="max-w-4xl max-h-4xl bg-card rounded-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="text-lg font-medium">
                  {previewImage.description || previewImage.alt_description || t.imageSearchModal.imagePreview}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {previewImage.width} × {previewImage.height} • @{previewImage.user_username}
                </p>
              </div>
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
              >
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <img
                src={previewImage.regular_url}
                alt={previewImage.alt_description || previewImage.description || t.imageSearchModal.title}
                className="max-w-full max-h-96 object-contain mx-auto"
              />
            </div>
            <div className="p-4 border-t border-border bg-muted flex justify-end space-x-3">
              <button
                onClick={() => {
                  handleSearchResultSelect(previewImage.id);
                  setPreviewModalOpen(false);
                }}
                className={`px-4 py-2 rounded-md transition-colors ${
                  selectedResults.has(previewImage.id)
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-accent text-foreground hover:bg-accent/80'
                }`}
              >
                {selectedResults.has(previewImage.id) ? t.imageSearchModal.deselect : t.imageSearchModal.select}
              </button>
              <button
                onClick={() => {
                  handleAddToMaterials(previewImage);
                  setPreviewModalOpen(false);
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                {t.imageSearchModal.addToMaterials}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ImageSearchModal; 