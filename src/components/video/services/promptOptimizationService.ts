import { VideoEditingLogger } from '../utils';

interface OptimizePromptsRequest {
  positivePrompt: string;
  negativePrompt?: string;
}

interface OptimizedPrompts {
  positivePrompt: string;
  negativePrompt: string;
}

interface OptimizePromptsResponse {
  success: boolean;
  data?: OptimizedPrompts;
  warning?: string;
  error?: string;
}

export class PromptOptimizationService {
  private logger: VideoEditingLogger;

  constructor(taskId?: string) {
    this.logger = new VideoEditingLogger({
      taskId: taskId || 'prompt-optimization',
      component: 'PromptOptimizationService'
    });
  }

  async optimizePrompts(request: OptimizePromptsRequest): Promise<OptimizedPrompts> {
    const { positivePrompt, negativePrompt = '' } = request;

    this.logger.info('开始提示词优化', {
      positivePromptLength: positivePrompt.length,
      negativePromptLength: negativePrompt.length,
      hasNegativePrompt: !!negativePrompt.trim()
    });

    if (!positivePrompt || positivePrompt.trim().length === 0) {
      const error = new Error('正向提示词不能为空');
      this.logger.error('提示词优化失败：正向提示词为空', error);
      throw error;
    }

    try {
      const startTime = Date.now();

      this.logger.info('发送提示词优化请求', {
        endpoint: '/api/prompt-optimization',
        positivePromptPreview: positivePrompt.slice(0, 100) + (positivePrompt.length > 100 ? '...' : ''),
        requestTime: new Date().toISOString()
      });

      const response = await fetch('/api/prompt-optimization', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          positivePrompt: positivePrompt.trim(),
          negativePrompt: negativePrompt.trim()
        }),
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = await response.text() || errorMessage;
        }

        this.logger.error('提示词优化API请求失败', new Error(errorMessage), {
          status: response.status,
          duration,
          endpoint: '/api/prompt-optimization'
        });

        throw new Error(`提示词优化失败: ${errorMessage}`);
      }

      const result: OptimizePromptsResponse = await response.json();

      this.logger.info('提示词优化API响应', {
        success: result.success,
        hasData: !!result.data,
        warning: result.warning,
        duration,
        responseTime: new Date().toISOString()
      });

      if (!result.success || !result.data) {
        const error = result.error || '未知错误';
        this.logger.error('提示词优化失败', new Error(error), {
          apiError: error,
          duration
        });
        throw new Error(`提示词优化失败: ${error}`);
      }

      const { data: optimizedPrompts, warning } = result;

      this.logger.info('提示词优化成功', {
        originalPositiveLength: positivePrompt.length,
        originalNegativeLength: negativePrompt.length,
        optimizedPositiveLength: optimizedPrompts.positivePrompt.length,
        optimizedNegativeLength: optimizedPrompts.negativePrompt.length,
        hasWarning: !!warning,
        warning,
        duration,
        improvementRatio: {
          positive: (optimizedPrompts.positivePrompt.length / positivePrompt.length).toFixed(2),
          negative: negativePrompt ? (optimizedPrompts.negativePrompt.length / negativePrompt.length).toFixed(2) : 'N/A'
        }
      });

      // 如果有警告，记录到日志
      if (warning) {
        this.logger.warn('提示词优化完成但有警告', {
          warning,
          fallbackUsed: warning.includes('fallback')
        });
      }

      return optimizedPrompts;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.logger.error('提示词优化过程异常', error as Error, {
        originalRequest: {
          positivePromptLength: positivePrompt.length,
          negativePromptLength: negativePrompt.length
        },
        errorType: error instanceof TypeError ? 'Network' : 'Unknown'
      });

      // 重新抛出错误，保持原始错误信息
      throw new Error(errorMessage);
    }
  }

  // 验证优化后的提示词
  validateOptimizedPrompts(optimizedPrompts: OptimizedPrompts): boolean {
    const { positivePrompt, negativePrompt } = optimizedPrompts;

    // 基本验证
    if (!positivePrompt || typeof positivePrompt !== 'string' || positivePrompt.trim().length === 0) {
      this.logger.error('优化后的正向提示词验证失败', new Error('正向提示词无效'));
      return false;
    }

    if (!negativePrompt || typeof negativePrompt !== 'string') {
      this.logger.error('优化后的反向提示词验证失败', new Error('反向提示词无效'));
      return false;
    }

    // 长度验证
    if (positivePrompt.length > 5000) {
      this.logger.warn('优化后的正向提示词过长', {
        length: positivePrompt.length,
        maxLength: 5000
      });
    }

    if (negativePrompt.length > 2000) {
      this.logger.warn('优化后的反向提示词过长', {
        length: negativePrompt.length,
        maxLength: 2000
      });
    }

    this.logger.info('优化后的提示词验证通过', {
      positiveLength: positivePrompt.length,
      negativeLength: negativePrompt.length
    });

    return true;
  }
}

export default PromptOptimizationService;