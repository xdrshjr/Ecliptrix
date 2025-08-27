/**
 * ComfyUI Health Check Service
 * 处理ComfyUI服务健康检查相关的API调用
 */

import { VideoEditingLogger } from '../utils';

export interface ComfyUIHealthStatus {
  status: 'healthy' | 'unhealthy' | 'error';
  comfyui_status: string;
  timestamp: string;
  version?: string;
  error?: string;
}

export interface ComfyUIHealthService {
  checkHealth(): Promise<ComfyUIHealthStatus>;
}

export class ComfyUIHealthServiceImpl implements ComfyUIHealthService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'ComfyUIHealthService'
    });
  }

  async checkHealth(): Promise<ComfyUIHealthStatus> {
    this.logger.info('发起ComfyUI健康检查请求');

    try {
      const response = await fetch('/api/comfyui-health-check', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // 设置较短的超时时间以快速检测服务状态
        signal: AbortSignal.timeout(5000), // 5秒超时
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = errorData.message || `HTTP ${response.status}`;
        
        this.logger.error('ComfyUI健康检查请求失败', new Error(errorMessage), {
          status: response.status,
          errorData
        });
        
        return {
          status: 'unhealthy',
          comfyui_status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: errorMessage
        };
      }

      const result: ComfyUIHealthStatus = await response.json();
      
      this.logger.info('ComfyUI健康检查完成', {
        status: result.status,
        comfyui_status: result.comfyui_status,
        version: result.version
      });

      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        this.logger.error('ComfyUI健康检查超时', error);
        return {
          status: 'error',
          comfyui_status: 'timeout',
          timestamp: new Date().toISOString(),
          error: '服务检查超时'
        };
      }
      
      this.logger.error('ComfyUI健康检查异常', error as Error);
      return {
        status: 'error',
        comfyui_status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }
}

export const createComfyUIHealthService = (taskId: string): ComfyUIHealthService => {
  return new ComfyUIHealthServiceImpl(taskId);
}; 