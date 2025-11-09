import { MaterialItem } from '@/types';
import type { UseVideoAnalysisReturn } from '../hooks/useVideoAnalysis';

// Configuration constants
export const VIDEO_ANALYSIS_CONFIG = {
  DEFAULT_THREAD_COUNT: 5,
  MAX_RETRY_ATTEMPTS: 1,
  RETRY_DELAY_MS: 1000,
  REQUEST_TIMEOUT_MS: 120000, // 120 seconds for batch analysis
} as const;

// Types
export interface VideoAnalysisRequest {
  video_url: string;
  frame_interval: number;
  custom_prompt: string;
}

export interface BatchVideoAnalysisRequest {
  videos: Array<{
    video_url: string;
    frame_interval: number;
    thumbnail_url?: string; // For quick mode: use thumbnail instead of downloading video
  }>;
  custom_prompt?: string;
  use_thumbnails?: boolean; // Flag to indicate thumbnail-only analysis (quick mode)
}

export interface BatchVideoAnalysisResponse {
  success: boolean;
  total_videos: number;
  successful_videos: number;
  failed_videos: number;
  results: Array<{
    video_url: string;
    success: boolean;
    total_frames_extracted: number;
    video_duration: number;
    frame_analyses: Array<{
      frame_number: number;
      timestamp: number;
      analysis: string;
      frame_path: string;
    }>;
    error_message?: string;
  }>;
  total_frames_extracted: number;
  total_processing_time: number;
  frame_extraction_time: number;
  vlm_analysis_time: number;
  concurrent_threads: number;
  timestamp: string;
  message: string;
}

export interface VideoAnalysisResult {
  success: boolean;
  video_url: string;
  material: MaterialItem;
  error?: string;
  attempts: number;
}

export interface ParallelAnalysisOptions {
  threadCount?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  mode: { type: 'quick' | 'professional'; frameInterval?: number };
  sequential?: boolean; // 是否顺序执行（一个接一个），默认为 false（并行执行）
}

// Utility class for managing concurrent requests with thread limiting
class ThreadPool {
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private maxConcurrent: number) {}

  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          this.running++;
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processQueue();
        }
      };

      if (this.running < this.maxConcurrent) {
        wrappedTask();
      } else {
        this.queue.push(wrappedTask);
      }
    });
  }

  private processQueue() {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        nextTask();
      }
    }
  }
}

// Sleep utility for retry delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Analyze a single video with retry logic
 */
async function analyzeSingleVideoWithRetry(
  material: MaterialItem,
  options: ParallelAnalysisOptions,
  taskId: string
): Promise<VideoAnalysisResult> {
  const { maxRetries = VIDEO_ANALYSIS_CONFIG.MAX_RETRY_ATTEMPTS, retryDelayMs = VIDEO_ANALYSIS_CONFIG.RETRY_DELAY_MS, mode } = options;
  
  let lastError: Error | null = null;
  let attempts = 0;

  console.log(`[ParallelVideoAnalysis] 开始分析视频: ${material.name}`, {
    taskId,
    videoId: material.id,
    videoUrl: material.url,
    mode: mode.type,
    frameInterval: mode.type === 'quick' ? 9999 : (mode.frameInterval || 5),
    maxRetries,
    timestamp: new Date().toISOString()
  });

  for (attempts = 0; attempts <= maxRetries; attempts++) {
    try {
      if (attempts > 0) {
        console.log(`[ParallelVideoAnalysis] 重试分析视频: ${material.name} (第${attempts}次重试)`, {
          taskId,
          videoId: material.id,
          previousError: lastError?.message,
          retryDelay: retryDelayMs,
          timestamp: new Date().toISOString()
        });
        await sleep(retryDelayMs);
      }

      const startTime = performance.now();
      
      // Prepare appropriate prompt based on mode
      const quickModePrompt = "用一句话简洁描述这个视频画面的主要内容，包括场景和主体。";
      const professionalModePrompt = "请详细描述这张图片中的内容，包括场景、人物、物体、动作、情感等，用于视频剪辑分析。";
      
      // Prepare request body
      const requestBody: VideoAnalysisRequest = {
        video_url: material.url,
        frame_interval: mode.type === 'quick' ? 9999 : (mode.frameInterval || 5), // Quick mode uses large interval for single frame
        custom_prompt: mode.type === 'quick' ? quickModePrompt : professionalModePrompt
      };

      console.log(`[ParallelVideoAnalysis] 发送API请求: ${material.name}`, {
        taskId,
        videoId: material.id,
        attempt: attempts + 1,
        mode: mode.type,
        promptType: mode.type === 'quick' ? 'quick (简洁描述)' : 'professional (详细描述)',
        requestBody: {
          video_url: requestBody.video_url,
          frame_interval: requestBody.frame_interval,
          custom_prompt: requestBody.custom_prompt
        },
        timestamp: new Date().toISOString()
      });

      // Create request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), VIDEO_ANALYSIS_CONFIG.REQUEST_TIMEOUT_MS);

      const response = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseTime = performance.now() - startTime;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.detail || `HTTP error! status: ${response.status}`;
        
        console.warn(`[ParallelVideoAnalysis] API请求失败: ${material.name}`, {
          taskId,
          videoId: material.id,
          attempt: attempts + 1,
          status: response.status,
          statusText: response.statusText,
          errorMessage,
          responseTime,
          timestamp: new Date().toISOString()
        });

        throw new Error(errorMessage);
      }

      const analysisResult = await response.json();
      
      console.log(`[ParallelVideoAnalysis] API请求成功: ${material.name}`, {
        taskId,
        videoId: material.id,
        attempt: attempts + 1,
        success: analysisResult.success,
        framesAnalyzed: analysisResult.total_frames_extracted || 0,
        processingTime: analysisResult.processing_time,
        responseTime,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        video_url: material.url,
        material,
        attempts: attempts + 1
      };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      console.warn(`[ParallelVideoAnalysis] 分析失败: ${material.name} (尝试 ${attempts + 1}/${maxRetries + 1})`, {
        taskId,
        videoId: material.id,
        error: lastError.message,
        isAbortError: lastError.name === 'AbortError',
        isNetworkError: lastError.message.includes('fetch'),
        willRetry: attempts < maxRetries,
        timestamp: new Date().toISOString()
      });

      // If this is the last attempt, break out of the loop
      if (attempts >= maxRetries) {
        break;
      }
    }
  }

  // All attempts failed
  console.error(`[ParallelVideoAnalysis] 视频分析彻底失败: ${material.name}`, {
    taskId,
    videoId: material.id,
    totalAttempts: attempts,
    finalError: lastError?.message,
    timestamp: new Date().toISOString()
  });

  return {
    success: false,
    video_url: material.url,
    material,
    error: lastError?.message || 'Unknown error',
    attempts
  };
}

/**
 * Analyze multiple videos sequentially (one by one) with retry logic
 * This mode is used for AI mixed editing to avoid backend errors from concurrent requests
 */
async function analyzeVideosSequentially(
  videoMaterials: MaterialItem[],
  options: ParallelAnalysisOptions,
  taskId: string
): Promise<VideoAnalysisResult[]> {
  if (videoMaterials.length === 0) {
    console.log(`[SequentialVideoAnalysis] 无视频素材需要分析`, { taskId });
    return [];
  }

  console.log(`[SequentialVideoAnalysis] 开始顺序视频分析（一个接一个）`, {
    taskId,
    totalVideos: videoMaterials.length,
    maxRetries: options.maxRetries || VIDEO_ANALYSIS_CONFIG.MAX_RETRY_ATTEMPTS,
    mode: options.mode.type,
    frameInterval: options.mode.frameInterval,
    timestamp: new Date().toISOString()
  });

  const startTime = performance.now();
  const results: VideoAnalysisResult[] = [];
  let currentVideoIndex = 0;

  // Process videos one by one
  for (const material of videoMaterials) {
    currentVideoIndex++;
    
    console.log(`[SequentialVideoAnalysis] 处理视频 ${currentVideoIndex}/${videoMaterials.length}`, {
      taskId,
      videoId: material.id,
      videoName: material.name,
      videoUrl: material.url,
      progress: `${Math.round((currentVideoIndex / videoMaterials.length) * 100)}%`,
      timestamp: new Date().toISOString()
    });

    const result = await analyzeSingleVideoWithRetry(material, options, taskId);
    results.push(result);

    if (result.success) {
      console.log(`[SequentialVideoAnalysis] 视频分析成功 (${currentVideoIndex}/${videoMaterials.length})`, {
        taskId,
        videoId: material.id,
        videoName: material.name,
        attempts: result.attempts,
        progress: `${Math.round((currentVideoIndex / videoMaterials.length) * 100)}%`,
        timestamp: new Date().toISOString()
      });
    } else {
      console.warn(`[SequentialVideoAnalysis] 视频分析失败 (${currentVideoIndex}/${videoMaterials.length})`, {
        taskId,
        videoId: material.id,
        videoName: material.name,
        error: result.error,
        attempts: result.attempts,
        progress: `${Math.round((currentVideoIndex / videoMaterials.length) * 100)}%`,
        timestamp: new Date().toISOString()
      });
    }
  }

  const totalTime = performance.now() - startTime;

  // Analyze results
  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);
  const totalAttempts = results.reduce((sum, r) => sum + r.attempts, 0);

  console.log(`[SequentialVideoAnalysis] 顺序视频分析完成`, {
    taskId,
    totalVideos: videoMaterials.length,
    successCount: successfulResults.length,
    failedCount: failedResults.length,
    successRate: `${Math.round((successfulResults.length / videoMaterials.length) * 100)}%`,
    totalAttempts,
    averageAttempts: Math.round(totalAttempts / videoMaterials.length * 100) / 100,
    totalProcessingTime: Math.round(totalTime),
    averageTimePerVideo: Math.round(totalTime / videoMaterials.length),
    timestamp: new Date().toISOString()
  });

  // Log failed analyses
  if (failedResults.length > 0) {
    console.warn(`[SequentialVideoAnalysis] 失败的视频分析详情`, {
      taskId,
      failedVideos: failedResults.map(r => ({
        name: r.material.name,
        id: r.material.id,
        error: r.error,
        attempts: r.attempts
      })),
      timestamp: new Date().toISOString()
    });
  }

  return results;
}

/**
 * Analyze multiple videos in parallel with thread limiting and retry logic
 */
export async function analyzeVideosInParallel(
  videoMaterials: MaterialItem[],
  options: ParallelAnalysisOptions,
  taskId: string
): Promise<VideoAnalysisResult[]> {
  // Check if sequential mode is enabled
  if (options.sequential === true) {
    console.log(`[VideoAnalysis] 使用顺序模式进行视频分析`, {
      taskId,
      totalVideos: videoMaterials.length,
      timestamp: new Date().toISOString()
    });
    return analyzeVideosSequentially(videoMaterials, options, taskId);
  }

  // Otherwise use parallel mode (default)
  const { threadCount = VIDEO_ANALYSIS_CONFIG.DEFAULT_THREAD_COUNT } = options;
  
  if (videoMaterials.length === 0) {
    console.log(`[ParallelVideoAnalysis] 无视频素材需要分析`, { taskId });
    return [];
  }

  console.log(`[ParallelVideoAnalysis] 开始并行视频分析`, {
    taskId,
    totalVideos: videoMaterials.length,
    threadCount,
    maxRetries: options.maxRetries || VIDEO_ANALYSIS_CONFIG.MAX_RETRY_ATTEMPTS,
    mode: options.mode.type,
    frameInterval: options.mode.frameInterval,
    timestamp: new Date().toISOString()
  });

  const startTime = performance.now();
  const threadPool = new ThreadPool(threadCount);
  
  // Create analysis tasks
  const analysisPromises = videoMaterials.map(material =>
    threadPool.execute(() => analyzeSingleVideoWithRetry(material, options, taskId))
  );

  // Wait for all analyses to complete
  const results = await Promise.all(analysisPromises);
  const totalTime = performance.now() - startTime;

  // Analyze results
  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);
  const totalAttempts = results.reduce((sum, r) => sum + r.attempts, 0);

  console.log(`[ParallelVideoAnalysis] 并行视频分析完成`, {
    taskId,
    totalVideos: videoMaterials.length,
    successCount: successfulResults.length,
    failedCount: failedResults.length,
    successRate: `${Math.round((successfulResults.length / videoMaterials.length) * 100)}%`,
    totalAttempts,
    averageAttempts: Math.round(totalAttempts / videoMaterials.length * 100) / 100,
    totalProcessingTime: Math.round(totalTime),
    threadCount,
    timestamp: new Date().toISOString()
  });

  // Log failed analyses
  if (failedResults.length > 0) {
    console.warn(`[ParallelVideoAnalysis] 失败的视频分析详情`, {
      taskId,
      failedVideos: failedResults.map(r => ({
        name: r.material.name,
        id: r.material.id,
        error: r.error,
        attempts: r.attempts
      })),
      timestamp: new Date().toISOString()
    });
  }

  return results;
}

// Helper function to convert blob URL to base64
async function blobUrlToBase64(blobUrl: string): Promise<string | null> {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`[BatchVideoAnalysis] Failed to convert blob URL to base64:`, blobUrl, error);
    return null;
  }
}

/**
 * Analyze multiple videos using batch analysis API
 * This is the recommended approach for AI mixed editing as it uses optimized two-phase processing:
 * 1. Sequential frame extraction from all videos
 * 2. Concurrent VLM analysis of all extracted frames
 */
export async function analyzeVideosInBatch(
  videoMaterials: MaterialItem[],
  options: ParallelAnalysisOptions,
  taskId: string,
  videoAnalysis?: UseVideoAnalysisReturn
): Promise<VideoAnalysisResult[]> {
  if (videoMaterials.length === 0) {
    console.log(`[BatchVideoAnalysis] 无视频素材需要分析`, { taskId });
    return [];
  }

  const isQuickMode = options.mode.type === 'quick';

  console.log(`[BatchVideoAnalysis] 开始批量视频分析`, {
    taskId,
    totalVideos: videoMaterials.length,
    mode: options.mode.type,
    frameInterval: options.mode.frameInterval,
    useThumbnails: isQuickMode,
    timestamp: new Date().toISOString()
  });

  const startTime = performance.now();

  // 获取后端配置的并发线程数（默认3）
  const BACKEND_CONCURRENT_THREADS = 3;

  // 设置初始状态：前BACKEND_CONCURRENT_THREADS个为analyzing，其余为waiting
  if (videoAnalysis) {
    console.log(`[BatchVideoAnalysis] 设置视频初始状态`, {
      taskId,
      videosCount: videoMaterials.length,
      analyzingCount: Math.min(BACKEND_CONCURRENT_THREADS, videoMaterials.length),
      waitingCount: Math.max(0, videoMaterials.length - BACKEND_CONCURRENT_THREADS)
    });
    
    const statusUpdates = videoMaterials.map((material, index) => {
      if (index < BACKEND_CONCURRENT_THREADS) {
        // 前N个视频设置为analyzing状态
        return {
          videoUrl: material.url,
          status: 'analyzing' as const
        };
      } else {
        // 其余视频设置为waiting状态，并显示队列位置
        return {
          videoUrl: material.url,
          status: 'waiting' as const,
          queuePosition: index - BACKEND_CONCURRENT_THREADS + 1
        };
      }
    });
    
    videoAnalysis.setBatchAnalysisStatus(statusUpdates);
  }

  try {
    // Convert blob URLs to base64 for quick mode
    const videos = await Promise.all(videoMaterials.map(async (material) => {
      let thumbnailUrl = material.thumbnailUrl || material.url;
      
      // If in quick mode and thumbnail is a blob URL, convert to base64
      if (isQuickMode && thumbnailUrl && thumbnailUrl.startsWith('blob:')) {
        console.log(`[BatchVideoAnalysis] Converting blob thumbnail to base64 for ${material.name}`, {
          taskId,
          materialId: material.id,
          blobUrl: thumbnailUrl
        });
        
        const base64Data = await blobUrlToBase64(thumbnailUrl);
        if (base64Data) {
          thumbnailUrl = base64Data;
          console.log(`[BatchVideoAnalysis] Successfully converted thumbnail to base64`, {
            taskId,
            materialId: material.id,
            materialName: material.name,
            base64Length: base64Data.length,
            base64Preview: base64Data.substring(0, 50) + '...' // 只显示前50个字符
          });
        } else {
          console.warn(`[BatchVideoAnalysis] Failed to convert thumbnail, will use original URL`, {
            taskId,
            materialId: material.id,
            materialName: material.name
          });
        }
      }
      
      return {
        video_url: material.url,
        frame_interval: isQuickMode ? 9999 : (options.mode.frameInterval || 5),
        thumbnail_url: isQuickMode ? thumbnailUrl : undefined
      };
    }));

    // Prepare batch request with appropriate prompt based on mode
    const quickModePrompt = "用一句话简洁描述这个视频画面的主要内容，包括场景和主体。";
    const professionalModePrompt = "请详细描述这张图片中的内容，包括场景、人物、物体、动作、情感等，用于视频剪辑分析。";
    
    const requestBody: BatchVideoAnalysisRequest = {
      videos,
      custom_prompt: isQuickMode ? quickModePrompt : professionalModePrompt,
      use_thumbnails: isQuickMode
    };

    console.log(`[BatchVideoAnalysis] 发送批量分析API请求`, {
      taskId,
      videosCount: requestBody.videos.length,
      videoUrls: requestBody.videos.map(v => v.video_url),
      thumbnailTypes: isQuickMode ? requestBody.videos.map((v, index) => ({
        index: index + 1,
        type: v.thumbnail_url?.startsWith('data:') ? 'base64' : 
              v.thumbnail_url?.startsWith('blob:') ? 'blob' : 
              v.thumbnail_url?.startsWith('http') ? 'url' : 'unknown',
        length: v.thumbnail_url?.startsWith('data:') ? v.thumbnail_url.length : undefined,
        preview: v.thumbnail_url?.startsWith('data:') ? v.thumbnail_url.substring(0, 50) + '...' : v.thumbnail_url
      })) : undefined,
      frameInterval: requestBody.videos[0]?.frame_interval,
      useThumbnails: isQuickMode,
      customPrompt: requestBody.custom_prompt,
      promptType: isQuickMode ? 'quick (简洁描述)' : 'professional (详细描述)',
      timestamp: new Date().toISOString()
    });

    // Create request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VIDEO_ANALYSIS_CONFIG.REQUEST_TIMEOUT_MS);

    const response = await fetch('/api/video/batch-analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseTime = performance.now() - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || errorData.detail || `HTTP error! status: ${response.status}`;
      
      console.error(`[BatchVideoAnalysis] 批量分析API请求失败`, {
        taskId,
        status: response.status,
        statusText: response.statusText,
        errorMessage,
        responseTime,
        timestamp: new Date().toISOString()
      });

      throw new Error(errorMessage);
    }

    const batchResult: BatchVideoAnalysisResponse = await response.json();
    
    console.log(`[BatchVideoAnalysis] 批量分析API请求成功`, {
      taskId,
      success: batchResult.success,
      totalVideos: batchResult.total_videos,
      successfulVideos: batchResult.successful_videos,
      failedVideos: batchResult.failed_videos,
      totalFramesExtracted: batchResult.total_frames_extracted,
      totalProcessingTime: batchResult.total_processing_time,
      frameExtractionTime: batchResult.frame_extraction_time,
      vlmAnalysisTime: batchResult.vlm_analysis_time,
      concurrentThreads: batchResult.concurrent_threads,
      responseTime,
      timestamp: new Date().toISOString()
    });

    // Convert batch results to VideoAnalysisResult format and update status
    const results: VideoAnalysisResult[] = videoMaterials.map(material => {
      const batchVideoResult = batchResult.results.find(r => r.video_url === material.url);
      
      if (!batchVideoResult) {
        console.warn(`[BatchVideoAnalysis] 未找到视频的分析结果: ${material.name}`, {
          taskId,
          videoId: material.id,
          videoUrl: material.url,
          timestamp: new Date().toISOString()
        });
        
        // 更新状态为error
        if (videoAnalysis) {
          videoAnalysis.setAnalysisStatus(material.url, 'error', undefined, 'Result not found in batch response');
        }
        
        return {
          success: false,
          video_url: material.url,
          material,
          error: 'Result not found in batch response',
          attempts: 1
        };
      }

      if (!batchVideoResult.success) {
        console.warn(`[BatchVideoAnalysis] 视频分析失败: ${material.name}`, {
          taskId,
          videoId: material.id,
          errorMessage: batchVideoResult.error_message,
          timestamp: new Date().toISOString()
        });

        // 更新状态为error
        if (videoAnalysis) {
          videoAnalysis.setAnalysisStatus(material.url, 'error', undefined, batchVideoResult.error_message || 'Unknown error');
        }

        return {
          success: false,
          video_url: material.url,
          material,
          error: batchVideoResult.error_message || 'Unknown error',
          attempts: 1
        };
      }

      console.log(`[BatchVideoAnalysis] 视频分析成功: ${material.name}`, {
        taskId,
        videoId: material.id,
        framesAnalyzed: batchVideoResult.total_frames_extracted,
        videoDuration: batchVideoResult.video_duration,
        timestamp: new Date().toISOString()
      });

      // 构建VideoAnalysisResponse对象
      const analysisResponse: any = {
        success: true,
        video_url: material.url,
        total_frames_extracted: batchVideoResult.total_frames_extracted,
        video_duration: batchVideoResult.video_duration,
        frame_analyses: batchVideoResult.frame_analyses || [],
        processing_time: batchResult.total_processing_time / videoMaterials.length, // 平均时间
        message: 'Video analysis completed successfully',
        timestamp: new Date().toISOString()
      };

      // 更新状态为completed
      if (videoAnalysis) {
        videoAnalysis.setAnalysisStatus(material.url, 'completed', analysisResponse);
      }

      return {
        success: true,
        video_url: material.url,
        material,
        attempts: 1
      };
    });

    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    console.log(`[BatchVideoAnalysis] 批量视频分析完成`, {
      taskId,
      totalVideos: videoMaterials.length,
      successCount: successfulResults.length,
      failedCount: failedResults.length,
      successRate: `${Math.round((successfulResults.length / videoMaterials.length) * 100)}%`,
      totalProcessingTime: Math.round(responseTime),
      frameExtractionTime: Math.round(batchResult.frame_extraction_time * 1000),
      vlmAnalysisTime: Math.round(batchResult.vlm_analysis_time * 1000),
      concurrentThreads: batchResult.concurrent_threads,
      speedupInfo: `Extracted ${batchResult.total_frames_extracted} frames and analyzed concurrently`,
      timestamp: new Date().toISOString()
    });

    // Log failed analyses
    if (failedResults.length > 0) {
      console.warn(`[BatchVideoAnalysis] 失败的视频分析详情`, {
        taskId,
        failedVideos: failedResults.map(r => ({
          name: r.material.name,
          id: r.material.id,
          error: r.error
        })),
        timestamp: new Date().toISOString()
      });
    }

    return results;

  } catch (error) {
    const totalTime = performance.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[BatchVideoAnalysis] 批量分析异常`, {
      taskId,
      error: errorMessage,
      isAbortError: error instanceof Error && error.name === 'AbortError',
      isNetworkError: errorMessage.includes('fetch'),
      totalTime: Math.round(totalTime),
      timestamp: new Date().toISOString()
    });

    // 更新所有视频的状态为error
    if (videoAnalysis) {
      console.log(`[BatchVideoAnalysis] 设置所有视频状态为error`, {
        taskId,
        videosCount: videoMaterials.length,
        error: errorMessage
      });
      
      videoAnalysis.setBatchAnalysisStatus(
        videoMaterials.map(material => ({
          videoUrl: material.url,
          status: 'error',
          error: errorMessage
        }))
      );
    }

    // Return failed results for all videos
    return videoMaterials.map(material => ({
      success: false,
      video_url: material.url,
      material,
      error: errorMessage,
      attempts: 1
    }));
  }
} 