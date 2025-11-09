import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseMaterialManagementReturn } from '../types';
import { VideoEditingLogger } from '../utils';
import localVideoManager from '@/lib/utils/localVideoManager';
import { useAuth } from '@/contexts/AuthContext';

// 确认对话框状态接口
interface ConfirmationDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  type: 'danger' | 'warning' | 'info';
}

// 上传任务接口
interface UploadTask {
  file: File;
  material: MaterialItem;
}

/**
 * useMaterialManagement Hook
 * 管理素材库操作，支持并发上传队列
 * 
 * @param taskId - 任务ID，用于日志记录
 * @returns 素材管理相关的状态和方法
 */
export const useMaterialManagement = (taskId: string): UseMaterialManagementReturn => {
  // 获取当前用户信息
  const { user } = useAuth();
  
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

  // 并发上传配置
  const MAX_CONCURRENT_UPLOADS = 3;

  // 处理素材类型筛选
  const handleMaterialTypeFilter = useCallback((type: MaterialType | 'all') => {
    logger.userAction('素材类型筛选', 'filterTabs', {
      previousType: selectedMaterialType,
      newType: type,
      materialCount: materials.filter(material => type === 'all' || material.type === type).length
    });
    
    setSelectedMaterialType(type);
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

      await processFileUpload(files);
    };

    input.click();
  }, [isUploading, uploadProgress, logger]);

  // 处理拖拽文件上传
  const handleDragUpload = useCallback(async (files: FileList) => {
    logger.userAction('素材拖拽上传触发', 'dragUpload', {
      fileCount: files.length,
      fileNames: Array.from(files).map(f => f.name)
    });

    if (isUploading) {
      logger.warn('上传正在进行中，忽略拖拽上传请求', {
        currentProgress: uploadProgress
      });
      return;
    }

    if (!files || files.length === 0) {
      logger.warn('拖拽上传：没有文件');
      return;
    }

    await processFileUpload(files);
  }, [isUploading, uploadProgress, logger]);

  // 上传单个文件的函数
  const uploadSingleFile = useCallback(async (file: File, material: MaterialItem): Promise<MaterialItem | null> => {
    const materialType: MaterialType = file.type.startsWith('video/') ? 'video' :
                                     file.type.startsWith('audio/') ? 'audio' : 'image';
    
    try {
      logger.info('开始上传单个文件', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        materialId: material.id
      });

      if (materialType === 'video') {
        // 视频文件上传
        const formData = new FormData();
        formData.append('file', file);
        formData.append('task_id', taskId);
        formData.append('generate_thumbnail', 'true');
        if (user?.id) {
          formData.append('user_id', user.id);
        }

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
          thumbnailUrl: result.thumbnail_url
        });

        // 下载视频文件到本地
        const videoResponse = await fetch(result.video_url);
        if (!videoResponse.ok) {
          throw new Error(`下载视频失败: ${videoResponse.status}`);
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
            logger.warn('下载缩略图失败', {
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
          fileName: file.name
        });

        return videoMaterial;

      } else {
        // 非视频文件上传（音频/图片）
        const formData = new FormData();
        formData.append('file', file);
        formData.append('task_id', taskId);
        if (user?.id) {
          formData.append('user_id', user.id);
        }

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
          fileUrl: result.file_url
        });

        // 下载文件到本地
        const fileResponse = await fetch(result.file_url);
        if (!fileResponse.ok) {
          throw new Error(`下载文件失败: ${fileResponse.status}`);
        }
        const fileBlob = await fileResponse.blob();

        // 创建本地URL
        const localUrl = URL.createObjectURL(fileBlob);

        // 对于图片类型，获取图片尺寸信息
        let imageWidth: number | undefined;
        let imageHeight: number | undefined;
        
        if (materialType === 'image') {
          try {
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
        const fileMaterial: MaterialItem = {
          id: `${materialType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: materialType,
          format: file.name.split('.').pop() || '',
          size: result.file_size,
          url: localUrl,
          serverUrl: result.file_url,
          thumbnailUrl: materialType === 'image' ? result.file_url : undefined,
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
          materialId: fileMaterial.id,
          fileName: file.name
        });

        return fileMaterial;
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      logger.error('单个文件上传失败', errorObj, {
        fileName: file.name,
        materialId: material.id
      });
      return null;
    }
  }, [taskId, logger]);

  // 提取公共的文件处理逻辑（支持并发上传队列）
  const processFileUpload = useCallback(async (files: FileList) => {
    logger.info('开始处理上传文件（并发队列模式）', {
      fileCount: files.length,
      fileNames: Array.from(files).map(f => f.name),
      maxConcurrent: MAX_CONCURRENT_UPLOADS
    });

    setIsUploading(true);
    setUploadProgress(0);

    const allFiles = Array.from(files);
    const uploadTasks: UploadTask[] = [];
    let completedCount = 0;

    // 为所有文件创建素材和任务
    const allMaterials = allFiles.map((file, index) => {
      const materialType: MaterialType = file.type.startsWith('video/') ? 'video' :
                                       file.type.startsWith('audio/') ? 'audio' : 'image';
      
      const isInFirstBatch = index < MAX_CONCURRENT_UPLOADS;
      
      const material: MaterialItem = {
        id: `upload_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        type: materialType,
        format: file.name.split('.').pop() || 'unknown',
        size: file.size,
        url: '',
        createdAt: new Date(),
        uploadStatus: isInFirstBatch ? 'uploading' : 'waiting',
        uploadProgress: 0
      };
      
      uploadTasks.push({ file, material });
      
      logger.info(isInFirstBatch ? '创建上传中素材' : '创建等待上传素材', {
        materialId: material.id,
        fileName: file.name,
        status: material.uploadStatus,
        position: index + 1
      });
      
      return material;
    });

    // 立即将所有素材添加到列表
    setMaterials(prev => [...prev, ...allMaterials]);

    // 进度条动画管理
    const progressIntervals: { [key: string]: NodeJS.Timeout } = {};
    const startProgressAnimation = (materialId: string) => {
      progressIntervals[materialId] = setInterval(() => {
        setMaterials(prev => prev.map(m => {
          if (m.id === materialId && m.uploadStatus === 'uploading') {
            const currentProgress = m.uploadProgress || 0;
            const newProgress = Math.min(currentProgress + Math.random() * 5 + 1, 95);
            return { ...m, uploadProgress: newProgress };
          }
          return m;
        }));
      }, 200 + Math.random() * 300);
    };

    // 停止进度条动画
    const stopProgressAnimation = (materialId: string) => {
      if (progressIntervals[materialId]) {
        clearInterval(progressIntervals[materialId]);
        delete progressIntervals[materialId];
      }
    };

    // 启动第一批上传的进度条
    for (let i = 0; i < Math.min(MAX_CONCURRENT_UPLOADS, allMaterials.length); i++) {
      startProgressAnimation(allMaterials[i].id);
    }

    // 处理上传队列
    const processQueue = async () => {
      const activeUploads: Promise<void>[] = [];
      let nextIndex = 0;

      const processNextTask = async (): Promise<void> => {
        if (nextIndex >= uploadTasks.length) return;
        
        const taskIndex = nextIndex++;
        const task = uploadTasks[taskIndex];
        const { file, material } = task;

        try {
          // 如果是等待状态，先更新为上传中
          if (material.uploadStatus === 'waiting') {
            logger.info('等待任务开始上传', {
              materialId: material.id,
              fileName: file.name,
              position: taskIndex + 1
            });
            
            setMaterials(prev => prev.map(m => 
              m.id === material.id 
                ? { ...m, uploadStatus: 'uploading' as const, uploadProgress: 0 }
                : m
            ));
            
            startProgressAnimation(material.id);
          }

          // 执行上传
          const uploadedMaterial = await uploadSingleFile(file, material);

          // 停止进度条
          stopProgressAnimation(material.id);

          if (uploadedMaterial) {
            // 上传成功，替换素材
            setMaterials(prev => prev.map(m => 
              m.id === material.id 
                ? { ...uploadedMaterial, uploadStatus: 'completed' as const, uploadProgress: 100 }
                : m
            ));

            logger.info('文件上传成功', {
              materialId: uploadedMaterial.id,
              fileName: file.name,
              position: taskIndex + 1
            });
          } else {
            // 上传失败，移除素材
            setMaterials(prev => prev.filter(m => m.id !== material.id));

            logger.error('文件上传失败，已移除', {
              materialId: material.id,
              fileName: file.name,
              position: taskIndex + 1
            });
          }

          // 更新进度
          completedCount++;
          const progress = (completedCount / allFiles.length) * 100;
          setUploadProgress(progress);

          logger.info('上传进度更新', {
            completedCount,
            totalCount: allFiles.length,
            progress: progress.toFixed(2)
          });

          // 继续处理下一个任务
          await processNextTask();
          
        } catch (error) {
          logger.error('处理上传任务异常', error as Error, {
            materialId: material.id,
            fileName: file.name
          });
          
          stopProgressAnimation(material.id);
          setMaterials(prev => prev.filter(m => m.id !== material.id));
          
          completedCount++;
          setUploadProgress((completedCount / allFiles.length) * 100);
          
          await processNextTask();
        }
      };

      // 启动并发上传
      for (let i = 0; i < Math.min(MAX_CONCURRENT_UPLOADS, uploadTasks.length); i++) {
        activeUploads.push(processNextTask());
      }

      // 等待所有上传完成
      await Promise.all(activeUploads);
    };

    try {
      await processQueue();

      logger.info('所有文件上传处理完成', {
        totalFiles: allFiles.length,
        completedCount
      });

    } catch (error) {
      logger.error('文件上传队列处理异常', error as Error, {
        totalFiles: allFiles.length,
        completedCount
      });
    } finally {
      // 清理所有剩余的进度条定时器
      Object.values(progressIntervals).forEach(interval => clearInterval(interval));
      
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [taskId, logger, uploadSingleFile]);

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
      const updatedMaterials = [...prev];
      let addedCount = 0;
      let updatedCount = 0;

      newMaterials.forEach(newMaterial => {
        const existingIndex = updatedMaterials.findIndex(material => material.id === newMaterial.id);
        
        if (existingIndex !== -1) {
          updatedMaterials[existingIndex] = newMaterial;
          updatedCount++;
        } else {
          updatedMaterials.push(newMaterial);
          addedCount++;
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

    return newMaterials.length > 0;
  }, [logger]);

  // 添加或替换单个素材
  const addOrReplaceMaterial = useCallback((newMaterial: MaterialItem) => {
    logger.info('添加或替换素材', {
      materialId: newMaterial.id,
      materialName: newMaterial.name,
      materialType: newMaterial.type
    });

    setMaterials(prev => {
      const existingIndex = prev.findIndex(material => material.id === newMaterial.id);
      
      if (existingIndex !== -1) {
        const updatedMaterials = [...prev];
        updatedMaterials[existingIndex] = newMaterial;
        
        logger.info('替换现有素材', {
          materialId: newMaterial.id,
          replacedIndex: existingIndex
        });
        
        return updatedMaterials;
      }
      
      const updatedMaterials = [...prev, newMaterial];
      
      logger.info('添加新素材到列表', {
        materialId: newMaterial.id,
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
    handleDragUpload,
    addMaterials,
    addOrReplaceMaterial,
    confirmationDialog,
    handleCloseConfirmationDialog
  };
};

