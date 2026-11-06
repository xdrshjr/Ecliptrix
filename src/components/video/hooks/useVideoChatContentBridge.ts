import { useCallback, useRef, useState } from 'react';
import type { VideoEditingTaskContent } from '@/types';
import type { ConversationSlice } from './videoChatSessionModel';

interface Options {
  projectKey: string;
  content: VideoEditingTaskContent | null;
  onUpdateContent(content: VideoEditingTaskContent): void;
}
interface PendingCommit extends ConversationSlice { seq: number }

/** 只有会话事务可修改受控切片；其他整份项目写入沿用最新会话。 */
export function useVideoChatContentBridge(options: Options) {
  const contentRef = useRef(options.content);
  const seen = useRef(options.content);
  const pending = useRef<PendingCommit | null>(null);
  const sequence = useRef(0);
  const acknowledged = useRef(0);
  const publish = useRef(options.onUpdateContent);
  publish.current = options.onUpdateContent;
  const [, refresh] = useState(0);
  if (options.content !== seen.current) {
    seen.current = options.content;
    const expected = pending.current;
    if (!expected || (options.content?.conversations === expected.conversations
      && options.content?.activeConversationId === expected.activeConversationId)) {
      contentRef.current = options.content;
      if (expected) acknowledged.current = expected.seq;
      pending.current = null;
    }
  }
  const publishProjectContent = useCallback((next: VideoEditingTaskContent) => {
    const previous = contentRef.current;
    const merged = { ...next,
      conversations: previous?.conversations ?? next.conversations,
      activeConversationId: previous?.activeConversationId
        ?? next.activeConversationId };
    contentRef.current = merged;
    try { publish.current(merged); }
    catch (error) { contentRef.current = previous; throw error; }
  }, []);
  const commitConversations = useCallback((
    transform: (slice: ConversationSlice) => ConversationSlice,
  ): { ok: boolean; seq: number } => {
    const previous = contentRef.current;
    if (!previous) return { ok: false, seq: sequence.current };
    const slice = { conversations: previous.conversations ?? [],
      activeConversationId: previous.activeConversationId ?? null };
    const next = transform(slice);
    if (next.conversations === slice.conversations &&
        next.activeConversationId === slice.activeConversationId) {
      return { ok: true, seq: sequence.current };
    }
    const oldPending = pending.current;
    const seq = ++sequence.current;
    pending.current = { ...next, seq };
    contentRef.current = { ...previous, ...next };
    try { publish.current(contentRef.current); }
    catch {
      contentRef.current = previous;
      pending.current = oldPending;
      return { ok: false, seq };
    }
    refresh(value => value + 1);
    return { ok: true, seq };
  }, []);
  const isCommitPending = useCallback((seq?: number) =>
    pending.current !== null &&
      (seq === undefined || (seq > acknowledged.current &&
        pending.current.seq >= seq)), []);
  const getConversation = useCallback((id: string) =>
    contentRef.current?.conversations?.find(item => item.id === id), []);
  const getActiveConversationId = useCallback(() =>
    contentRef.current?.activeConversationId ?? null, []);
  return { contentRef, publishProjectContent, commitConversations,
    isCommitPending, getConversation, getActiveConversationId };
}
export type VideoChatContentBridge = ReturnType<typeof useVideoChatContentBridge>;
