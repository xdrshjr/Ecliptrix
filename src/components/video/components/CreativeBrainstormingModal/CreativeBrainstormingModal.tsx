'use client';

import React, { useState, useCallback } from 'react';
import { VideoEditingLogger } from '../../utils/logger';
import { CreativeBrainstormingConfig, ChatMessage, BrainstormingPhase } from './types';
import ConfigurationPanel from './components/ConfigurationPanel';
import ChatInterface from './components/ChatInterface';
import { useBrainstormingChat } from './hooks/useBrainstormingChat';
import { useLocale } from '@/contexts/LocaleContext';

interface CreativeBrainstormingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportContent: (content: string) => void;
  taskId: string;
  currentContent?: string;
}

const CreativeBrainstormingModal: React.FC<CreativeBrainstormingModalProps> = ({
  isOpen,
  onClose,
  onExportContent,
  taskId,
  currentContent = ''
}) => {
  const { t } = useLocale();
  const logger = new VideoEditingLogger({
    taskId,
    component: 'CreativeBrainstormingModal'
  });

  // 配置状态
  const [config, setConfig] = useState<CreativeBrainstormingConfig>({
    creationType: [],
    creationDomain: [],
    creationGoal: [],
    contentStrategy: [],
    creativeExperts: ['creative-director', 'marketing-strategist', 'content-writer', 'visual-designer', 'ux-expert'],
    customCreativeInput: ''
  });

  // 聊天状态
  const {
    messages,
    isDiscussing,
    isSummarizing,
    currentRound,
    finalSummary,
    startDiscussion,
    continueDiscussion,
    startSummary,
    sendUserMessage
  } = useBrainstormingChat(taskId, config, currentContent, t.creativeBrainstormingModal);

  // 验证配置是否完整
  const isConfigValid = config.creationType.length > 0 && config.creativeExperts.length > 0;

  // 是否可以导出
  const canExport = Boolean(finalSummary);

  const handleConfigChange = useCallback((newConfig: CreativeBrainstormingConfig) => {
    // 检查是否有自定义创意输入的变化
    const customCreativeChanged = config.customCreativeInput !== newConfig.customCreativeInput;
    
    logger.info('配置更新', {
      previousConfig: config,
      newConfig,
      customCreativeChanged,
      customCreativeLength: newConfig.customCreativeInput?.length || 0,
      timestamp: new Date().toISOString()
    });
    setConfig(newConfig);
  }, [config, logger]);

  const handleStartBrainstorming = useCallback(() => {
    logger.info('开始创意构思', {
      config,
      timestamp: new Date().toISOString()
    });
    startDiscussion();
  }, [config, startDiscussion, logger]);

  const handleContinueDiscussion = useCallback(() => {
    logger.info('继续讨论', {
      currentRound,
      messagesCount: messages.length,
      timestamp: new Date().toISOString()
    });
    continueDiscussion();
  }, [currentRound, messages.length, continueDiscussion, logger]);

  const handleStartSummary = useCallback(() => {
    logger.info('开始总结', {
      totalMessages: messages.length,
      totalRounds: currentRound,
      timestamp: new Date().toISOString()
    });
    startSummary();
  }, [messages.length, currentRound, startSummary, logger]);

  const handleSendMessage = useCallback((message: string) => {
    logger.info('用户发送消息', {
      messageLength: message.length,
      currentRound,
      timestamp: new Date().toISOString()
    });
    sendUserMessage(message);
  }, [currentRound, sendUserMessage, logger]);

  const handleExportContent = useCallback(() => {
    if (finalSummary) {
      logger.info('导出创意文案', {
        contentLength: finalSummary.length,
        timestamp: new Date().toISOString()
      });
      onExportContent(finalSummary);
      onClose();
    }
  }, [finalSummary, onExportContent, onClose, logger]);

  const handleClose = useCallback(() => {
    logger.info('关闭创意构思弹窗', {
      messagesCount: messages.length,
      currentRound,
      hasContent: Boolean(finalSummary),
      timestamp: new Date().toISOString()
    });
    onClose();
  }, [messages.length, currentRound, finalSummary, onClose, logger]);

  if (!isOpen) return null;

  return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
      <div className="bg-card rounded-md max-w-7xl w-full h-[90vh] flex flex-col overflow-hidden">
        {/* 标题栏 */}
        <div className="bg-muted px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-primary/10 to-accent/50 rounded-md flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">{t.creativeBrainstormingModal.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{t.creativeBrainstormingModal.subtitle}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground"
              aria-label={t.creativeBrainstormingModal.closeAriaLabel}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 主要内容区域 - 左右布局 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧配置面板 */}
          <ConfigurationPanel
            config={config}
            onConfigChange={handleConfigChange}
            onStartBrainstorming={handleStartBrainstorming}
            isConfigValid={isConfigValid}
            isDiscussing={isDiscussing}
            translations={t.creativeBrainstormingModal}
          />

          {/* 右侧聊天界面 */}
          <ChatInterface
            messages={messages}
            isDiscussing={isDiscussing}
            isSummarizing={isSummarizing}
            canExport={canExport}
            onSendMessage={handleSendMessage}
            onContinueDiscussion={handleContinueDiscussion}
            onStartSummary={handleStartSummary}
            onExportContent={handleExportContent}
            currentRound={currentRound}
            translations={t.creativeBrainstormingModal}
          />
        </div>
      </div>
    </div>
  );
};

export default CreativeBrainstormingModal; 