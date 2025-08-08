import { VideoEditingLogger } from '../utils';

/**
 * AI Service Interface
 * 处理AI助手相关的API调用和流式响应处理
 */
export interface AIService {
  sendMessage(params: {
    message: string;
    currentContent: string;
    taskId: string;
  }): Promise<ReadableStream>;
  
  processStreamResponse(
    stream: ReadableStream,
    onChunk: (content: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void
  ): Promise<void>;
}

/**
 * AI Service Parameters
 */
export interface AIServiceParams {
  message: string;
  currentContent: string;
  taskId: string;
}

/**
 * AI Service Response
 */
export interface AIServiceResponse {
  success: boolean;
  stream?: ReadableStream;
  error?: string;
}

/**
 * AI Service Implementation
 * 实现AI助手服务的具体逻辑
 */
export class AIServiceImpl implements AIService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'AIService'
    });
  }

  /**
   * 发送消息到AI助手API
   * @param params - 请求参数
   * @returns Promise<ReadableStream> - 流式响应
   */
  async sendMessage(params: AIServiceParams): Promise<ReadableStream> {
    const { message, currentContent, taskId } = params;
    
    // 参数验证
    if (!message.trim()) {
      const error = new Error('Message cannot be empty');
      this.logger.error('AI消息发送失败', error, { reason: 'empty_message' });
      throw error;
    }

    const startTime = performance.now();
    this.logger.apiCall('发送AI助手消息', '/api/video-editing-chat', {
      messageLength: message.length,
      currentContentLength: currentContent.length,
      taskId
    });

    try {
      const response = await fetch('/api/video-editing-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message.trim(),
          currentContent: currentContent,
          taskId: taskId,
        }),
      });

      if (!response.ok) {
        const error = new Error(`HTTP error! status: ${response.status}`);
        this.logger.apiError('AI助手请求', '/api/video-editing-chat', error, {
          responseTime: performance.now() - startTime,
          status: response.status,
          statusText: response.statusText
        });
        throw error;
      }

      if (!response.body) {
        const error = new Error('No response body available');
        this.logger.error('AI助手响应错误', error, { 
          responseHeaders: Object.fromEntries(response.headers.entries())
        });
        throw error;
      }

      this.logger.info('AI助手API响应成功', {
        responseStatus: response.status,
        responseHeaders: {
          contentType: response.headers.get('content-type'),
          contentLength: response.headers.get('content-length')
        },
        responseTime: performance.now() - startTime
      });

      return response.body;

    } catch (error) {
      const endTime = performance.now();
      this.logger.apiError('AI助手请求', '/api/video-editing-chat', error as Error, {
        responseTime: endTime - startTime,
        messageLength: message.length,
        taskId
      });
      throw error;
    }
  }

  /**
   * 处理流式响应
   * @param stream - 响应流
   * @param onChunk - 处理每个数据块的回调
   * @param onComplete - 完成时的回调
   * @param onError - 错误时的回调
   */
  async processStreamResponse(
    stream: ReadableStream,
    onChunk: (content: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void
  ): Promise<void> {
    const startTime = performance.now();
    this.logger.info('开始处理AI助手流式响应');

    try {
      const reader = stream.getReader();
      let accumulatedContent = '';
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunkCount++;
        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              this.logger.info('AI助手响应流完成', {
                totalResponseLength: accumulatedContent.length,
                totalChunks: chunkCount,
                responseTime: performance.now() - startTime,
                averageChunkSize: accumulatedContent.length / chunkCount
              });
              onComplete();
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulatedContent += parsed.content;
                onChunk(parsed.content);
                
                // 定期记录流式更新进度
                if (accumulatedContent.length % 100 === 0) {
                  this.logger.debug('AI流式响应进度', {
                    accumulatedLength: accumulatedContent.length,
                    chunkCount,
                    averageChunkSize: accumulatedContent.length / chunkCount,
                    responseSpeed: accumulatedContent.length / ((performance.now() - startTime) / 1000)
                  });
                }
              }
            } catch (parseError) {
              this.logger.error('解析AI响应数据错误', parseError as Error, {
                rawData: data,
                lineContent: line,
                accumulatedLength: accumulatedContent.length
              });
              // 继续处理其他数据块，不中断整个流程
            }
          }
        }
      }

      // 如果循环正常结束但没有收到[DONE]信号
      this.logger.info('AI助手响应流结束', {
        totalResponseLength: accumulatedContent.length,
        totalChunks: chunkCount,
        responseTime: performance.now() - startTime
      });
      onComplete();

    } catch (error) {
      const endTime = performance.now();
      this.logger.error('处理AI助手流式响应错误', error as Error, {
        responseTime: endTime - startTime,
        streamProcessingFailed: true
      });
      onError(error as Error);
    }
  }
}

/**
 * 创建AI服务实例的工厂函数
 * @param taskId - 任务ID
 * @returns AIService实例
 */
export const createAIService = (taskId: string): AIService => {
  return new AIServiceImpl(taskId);
}; 