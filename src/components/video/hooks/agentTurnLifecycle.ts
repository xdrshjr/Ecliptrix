/**
 * agentTurnLifecycle — helpers for the ids, writes and requests of one agent
 * turn, kept out of `useAgentExecution` so the hook stays wiring only.
 *
 * - `createTurnMessageIds`: `Date.now()` alone repeats within a millisecond,
 *   and message ids key React nodes and the per-turn undo records.
 * - `stripHistoryForRequest`: the chat route replays `agentToolCalls` only;
 *   track patches, applied operations and thinking text are client state and
 *   made up most of the request body on long conversations.
 * - `replaceRetiredTurnMessage`: a turn the finishing watchdog gave up on may
 *   still settle after a newer turn started. Its late write must update its
 *   own message only, never replace the conversation with its stale copy.
 *
 * @module agentTurnLifecycle
 */

import { useEffect, useRef, useState } from 'react';
import type {
  AgentToolCallRecord, ChatMessage, MaterialItem, TimelineState, VideoEditingTaskContent,
} from '@/types';
import { isInlineMediaUrl } from '@/lib/inlineUrl';
import { rebaseTrackPatches } from '@/lib/video-editing-agent/trackPatch';

/** 恢复历史时仅结束残留活动，不删除思考内容或已完成的操作。 */
export function normalizeInterruptedAgentMessages(
  messages: ChatMessage[],
): ChatMessage[] {
  let changed = false;
  const normalized = messages.flatMap(message => {
    if (!message.isAgentMessage) {
      if (!message.isStreaming) return [message];
      changed = true;
      return [{ ...message, isStreaming: false }];
    }
    const hasActiveTool = message.agentToolCalls?.some(
      tool => tool.status === 'executing',
    );
    if (!message.isStreaming && !message.isThinking && !hasActiveTool) {
      return [message];
    }
    changed = true;
    if (!message.content && !message.thinkingContent &&
      !message.agentToolCalls?.length) return [];
    return [{
      ...message, isStreaming: false, isThinking: false, isCancelled: true,
      ...(hasActiveTool ? {
        agentToolCalls: message.agentToolCalls?.map(tool =>
          tool.status === 'executing'
            ? { ...tool, status: 'cancelled' as const } : tool,
        ),
      } : {}),
    }];
  });
  return changed ? normalized : messages;
}

interface ConversationCleanupOptions {
  projectKey: string;
  content: VideoEditingTaskContent | null;
  onUpdateContent: (content: VideoEditingTaskContent) => void;
}

/** 编辑器是唯一调用者；历史合并写回，父级确认接纳后才能开始新轮次。 */
export function useInterruptedConversationCleanup({
  projectKey, content, onUpdateContent,
}: ConversationCleanupOptions): boolean {
  const initialized = useRef<string | null>(null);
  const pending = useRef<{
    projectKey: string; content: VideoEditingTaskContent;
  } | null>(null);
  const [readyProject, setReadyProject] = useState<string | null>(null);
  useEffect(() => {
    if (initialized.current === projectKey || !content) return;
    const conversations = content.conversations;
    const normalized = conversations?.map(conversation => {
      const messages = normalizeInterruptedAgentMessages(conversation.messages);
      return messages === conversation.messages
        ? conversation : { ...conversation, messages };
    });
    const changed = normalized?.some(
      (conversation, index) => conversation !== conversations?.[index],
    );
    if (changed) {
      if (pending.current?.projectKey === projectKey &&
          pending.current.content === content) return;
      // 其他初始化 effect 可能整份写回旧会话；按最新快照补偿，保留其字段。
      pending.current = { projectKey, content };
      onUpdateContent({ ...content, conversations: normalized });
      return;
    }
    initialized.current = projectKey;
    pending.current = null;
    setReadyProject(projectKey);
  }, [projectKey, content, onUpdateContent]);
  return readyProject === projectKey && !!content &&
    initialized.current === projectKey;
}

let turnSequence = 0;

/** Ids for a turn's user message and agent reply, unique within this page. */
export function createTurnMessageIds(): { userMessageId: string; agentMessageId: string } {
  turnSequence += 1;
  const stem = `msg-${Date.now()}-${turnSequence}`;
  return { userMessageId: `${stem}-user`, agentMessageId: `${stem}-agent` };
}

/** The request copy of the conversation, without client-only message fields. */
export function stripHistoryForRequest(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const hasUiSnapshots = message.agentToolCalls?.some(
      (call) => call.crew !== undefined || call.acquire !== undefined,
    );
    if (
      message.timelineTrackPatches === undefined &&
      message.pendingOperations === undefined &&
      message.thinkingContent === undefined &&
      !hasUiSnapshots
    ) {
      return message;
    }
    const copy: ChatMessage = { ...message };
    delete copy.timelineTrackPatches;
    delete copy.pendingOperations;
    delete copy.thinkingContent;
    if (hasUiSnapshots) {
      // Crew / acquire snapshots are rebuilt from `result`; sending them wastes body size.
      copy.agentToolCalls = message.agentToolCalls?.map(({ crew, acquire, ...call }) => {
        void crew; void acquire;
        return call;
      });
    }
    return copy;
  });
}

/** Steps the user undid since the watchdog write stay undone. */
function keepUndoneSteps(
  update: AgentToolCallRecord[] | undefined,
  existing: AgentToolCallRecord[] | undefined,
): AgentToolCallRecord[] | undefined {
  if (!update || !existing) return update;
  const undoneIds = new Set(existing.filter((tc) => tc.status === 'undone').map((tc) => tc.id));
  if (undoneIds.size === 0) return update;
  return update.map((tc) => (undoneIds.has(tc.id) ? { ...tc, status: 'undone' as const } : tc));
}

/**
 * Apply a retired turn's late write to its own message. The message keeps the
 * track patches written when the watchdog sealed it (patches computed now
 * would swallow the newer turn's edits) and any undo the user did since.
 * Returns null when the message no longer exists (e.g. the chat was cleared),
 * in which case the write is dropped.
 */
export function replaceRetiredTurnMessage(
  messages: readonly ChatMessage[],
  update: ChatMessage,
): ChatMessage[] | null {
  const index = messages.findIndex((message) => message.id === update.id);
  if (index === -1) return null;
  const existing = messages[index];
  const merged: ChatMessage = {
    ...update,
    agentToolCalls: keepUndoneSteps(update.agentToolCalls, existing.agentToolCalls),
    ...(existing.timelineTrackPatches ? { timelineTrackPatches: existing.timelineTrackPatches } : {}),
    ...(existing.isUndone ? { isUndone: true, pendingOperations: [] } : {}),
  };
  if (!existing.timelineTrackPatches) delete merged.timelineTrackPatches;
  return messages.map((message, i) => (i === index ? merged : message));
}

/** Empty streaming reply shown until the first agent event arrives. */
export function createAgentPlaceholder(agentMessageId: string): ChatMessage {
  return {
    id: agentMessageId,
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    isStreaming: true,
    isAgentMessage: true,
    agentToolCalls: [],
    pendingOperations: [],
  };
}

/**
 * Request copy of the materials without inline media: `data:` thumbnails
 * would be re-sent (and reach tool results) on every turn, and `blob:` local
 * proxies mean nothing outside this page.
 */
export function stripInlineMediaForAgent(materials: readonly MaterialItem[]): MaterialItem[] {
  return materials.map(material => {
    if (!isInlineMediaUrl(material.thumbnailUrl) && material.localProxyUrl === undefined) {
      return material;
    }
    const copy: MaterialItem = { ...material };
    delete copy.localProxyUrl;
    if (isInlineMediaUrl(copy.thumbnailUrl)) delete copy.thumbnailUrl;
    return copy;
  });
}

export function markToolCallUndone(
  messages: ChatMessage[],
  messageId: string,
  toolCallId: string,
): ChatMessage[] {
  return messages.map(msg => {
    if (msg.id !== messageId || !msg.agentToolCalls) return msg;
    return {
      ...msg,
      agentToolCalls: msg.agentToolCalls.map(tc =>
        tc.id === toolCallId ? { ...tc, status: 'undone' as const } : tc
      ),
    };
  });
}

/**
 * After one step of a turn was undone, point the turn's patches for the
 * tracks that step touched at the live timeline (see rebaseTrackPatches).
 */
export function rebaseMessagePatches(
  messages: ChatMessage[],
  messageId: string,
  trackIds: readonly string[],
  live: TimelineState | null,
): ChatMessage[] {
  if (!live || trackIds.length === 0) return messages;
  return messages.map(msg =>
    msg.id === messageId && msg.timelineTrackPatches
      ? {
        ...msg,
        timelineTrackPatches: rebaseTrackPatches(
          msg.timelineTrackPatches, trackIds, live,
        ),
      }
      : msg
  );
}
