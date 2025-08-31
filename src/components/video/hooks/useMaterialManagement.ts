import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseMaterialManagementReturn } from '../types';
import { VideoEditingLogger } from '../utils';
import localVideoManager from '@/lib/utils/localVideoManager';

// 确认对话框状态接口
interface ConfirmationDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  type: 'danger' | 'warning' | 'info';
}

/**
 * useMaterialManagement Hook
 * 管理素材库操作
 * 
 * @param taskId - 任务ID，用于日志记录
 * @returns 素材管理相关的状态和方法
 */
export const useMaterialManagement = (taskId: string): UseMaterialManagementReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useMaterialManagement'
  }), [taskId]);

  // 素材管理状态
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [selectedMaterialType, setSelectedMaterialType] = useState<MaterialType | 'all'>('all');
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // 确认对话框状态
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialogState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'danger'
  });

  // 处理素材类型筛选
  const handleMaterialTypeFilter = useCallback((type: MaterialType | 'all') => {
    logger.userAction('素材类型筛选', 'filterTabs', {
      previousType: selectedMaterialType,
      newType: type,
      materialCount: materials.filter(material => type === 'all' || material.type === type).length
    });
    
    setSelectedMaterialType(type);
    
    // 清除当前选中的素材（因为筛选后可能不可见）
    setSelectedMaterials(new Set());
  }, [selectedMaterialType, materials, logger]);

  // 处理素材选择/取消选择
  const handleMaterialSelect = useCallback((materialId: string, isSelected: boolean) => {
    logger.userAction('素材选择状态变更', 'materialSelect', {
      materialId,
      isSelected,
      previousSelectionCount: selectedMaterials.size
    });

    setSelectedMaterials(prev => {
      const newSet = new Set(prev);
      if (isSelected) {
        newSet.add(materialId);
      } else {
        newSet.delete(materialId);
      }
      
      logger.info('素材选择状态更新', {
        materialId,
        isSelected,
        newSelectionCount: newSet.size,
        selectedMaterials: Array.from(newSet)
      });
      
      return newSet;
    });
  }, [selectedMaterials, logger]);

  // 处理素材批量选择
  const handleMaterialBatchSelect = useCallback((materialIds: string[], isSelected: boolean) => {
    logger.userAction('素材批量选择', 'batchSelect', {
      materialIds,
      isSelected,
      materialCount: materialIds.length,
      previousSelectionCount: selectedMaterials.size
    });

    setSelectedMaterials(prev => {
      const newSet = new Set(prev);
      materialIds.forEach(id => {
        if (isSelected) {
          newSet.add(id);
        } else {
          newSet.delete(id);
        }
      });
      
      logger.info('批量素材选择状态更新', {
        materialIds,
        isSelected,
        newSelectionCount: newSet.size,
        selectedMaterials: Array.from(newSet)
      });
      
      return newSet;
    });
  }, [selectedMaterials, logger]);

  // 实际执行删除操作的函数
  const executeDelete = useCallback((materialIds: string[]) => {
    logger.info('开始执行素材删除', {
      materialIds,
      materialCount: materialIds.length
    });

    setMaterials(prev => {
      const filteredMaterials = prev.filter(material => !materialIds.includes(material.id));
      
      logger.info('素材删除完成', {
        deletedIds: materialIds,
        remainingCount: filteredMaterials.length,
        deletedCount: materialIds.length
      });
      
      return filteredMaterials;
    });

    // 清除已删除素材的选中状态
    setSelectedMaterials(prev => {
      const newSet = new Set(prev);
      materialIds.forEach(id => newSet.delete(id));
      return newSet;
    });
  }, [logger]);

  // 处理素材删除（单个或批量）
  const handleMaterialDelete = useCallback((materialIds: string[]) => {
    logger.userAction('素材删除操作', 'deleteButton', {
      materialIds,
      materialCount: materialIds.length
    });

    // 获取要删除的素材信息
    const materialsToDelete = materials.filter(material => materialIds.includes(material.id));
    const materialNames = materialsToDelete.map(m => m.name).join('、');

    setConfirmationDialog({
      isOpen: true,
      title: '确认删除素材',
      message: materialIds.length === 1 
        ? `确定要删除素材「${materialNames}」吗？此操作不可撤销。`
        : `确定要删除这 ${materialIds.length} 个素材吗？此操作不可撤销。`,
      type: 'danger',
      onConfirm: () => {
        logger.info('用户确认删除素材', {
          materialIds,
          materialCount: materialIds.length,
          materialNames
        });
        executeDelete(materialIds);
        setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  }, [materials, logger, executeDelete]);

  // 处理删除当前选项卡的所有素材
  const handleDeleteAllMaterials = useCallback(() => {
    // 获取当前选项卡的所有素材
    const currentTabMaterials = materials.filter(material => 
      selectedMaterialType === 'all' || material.type === selectedMaterialType
    );
    
    if (currentTabMaterials.length === 0) {
      logger.info('当前选项卡无素材，忽略删除全部操作', {
        selectedMaterialType,
        totalMaterials: materials.length
      });
      return;
    }

    logger.userAction('删除全部素材操作', 'deleteAllButton', {
      selectedMaterialType,
      currentTabMaterialCount: currentTabMaterials.length,
      totalMaterialCount: materials.length
    });

    const materialIds = currentTabMaterials.map(m => m.id);
    const tabName = selectedMaterialType === 'all' ? '全部' : 
                   selectedMaterialType === 'video' ? '视频' :
                   selectedMaterialType === 'audio' ? '音频' :
                   selectedMaterialType === 'image' ? '图片' : '字幕';

    setConfirmationDialog({
      isOpen: true,
      title: '确认清空素材',
      message: selectedMaterialType === 'all'
        ? `确定要清空所有 ${currentTabMaterials.length} 个素材吗？此操作将删除素材管理面板中的所有内容，且不可撤销。`
        : `确定要清空「${tabName}」选项卡中的所有 ${currentTabMaterials.length} 个素材吗？此操作不可撤销。`,
      type: 'danger',
      onConfirm: () => {
        logger.info('用户确认删除全部素材', {
          selectedMaterialType,
          materialIds,
          materialCount: materialIds.length
        });
        executeDelete(materialIds);
        setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  }, [materials, selectedMaterialType, logger, executeDelete]);

  // 关闭确认对话框
  const handleCloseConfirmationDialog = useCallback(() => {
    logger.info('用户取消删除操作', {
      dialogType: confirmationDialog.title
    });
    setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
  }, [confirmationDialog.title, logger]);

  // 处理素材上传
  const handleMaterialUpload = useCallback(async () => {
    logger.userAction('素材上传触发', 'uploadButton');

    if (isUploading) {
      logger.warn('上传正在进行中，忽略新的上传请求', {
        currentProgress: uploadProgress
      });
      return;
    }

    // 创建文件选择器
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'video/*,audio/*,image/*';
    
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement)?.files;
      if (!files || files.length === 0) return;

      logger.info('开始处理上传文件', {
        fileCount: files.length,
        fileNames: Array.from(files).map(f => f.name),
        totalSize: Array.from(files).reduce((sum, f) => sum + f.size, 0)
      });

      setIsUploading(true);
      setUploadProgress(0);

      // 注意：这个文件中的API调用通过Next.js API路由代理到后端服务
      // 使用相对路径调用Next.js API路由，避免直接调用后台服务
      const uploadedMaterials: MaterialItem[] = [];
      let completedFiles = 0;

      try {
        // 处理每个文件
        for (const file of Array.from(files)) {
          try {
            logger.info('开始上传单个文件', {
              fileName: file.name,
              fileSize: file.size,
              fileType: file.type
            });

            // 判断文件类型
            const materialType: MaterialType = file.type.startsWith('video/') ? 'video' :
                                             file.type.startsWith('audio/') ? 'audio' : 'image';

            // 如果是视频文件，使用视频上传API
            if (materialType === 'video') {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('task_id', taskId);
              formData.append('generate_thumbnail', 'true');

              const response = await fetch('/api/supabase/upload-video', {
                method: 'POST',
                body: formData
              });

              if (!response.ok) {
                throw new Error(`视频上传失败: ${response.status} ${response.statusText}`);
              }

              const result = await response.json();

              if (!result.success) {
                throw new Error(`视频上传失败: ${result.message}`);
              }

              logger.info('视频上传到Supabase成功', {
                fileName: file.name,
                videoUrl: result.video_url,
                thumbnailUrl: result.thumbnail_url,
                fileSize: result.file_size,
                duration: result.duration,
                width: result.width,
                height: result.height
              });

              // 下载视频文件到本地
              logger.info('开始从Supabase下载视频到本地', {
                url: result.video_url,
                fileName: file.name
              });

              const videoResponse = await fetch(result.video_url);
              if (!videoResponse.ok) {
                throw new Error(`下载视频失败: ${videoResponse.status} ${videoResponse.statusText}`);
              }
              const videoBlob = await videoResponse.blob();

              // 下载缩略图（如果有）
              let thumbnailBlob: Blob | undefined;
              if (result.thumbnail_url) {
                try {
                  const thumbnailResponse = await fetch(result.thumbnail_url);
                  if (thumbnailResponse.ok) {
                    thumbnailBlob = await thumbnailResponse.blob();
                  }
                } catch (error) {
                                     logger.warn('下载缩略图失败，将使用默认处理', {
                     error: error instanceof Error ? error.message : String(error),
                     fileName: file.name
                   });
                }
              }

              // 存储到本地视频管理器
              const { videoUrl, thumbnailUrl } = await localVideoManager.storeVideoFile(
                file.name,
                videoBlob,
                thumbnailBlob,
                {
                  duration: result.duration,
                  width: result.width,
                  height: result.height,
                  format: file.name.split('.').pop()
                }
              );

              logger.info('视频文件本地存储成功', {
                fileName: file.name,
                localVideoUrl: videoUrl,
                localThumbnailUrl: thumbnailUrl,
                blobSize: videoBlob.size
              });

                             // 创建视频素材项
               const videoMaterial: MaterialItem = {
                 id: `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                 name: file.name,
                 type: 'video',
                 format: file.name.split('.').pop() || 'mp4',
                 size: result.file_size,
                 duration: result.duration,
                 width: result.width,
                 height: result.height,
                 thumbnailUrl: thumbnailUrl,
                 url: videoUrl,
                 serverUrl: result.video_url,
                 createdAt: new Date(),
                 metadata: {
                   originalUrl: result.video_url,
                   fileName: file.name,
                   isLocalFile: true,
                   supabaseMetadata: result.metadata
                 }
               };

               logger.info('视频素材项创建完成', {
                 materialId: videoMaterial.id,
                 fileName: file.name,
                 localUrl: videoUrl,
                 serverUrl: result.video_url,
                 thumbnailUrl: thumbnailUrl,
                 hasServerUrl: !!result.video_url,
                 duration: result.duration,
                 size: result.file_size
               });

              uploadedMaterials.push(videoMaterial);

            } else {
              // 对于非视频文件，使用通用上传API
              const formData = new FormData();
              formData.append('file', file);
              formData.append('task_id', taskId);

              const response = await fetch('/api/supabase/upload-file', {
                method: 'POST',
                body: formData
              });

              if (!response.ok) {
                throw new Error(`文件上传失败: ${response.status} ${response.statusText}`);
              }

              const result = await response.json();

              if (!result.success) {
                throw new Error(`文件上传失败: ${result.message}`);
              }

              logger.info('文件上传到Supabase成功', {
                fileName: file.name,
                fileUrl: result.file_url,
                fileSize: result.file_size,
                materialType: materialType
              });

              // 下载文件到本地（音频使用音频管理器，图片暂时也用视频管理器）
              const fileResponse = await fetch(result.file_url);
              if (!fileResponse.ok) {
                throw new Error(`下载文件失败: ${fileResponse.status} ${fileResponse.statusText}`);
              }
              const fileBlob = await fileResponse.blob();

              // 创建本地URL
              const localUrl = URL.createObjectURL(fileBlob);

              // 对于图片类型，获取图片尺寸信息
              let imageWidth: number | undefined;
              let imageHeight: number | undefined;
              
              if (materialType === 'image') {
                try {
                  // 创建临时图片元素来获取尺寸
                  const img = new Image();
                  await new Promise<void>((resolve, reject) => {
                    img.onload = () => {
                      imageWidth = img.naturalWidth;
                      imageHeight = img.naturalHeight;
                      resolve();
                    };
                    img.onerror = () => reject(new Error('无法加载图片'));
                    img.src = localUrl;
                  });
                  
                  logger.info('图片尺寸获取成功', {
                    fileName: file.name,
                    width: imageWidth,
                    height: imageHeight
                  });
                } catch (error) {
                  logger.warn('获取图片尺寸失败', {
                    fileName: file.name,
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
              }

              // 创建素材项
              const material: MaterialItem = {
                id: `${materialType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: file.name,
                type: materialType,
                format: file.name.split('.').pop() || '',
                size: result.file_size,
                url: localUrl,
                serverUrl: result.file_url,
                // 对于图片类型，使用服务器URL作为缩略图
                thumbnailUrl: materialType === 'image' ? result.file_url : undefined,
                // 设置图片尺寸信息
                width: imageWidth,
                height: imageHeight,
                createdAt: new Date(),
                metadata: {
                  originalUrl: result.file_url,
                  fileName: file.name,
                  isLocalFile: true
                }
              };

              logger.info('素材项创建完成', {
                materialId: material.id,
                fileName: file.name,
                materialType: material.type,
                localUrl: localUrl,
                serverUrl: result.file_url,
                thumbnailUrl: material.thumbnailUrl,
                hasServerUrl: !!result.file_url,
                hasThumbnail: !!material.thumbnailUrl,
                size: result.file_size,
                width: material.width,
                height: material.height
              });

              uploadedMaterials.push(material);
            }

            completedFiles++;
            const progress = (completedFiles / files.length) * 100;
            setUploadProgress(progress);

            logger.info('文件上传处理完成', {
              fileName: file.name,
              progress,
              completedFiles,
              totalFiles: files.length
            });

                     } catch (error) {
             const errorObj = error instanceof Error ? error : new Error(String(error));
             logger.error('单个文件上传失败', errorObj, {
               fileName: file.name
             });

            // 继续处理其他文件，但记录错误
            completedFiles++;
            const progress = (completedFiles / files.length) * 100;
            setUploadProgress(progress);
          }
        }

        // 添加所有成功上传的素材
        if (uploadedMaterials.length > 0) {
          setMaterials(prev => [...prev, ...uploadedMaterials]);
          
          logger.info('素材上传完成', {
            totalFiles: files.length,
            successfulUploads: uploadedMaterials.length,
            failedUploads: files.length - uploadedMaterials.length,
            materials: uploadedMaterials.map(m => ({
              id: m.id,
              name: m.name,
              type: m.type,
              size: m.size
            }))
          });
        }

             } catch (error) {
         const errorObj = error instanceof Error ? error : new Error(String(error));
         logger.error('素材上传过程出错', errorObj, {
           completedFiles,
           totalFiles: files.length
         });
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
      }
    };

    input.click();
  }, [isUploading, uploadProgress, taskId, logger]);

  // 添加或更新素材到列表
  const addMaterials = useCallback((newMaterials: MaterialItem[]) => {
    logger.info('添加或更新素材到列表', {
      materialCount: newMaterials.length,
      materials: newMaterials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        downloadStatus: m.downloadStatus
      }))
    });

    setMaterials(prev => {
      let updatedMaterials = [...prev];
      let addedCount = 0;
      let updatedCount = 0;

      newMaterials.forEach(newMaterial => {
        // 查找是否已存在相同ID的素材
        const existingIndex = updatedMaterials.findIndex(material => material.id === newMaterial.id);
        
        if (existingIndex !== -1) {
          // 更新现有素材
          const oldMaterial = updatedMaterials[existingIndex];
          updatedMaterials[existingIndex] = newMaterial;
          updatedCount++;
          
          logger.info('更新现有素材', {
            materialId: newMaterial.id,
            materialName: newMaterial.name,
            oldDownloadStatus: oldMaterial.downloadStatus,
            newDownloadStatus: newMaterial.downloadStatus,
            oldUrl: oldMaterial.url,
            newUrl: newMaterial.url
          });
        } else {
          // 添加新素材
          updatedMaterials.push(newMaterial);
          addedCount++;
          
          logger.info('添加新素材', {
            materialId: newMaterial.id,
            materialName: newMaterial.name,
            downloadStatus: newMaterial.downloadStatus
          });
        }
      });
      
      logger.info('素材列表更新完成', {
        previousCount: prev.length,
        newCount: updatedMaterials.length,
        addedCount,
        updatedCount
      });
      
      return updatedMaterials;
    });

    // Return boolean success indicator instead of count
    return newMaterials.length > 0;
  }, [logger]);

  // 添加或替换单个素材（用于AI匹配视频场景）
  const addOrReplaceMaterial = useCallback((newMaterial: MaterialItem) => {
    logger.info('添加或替换素材', {
      materialId: newMaterial.id,
      materialName: newMaterial.name,
      materialType: newMaterial.type,
      hasSegmentId: !!newMaterial.metadata?.segment_id,
      segmentId: newMaterial.metadata?.segment_id,
      segmentNumber: newMaterial.metadata?.segment_number
    });

    setMaterials(prev => {
      // 检查是否已存在相同ID的素材（避免重复添加）
      const existingIndex = prev.findIndex(material => material.id === newMaterial.id);
      
      if (existingIndex !== -1) {
        // 如果素材ID已存在，替换现有素材
        const updatedMaterials = [...prev];
        const oldMaterial = updatedMaterials[existingIndex];
        updatedMaterials[existingIndex] = newMaterial;
        
        logger.info('替换现有素材（相同ID）', {
          materialId: newMaterial.id,
          oldMaterialName: oldMaterial.name,
          newMaterialName: newMaterial.name,
          replacedIndex: existingIndex
        });
        
        return updatedMaterials;
      }
      
      // 如果素材ID不存在，直接添加新素材
      const updatedMaterials = [...prev, newMaterial];
      
      logger.info('添加新素材到列表', {
        materialId: newMaterial.id,
        materialName: newMaterial.name,
        materialType: newMaterial.type,
        segmentId: newMaterial.metadata?.segment_id,
        segmentNumber: newMaterial.metadata?.segment_number,
        previousCount: prev.length,
        newCount: updatedMaterials.length
      });
      
      return updatedMaterials;
    });

    return true;
  }, [logger]);

  // 过滤后的素材列表
  const filteredMaterials = useMemo(() => {
    if (selectedMaterialType === 'all') {
      return materials;
    }
    return materials.filter(material => material.type === selectedMaterialType);
  }, [materials, selectedMaterialType]);

  return {
    materials: filteredMaterials,
    selectedMaterialType,
    selectedMaterials,
    isUploading,
    uploadProgress,
    handleMaterialTypeFilter,
    handleMaterialSelect,
    handleMaterialBatchSelect,
    handleMaterialDelete,
    handleMaterialUpload,
    addMaterials,
    addOrReplaceMaterial, // 新增：添加或替换单个素材
    // 新增的删除功能
    handleDeleteAllMaterials,
    confirmationDialog,
    handleCloseConfirmationDialog
  };
};