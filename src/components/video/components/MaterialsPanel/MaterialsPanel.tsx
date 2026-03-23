'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { UseMaterialManagementReturn } from '../../types';
import { MaterialType, MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import localAudioManager from '@/lib/utils/localAudioManager';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { useLocale } from '@/contexts/LocaleContext';
import MediaPreviewModal from '../MediaPreviewModal/MediaPreviewModal';
import WatermarkRemovalModal from '../WatermarkRemovalModal/WatermarkRemovalModal';
import { useNotification } from '@/contexts/NotificationContext';
import AiVideoModal from '../AiVideoModal/AiVideoModal';
import AiImageModal from '../AiImageModal/AiImageModal';
import StoryboardPackCard from './StoryboardPackCard';
import StoryboardPackView from './StoryboardPackView';
import StoryboardPackModal from './StoryboardPackModal';
import { StoryboardPack, StoryboardFrame } from '@/types';
import { listPacks, deletePack } from '@/lib/api/storyboard';

interface MaterialsPanelProps extends UseMaterialManagementReturn {
  onSearchVideos: () => void;
  onSearchAudios: () => void; // 新增：搜索音频回调
  onSearchImages: () => void; // 新增：搜索图片回调
  onAIMixedEditing?: () => void; // 新增：AI混剪回调
  onAutoMixAudio?: () => void; // 新增：AI自动混剪回调
  onVideoAnalysis?: (material: MaterialItem) => void; // 新增：视频AI解析回调
  onBatchVideoAnalysis?: () => Promise<void>; // 新增：批量视频AI解析回调
  getVideoAnalysisStatus?: (videoUrl: string) => 'idle' | 'waiting' | 'analyzing' | 'completed' | 'error';
  onRetryDownload?: (material: MaterialItem) => void; // 新增：重试下载回调
  onAddToTimeline?: (material: MaterialItem) => void; // 新增：添加到时间轴回调
  onCutMaterial?: (material: MaterialItem) => void; // 新增：剪切素材回调
  onWatermarkRemoval?: (material: MaterialItem) => void; // 新增：水印去除回调
  onSelectPackForScript?: (pack: StoryboardPack) => void; // 分镜包→脚本面板回调
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
  handleDragUpload, // 新增：拖拽上传处理函数
  addOrReplaceMaterial,
  onSearchVideos,
  onSearchAudios, // 新增：搜索音频回调
  onSearchImages, // 新增：搜索图片回调
  onAIMixedEditing, // 新增：AI混剪回调
  onAutoMixAudio, // 新增：AI自动混剪回调
  onVideoAnalysis, // 新增：视频AI解析回调
  onBatchVideoAnalysis, // 新增：批量视频AI解析回调
  getVideoAnalysisStatus, // 新增：获取视频解析状态
  onRetryDownload, // 新增：重试下载回调
  onAddToTimeline, // 新增：添加到时间轴回调
  onCutMaterial, // 新增：剪切素材回调
  onWatermarkRemoval, // 新增：水印去除回调
  onSelectPackForScript, // 分镜包→脚本面板回调
  taskId,
  className = '',
  // 新增的删除功能
  handleMaterialDelete,
  confirmationDialog,
  handleCloseConfirmationDialog,
  handleAiVideoGenerate,
  handleAiImageGenerate,
  handleStoryboardGenerate,
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

  // 拖拽状态管理
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const [draggedMaterial, setDraggedMaterial] = useState<MaterialItem | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const materialsGridRef = useRef<HTMLDivElement | null>(null);
  
  // Image to video conversion state
  const [imageToVideoStatus, setImageToVideoStatus] = useState<Record<string, 'idle' | 'converting' | 'completed' | 'error'>>({});
  const [downloadingMaterials, setDownloadingMaterials] = useState<Set<string>>(new Set());
  const [showImageToVideoModal, setShowImageToVideoModal] = useState(false);
  const [selectedImageForConversion, setSelectedImageForConversion] = useState<MaterialItem | null>(null);
  
  // 水印去除弹窗状态
  const [watermarkRemovalModal, setWatermarkRemovalModal] = useState<{
    isOpen: boolean;
    material: MaterialItem | null;
  }>({
    isOpen: false,
    material: null
  });

  // AI视频生成弹窗状态
  const [isAiVideoModalOpen, setIsAiVideoModalOpen] = useState(false);
  const [aiVideoInitialImage, setAiVideoInitialImage] = useState<{ url: string; name: string } | null>(null);
  // AI图像生成弹窗状态
  const [isAiImageModalOpen, setIsAiImageModalOpen] = useState(false);

  // 分镜包状态
  const [storyboardPacks, setStoryboardPacks] = useState<StoryboardPack[]>([]);
  const [currentStoryboardPack, setCurrentStoryboardPack] = useState<StoryboardPack | null>(null);
  const [storyboardPackModal, setStoryboardPackModal] = useState<{
    isOpen: boolean;
    pack: StoryboardPack | null;
  }>({ isOpen: false, pack: null });
  const [storyboardPackDeleteConfirm, setStoryboardPackDeleteConfirm] = useState<{
    isOpen: boolean;
    packId: string | null;
  }>({ isOpen: false, packId: null });

  // 图片转视频弹出菜单状态
  const [imageToVideoPopover, setImageToVideoPopover] = useState<{
    visible: boolean;
    material: MaterialItem | null;
    position: { x: number; y: number };
  }>({ visible: false, material: null, position: { x: 0, y: 0 } });
  const popoverRef = useRef<HTMLDivElement | null>(null);
  
  // Material Library Dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Effect selection state
  const [selectedEffect, setSelectedEffect] = useState('');
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const imagePreviewRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    logger.info('组件初始化 - 素材网格3列布局，按钮样式已优化为图标形式', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType,
      isUploading,
      scrollImplementation: 'materials-grid-container',
      gridLayout: 'grid-cols-3',
      buttonStyleUpdate: 'icon-only-with-tooltip',
      emptyStateUpdate: 'removed-search-button'
    });
  }, []);

  // 加载分镜包列表
  const refreshStoryboardPacks = useCallback(async () => {
    try {
      const packs = await listPacks();
      setStoryboardPacks(packs);
      logger.info('分镜包列表加载成功', { count: packs.length });
    } catch (error) {
      logger.error('加载分镜包列表失败', error instanceof Error ? error : new Error(String(error)));
    }
  }, [logger]);

  useEffect(() => {
    refreshStoryboardPacks();
  }, []);

  // 删除分镜包
  const handleDeleteStoryboardPack = useCallback((packId: string) => {
    setStoryboardPackDeleteConfirm({ isOpen: true, packId });
  }, []);

  const handleConfirmDeleteStoryboardPack = useCallback(async () => {
    const packId = storyboardPackDeleteConfirm.packId;
    if (!packId) return;
    setStoryboardPackDeleteConfirm({ isOpen: false, packId: null });
    try {
      await deletePack(packId);
      setStoryboardPacks(prev => prev.filter(p => p.packId !== packId));
      // If we are inside this pack, go back to top level
      if (currentStoryboardPack?.packId === packId) {
        setCurrentStoryboardPack(null);
      }
      showSuccess('分镜包已删除');
      logger.info('分镜包删除成功', { packId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showError(`删除分镜包失败: ${msg}`);
      logger.error('删除分镜包失败', error instanceof Error ? error : new Error(msg));
    }
  }, [storyboardPackDeleteConfirm.packId, currentStoryboardPack, showSuccess, showError, logger]);

  // 将所有帧添加为独立素材
  const handleAddAllFramesToMaterials = useCallback((pack: StoryboardPack) => {
    const newMaterials: MaterialItem[] = pack.frames.map((frame, idx) => ({
      id: `storyboard_frame_${pack.packId}_${frame.index}_${Date.now()}`,
      name: `分镜_${pack.gridSize}_帧${idx + 1}`,
      type: 'image' as const,
      format: 'png',
      size: 0,
      url: frame.url,
      thumbnailUrl: frame.url,
      createdAt: new Date(),
      metadata: {
        source: 'storyboard',
        storyboardPackId: pack.packId,
        frameIndex: frame.index,
      },
    }));
    const success = addOrReplaceMaterial
      ? newMaterials.every(m => addOrReplaceMaterial(m))
      : false;
    if (success) {
      showSuccess(`已添加 ${newMaterials.length} 帧到素材`);
    }
  }, [addOrReplaceMaterial, showSuccess]);

  // 处理帧点击（预览）— index=-1 表示原始分镜大图
  const handleFramePreviewClick = useCallback((frame: StoryboardFrame) => {
    if (!frame.url) return;
    const isOriginalImage = frame.index === -1;
    const pseudoMaterial: MaterialItem = {
      id: isOriginalImage ? 'frame_preview_original' : `frame_preview_${frame.index}`,
      name: isOriginalImage ? '原始分镜大图' : `帧 #${frame.index + 1}`,
      type: 'image',
      format: 'png',
      size: 0,
      url: frame.url,
      thumbnailUrl: frame.url,
      createdAt: new Date(),
    };
    setPreviewModal({ isOpen: true, material: pseudoMaterial });
  }, []);

  // 关闭图片转视频弹出菜单（点击外部）
  useEffect(() => {
    if (!imageToVideoPopover.visible) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setImageToVideoPopover(prev => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [imageToVideoPopover.visible]);

  // 监听 materials 变化
  useEffect(() => {
    logger.info('素材列表更新 - 3列优化布局，独立滚动容器', {
      materialsCount: materials.length,
      layoutType: 'grid-cols-3-optimized',
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

  const handleSearchImagesClick = () => {
    logger.info('用户点击搜索图片按钮', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType
    });
    
    onSearchImages();
  };

  // Material Library Dropdown handlers
  const handleMaterialLibraryClick = useCallback(() => {
    logger.info('用户点击素材库按钮', {
      materialsCount: materials.length,
      selectedType: selectedMaterialType,
      dropdownOpen: !isDropdownOpen
    });
    
    setIsDropdownOpen(!isDropdownOpen);
  }, [isDropdownOpen, materials.length, selectedMaterialType, logger]);

  const handleDropdownOptionClick = useCallback((option: 'video' | 'audio' | 'image') => {
    logger.info('用户选择素材库选项', {
      option,
      materialsCount: materials.length,
      selectedType: selectedMaterialType
    });
    
    setIsDropdownOpen(false);
    
    switch (option) {
      case 'video':
        onSearchVideos();
        break;
      case 'audio':
        onSearchAudios();
        break;
      case 'image':
        onSearchImages();
        break;
    }
  }, [materials.length, selectedMaterialType, logger, onSearchVideos, onSearchAudios, onSearchImages]);

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        if (isDropdownOpen) {
          logger.info('素材库下拉菜单因点击外部而关闭');
          setIsDropdownOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen, logger]);

  // Handle mouse leave dropdown
  const handleDropdownMouseLeave = useCallback(() => {
    if (isDropdownOpen) {
      logger.info('素材库下拉菜单因鼠标离开而关闭');
      setIsDropdownOpen(false);
    }
  }, [isDropdownOpen, logger]);

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
    
    logger.info('关闭素材预览弹窗', {
      previousMaterial: previewModal.material?.id,
      previousMaterialName: previewModal.material?.name,
      closeMethod: 'manual-close'
    });
  };

  // 剪切素材
  const handleCutMaterial = (material: MaterialItem, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }

    logger.userAction('打开视频剪切弹窗', 'cutMaterial', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type
    });

    if (onCutMaterial) {
      onCutMaterial(material);
    } else {
      // 如果没有传入回调，显示提示信息
      showSuccess(`即将打开视频剪切功能：${material.name}`);
    }
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

  // 处理图片转视频 - 显示弹出菜单
  const handleImageToVideo = (material: MaterialItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    logger.userAction('点击图片转视频按钮', 'imageToVideo', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      imageUrl: material.url
    });

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setImageToVideoPopover({
      visible: true,
      material,
      position: { x: rect.left, y: rect.bottom + 4 },
    });
  };

  // 选择效果转换
  const handleChooseEffectConversion = () => {
    const material = imageToVideoPopover.material;
    setImageToVideoPopover(prev => ({ ...prev, visible: false }));
    if (material) {
      setSelectedImageForConversion(material);
      setShowImageToVideoModal(true);
    }
  };

  // 判断是否为可被外部API访问的公网URL（排除相对路径和本地地址）
  const isPublicUrl = (url: string): boolean => {
    try {
      const u = new URL(url); // 不传base，相对路径会抛异常
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname.match(/^(localhost|127\.|0\.0\.0\.|10\.|192\.168\.)/);
    } catch {
      return false;
    }
  };

  // 解析图片URL（优先公网URL，否则转base64）
  const resolveImageUrl = async (material: MaterialItem): Promise<string> => {
    // 1. 公网原始URL（Pexels/Unsplash）
    if (material.metadata?.originalUrl && isPublicUrl(material.metadata.originalUrl)) {
      return material.metadata.originalUrl;
    }
    // 2. serverUrl 为公网URL（如OSS CDN）
    if (material.serverUrl && isPublicUrl(material.serverUrl)) {
      return material.serverUrl;
    }
    // 3. 转 base64（本地文件、blob URL、相对路径）
    const fetchUrl = material.serverUrl || material.url;
    const response = await fetch(fetchUrl);
    const blob = await response.blob();
    return await blobToBase64(blob);
  };

  // 选择AI视频生成
  const handleChooseAiVideoGeneration = async () => {
    const material = imageToVideoPopover.material;
    setImageToVideoPopover(prev => ({ ...prev, visible: false }));
    if (!material) return;
    try {
      const resolvedUrl = await resolveImageUrl(material);
      setAiVideoInitialImage({ url: resolvedUrl, name: material.name });
      setIsAiVideoModalOpen(true);
    } catch (err) {
      logger.error('解析图片URL失败', err instanceof Error ? err : new Error(String(err)));
      showError('无法解析图片，请重试');
    }
  };

  // 处理水印去除
  const handleWatermarkRemoval = (material: MaterialItem, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    logger.info('打开水印去除弹窗', {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type
    });

    setWatermarkRemovalModal({
      isOpen: true,
      material: material
    });

    // 调用父组件回调
    if (onWatermarkRemoval) {
      onWatermarkRemoval(material);
    }
  };

  // 关闭水印去除弹窗
  const handleCloseWatermarkRemovalModal = () => {
    logger.info('关闭水印去除弹窗');
    setWatermarkRemovalModal({
      isOpen: false,
      material: null
    });
  };

  // 水印去除完成回调
  const handleWatermarkRemoved = (processedVideoUrl: string, originalMaterial: MaterialItem) => {
    logger.info('水印去除完成', {
      originalMaterialId: originalMaterial.id,
      originalMaterialName: originalMaterial.name,
      originalMaterialUrl: originalMaterial.url.substring(0, 100),
      processedVideoUrl: processedVideoUrl.substring(0, 100)
    });

    // 创建新的素材项，保持原有ID但更新URL和名称
    const newMaterial: MaterialItem = {
      ...originalMaterial,
      // 保持原有ID，这样时间轴中已经添加的素材会自动使用新的URL
      id: originalMaterial.id,
      name: `${originalMaterial.name.replace(/\.[^/.]+$/, '').replace(/_无水印$/, '')}_无水印.mp4`,
      url: processedVideoUrl,
      // 保留serverUrl以备用
      serverUrl: processedVideoUrl,
      // 更新创建时间以标记为最新版本
      createdAt: new Date(),
      // 添加元数据标记这是水印去除后的版本
      metadata: {
        ...originalMaterial.metadata,
        isWatermarkRemoved: true,
        originalVideoUrl: originalMaterial.url,
        watermarkRemovedAt: new Date().toISOString(),
        source: 'watermark-removed'
      }
    };

    logger.info('替换原始素材为去水印版本', {
      materialId: newMaterial.id,
      newMaterialName: newMaterial.name,
      newMaterialUrl: newMaterial.url.substring(0, 100),
      replacementStrategy: 'same-id-replacement',
      reason: '保持ID不变确保时间轴中的素材引用正确指向去水印版本'
    });

    // 替换素材而不是添加新素材，这样时间轴中的引用会自动更新
    addOrReplaceMaterial(newMaterial);
    
    showSuccess('水印去除成功！素材已更新为无水印版本');
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

      const requestBody: any = {
        effect,
        duration,
        task_id: taskId,
        custom_filename: `${selectedImageForConversion.name}_${effect}`,
        ken_burns_direction: options.kenBurnsDirection || 'zoom_in',
        pan_direction: options.panDirection || 'left_to_right',
        focus_x: options.focusX || 0.5,
        focus_y: options.focusY || 0.5
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

  // 拖拽事件处理函数
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragCounter(prev => prev + 1);
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      // 检查是否包含文件
      const hasFiles = Array.from(e.dataTransfer.items).some(item => item.kind === 'file');
      if (hasFiles) {
        setIsDragOver(true);
        logger.info('拖拽进入素材面板', {
          itemCount: e.dataTransfer.items.length,
          hasFiles
        });
      }
    }
  }, [logger]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragCounter(prev => {
      const newCounter = prev - 1;
      if (newCounter === 0) {
        setIsDragOver(false);
        logger.info('拖拽离开素材面板');
      }
      return newCounter;
    });
  }, [logger]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 设置拖拽效果
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragOver(false);
    setDragCounter(0);
    
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) {
      logger.warn('拖拽放置：没有文件');
      return;
    }

    // 过滤支持的文件类型
    const supportedFiles = Array.from(files).filter(file => {
      const isSupported = file.type.startsWith('video/') || 
                         file.type.startsWith('audio/') || 
                         file.type.startsWith('image/');
      if (!isSupported) {
        logger.warn('拖拽放置：不支持的文件类型', {
          fileName: file.name,
          fileType: file.type
        });
      }
      return isSupported;
    });

    if (supportedFiles.length === 0) {
      showError('不支持的文件类型，请上传视频、音频或图片文件');
      logger.warn('拖拽放置：所有文件都不支持');
      return;
    }

    if (supportedFiles.length < files.length) {
      showError(`已过滤 ${files.length - supportedFiles.length} 个不支持的文件`);
    }

    logger.info('拖拽放置文件', {
      totalFiles: files.length,
      supportedFiles: supportedFiles.length,
      fileNames: supportedFiles.map(f => f.name),
      fileTypes: supportedFiles.map(f => f.type)
    });

    // 创建 FileList 对象
    const fileList = supportedFiles.reduce((dt, file) => {
      dt.items.add(file);
      return dt;
    }, new DataTransfer()).files;

    try {
      await handleDragUpload(fileList);
      showSuccess(`成功开始上传 ${supportedFiles.length} 个文件`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '拖拽上传失败';
      showError(errorMessage);
      logger.error('拖拽上传失败', error as Error);
    }
  }, [handleDragUpload, showSuccess, showError, logger]);

  const getEffectDescription = (effect: string) => {
    switch (effect) {
      case 'static':
        return '直接将图片转换为静态视频';
      case 'ken_burns_zoom_in':
        return '逐渐放大到设置的聚焦位置（稳定渐变效果）';
      case 'ken_burns_zoom_out':
        return '从放大状态缩小到正常大小（稳定渐变效果）';
      case 'pan_left_to_right':
        return '水平从左向右平移';
      case 'pan_right_to_left':
        return '水平从右向左平移';
      default:
        return '未知效果';
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!imagePreviewRef.current) return;
    
    const rect = imagePreviewRef.current.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;
    const relativeY = (e.clientY - rect.top) / rect.height;
    
    // 确保坐标在 0-1 范围内
    const x = Math.max(0, Math.min(1, relativeX));
    const y = Math.max(0, Math.min(1, relativeY));
    
    setFocusPoint({ x, y });
    
    logger.info('设置聚焦点', {
      imageUrl: selectedImageForConversion?.url,
      focusX: x,
      focusY: y,
      rawCoords: { clientX: e.clientX, clientY: e.clientY },
      rectInfo: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    });
  };

  const handleImageLoad = () => {
    logger.info('图片加载成功', {
      imageUrl: selectedImageForConversion!.url,
      imageName: selectedImageForConversion!.name
    });
  };

  const handleConvertWithFocus = () => {
    if (!selectedEffect || !focusPoint) {
      logger.error('缺少必要参数', {
        selectedEffect,
        focusPoint,
        imageUrl: selectedImageForConversion?.url
      });
      return;
    }

    let effect = '';
    const options: any = {
      focusX: focusPoint.x,
      focusY: focusPoint.y
    };

    // 根据选择的效果设置参数
    if (selectedEffect === 'static') {
      effect = 'static';
    } else if (selectedEffect === 'ken_burns_zoom_in') {
      effect = 'ken_burns';
      options.kenBurnsDirection = 'zoom_in';
    } else if (selectedEffect === 'ken_burns_zoom_out') {
      effect = 'ken_burns';
      options.kenBurnsDirection = 'zoom_out';
    } else if (selectedEffect === 'pan_left_to_right') {
      effect = 'pan';
      options.panDirection = 'left_to_right';
    } else if (selectedEffect === 'pan_right_to_left') {
      effect = 'pan';
      options.panDirection = 'right_to_left';
    }

    logger.info('开始转换图片到视频（带聚焦点）', {
      effect,
      options,
      selectedEffect,
      imageUrl: selectedImageForConversion?.url
    });

    convertImageToVideo(effect, 5.0, options);
  };

  return (
    <div className={`h-full ${className}`}>
      <div className="materials-panel-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-primary/10 rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-foreground">{t.materialsPanel.title}</h3>
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
                className="p-2 text-accent-foreground bg-accent border border-border rounded-md hover:bg-accent/80 hover:border-border transition-colors"
                title={t.materialsPanel.batchAnalysisTooltip}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
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
                className="p-2 text-accent-foreground bg-accent border border-border rounded-md hover:bg-accent/80 hover:border-border transition-colors"
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
              className="p-2 text-primary bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/20 hover:border-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        <div className="flex space-x-1 mb-4 p-1 bg-muted rounded-md">
          {(['all', 'video', 'audio', 'image', 'subtitle', 'storyboard_pack'] as const).map((type) => (
            <button
              key={type}
              onClick={() => handleTypeFilter(type)}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                selectedMaterialType === type
                  ? 'bg-card text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {type === 'all' ? t.materialsPanel.filterAll :
               type === 'video' ? t.materialsPanel.filterVideo :
               type === 'audio' ? t.materialsPanel.filterAudio :
               type === 'image' ? t.materialsPanel.filterImage :
               type === 'storyboard_pack' ? '分镜包' : t.materialsPanel.filterSubtitle}
            </button>
          ))}
        </div>

        {/* 分镜包内部视图 — 当 currentStoryboardPack 非空时显示 */}
        {currentStoryboardPack ? (
          <div className="materials-grid-container">
            <StoryboardPackView
              pack={currentStoryboardPack}
              onBack={() => setCurrentStoryboardPack(null)}
              onSelectForScript={(pack) => {
                if (onSelectPackForScript) onSelectPackForScript(pack);
              }}
              onDelete={handleDeleteStoryboardPack}
              onFrameClick={handleFramePreviewClick}
              onAddAllFramesToMaterials={handleAddAllFramesToMaterials}
            />
          </div>
        ) : (
        /* 素材网格 */
        <div
          className={`materials-grid-container relative ${
            isDragOver ? 'drag-over' : ''
          }`}
          ref={materialsGridRef}
          onScroll={handleGridScroll}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* 拖拽覆盖层 */}
          {isDragOver && (
            <div className="absolute inset-0 bg-primary/10 bg-opacity-90 border-2 border-dashed border-primary/30 rounded-md flex items-center justify-center z-10 pointer-events-none">
              <div className="text-center">
                <svg className="w-12 h-12 text-primary mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-primary font-medium text-lg">拖放文件到此处上传</p>
                <p className="text-primary text-sm mt-1">支持视频、音频和图片文件</p>
              </div>
            </div>
          )}

          {/* Empty state for storyboard_pack filter with no packs */}
          {selectedMaterialType === 'storyboard_pack' && storyboardPacks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">暂无分镜包</h3>
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                点击AI图像生成创建分镜包
              </p>
            </div>
          ) : materials.length === 0 && storyboardPacks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">{t.materialsPanel.noMaterials}</h3>
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                {t.materialsPanel.emptyDescription}
              </p>
              <p className="text-sm text-muted-foreground text-center max-w-sm mt-2">
                或者直接拖拽文件到此处上传
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {/* 分镜包卡片 — 在 all 或 storyboard_pack 筛选时显示 */}
              {(selectedMaterialType === 'all' || selectedMaterialType === 'storyboard_pack') &&
                storyboardPacks.map((pack) => (
                  <StoryboardPackCard
                    key={`sp_${pack.packId}`}
                    pack={pack}
                    onClick={(p) => setStoryboardPackModal({ isOpen: true, pack: p })}
                    onDoubleClick={(p) => setCurrentStoryboardPack(p)}
                    onDelete={handleDeleteStoryboardPack}
                  />
                ))
              }
              {/* 普通素材卡片 — storyboard_pack 类型由上方的 StoryboardPackCard 渲染 */}
              {selectedMaterialType !== 'storyboard_pack' && materials
                .filter(material => material.type !== 'storyboard_pack' && (selectedMaterialType === 'all' || material.type === selectedMaterialType))
                .map((material) => (
                <div
                  key={material.id}
                  draggable={material.downloadStatus !== 'downloading' && material.downloadStatus !== 'generating' && material.uploadStatus !== 'uploading' && material.uploadStatus !== 'waiting'}
                  onDragStart={(e) => handleDragStart(e, material)}
                  onDragEnd={(e) => handleDragEnd(e, material)}
                  className={`group bg-card border border-border rounded-md overflow-hidden transition-all ${
                    material.downloadStatus === 'downloading' || material.downloadStatus === 'generating' || material.uploadStatus === 'uploading' || material.uploadStatus === 'waiting'
                      ? 'opacity-60 cursor-not-allowed' 
                      : 'cursor-grab active:cursor-grabbing'
                  } ${
                    draggedMaterial?.id === material.id ? 'opacity-50 scale-95' : ''
                  } ${material.type === 'audio' ? 'cursor-pointer' : ''}`}
                  onClick={() => handleMaterialClick(material)}
                >
                  {/* 缩略图区域 */}
                  <div className="aspect-video bg-muted relative">
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
                          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6 3 3 0 000-6z" />
                          </svg>
                        ) : material.type === 'image' ? (
                          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        ) : material.type === 'subtitle' ? (
                          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m0 0V3a1 1 0 011 1v12a1 1 0 01-1 1H8a1 1 0 01-1-1V4m0 0H5a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1V5a1 1 0 00-1-1h-2M9 7h6m-6 4h6m-2 4h2" />
                          </svg>
                        ) : (
                          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                    )}

                    {/* 音频播放控制覆盖层 */}
                    {material.type === 'audio' && (
                      <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                        <div className={`w-10 h-10 rounded-md bg-card bg-opacity-90 flex items-center justify-center transition-all duration-200 ${
                          playingAudio === material.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}>
                          {playingAudio === material.id ? (
                            <svg className="w-5 h-5 text-foreground" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                            </svg>
                          ) : (
                            <svg className="w-5 h-5 text-foreground ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 字幕下载控制覆盖层 */}
                    {material.type === 'subtitle' && (
                      <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-md bg-card bg-opacity-90 flex items-center justify-center transition-all duration-200 opacity-0 group-hover:opacity-100">
                          <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                      </div>
                    )}

                    {/* YouTube视频下载状态覆盖层 */}
                    {material.downloadStatus === 'downloading' && (
                      <div className="absolute inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-primary-foreground text-xs font-medium">{t.materialsPanel.downloadingVideo}</span>
                        {material.downloadProgress !== undefined && (
                          <div className="w-16 bg-accent rounded-full h-1 mt-1">
                            <div
                              className="bg-primary h-1 rounded-full transition-all duration-300"
                              style={{ width: `${material.downloadProgress}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 素材等待上传状态覆盖层 */}
                    {material.uploadStatus === 'waiting' && (
                      <div className="absolute inset-0 bg-warning bg-opacity-50 flex flex-col items-center justify-center">
                        <svg className="w-8 h-8 text-primary-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-primary-foreground text-xs font-medium text-center px-1">等待上传...</span>
                      </div>
                    )}

                    {/* 视频AI解析等待状态覆盖层 */}
                    {material.type === 'video' && getVideoAnalysisStatus && getVideoAnalysisStatus(material.url || '') === 'waiting' && (
                      <div className="absolute inset-0 bg-warning bg-opacity-50 flex flex-col items-center justify-center">
                        <svg className="w-8 h-8 text-primary-foreground mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-primary-foreground text-xs font-medium text-center px-1">等待AI解析...</span>
                      </div>
                    )}

                    {/* 素材上传状态覆盖层 */}
                    {material.uploadStatus === 'uploading' && (
                      <div className="absolute inset-0 bg-primary bg-opacity-50 flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-primary-foreground text-xs font-medium">{t.materialsPanel.uploadingMaterial}</span>
                        {material.uploadProgress !== undefined && (
                          <div className="w-16 bg-accent rounded-full h-1 mt-1">
                            <div
                              className="bg-primary-foreground h-1 rounded-full transition-all duration-300"
                              style={{ width: `${material.uploadProgress}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI生成状态覆盖层（用于 AI视频/数字人等 downloadStatus='generating' 的素材） */}
                    {material.downloadStatus === 'generating' && (
                      <div className="absolute inset-0 bg-primary bg-opacity-50 flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-primary-foreground text-xs font-medium text-center px-1">生成中...</span>
                        {material.downloadProgress !== undefined && (
                          <div className="w-16 bg-accent rounded-full h-1 mt-1">
                            <div
                              className="bg-primary-foreground h-1 rounded-full transition-all duration-300"
                              style={{ width: `${material.downloadProgress}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* FLUX生成状态覆盖层 */}
                    {material.metadata?.source === 'flux-generating' && (
                      <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/70 bg-opacity-90 flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span className="text-primary-foreground text-xs font-medium text-center px-1">FLUX生成中...</span>
                        <div className="w-16 bg-card bg-opacity-30 rounded-full h-1 mt-1">
                          <div className="bg-card h-1 rounded-full animate-pulse"></div>
                        </div>
                      </div>
                    )}

                    {/* 下载错误状态覆盖层 */}
                    {material.downloadStatus === 'error' && (
                      <div className="absolute inset-0 bg-destructive bg-opacity-50 flex flex-col items-center justify-center">
                        <svg className="w-6 h-6 text-destructive-foreground mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-destructive-foreground text-xs font-medium text-center px-1">{t.materialsPanel.downloadFailed}</span>
                        {material.downloadError && (
                          <span className="text-destructive-foreground text-xs opacity-80 text-center px-1 mt-1" title={material.downloadError}>
                            {material.downloadError.length > 20 ? `${material.downloadError.substring(0, 20)}...` : material.downloadError}
                          </span>
                        )}
                        {onRetryDownload && (
                          <button
                            onClick={() => onRetryDownload(material)}
                            className="mt-2 px-3 py-1 text-xs font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors"
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
                        material.type === 'video' ? 'bg-primary/10 text-primary' :
                        material.type === 'audio' ? 'bg-accent text-accent-foreground' :
                        material.type === 'subtitle' ? 'bg-muted text-muted-foreground' :
                        'bg-accent text-accent-foreground'
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
                        className="w-6 h-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                        title={t.materialsPanel.addToTimelineTooltip}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                      
                      {/* 删除按钮 */}
                      <button
                        onClick={(e) => handleSingleMaterialDelete(material, e)}
                        className="w-6 h-6 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                        title={t.materialsPanel.deleteMaterialTooltip.replace('{name}', material.name)}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    
                    {/* 右下角区域 - 时长和功能按钮 */}
                    <div className="absolute bottom-1 right-1 flex items-center space-x-1">
                      {/* AI素材解析按钮 - 对视频和图片素材显示 */}
                      {(material.type === 'video' || material.type === 'image') && (() => {
                        const analysisStatus = material.analysisResult
                          ? (material.analysisResult.status === 'pending' ? 'analyzing'
                            : material.analysisResult.status === 'completed' ? 'completed'
                            : material.analysisResult.status === 'error' ? 'idle'
                            : 'idle')
                          : (getVideoAnalysisStatus ? getVideoAnalysisStatus(material.url || '') : 'idle');
                        const isWaiting = analysisStatus === 'waiting';
                        const isAnalyzing = analysisStatus === 'analyzing';
                        const isCompleted = analysisStatus === 'completed';
                        
                        // 获取队列位置（如果处于等待状态）
                        const queuePosition = isWaiting ? (material as any)._queuePosition : undefined;
                        
                        return (
                          <button
                            onClick={(e) => handleVideoAnalysis(material, e)}
                            disabled={isAnalyzing || isWaiting}
                            className={`w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110 ${
                              isWaiting
                                ? 'bg-muted cursor-not-allowed'
                                : isAnalyzing
                                  ? 'bg-muted cursor-not-allowed'
                                  : isCompleted
                                    ? 'bg-primary hover:bg-primary/90'
                                    : 'bg-accent hover:bg-accent/80'
                            } text-primary-foreground`}
                            title={
                              isWaiting
                                ? `等待解析...`
                                : isAnalyzing 
                                  ? t.materialsPanel.aiAnalyzing 
                                  : isCompleted 
                                    ? t.materialsPanel.viewAnalysisResult 
                                    : t.materialsPanel.aiVideoAnalysis
                            }
                          >
                            {isWaiting ? (
                              // 等待图标
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            ) : isAnalyzing ? (
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
                          className={`w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110 ${
                            imageToVideoStatus[material.id] === 'converting'
                              ? 'bg-primary cursor-not-allowed'
                              : 'bg-accent hover:bg-accent/80'
                          } text-primary-foreground`}
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
                        <span className="px-1 py-0.5 bg-foreground/75 text-background text-xs rounded">
                          {material.duration.toFixed(2)}s
                        </span>
                      )}
                    </div>

                    {/* 拖拽指示器 - 移到左下角 */}
                    <div className="absolute bottom-1 left-1">
                      <div className="w-4 h-4 bg-card bg-opacity-80 rounded flex items-center justify-center">
                        <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  
                  {/* 操作按钮横条 */}
                  <div className="border-b border-border bg-muted px-1.5 py-0.5 flex items-center justify-center space-x-1">
                    <button
                      onClick={(e) => handlePreviewMaterial(material, e)}
                      className="flex-1 flex items-center justify-center px-1.5 py-0.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors group"
                      title={t.materialsPanel.previewMaterial}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    
                    {/* 剪切素材按钮 - 仅对视频素材显示 */}
                    {material.type === 'video' && (
                      <>
                        <div className="w-px h-3 bg-border"></div>
                        <button
                          onClick={(e) => handleCutMaterial(material, e)}
                          className="flex-1 flex items-center justify-center px-1.5 py-0.5 text-muted-foreground hover:text-accent-foreground hover:bg-accent rounded transition-colors group"
                          title="剪切素材"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                          </svg>
                        </button>
                        
                        {/* 去除水印按钮 */}
                        <div className="w-px h-3 bg-border"></div>
                        <button
                          onClick={(e) => handleWatermarkRemoval(material, e)}
                          className="flex-1 flex items-center justify-center px-1.5 py-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors group"
                          title="去除水印"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                          </svg>
                        </button>
                      </>
                    )}
                    
                    <div className="w-px h-3 bg-border"></div>
                    
                    <button
                      onClick={(e) => handleDownloadMaterial(material, e)}
                      disabled={downloadingMaterials.has(material.id)}
                      className={`flex-1 flex items-center justify-center px-1.5 py-0.5 rounded transition-colors group ${
                        downloadingMaterials.has(material.id)
                          ? 'text-primary bg-primary/10 cursor-not-allowed'
                          : 'text-muted-foreground hover:text-accent-foreground hover:bg-accent'
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
                    <h4 className="text-xs font-medium text-foreground truncate mb-1" title={material.name}>{material.name}</h4>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      {material.width && material.height && (
                        <span className="text-xs">{material.width}×{material.height}</span>
                      )}
                      <span className="text-primary text-xs">{material.format?.toUpperCase()}</span>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* 底部操作栏 */}
        <div className="border-t pt-3 flex-shrink-0">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-3">
              {/* Material Library Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={handleMaterialLibraryClick}
                  className="flex items-center space-x-1 text-muted-foreground hover:text-foreground bg-muted hover:bg-accent px-2 py-1 rounded-md transition-colors"
                  title={t.materialsPanel.materialLibraryTooltip}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <span>{t.materialsPanel.materialLibrary}</span>
                  <svg 
                    className={`w-3 h-3 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <div 
                    className="absolute bottom-full left-0 mb-1 w-48 bg-card border border-border rounded-md z-50 animate-in slide-in-from-bottom-2 duration-200"
                    onMouseLeave={handleDropdownMouseLeave}
                  >
                    <div className="py-1">
                      <button
                        onClick={() => handleDropdownOptionClick('video')}
                        className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-primary hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <span>{t.materialsPanel.searchVideos}</span>
                      </button>
                      
                      <button
                        onClick={() => handleDropdownOptionClick('audio')}
                        className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        <span>{t.materialsPanel.searchAudios}</span>
                      </button>
                      
                      <button
                        onClick={() => handleDropdownOptionClick('image')}
                        className="w-full flex items-center space-x-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>{t.materialsPanel.searchImages}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={onAIMixedEditing}
                className="flex items-center space-x-1 text-muted-foreground hover:text-foreground bg-muted hover:bg-accent px-2 py-1 rounded-md transition-colors"
                title={t.materialsPanel.aiMixingTooltip}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>{t.materialsPanel.aiMixing}</span>
              </button>

              <button
                onClick={() => setIsAiImageModalOpen(true)}
                className="flex items-center space-x-1 text-accent-foreground hover:text-foreground bg-accent hover:bg-accent/80 px-2 py-1 rounded transition-colors"
                title="AI 图像生成（Seedream）"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>AI图像</span>
              </button>

              <button
                onClick={() => setIsAiVideoModalOpen(true)}
                className="flex items-center space-x-1 text-accent-foreground hover:text-foreground bg-accent hover:bg-accent/80 px-2 py-1 rounded transition-colors"
                title="AI 视频生成（Seedance）"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                <span>AI视频</span>
              </button>

            </div>
            <div className="text-muted-foreground">
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

      {/* 分镜包删除确认对话框 */}
      <ConfirmationDialog
        isOpen={storyboardPackDeleteConfirm.isOpen}
        title="删除分镜包"
        message="确定要删除此分镜包吗？所有帧和相关数据将被永久删除。"
        type="danger"
        onConfirm={handleConfirmDeleteStoryboardPack}
        onCancel={() => setStoryboardPackDeleteConfirm({ isOpen: false, packId: null })}
      />

      {/* 分镜包预览弹窗 */}
      <StoryboardPackModal
        isOpen={storyboardPackModal.isOpen}
        pack={storyboardPackModal.pack}
        onClose={() => setStoryboardPackModal({ isOpen: false, pack: null })}
        onSelectForScript={(pack) => {
          setStoryboardPackModal({ isOpen: false, pack: null });
          if (onSelectPackForScript) onSelectPackForScript(pack);
        }}
        onDelete={(packId) => {
          setStoryboardPackModal({ isOpen: false, pack: null });
          handleDeleteStoryboardPack(packId);
        }}
        onFrameClick={handleFramePreviewClick}
        onAddAllFramesToMaterials={handleAddAllFramesToMaterials}
      />

      {/* 图片转视频方式选择弹出菜单 */}
      {imageToVideoPopover.visible && imageToVideoPopover.material && (
        <div
          ref={popoverRef}
          className="fixed z-[1200] bg-card rounded-md border border-border py-1 w-44 animate-in fade-in zoom-in-95 duration-150"
          style={{ left: imageToVideoPopover.position.x, top: imageToVideoPopover.position.y }}
        >
          <button
            onClick={handleChooseEffectConversion}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2m0 2a2 2 0 012 2m-2-2a2 2 0 00-2 2M7 20v2m0-2a2 2 0 01-2-2m2 2a2 2 0 002-2M3 8h2M3 16h2m14-8h2m-2 8h2M7 8h10a2 2 0 012 2v4a2 2 0 01-2 2H7a2 2 0 01-2-2v-4a2 2 0 012-2z" />
            </svg>
            <span>效果转换</span>
          </button>
          <button
            onClick={handleChooseAiVideoGeneration}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            <span>AI视频生成</span>
          </button>
        </div>
      )}

      {/* 图片转视频效果选择弹窗 */}
      {showImageToVideoModal && selectedImageForConversion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1100] p-4">
          <div className="bg-card rounded-md w-full max-w-6xl max-h-[90vh] flex flex-col">
            {/* 弹窗头部 */}
            <div className="px-6 py-4 border-b border-border flex-shrink-0">
              <h3 className="text-lg font-semibold">选择视频效果和设置聚焦区域</h3>
              <p className="text-sm text-muted-foreground mt-1">
                将图片 "{selectedImageForConversion.name}" 转换为视频
              </p>
            </div>
            
            {/* 弹窗主体内容 */}
            <div className="flex-1 flex overflow-hidden">
              {/* 左侧：效果选择面板 */}
              <div className="w-1/2 p-6 border-r border-border flex flex-col">
                <h4 className="text-md font-medium text-foreground mb-4">选择视频效果</h4>
                <div className="flex-1 space-y-3 overflow-y-auto pr-2">
                  {/* 静态效果 */}
                  <button
                    onClick={() => setSelectedEffect('static')}
                    className={`w-full p-3 text-left border rounded-md transition-colors ${
                      selectedEffect === 'static' 
                        ? 'border-primary bg-primary/10' 
                        : 'border-border hover:border-primary/30 hover:bg-primary/10'
                    }`}
                  >
                    <div className="font-medium">静态视频</div>
                    <div className="text-sm text-muted-foreground">直接将图片转换为静态视频</div>
                  </button>

                  {/* Ken Burns效果 */}
                  <div className="space-y-2">
                    <button
                      onClick={() => setSelectedEffect('ken_burns_zoom_in')}
                      className={`w-full p-3 text-left border rounded-md transition-colors ${
                        selectedEffect === 'ken_burns_zoom_in'
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/30 hover:bg-primary/10'
                      }`}
                    >
                      <div className="font-medium">Ken Burns - 放大</div>
                      <div className="text-sm text-muted-foreground">逐渐放大到设置的聚焦位置（稳定渐变效果）</div>
                    </button>
                    <button
                      onClick={() => setSelectedEffect('ken_burns_zoom_out')}
                      className={`w-full p-3 text-left border rounded-md transition-colors ${
                        selectedEffect === 'ken_burns_zoom_out'
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/30 hover:bg-primary/10'
                      }`}
                    >
                      <div className="font-medium">Ken Burns - 缩小</div>
                      <div className="text-sm text-muted-foreground">从放大状态缩小到正常大小（稳定渐变效果）</div>
                    </button>
                  </div>

                  {/* 平移效果 */}
                  <div className="space-y-2">
                    <button
                      onClick={() => setSelectedEffect('pan_left_to_right')}
                      className={`w-full p-3 text-left border rounded-md transition-colors ${
                        selectedEffect === 'pan_left_to_right'
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/30 hover:bg-primary/10'
                      }`}
                    >
                      <div className="font-medium">平移 - 从左到右</div>
                      <div className="text-sm text-muted-foreground">水平从左向右平移</div>
                    </button>
                    <button
                      onClick={() => setSelectedEffect('pan_right_to_left')}
                      className={`w-full p-3 text-left border rounded-md transition-colors ${
                        selectedEffect === 'pan_right_to_left'
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/30 hover:bg-primary/10'
                      }`}
                    >
                      <div className="font-medium">平移 - 从右到左</div>
                      <div className="text-sm text-muted-foreground">水平从右向左平移</div>
                    </button>
                  </div>
                </div>
              </div>

              {/* 右侧：图片预览和聚焦点设置面板 */}
              <div className="w-1/2 p-6 flex flex-col">
                <h4 className="text-md font-medium text-foreground mb-4">设置聚焦区域</h4>
                <div className="flex-1 flex flex-col">
                  <div className="border border-border rounded-md p-4 bg-muted flex-1 flex flex-col">
                    <div className="relative flex-1 flex items-center justify-center">
                      <img
                        ref={imagePreviewRef}
                        src={selectedImageForConversion.url}
                        alt={selectedImageForConversion.name}
                        className="max-w-full max-h-full object-contain rounded cursor-crosshair"
                        onClick={handleImageClick}
                        onLoad={handleImageLoad}
                      />
                      {/* 聚焦点标记 */}
                      {focusPoint && imagePreviewRef.current && (
                        <div
                          className="absolute w-4 h-4 bg-destructive border-2 border-background rounded-full transform -translate-x-2 -translate-y-2"
                          style={{
                            left: `${focusPoint.x * 100}%`,
                            top: `${focusPoint.y * 100}%`,
                          }}
                        />
                      )}
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground flex-shrink-0">
                      <p>点击图片设置聚焦位置</p>
                      {focusPoint && (
                        <p className="mt-1">
                          聚焦点：({(focusPoint.x * 100).toFixed(1)}%, {(focusPoint.y * 100).toFixed(1)}%)
                        </p>
                      )}
                      {!focusPoint && (
                        <p className="mt-1 text-destructive">请点击图片设置聚焦点</p>
                      )}
                    </div>
                  </div>
                  
                  {/* 效果说明 */}
                  {selectedEffect && (
                    <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-md flex-shrink-0">
                      <h5 className="text-sm font-medium text-primary mb-2">效果说明</h5>
                      <p className="text-sm text-primary">
                        {getEffectDescription(selectedEffect)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 弹窗底部按钮 */}
            <div className="px-6 py-4 border-t border-border flex justify-end space-x-3 flex-shrink-0">
              <button
                onClick={() => {
                  setShowImageToVideoModal(false);
                  setSelectedImageForConversion(null);
                  setSelectedEffect('');
                  setFocusPoint(null);
                }}
                className="px-4 py-2 text-muted-foreground border border-border rounded-md hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={handleConvertWithFocus}
                disabled={!selectedEffect || !focusPoint}
                className="px-6 py-2 rounded-md font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                转换视频
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

      {/* 水印去除弹窗 */}
      <WatermarkRemovalModal
        isOpen={watermarkRemovalModal.isOpen}
        material={watermarkRemovalModal.material}
        onClose={handleCloseWatermarkRemovalModal}
        onWatermarkRemoved={handleWatermarkRemoved}
        taskId={taskId}
      />

      {/* AI视频生成弹窗 */}
      <AiVideoModal
        isOpen={isAiVideoModalOpen}
        onClose={() => { setIsAiVideoModalOpen(false); setAiVideoInitialImage(null); }}
        onConfirm={(params) => {
          handleAiVideoGenerate(params);
          setIsAiVideoModalOpen(false);
          setAiVideoInitialImage(null);
        }}
        initialImageUrl={aiVideoInitialImage?.url}
        initialImageName={aiVideoInitialImage?.name}
        materials={materials}
      />

      {/* AI图像生成弹窗 */}
      <AiImageModal
        isOpen={isAiImageModalOpen}
        onClose={() => setIsAiImageModalOpen(false)}
        onConfirm={(params) => {
          setIsAiImageModalOpen(false);
          handleAiImageGenerate(params).catch((err: Error) => {
            showError(err.message || 'AI图像生成失败');
          });
        }}
        onStoryboardGenerate={async (params) => {
          const pack = await handleStoryboardGenerate(params);
          await refreshStoryboardPacks();
          return pack;
        }}
      />
    </div>
  );
};

export default MaterialsPanel; 