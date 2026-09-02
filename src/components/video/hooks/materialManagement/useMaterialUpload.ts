import { Dispatch, MutableRefObject, SetStateAction, useCallback, useState } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { VideoEditingLogger } from '../../utils';
import { http, ApiError } from '@/lib/api/http-client';
import { createLocalMaterialFromUpload, isDataUrl } from '../../lib/localMaterial';
import { extractVideoThumbnail } from '../../utils/extractVideoThumbnail';

// 上传任务接口
interface UploadTask {
  file: File;
  material: MaterialItem;
}

interface UseMaterialUploadParams {
  taskId: string;
  logger: VideoEditingLogger;
  /** Owner stamped on every upload. Always `LOCAL_OWNER_ID` — see
   *  `src/lib/localOwner.ts`. Kept as a parameter (rather than imported
   *  here) so the hook stays a pure function of its inputs in tests. */
  ownerId: string;
  isMountedRef: MutableRefObject<boolean>;
  setMaterials: Dispatch<SetStateAction<MaterialItem[]>>;
}

export interface UseMaterialUploadReturn {
  isUploading: boolean;
  uploadProgress: number;
  handleMaterialUpload: () => Promise<void>;
  handleDragUpload: (files: FileList) => Promise<void>;
  /** Fire-and-forget quick analysis; reused by the search-added material path. */
  triggerAutoAnalysis: (material: MaterialItem) => Promise<void>;
}

// 并发上传配置
const MAX_CONCURRENT_UPLOADS = 3;

/**
 * useMaterialUpload Hook
 *
 * Owns the concurrent material upload queue (file picker + drag drop), the
 * per-file upload + auto-analysis, and the aggregate upload progress state.
 * Lifted verbatim from useMaterialManagement so the orchestrator stays lean;
 * behaviour is unchanged.
 */
export function useMaterialUpload(params: UseMaterialUploadParams): UseMaterialUploadReturn {
  const { taskId, logger, ownerId, isMountedRef, setMaterials } = params;

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

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
        if (ownerId) {
          formData.append('user_id', ownerId);
        }

        let result: any;
        try {
          result = await http.upload<any>('/api/storage/upload-video', formData, {
            timeoutMs: 600_000,
          });
        } catch (httpError) {
          if (httpError instanceof ApiError) {
            throw new Error(`视频上传失败: ${httpError.status} ${httpError.message}`);
          }
          throw httpError;
        }

        if (!result.success) {
          throw new Error(`视频上传失败: ${result.message}`);
        }

        logger.info('视频上传到存储服务成功', {
          fileName: file.name,
          videoUrl: result.video_url,
          thumbnailUrl: result.thumbnail_url
        });

        // 直接使用服务器URL（通过Next.js代理 /api/storage/files/ 可访问）
        const videoMaterial = createLocalMaterialFromUpload(material, file, result);

        // 后端 ffmpeg 海报是首选（落盘、可持久）；若缺失（ffprobe 取不到时长、
        // ffmpeg 失败或被跳过），回退到与 AI/故事板路径一致的客户端 canvas 抽帧。
        // extractVideoThumbnail 内部自带 10s 超时与跨域代理，返回 dataURL 或 null。
        // 仅在 thumbnailSource==='client' 时显式标注；后端海报（默认来源）不写该键，
        // 「undefined === 后端来源」是约定（见 §6）。该标注是 (E) 持久化剥离的判定键。
        if (!videoMaterial.thumbnailUrl && videoMaterial.url) {
          const dataUrl = await extractVideoThumbnail(videoMaterial.url);
          if (dataUrl) {
            videoMaterial.thumbnailUrl = dataUrl;
            videoMaterial.metadata = {
              ...videoMaterial.metadata,
              thumbnailSource: 'client', // 标注为内存态客户端缩略图（不持久化，见 (E)）
            };
          }
        }

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
        if (ownerId) {
          formData.append('user_id', ownerId);
        }

        let result: any;
        try {
          result = await http.upload<any>('/api/storage/upload-file', formData, {
            timeoutMs: 600_000,
          });
        } catch (httpError) {
          if (httpError instanceof ApiError) {
            throw new Error(`文件上传失败: ${httpError.status} ${httpError.message}`);
          }
          throw httpError;
        }

        if (!result.success) {
          throw new Error(`文件上传失败: ${result.message}`);
        }

        logger.info('文件上传到存储服务成功', {
          fileName: file.name,
          fileUrl: result.file_url
        });

        // 直接使用服务器URL（通过Next.js代理 /api/storage/files/ 可访问）
        const fileMaterial = createLocalMaterialFromUpload(material, file, result);

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
  }, [taskId, logger, ownerId]);

  // 视频上传后自动触发快速解析（fire-and-forget）
  const triggerAutoAnalysis = useCallback(async (material: MaterialItem) => {
    // 设置 pending 状态
    setMaterials(prev => prev.map(m =>
      m.id === material.id
        ? { ...m, analysisResult: { status: 'pending' as const } }
        : m
    ));

    try {
      // 客户端兜底产出的 `data:` 缩略图不能被后端按 URL 拉取；此时改为不传
      // thumbnail_url、置 use_thumbnail:false，让后端从 video_url 自行抽帧分析。
      // 仅后端海报（http(s)/相对路径）才作为 analyze 的 thumbnail_url 透传。
      const useBackendThumbnail = !!material.thumbnailUrl && !isDataUrl(material.thumbnailUrl);
      let data: any;
      try {
        data = await http.post<any>('/api/video/analyze', {
          video_url: material.url || material.serverUrl,
          use_thumbnail: useBackendThumbnail,
          ...(useBackendThumbnail ? { thumbnail_url: material.thumbnailUrl } : {}),
        }, { timeoutMs: 600_000 });
      } catch (httpError) {
        if (httpError instanceof ApiError) {
          throw new Error(`解析请求失败: ${httpError.status}`);
        }
        throw httpError;
      }
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
  }, [logger, isMountedRef, setMaterials]);

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

          if (!uploadedMaterial) {
            setMaterials(prev => prev.filter(m => m.id !== material.id));

            logger.error('文件上传失败，已移除', {
              materialId: material.id,
              fileName: file.name,
              position: taskIndex + 1,
              error: 'upload failed',
            });
          } else {
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
  }, [logger, setMaterials, uploadSingleFile, triggerAutoAnalysis]);

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
  }, [isUploading, uploadProgress, logger, processFileUpload]);

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
  }, [isUploading, uploadProgress, logger, processFileUpload]);

  return {
    isUploading,
    uploadProgress,
    handleMaterialUpload,
    handleDragUpload,
    triggerAutoAnalysis,
  };
}
