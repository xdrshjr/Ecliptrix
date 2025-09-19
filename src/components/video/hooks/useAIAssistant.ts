import { useState, useCallback, useMemo } from 'react';
import { UseAIAssistantReturn } from '../types';
import { VideoEditingLogger } from '../utils';
import { createAIService, AIService } from '../services';
import { useLocale } from '@/contexts/LocaleContext';

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
  // 获取国际化翻译
  const { t } = useLocale();
  const defaultContent = t.defaultContent.documentDefault;

  // 初始化日志器和AI服务
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useAIAssistant'
  }), [taskId]);

  const aiService = useMemo(() => createAIService(taskId), [taskId]);

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

    setIsLoading(true);
    
    try {
      // 使用AI服务发送消息
      const stream = await aiService.sendMessage({
        message: message.trim(),
        currentContent: currentContent,
        taskId: taskId
      });

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
      const updatedContent = originalContent + aiResponsePrefix;
      
      // 立即更新MD编辑器显示前缀
      onContentUpdate(updatedContent);
      
      let accumulatedContent = '';

      // 使用AI服务处理流式响应
      await aiService.processStreamResponse(
        stream,
        (content) => {
          // 处理每个数据块
          accumulatedContent += content;
          const newContent = originalContent + aiResponsePrefix + accumulatedContent;
          onContentUpdate(newContent);
        },
        () => {
          // 响应完成
          logger.info('AI助手响应完成', {
            finalResponseLength: accumulatedContent.length,
            finalContentLength: (originalContent + aiResponsePrefix + accumulatedContent).length
          });
        },
        (error) => {
          // 处理流式响应错误
          logger.error('AI助手流式响应错误', error);
          const errorMessage = `\n\n## AI Assistant Error\n\nSorry, I encountered an error while processing your request. Please try again.\n\nError: ${error.message}\n\n`;
          const errorContent = originalContent + aiResponsePrefix + errorMessage;
          onContentUpdate(errorContent);
        }
      );
      
    } catch (error) {
      logger.error('AI助手请求失败', error as Error, {
        messageLength: message.length
      });
      
      // 错误时显示错误信息
      const errorMessage = `\n\n## AI Assistant Error\n\nSorry, I encountered an error while processing your request. Please try again.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`;
      const errorContent = currentContent + errorMessage;
      onContentUpdate(errorContent);
      
    } finally {
      setIsLoading(false);
    }
  }, [taskId, currentContent, onContentUpdate, isLoading, logger, aiService]);

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