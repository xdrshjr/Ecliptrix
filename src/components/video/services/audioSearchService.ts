/**
 * Audio Search Service
 * 处理音频搜索相关的API调用
 */

import { AudioSearchResponse } from '../types';
import { VideoEditingLogger } from '../utils';

export interface AudioSearchService {
  searchAudios: (params: {
    query: string;
    maxAudios: number;
    durationMin?: number;
    durationMax?: number;
    audioType?: string;
  }) => Promise<AudioSearchResponse>;
}

export class AudioSearchServiceImpl implements AudioSearchService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'AudioSearchService'
    });
  }

  async searchAudios(params: {
    query: string;
    maxAudios: number;
    durationMin?: number;
    durationMax?: number;
    audioType?: string;
  }): Promise<AudioSearchResponse> {
    const { query, maxAudios, durationMin, durationMax, audioType = 'all' } = params;
    const startTime = performance.now();

    this.logger.info('开始音频搜索', {
      query,
      maxAudios,
      durationMin,
      durationMax,
      audioType,
      searchType: 'freesound_api'
    });

    try {
      // 验证搜索参数
      if (!query.trim()) {
        const error = new Error('搜索查询不能为空');
        this.logger.error('音频搜索参数验证失败', error, {
          query,
          queryLength: query.length
        });

        return {
          success: false,
          message: '请输入搜索关键词',
          audios: [],
          total_found: 0,
          query
        };
      }

      if (maxAudios < 1 || maxAudios > 50) {
        const error = new Error('最大音频数量必须在1-50之间');
        this.logger.error('音频搜索参数验证失败', error, {
          maxAudios,
          validRange: '1-50'
        });

        return {
          success: false,
          message: '最大音频数量必须在1-50之间',
          audios: [],
          total_found: 0,
          query
        };
      }

      // 验证时长范围
      if (durationMin !== undefined && durationMax !== undefined && durationMin >= durationMax) {
        const error = new Error('最小时长必须小于最大时长');
        this.logger.error('音频搜索参数验证失败', error, {
          durationMin,
          durationMax
        });

        return {
          success: false,
          message: '最小时长必须小于最大时长',
          audios: [],
          total_found: 0,
          query
        };
      }

      this.logger.info('开始执行音频搜索API调用', {
        query: query.trim(),
        maxAudios,
        durationMin,
        durationMax,
        audioType,
        endpoint: '/api/audio-search'
      });

      const searchStartTime = performance.now();
      const response = await fetch('/api/audio-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          max_audios: maxAudios,
          duration_min: durationMin,
          duration_max: durationMax,
          audio_type: audioType,
        }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (parseError) {
          this.logger.error('解析错误响应失败', parseError as Error, {
            status: response.status,
            statusText: response.statusText
          });
        }

        const error = new Error(errorMessage);
        this.logger.apiError('音频搜索请求', '/api/audio-search', error, {
          responseTime: performance.now() - startTime,
          status: response.status,
          statusText: response.statusText,
          query: query.trim()
        });

        return {
          success: false,
          message: errorMessage,
          audios: [],
          total_found: 0,
          query
        };
      }

      const data = await response.json();
      const searchEndTime = performance.now();

      // 验证响应格式
      if (typeof data.success !== 'boolean') {
        const error = new Error('Invalid response format: missing success field');
        this.logger.error('音频搜索响应格式错误', error, {
          responseData: data,
          expectedFields: ['success', 'audios', 'total_found']
        });

        return {
          success: false,
          message: 'Invalid response format',
          audios: [],
          total_found: 0,
          query
        };
      }

      const totalTime = performance.now() - startTime;
      const searchTime = searchEndTime - searchStartTime;

      if (data.success && data.audios) {
        this.logger.info('音频搜索成功完成', {
          totalFound: data.total_found,
          audiosReturned: data.audios.length,
          totalTime: totalTime.toFixed(2),
          searchTime: searchTime.toFixed(2),
          query: query.trim(),
          avgTimePerAudio: data.audios.length > 0 ? (searchTime / data.audios.length).toFixed(2) : 0
        });

        // 记录音频详细信息
        data.audios.forEach((audio: any, index: number) => {
          this.logger.debug(`音频 ${index + 1}`, {
            id: audio.id,
            name: audio.name,
            duration: audio.duration,
            username: audio.username,
            license: audio.license,
            tags: audio.tags?.slice(0, 3), // 只记录前3个标签
            filesize: audio.filesize,
            type: audio.type
          });
        });

        return {
          success: true,
          message: data.message || `找到 ${data.audios.length} 个音频文件`,
          audios: data.audios,
          total_found: data.total_found,
          query
        };
      } else {
        this.logger.warn('音频搜索无结果', {
          totalTime: totalTime.toFixed(2),
          message: data.message,
          query: query.trim()
        });

        return {
          success: false,
          message: data.message || '搜索失败，请稍后重试',
          audios: [],
          total_found: 0,
          query
        };
      }

    } catch (error) {
      const totalTime = performance.now() - startTime;
      this.logger.error('音频搜索异常', error as Error, {
        totalTime: totalTime.toFixed(2),
        query: query.trim(),
        errorType: (error as Error).constructor.name
      });

      return {
        success: false,
        message: '搜索失败，请检查网络连接',
        audios: [],
        total_found: 0,
        query
      };
    }
  }
}

/**
 * 创建音频搜索服务实例
 * 
 * @param taskId - 任务ID，用于日志记录
 * @returns AudioSearchService 实例
 */
export const createAudioSearchService = (taskId: string): AudioSearchService => {
  return new AudioSearchServiceImpl(taskId);
}; 