'use client';

import React, { useEffect, useState, useRef } from 'react';
import { UseMaterialManagementReturn } from '../../types';
import { MaterialType, MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import localAudioManager from '@/lib/utils/localAudioManager';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';

interface MaterialsPanelProps extends UseMaterialManagementReturn {
  onSearchVideos: () => void;
  onSearchAudios: () => void; // 新增：搜索音频回调
  onAutoMixAudio?: () => void; // 新增：AI自动混剪回调
  onVideoAnalysis?: (material: MaterialItem) => void; // 新增：视频AI解析回调
  onBatchVideoAnalysis?: () => Promise<void>; // 新增：批量视频AI解析回调
  isBatchAnalyzing?: boolean; // 新增：批量解析状态
  getVideoAnalysisStatus?: (videoUrl: string) => 'idle' | 'analyzing' | 'completed' | 'error';
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
  onSearchAudios, // 新增：搜索音频回调
  onAutoMixAudio, // 新增：AI自动混剪回调
  onVideoAnalysis, // 新增：视频AI解析回调
  onBatchVideoAnalysis, // 新增：批量视频AI解析回调
  isBatchAnalyzing = false, // 新增：批量解析状态
  getVideoAnalysisStatus, // 新增：获取视频解析状态
  taskId,
  className = '',
  // 新增的删除功能
  handleMaterialDelete,
  handleDeleteAllMaterials,
  confirmationDialog,
  handleCloseConfirmationDialog
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
        type: m.type,
        duration: m.duration ? m.duration.toFixed(2) : undefined
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

  const handleSearchAudiosClick = () => {
    logger.info('用户点击搜索音频按钮', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType
    });
    
    onSearchAudios();
  };

  // 处理删除全部按钮点击
  const handleDeleteAllClick = () => {
    logger.info('用户点击删除全部按钮', {
      selectedMaterialType,
      materialsCount: materials.length,
      filteredMaterialsCount: materials.length
    });
    
    handleDeleteAllMaterials();
  };

  // 处理单个素材删除按钮点击
  const handleSingleMaterialDelete = (material: MaterialItem, e: React.MouseEvent) => {
    // 阻止事件冒泡，避免触发素材点击事件
    e.stopPropagation();
    
    logger.info('用户点击单个素材删除按钮', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type
    });
    
    handleMaterialDelete([material.id]);
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
    } else if (material.type === 'subtitle') {
      handleSubtitleDownload(material);
    } else {
      // 实现其他类型素材的点击处理逻辑（预览、编辑等）
    }
  };

  const handleSubtitleDownload = (material: MaterialItem) => {
    try {
      logger.userAction('下载字幕文件', 'subtitleDownload', {
        materialId: material.id,
        materialName: material.name,
        format: material.format
      });

      // 从metadata中获取SRT内容或从URL下载
      const srtContent = material.metadata?.srt_content;
      const fileName = material.metadata?.fileName || `${material.name}.srt`;

      if (srtContent) {
        // 直接使用metadata中的SRT内容
        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        logger.info('字幕文件下载成功', {
          materialId: material.id,
          fileName,
          contentLength: srtContent.length
        });
      } else if (material.url) {
        // 从URL下载
        const a = document.createElement('a');
        a.href = material.url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        logger.info('字幕文件下载触发', {
          materialId: material.id,
          fileName,
          url: material.url
        });
      } else {
        throw new Error('无法获取字幕内容');
      }
    } catch (error) {
      logger.error('字幕文件下载失败', new Error(error instanceof Error ? error.message : String(error)), {
        materialId: material.id,
        materialName: material.name
      });
      alert(`字幕文件下载失败: ${error instanceof Error ? error.message : String(error)}`);
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

  // 处理视频AI解析
  const handleVideoAnalysis = (material: MaterialItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    logger.userAction('点击视频AI解析按钮', 'videoAnalysis', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      videoUrl: material.url
    });

    if (onVideoAnalysis) {
      onVideoAnalysis(material);
    }
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
          <div className="flex items-center space-x-2">
            {/* 新增：AI解析视频按钮 */}
            {onBatchVideoAnalysis && (
              <button
                onClick={async () => {
                  const videoMaterials = materials.filter(m => m.type === 'video');
                  logger.userAction('AI批量解析视频', 'batchVideoAnalysisButton', {
                    materialsCount: materials.length,
                    videoMaterialsCount: videoMaterials.length,
                    videoMaterials: videoMaterials.map(m => ({
                      id: m.id,
                      name: m.name,
                      url: m.url
                    })),
                    taskId
                  });
                  await onBatchVideoAnalysis();
                }}
                disabled={isBatchAnalyzing}
                className="flex items-center space-x-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={isBatchAnalyzing ? "正在批量解析视频..." : "对所有视频素材进行AI解析，生成详细的内容描述"}
              >
                {isBatchAnalyzing ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>解析中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>AI解析视频</span>
                  </>
                )}
              </button>
            )}
            
            {/* 新增：AI自动混剪按钮 */}
            {onAutoMixAudio && (
              <button
                onClick={() => {
                  logger.userAction('AI自动混剪', 'autoMixButton', {
                    materialsCount: materials.length,
                    audioMaterialsCount: materials.filter(m => m.type === 'audio').length,
                    taskId
                  });
                  onAutoMixAudio();
                }}
                className="flex items-center space-x-1 px-3 py-1.5 bg-purple-600 text-white text-xs rounded-md hover:bg-purple-700 transition-colors"
                title="将所有文本脚本转换的音频和关联的视频按顺序自动添加到时间轴"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span>AI自动混剪</span>
              </button>
            )}
            
            {/* 上传按钮 */}
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
      </div>
      
      <div className="materials-panel-content">
        {/* 素材类型筛选标签 */}
        <div className="flex space-x-1 mb-4 p-1 bg-gray-100 rounded-lg">
          {(['all', 'video', 'audio', 'image', 'subtitle'] as const).map((type) => (
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
               type === 'audio' ? '音频' : 
               type === 'image' ? '图片' : '字幕'}
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
                        ) : material.type === 'subtitle' ? (
                          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m0 0V3a1 1 0 011 1v12a1 1 0 01-1 1H8a1 1 0 01-1-1V4m0 0H5a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1V5a1 1 0 00-1-1h-2M9 7h6m-6 4h6m-2 4h2" />
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

                    {/* 字幕下载控制覆盖层 */}
                    {material.type === 'subtitle' && (
                      <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-white bg-opacity-90 flex items-center justify-center transition-all duration-200 opacity-0 group-hover:opacity-100">
                          <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                      </div>
                    )}
                    
                    {/* 类型标识 */}
                    <div className="absolute top-1 left-1">
                      <span className={`px-1 py-0.5 text-xs font-medium rounded ${
                        material.type === 'video' ? 'bg-blue-100 text-blue-800' :
                        material.type === 'audio' ? 'bg-green-100 text-green-800' :
                        material.type === 'subtitle' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-purple-100 text-purple-800'
                      }`}>
                        {material.type === 'video' ? '视频' :
                         material.type === 'audio' ? '音频' : 
                         material.type === 'subtitle' ? '字幕' : '图片'}
                      </span>
                    </div>
                    
                    {/* 删除按钮 - 右上角 */}
                    <div className="absolute top-1 right-1">
                      <button
                        onClick={(e) => handleSingleMaterialDelete(material, e)}
                        className="w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
                        title={`删除素材: ${material.name}`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    
                    {/* 右下角区域 - 时长和AI解析按钮 */}
                    <div className="absolute bottom-1 right-1 flex items-center space-x-1">
                      {/* AI视频解析按钮 - 仅对视频素材显示 */}
                      {material.type === 'video' && (() => {
                        const analysisStatus = getVideoAnalysisStatus ? getVideoAnalysisStatus(material.url || '') : 'idle';
                        const isAnalyzing = analysisStatus === 'analyzing';
                        const isCompleted = analysisStatus === 'completed';
                        
                        return (
                          <button
                            onClick={(e) => handleVideoAnalysis(material, e)}
                            disabled={isAnalyzing}
                            className={`w-5 h-5 rounded flex items-center justify-center transition-all duration-200 hover:scale-110 ${
                              isAnalyzing 
                                ? 'bg-yellow-500 cursor-not-allowed' 
                                : isCompleted 
                                  ? 'bg-green-500 hover:bg-green-600' 
                                  : 'bg-purple-500 hover:bg-purple-600'
                            } text-white`}
                            title={
                              isAnalyzing 
                                ? 'AI解析中...' 
                                : isCompleted 
                                  ? '查看解析结果' 
                                  : 'AI视频解析'
                            }
                          >
                            {isAnalyzing ? (
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : isCompleted ? (
                              // 放大镜图标
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                            ) : (
                              // 齿轮图标
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            )}
                          </button>
                        );
                      })()}
                      
                      {/* 时长显示 */}
                      {material.duration && (
                        <span className="px-1 py-0.5 bg-black bg-opacity-75 text-white text-xs rounded">
                          {material.duration.toFixed(2)}s
                        </span>
                      )}
                    </div>

                    {/* 拖拽指示器 - 移到左下角 */}
                    <div className="absolute bottom-1 left-1">
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

              <button
                onClick={handleSearchAudiosClick}
                className="flex items-center space-x-1 text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 px-2 py-1 rounded transition-colors"
                title="搜索在线音频"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <span>搜索音频</span>
              </button>
              
              {/* 新增：删除全部按钮 */}
              {materials.length > 0 && (
                <button
                  onClick={handleDeleteAllClick}
                  className="flex items-center space-x-1 text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition-colors"
                  title={`删除当前选项卡的所有素材 (${materials.length}个)`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>删除全部</span>
                </button>
              )}
            </div>
            <div className="text-gray-500">
              {materials.length}个素材
            </div>
          </div>
        </div>
      </div>
      
      {/* 确认删除对话框 */}
      <ConfirmationDialog
        isOpen={confirmationDialog.isOpen}
        title={confirmationDialog.title}
        message={confirmationDialog.message}
        type={confirmationDialog.type}
        onConfirm={confirmationDialog.onConfirm}
        onCancel={handleCloseConfirmationDialog}
      />
    </div>
  );
};

export default MaterialsPanel; 