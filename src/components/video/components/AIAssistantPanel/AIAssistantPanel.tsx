'use client';

import React, { useEffect } from 'react';
import { UseAIAssistantReturn } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

interface AIAssistantPanelProps extends UseAIAssistantReturn {
  taskId: string;
  className?: string;
  onClearContent?: () => void;
}

const AIAssistantPanel: React.FC<AIAssistantPanelProps> = ({
  inputMessage,
  setInputMessage,
  isLoading,
  handleSubmit,
  handleKeyDown,
  taskId,
  className = '',
  onClearContent
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'AIAssistantPanel'
  });

  useEffect(() => {
    logger.info('组件初始化', {
      hasInitialMessage: inputMessage.length > 0,
      isLoading
    });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    logger.debug('用户输入变更', {
      previousLength: inputMessage.length,
      newLength: newValue.length,
      inputDelta: newValue.length - inputMessage.length
    });
    
    setInputMessage(newValue);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    logger.info('用户提交消息', {
      messageLength: inputMessage.length,
      message: inputMessage.substring(0, 100) + (inputMessage.length > 100 ? '...' : ''),
      isLoading,
      uiLayout: 'inline_buttons'
    });
    
    handleSubmit(e);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      logger.info('快捷键提交', {
        key: 'Ctrl/Cmd+Enter',
        messageLength: inputMessage.length
      });
    }
    
    handleKeyDown(e);
  };

  const handleClearContent = () => {
    logger.info('用户点击清空按钮', {
      timestamp: new Date().toISOString(),
      hasContent: inputMessage.length > 0,
      actionType: 'clear_markdown_content',
      uiLayout: 'inline_buttons'
    });

    if (onClearContent) {
      onClearContent();
    }

    logger.info('Markdown内容清空请求已发送', {
      timestamp: new Date().toISOString()
    });
  };

  const handleButtonHover = (buttonType: 'clear' | 'send', isEntering: boolean) => {
    logger.debug('按钮悬停状态变更', {
      buttonType,
      isEntering,
      timestamp: new Date().toISOString(),
      uiLayout: 'inline_buttons'
    });
  };

  return (
    <div className={`video-editing-ai-assistant-section flex flex-col bg-muted border-t border-border ${className}`}>
      {/* 输入区域 */}
      <div className="flex flex-col p-4">


        <form onSubmit={handleFormSubmit}>
          <div className="flex items-center space-x-2">
            {/* 文本输入区域 */}
            <div className="flex-1 relative">
              <textarea
                value={inputMessage}
                onChange={handleInputChange}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Ask me anything about video editing, content creation, or project planning..."
                className="w-full h-10 px-4 py-2 pr-12 border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-card text-sm transition-all duration-200 hover:border-border"
                disabled={isLoading}
              />
            </div>
            
            {/* 按钮组 - 内联显示 */}
            <div className="flex items-center space-x-1">
              {/* 清空按钮 - 仅图标 */}
              {onClearContent && (
                <button
                  type="button"
                  onClick={handleClearContent}
                  onMouseEnter={() => handleButtonHover('clear', true)}
                  onMouseLeave={() => handleButtonHover('clear', false)}
                  className="flex items-center justify-center w-10 h-10 text-muted-foreground bg-muted border border-border rounded-md hover:bg-accent hover:border-border hover:text-foreground transition-colors group"
                  title="清空文档编辑器中的所有内容"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              
              {/* 发送按钮 - 仅图标，使用纸飞机图标 */}
              <button
                type="submit"
                disabled={!inputMessage.trim() || isLoading}
                onMouseEnter={() => handleButtonHover('send', true)}
                onMouseLeave={() => handleButtonHover('send', false)}
                className="flex items-center justify-center w-10 h-10 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground rounded-md transition-colors group"
                title={isLoading ? "发送中..." : "发送消息"}
              >
                {isLoading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AIAssistantPanel; 