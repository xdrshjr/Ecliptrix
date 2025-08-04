'use client';

import React, { useState } from 'react';
import { ChatMessage } from '@/types';
import MarkdownRenderer from './MarkdownRenderer';
import { copyToClipboard, showCopyFeedback } from '@/lib/clipboard';

interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [showCopySuccess, setShowCopySuccess] = useState(false);
  const isUser = message.role === 'user';
  
  // 只在流式传输时记录日志
  if (message.isStreaming) {
    console.log('[MessageBubble] 流式消息更新', { 
      messageId: message.id, 
      contentLength: message.content.length
    });
  }

  const handleCopyMessage = async () => {
    setIsCopying(true);
    
    try {
      const result = await copyToClipboard(message.content);
      showCopyFeedback(result.success, result.error);
      
      if (result.success) {
        setShowCopySuccess(true);
        setTimeout(() => setShowCopySuccess(false), 2000);
      } else {
        console.error('[MessageBubble] 复制失败:', result.error);
      }
    } catch (error) {
      console.error('[MessageBubble] 复制错误:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsCopying(false);
    }
  };
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`flex max-w-[80%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start space-x-3`}>
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser 
            ? 'bg-blue-500 text-white ml-3' 
            : 'bg-gray-200 text-gray-600 mr-3'
        }`}>
          {isUser ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          )}
        </div>

        {/* Message Content */}
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <div 
            className={`relative px-4 py-3 rounded-2xl max-w-full group ${
              isUser 
                ? 'bg-blue-500 text-white rounded-br-md' 
                : 'bg-gray-100 text-gray-900 rounded-bl-md'
            }`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* 复制按钮 - 小标签样式，一直显示在右上角 */}
            <button
              onClick={handleCopyMessage}
              disabled={isCopying || message.isStreaming}
              className={`absolute -top-2 -right-2 w-6 h-6 rounded-full shadow-md transition-all duration-200 flex items-center justify-center ${
                isUser 
                  ? 'bg-blue-600 hover:bg-blue-700 text-white border-2 border-white' 
                  : 'bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-800 border-2 border-gray-200'
              } ${isCopying ? 'cursor-not-allowed' : 'cursor-pointer hover:scale-110'}`}
              title={showCopySuccess ? '已复制!' : '复制消息'}
              aria-label="复制消息内容"
            >
              {showCopySuccess ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : isCopying ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>

            {/* 消息内容 - 使用Markdown渲染 */}
            <div className="text-sm leading-relaxed">
              <MarkdownRenderer 
                content={message.content} 
                isUser={isUser}
              />
              {message.isStreaming && (
                <span className="inline-block w-2 h-4 bg-current opacity-75 animate-pulse ml-1" />
              )}
            </div>
          </div>
          
          {/* Timestamp */}
          <div className={`mt-1 text-xs text-gray-500 ${isUser ? 'text-right' : 'text-left'}`}>
            {message.timestamp.toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
            {message.isStreaming && (
              <span className="ml-2 text-blue-500">
                <svg className="w-3 h-3 inline animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </span>
            )}
            {showCopySuccess && (
              <span className="ml-2 text-green-500 text-xs">已复制</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble; 