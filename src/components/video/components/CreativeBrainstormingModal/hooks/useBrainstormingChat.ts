'use client';

import { useState, useCallback } from 'react';
import { ChatMessage, CreativeBrainstormingConfig } from '../types';
import { getExpertsByIds } from '../data/expertProfiles';
import { VideoEditingLogger } from '../../../utils/logger';
import { Translations } from '@/lib/i18n';

export const useBrainstormingChat = (
  taskId: string, 
  config: CreativeBrainstormingConfig,
  currentContent: string,
  translations: Translations['creativeBrainstormingModal']
) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [finalSummary, setFinalSummary] = useState<string>('');

  const logger = new VideoEditingLogger({
    taskId,
    component: 'useBrainstormingChat'
  });

  // 生成消息ID
  const generateMessageId = () => `msg_${new Date().getTime()}_${Math.random().toString(36).substr(2, 9)}`;

  // 添加消息
  const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      ...message,
      id: generateMessageId(),
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
    return newMessage;
  }, []);

  // 更新流式消息
  const updateStreamingMessage = useCallback((messageId: string, content: string, isComplete: boolean = false) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { ...msg, content, isStreaming: !isComplete }
        : msg
    ));
  }, []);

  // 调用创意构思API
  const callBrainstormingAPI = useCallback(async (
    phase: 'discussion' | 'summary',
    userMessage?: string
  ) => {
    try {
      const response = await fetch('/api/creative-brainstorming', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId,
          config,
          currentContent,
          messages: messages.map(msg => ({
            type: msg.type,
            expertId: msg.expertId,
            content: msg.content,
            timestamp: msg.timestamp.toISOString()
          })),
          phase,
          currentRound,
          userMessage
        }),
      });

      if (!response.ok) {
        throw new Error(`API调用失败: ${response.status}`);
      }

      return response;
    } catch (error) {
      logger.error('API调用错误', error as Error, { phase, currentRound });
      throw error;
    }
  }, [taskId, config, currentContent, messages, currentRound, logger]);

  // 处理流式响应
  const handleStreamResponse = useCallback(async (
    response: Response,
    expertId: string
  ) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法获取响应流');

    // 创建初始消息
    const messageId = generateMessageId();
    const initialMessage: ChatMessage = {
      id: messageId,
      type: 'expert',
      expertId,
      content: '',
      timestamp: new Date(),
      isStreaming: true
    };
    setMessages(prev => [...prev, initialMessage]);

    let content = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                content += data.content;
                updateStreamingMessage(messageId, content);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      // 完成流式传输
      updateStreamingMessage(messageId, content, true);
      return content;
    } finally {
      reader.releaseLock();
    }
  }, [updateStreamingMessage]);

  // 开始讨论
  const startDiscussion = useCallback(async () => {
    if (config.creativeExperts.length === 0) return;

    setIsDiscussing(true);
    setCurrentRound(1);

    logger.info('开始第一轮专家讨论', {
      expertsCount: config.creativeExperts.length,
      config
    });

    // 添加主持人开场消息
    addMessage({
      type: 'moderator',
      content: `欢迎各位专家！我们将围绕"${config.creationType.join('、')}"类型的创作进行讨论。让我们开始第一轮思想碰撞吧！`
    });

    try {
      const experts = getExpertsByIds(config.creativeExperts, translations);
      
      // 让每个专家依次发言
      for (const expert of experts) {
        const response = await callBrainstormingAPI('discussion');
        await handleStreamResponse(response, expert.id);
        
        // 短暂延迟，模拟真实对话节奏
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      logger.error('讨论过程中出现错误', error as Error);
      addMessage({
        type: 'moderator',
        content: '讨论过程中出现了一些问题，请稍后重试。'
      });
    } finally {
      setIsDiscussing(false);
    }
  }, [config, addMessage, callBrainstormingAPI, handleStreamResponse, logger]);

  // 继续讨论
  const continueDiscussion = useCallback(async () => {
    if (config.creativeExperts.length === 0 || isDiscussing) return;

    setIsDiscussing(true);
    const nextRound = currentRound + 1;
    setCurrentRound(nextRound);

    logger.info('开始新一轮讨论', { round: nextRound });

    // 添加新一轮开始的消息
    addMessage({
      type: 'moderator',
      content: `第 ${nextRound} 轮讨论开始！让我们在之前讨论的基础上进一步深入。`
    });

    try {
      const experts = getExpertsByIds(config.creativeExperts, translations);
      
      for (const expert of experts) {
        const response = await callBrainstormingAPI('discussion');
        await handleStreamResponse(response, expert.id);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      logger.error('继续讨论时出现错误', error as Error, { round: nextRound });
    } finally {
      setIsDiscussing(false);
    }
  }, [config.creativeExperts, isDiscussing, currentRound, addMessage, callBrainstormingAPI, handleStreamResponse, logger]);

  // 开始总结
  const startSummary = useCallback(async () => {
    if (isSummarizing || messages.length === 0) return;

    setIsSummarizing(true);
    logger.info('开始总结讨论内容', { messagesCount: messages.length });

    // 添加总结开始消息
    addMessage({
      type: 'moderator',
      content: '现在让我为大家总结一下我们的讨论成果，并生成最终的创意文案...'
    });

    try {
      const response = await callBrainstormingAPI('summary');
      
      // 为总结创建特殊的消息处理
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      const messageId = generateMessageId();
      const initialMessage: ChatMessage = {
        id: messageId,
        type: 'moderator',
        content: '',
        timestamp: new Date(),
        isStreaming: true
      };
      setMessages(prev => [...prev, initialMessage]);

      let content = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = new TextDecoder().decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  content += data.content;
                  updateStreamingMessage(messageId, content);
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }

        // 完成流式传输
        updateStreamingMessage(messageId, content, true);
        setFinalSummary(content);
      } finally {
        reader.releaseLock();
      }
      
      logger.info('总结完成', { summaryLength: content.length });
    } catch (error) {
      logger.error('总结过程中出现错误', error as Error);
      addMessage({
        type: 'moderator',
        content: '总结过程中出现了问题，请稍后重试。'
      });
    } finally {
      setIsSummarizing(false);
    }
  }, [isSummarizing, messages.length, addMessage, callBrainstormingAPI, handleStreamResponse, logger]);

  // 发送用户消息
  const sendUserMessage = useCallback((content: string) => {
    logger.info('用户发送消息', { contentLength: content.length });
    
    addMessage({
      type: 'user',
      content
    });
  }, [addMessage, logger]);

  return {
    messages,
    isDiscussing,
    isSummarizing,
    currentRound,
    finalSummary,
    startDiscussion,
    continueDiscussion,
    startSummary,
    sendUserMessage
  };
}; 