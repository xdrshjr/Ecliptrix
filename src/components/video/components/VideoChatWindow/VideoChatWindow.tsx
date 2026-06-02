'use client';

/**
 * VideoChatWindow — the main chat panel for the video editing interface.
 *
 * Refactored to use TimelineChatPanel for message rendering instead of
 * the old AgentMessageBubble / MessageBubble flat list. The input area,
 * action buttons bar, and agent mode toggle remain unchanged.
 *
 * ## Changes from previous version
 * - Replaced flat message list with TimelineChatPanel (timeline/index.ts)
 * - Added executionState, onUndoAll, onUndoSingle, onCancel props
 * - Kept backward compatibility: onAgentUndo still works (bridges to onUndoAll)
 * - Auto-scroll logic moved into TimelineChatPanel; removed from here
 *
 * @module VideoChatWindow
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Conversation, ChatMessage } from '@/types';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import { TimelineChatPanel, WelcomeGuide } from './timeline';
import AgentBusyBar from './AgentBusyBar';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';

interface VideoChatWindowProps {
  conversation: Conversation | undefined;
  onSendMessage: (message: string) => Promise<void>;
  onClearMessages: () => void;
  isLoading: boolean;
  onCreativeBrainstormingClick?: () => void;
  onPolishClick?: () => void;
  onConvertMessageToScript?: (content: string) => void;
  // Agent mode props
  agentMode: boolean;
  onAgentModeChange: (enabled: boolean) => void;
  agentIsExecuting: boolean;
  /** @deprecated Use onUndoAll instead. Kept for backward compatibility. */
  onAgentUndo?: (message: ChatMessage) => void;
  // New timeline UI props (provided by useAgentExecution / google-dev-04)
  executionState?: AgentExecutionState | null;
  onUndoAll?: (messageId: string) => void;
  onUndoSingle?: (messageId: string, toolCallId: string) => void;
  onCancel?: () => void;
  /** Whether the project has any imported materials (used by WelcomeGuide). */
  hasMaterials?: boolean;
}

const VideoChatWindow: React.FC<VideoChatWindowProps> = ({
  conversation,
  onSendMessage,
  onClearMessages,
  isLoading,
  onCreativeBrainstormingClick,
  onPolishClick,
  onConvertMessageToScript,
  agentMode,
  onAgentModeChange,
  agentIsExecuting,
  onAgentUndo,
  executionState = null,
  onUndoAll,
  onUndoSingle,
  onCancel,
  hasMaterials = false,
}) => {
  const { t } = useLocale();
  const { showConfirm } = useNotification();
  const [inputMessage, setInputMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ----- Textarea height management -----

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '32px';
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (inputMessage.trim() && !isLoading && !agentIsExecuting) {
        console.log('[VideoChatWindow] Sending message', {
          messageLength: inputMessage.length,
          agentMode,
          timestamp: new Date().toISOString(),
        });
        onSendMessage(inputMessage.trim());
        setInputMessage('');

        if (textareaRef.current) {
          textareaRef.current.style.height = '32px';
          textareaRef.current.style.overflow = 'hidden';
        }
      }
    },
    [inputMessage, isLoading, agentIsExecuting, agentMode, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInputMessage(newValue);

    const textarea = e.target;
    textarea.style.height = 'auto';

    const minHeight = 32;
    const maxHeight = 80;
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = newHeight + 'px';
    textarea.style.overflow = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  const handleFocus = useCallback(() => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.style.height = 'auto';
    const minHeight = 32;
    const maxHeight = 80;
    const contentHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = contentHeight + 'px';
    textarea.style.overflow = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  const handleBlur = useCallback(() => {
    if (!textareaRef.current) return;
    if (!inputMessage.trim()) {
      textareaRef.current.style.height = '32px';
      textareaRef.current.style.overflow = 'hidden';
    }
  }, [inputMessage]);

  const handleClearChat = useCallback(() => {
    if (!conversation || conversation.messages.length === 0) return;
    showConfirm(t.videoChatWindow.clearChatConfirm, onClearMessages);
  }, [conversation, showConfirm, t.videoChatWindow.clearChatConfirm, onClearMessages]);

  // ----- Bridge: onUndoAll -----
  // If the new onUndoAll is not provided, fall back to the legacy onAgentUndo
  const handleUndoAll = useCallback(
    (messageId: string) => {
      if (onUndoAll) {
        onUndoAll(messageId);
        return;
      }
      // Legacy bridge: find the message and call onAgentUndo
      if (onAgentUndo && conversation) {
        const msg = conversation.messages.find((m) => m.id === messageId);
        if (msg) onAgentUndo(msg);
      }
    },
    [onUndoAll, onAgentUndo, conversation],
  );

  const handleUndoSingle = useCallback(
    (messageId: string, toolCallId: string) => {
      onUndoSingle?.(messageId, toolCallId);
    },
    [onUndoSingle],
  );

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  const handleConvertMessageToScript = useCallback(
    (content: string) => {
      onConvertMessageToScript?.(content);
    },
    [onConvertMessageToScript],
  );

  // ----- Derived state -----

  // ----- WelcomeGuide suggestion handler -----
  const handleSuggestionClick = useCallback(
    (text: string) => {
      setInputMessage(text);
      // Focus the textarea so the user can review and send
      textareaRef.current?.focus();
    },
    [],
  );

  const inputDisabled = isLoading || agentIsExecuting;
  const placeholderText = agentIsExecuting
    ? t.videoChatWindow.agentWorkingPlaceholder
    : agentMode
      ? t.videoChatWindow.agentInputPlaceholder
      : t.videoChatWindow.inputPlaceholder;

  // ----- Empty state (no conversation at all) -----

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

  // ----- Main render -----

  return (
    <div className="flex flex-col h-full bg-background min-h-0">
      {/* Messages Area — now rendered by TimelineChatPanel */}
      {conversation.messages.length === 0 ? (
        <WelcomeGuide
          hasMaterials={hasMaterials}
          onSuggestionClick={handleSuggestionClick}
        />
      ) : (
        <TimelineChatPanel
          messages={conversation.messages}
          executionState={executionState}
          onUndoAll={handleUndoAll}
          onUndoSingle={handleUndoSingle}
          onCancel={handleCancel}
        />
      )}

      {/* Action Buttons Bar - Above Input Area */}
      <div className="flex-shrink-0 px-6 py-3 border-t border-border bg-muted dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {/* Creative Brainstorming button */}
            {onCreativeBrainstormingClick && (
              <button
                onClick={() => onCreativeBrainstormingClick?.()}
                disabled={isLoading}
                className="flex items-center justify-center w-9 h-9 bg-card dark:bg-zinc-800 hover:bg-accent dark:hover:bg-zinc-700 border border-border dark:border-zinc-700 hover:border-primary/30 rounded-md transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                title={t.videoChatWindow.creativeBrainstormingTooltip}
                aria-label={t.videoChatWindow.creativeBrainstormingTooltip}
              >
                <svg className="w-4 h-4 text-primary group-hover:text-primary/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </button>
            )}

            {/* Polish Content button */}
            {onPolishClick && (
              <button
                onClick={() => onPolishClick?.()}
                disabled={isLoading}
                className="flex items-center justify-center w-9 h-9 bg-card dark:bg-zinc-800 hover:bg-accent dark:hover:bg-zinc-700 border border-border dark:border-zinc-700 hover:border-primary/30 rounded-md transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
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
            <span className="text-xs font-medium text-muted-foreground dark:text-zinc-400">{t.videoChatWindow.agentToggleLabel}</span>
            <button
              type="button"
              role="switch"
              aria-checked={agentMode}
              disabled={agentIsExecuting}
              onClick={() => onAgentModeChange(!agentMode)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                agentMode ? 'bg-primary' : 'bg-border dark:bg-zinc-600'
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

      {/* Agent busy status bar — narrow strip that appears between the
          action-buttons bar and the input form while the agent is
          executing. Conditionally rendered so idle-state DOM is unchanged. */}
      {agentIsExecuting && (
        <AgentBusyBar
          executionState={executionState}
          onCancel={handleCancel}
        />
      )}

      {/* Input Area */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-card dark:bg-zinc-900">
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
              aria-label={t.videoChatWindow.inputAriaLabel}
              className="w-full px-3 py-2 border border-border dark:border-zinc-600 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent max-h-24 bg-muted dark:bg-zinc-800 min-h-[32px] transition-all text-sm text-foreground dark:text-zinc-200"
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
            className="bg-card dark:bg-zinc-800 border border-border dark:border-zinc-600 hover:bg-accent dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-foreground dark:text-zinc-300 rounded-md transition-colors flex items-center justify-center shrink-0"
            title={t.videoChatWindow.clearChatTooltip}
            style={{ width: '32px', height: '32px' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {/* Send / Stop Button — polymorphic. While the agent is executing
              it renders as a red Stop button that calls onCancel. Otherwise
              it acts as the regular submit button. */}
          {agentIsExecuting ? (
            <button
              type="button"
              onClick={handleCancel}
              className="bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors flex items-center justify-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              title={t.videoChatWindow.stopAgentTooltip}
              aria-label={t.videoChatWindow.stopAgentTooltip}
              data-testid="agent-stop-button"
              style={{ width: '32px', height: '32px' }}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            </button>
          ) : (
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
          )}
        </form>
      </div>
    </div>
  );
};

export default VideoChatWindow;
