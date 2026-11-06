'use client';

/**
 * VideoChatWindow — the main chat panel for the video editing interface.
 *
 * 消息由 TimelineChatPanel 渲染；AgentComposer 统一模式横条、输入卡片、
 * 附件和发送操作。会话 key 的挂载边界由外层 AgentChatDock 管理。
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
import { Conversation, ChatMessage, MaterialItem } from '@/types';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import type { SendAgentMessageOptions } from '@/components/video/hooks/useAgentExecution';
import type { ConversationSendContext, ConversationUploadToken,
  ConversationWriteScope, SendMessageResult } from '../../hooks/videoChatSessionModel';
import type { ConversationViewCache } from './conversationViewCache';
import AgentComposer from './AgentComposer';
import type { UseAgentSteeringReturn } from '@/components/video/hooks/useAgentSteering';
import type {
  DraftRestore, SkillSkipNotice,
} from '@/components/video/hooks/useAgentExecutionSteering';
import type { UseContextMemoryReturn } from '@/components/video/hooks/useContextMemory';
import type { UseCrewProgressReturn } from '@/components/video/hooks/useCrewProgress';
import { LiveProgressContext } from '@/components/video/hooks/useCrewProgress';
import { EMPTY_LIVE_PROGRESS } from '@/components/video/hooks/agentLiveProgress';
import { scanLatestPlan, selectActiveStep } from '@/lib/video-editing-agent/planScan';
import { TimelineChatPanel } from './timeline';
import AgentBusyBar from './AgentBusyBar';
import SteerQueue from './SteerQueue';
import { useComposer } from './useComposer';
import { useChatCompaction } from './useChatCompaction';
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
import { collectUnansweredQuestionIds } from '@/lib/video-editing-agent/askScan';
import type { AgentToolkitCapabilities } from '@/types/agentToolkit';

export interface VideoChatWindowProps {
  viewCache?: ConversationViewCache;
  createUploadToken?: () => ConversationUploadToken | null;
  onUploadBusyChange?: (token: ConversationUploadToken, busy: boolean) => boolean;
  isScopeValid?: (scope: ConversationWriteScope) => boolean;
  onDraftRestoreConsumed?: (nonce: number) => void;
  busyReason?: string | null;
  /** 最小化只暂停展示工作，不影响会话与 Agent 执行。 */
  isVisible?: boolean;
  conversation: Conversation | undefined;
  /** `options` (skill / mentions) only reach the agent path. */
  onSendMessage: (message: string, options?: SendAgentMessageOptions,
    context?: ConversationSendContext) => Promise<SendMessageResult | void>;
  onClearMessages: (conversationId?: string) => void;
  isLoading: boolean;
  onCreativeBrainstormingClick?: () => void;
  onPolishClick?: () => void;
  onConvertMessageToScript?: (content: string) => void;
  // Agent mode props
  agentMode: boolean;
  onAgentModeChange: (enabled: boolean) => void;
  agentIsExecuting: boolean;
  /** 全自动模式（YOLO）是否已武装；全局偏好，由 useAgentYoloMode 提供。 */
  yolo?: boolean;
  /** 首次读取持久化值是否已回；`false` 时开关禁用（评审 P2-02）。 */
  yoloReady?: boolean;
  onYoloChange?: (enabled: boolean) => void;
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
  /** Mid-run steering state machine; absent → the input stays locked while the agent runs. */
  steering?: UseAgentSteeringReturn;
  /** Text the steering layer wants put back in the input (never lose user text). */
  draftRestore?: DraftRestore | null;
  /** The `/` skill of the latest turn could not be loaded. */
  skillSkip?: SkillSkipNotice | null;
  /** Project materials offered by the `@` picker. */
  mentionMaterials?: MaterialItem[];
  /** Project id: part of the draft-storage key. */
  draftProjectKey?: string;
  /** Context ring and compaction; absent → no ring and no `/compact`. */
  contextMemory?: UseContextMemoryReturn;
  /** Live crew / batch-acquire progress for the tool cards. */
  liveProgress?: Pick<UseCrewProgressReturn, 'crews' | 'acquire' | 'isCrewRunning'>;
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
  yolo = false,
  yoloReady = true,
  onYoloChange,
  onAgentUndo,
  executionState = null,
  onUndoAll,
  onUndoSingle,
  onCancel,
  onDismissError,
  singleUndoMessageIds,
  steering,
  draftRestore = null,
  skillSkip = null,
  mentionMaterials,
  draftProjectKey,
  contextMemory,
  liveProgress,
  isVisible = true,
  viewCache, createUploadToken, onUploadBusyChange, isScopeValid,
  onDraftRestoreConsumed, busyReason,
}) => {
  const { t } = useLocale();
  const { showConfirm } = useNotification();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 文档上传：同一时刻只允许一个（`uploading` 即互斥锁）。
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<ConversationUploadToken | object | null>(null);
  const mounted = useRef(true);
  const releaseUploadRef = useRef(onUploadBusyChange);
  releaseUploadRef.current = onUploadBusyChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (uploadRef.current && 'requestId' in uploadRef.current) {
        releaseUploadRef.current?.(uploadRef.current as ConversationUploadToken, false);
      }
      uploadRef.current = null;
    };
  }, []);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [toolkitCaps, setToolkitCaps] =
    useState<AgentToolkitCapabilities | null>(null);

  const messages = conversation?.messages;

  /** 已回答的 question_id 由消息历史派生；只读，不写回 `ChatMessage`（§3.5.2）。 */
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
   * 未回答态：提问存在、本轮已结束、且之后没有对应回答（判定与插话状态机共用
   * `collectUnansweredQuestionIds`）。
   */
  const unresolvedQuestionIds = useMemo(
    () => (agentIsExecuting
      ? new Set<string>() : collectUnansweredQuestionIds(messages)),
    [messages, agentIsExecuting],
  );

  // `finishing`: the stream already ended and the last operations are being
  // applied, so there is nothing left to stop.
  const isFinishing = executionState?.status === 'finishing';

  const compaction = useChatCompaction(contextMemory);
  const composer = useComposer({
    commands: compaction.commands, onCommand: compaction.onCommand,
    agentMode, agentIsExecuting, isFinishing,
    isLoading: isLoading || uploading || !!contextMemory?.isCompacting,
    steering, draftRestore, viewCache, onDraftRestoreConsumed, isVisible,
    materials: mentionMaterials ?? [],
    messages,
    draftScope: conversation && draftProjectKey
      ? { projectKey: draftProjectKey, conversationId: conversation.id } : null,
    onSendMessage,
    onCancel: () => onCancel?.(),
  });
  const [inputFocused, setInputFocused] = useState(false);
  const setComposerText = composer.setText;

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
      if (!questionId || !answer || !unresolvedQuestionIds.has(questionId)) return;
      if (agentIsExecuting) return;
      void onSendMessage(askAnswerMessage(questionId, answer));
    };
    window.addEventListener(ASK_ANSWER_EVENT, onAnswer);
    return () => window.removeEventListener(ASK_ANSWER_EVENT, onAnswer);
  }, [onSendMessage, agentIsExecuting, unresolvedQuestionIds]);

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
      if (!file || uploadRef.current || isLoading || agentIsExecuting ||
          contextMemory?.isCompacting) return;
      setUploadError(null);
      // 前端预检：超限直接拒绝，不发请求（避免 413 往返）。
      if (maxFileMb > 0 && file.size > maxFileMb * 1024 * 1024) {
        setUploadError(t.agentToolkit.attachTooLarge.replace(
          '{mb}', String(maxFileMb)));
        return;
      }
      const token = createUploadToken?.();
      if (createUploadToken && !token) return;
      if (token && onUploadBusyChange?.(token, true) === false) return;
      const request = token ?? {};
      uploadRef.current = request;
      setUploading(true);
      try {
        const uploaded = await uploadDocument(file);
        if (!mounted.current || uploadRef.current !== request ||
            (token && isScopeValid?.(token) === false)) return;
        // 成功后**恰**发一条消息；失败绝不发送（否则模型会引用不存在的文档）。
        const text = documentRefMessage(uploaded.document_id, uploaded.name);
        const result = await onSendMessage(text, undefined,
          token ? { uploadToken: token } : undefined);
        if (result?.accepted === false && mounted.current &&
            (!token || isScopeValid?.(token) !== false)) {
          if (token && viewCache) {
            const previous = viewCache.getDraft(token.conversationId);
            const draft = { ...previous,
              text: previous.text ? `${previous.text}\n\n${text}` : text };
            viewCache.setDraft(token.conversationId, draft);
            setComposerText(draft.text);
          } else setComposerText(previous => previous ? `${previous}\n\n${text}` : text);
          setUploadError(t.agentConversations.sendRejected);
        }
      } catch (error) {
        if (!mounted.current || uploadRef.current !== request) return;
        const code = error instanceof AgentToolkitApiError
          ? error.errorCode : 'document_parse_failed';
        const status = resolveAgentToolkitStatus({ error_code: code });
        setUploadError(status
          ? t.agentToolkit[status.key] : t.agentToolkit.attachFailed);
      } finally {
        if (uploadRef.current === request) {
          uploadRef.current = null;
          if (token) onUploadBusyChange?.(token, false);
          if (mounted.current) setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    },
    [isLoading, agentIsExecuting, contextMemory?.isCompacting, maxFileMb,
      onSendMessage, t, createUploadToken, onUploadBusyChange, isScopeValid,
      viewCache, setComposerText],
  );

  const handleClearChat = useCallback(() => {
    if (!conversation || conversation.messages.length === 0) return;
    const id = conversation.id;
    showConfirm(t.videoChatWindow.clearChatConfirm, () => onClearMessages(id));
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

  const currentTurn = messages && messages.length > 0
    ? [messages[messages.length - 1]] : [];
  const planStep = agentIsExecuting
    ? selectActiveStep(scanLatestPlan(currentTurn)) : null;

  // ----- Main render -----
  //
  // The dock panel must open directly into the Agent chat operation surface —
  // no "视频编辑AI助手" welcome/intro landing. The message area stays blank until
  // a conversation has messages; the agent-mode toggle and input box render
  // unconditionally so the popup is immediately chat-ready (round 2 requirement).

  return (
    <div className="agent-chat-window flex flex-1 flex-col bg-card min-h-0 min-w-0">
      {/* Messages Area — rendered by TimelineChatPanel. While there are no
          messages yet the area stays blank (an empty flex spacer) so the panel
          opens straight into the chat surface instead of a welcome landing. */}
      {conversation && conversation.messages.length > 0 ? (
        <LiveProgressContext.Provider value={liveProgress ?? EMPTY_LIVE_PROGRESS}>
        <TimelineChatPanel
          onUndoCompaction={contextMemory?.undoCompaction}
          compactingAfterMessageId={contextMemory?.compactingAfterMessageId}
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
          scrollCache={viewCache ? {
            get: () => viewCache.getScroll(conversation.id),
            set: value => viewCache.setScroll(conversation.id, value),
          } : undefined}
        />
        </LiveProgressContext.Provider>
      ) : (
        <div className="flex-1 min-h-0" />
      )}

      {agentIsExecuting && !isFinishing && (
        <AgentBusyBar
          executionState={executionState}
          onCancel={handleCancel}
          planStep={planStep}
          yolo={yolo}
          showSteerHint={!!steering && !inputFocused && !composer.text}
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

      {agentIsExecuting && steering && (
        <SteerQueue
          notes={steering.notes}
          queued={steering.queued}
          currentToolName={executionState?.currentTool?.name ?? null}
          crewRunning={liveProgress?.isCrewRunning}
          onCancel={steering.cancelNote}
          onStopAndResend={steering.promoteToStop}
        />
      )}

      {skillSkip && (
        <p role="status" className="flex-shrink-0 px-3 pt-1 text-xs text-muted-foreground">
          {t.agentCollab.skillSkipped.replace('{name}', skillSkip.skillId)}
        </p>
      )}

      <AgentComposer composer={composer}
        mode={{ agentMode, onAgentModeChange, yolo, yoloReady,
          onYoloChange: next => onYoloChange?.(next),
          disabled: isLoading || agentIsExecuting || uploading || !!busyReason,
          onCreativeBrainstormingClick, onPolishClick }}
        actions={{ isLoading, agentIsExecuting, isFinishing,
          hasMessages: !!messages?.length, onClear: handleClearChat,
          onCancel: handleCancel, onFocusChange: setInputFocused,
          busyReason, hasQueuedInput: steering?.hasPendingInput() }}
        upload={{ fileInputRef, enabled: documentsEnabled, uploading,
          accept: documentAccept, error: uploadError,
          onSelect: uploadSelectedDocument }}
        context={contextMemory ? { memory: contextMemory,
          onCompact: () => { void compaction.handleCompact(); } } : undefined}
        materials={mentionMaterials} commands={compaction.commands}
        isVisible={isVisible} notice={viewCache?.notice} />
    </div>
  );
};

export default VideoChatWindow;
