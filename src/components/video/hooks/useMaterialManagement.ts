import { useState, useCallback, useMemo } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseMaterialManagementReturn } from '../types';
import { VideoEditingLogger } from '../utils';
import localVideoManager from '@/lib/utils/localVideoManager';

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

  // 处理素材删除
  const handleMaterialDelete = useCallback((materialIds: string[]) => {
    logger.userAction('素材删除操作', 'deleteButton', {
      materialIds,
      materialCount: materialIds.length
    });

    // 确认删除
    const confirmDelete = window.confirm(
      `确定要删除 ${materialIds.length} 个素材吗？此操作不可撤销。`
    );

    if (confirmDelete) {
      logger.info('用户确认删除素材', {
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
    } else {
      logger.info('用户取消删除素材', {
        cancelledIds: materialIds
      });
    }
  }, [selectedMaterials, materials, logger]);

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

      const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
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

              const response = await fetch(`${API_BASE_URL}/api/supabase/upload-video`, {
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

              const response = await fetch(`${API_BASE_URL}/api/supabase/upload-file`, {
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
                fileSize: result.file_size
              });

              // 下载文件到本地（音频使用音频管理器，图片暂时也用视频管理器）
              const fileResponse = await fetch(result.file_url);
              if (!fileResponse.ok) {
                throw new Error(`下载文件失败: ${fileResponse.status} ${fileResponse.statusText}`);
              }
              const fileBlob = await fileResponse.blob();

              // 创建本地URL
              const localUrl = URL.createObjectURL(fileBlob);

              // 创建素材项
              const material: MaterialItem = {
                id: `${materialType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: file.name,
                type: materialType,
                format: file.name.split('.').pop() || '',
                size: result.file_size,
                url: localUrl,
                serverUrl: result.file_url,
                createdAt: new Date(),
                metadata: {
                  originalUrl: result.file_url,
                  fileName: file.name,
                  isLocalFile: true
                }
              };

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

  // 添加素材到列表
  const addMaterials = useCallback((newMaterials: MaterialItem[]) => {
    logger.info('添加素材到列表', {
      materialCount: newMaterials.length,
      materials: newMaterials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type
      }))
    });

    setMaterials(prev => {
      const updatedMaterials = [...prev, ...newMaterials];
      
      logger.info('素材列表更新完成', {
        previousCount: prev.length,
        newCount: updatedMaterials.length,
        addedCount: newMaterials.length
      });
      
      return updatedMaterials;
    });

    return newMaterials.length;
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
    addMaterials
  };
};