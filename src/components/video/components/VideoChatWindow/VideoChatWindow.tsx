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

import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from 'react';
import { Conversation, ChatMessage } from '@/types';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import { TimelineChatPanel } from './timeline';
import AgentBusyBar from './AgentBusyBar';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import {
  askAnswerMessage, documentRefMessage, parseAskAnswer,
} from '@/types/agentToolkit';
import { ASK_ANSWER_EVENT } from './AskUserCard';
import {
  AgentToolkitApiError, fetchAgentToolkitCapabilities, uploadDocument,
} from '@/lib/api/agentToolkit';
import { resolveAgentToolkitStatus } from '@/lib/agentToolkitStatus';
import type { AgentToolkitCapabilities } from '@/types/agentToolkit';

export interface VideoChatWindowProps {
  /** 最小化只暂停展示工作，不影响会话与 Agent 执行。 */
  isVisible?: boolean;
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
  /** Clears the error card of a run that already ended. */
  onDismissError?: () => void;
  /** Agent messages whose steps can still be undone one by one this session. */
  singleUndoMessageIds?: ReadonlySet<string>;
}

const INPUT_MIN_HEIGHT = 40;
const INPUT_MAX_HEIGHT = 120;
const INPUT_COMPACT_MAX_HEIGHT = 80;

function resizeInput(textarea: HTMLTextAreaElement) {
  const compact = textarea.closest('[data-compact="true"]');
  const maxHeight = compact ? INPUT_COMPACT_MAX_HEIGHT : INPUT_MAX_HEIGHT;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(INPUT_MIN_HEIGHT,
    Math.min(textarea.scrollHeight, maxHeight))}px`;
  textarea.style.overflow = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

// 保留既有输入、工具栏与执行接线，避免本次浮窗调整扩大成聊天组件重构。
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
  onDismissError,
  singleUndoMessageIds,
  isVisible = true,
}) => {
  const { t } = useLocale();
  const { showConfirm } = useNotification();
  const [inputMessage, setInputMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 文档上传：同一时刻只允许一个（`uploading` 即互斥锁）。
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [toolkitCaps, setToolkitCaps] =
    useState<AgentToolkitCapabilities | null>(null);

  const messages = conversation?.messages;

  /**
   * 已回答的 question_id：该问题之后存在一条 `[[ask:<id>]]` 用户消息。
   * 只读派生——绝不写回 `ChatMessage`（§3.5.2）。
   */
  const answeredQuestionIds = useMemo(() => {
    const answered = new Set<string>();
    for (const message of messages ?? []) {
      if (message.role !== 'user') continue;
      const questionId = parseAskAnswer(message.content);
      if (questionId) answered.add(questionId);
    }
    return answered;
  }, [messages]);

  /**
   * 未回答态：提问存在、本轮已结束、且之后没有对应回答。
   * 纯由「有没有回答」+「当前是否在跑」两个既知量派生，不引入服务端状态。
   */
  const unresolvedQuestionIds = useMemo(() => {
    const unresolved = new Set<string>();
    if (agentIsExecuting) return unresolved;
    for (const message of messages ?? []) {
      for (const call of message.agentToolCalls ?? []) {
        if (call.name !== 'ask_user') continue;
        const result = call.result as { question_id?: unknown } | undefined;
        const questionId = typeof result?.question_id === 'string'
          ? result.question_id : '';
        if (questionId && !answeredQuestionIds.has(questionId)) {
          unresolved.add(questionId);
        }
      }
    }
    return unresolved;
  }, [messages, agentIsExecuting, answeredQuestionIds]);

  // ----- Textarea height management -----

  useEffect(() => {
    if (textareaRef.current) {
      resizeInput(textareaRef.current);
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
          textareaRef.current.style.height = `${INPUT_MIN_HEIGHT}px`;
          textareaRef.current.style.overflow = 'hidden';
        }
      }
    },
    [inputMessage, isLoading, agentIsExecuting, agentMode, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;
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

    resizeInput(e.target);
  }, []);

  const handleFocus = useCallback(() => {
    if (!textareaRef.current) return;
    resizeInput(textareaRef.current);
  }, []);

  const handleBlur = useCallback(() => {
    if (!textareaRef.current) return;
    if (!inputMessage.trim()) {
      textareaRef.current.style.height = `${INPUT_MIN_HEIGHT}px`;
      textareaRef.current.style.overflow = 'hidden';
    }
  }, [inputMessage]);

  /**
   * `AskUserCard` 的选项按钮只发一个 window 事件；这里把答案变成**一条普通
   * 用户消息**（`[[ask:<id>]] <answer>`）。不挂起流、不改 SSE 协议。
   */
  useEffect(() => {
    const onAnswer = (event: Event) => {
      const detail = (event as CustomEvent<{
        questionId?: string; answer?: string }>).detail;
      const questionId = detail?.questionId;
      const answer = detail?.answer?.trim();
      if (!questionId || !answer) return;
      if (agentIsExecuting) return;
      void onSendMessage(askAnswerMessage(questionId, answer));
    };
    window.addEventListener(ASK_ANSWER_EVENT, onAnswer);
    return () => window.removeEventListener(ASK_ANSWER_EVENT, onAnswer);
  }, [onSendMessage, agentIsExecuting]);

  // 文档能力开关决定「添加文档」按钮是否可用；失败只降级，不阻塞聊天。
  useEffect(() => {
    let cancelled = false;
    void fetchAgentToolkitCapabilities()
      .then((caps) => { if (!cancelled) setToolkitCaps(caps); })
      .catch(() => { if (!cancelled) setToolkitCaps(null); });
    return () => { cancelled = true; };
  }, []);

  const documentsEnabled = toolkitCaps?.documents.enabled === true
    && toolkitCaps?.documents.available === true;
  const documentAccept = (toolkitCaps?.documents.formats ?? [])
    .join(',');
  const maxFileMb = toolkitCaps?.limits.max_file_mb ?? 0;

  const uploadSelectedDocument = useCallback(
    async (file: File | undefined) => {
      if (!file || uploading) return;
      setUploadError(null);
      // 前端预检：超限直接拒绝，不发请求（避免 413 往返）。
      if (maxFileMb > 0 && file.size > maxFileMb * 1024 * 1024) {
        setUploadError(t.agentToolkit.attachTooLarge.replace(
          '{mb}', String(maxFileMb)));
        return;
      }
      setUploading(true);
      try {
        const uploaded = await uploadDocument(file);
        // 成功后**恰**发一条消息；失败绝不发送（否则模型会引用不存在的文档）。
        await onSendMessage(
          documentRefMessage(uploaded.document_id, uploaded.name));
      } catch (error) {
        const code = error instanceof AgentToolkitApiError
          ? error.errorCode : 'document_parse_failed';
        const status = resolveAgentToolkitStatus({ error_code: code });
        setUploadError(status
          ? t.agentToolkit[status.key] : t.agentToolkit.attachFailed);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [uploading, maxFileMb, onSendMessage, t.agentToolkit],
  );

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

  // `finishing`: the stream already ended and the last operations are being
  // applied, so there is nothing left to stop.
  const isFinishing = executionState?.status === 'finishing';

  const handleCancel = useCallback(() => {
    if (isFinishing) return;
    onCancel?.();
  }, [onCancel, isFinishing]);

  const handleConvertMessageToScript = useCallback(
    (content: string) => {
      onConvertMessageToScript?.(content);
    },
    [onConvertMessageToScript],
  );

  // ----- Derived state -----

  const inputDisabled = isLoading || agentIsExecuting;
  const placeholderText = agentIsExecuting
    ? t.videoChatWindow.agentWorkingPlaceholder
    : agentMode
      ? t.videoChatWindow.agentInputPlaceholder
      : t.videoChatWindow.inputPlaceholder;

  // ----- Main render -----
  //
  // The dock panel must open directly into the Agent chat operation surface —
  // no "视频编辑AI助手" welcome/intro landing. The message area stays blank until
  // a conversation has messages; the agent-mode toggle and input box render
  // unconditionally so the popup is immediately chat-ready (round 2 requirement).

  return (
    <div className="agent-chat-window flex flex-col h-full bg-card min-h-0">
      {/* Messages Area — rendered by TimelineChatPanel. While there are no
          messages yet the area stays blank (an empty flex spacer) so the panel
          opens straight into the chat surface instead of a welcome landing. */}
      {conversation && conversation.messages.length > 0 ? (
        <TimelineChatPanel
          messages={conversation.messages}
          executionState={executionState}
          onUndoAll={handleUndoAll}
          onUndoSingle={handleUndoSingle}
          onCancel={handleCancel}
          undoDisabled={agentIsExecuting}
          onDismiss={onDismissError}
          singleUndoMessageIds={singleUndoMessageIds}
          answeredQuestionIds={answeredQuestionIds}
          unresolvedQuestionIds={unresolvedQuestionIds}
          isVisible={isVisible}
        />
      ) : (
        <div className="flex-1 min-h-0" />
      )}

      {/* Action Buttons Bar - Above Input Area */}
      <div className="agent-chat-toolbar flex-shrink-0 border-t border-border bg-card">
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
              aria-label={t.videoChatWindow.agentToggleLabel}
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
      {agentIsExecuting && !isFinishing && (
        <AgentBusyBar
          executionState={executionState}
          onCancel={handleCancel}
        />
      )}
      {isFinishing && (
        <div
          data-testid="agent-finishing-bar"
          role="status"
          aria-live="polite"
          className="flex-shrink-0 flex items-center gap-2 h-[22px] px-3 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-y border-amber-200 dark:border-amber-900"
        >
          <span className="relative inline-flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <span className="truncate" title={t.agentApply.finishing}>
            {t.agentApply.finishing}
          </span>
        </div>
      )}

      {/* Input Area */}
      <div className="agent-chat-input-area flex-shrink-0 bg-card">
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
              className="agent-chat-input w-full px-3 py-2 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-muted text-sm text-foreground"
              rows={1}
              disabled={inputDisabled}
              style={{ height: `${INPUT_MIN_HEIGHT}px`, overflow: 'hidden' }}
            />
          </div>
          {/* Add Document — the only model-free entry for uploads (§6.3). */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={documentAccept}
            onChange={(event) => {
              void uploadSelectedDocument(event.target.files?.[0]);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!documentsEnabled || uploading || inputDisabled}
            aria-label={t.agentToolkit.attachDocument}
            title={documentsEnabled
              ? t.agentToolkit.attachDocument : t.agentToolkit.attachDisabled}
            className="bg-card dark:bg-zinc-800 border border-border dark:border-zinc-600 hover:bg-accent dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-foreground dark:text-zinc-300 rounded-md transition-colors flex items-center justify-center shrink-0"
            style={{ width: '32px', height: '32px' }}
          >
            {uploading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"
                aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10"
                  stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor"
                viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656L5.05 10.828a6 6 0 108.485 8.485l6.586-6.586" />
              </svg>
            )}
          </button>
          <span aria-live="polite" className="sr-only">
            {uploading ? t.agentToolkit.attaching : ''}
          </span>
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
              disabled={isFinishing}
              className="bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors flex items-center justify-center shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600"
              title={isFinishing ? t.agentApply.finishing : t.videoChatWindow.stopAgentTooltip}
              aria-label={isFinishing ? t.agentApply.finishing : t.videoChatWindow.stopAgentTooltip}
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
        {uploadError && (
          <p role="alert"
            className="mt-1 px-1 text-xs text-red-500 dark:text-red-400">
            {uploadError}
          </p>
        )}
      </div>
    </div>
  );
};

export default VideoChatWindow;
