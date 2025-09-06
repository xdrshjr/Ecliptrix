'use client';

import React, { useEffect, useState, useRef } from 'react';
import { UseMaterialManagementReturn } from '../../types';
import { MaterialType, MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import localAudioManager from '@/lib/utils/localAudioManager';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { useLocale } from '@/contexts/LocaleContext';
import { UseComfyUIHealthReturn } from '../../hooks/useComfyUIHealth';
import MediaPreviewModal from '../MediaPreviewModal/MediaPreviewModal';
import { useNotification } from '@/contexts/NotificationContext';

interface MaterialsPanelProps extends UseMaterialManagementReturn {
  onSearchVideos: () => void;
  onSearchAudios: () => void; // 新增：搜索音频回调
  onAIImageGeneration?: () => void; // 新增：AI生图回调
  onAIVideoGeneration?: () => void; // 新增：AI视频生成回调
  onDigitalHumanGeneration?: () => void; // 新增：数字人生成回调
  onAutoMixAudio?: () => void; // 新增：AI自动混剪回调
  onVideoAnalysis?: (material: MaterialItem) => void; // 新增：视频AI解析回调
  onBatchVideoAnalysis?: () => Promise<void>; // 新增：批量视频AI解析回调
  isBatchAnalyzing?: boolean; // 新增：批量解析状态
  getVideoAnalysisStatus?: (videoUrl: string) => 'idle' | 'analyzing' | 'completed' | 'error';
  onRetryDownload?: (material: MaterialItem) => void; // 新增：重试下载回调
  onAddToTimeline?: (material: MaterialItem) => void; // 新增：添加到时间轴回调
  comfyuiHealthStatus?: UseComfyUIHealthReturn; // 新增：ComfyUI健康状态
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
  addOrReplaceMaterial,
  onSearchVideos,
  onSearchAudios, // 新增：搜索音频回调
  onAIImageGeneration, // 新增：AI生图回调
  onAIVideoGeneration, // 新增：AI视频生成回调
  onDigitalHumanGeneration, // 新增：数字人生成回调
  onAutoMixAudio, // 新增：AI自动混剪回调
  onVideoAnalysis, // 新增：视频AI解析回调
  onBatchVideoAnalysis, // 新增：批量视频AI解析回调
  isBatchAnalyzing = false, // 新增：批量解析状态
  getVideoAnalysisStatus, // 新增：获取视频解析状态
  onRetryDownload, // 新增：重试下载回调
  onAddToTimeline, // 新增：添加到时间轴回调
  comfyuiHealthStatus, // 新增：ComfyUI健康状态
  taskId,
  className = '',
  // 新增的删除功能
  handleMaterialDelete,
  confirmationDialog,
  handleCloseConfirmationDialog
}) => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const logger = new VideoEditingLogger({
    taskId,
    component: 'MaterialsPanel'
  });

  // 预览弹窗状态
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    material: MaterialItem | null;
  }>({
    isOpen: false,
    material: null
  });

  const [draggedMaterial, setDraggedMaterial] = useState<MaterialItem | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const materialsGridRef = useRef<HTMLDivElement | null>(null);
  
  // Image to video conversion state
  const [imageToVideoStatus, setImageToVideoStatus] = useState<Record<string, 'idle' | 'converting' | 'completed' | 'error'>>({});
  const [downloadingMaterials, setDownloadingMaterials] = useState<Set<string>>(new Set());
  const [showImageToVideoModal, setShowImageToVideoModal] = useState(false);
  const [selectedImageForConversion, setSelectedImageForConversion] = useState<MaterialItem | null>(null);

  useEffect(() => {
    logger.info('组件初始化 - 素材网格滚动优化版本，按钮样式已优化为图标形式', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType,
      isUploading,
      scrollImplementation: 'materials-grid-container',
      buttonStyleUpdate: 'icon-only-with-tooltip',
      emptyStateUpdate: 'removed-search-button'
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

  const handleAIImageGenerationClick = () => {
    // 检查ComfyUI服务是否可用
    if (!comfyuiHealthStatus?.isServiceAvailable) {
      logger.warn('AI生图服务不可用，阻止操作', {
        healthStatus: comfyuiHealthStatus?.healthStatus?.status,
        comfyuiStatus: comfyuiHealthStatus?.healthStatus?.comfyui_status,
        error: comfyuiHealthStatus?.error
      });
      return;
    }

    logger.info('用户点击AI生图按钮', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType,
      serviceAvailable: comfyuiHealthStatus?.isServiceAvailable
    });
    
    if (onAIImageGeneration) {
      onAIImageGeneration();
    }
  };

  const handleAIVideoGenerationClick = () => {
    // 检查ComfyUI服务是否可用
    if (!comfyuiHealthStatus?.isServiceAvailable) {
      logger.warn('AI视频生成服务不可用，阻止操作', {
        healthStatus: comfyuiHealthStatus?.healthStatus?.status,
        comfyuiStatus: comfyuiHealthStatus?.healthStatus?.comfyui_status,
        error: comfyuiHealthStatus?.error
      });
      return;
    }

    logger.info('用户点击AI视频生成按钮', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType,
      serviceAvailable: comfyuiHealthStatus?.isServiceAvailable
    });
    
    if (onAIVideoGeneration) {
      onAIVideoGeneration();
    }
  };

  const handleDigitalHumanGenerationClick = () => {
    // 检查ComfyUI服务是否可用
    if (!comfyuiHealthStatus?.isServiceAvailable) {
      logger.warn('数字人生成服务不可用，阻止操作', {
        healthStatus: comfyuiHealthStatus?.healthStatus?.status,
        comfyuiStatus: comfyuiHealthStatus?.healthStatus?.comfyui_status,
        error: comfyuiHealthStatus?.error
      });
      return;
    }

    logger.info('用户点击数字人生成按钮', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType,
      serviceAvailable: comfyuiHealthStatus?.isServiceAvailable
    });
    
    if (onDigitalHumanGeneration) {
      onDigitalHumanGeneration();
    }
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

  // 预览素材
  const handlePreviewMaterial = (material: MaterialItem, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    
    logger.userAction('预览素材', 'previewMaterial', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type
    });

    setPreviewModal({
      isOpen: true,
      material
    });
  };

  // 关闭预览弹窗
  const handleClosePreview = () => {
    setPreviewModal({
      isOpen: false,
      material: null
    });
    
    logger.info('关闭素材预览弹窗');
  };

  // 下载素材
  const handleDownloadMaterial = async (material: MaterialItem, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    // 设置下载状态
    setDownloadingMaterials(prev => new Set([...Array.from(prev), material.id]));

    try {
      logger.userAction('下载素材文件', 'downloadMaterial', {
        materialId: material.id,
        materialName: material.name,
        materialType: material.type,
        format: material.format
      });

      // 处理字幕文件下载
      if (material.type === 'subtitle') {
        const srtContent = material.metadata?.srt_content;
        const fileName = material.metadata?.fileName || `${material.name}.srt`;

        if (srtContent) {
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
          showSuccess(`${t.materialsPanel.downloadMaterial}: ${fileName}`);
        } else if (material.url) {
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
          showSuccess(`${t.materialsPanel.downloadMaterial}: ${fileName}`);
        } else {
          throw new Error(t.materialsPanel.subtitleContentError);
        }
      } else {
        // 处理其他类型文件下载
        const fileName = material.metadata?.fileName || material.name;
        const fileExtension = material.format ? `.${material.format}` : '';
        
        // 确保视频文件有正确的扩展名
        let downloadFileName;
        if (fileName.includes('.')) {
          downloadFileName = fileName;
        } else {
          // 如果是视频类型但没有扩展名，确保添加.mp4
          if (material.type === 'video' && !fileExtension) {
            downloadFileName = `${fileName}.mp4`;
          } else {
            downloadFileName = `${fileName}${fileExtension}`;
          }
        }

        if (material.url.startsWith('blob:') || material.url.startsWith('data:')) {
          // 本地blob URL，直接下载
          const a = document.createElement('a');
          a.href = material.url;
          a.download = downloadFileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          logger.info('本地文件下载触发', {
            materialId: material.id,
            fileName: downloadFileName,
            url: material.url.substring(0, 50)
          });
          showSuccess(`${t.materialsPanel.downloadMaterial}: ${downloadFileName}`);
        } else {
          // 远程URL，先获取文件再下载
          const response = await fetch(material.url);
          if (!response.ok) {
            throw new Error(`下载失败: ${response.status} ${response.statusText}`);
          }
          
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = downloadFileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          logger.info('远程文件下载成功', {
            materialId: material.id,
            fileName: downloadFileName,
            fileSize: blob.size,
            originalUrl: material.url
          });
          showSuccess(`${t.materialsPanel.downloadMaterial}: ${downloadFileName}`);
        }
      }
    } catch (error) {
      logger.error('素材文件下载失败', new Error(error instanceof Error ? error.message : String(error)), {
        materialId: material.id,
        materialName: material.name,
        materialType: material.type
      });
      showError(`${t.materialsPanel.subtitleDownloadError}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // 清除下载状态
      setDownloadingMaterials(prev => {
        const newSet = new Set(Array.from(prev));
        newSet.delete(material.id);
        return newSet;
      });
    }
  };

  const handleSubtitleDownload = (material: MaterialItem) => {
    handleDownloadMaterial(material);
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

  // 处理图片转视频
  const handleImageToVideo = (material: MaterialItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    logger.userAction('点击图片转视频按钮', 'imageToVideo', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      imageUrl: material.url
    });

    setSelectedImageForConversion(material);
    setShowImageToVideoModal(true);
  };

  // 将blob URL转换为base64数据
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // 执行图片转视频转换
  const convertImageToVideo = async (effect: string, duration: number = 5.0, options: any = {}) => {
    if (!selectedImageForConversion) return;

    const materialId = selectedImageForConversion.id;
    
    // 立即关闭弹窗
    setShowImageToVideoModal(false);
    
    try {
      // 设置转换状态
      setImageToVideoStatus(prev => ({
        ...prev,
        [materialId]: 'converting'
      }));

      logger.info('开始图片转视频转换', {
        materialId,
        effect,
        duration,
        imageUrl: selectedImageForConversion.url,
        kenBurnsDirection: options.kenBurnsDirection,
        panDirection: options.panDirection,
        imageName: selectedImageForConversion.name,
        imageSize: `${selectedImageForConversion.width}x${selectedImageForConversion.height}`
      });

      let requestBody: any = {
        effect,
        duration,
        task_id: taskId,
        custom_filename: `${selectedImageForConversion.name}_${effect}`,
        ken_burns_direction: options.kenBurnsDirection || 'zoom_in',
        pan_direction: options.panDirection || 'left_to_right'
      };

      // 检查是否是blob URL
      if (selectedImageForConversion.url.startsWith('blob:')) {
        try {
          // 获取blob数据并转换为base64
          const response = await fetch(selectedImageForConversion.url);
          const blob = await response.blob();
          const base64Data = await blobToBase64(blob);
          
          requestBody.image_data = base64Data;
          requestBody.image_filename = selectedImageForConversion.name;
          
          logger.info('使用base64数据进行转换', {
            materialId,
            dataSize: base64Data.length
          });
        } catch (error) {
          logger.error('转换blob为base64失败', error instanceof Error ? error : new Error(String(error)));
          throw new Error('无法读取图片数据');
        }
      } else {
        // 使用URL
        requestBody.image_url = selectedImageForConversion.url;
      }

      const response = await fetch('/api/video/image-to-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (result.success) {
        // 转换成功，添加生成的视频到素材管理
        // 确保视频文件名包含正确的扩展名
        const baseFileName = selectedImageForConversion.name.replace(/\.(jpg|jpeg|png|webp)$/i, '');
        const videoFileName = `${baseFileName}_${effect}.mp4`;
        
        const newVideoMaterial: MaterialItem = {
          id: `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: videoFileName,
          type: 'video',
          format: 'mp4',
          size: result.file_size || 0,
          duration: result.duration || duration,
          width: result.width || selectedImageForConversion.width,
          height: result.height || selectedImageForConversion.height,
          thumbnailUrl: result.thumbnail_url,
          url: result.video_url,
          serverUrl: result.video_url,
          createdAt: new Date(),
          description: `从图片"${selectedImageForConversion.name}"生成的${effect}效果视频`,
          metadata: {
            originalImageId: selectedImageForConversion.id,
            effect,
            processingTime: result.processing_time,
            generatedFromImage: true
          }
        };

        // 添加到素材管理
        if (addOrReplaceMaterial) {
          addOrReplaceMaterial(newVideoMaterial);
        }

        setImageToVideoStatus(prev => ({
          ...prev,
          [materialId]: 'completed'
        }));

        logger.info('图片转视频转换成功', {
          materialId,
          videoUrl: result.video_url,
          processingTime: result.processing_time
        });

        // 清除选中的图片（弹窗已经在开始时关闭了）
        setSelectedImageForConversion(null);

      } else {
        throw new Error(result.message || '转换失败');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      setImageToVideoStatus(prev => ({
        ...prev,
        [materialId]: 'error'
      }));

      logger.error('图片转视频转换失败', error instanceof Error ? error : new Error(errorMessage), {
        materialId,
        effect,
        duration
      });

      // 可以在这里显示错误提示
      alert(`转换失败: ${errorMessage}`);
      
      // 清除选中的图片
      setSelectedImageForConversion(null);
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
            <h3 className="text-sm font-semibold text-gray-900">{t.materialsPanel.title}</h3>
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
                className="p-2 text-green-600 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                title={isBatchAnalyzing ? t.materialsPanel.batchAnalyzing : t.materialsPanel.batchAnalysisTooltip}
              >
                {isBatchAnalyzing ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
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
                className="p-2 text-purple-600 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 transition-colors duration-200"
                title={t.materialsPanel.aiAutoMixTooltip}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </button>
            )}
            
            {/* 上传按钮 */}
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="p-2 text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              title={isUploading ? `${t.materialsPanel.uploadingProgress} ${uploadProgress.toFixed(0)}%` : t.materialsPanel.uploadTooltip}
            >
              {isUploading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
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
              {type === 'all' ? t.materialsPanel.filterAll : 
               type === 'video' ? t.materialsPanel.filterVideo :
               type === 'audio' ? t.materialsPanel.filterAudio : 
               type === 'image' ? t.materialsPanel.filterImage : t.materialsPanel.filterSubtitle}
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
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t.materialsPanel.noMaterials}</h3>
              <p className="text-sm text-gray-500 text-center max-w-sm">
                {t.materialsPanel.emptyDescription}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {materials
                .filter(material => selectedMaterialType === 'all' || material.type === selectedMaterialType)
                .map((material) => (
                <div
                  key={material.id}
                  draggable={material.downloadStatus !== 'downloading' && material.downloadStatus !== 'generating'}
                  onDragStart={(e) => handleDragStart(e, material)}
                  onDragEnd={(e) => handleDragEnd(e, material)}
                  className={`group bg-white border border-gray-200 rounded-md overflow-hidden hover:shadow-md transition-all ${
                    material.downloadStatus === 'downloading' || material.downloadStatus === 'generating'
                      ? 'opacity-60 cursor-not-allowed' 
                      : 'cursor-grab active:cursor-grabbing'
                  } ${
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
                        onLoad={() => {
                          console.log(`[MaterialsPanel] 缩略图加载成功: ${material.name}`, {
                            materialId: material.id,
                            thumbnailUrl: material.thumbnailUrl,
                            materialType: material.type
                          });
                        }}
                        onError={(e) => {
                          console.error(`[MaterialsPanel] 缩略图加载失败: ${material.name}`, {
                            materialId: material.id,
                            thumbnailUrl: material.thumbnailUrl,
                            materialType: material.type,
                            error: e
                          });
                        }}
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

                    {/* YouTube视频下载状态覆盖层 */}
                    {material.downloadStatus === 'downloading' && (
                      <div className="absolute inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-white text-xs font-medium">{t.materialsPanel.downloadingVideo}</span>
                        {material.downloadProgress !== undefined && (
                          <div className="w-16 bg-gray-200 rounded-full h-1 mt-1">
                            <div 
                              className="bg-blue-600 h-1 rounded-full transition-all duration-300" 
                              style={{ width: `${material.downloadProgress}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 数字人生成状态覆盖层 */}
                    {material.downloadStatus === 'generating' && (
                      <div className="absolute inset-0 bg-purple-500 bg-opacity-50 flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-white text-xs font-medium text-center px-1">生成中...</span>
                        {material.downloadProgress !== undefined && (
                          <div className="w-16 bg-gray-200 rounded-full h-1 mt-1">
                            <div 
                              className="bg-white h-1 rounded-full transition-all duration-300" 
                              style={{ width: `${material.downloadProgress}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 下载错误状态覆盖层 */}
                    {material.downloadStatus === 'error' && (
                      <div className="absolute inset-0 bg-red-500 bg-opacity-50 flex flex-col items-center justify-center">
                        <svg className="w-6 h-6 text-white mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-white text-xs font-medium text-center px-1">{t.materialsPanel.downloadFailed}</span>
                        {material.downloadError && (
                          <span className="text-white text-xs opacity-80 text-center px-1 mt-1" title={material.downloadError}>
                            {material.downloadError.length > 20 ? `${material.downloadError.substring(0, 20)}...` : material.downloadError}
                          </span>
                        )}
                        {onRetryDownload && (
                          <button
                            onClick={() => onRetryDownload(material)}
                            className="mt-2 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                            title={t.materialsPanel.retryDownload}
                          >
                            {t.materialsPanel.retryDownload}
                          </button>
                        )}
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
                        {material.type === 'video' ? t.materialsPanel.typeVideo :
                         material.type === 'audio' ? t.materialsPanel.typeAudio : 
                         material.type === 'subtitle' ? t.materialsPanel.typeSubtitle : t.materialsPanel.typeImage}
                      </span>
                    </div>
                    
                    {/* 右上角按钮组 - 添加到时间轴和删除按钮 */}
                    <div className="absolute top-1 right-1 flex items-center space-x-1">
                      {/* 添加到时间轴按钮 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onAddToTimeline) {
                            logger.userAction('添加素材到时间轴', 'addToTimelineButton', {
                              materialId: material.id,
                              materialName: material.name,
                              materialType: material.type
                            });
                            onAddToTimeline(material);
                          }
                        }}
                        className="w-6 h-6 bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
                        title={t.materialsPanel.addToTimelineTooltip}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                      
                      {/* 删除按钮 */}
                      <button
                        onClick={(e) => handleSingleMaterialDelete(material, e)}
                        className="w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
                        title={t.materialsPanel.deleteMaterialTooltip.replace('{name}', material.name)}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    
                    {/* 右下角区域 - 时长和功能按钮 */}
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
                                ? t.materialsPanel.aiAnalyzing 
                                : isCompleted 
                                  ? t.materialsPanel.viewAnalysisResult 
                                  : t.materialsPanel.aiVideoAnalysis
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

                      {/* 图片转视频按钮 - 仅对图片素材显示 */}
                      {material.type === 'image' && (
                        <button
                          onClick={(e) => handleImageToVideo(material, e)}
                          disabled={imageToVideoStatus[material.id] === 'converting'}
                          className={`w-5 h-5 rounded flex items-center justify-center transition-all duration-200 hover:scale-110 ${
                            imageToVideoStatus[material.id] === 'converting'
                              ? 'bg-blue-500 cursor-not-allowed' 
                              : 'bg-orange-500 hover:bg-orange-600'
                          } text-white`}
                          title={
                            imageToVideoStatus[material.id] === 'converting'
                              ? '正在转换为视频...'
                              : '转视频'
                          }
                        >
                          {imageToVideoStatus[material.id] === 'converting' ? (
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            // 视频转换图标
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      )}
                      
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
                  
                  {/* 操作按钮横条 */}
                  <div className="border-b border-gray-100 bg-gray-50 px-1.5 py-0.5 flex items-center justify-center space-x-1">
                    <button
                      onClick={(e) => handlePreviewMaterial(material, e)}
                      className="flex-1 flex items-center justify-center px-1.5 py-0.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-all duration-200 group"
                      title={t.materialsPanel.previewMaterial}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    
                    <div className="w-px h-3 bg-gray-200"></div>
                    
                    <button
                      onClick={(e) => handleDownloadMaterial(material, e)}
                      disabled={downloadingMaterials.has(material.id)}
                      className={`flex-1 flex items-center justify-center px-1.5 py-0.5 rounded transition-all duration-200 group ${
                        downloadingMaterials.has(material.id)
                          ? 'text-blue-600 bg-blue-50 cursor-not-allowed'
                          : 'text-gray-600 hover:text-green-600 hover:bg-green-50'
                      }`}
                      title={downloadingMaterials.has(material.id) ? '下载中...' : t.materialsPanel.downloadMaterial}
                    >
                      {downloadingMaterials.has(material.id) ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </button>
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
                title={t.materialsPanel.searchVideosTooltip}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>{t.materialsPanel.searchVideos}</span>
              </button>

              <button
                onClick={handleSearchAudiosClick}
                className="flex items-center space-x-1 text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 px-2 py-1 rounded transition-colors"
                title={t.materialsPanel.searchAudiosTooltip}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <span>{t.materialsPanel.searchAudios}</span>
              </button>

              <button
                onClick={handleAIImageGenerationClick}
                disabled={!comfyuiHealthStatus?.isServiceAvailable}
                className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors ${
                  comfyuiHealthStatus?.isServiceAvailable 
                    ? 'text-purple-600 hover:text-purple-700 bg-purple-50 hover:bg-purple-100 cursor-pointer' 
                    : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                }`}
                title={
                  comfyuiHealthStatus?.isServiceAvailable 
                    ? "AI生图" 
                    : "AI生图服务不可用，请联系管理员"
                }
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>AI生图</span>
              </button>

              <button
                onClick={handleAIVideoGenerationClick}
                disabled={!comfyuiHealthStatus?.isServiceAvailable}
                className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors ${
                  comfyuiHealthStatus?.isServiceAvailable 
                    ? 'text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 cursor-pointer' 
                    : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                }`}
                title={
                  comfyuiHealthStatus?.isServiceAvailable 
                    ? "AI视频" 
                    : "AI视频服务不可用，请联系管理员"
                }
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>AI视频</span>
              </button>

              <button
                onClick={handleDigitalHumanGenerationClick}
                disabled={!comfyuiHealthStatus?.isServiceAvailable}
                className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors ${
                  comfyuiHealthStatus?.isServiceAvailable 
                    ? 'text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 cursor-pointer' 
                    : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                }`}
                title={
                  comfyuiHealthStatus?.isServiceAvailable 
                    ? "数字人" 
                    : "数字人服务不可用，请联系管理员"
                }
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>数字人</span>
              </button>
              
            </div>
            <div className="text-gray-500">
              {materials.length}{t.materialsPanel.materialsCount}
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

      {/* 图片转视频效果选择弹窗 */}
      {showImageToVideoModal && selectedImageForConversion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">选择视频效果</h3>
            <p className="text-sm text-gray-600 mb-4">
              将图片 "{selectedImageForConversion.name}" 转换为视频
            </p>
            
            <div className="space-y-3 mb-6">
              {/* 静态效果 */}
              <button
                onClick={() => convertImageToVideo('static')}
                className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <div className="font-medium">静态视频</div>
                <div className="text-sm text-gray-500">直接将图片转换为静态视频</div>
              </button>

              {/* Ken Burns效果 */}
              <div className="space-y-2">
                <button
                  onClick={() => convertImageToVideo('ken_burns', 5.0, { kenBurnsDirection: 'zoom_in' })}
                  className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className="font-medium">Ken Burns - 放大</div>
                  <div className="text-sm text-gray-500">从正常大小缓慢细微放大（稳定渐变效果）</div>
                </button>
                <button
                  onClick={() => convertImageToVideo('ken_burns', 5.0, { kenBurnsDirection: 'zoom_out' })}
                  className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className="font-medium">Ken Burns - 缩小</div>
                  <div className="text-sm text-gray-500">从细微放大状态缓慢缩小至正常大小（稳定渐变效果）</div>
                </button>
              </div>

              {/* 平移效果 */}
              <div className="space-y-2">
                <button
                  onClick={() => convertImageToVideo('pan', 5.0, { panDirection: 'left_to_right' })}
                  className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className="font-medium">平移 - 从左到右</div>
                  <div className="text-sm text-gray-500">水平从左向右平移</div>
                </button>
                <button
                  onClick={() => convertImageToVideo('pan', 5.0, { panDirection: 'right_to_left' })}
                  className="w-full p-3 text-left border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className="font-medium">平移 - 从右到左</div>
                  <div className="text-sm text-gray-500">水平从右向左平移</div>
                </button>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowImageToVideoModal(false);
                  setSelectedImageForConversion(null);
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 媒体预览弹窗 */}
      <MediaPreviewModal
        isOpen={previewModal.isOpen}
        material={previewModal.material}
        onClose={handleClosePreview}
        taskId={taskId}
      />
    </div>
  );
};

export default MaterialsPanel; 