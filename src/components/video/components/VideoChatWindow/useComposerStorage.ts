import { useCallback, useEffect, useRef } from 'react';
import type { ChatMessage } from '@/types';

/**
 * 输入区的两项便利功能：草稿保留与 ↑ 历史回溯。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.4.4。两者都是
 * 「没有也完全可用」的便利：localStorage 在隐私窗口/被禁用时会抛错，所有读写
 * 都包在 try/catch 里，失败即降级为没有这项功能。
 */

const DRAFT_KEY_PREFIX = 'ecliptrix.agentDraft.v1';
const DRAFT_DEBOUNCE_MS = 300;
const HISTORY_LIMIT = 20;

export function draftStorageKey(projectKey: string, conversationId: string): string {
  return `${DRAFT_KEY_PREFIX}.${projectKey}.${conversationId}`;
}

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, text: string): void {
  try {
    if (text) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode / blocked storage: the draft just isn't kept.
  }
}

/**
 * 草稿：挂载或切换会话时恢复，输入时防抖保存，空串则删除键，发送后调用
 * `clearDraft`。`key` 为 null 表示当前没有可归属的会话，不读不写。
 */
export function useComposerDraft(
  key: string | null,
  text: string,
  restore: (draft: string) => void,
): { clearDraft: () => void } {
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const restoredKey = useRef<string | null>(null);
  // The draft handed to `restore`, until the text state has caught up with it.
  const awaitedDraft = useRef<string | null>(null);

  useEffect(() => {
    if (!key || restoredKey.current === key) return;
    restoredKey.current = key;
    const draft = readDraft(key);
    awaitedDraft.current = draft || null;
    if (draft) restoreRef.current(draft);
  }, [key]);

  useEffect(() => {
    if (!key || restoredKey.current !== key) return;
    // Never overwrite a stored draft with the empty text of the render that
    // runs before `restore` has been applied.
    if (awaitedDraft.current !== null) {
      if (text !== awaitedDraft.current) return;
      awaitedDraft.current = null;
    }
    const timer = setTimeout(() => writeDraft(key, text), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, text]);

  const clearDraft = useCallback(() => {
    if (key) writeDraft(key, '');
  }, [key]);
  return { clearDraft };
}

/** 本会话最近 20 条用户消息（新→旧），跳过 Agent 提问回答这类机器消息。 */
export function collectInputHistory(messages: readonly ChatMessage[] | undefined): string[] {
  const entries: string[] = [];
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index--) {
    const message = messages![index];
    if (message.role !== 'user' || !message.content.trim()) continue;
    if (message.content.startsWith('[[ask:') || message.content.startsWith('[[doc:')) continue;
    if (!entries.includes(message.content)) entries.push(message.content);
    if (entries.length >= HISTORY_LIMIT) break;
  }
  return entries;
}

export interface HistoryNavigator {
  /** ↑：返回要填入的文本；没有更早的记录返回 null。`current` 是当前输入。 */
  older: (current: string) => string | null;
  /** ↓：返回要填入的文本（最新之后回到进入回溯前的输入）；不在回溯中返回 null。 */
  newer: () => string | null;
  /** 用户改动了内容：退出回溯模式。 */
  reset: () => void;
  isBrowsing: () => boolean;
}

/** ↑/↓ 回溯状态；`entries` 为新→旧。无 React 依赖，便于测试。 */
export function createHistoryNavigator(entries: readonly string[]): HistoryNavigator {
  let position = -1;
  let stash = '';
  return {
    older(current) {
      if (position === -1) stash = current;
      if (position + 1 >= entries.length) return null;
      position += 1;
      return entries[position];
    },
    newer() {
      if (position === -1) return null;
      position -= 1;
      return position === -1 ? stash : entries[position];
    },
    reset() { position = -1; },
    isBrowsing: () => position !== -1,
  };
}
