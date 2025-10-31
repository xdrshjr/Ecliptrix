'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Conversation } from '@/types';
import MessageBubble from '@/components/chat/MessageBubble';

interface VideoChatWindowProps {
  conversation: Conversation | undefined;
  onSendMessage: (message: string) => void;
  onClearMessages: () => void;
  isLoading: boolean;
}

const VideoChatWindow: React.FC<VideoChatWindowProps> = ({
  conversation,
  onSendMessage,
  onClearMessages,
  isLoading,
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  console.log('[VideoChatWindow] 渲染组件', {
    hasConversation: !!conversation,
    messageCount: conversation?.messages.length || 0,
    isLoading,
    timestamp: new Date().toISOString()
  });

  // 检查用户是否在消息底部附近
  const isNearBottom = () => {
    if (!messagesContainerRef.current) return true;
    const container = messagesContainerRef.current;
    const threshold = 100; // 100px threshold
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  };

  // 滚动到底部
  const scrollToBottom = (force = false) => {
    if (!shouldAutoScroll && !force) return;
    
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      console.log('[VideoChatWindow] 自动滚动到底部');
    }
  };

  // 处理用户滚动事件
  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    
    const nearBottom = isNearBottom();
    setShouldAutoScroll(nearBottom);
  };

  // 检查是否有正在流式传输的消息
  const hasStreamingMessage = conversation?.messages.some(msg => msg.isStreaming) || false;

  // Initialize textarea height on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '32px';
      console.log('[VideoChatWindow] Textarea初始化默认高度');
    }
  }, []);

  // 新消息时自动滚动到底部
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    
    return () => clearTimeout(timer);
  }, [conversation?.messages, shouldAutoScroll]);

  // 流式传输时实时滚动到底部
  useEffect(() => {
    if (!hasStreamingMessage) return;

    const intervalId = setInterval(() => {
      if (shouldAutoScroll) {
        scrollToBottom();
      }
    }, 100); // 每100ms检查一次

    return () => clearInterval(intervalId);
  }, [hasStreamingMessage, shouldAutoScroll]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isLoading) {
      console.log('[VideoChatWindow] 发送消息', { 
        messageLength: inputMessage.length,
        timestamp: new Date().toISOString() 
      });
      onSendMessage(inputMessage.trim());
      setInputMessage('');
      
      // Reset textarea to initial single-row height
      if (textareaRef.current) {
        textareaRef.current.style.height = '32px';
        textareaRef.current.style.overflow = 'hidden';
      }
      
      // 发送消息后强制滚动到底部
      setShouldAutoScroll(true);
      setTimeout(() => scrollToBottom(true), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInputMessage(newValue);
    
    // Auto-resize textarea based on content
    const textarea = e.target;
    textarea.style.height = 'auto';
    
    const minHeight = 32;
    const maxHeight = 80;
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = newHeight + 'px';
    
    // Enable scrolling when content exceeds max height
    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflow = 'auto';
    } else {
      textarea.style.overflow = 'hidden';
    }
  };

  const handleFocus = () => {
    if (!textareaRef.current) return;
    
    const textarea = textareaRef.current;
    textarea.style.height = 'auto';
    
    const minHeight = 32;
    const maxHeight = 80;
    const contentHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    
    textarea.style.height = contentHeight + 'px';
    
    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflow = 'auto';
    } else {
      textarea.style.overflow = 'hidden';
    }
  };

  const handleBlur = () => {
    if (!textareaRef.current) return;
    
    if (!inputMessage.trim()) {
      textareaRef.current.style.height = '32px';
      textareaRef.current.style.overflow = 'hidden';
    }
  };

  const handleClearChat = () => {
    if (!conversation || conversation.messages.length === 0) {
      console.log('[VideoChatWindow] 没有消息可清除');
      return;
    }

    const confirmed = window.confirm('确定要清空所有聊天记录吗？此操作无法撤销。');
    
    if (confirmed) {
      console.log(`[VideoChatWindow] 清空 ${conversation.messages.length} 条消息`, {
        timestamp: new Date().toISOString()
      });
      onClearMessages();
    }
  };

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-white to-gray-50/50">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-lg">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-3">
            视频编辑 AI 助手
          </h2>
          <p className="text-gray-600 mb-6 leading-relaxed">
            开始与 AI 对话，获取视频编辑建议、脚本优化和创意灵感。
          </p>
          <div className="grid grid-cols-1 gap-3 text-sm">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-2xl p-4 text-left border border-blue-200/50 shadow-sm">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-sm">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-blue-900">脚本优化</h3>
              </div>
              <p className="text-blue-700 leading-relaxed">让 AI 帮你改进视频脚本和创意方向</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-2xl p-4 text-left border border-purple-200/50 shadow-sm">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center shadow-sm">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-purple-900">剪辑建议</h3>
              </div>
              <p className="text-purple-700 leading-relaxed">获取专业的视频剪辑和素材使用建议</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-white to-gray-50/30 min-h-0">
      {/* Messages Area */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0"
        onScroll={handleScroll}
      >
        {conversation.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-3xl mx-auto mb-4 flex items-center justify-center shadow-sm">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">开始与 AI 对话</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                输入你的问题或需求，AI 将为你提供帮助
              </p>
            </div>
          </div>
        ) : (
          conversation.messages.map((message) => (
            <MessageBubble 
              key={message.id} 
              message={message}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area - Apple style with backdrop blur */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-gray-200/80 bg-white/80 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <div className="flex-1 relative flex items-center">
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              placeholder="输入消息... (Shift+Enter 换行)"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-24 bg-gray-50 min-h-[32px] transition-all shadow-sm text-sm"
              rows={1}
              disabled={isLoading}
              style={{ height: '32px', overflow: 'hidden' }}
            />
          </div>
          {/* Clear Chat Button */}
          <button
            type="button"
            onClick={handleClearChat}
            disabled={!conversation || conversation.messages.length === 0 || isLoading}
            className="bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 rounded-lg transition-all flex items-center justify-center shrink-0 shadow-sm hover:shadow-md"
            title="清空聊天记录"
            style={{ width: '32px', height: '32px' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputMessage.trim() || isLoading}
            className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all flex items-center justify-center shrink-0 shadow-md hover:shadow-lg"
            title="发送消息"
            style={{ width: '32px', height: '32px' }}
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

export default VideoChatWindow;

