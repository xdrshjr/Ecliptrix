'use client';

import React, { useEffect } from 'react';
import { UseAIAssistantReturn } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

interface AIAssistantPanelProps extends UseAIAssistantReturn {
  taskId: string;
  className?: string;
}

const AIAssistantPanel: React.FC<AIAssistantPanelProps> = ({
  inputMessage,
  setInputMessage,
  isLoading,
  handleSubmit,
  handleKeyDown,
  taskId,
  className = ''
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
      isLoading
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

  return (
    <div className={`video-editing-ai-assistant-section flex flex-col bg-gray-50 border-t border-gray-200 ${className}`}>
      {/* 输入区域 */}
      <div className="flex flex-col p-4">
        {/* AI Assistant标题 */}
        <div className="mb-3">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-5 h-5 bg-blue-100 rounded-md flex items-center justify-center">
              <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900">AI Assistant</h3>
            {isLoading && (
              <div className="flex items-center space-x-1 text-xs text-gray-500">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Processing...</span>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleFormSubmit} className="flex items-end space-x-3">
          <div className="flex-1 relative">
            <textarea
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Ask me anything about video editing, content creation, or project planning..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
              rows={2}
              disabled={isLoading}
              style={{ minHeight: '60px', maxHeight: '80px' }}
            />
          </div>
          <button
            type="submit"
            disabled={!inputMessage.trim() || isLoading}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg px-4 py-2 transition-colors flex items-center justify-center min-w-[60px] h-[60px]"
          >
            {isLoading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AIAssistantPanel; 