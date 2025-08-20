/**
 * Video AI Match Service
 * 视频AI匹配服务
 */

import { VideoEditingLogger } from '../utils/logger';
import { MaterialItem } from '@/types';
import { VideoAnalysisResponse } from './videoAnalysisService';

// 视频分析结果接口（用于API调用）
export interface VideoAnalysisResult {
  videoUrl: string;
  videoName: string;
  materialId: string;
  frameAnalyses: Array<{
    frame_number: number;
    timestamp: number;
    analysis: string;
  }>;
  videoDuration: number;
  totalFrames: number;
}

// 匹配结果接口
export interface VideoMatchResult {
  materialId: string;
  videoUrl: string;
  videoName: string;
  matchScore: number;
  matchReason: string;
}

// 请求接口
export interface VideoAIMatchRequest {
  scriptText: string;
  videoAnalysisResults: VideoAnalysisResult[];
  taskId: string;
  segmentDuration?: number; // 段落语音时长（秒）
}

// 响应接口
export interface VideoAIMatchResponse {
  success: boolean;
  message: string;
  matches: VideoMatchResult[];
  totalAnalyzed: number;
  processingTime: number;
}

// 服务参数接口
export interface VideoAIMatchServiceParams {
  scriptText: string;
  materials: MaterialItem[];
  getVideoAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null;
  taskId: string;
  segmentDuration?: number; // 段落语音时长（秒）
}

export interface VideoAIMatchService {
  matchVideos(params: VideoAIMatchServiceParams): Promise<VideoAIMatchResponse>;
  convertMatchesToMaterials(matches: VideoMatchResult[], materials: MaterialItem[]): MaterialItem[];
}

/**
 * Video AI Match Service Implementation
 * 实现视频AI匹配服务的具体逻辑
 */
export class VideoAIMatchServiceImpl implements VideoAIMatchService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'VideoAIMatchService'
    });
  }

  /**
   * 匹配视频
   * @param params - 请求参数
   * @returns Promise<VideoAIMatchResponse> - 匹配结果
   */
  async matchVideos(params: VideoAIMatchServiceParams): Promise<VideoAIMatchResponse> {
    const { scriptText, materials, getVideoAnalysisResult, taskId, segmentDuration } = params;
    
    // 参数验证
    if (!scriptText.trim()) {
      const error = new Error('Script text cannot be empty');
      this.logger.error('视频AI匹配失败', error, { reason: 'empty_script_text' });
      throw error;
    }

    if (!materials || materials.length === 0) {
      const error = new Error('No materials provided');
      this.logger.error('视频AI匹配失败', error, { reason: 'no_materials' });
      throw error;
    }

    const startTime = performance.now();
    
    // 筛选出已完成AI解析的视频素材
    const analyzedVideoMaterials = materials
      .filter(material => material.type === 'video' && material.url)
      .map(material => {
        const analysisResult = getVideoAnalysisResult(material.url!);
        return { material, analysisResult };
      })
      .filter(({ analysisResult }) => 
        analysisResult && 
        analysisResult.success && 
        analysisResult.frame_analyses && 
        analysisResult.frame_analyses.length > 0
      );

    if (analyzedVideoMaterials.length === 0) {
      this.logger.warn('没有找到已完成AI解析的视频素材', {
        totalMaterials: materials.length,
        videoMaterials: materials.filter(m => m.type === 'video').length
      });
      
      return {
        success: true,
        message: 'No analyzed video materials found',
        matches: [],
        totalAnalyzed: 0,
        processingTime: performance.now() - startTime
      };
    }

    // 转换为API所需的格式
    const videoAnalysisResults: VideoAnalysisResult[] = analyzedVideoMaterials.map(({ material, analysisResult }) => ({
      videoUrl: material.url!,
      videoName: material.name,
      materialId: material.id,
      frameAnalyses: analysisResult!.frame_analyses.map(frame => ({
        frame_number: frame.frame_number,
        timestamp: frame.timestamp,
        analysis: frame.analysis
      })),
      videoDuration: analysisResult!.video_duration,
      totalFrames: analysisResult!.total_frames_extracted
    }));

    this.logger.info('开始视频AI匹配', {
      scriptTextLength: scriptText.length,
      scriptPreview: scriptText.substring(0, 100),
      analyzedVideoCount: videoAnalysisResults.length,
      segmentDuration: segmentDuration,
      videoDetails: videoAnalysisResults.map(v => ({
        materialId: v.materialId,
        videoName: v.videoName,
        frameCount: v.frameAnalyses.length,
        duration: v.videoDuration
      }))
    });

    this.logger.apiCall('发送视频AI匹配请求', '/api/video-ai-match', {
      scriptTextLength: scriptText.length,
      videoCount: videoAnalysisResults.length,
      segmentDuration: segmentDuration,
      taskId
    });

    try {
      const requestBody: VideoAIMatchRequest = {
        scriptText: scriptText.trim(),
        videoAnalysisResults,
        taskId,
        segmentDuration
      };

      const response = await fetch('/api/video-ai-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch (parseError) {
          this.logger.error('解析错误响应失败', parseError as Error, {
            status: response.status,
            statusText: response.statusText
          });
        }

        const error = new Error(errorMessage);
        this.logger.apiError('视频AI匹配请求', '/api/video-ai-match', error, {
          responseTime: performance.now() - startTime,
          status: response.status,
          statusText: response.statusText,
          scriptTextLength: scriptText.length,
          videoCount: videoAnalysisResults.length
        });
        throw error;
      }

      const data: VideoAIMatchResponse = await response.json();
      const responseTime = performance.now() - startTime;

      // 验证响应格式
      if (typeof data.success !== 'boolean') {
        const error = 'Invalid response format: missing success field';
        this.logger.error('视频AI匹配响应格式错误', new Error(error), {
          responseData: data,
          expectedFields: ['success', 'matches', 'totalAnalyzed']
        });
        throw new Error(error);
      }

      this.logger.info('视频AI匹配API响应成功', {
        success: data.success,
        matchCount: data.matches?.length || 0,
        totalAnalyzed: data.totalAnalyzed,
        processingTime: data.processingTime,
        responseTime,
        matches: data.matches?.map(match => ({
          materialId: match.materialId,
          videoName: match.videoName,
          matchScore: match.matchScore,
          matchReason: match.matchReason.substring(0, 100) + '...'
        }))
      });

      return data;

    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error('视频AI匹配请求失败', error as Error, {
        responseTime,
        scriptTextLength: scriptText.length,
        videoCount: videoAnalysisResults.length,
        taskId
      });
      throw error;
    }
  }

  /**
   * 将匹配结果转换为素材项
   * @param matches - 匹配结果
   * @param materials - 原始素材列表
   * @returns MaterialItem[] - 匹配的素材项数组
   */
  convertMatchesToMaterials(matches: VideoMatchResult[], materials: MaterialItem[]): MaterialItem[] {
    this.logger.info('开始转换匹配结果为素材项', { 
      matchCount: matches.length,
      materialCount: materials.length
    });

    const matchedMaterials: MaterialItem[] = [];
    
    for (const match of matches) {
      const material = materials.find(m => m.id === match.materialId);
      if (material) {
        // 创建副本并添加匹配信息
        const matchedMaterial: MaterialItem = {
          ...material,
          // 在描述中添加匹配信息
          description: `${material.description || ''}\n\n🤖 AI匹配 (评分: ${(match.matchScore * 100).toFixed(0)}%): ${match.matchReason}`.trim(),
          // 在标签中添加匹配标记
          tags: [...(material.tags || []), `AI匹配-${(match.matchScore * 100).toFixed(0)}%`]
        };
        
        matchedMaterials.push(matchedMaterial);
        
        this.logger.debug('匹配结果转换完成', {
          originalMaterial: {
            id: material.id,
            name: material.name
          },
          matchInfo: {
            score: match.matchScore,
            reason: match.matchReason.substring(0, 50) + '...'
          }
        });
      } else {
        this.logger.warn('找不到匹配的素材', {
          materialId: match.materialId,
          videoName: match.videoName
        });
      }
    }

    this.logger.info('匹配结果转换为素材项完成', {
      inputMatchCount: matches.length,
      outputMaterialCount: matchedMaterials.length,
      skippedCount: matches.length - matchedMaterials.length
    });

    return matchedMaterials;
  }
}

/**
 * 创建视频AI匹配服务实例
 * @param taskId - 任务ID
 * @returns VideoAIMatchService实例
 */
export const createVideoAIMatchService = (taskId: string): VideoAIMatchService => {
  return new VideoAIMatchServiceImpl(taskId);
}; 