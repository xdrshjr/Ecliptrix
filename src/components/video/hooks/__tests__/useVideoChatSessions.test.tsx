import React, { StrictMode, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { VideoEditingTaskContent } from '@/types';
import { useVideoChatContentBridge } from '../useVideoChatContentBridge';
import { useVideoChatSessions } from '../useVideoChatSessions';
import { createConversation } from '../videoChatSessionModel';

function useSessions(busy = false) {
  const [content, setContent] = useState({ conversations: []
  } as unknown as VideoEditingTaskContent);
  const bridge = useVideoChatContentBridge({ projectKey: 'p', content,
    onUpdateContent: setContent });
  return useVideoChatSessions({ projectKey: 'p', contentBridge: bridge,
    isConversationReady: true, getBusyReason: () => busy ? 'busy' : null,
    labels: { defaultTitle: '新会话 {n}' } });
}
describe('会话事务', () => {
  it('结构事务确认后，流式消息等待回显不会重新取得结构锁', () => {
    const { result } = renderHook(() => useSessions());
    const scope = result.current.captureWriteScope(result.current.activeConversationId!)!;
    act(() => {
      result.current.writeMessages(scope, []);
      expect(result.current.getIsMutating()).toBe(false);
    });
  });
  it('已有有效会话无需写回也能完成初始化', () => {
    const content = { conversations: [createConversation('a', '历史')],
      activeConversationId: 'a' } as VideoEditingTaskContent;
    const { result } = renderHook(() => {
      const bridge = useVideoChatContentBridge({ projectKey: 'p', content,
        onUpdateContent: () => { throw Error('不应写回'); } });
      return useVideoChatSessions({ projectKey: 'p', contentBridge: bridge,
        isConversationReady: true, getBusyReason: () => null,
        labels: { defaultTitle: '新会话 {n}' } });
    });
    expect(result.current.isReady).toBe(true);
    expect(result.current.conversations).toHaveLength(1);
  });
  it('StrictMode 只初始化一次，同 tick 双新建只接纳一次', () => {
    const { result } = renderHook(() => useSessions(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    expect(result.current.conversations).toHaveLength(1);
    act(() => {
      expect(result.current.createConversation().ok).toBe(true);
      expect(result.current.createConversation().ok).toBe(false);
    });
    expect(result.current.conversations).toHaveLength(2);
  });
  it('清空使旧 writer 失效，保留标题草稿；忙碌拒绝结构操作', () => {
    const { result, rerender } = renderHook(({ busy }) => useSessions(busy),
      { initialProps: { busy: false } });
    const id = result.current.activeConversationId!;
    const scope = result.current.captureWriteScope(id)!;
    act(() => { result.current.clearMessages(id); });
    expect(result.current.writeMessages(scope, [])).toBe(false);
    rerender({ busy: true });
    expect(result.current.deleteConversation(id).reason).toBe('busy');
    expect(result.current.conversations).toHaveLength(1);
  });
});
