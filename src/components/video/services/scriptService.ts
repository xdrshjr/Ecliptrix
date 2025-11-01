import { ScriptSegment, ScriptGenerationConfig, ChatMessage } from '@/types';
import { VideoEditingLogger } from '../utils';

/**
 * Script Service Interface
 * 处理脚本生成相关的API调用和验证
 */
export interface ScriptService {
  generateScript(params: {
    markdownContent: string;
    taskId: string;
  }): Promise<ScriptGenerationResult>;
  
  generateScriptWithConfig(params: {
    markdownContent: string;
    taskId: string;
    config: ScriptGenerationConfig;
    chatMessages?: ChatMessage[];
  }): Promise<ScriptGenerationResult>;
  
  validateScriptSegments(segments: ScriptSegment[]): ValidationResult;
}

/**
 * 脚本生成结果接口
 */
export interface ScriptGenerationResult {
  success: boolean;
  segments?: ScriptSegment[];
  metadata?: {
    segmentCount: number;
    totalSentences: number;
    totalDuration: number;
    averageSegmentDuration: number;
  };
  error?: string;
}

/**
 * 脚本验证结果接口
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  statistics: {
    totalSegments: number;
    totalSentences: number;
    totalDuration: number;
    averageSegmentLength: number;
  };
}

/**
 * Script Service Implementation
 * 实现脚本生成服务的具体逻辑
 */
export class ScriptServiceImpl implements ScriptService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'ScriptService'
    });
  }

  /**
   * 生成脚本
   * @param params - 生成参数
   * @returns Promise<ScriptGenerationResult> - 生成结果
   */
  async generateScript(params: {
    markdownContent: string;
    taskId: string;
  }): Promise<ScriptGenerationResult> {
    const { markdownContent, taskId } = params;

    // 参数验证
    if (!markdownContent.trim()) {
      const error = 'Markdown content cannot be empty';
      this.logger.error('脚本生成参数验证失败', new Error(error), { 
        reason: 'empty_markdown',
        contentLength: markdownContent.length
      });
      return {
        success: false,
        error
      };
    }

    const startTime = performance.now();
    const wordCount = markdownContent.split(/\s+/).length;
    
    this.logger.apiCall('开始生成脚本', '/api/video-script-generation', {
      markdownLength: markdownContent.length,
      wordCount,
      taskId
    });

    try {
      const response = await fetch('/api/video-script-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          markdownContent: markdownContent,
          taskId: taskId,
        }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          this.logger.error('解析错误响应失败', parseError as Error, {
            status: response.status,
            statusText: response.statusText
          });
        }

        const error = new Error(errorMessage);
        this.logger.apiError('脚本生成请求', '/api/video-script-generation', error, {
          responseTime: performance.now() - startTime,
          status: response.status,
          statusText: response.statusText,
          markdownLength: markdownContent.length
        });

        return {
          success: false,
          error: errorMessage
        };
      }

      const result = await response.json();
      const endTime = performance.now();

      // 验证响应格式
      if (!result.success || !result.segments || !Array.isArray(result.segments)) {
        const error = 'Invalid response format from script generation API';
        this.logger.error('脚本生成响应格式错误', new Error(error), {
          responseData: result,
          expectedFormat: { success: 'boolean', segments: 'Array' }
        });

        return {
          success: false,
          error
        };
      }

      // 验证生成的脚本片段
      const validationResult = this.validateScriptSegments(result.segments);
      if (!validationResult.isValid) {
        this.logger.error('生成的脚本片段验证失败', new Error('Script validation failed'), {
          validationErrors: validationResult.errors,
          validationWarnings: validationResult.warnings
        });

        return {
          success: false,
          error: `Script validation failed: ${validationResult.errors.join(', ')}`
        };
      }

      // 计算元数据
      const metadata = {
        segmentCount: result.segments.length,
        totalSentences: result.segments.reduce((sum: number, segment: ScriptSegment) => sum + segment.sentences.length, 0),
        totalDuration: result.segments.reduce((sum: number, segment: ScriptSegment) => sum + (segment.duration || 0), 0),
        averageSegmentDuration: result.segments.reduce((sum: number, segment: ScriptSegment) => sum + (segment.duration || 0), 0) / result.segments.length
      };

      this.logger.apiComplete('脚本生成', '/api/video-script-generation', true, endTime - startTime, {
        ...metadata,
        averageSegmentLength: metadata.totalSentences / metadata.segmentCount,
        wordsPerSecond: wordCount / ((endTime - startTime) / 1000)
      });

      this.logger.info('脚本生成成功', {
        segmentCount: metadata.segmentCount,
        totalSentences: metadata.totalSentences,
        totalDuration: metadata.totalDuration,
        averageSegmentDuration: metadata.averageSegmentDuration,
        validationWarnings: validationResult.warnings
      });

      return {
        success: true,
        segments: result.segments,
        metadata
      };

    } catch (error) {
      const endTime = performance.now();
      this.logger.apiError('脚本生成请求', '/api/video-script-generation', error as Error, {
        responseTime: endTime - startTime,
        markdownLength: markdownContent.length,
        taskId
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 生成脚本（带配置）
   * @param params - 生成参数（包含配置和可选的聊天消息）
   * @returns Promise<ScriptGenerationResult> - 生成结果
   */
  async generateScriptWithConfig(params: {
    markdownContent: string;
    taskId: string;
    config: ScriptGenerationConfig;
    chatMessages?: ChatMessage[];
  }): Promise<ScriptGenerationResult> {
    const { markdownContent, taskId, config, chatMessages } = params;

    // 参数验证 - 优先使用聊天消息，如果没有则使用markdown内容
    const hasChatMessages = chatMessages && chatMessages.length > 0;
    const hasMarkdownContent = markdownContent.trim().length > 0;
    
    if (!hasChatMessages && !hasMarkdownContent) {
      const error = 'Either chat messages or markdown content is required';
      this.logger.error('脚本生成参数验证失败（带配置）', new Error(error), { 
        reason: 'no_content_available',
        hasChatMessages,
        hasMarkdownContent,
        markdownLength: markdownContent.length,
        chatMessageCount: chatMessages?.length || 0,
        config
      });
      return {
        success: false,
        error
      };
    }

    const startTime = performance.now();
    const wordCount = markdownContent.split(/\s+/).length;
    
    this.logger.apiCall('开始生成脚本（带配置）', '/api/video-script-generation', {
      markdownLength: markdownContent.length,
      wordCount,
      taskId,
      config,
      chatMessageCount: chatMessages?.length || 0,
      usesChatMessages: hasChatMessages,
      usesMarkdownContent: !hasChatMessages && hasMarkdownContent
    });

    try {
      const response = await fetch('/api/video-script-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          markdownContent: markdownContent,
          taskId: taskId,
          scriptConfig: config,
          chatMessages: chatMessages, // 新增：传递聊天消息
        }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          this.logger.error('解析错误响应失败（带配置）', parseError as Error, {
            status: response.status,
            statusText: response.statusText
          });
        }

        const error = new Error(errorMessage);
        this.logger.apiError('脚本生成请求（带配置）', '/api/video-script-generation', error, {
          responseTime: performance.now() - startTime,
          status: response.status,
          statusText: response.statusText,
          markdownLength: markdownContent.length,
          config
        });

        return {
          success: false,
          error: errorMessage
        };
      }

      const result = await response.json();
      const endTime = performance.now();

      // 验证响应格式
      if (!result.success || !result.segments || !Array.isArray(result.segments)) {
        const error = 'Invalid response format from script generation API';
        this.logger.error('脚本生成响应格式错误（带配置）', new Error(error), {
          responseData: result,
          expectedFormat: { success: 'boolean', segments: 'Array' },
          config
        });

        return {
          success: false,
          error
        };
      }

      // 验证生成的脚本片段
      const validationResult = this.validateScriptSegments(result.segments);
      if (!validationResult.isValid) {
        this.logger.error('脚本生成结果验证失败（带配置）', new Error('Invalid script segments'), {
          validationErrors: validationResult.errors,
          validationWarnings: validationResult.warnings,
          config
        });
      }

      this.logger.apiComplete('脚本生成成功（带配置）', '/api/video-script-generation', true, endTime - startTime, {
        segmentCount: result.segments.length,
        totalSentences: result.segments.reduce((sum: number, segment: any) => sum + (segment.sentences?.length || 0), 0),
        validationResult: validationResult.isValid ? 'passed' : 'failed',
        validationWarnings: validationResult.warnings.length,
        config
      });

      return {
        success: true,
        segments: result.segments,
        metadata: result.metadata
      };

    } catch (error) {
      const endTime = performance.now();
      this.logger.apiError('脚本生成请求异常（带配置）', '/api/video-script-generation', error as Error, {
        responseTime: endTime - startTime,
        markdownLength: markdownContent.length,
        taskId,
        config
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 验证脚本片段
   * @param segments - 脚本片段数组
   * @returns ValidationResult - 验证结果
   */
  validateScriptSegments(segments: ScriptSegment[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    this.logger.info('开始验证脚本片段', { segmentCount: segments.length });

    // 基本验证
    if (!Array.isArray(segments)) {
      errors.push('Segments must be an array');
    } else if (segments.length === 0) {
      errors.push('Segments array cannot be empty');
    }

    // 详细验证每个片段
    segments.forEach((segment, index) => {
      if (!segment.id) {
        errors.push(`Segment ${index} is missing id`);
      }

      if (!segment.sentences || !Array.isArray(segment.sentences)) {
        errors.push(`Segment ${index} is missing sentences array`);
      } else if (segment.sentences.length === 0) {
        warnings.push(`Segment ${index} has no sentences`);
      }

      if (segment.duration !== undefined && (typeof segment.duration !== 'number' || segment.duration <= 0)) {
        warnings.push(`Segment ${index} has invalid duration: ${segment.duration}`);
      }

      if (!segment.title || segment.title.trim().length === 0) {
        warnings.push(`Segment ${index} has empty title`);
      }

      // 验证句子内容
      if (segment.sentences) {
        segment.sentences.forEach((sentence, sentenceIndex) => {
          if (!sentence.text || sentence.text.trim().length === 0) {
            warnings.push(`Segment ${index}, sentence ${sentenceIndex} has empty text`);
          }
          if (!sentence.id || sentence.id.trim().length === 0) {
            warnings.push(`Segment ${index}, sentence ${sentenceIndex} has empty id`);
          }
        });
      }
    });

    // 计算统计信息
    const statistics = {
      totalSegments: segments.length,
      totalSentences: segments.reduce((sum, segment) => sum + (segment.sentences?.length || 0), 0),
      totalDuration: segments.reduce((sum, segment) => sum + (segment.duration || 0), 0),
      averageSegmentLength: segments.length > 0 
        ? segments.reduce((sum, segment) => sum + (segment.sentences?.length || 0), 0) / segments.length 
        : 0
    };

    const isValid = errors.length === 0;

    this.logger.info('脚本片段验证完成', {
      isValid,
      errorCount: errors.length,
      warningCount: warnings.length,
      statistics
    });

    if (errors.length > 0) {
      this.logger.warn('脚本片段验证发现错误', { errors });
    }

    if (warnings.length > 0) {
      this.logger.warn('脚本片段验证发现警告', { warnings });
    }

    return {
      isValid,
      errors,
      warnings,
      statistics
    };
  }
}

/**
 * 创建脚本服务实例的工厂函数
 * @param taskId - 任务ID
 * @returns ScriptService实例
 */
export const createScriptService = (taskId: string): ScriptService => {
  return new ScriptServiceImpl(taskId);
}; 