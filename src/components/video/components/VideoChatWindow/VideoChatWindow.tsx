'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Conversation, ChatMessage } from '@/types';
import MessageBubble from '@/components/chat/MessageBubble';
import AgentMessageBubble from './AgentMessageBubble';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';

interface VideoChatWindowProps {
  conversation: Conversation | undefined;
  onSendMessage: (message: string) => Promise<void>;
  onClearMessages: () => void;
  isLoading: boolean;
  onCreativeBrainstormingClick?: () => void;
  onPolishClick?: () => void;
  onViewWorkflowsClick?: () => void;
  onConvertMessageToScript?: (content: string) => void;
  // Agent mode props
  agentMode: boolean;
  onAgentModeChange: (enabled: boolean) => void;
  agentIsExecuting: boolean;
  onAgentUndo?: (message: ChatMessage) => void;
}

const VideoChatWindow: React.FC<VideoChatWindowProps> = ({
  conversation,
  onSendMessage,
  onClearMessages,
  isLoading,
  onCreativeBrainstormingClick,
  onPolishClick,
  onViewWorkflowsClick,
  onConvertMessageToScript,
  agentMode,
  onAgentModeChange,
  agentIsExecuting,
  onAgentUndo,
}) => {
  const { t } = useLocale();
  const { showConfirm } = useNotification();
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const isNearBottom = () => {
    if (!messagesContainerRef.current) return true;
    const container = messagesContainerRef.current;
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  };

  const scrollToBottom = (force = false) => {
    if (!shouldAutoScroll && !force) return;
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    setShouldAutoScroll(isNearBottom());
  };

  const hasStreamingMessage = conversation?.messages.some(msg => msg.isStreaming) || false;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '32px';
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => scrollToBottom(), 100);
    return () => clearTimeout(timer);
  }, [conversation?.messages, shouldAutoScroll]);

  useEffect(() => {
    if (!hasStreamingMessage) return;
    const intervalId = setInterval(() => {
      if (shouldAutoScroll) scrollToBottom();
    }, 100);
    return () => clearInterval(intervalId);
  }, [hasStreamingMessage, shouldAutoScroll]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isLoading && !agentIsExecuting) {
      console.log('[VideoChatWindow] 发送消息', {
        messageLength: inputMessage.length,
        agentMode,
        timestamp: new Date().toISOString()
      });
      onSendMessage(inputMessage.trim());
      setInputMessage('');

      if (textareaRef.current) {
        textareaRef.current.style.height = '32px';
        textareaRef.current.style.overflow = 'hidden';
      }

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

    const textarea = e.target;
    textarea.style.height = 'auto';

    const minHeight = 32;
    const maxHeight = 80;
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = newHeight + 'px';

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
    textarea.style.overflow = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  const handleBlur = () => {
    if (!textareaRef.current) return;
    if (!inputMessage.trim()) {
      textareaRef.current.style.height = '32px';
      textareaRef.current.style.overflow = 'hidden';
    }
  };

  const handleClearChat = () => {
    if (!conversation || conversation.messages.length === 0) return;
    showConfirm(t.videoChatWindow.clearChatConfirm, onClearMessages);
  };

  const handleConvertMessageToScript = (content: string) => {
    onConvertMessageToScript?.(content);
  };

  // Determine placeholder text
  const inputDisabled = isLoading || agentIsExecuting;
  const placeholderText = agentIsExecuting
    ? t.videoChatWindow.agentWorkingPlaceholder
    : agentMode
      ? t.videoChatWindow.agentInputPlaceholder
      : t.videoChatWindow.inputPlaceholder;

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-20 h-20 bg-primary rounded-md mx-auto mb-6 flex items-center justify-center">
            <svg className="w-10 h-10 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-3">
            {t.videoChatWindow.emptyStateTitle}
          </h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            {t.videoChatWindow.emptyStateSubtitle}
          </p>
          <div className="grid grid-cols-1 gap-3 text-sm">
            <div className="bg-primary/10 rounded-md p-4 text-left border border-border">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 bg-primary rounded-md flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-primary">{t.videoChatWindow.scriptOptimizationTitle}</h3>
              </div>
              <p className="text-primary leading-relaxed">{t.videoChatWindow.scriptOptimizationDesc}</p>
            </div>
            <div className="bg-secondary/50 rounded-md p-4 text-left border border-border">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 bg-secondary rounded-md flex items-center justify-center">
                  <svg className="w-5 h-5 text-secondary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-secondary-foreground">{t.videoChatWindow.editingSuggestionsTitle}</h3>
              </div>
              <p className="text-muted-foreground leading-relaxed">{t.videoChatWindow.editingSuggestionsDesc}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background min-h-0">
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
              <h3 className="text-lg font-semibold text-foreground mb-2">{t.videoChatWindow.startChatTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t.videoChatWindow.startChatDesc}
              </p>
            </div>
          </div>
        ) : (
          conversation.messages.map((message) => (
            message.isAgentMessage ? (
              <AgentMessageBubble
                key={message.id}
                message={message}
                onUndo={onAgentUndo}
              />
            ) : (
              <MessageBubble
                key={message.id}
                message={message}
                onConvertToScript={handleConvertMessageToScript}
              />
            )
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Action Buttons Bar - Above Input Area */}
      <div className="flex-shrink-0 px-6 py-3 border-t border-border bg-muted">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {/* 查看工作流按钮 */}
            {onViewWorkflowsClick && (
              <button
                onClick={() => onViewWorkflowsClick?.()}
                disabled={isLoading}
                className="flex items-center justify-center w-9 h-9 bg-card hover:bg-accent border border-border hover:border-primary/30 rounded-md transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                title={t.videoChatWindow.viewWorkflowsTooltip}
                aria-label={t.videoChatWindow.viewWorkflowsTooltip}
              >
                <svg className="w-4 h-4 text-primary group-hover:text-primary/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </button>
            )}

            {/* 创意构思按钮 */}
            {onCreativeBrainstormingClick && (
              <button
                onClick={() => onCreativeBrainstormingClick?.()}
                disabled={isLoading}
                className="flex items-center justify-center w-9 h-9 bg-card hover:bg-accent border border-border hover:border-primary/30 rounded-md transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                title={t.videoChatWindow.creativeBrainstormingTooltip}
                aria-label={t.videoChatWindow.creativeBrainstormingTooltip}
              >
                <svg className="w-4 h-4 text-primary group-hover:text-primary/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </button>
            )}

            {/* 智能润色按钮 */}
            {onPolishClick && (
              <button
                onClick={() => onPolishClick?.()}
                disabled={isLoading}
                className="flex items-center justify-center w-9 h-9 bg-card hover:bg-accent border border-border hover:border-primary/30 rounded-md transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                title={t.videoChatWindow.polishContentTooltip}
                aria-label={t.videoChatWindow.polishContentTooltip}
              >
                <svg className="w-4 h-4 text-primary group-hover:text-primary/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
          </div>

          {/* Agent Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t.videoChatWindow.agentToggleLabel}</span>
            <button
              type="button"
              role="switch"
              aria-checked={agentMode}
              disabled={agentIsExecuting}
              onClick={() => onAgentModeChange(!agentMode)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                agentMode ? 'bg-primary' : 'bg-border'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  agentMode ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-card">
        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <div className="flex-1 relative flex items-center">
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onBlur={handleBlur}
              placeholder={placeholderText}
              className="w-full px-3 py-2 border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent max-h-24 bg-muted min-h-[32px] transition-all text-sm"
              rows={1}
              disabled={inputDisabled}
              style={{ height: '32px', overflow: 'hidden' }}
            />
          </div>
          {/* Clear Chat Button */}
          <button
            type="button"
            onClick={handleClearChat}
            disabled={!conversation || conversation.messages.length === 0 || inputDisabled}
            className="bg-card border border-border hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed text-foreground rounded-md transition-colors flex items-center justify-center shrink-0"
            title={t.videoChatWindow.clearChatTooltip}
            style={{ width: '32px', height: '32px' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputMessage.trim() || inputDisabled}
            className="bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground rounded-md transition-colors flex items-center justify-center shrink-0"
            title={t.videoChatWindow.sendMessageTooltip}
            style={{ width: '32px', height: '32px' }}
          >
            {inputDisabled ? (
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
