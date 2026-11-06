import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/types';
import { createConversationViewCache } from
  '../components/VideoChatWindow/conversationViewCache';
import type { VideoChatContentBridge } from './useVideoChatContentBridge';
import {
  createConversation as makeConversation, defaultConversationTitle,
  isValidConversationTitle, removeConversation, resolveActiveConversationId,
  type ConversationActionResult, type ConversationSlice,
  type ConversationWriteScope,
} from './videoChatSessionModel';

interface Options {
  projectKey: string;
  contentBridge: VideoChatContentBridge;
  isConversationReady: boolean;
  getBusyReason(): string | null;
  labels: { defaultTitle: string };
}

/** 项目拥有持久内容，此 hook 只拥有事务锁、失效代次和视图缓存。 */
export function useVideoChatSessions(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const instance = useRef<object>({});
  const alive = useRef(true);
  const epochs = useRef(new Map<string, number>());
  const selectionEpoch = useRef(0);
  const structuralSeq = useRef<number | null>(null);
  const initialized = useRef(false);
  const [, refreshInitialization] = useState(false);
  const cache = useRef(createConversationViewCache(options.projectKey));
  const viewCache = cache.current;
  const bridge = options.contentBridge;
  const getIsMutating = useCallback(() => structuralSeq.current !== null &&
    latest.current.contentBridge.isCommitPending(structuralSeq.current), []);
  const isMutating = getIsMutating();
  const isReady = options.isConversationReady && initialized.current &&
    !!bridge.getActiveConversationId();
  const ready = useRef(isReady);
  ready.current = isReady;
  useEffect(() => {
    alive.current = true;
    const flush = () => viewCache.flushAll();
    window.addEventListener('pagehide', flush);
    return () => {
      alive.current = false;
      viewCache.dispose();
      window.removeEventListener('pagehide', flush);
    };
  }, [viewCache]);
  const newConversation = useCallback(() => {
    const { contentBridge, labels } = latest.current;
    return makeConversation(`video-chat-${crypto.randomUUID()}`,
      defaultConversationTitle(
        contentBridge.contentRef.current?.conversations ?? [],
        labels.defaultTitle));
  }, []);
  useEffect(() => {
    if (!options.isConversationReady || !bridge.contentRef.current ||
        initialized.current) return;
    initialized.current = true;
    const list = bridge.contentRef.current.conversations ?? [];
    const fallback = list.length ? null : newConversation();
    const committed = bridge.commitConversations(slice => ({
      conversations: fallback ? [fallback] : slice.conversations,
      activeConversationId: fallback?.id ?? resolveActiveConversationId(
        slice.conversations, slice.activeConversationId),
    }));
    if (committed.ok) {
      structuralSeq.current = committed.seq;
      refreshInitialization(true);
    }
    else initialized.current = false;
  }, [options.isConversationReady, bridge, newConversation]);
  const transact = useCallback((transform: (
    slice: ConversationSlice,
  ) => ConversationSlice, target?: string): ConversationActionResult => {
    const current = latest.current;
    if (!alive.current || !ready.current) return { ok: false,
      reason: 'not_ready' };
    if (getIsMutating() || current.getBusyReason()) return {
      ok: false, reason: 'busy',
    };
    const oldId = current.contentBridge.getActiveConversationId();
    if (target && !current.contentBridge.getConversation(target)) return {
      ok: false, reason: 'not_found',
    };
    if (oldId) viewCache.flushDraft(oldId);
    const result = current.contentBridge.commitConversations(transform);
    if (!result.ok) return { ok: false, reason: 'publish_failed' };
    structuralSeq.current = result.seq;
    const id = current.contentBridge.getActiveConversationId();
    if (id !== oldId) selectionEpoch.current++;
    return { ok: true, conversationId: id ?? undefined };
  }, [getIsMutating, viewCache]);
  const createConversation = useCallback(() => {
    const conversation = newConversation();
    return transact(slice => ({
      conversations: [...slice.conversations, conversation],
      activeConversationId: conversation.id,
    }));
  }, [newConversation, transact]);
  const selectConversation = useCallback((id: string) => transact(slice => ({
    ...slice, activeConversationId: id,
  }), id), [transact]);
  const renameConversation = useCallback((id: string, title: string) => {
    if (!isValidConversationTitle(title)) return {
      ok: false, reason: 'invalid_title',
    } as ConversationActionResult;
    return transact(slice => ({ ...slice,
      conversations: slice.conversations.map(item => item.id === id
        ? { ...item, title: title.trim(), updatedAt: new Date() } : item),
    }), id);
  }, [transact]);
  const deleteConversation = useCallback((id: string) => {
    const fallback = newConversation();
    const result = transact(slice => removeConversation(slice.conversations,
      slice.activeConversationId, id, fallback), id);
    if (result.ok) {
      epochs.current.set(id, (epochs.current.get(id) ?? 0) + 1);
      viewCache.remove(id);
    }
    return result;
  }, [newConversation, transact, viewCache]);
  const clearMessages = useCallback((id: string) => {
    const result = transact(slice => ({ ...slice,
      conversations: slice.conversations.map(item => item.id === id
        ? { ...item, messages: [], updatedAt: new Date() } : item),
    }), id);
    if (result.ok) epochs.current.set(id, (epochs.current.get(id) ?? 0) + 1);
    return result;
  }, [transact]);
  const captureWriteScope = useCallback((id: string) =>
    alive.current && latest.current.contentBridge.getConversation(id)
      ? { instanceToken: instance.current, conversationId: id,
        messagesEpoch: epochs.current.get(id) ?? 0 } : null, []);
  const isScopeValid = useCallback((scope: ConversationWriteScope) =>
    alive.current && scope.instanceToken === instance.current &&
    scope.messagesEpoch === (epochs.current.get(scope.conversationId) ?? 0)
    && !!latest.current.contentBridge.getConversation(scope.conversationId), []);
  const writeMessages = useCallback((scope: ConversationWriteScope,
    messages: ChatMessage[]): boolean => {
    if (!isScopeValid(scope)) return false;
    return latest.current.contentBridge.commitConversations(slice => ({
      ...slice, conversations: slice.conversations.map(item =>
        item.id === scope.conversationId
          ? { ...item, messages, updatedAt: new Date() } : item),
    })).ok;
  }, [isScopeValid]);
  const getSelectionEpoch = useCallback(() => selectionEpoch.current, []);
  const activeConversationId = bridge.getActiveConversationId();
  return { conversations: bridge.contentRef.current?.conversations ?? [],
    activeConversationId, activeConversation: activeConversationId
      ? bridge.getConversation(activeConversationId) : undefined,
    isReady, isMutating, getIsMutating, viewCache, createConversation,
    selectConversation, renameConversation, deleteConversation, clearMessages,
    captureWriteScope, isScopeValid, writeMessages, getSelectionEpoch };
}
