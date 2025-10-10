'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Conversation } from '@/types';
import MessageBubble from './MessageBubble';

interface ChatWindowProps {
  conversation: Conversation | undefined;
  onSendMessage: (message: string) => void;
  onClearMessages: () => void;
  isLoading: boolean;
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  onSendMessage,
  onClearMessages,
  isLoading,
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

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
    }
  };

  // 处理用户滚动事件
  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    
    const nearBottom = isNearBottom();
    
    // 更新自动滚动状态
    setShouldAutoScroll(nearBottom);
    
    // 更新用户滚动状态
    if (nearBottom && isUserScrolling) {
      setIsUserScrolling(false);
    } else if (!nearBottom && !isUserScrolling) {
      setIsUserScrolling(true);
    }
  };

  // 检查是否有正在流式传输的消息
  const hasStreamingMessage = conversation?.messages.some(msg => msg.isStreaming) || false;

  // Initialize textarea height on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
      console.log('[ChatWindow] Textarea initialized with default height');
    }
  }, []);

  useEffect(() => {
    // 新消息时自动滚动到底部
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    
    return () => clearTimeout(timer);
  }, [conversation?.messages, shouldAutoScroll]);

  // 流式传输时实时滚动到底部
  useEffect(() => {
    if (!hasStreamingMessage) return;

    const intervalId = setInterval(() => {
      // 只有在用户在底部附近且允许自动滚动时才滚动
      if (shouldAutoScroll) {
        scrollToBottom();
      }
    }, 100); // 每100ms检查一次，确保跟上流式传输的速度

    return () => clearInterval(intervalId);
  }, [hasStreamingMessage, shouldAutoScroll]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isLoading) {
      console.log('[ChatWindow] Sending message, resetting textarea to default state');
      onSendMessage(inputMessage.trim());
      setInputMessage('');
      // Reset textarea to initial single-row height and hide overflow
      if (textareaRef.current) {
        textareaRef.current.style.height = '46px';
        textareaRef.current.style.overflow = 'hidden';
      }
      // 发送消息后强制滚动到底部
      setShouldAutoScroll(true);
      setTimeout(() => scrollToBottom(true), 100);
      console.log('[ChatWindow] Textarea reset to default height (46px)');
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
    // Reset height to auto to get accurate scrollHeight
    textarea.style.height = 'auto';
    // Calculate new height (min: 46px for 1 line, max: 120px for ~5 lines)
    const minHeight = 46;
    const maxHeight = 120;
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = newHeight + 'px';
    
    // Enable scrolling when content exceeds max height
    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflow = 'auto';
      console.log(`[ChatWindow] Textarea reached max height (${maxHeight}px), scrolling enabled. Buttons aligned to bottom.`);
    } else {
      textarea.style.overflow = 'hidden';
    }
    
    // Log height changes for multi-line content
    if (newHeight > minHeight) {
      console.log(`[ChatWindow] Textarea auto-resized to ${newHeight}px (approx ${Math.ceil((newHeight - 22) / 24)} lines). Buttons stay aligned to bottom.`);
    }
  };

  const handleFocus = () => {
    // When input gains focus, expand height based on content
    if (!textareaRef.current) return;
    
    const textarea = textareaRef.current;
    
    // Temporarily set to auto to get accurate scrollHeight
    textarea.style.height = 'auto';
    
    // Calculate appropriate height based on content
    const minHeight = 46;
    const maxHeight = 120;
    const contentHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    
    textarea.style.height = contentHeight + 'px';
    
    // Handle overflow for long content
    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflow = 'auto';
    } else {
      textarea.style.overflow = 'hidden';
    }
    
    if (contentHeight > minHeight) {
      console.log(`[ChatWindow] Input gained focus with multi-line content, expanding to ${contentHeight}px`);
    } else {
      console.log('[ChatWindow] Input gained focus with single-line content, keeping default height');
    }
  };

  const handleBlur = () => {
    // Reset textarea height when it loses focus (user clicks elsewhere)
    if (!textareaRef.current) return;
    
    const currentHeight = textareaRef.current.style.height;
    
    if (!inputMessage.trim()) {
      // No content: always reset to default height
      console.log('[ChatWindow] Input lost focus with no content, resetting height to default');
      textareaRef.current.style.height = '46px';
      textareaRef.current.style.overflow = 'hidden';
    } else if (currentHeight !== '46px') {
      // Has content and height was expanded: reset height
      console.log('[ChatWindow] Input lost focus, resetting expanded height to default while preserving content');
      textareaRef.current.style.height = '46px';
      textareaRef.current.style.overflow = 'hidden';
    }
  };

  const handleClearChat = () => {
    if (!conversation || conversation.messages.length === 0) {
      console.log('[ChatWindow] No messages to clear');
      return;
    }

    // Show confirmation dialog
    const confirmed = window.confirm('Are you sure you want to clear all chat history? This action cannot be undone.');
    
    if (confirmed) {
      console.log(`[ChatWindow] User confirmed clearing ${conversation.messages.length} messages`);
      onClearMessages();
      console.log('[ChatWindow] Chat cleared, context cache reset');
    } else {
      console.log('[ChatWindow] User cancelled chat clearing');
    }
  };

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mx-auto mb-6 flex items-center justify-center">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-3">
            Start a conversation
          </h2>
          <p className="text-gray-600 mb-6">
            Create a new chat to begin your AI conversation. Ask questions, get help, or just have a friendly chat.
          </p>
          <div className="grid grid-cols-1 gap-3 text-sm">
            <div className="bg-gray-50 rounded-xl p-4 text-left">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="font-medium text-gray-900">Creative Assistant</h3>
              </div>
              <p className="text-gray-600">Get help with writing, brainstorming, and creative projects</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 text-left">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-medium text-gray-900">Knowledge Helper</h3>
              </div>
              <p className="text-gray-600">Ask questions and get detailed explanations on any topic</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white min-h-0">
      {/* Chat Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-100 bg-white">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{conversation.title}</h2>
            <p className="text-sm text-gray-500">
              {conversation.messages.length} messages • {conversation.updatedAt.toLocaleTimeString()}
            </p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0"
        onScroll={handleScroll}
      >
        {conversation.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to chat</h3>
              <p className="text-gray-500">Send a message to start the conversation</p>
            </div>
          </div>
        ) : (
          conversation.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 bg-white">
        <form onSubmit={handleSubmit} className="flex items-end space-x-3">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              placeholder="Type your message..."
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-32 bg-gray-50 min-h-[46px]"
              rows={1}
              disabled={isLoading}
              style={{ height: '46px', overflow: 'hidden' }}
            />
          </div>
          {/* Clear Chat Button */}
          <button
            type="button"
            onClick={handleClearChat}
            disabled={!conversation || conversation.messages.length === 0 || isLoading}
            className="bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 text-white rounded-2xl px-3 py-3 transition-colors flex items-center justify-center shrink-0"
            title="Clear chat history"
            style={{ height: '46px', width: '46px' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputMessage.trim() || isLoading}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-2xl px-3 py-3 transition-colors flex items-center justify-center shrink-0"
            title="Send message"
            style={{ height: '46px', width: '46px' }}
          >
            {isLoading ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatWindow; 