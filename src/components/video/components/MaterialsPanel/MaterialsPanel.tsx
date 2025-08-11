'use client';

import React, { useEffect, useState, useRef } from 'react';
import { UseMaterialManagementReturn } from '../../types';
import { MaterialType, MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import localAudioManager from '@/lib/utils/localAudioManager';

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

  const [draggedMaterial, setDraggedMaterial] = useState<MaterialItem | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const materialsGridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logger.info('组件初始化 - 素材网格滚动优化版本', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType,
      isUploading,
      scrollImplementation: 'materials-grid-container'
    });
  }, []);

  // 监听 materials 变化
  useEffect(() => {
    logger.info('素材列表更新 - 4列紧凑布局，独立滚动容器', {
      materialsCount: materials.length,
      layoutType: 'grid-cols-4-compact',
      scrollContainer: 'materials-grid-container',
      scrollBehavior: 'internal-only',
      materials: materials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type
      }))
    });

    // 记录滚动容器状态
    if (materialsGridRef.current) {
      const container = materialsGridRef.current;
      logger.info('素材网格滚动容器状态', {
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        scrollable: container.scrollHeight > container.clientHeight,
        scrollTop: container.scrollTop
      });
    }
  }, [materials]);

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
    });
    
    onSearchVideos();
  };

  // 拖拽开始处理
  const handleDragStart = (e: React.DragEvent, material: MaterialItem) => {
    logger.info('开始拖拽素材', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      materialDuration: material.duration || 0
    });

    setDraggedMaterial(material);
    
    // 设置拖拽数据
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'material',
      material: material
    }));
    
    // 设置拖拽效果
    e.dataTransfer.effectAllowed = 'copy';
    
    // 设置拖拽图像（可选）
    if (material.thumbnailUrl) {
      const img = new Image();
      img.src = material.thumbnailUrl;
      e.dataTransfer.setDragImage(img, 50, 50);
    }
  };

  // 拖拽结束处理
  const handleDragEnd = (e: React.DragEvent, material: MaterialItem) => {
    logger.info('拖拽素材结束', {
      materialId: material.id,
      materialName: material.name,
      dropEffect: e.dataTransfer.dropEffect
    });

    setDraggedMaterial(null);
  };

  // 素材项点击处理
  const handleMaterialClick = (material: MaterialItem) => {
    logger.info('素材项点击', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type
    });
    
    // 如果是音频文件，播放/暂停音频
    if (material.type === 'audio') {
      handleAudioPlayPause(material);
    } else {
      // 实现其他类型素材的点击处理逻辑（预览、编辑等）
    }
  };

  const handleAudioPlayPause = (material: MaterialItem) => {
    if (playingAudio === material.id) {
      // 暂停当前播放的音频
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingAudio(null);
      
      logger.info('暂停音频播放', {
        materialId: material.id,
        materialName: material.name
      });
    } else {
      // 停止其他音频并播放新音频
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      // 确定要使用的音频URL
      let audioUrl = material.url;
      let isLocalFile = false;
      
      // 检查是否有本地文件可用
      if (material.metadata?.fileName) {
        const localUrl = localAudioManager.getAudioFileUrl(material.metadata.fileName);
        if (localUrl) {
          audioUrl = localUrl;
          isLocalFile = true;
          logger.info('使用本地音频文件', {
            materialId: material.id,
            fileName: material.metadata.fileName,
            localUrl: localUrl
          });
        } else {
          logger.info('本地音频文件不可用，使用远程URL', {
            materialId: material.id,
            fileName: material.metadata.fileName,
            originalUrl: material.metadata.originalUrl || material.url
          });
        }
      }
      
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      audio.onplay = () => {
        setPlayingAudio(material.id);
        logger.info('开始音频播放', {
          materialId: material.id,
          materialName: material.name,
          duration: material.duration,
          isLocalFile: isLocalFile,
          audioUrl: audioUrl
        });
      };
      
      audio.onpause = () => {
        if (playingAudio === material.id) {
          setPlayingAudio(null);
        }
      };
      
      audio.onended = () => {
        setPlayingAudio(null);
        logger.info('音频播放完成', {
          materialId: material.id,
          materialName: material.name,
          isLocalFile: isLocalFile
        });
      };
      
      audio.onerror = (event) => {
        setPlayingAudio(null);
        
        // 如果本地文件播放失败，尝试使用远程URL
        if (isLocalFile && material.metadata?.originalUrl) {
          logger.error('本地音频播放失败，尝试远程URL', new Error('Local audio playback failed'), {
            materialId: material.id,
            materialName: material.name,
            localUrl: audioUrl,
            originalUrl: material.metadata.originalUrl
          });
          
          // 递归调用，但这次强制使用远程URL
          const materialWithRemoteUrl = {
            ...material,
            url: material.metadata.originalUrl,
            metadata: {
              ...material.metadata,
              fileName: undefined // 清除fileName以避免再次尝试本地文件
            }
          };
          handleAudioPlayPause(materialWithRemoteUrl);
          return;
        }
        
        logger.error('音频播放失败', new Error('Audio playback failed'), {
          materialId: material.id,
          materialName: material.name,
          url: audioUrl,
          isLocalFile: isLocalFile
        });
      };
      
      audio.play().catch(error => {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        logger.error('音频播放启动失败', errorObj, {
          materialId: material.id,
          isLocalFile: isLocalFile,
          audioUrl: audioUrl
        });
      });
    }
  };

  // 滚动事件处理
  const handleGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    logger.debug('素材网格滚动事件', {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      scrollPercentage: Math.round((container.scrollTop / (container.scrollHeight - container.clientHeight)) * 100)
    });
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
        <div 
          className="materials-grid-container"
          ref={materialsGridRef}
          onScroll={handleGridScroll}
        >
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
            <div className="grid grid-cols-4 gap-2">
              {materials
                .filter(material => selectedMaterialType === 'all' || material.type === selectedMaterialType)
                .map((material) => (
                <div
                  key={material.id}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, material)}
                  onDragEnd={(e) => handleDragEnd(e, material)}
                  className={`group bg-white border border-gray-200 rounded-md overflow-hidden hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                    draggedMaterial?.id === material.id ? 'opacity-50 scale-95' : ''
                  } ${material.type === 'audio' ? 'cursor-pointer' : ''}`}
                  onClick={() => handleMaterialClick(material)}
                >
                  {/* 缩略图区域 */}
                  <div className="aspect-video bg-gray-100 relative">
                    {material.thumbnailUrl ? (
                      <img 
                        src={material.thumbnailUrl} 
                        alt={material.name}
                        className="w-full h-full object-cover pointer-events-none"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {material.type === 'audio' ? (
                          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6 3 3 0 000-6z" />
                          </svg>
                        ) : material.type === 'image' ? (
                          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        ) : (
                          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                    )}

                    {/* 音频播放控制覆盖层 */}
                    {material.type === 'audio' && (
                      <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                        <div className={`w-10 h-10 rounded-full bg-white bg-opacity-90 flex items-center justify-center transition-all duration-200 ${
                          playingAudio === material.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}>
                          {playingAudio === material.id ? (
                            <svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                            </svg>
                          ) : (
                            <svg className="w-5 h-5 text-gray-700 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* 类型标识 */}
                    <div className="absolute top-1 left-1">
                      <span className={`px-1 py-0.5 text-xs font-medium rounded ${
                        material.type === 'video' ? 'bg-blue-100 text-blue-800' :
                        material.type === 'audio' ? 'bg-green-100 text-green-800' :
                        'bg-purple-100 text-purple-800'
                      }`}>
                        {material.type === 'video' ? '视频' :
                         material.type === 'audio' ? '音频' : '图片'}
                      </span>
                    </div>
                    
                    {/* 时长显示 */}
                    {material.duration && (
                      <div className="absolute bottom-1 right-1">
                        <span className="px-1 py-0.5 bg-black bg-opacity-75 text-white text-xs rounded">
                          {Math.floor(material.duration / 60)}:{(material.duration % 60).toString().padStart(2, '0')}
                        </span>
                      </div>
                    )}

                    {/* 拖拽指示器 */}
                    <div className="absolute top-1 right-1">
                      <div className="w-4 h-4 bg-white bg-opacity-80 rounded flex items-center justify-center">
                        <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  
                  {/* 素材信息 */}
                  <div className="p-1.5">
                    <h4 className="text-xs font-medium text-gray-900 truncate mb-1" title={material.name}>{material.name}</h4>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      {material.width && material.height && (
                        <span className="text-xs">{material.width}×{material.height}</span>
                      )}
                      <span className="text-blue-600 text-xs">{material.format?.toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="border-t pt-3 flex-shrink-0">
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