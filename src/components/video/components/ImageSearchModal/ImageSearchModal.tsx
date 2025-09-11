'use client';

import React, { useEffect, useState } from 'react';
import { UseImageSearchReturn, ImageSearchResult } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

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
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    // 上一页按钮
    pages.push(
      <button
        key="prev"
        onClick={() => setCurrentPage(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-1 mx-1 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        上一页
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
              ? 'bg-blue-500 text-white border-blue-500'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
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
        className="px-3 py-1 mx-1 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        下一页
      </button>
    );

    return (
      <div className="flex justify-center items-center mt-4">
        {pages}
        <span className="ml-4 text-sm text-gray-600">
          第 {currentPage} 页，共 {totalPages} 页
        </span>
      </div>
    );
  };

  if (!isModalOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
        <div className="bg-white rounded-xl w-full max-w-7xl h-5/6 flex flex-col shadow-2xl">
          {/* 标题栏 */}
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 className="text-2xl font-semibold text-gray-800">搜索图片</h2>
            <button
              onClick={handleClose}
              disabled={isAddingImages}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors p-2 rounded-lg hover:bg-gray-100"
              aria-label="关闭"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 搜索区域 */}
          <div className="p-6 border-b border-gray-100 bg-gray-50 flex-shrink-0">
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
                    placeholder="输入搜索关键词，如：风景、人物、建筑..."
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-base"
                    disabled={isSearching || isAddingImages}
                  />
                </div>
                <button
                  onClick={handleSearch}
                  disabled={isSearching || isAddingImages || !searchQuery.trim()}
                  className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
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

              {/* 筛选选项 */}
              <div className="flex flex-wrap gap-4 text-sm">
                {/* 方向筛选 */}
                <div className="flex items-center space-x-2">
                  <label className="text-gray-600 font-medium">方向:</label>
                  <select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as any)}
                    className="px-3 py-1 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    disabled={isSearching || isAddingImages}
                  >
                    <option value="all">全部</option>
                    <option value="landscape">横向</option>
                    <option value="portrait">纵向</option>
                    <option value="squarish">方形</option>
                  </select>
                </div>

                {/* 颜色筛选 */}
                <div className="flex items-center space-x-2">
                  <label className="text-gray-600 font-medium">颜色:</label>
                  <select
                    value={color}
                    onChange={(e) => setColor(e.target.value as any)}
                    className="px-3 py-1 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    disabled={isSearching || isAddingImages}
                  >
                    <option value="all">全部</option>
                    <option value="black_and_white">黑白</option>
                    <option value="black">黑色</option>
                    <option value="white">白色</option>
                    <option value="yellow">黄色</option>
                    <option value="orange">橙色</option>
                    <option value="red">红色</option>
                    <option value="purple">紫色</option>
                    <option value="magenta">洋红</option>
                    <option value="green">绿色</option>
                    <option value="teal">青色</option>
                    <option value="blue">蓝色</option>
                  </select>
                </div>

                {/* 排序方式 */}
                <div className="flex items-center space-x-2">
                  <label className="text-gray-600 font-medium">排序:</label>
                  <select
                    value={orderBy}
                    onChange={(e) => setOrderBy(e.target.value as any)}
                    className="px-3 py-1 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    disabled={isSearching || isAddingImages}
                  >
                    <option value="relevant">相关度</option>
                    <option value="latest">最新</option>
                    <option value="popular">热门</option>
                  </select>
                </div>
              </div>

              {/* 错误信息 */}
              {validationError && (
                <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                  {validationError}
                </div>
              )}
            </div>
          </div>

          {/* 结果区域 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 操作栏 */}
            {searchResults.length > 0 && (
              <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-white">
                <div className="text-sm text-gray-600">
                  已选择 {selectedResults.size} 张图片
                </div>
                <div className="flex space-x-3">
                  {selectedResults.size > 0 && (
                    <button
                      onClick={handleClearSelection}
                      disabled={isAddingImages}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors text-sm disabled:opacity-50"
                    >
                      清空选择
                    </button>
                  )}
                  <button
                    onClick={handleAddSelectedImages}
                    disabled={selectedResults.size === 0 || isAddingImages}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {isAddingImages ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>添加中...</span>
                      </div>
                    ) : (
                      `添加选中图片 (${selectedResults.size})`
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
                        className={`relative group bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer border-2 ${
                          selectedResults.has(image.id) ? 'border-blue-500' : 'border-transparent'
                        }`}
                      >
                        {/* 图片 */}
                        <div className="aspect-square relative overflow-hidden">
                          <img
                            src={image.small_url}
                            alt={image.alt_description || image.description || '图片'}
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
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-white text-gray-700 hover:bg-gray-100'
                                }`}
                                title={selectedResults.has(image.id) ? '取消选择' : '选择'}
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
                                className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors"
                                title="添加到素材"
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
                          <div className="text-xs text-gray-500 mb-1">
                            {image.width} × {image.height}
                          </div>
                          <div className="text-sm text-gray-700 font-medium truncate">
                            {image.description || image.alt_description || '无描述'}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 flex items-center justify-between">
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
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-lg mb-2">暂无搜索结果</p>
                  <p className="text-sm">输入关键词开始搜索图片</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 图片预览模态框 */}
      {previewModalOpen && previewImage && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[250]">
          <div className="max-w-4xl max-h-4xl bg-white rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="text-lg font-medium">
                  {previewImage.description || previewImage.alt_description || '图片预览'}
                </h3>
                <p className="text-sm text-gray-500">
                  {previewImage.width} × {previewImage.height} • @{previewImage.user_username}
                </p>
              </div>
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <img
                src={previewImage.regular_url}
                alt={previewImage.alt_description || previewImage.description || '图片'}
                className="max-w-full max-h-96 object-contain mx-auto"
              />
            </div>
            <div className="p-4 border-t bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={() => {
                  handleSearchResultSelect(previewImage.id);
                  setPreviewModalOpen(false);
                }}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  selectedResults.has(previewImage.id)
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {selectedResults.has(previewImage.id) ? '取消选择' : '选择'}
              </button>
              <button
                onClick={() => {
                  handleAddToMaterials(previewImage);
                  setPreviewModalOpen(false);
                }}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                添加到素材
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ImageSearchModal; 