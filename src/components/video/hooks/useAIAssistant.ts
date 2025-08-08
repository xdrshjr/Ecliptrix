import { useState, useCallback, useMemo } from 'react';
import { UseAIAssistantReturn } from '../types';
import { VideoEditingLogger } from '../utils';

/**
 * useAIAssistant Hook
 * 管理 AI 助手交互
 * 
 * @param taskId - 任务ID，用于日志记录
 * @param currentContent - 当前文档内容
 * @param onContentUpdate - 内容更新回调
 * @returns AI助手相关的状态和方法
 */
export const useAIAssistant = (
  taskId: string,
  currentContent: string,
  onContentUpdate: (content: string) => void
): UseAIAssistantReturn => {
  const defaultContent = '# Video Editing Project\n\nStart editing your video project documentation here...\n\n## Notes\n- Add your project notes\n- Document your editing workflow\n- Track your progress\n\n## Resources\n- List your video assets\n- Note important timestamps\n- Reference materials';

  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useAIAssistant'
  }), [taskId]);

  // AI助手状态
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 处理AI助手消息发送
  const handleSendMessage = useCallback(async (message: string) => {
    if (!message.trim() || isLoading) {
      logger.warn('消息发送被跳过', {
        reason: !message.trim() ? 'empty_message' : 'already_loading',
        messageLength: message.length,
        isLoading
      });
      return;
    }

    const startTime = performance.now();
    logger.apiCall('发送AI助手消息', '/api/video-editing-chat', {
      messageLength: message.length,
      currentContentLength: currentContent.length
    });

    setIsLoading(true);
    
    try {
      // 调用视频编辑聊天API
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
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      logger.info('开始接收AI助手流式响应', {
        responseStatus: response.status,
        responseHeaders: {
          contentType: response.headers.get('content-type'),
          contentLength: response.headers.get('content-length')
        }
      });

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedContent = '';
      let originalContent = currentContent;
      
      // 如果当前内容是默认placeholder内容，则清除它
      if (originalContent === defaultContent) {
        logger.info('清除默认placeholder内容', {
          defaultContentLength: defaultContent.length
        });
        originalContent = '';
      }
      
      // 在原内容末尾添加AI回复的分隔符
      const aiResponsePrefix = originalContent ? `\n\n## AI Assistant Response\n\n` : `## AI Assistant Response\n\n`;
      let updatedContent = originalContent + aiResponsePrefix;
      
      // 立即更新MD编辑器显示前缀
      onContentUpdate(updatedContent);
      
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
              logger.info('AI助手响应完成', {
                totalResponseLength: accumulatedContent.length,
                totalChunks: chunkCount,
                responseTime: performance.now() - startTime
              });
              break;
            }
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulatedContent += parsed.content;
                
                // 实时更新MD编辑器内容
                const newContent = originalContent + aiResponsePrefix + accumulatedContent;
                onContentUpdate(newContent);
                
                // 定期记录流式更新进度
                if (accumulatedContent.length % 50 === 0) {
                  logger.debug('AI流式响应进度', {
                    accumulatedLength: accumulatedContent.length,
                    chunkCount,
                    averageChunkSize: accumulatedContent.length / chunkCount
                  });
                }
              }
            } catch (e) {
              logger.error('解析AI响应数据错误', e as Error, {
                rawData: data,
                lineContent: line
              });
            }
          }
        }
      }

      const endTime = performance.now();
      logger.apiComplete('AI助手对话', '/api/video-editing-chat', true, endTime - startTime, {
        finalResponseLength: accumulatedContent.length,
        finalContentLength: (originalContent + aiResponsePrefix + accumulatedContent).length,
        totalChunks: chunkCount,
        averageResponseSpeed: accumulatedContent.length / ((endTime - startTime) / 1000) // 字符/秒
      });
      
    } catch (error) {
      const endTime = performance.now();
      logger.apiError('AI助手请求', '/api/video-editing-chat', error as Error, {
        responseTime: endTime - startTime,
        messageLength: message.length
      });
      
      // 错误时显示错误信息
      const errorMessage = `\n\n## AI Assistant Error\n\nSorry, I encountered an error while processing your request. Please try again.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`;
      const errorContent = currentContent + errorMessage;
      onContentUpdate(errorContent);
      
    } finally {
      setIsLoading(false);
    }
  }, [taskId, currentContent, onContentUpdate, isLoading, logger]);

  // 处理表单提交
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isLoading) {
      logger.userAction('提交AI助手消息', 'submitForm', {
        messageLength: inputMessage.trim().length,
        currentContentLength: currentContent.length
      });
      
      handleSendMessage(inputMessage.trim());
      setInputMessage('');
    }
  }, [inputMessage, isLoading, handleSendMessage, currentContent.length, logger]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      
      logger.userAction('键盘快捷键', 'enterKey', {
        action: 'submit_message',
        messageLength: inputMessage.length,
        hasShiftKey: e.shiftKey
      });
      
      handleSubmit(e);
    }
  }, [handleSubmit, inputMessage.length, logger]);

  return {
    inputMessage,
    setInputMessage,
    isLoading,
    handleSendMessage,
    handleSubmit,
    handleKeyDown
  };
}; 