import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { MaterialItem, MaterialType, StoryboardGenerateParams, StoryboardPack } from '@/types';
import { UseMaterialManagementReturn } from '../types';
import { VideoEditingLogger } from '../utils';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { createArkVideoTask, getArkVideoStatus, ArkVideoGenerateParams } from '@/lib/api/arkVideo';
import { generateArkImages, ArkImageGenerateParams } from '@/lib/api/arkImage';
import { generateStoryboard } from '@/lib/api/storyboard';
import { useVideoEditingStore } from '@/stores';

/** Generate a UUID v4 string, with fallback for non-secure contexts (HTTP). */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback using crypto.getRandomValues
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
 * Extract a thumbnail frame from a video URL using an offscreen canvas.
 * Works with CDN URLs that support CORS. Returns a JPEG data URL or null on failure.
 */
async function extractVideoThumbnail(videoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;

    let resolved = false;
    const finish = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    // Register onseeked INSIDE onloadedmetadata so it only fires for our explicit seek,
    // not for any browser-initiated initial seek at t=0 (which would capture a blank frame).
    video.onloadedmetadata = () => {
      const targetTime = video.duration > 2 ? 1 : 0;
      video.onseeked = () => {
        video.onseeked = null;
        try {
          if (!video.videoWidth || !video.videoHeight) {
            finish(null);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = Math.round(320 * video.videoHeight / video.videoWidth) || 180;
          const ctx = canvas.getContext('2d');
          if (!ctx) { finish(null); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.8));
        } catch {
          finish(null);
        }
      };
      video.currentTime = targetTime;
    };

    video.onerror = () => finish(null);
    // Fallback: if seek event doesn't fire within 10s, give up
    setTimeout(() => finish(null), 10000);

    video.src = videoUrl;
  });
}

/**
 * useMaterialManagement Hook
 * 管理素材库操作，支持并发上传队列
 *
 * @param taskId - 任务ID，用于日志记录
 * @param initialMaterials - 从持久化content恢复的初始素材列表
 * @returns 素材管理相关的状态和方法
 */
export const useMaterialManagement = (taskId: string, initialMaterials: MaterialItem[] = []): UseMaterialManagementReturn => {
  // 获取当前用户信息
  const { user } = useAuth();
  const { t } = useLocale();
  const clearMaterials = useVideoEditingStore(state => state.clearMaterials);

  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useMaterialManagement'
  }), [taskId]);

  // 素材管理状态
  const [materials, setMaterials] = useState<MaterialItem[]>(initialMaterials);

  // Sync: merge Zustand store materials into local state.
  // Agent tools add materials via SSE → AgentEventRouter → Zustand store.
  // This effect bridges the store → local useState so MaterialsPanel re-renders.
  const storeMaterials = useVideoEditingStore(state => state.materials);
  useEffect(() => {
    setMaterials(prev => {
      const localIds = new Set(prev.map(m => m.id));
      const newFromStore = storeMaterials.filter(m => !localIds.has(m.id));
      if (newFromStore.length === 0) return prev;
      return [...prev, ...newFromStore];
    });
  }, [storeMaterials]);

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

        const response = await fetch('/api/storage/upload-video', {
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

        logger.info('视频上传到存储服务成功', {
          fileName: file.name,
          videoUrl: result.video_url,
          thumbnailUrl: result.thumbnail_url
        });

        // 直接使用服务器URL（通过Next.js代理 /api/storage/files/ 可访问）
        const videoMaterial: MaterialItem = {
          id: `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: 'video',
          format: file.name.split('.').pop() || 'mp4',
          size: result.file_size,
          duration: result.duration,
          width: result.width,
          height: result.height,
          thumbnailUrl: result.thumbnail_url || undefined,
          url: result.video_url,
          serverUrl: result.video_url,
          createdAt: new Date(),
          metadata: {
            originalUrl: result.video_url,
            fileName: file.name,
            isLocalFile: false,
            storageMetadata: result.metadata
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

        const response = await fetch('/api/storage/upload-file', {
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

        logger.info('文件上传到存储服务成功', {
          fileName: file.name,
          fileUrl: result.file_url
        });

        // 直接使用服务器URL（通过Next.js代理 /api/storage/files/ 可访问）
        const fileMaterial: MaterialItem = {
          id: `${materialType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: materialType,
          format: file.name.split('.').pop() || '',
          size: result.file_size,
          url: result.file_url,
          serverUrl: result.file_url,
          thumbnailUrl: materialType === 'image' ? result.file_url : undefined,
          createdAt: new Date(),
          metadata: {
            originalUrl: result.file_url,
            fileName: file.name,
            isLocalFile: false
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

  // 视频上传后自动触发快速解析（fire-and-forget）
  const triggerAutoAnalysis = useCallback(async (material: MaterialItem) => {
    // 设置 pending 状态
    setMaterials(prev => prev.map(m =>
      m.id === material.id
        ? { ...m, analysisResult: { status: 'pending' as const } }
        : m
    ));

    try {
      const response = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: material.url || material.serverUrl,
          use_thumbnail: true,
          thumbnail_url: material.thumbnailUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`解析请求失败: ${response.status}`);
      }

      const data = await response.json();
      const analysisText = data?.data?.frame_analyses?.[0]?.analysis
        || data?.frame_analyses?.[0]?.analysis
        || '';

      if (!isMountedRef.current) return;

      setMaterials(prev => prev.map(m =>
        m.id === material.id
          ? {
              ...m,
              analysisResult: {
                status: 'completed' as const,
                analysis: analysisText,
                timestamp: new Date().toISOString(),
              },
            }
          : m
      ));

      logger.info('素材自动解析完成', { materialId: material.id, analysisLength: analysisText.length });
    } catch (error) {
      if (!isMountedRef.current) return;

      const errMsg = error instanceof Error ? error.message : String(error);
      setMaterials(prev => prev.map(m =>
        m.id === material.id
          ? { ...m, analysisResult: { status: 'error' as const, errorMessage: errMsg } }
          : m
      ));

      logger.warn('素材自动解析失败', { materialId: material.id, error: errMsg });
    }
  }, [logger]);

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

            // 素材上传成功后自动触发快速解析
            if ((uploadedMaterial.type === 'video' || uploadedMaterial.type === 'image') && uploadedMaterial.thumbnailUrl) {
              triggerAutoAnalysis(uploadedMaterial);
            }

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
  }, [taskId, logger, uploadSingleFile, triggerAutoAnalysis]);

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

    // 对搜索添加的素材自动触发解析（与上传后自动解析逻辑一致）
    newMaterials.forEach(material => {
      const isVideoOrImage = material.type === 'video' || material.type === 'image';
      const hasUrl = material.url || material.serverUrl;
      const hasThumbnail = material.thumbnailUrl;
      const notDownloading = material.downloadStatus !== 'downloading';
      const notAnalyzed = !material.analysisResult;

      if (isVideoOrImage && hasUrl && hasThumbnail && notDownloading && notAnalyzed) {
        logger.info('搜索添加的素材自动触发解析', { materialId: material.id, materialName: material.name });
        triggerAutoAnalysis(material);
      }
    });

    return newMaterials.length > 0;
  }, [logger, triggerAutoAnalysis]);

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

  // AI视频生成轮询任务 ref: tempId -> current setTimeout handle
  const pendingAiTasks = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Tracks whether the hook's host component is still mounted
  const isMountedRef = useRef(true);

  // Clear all polling timers on unmount to prevent state updates on dead components
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pendingAiTasks.current.forEach(id => clearTimeout(id));
      pendingAiTasks.current.clear();
    };
  }, []);

  // AI视频生成
  const handleAiVideoGenerate = useCallback(async (params: ArkVideoGenerateParams) => {
    const tempId = generateUUID();
    const createdAt = new Date();
    // Use timestamp-based name so the material has a stable, identifiable name
    const materialName = `AI视频_${createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    // Insert placeholder card at the front of the list
    const placeholder: MaterialItem = {
      id: tempId,
      name: materialName,
      type: 'video',
      format: 'mp4',
      size: 0,
      url: '',
      createdAt,
      downloadStatus: 'generating',
      downloadProgress: 0,
      metadata: { source: 'ark-ai-video', prompt: params.prompt },
    };
    setMaterials(prev => [placeholder, ...prev]);

    let arkTaskId: string;
    try {
      const result = await createArkVideoTask(params);
      arkTaskId = result.ark_task_id;
    } catch (error) {
      logger.error('创建Ark视频任务失败', error as Error);
      setMaterials(prev => prev.filter(m => m.id !== tempId));
      return;
    }

    // Polling with simulated progress crawl and error retry cap
    let estimatedProgress = 0;
    let errorRetries = 0;
    const MAX_ERROR_RETRIES = 10;
    // After video generation succeeds, keep polling for OSS URL + thumbnail (max ~60s)
    let ossWaitRetries = 0;
    const MAX_OSS_WAIT_RETRIES = 20;

    const poll = async () => {
      // Slow progress crawl up to 90%
      estimatedProgress = Math.min(estimatedProgress + Math.random() * 3 + 1, 90);
      setMaterials(prev => prev.map(m =>
        m.id === tempId ? { ...m, downloadProgress: estimatedProgress } : m
      ));

      try {
        const status = await getArkVideoStatus(arkTaskId);
        errorRetries = 0; // reset on success

        if (status.status === 'succeeded' && status.video_url) {
          // OSS upload complete: backend returns thumbnail_url once video+thumbnail are on OSS
          if (status.thumbnail_url) {
            const finalMaterial: MaterialItem = {
              id: tempId,
              name: materialName,
              type: 'video',
              format: 'mp4',
              size: 0,
              url: status.video_url,
              serverUrl: status.video_url,
              thumbnailUrl: status.thumbnail_url,
              duration: status.duration,
              width: status.width,
              height: status.height,
              createdAt,
              downloadStatus: undefined,
              downloadProgress: undefined,
              metadata: { source: 'ark-ai-video', prompt: params.prompt },
            };
            addOrReplaceMaterial(finalMaterial);
            pendingAiTasks.current.delete(tempId);
            return;
          }

          // OSS upload still in progress: set CDN URL for instant playback, keep polling
          ossWaitRetries++;
          const cdnMaterial: MaterialItem = {
            id: tempId,
            name: materialName,
            type: 'video',
            format: 'mp4',
            size: 0,
            url: status.video_url,
            serverUrl: status.video_url,
            thumbnailUrl: undefined,
            duration: status.duration,
            width: status.width,
            height: status.height,
            createdAt,
            downloadStatus: 'generating',
            downloadProgress: 95,
            metadata: { source: 'ark-ai-video', prompt: params.prompt },
          };
          addOrReplaceMaterial(cdnMaterial);

          if (ossWaitRetries >= MAX_OSS_WAIT_RETRIES) {
            // OSS upload timed out — finalise with CDN URL, extract thumbnail client-side
            logger.warn(`Ark视频OSS上传等待超时，使用CDN URL`, { arkTaskId, ossWaitRetries });
            addOrReplaceMaterial({ ...cdnMaterial, downloadStatus: undefined, downloadProgress: undefined });
            pendingAiTasks.current.delete(tempId);
            extractVideoThumbnail(status.video_url).then(dataUrl => {
              if (dataUrl && isMountedRef.current) {
                setMaterials(prev => prev.map(m =>
                  m.id === tempId ? { ...m, thumbnailUrl: dataUrl } : m
                ));
              }
            });
            return;
          }

          // Continue polling every 3s while waiting for OSS
          const timeoutId = setTimeout(poll, 3000);
          pendingAiTasks.current.set(tempId, timeoutId);
          return;
        }

        if (status.status === 'failed') {
          setMaterials(prev => prev.filter(m => m.id !== tempId));
          pendingAiTasks.current.delete(tempId);
          return;
        }

        // Still running — schedule next poll
        const timeoutId = setTimeout(poll, 5000);
        pendingAiTasks.current.set(tempId, timeoutId);
      } catch (error) {
        errorRetries++;
        logger.error(`轮询Ark视频状态失败 (retry ${errorRetries}/${MAX_ERROR_RETRIES})`, error as Error);

        if (errorRetries >= MAX_ERROR_RETRIES) {
          logger.error(`Ark视频轮询达到最大重试次数，放弃任务`, { arkTaskId, retries: errorRetries });
          setMaterials(prev => prev.filter(m => m.id !== tempId));
          pendingAiTasks.current.delete(tempId);
          return;
        }

        const timeoutId = setTimeout(poll, 5000);
        pendingAiTasks.current.set(tempId, timeoutId);
      }
    };

    const initialTimeout = setTimeout(poll, 5000);
    pendingAiTasks.current.set(tempId, initialTimeout);
  }, [logger, addOrReplaceMaterial]);

  // AI图像生成
  const handleAiImageGenerate = useCallback(async (params: ArkImageGenerateParams) => {
    const createdAt = new Date();
    const timeStr = createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Determine name prefix based on mode
    const mode = params.mode || 'basic';
    const namePrefix = mode === 'character' ? 'AI人物建模' : mode === 'scene' ? 'AI场景建模' : 'AI图像';

    // Insert placeholder cards for each requested image
    const placeholderIds: string[] = [];
    for (let i = 0; i < params.count; i++) {
      const tempId = generateUUID();
      placeholderIds.push(tempId);
      const placeholder: MaterialItem = {
        id: tempId,
        name: `${namePrefix}_${timeStr}_${i + 1}`,
        type: 'image',
        format: 'png',
        size: 0,
        url: '',
        createdAt,
        downloadStatus: 'generating',
        downloadProgress: 0,
        metadata: { source: 'ark-ai-image', prompt: params.prompt, mode },
      };
      setMaterials(prev => [placeholder, ...prev]);
    }

    try {
      const images = await generateArkImages(params);

      // Replace placeholders with actual results
      for (let i = 0; i < placeholderIds.length; i++) {
        const placeholderId = placeholderIds[i];
        const image = images[i];

        if (image) {
          const finalMaterial: MaterialItem = {
            id: placeholderId,
            name: `${namePrefix}_${timeStr}_${i + 1}`,
            type: 'image',
            format: 'png',
            size: 0,
            url: image.image_url,
            serverUrl: image.image_url,
            thumbnailUrl: image.image_url,
            width: image.width,
            height: image.height,
            createdAt,
            downloadStatus: undefined,
            downloadProgress: undefined,
            metadata: { source: 'ark-ai-image', prompt: params.prompt, mode },
          };
          addOrReplaceMaterial(finalMaterial);
        } else {
          // No corresponding image returned — remove placeholder
          setMaterials(prev => prev.filter(m => m.id !== placeholderId));
        }
      }
    } catch (error) {
      logger.error('AI图像生成失败', error as Error);
      // Remove all placeholders on failure
      setMaterials(prev => prev.filter(m => !placeholderIds.includes(m.id)));
      throw error;
    }
  }, [logger, addOrReplaceMaterial]);

  // 分镜包生成
  const handleStoryboardGenerate = useCallback(async (params: StoryboardGenerateParams): Promise<StoryboardPack> => {
    const createdAt = new Date();
    const timeStr = createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const pack = await generateStoryboard(params);

    // 分镜包不再加到 materials[] — 由 MaterialsPanel 的 storyboardPacks[] 单独管理
    logger.info(`分镜包生成成功: ${pack.packId}, ${pack.frameCount} 帧`);

    return pack;
  }, [logger]);

  // 清除所有素材
  const handleClearAllMaterials = useCallback((onAfterClear?: () => void) => {
    if (isUploading) {
      return;
    }
    const count = materials.length;
    if (count === 0) return;

    setConfirmationDialog({
      isOpen: true,
      title: t.materialsPanel.clearAllConfirmTitle,
      message: t.materialsPanel.clearAllConfirmMessage.replace('{count}', String(count)),
      type: 'danger',
      onConfirm: () => {
        logger.info('用户确认清除所有素材', { count });
        setMaterials([]);
        setSelectedMaterials(new Set());
        clearMaterials();
        onAfterClear?.();
        setConfirmationDialog(prev => ({ ...prev, isOpen: false }));
      },
    });
  }, [materials.length, isUploading, clearMaterials, t, logger]);

  // 过滤后的素材列表
  const filteredMaterials = useMemo(() => {
    if (selectedMaterialType === 'all') {
      return materials;
    }
    return materials.filter(material => material.type === selectedMaterialType);
  }, [materials, selectedMaterialType]);

  return {
    materials: filteredMaterials,
    allMaterials: materials,
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
    handleCloseConfirmationDialog,
    handleAiVideoGenerate,
    handleAiImageGenerate,
    handleStoryboardGenerate,
    handleClearAllMaterials,
  };
};

