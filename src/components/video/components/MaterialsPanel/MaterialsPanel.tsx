'use client';

import React, { useEffect } from 'react';
import { UseMaterialManagementReturn } from '../../types';
import { MaterialType } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';

interface MaterialsPanelProps extends UseMaterialManagementReturn {
  onSearchVideos: () => void;
  taskId: string;
  className?: string;
}

const MaterialsPanel: React.FC<MaterialsPanelProps> = ({
  materials,
  selectedMaterialType,
  isUploading,
  uploadProgress,
  handleMaterialTypeFilter,
  handleMaterialUpload,
  onSearchVideos,
  taskId,
  className = ''
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'MaterialsPanel'
  });

  useEffect(() => {
    logger.info('组件初始化', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType,
      isUploading
    });
  }, []);

  const handleTypeFilter = (type: MaterialType | 'all') => {
    logger.info('素材类型筛选', {
      previousType: selectedMaterialType,
      newType: type,
      materialsCount: materials.length
    });
    
    handleMaterialTypeFilter(type);
  };

  const handleUploadClick = () => {
    logger.info('用户点击上传按钮', {
      materialsCount: materials.length,
      isCurrentlyUploading: isUploading
    });
    
    handleMaterialUpload();
  };

  const handleSearchClick = () => {
    logger.info('用户点击搜索视频按钮', {
      materialsCount: materials.length,
      currentFilter: selectedMaterialType
    });
    
    onSearchVideos();
  };

  return (
    <div className={`video-editing-materials-panel border-r border-gray-200 ${className}`}>
      <div className="materials-panel-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">素材管理</h3>
          </div>
          <button
            onClick={handleUploadClick}
            disabled={isUploading}
            className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="上传素材"
          >
            {isUploading ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{uploadProgress.toFixed(0)}%</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span>上传</span>
              </>
            )}
          </button>
        </div>
      </div>
      
      <div className="materials-panel-content">
        {/* 素材类型筛选标签 */}
        <div className="flex space-x-1 mb-4 p-1 bg-gray-100 rounded-lg">
          {(['all', 'video', 'audio', 'image'] as const).map((type) => (
            <button
              key={type}
              onClick={() => handleTypeFilter(type)}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                selectedMaterialType === type
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {type === 'all' ? '全部' : 
               type === 'video' ? '视频' :
               type === 'audio' ? '音频' : '图片'}
            </button>
          ))}
        </div>

        {/* 素材网格 */}
        <div className="mb-4">
          {materials.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">暂无素材</h3>
              <p className="text-sm text-gray-500 text-center mb-6 max-w-sm">
                素材库为空，点击下方「搜索视频」按钮来添加高质量的视频素材
              </p>
              <button
                onClick={handleSearchClick}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>搜索视频</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {/* Material cards would go here */}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="border-t pt-3 mt-auto">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-3">
              <button
                onClick={handleSearchClick}
                className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition-colors"
                title="搜索在线视频"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>搜索视频</span>
              </button>
            </div>
            <div className="text-gray-500">
              {materials.length}个素材
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MaterialsPanel; 