import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VideoEditingTaskContent } from '@/types';
import { useVideoChatContentBridge } from '../useVideoChatContentBridge';
import { createConversation } from '../videoChatSessionModel';

describe('会话内容桥', () => {
  it('同 tick 会话写入和旧项目写入都保留最新切片', () => {
    const content = { conversations: [createConversation('a', 'A')],
      activeConversationId: 'a' } as VideoEditingTaskContent;
    const publish = vi.fn();
    const { result, rerender } = renderHook(({ value }) =>
      useVideoChatContentBridge({ projectKey: 'p', content: value,
        onUpdateContent: publish }), { initialProps: { value: content } });
    const b = createConversation('b', 'B');
    act(() => {
      result.current.commitConversations(slice => ({
        conversations: [...slice.conversations, b],
        activeConversationId: 'b',
      }));
      result.current.publishProjectContent({ ...content, markdownContent: '最新正文' });
    });
    rerender({ value: { ...content } });
    expect(result.current.getActiveConversationId()).toBe('b');
    expect(result.current.contentRef.current?.markdownContent).toBe('最新正文');
    expect(result.current.isCommitPending()).toBe(true);
    rerender({ value: publish.mock.calls[publish.mock.calls.length - 1][0] });
    expect(result.current.isCommitPending()).toBe(false);
  });
  it('发布异常回滚，缺省相同切片不等待回显', () => {
    const content = { conversations: [], activeConversationId: null
    } as unknown as VideoEditingTaskContent;
    const { result } = renderHook(() => useVideoChatContentBridge({
      projectKey: 'p', content, onUpdateContent: () => { throw Error('失败'); },
    }));
    expect(result.current.commitConversations(slice => slice).ok).toBe(true);
    act(() => {
      expect(result.current.commitConversations(() => ({
        conversations: [createConversation('a', 'A')],
        activeConversationId: 'a',
      })).ok).toBe(false);
    });
    expect(result.current.getActiveConversationId()).toBeNull();
    expect(result.current.isCommitPending()).toBe(false);
  });
});
