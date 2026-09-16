import { useEffect, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoEditingTaskContent } from '@/types';
import { useInterruptedConversationCleanup } from '../hooks/agentTurnLifecycle';

afterEach(cleanup);

function savedContent(): VideoEditingTaskContent {
  return {
    conversations: ['a', 'b'].map(id => ({
      id, title: id, createdAt: new Date(0), updatedAt: new Date(0),
      messages: [{
        id: `m-${id}`, role: 'assistant' as const, content: '',
        timestamp: new Date(0), isAgentMessage: true,
        isThinking: true, thinkingContent: id,
      }],
    })),
  } as VideoEditingTaskContent;
}

describe('编辑器首次会话初始化', () => {
  it('两个中断会话一次写回，收到新内容才允许发送', () => {
    const onUpdateContent = vi.fn();
    const content = savedContent();
    const { result, rerender } = renderHook(
      props => useInterruptedConversationCleanup(props),
      { initialProps: { projectKey: 'p', content, onUpdateContent } },
    );
    expect(onUpdateContent).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
    const cleaned = onUpdateContent.mock.calls[0][0];
    expect(cleaned.conversations.map((conversation: { messages: unknown[] }) =>
      conversation.messages[0],
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ thinkingContent: 'a', isThinking: false }),
      expect.objectContaining({ thinkingContent: 'b', isThinking: false }),
    ]));
    rerender({ projectKey: 'p', content: cleaned, onUpdateContent });
    expect(result.current).toBe(true);
  });

  it('延迟加载先清理，新轮次更新不再清理', () => {
    const onUpdateContent = vi.fn();
    const initialProps = {
      projectKey: 'p', content: null as VideoEditingTaskContent | null,
      onUpdateContent,
    };
    const { result, rerender } = renderHook(
      props => useInterruptedConversationCleanup(props), { initialProps },
    );
    expect(result.current).toBe(false);
    rerender({ ...initialProps, content: savedContent() });
    expect(onUpdateContent).toHaveBeenCalledTimes(1);
    act(() => rerender({
      ...initialProps, content: onUpdateContent.mock.calls[0][0],
    }));
    expect(result.current).toBe(true);
    rerender({ ...initialProps, content: savedContent() });
    expect(onUpdateContent).toHaveBeenCalledTimes(1);
  });

  it('同帧素材初始化覆盖清理时按最新内容重试，接纳后才开放发送', () => {
    const { result } = renderHook(() => {
      const [content, setContent] = useState(savedContent);
      const ready = useInterruptedConversationCleanup({
        projectKey: 'p', content, onUpdateContent: setContent,
      });
      useEffect(() => {
        // 与编辑器素材初始化相同：从首次快照整份保存，可能覆盖清理写回。
        setContent({ ...content, materials: [] });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return { content, ready };
    });
    expect(result.current.ready).toBe(true);
    expect(result.current.content.materials).toEqual([]);
    expect(result.current.content.conversations?.every(conversation =>
      conversation.messages.every(message =>
        message.isThinking === false && message.isStreaming === false),
    )).toBe(true);
  });
});
