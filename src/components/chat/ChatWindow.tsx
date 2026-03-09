'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Conversation } from '@/types';
import MessageBubble from './MessageBubble';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';

interface ChatWindowProps {
  conversation: Conversation | undefined;
  onSendMessage: (message: string) => void;
  onClearMessages: () => void;
  isLoading: boolean;
  onNavigateToVideoEditing?: (materials: any[]) => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  conversation,
  onSendMessage,
  onClearMessages,
  isLoading,
  onNavigateToVideoEditing,
}) => {
  const { t } = useLocale();
  const { showConfirm } = useNotification();
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
        textareaRef.current.style.height = '48px';
        textareaRef.current.style.overflow = 'hidden';
      }
      // 发送消息后强制滚动到底部
      setShouldAutoScroll(true);
      setTimeout(() => scrollToBottom(true), 100);
      console.log('[ChatWindow] Textarea reset to default height (48px)');
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
    // Calculate new height (min: 48px for 1 line, max: 120px for ~5 lines)
    const minHeight = 48;
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
    const minHeight = 48;
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
      textareaRef.current.style.height = '48px';
      textareaRef.current.style.overflow = 'hidden';
    } else if (currentHeight !== '48px') {
      // Has content and height was expanded: reset height
      console.log('[ChatWindow] Input lost focus, resetting expanded height to default while preserving content');
      textareaRef.current.style.height = '48px';
      textareaRef.current.style.overflow = 'hidden';
    }
  };

  const handleClearChat = () => {
    if (!conversation || conversation.messages.length === 0) {
      console.log('[ChatWindow] No messages to clear');
      return;
    }

    showConfirm('Are you sure you want to clear all chat history? This action cannot be undone.', () => {
      console.log(`[ChatWindow] User confirmed clearing ${conversation.messages.length} messages`);
      onClearMessages();
      console.log('[ChatWindow] Chat cleared, context cache reset');
    });
  };

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-20 h-20 bg-primary rounded-md mx-auto mb-6 flex items-center justify-center">
            <svg className="w-10 h-10 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-3">
            {t.aiChat.welcomePage.title}
          </h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            {t.aiChat.welcomePage.subtitle}
          </p>
          <div className="grid grid-cols-1 gap-3 text-sm">
            <div className="bg-primary/10 rounded-md p-4 text-left border border-primary/30 transition-colors">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 bg-primary rounded-md flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-foreground">{t.aiChat.welcomePage.creativeAssistantTitle}</h3>
              </div>
              <p className="text-primary leading-relaxed">{t.aiChat.welcomePage.creativeAssistantDesc}</p>
            </div>
            <div className="bg-green-500/10 rounded-md p-4 text-left border border-green-500/30 transition-colors">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 bg-green-600 rounded-md flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-foreground">{t.aiChat.welcomePage.knowledgeAssistantTitle}</h3>
              </div>
              <p className="text-green-500 leading-relaxed">{t.aiChat.welcomePage.knowledgeAssistantDesc}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card min-h-0">
      {/* Chat Header - Apple style with backdrop blur, aligned with ConversationList header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-card h-[74px]">
        <div className="flex items-center justify-between h-full">
          <div className="flex items-center space-x-3">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-semibold text-foreground">{conversation.title}</h2>
                {conversation.workflowName && (
                  <span className="px-2 py-0.5 bg-primary/15 text-primary text-xs font-medium rounded-lg flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>{conversation.workflowName}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {conversation.messages.length} 条消息 • {conversation.updatedAt.toLocaleTimeString()}
              </p>
            </div>
          </div>
          {isLoading && (
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-primary/10 border border-primary/30 rounded-full">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
              <span className="text-sm text-primary font-medium">回复中</span>
            </div>
          )}
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
              <div className="w-20 h-20 bg-muted rounded-md mx-auto mb-4 flex items-center justify-center">
                <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{t.aiChat.emptyConversation.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{t.aiChat.emptyConversation.subtitle}</p>
            </div>
          </div>
        ) : (
          conversation.messages.map((message) => (
            <MessageBubble 
              key={message.id} 
              message={message}
              onNavigateToVideoEditing={onNavigateToVideoEditing}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area - Apple style with backdrop blur */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-card">
        <form onSubmit={handleSubmit} className="flex items-stretch space-x-3">
          <div className="flex-1 relative flex items-stretch">
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              placeholder="输入消息... (Shift+Enter 换行)"
              className="w-full px-4 py-3 border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent max-h-32 bg-muted min-h-[48px] transition-colors text-sm"
              rows={1}
              disabled={isLoading}
              style={{ height: '48px', overflow: 'hidden' }}
            />
          </div>
          {/* Clear Chat Button */}
          <button
            type="button"
            onClick={handleClearChat}
            disabled={!conversation || conversation.messages.length === 0 || isLoading}
            className="bg-card border border-border hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed text-foreground rounded-md transition-colors flex items-center justify-center shrink-0 self-stretch min-h-[48px]"
            title="清空聊天记录"
            style={{ width: '48px' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputMessage.trim() || isLoading}
            className="bg-primary hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground rounded-md transition-colors flex items-center justify-center shrink-0 self-stretch min-h-[48px]"
            title="发送消息"
            style={{ width: '48px' }}
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
        <div className="mt-2 text-xs text-muted-foreground text-center">
          {isLoading ? 'AI 正在回复中...' : '按 Enter 发送，Shift + Enter 换行'}
        </div>
      </div>
    </div>
  );
};

export default ChatWindow; 